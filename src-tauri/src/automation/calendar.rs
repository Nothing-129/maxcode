//! Mainland holiday-cn calendar. Missing/unpublished years fail closed.
use crate::db::{error::DbError, service::automation_service::compute_next_run};
use chrono::{DateTime, Datelike, NaiveDate, Utc, Weekday};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::OnceLock,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CalendarFilter {
    #[default]
    All,
    CnWorkday,
    CnHoliday,
}

pub fn filter_from_config(config: &serde_json::Value) -> Result<CalendarFilter, DbError> {
    config
        .get("calendar_filter")
        .map(|v| {
            serde_json::from_value(v.clone())
                .map_err(|e| DbError::Validation(format!("invalid calendar filter: {e}")))
        })
        .unwrap_or(Ok(CalendarFilter::All))
}

#[derive(Clone, Deserialize, Serialize)]
struct HolidayYear {
    year: i32,
    papers: Vec<String>,
    days: Vec<HolidayDay>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HolidayDay {
    date: NaiveDate,
    is_off_day: bool,
}

fn china_date(at: DateTime<Utc>) -> NaiveDate {
    at.with_timezone(&chrono_tz::Asia::Shanghai).date_naive()
}

fn matches_date(
    date: NaiveDate,
    filter: CalendarFilter,
    year: &HolidayYear,
    next: Option<&HolidayYear>,
) -> Result<bool, DbError> {
    if filter == CalendarFilter::All {
        return Ok(true);
    }
    if year.year != date.year() || year.papers.is_empty() {
        return Err(DbError::Validation(format!(
            "holiday-cn: {} calendar has not been published",
            date.year()
        )));
    }
    let special = next
        .filter(|y| !y.papers.is_empty())
        .and_then(|y| y.days.iter().find(|d| d.date == date))
        .or_else(|| year.days.iter().find(|d| d.date == date));
    Ok(match filter {
        CalendarFilter::All => true,
        CalendarFilter::CnHoliday => special.is_some_and(|d| d.is_off_day),
        CalendarFilter::CnWorkday => special
            .map(|d| !d.is_off_day)
            .unwrap_or(!matches!(date.weekday(), Weekday::Sat | Weekday::Sun)),
    })
}

fn cache_root() -> PathBuf {
    std::env::var_os("CODEG_DATA_DIR")
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(crate::paths::codeg_home_dir)
        .join("holiday-cn")
}

// Serialize refreshes so concurrent previews and claims share one download.
async fn load_year(year: i32) -> Result<HolidayYear, DbError> {
    static CACHE: OnceLock<Mutex<HashMap<i32, (Instant, HolidayYear)>>> = OnceLock::new();
    let mut cache = CACHE.get_or_init(Default::default).lock().await;
    if let Some((at, data)) = cache.get(&year) {
        if at.elapsed() < Duration::from_secs(300) {
            return Ok(data.clone());
        }
    }
    let path = cache_root().join(format!("{year}.json"));
    let source =
        format!("https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json");
    let data = load_year_file_with(year, &path, Duration::from_secs(86400), || {
        download_year(&source)
    })
    .await?;
    cache.insert(year, (Instant::now(), data.clone()));
    Ok(data)
}

fn valid_year(data: &HolidayYear, year: i32) -> bool {
    data.year == year
        && data
            .days
            .iter()
            .all(|d| (year - 1..=year).contains(&d.date.year()))
}

async fn download_year(source: &str) -> Result<HolidayYear, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?
        .get(source)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

async fn load_year_file_with<F, Fut>(
    year: i32,
    path: &std::path::Path,
    max_age: Duration,
    fetch: F,
) -> Result<HolidayYear, DbError>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<HolidayYear, String>>,
{
    let disk = std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice::<HolidayYear>(&b).ok())
        .filter(|y| valid_year(y, year));
    let fresh = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|age| age < max_age);
    let data = if let Some(data) = disk.as_ref().filter(|_| fresh) {
        data.clone()
    } else {
        let fetched = fetch().await.and_then(|data| {
            if valid_year(&data, year) {
                Ok(data)
            } else {
                Err("invalid year/date in holiday-cn response".to_string())
            }
        });
        match fetched {
            Ok(data) => {
                // Cache is replace-on-success; interrupted writes cannot destroy the last good year.
                if let Some(parent) = path.parent() {
                    let saved = (|| -> Result<(), Box<dyn std::error::Error>> {
                        std::fs::create_dir_all(parent)?;
                        use std::io::Write;
                        let mut temp = tempfile::NamedTempFile::new_in(parent)?;
                        temp.write_all(&serde_json::to_vec(&data)?)?;
                        temp.persist(path)?;
                        Ok(())
                    })();
                    if let Err(e) = saved {
                        tracing::warn!("holiday-cn cache: {e}");
                    }
                }
                data
            }
            Err(e) => match disk {
                Some(data) => {
                    tracing::warn!("holiday-cn refresh failed, using cached {year}: {e}");
                    data
                }
                None => {
                    return Err(DbError::Validation(format!(
                        "holiday-cn: {year} calendar unavailable: {e}"
                    )))
                }
            },
        }
    };
    Ok(data)
}

pub async fn calendar_matches(at: DateTime<Utc>, filter: CalendarFilter) -> Result<bool, DbError> {
    if filter == CalendarFilter::All {
        return Ok(true);
    }
    let date = china_date(at);
    let year = load_year(date.year()).await?;
    // A following year's notice can affect December of this year.
    let next = if date.month() == 12 {
        Some(load_year(date.year() + 1).await?)
    } else {
        None
    };
    matches_date(date, filter, &year, next.as_ref())
}

pub async fn compute_calendar_next_run(
    cron: &str,
    timezone: &str,
    after: DateTime<Utc>,
    filter: CalendarFilter,
) -> Result<Option<DateTime<Utc>>, DbError> {
    if filter == CalendarFilter::All {
        return compute_next_run(cron, timezone, after);
    }
    compute_matching_next_run(cron, "Asia/Shanghai", after, |at| {
        calendar_matches(at, filter)
    })
    .await
}

async fn compute_matching_next_run<F, Fut>(
    cron: &str,
    timezone: &str,
    after: DateTime<Utc>,
    mut matches: F,
) -> Result<Option<DateTime<Utc>>, DbError>
where
    F: FnMut(DateTime<Utc>) -> Fut,
    Fut: std::future::Future<Output = Result<bool, DbError>>,
{
    let mut cursor = after;
    let horizon = after + chrono::Duration::days(370);
    loop {
        let Some(next) = compute_next_run(cron, timezone, cursor)? else {
            return Ok(None);
        };
        if next > horizon {
            return Err(DbError::Validation(
                "holiday-cn: no matching date within 370 days".into(),
            ));
        }
        if matches(next).await? {
            return Ok(Some(next));
        }
        // Skip the remainder of a rejected Beijing date even for per-minute cron.
        cursor = (china_date(next)
            .succ_opt()
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_local_timezone(chrono_tz::Asia::Shanghai)
            .single()
            .unwrap()
            .with_timezone(&Utc))
            - chrono::Duration::seconds(1);
    }
}

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/automation-china-calendar.contract.rs"]
mod contract_tests;
