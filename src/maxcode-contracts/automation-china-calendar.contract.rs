use super::*;
use chrono::{TimeZone, Timelike};

fn data(year: i32, days: serde_json::Value) -> HolidayYear {
    serde_json::from_value(
        serde_json::json!({"year":year,"papers":["https://www.gov.cn/test"],"days":days}),
    )
    .unwrap()
}

#[test]
fn holidays_override_weekdays_and_makeup_overrides_weekends() {
    let y = data(
        2026,
        serde_json::json!([
            {"date":"2026-02-23","isOffDay":true},
            {"date":"2026-02-28","isOffDay":false}
        ]),
    );
    for (day, work, holiday) in [
        ("2026-02-23", false, true),
        ("2026-02-28", true, false),
        ("2026-03-01", false, false),
        ("2026-03-02", true, false),
    ] {
        let date = day.parse().unwrap();
        assert_eq!(
            matches_date(date, CalendarFilter::CnWorkday, &y, None).unwrap(),
            work
        );
        assert_eq!(
            matches_date(date, CalendarFilter::CnHoliday, &y, None).unwrap(),
            holiday
        );
    }
}

#[test]
fn next_year_notice_overrides_december_but_empty_notice_is_not_a_calendar() {
    let y = data(2026, serde_json::json!([]));
    let next = data(
        2027,
        serde_json::json!([{"date":"2026-12-31","isOffDay":true}]),
    );
    let date = "2026-12-31".parse().unwrap();
    assert!(matches_date(date, CalendarFilter::CnHoliday, &y, Some(&next)).unwrap());
    let empty: HolidayYear =
        serde_json::from_value(serde_json::json!({"year":2027,"papers":[],"days":[]})).unwrap();
    assert!(matches_date(
        "2027-01-04".parse().unwrap(),
        CalendarFilter::CnWorkday,
        &empty,
        None
    )
    .is_err());
}

#[test]
fn calendar_dates_are_beijing_dates_and_old_configs_default_to_all() {
    let instant = Utc.with_ymd_and_hms(2026, 2, 27, 17, 0, 0).unwrap();
    assert_eq!(china_date(instant).to_string(), "2026-02-28");
    assert_eq!(
        filter_from_config(&serde_json::json!({})).unwrap(),
        CalendarFilter::All
    );
    assert!(filter_from_config(&serde_json::json!({"calendar_filter":"invalid"})).is_err());
}

#[tokio::test]
async fn downloaded_year_survives_offline_refresh_and_invalid_response() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("2026.json");
    let year = data(
        2026,
        serde_json::json!([{"date":"2026-02-28","isOffDay":false}]),
    );
    assert_eq!(
        load_year_file_with(2026, &path, Duration::ZERO, || async { Ok(year) })
            .await
            .unwrap()
            .year,
        2026
    );
    let cached = std::fs::read(&path).unwrap();
    // Fresh disk cache must not attempt a download.
    assert_eq!(
        load_year_file_with(2026, &path, Duration::from_secs(86400), || async {
            panic!("fresh cache downloaded")
        })
        .await
        .unwrap()
        .year,
        2026
    );
    // Stale disk cache remains usable offline.
    assert_eq!(
        load_year_file_with(2026, &path, Duration::ZERO, || async {
            Err("offline".into())
        })
        .await
        .unwrap()
        .year,
        2026
    );
    // Wrong-year or malformed responses must never overwrite good data.
    let wrong_year = serde_json::to_string(&data(2027, serde_json::json!([]))).unwrap();
    for bad in [wrong_year.as_str(), "not json"] {
        assert_eq!(
            load_year_file_with(2026, &path, Duration::ZERO, || async {
                serde_json::from_str(bad).map_err(|e| e.to_string())
            })
            .await
            .unwrap()
            .year,
            2026
        );
        assert_eq!(std::fs::read(&path).unwrap(), cached);
    }
    assert!(load_year_file_with(
        2027,
        &dir.path().join("2027.json"),
        Duration::ZERO,
        || async { Err("offline".into()) }
    )
    .await
    .is_err());
}

#[tokio::test]
async fn next_run_math_includes_saturday_makeup_and_skips_ordinary_weekends_for_holidays() {
    let y = data(
        2026,
        serde_json::json!([
            {"date":"2026-02-23","isOffDay":true},
            {"date":"2026-02-28","isOffDay":false}
        ]),
    );
    for (after, filter, want) in [
        (
            Utc.with_ymd_and_hms(2026, 2, 27, 2, 0, 0).unwrap(),
            CalendarFilter::CnWorkday,
            "2026-02-28T01:00:00+00:00",
        ),
        (
            Utc.with_ymd_and_hms(2026, 2, 20, 2, 0, 0).unwrap(),
            CalendarFilter::CnHoliday,
            "2026-02-23T01:00:00+00:00",
        ),
        (
            Utc.with_ymd_and_hms(2026, 2, 28, 2, 0, 0).unwrap(),
            CalendarFilter::CnWorkday,
            "2026-03-02T01:00:00+00:00",
        ),
    ] {
        let next = compute_matching_next_run("0 9 * * *", "Asia/Shanghai", after, |at| {
            std::future::ready(matches_date(china_date(at), filter, &y, None))
        })
        .await
        .unwrap()
        .unwrap();
        assert_eq!(next.to_rfc3339(), want);
    }
    let next = compute_calendar_next_run(
        "0 9 * * *",
        "UTC",
        Utc.with_ymd_and_hms(2026, 2, 27, 2, 0, 0).unwrap(),
        CalendarFilter::All,
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(next.hour(), 9);
}
