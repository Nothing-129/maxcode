//! Codex, Grok, and Pi sidebar titles: first-line heuristic, then an optional
//! locale-matched refine through the user's dedicated OpenAI-compatible model.
//!
//! Grok's own `generated_title` is English-biased and lives in a separate
//! prompt from `~/.grok/AGENTS.md`, while Codex CLI does not automatically
//! generate a semantic title. New chats get the first user line immediately;
//! a configured lightweight HTTP model can then replace it with a short title
//! in the app UI language. Manual rename (`title_locked`) always wins.

use std::collections::HashSet;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use chrono::{DateTime, Utc};
use chrono_tz::Asia::Shanghai;
use regex::Regex;
use sea_orm::DatabaseConnection;

use crate::db::service::conversation_service;
use crate::models::agent::AgentType;
use crate::models::system::{AppLocale, LanguageMode, SystemLanguageSettings};
use crate::parsers::fold_reference_links;
use crate::web::event_bridge::EventEmitter;

const HEURISTIC_MAX_CHARS: usize = 28;
const LLM_TITLE_MAX_CHARS: usize = 32;
const LLM_SNIPPET_MAX_CHARS: usize = 400;
const LLM_TIMEOUT: Duration = Duration::from_secs(8);
const LEGACY_TITLE_SCRATCH_DIR_NAME: &str = "grok-title-scratch";

const REDACTED_SECRET: &str = "<redacted-secret>";
const REDACTED_ID: &str = "<redacted-id>";
const REDACTED_BANK_CARD: &str = "<redacted-bank-card>";
const REDACTED_PHONE: &str = "<redacted-phone>";
const REDACTED_EMAIL: &str = "<redacted-email>";

const PLACEHOLDERS: &[&str] = &[
    "New chat",
    "新会话",
    "新对话",
    "新對話",
    "Untitled",
    "未命名",
    "New conversation",
    "新建会话",
    "(Untitled)",
];

/// Locales we write a dedicated title prompt for. Mirrors `AppLocale`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TitleLocale {
    En,
    Zh,
    ZhTw,
    Ja,
    Ko,
    Es,
    De,
    Fr,
    Pt,
    Ar,
}

impl TitleLocale {
    pub fn from_app_locale(locale: AppLocale) -> Self {
        match locale {
            AppLocale::En => TitleLocale::En,
            AppLocale::ZhCn => TitleLocale::Zh,
            AppLocale::ZhTw => TitleLocale::ZhTw,
            AppLocale::Ja => TitleLocale::Ja,
            AppLocale::Ko => TitleLocale::Ko,
            AppLocale::Es => TitleLocale::Es,
            AppLocale::De => TitleLocale::De,
            AppLocale::Fr => TitleLocale::Fr,
            AppLocale::Pt => TitleLocale::Pt,
            AppLocale::Ar => TitleLocale::Ar,
        }
    }

    /// Map a BCP-47 / POSIX language tag to a title locale.
    pub fn from_lang_tag(raw: &str) -> Option<Self> {
        let bare = raw
            .trim()
            .split('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
            .replace('_', "-");
        if bare.is_empty() || bare == "c" || bare == "posix" {
            return None;
        }
        let primary = bare.split('-').next().unwrap_or("");
        match primary {
            "zh" => {
                let trad = bare
                    .split('-')
                    .any(|p| p == "hant" || p == "tw" || p == "hk" || p == "mo");
                Some(if trad {
                    TitleLocale::ZhTw
                } else {
                    TitleLocale::Zh
                })
            }
            "en" => Some(TitleLocale::En),
            "ja" => Some(TitleLocale::Ja),
            "ko" => Some(TitleLocale::Ko),
            "es" => Some(TitleLocale::Es),
            "de" => Some(TitleLocale::De),
            "fr" => Some(TitleLocale::Fr),
            "pt" => Some(TitleLocale::Pt),
            "ar" => Some(TitleLocale::Ar),
            _ => None,
        }
    }
}

pub fn is_placeholder_title(title: &str) -> bool {
    let t = title.trim();
    t.is_empty() || PLACEHOLDERS.iter().any(|p| p.eq_ignore_ascii_case(t))
}

/// True when `cwd` is the isolated directory used by pre-HTTP title jobs.
/// Those historical helper sessions must never appear in the sidebar.
pub fn is_grok_title_scratch_cwd(cwd: &str) -> bool {
    Path::new(cwd)
        .file_name()
        .is_some_and(|name| name == LEGACY_TITLE_SCRATCH_DIR_NAME)
}

/// The title-refine prompt itself, if it leaked into a session file.
pub fn is_title_refine_prompt(text: &str) -> bool {
    let t = text.trim_start();
    t.starts_with("为下面这条用户消息起一个简短会话标题")
        || t.starts_with("为下面的对话生成一个简洁、具体、适合左侧栏显示的标题")
        || t.starts_with("為下面這則使用者訊息起一個簡短對話標題")
        || t.starts_with("為下面的對話產生一個簡潔、具體、適合側邊欄顯示的標題")
        || t.starts_with("Write a short session title for the user message")
        || t.starts_with("Write a concise, specific sidebar title for the conversation")
        || t.starts_with("次のユーザーメッセージに短いセッションタイトル")
        || t.starts_with("次の会話に、サイドバー向けの簡潔で具体的なタイトル")
        || t.starts_with("다음 사용자 메시지에 짧은 세션 제목")
        || t.starts_with("다음 대화에 사이드바용으로 간결하고 구체적인 제목")
        || t.starts_with("Escribe un título de sesión corto")
        || t.starts_with("Escribe un título breve y específico para la barra lateral")
        || t.starts_with("Schreibe einen kurzen Sitzungstitel")
        || t.starts_with("Schreibe einen kurzen, konkreten Titel für die Seitenleiste")
        || t.starts_with("Écris un titre de session court")
        || t.starts_with("Écris un titre bref et précis adapté à la barre latérale")
        || t.starts_with("Escreva um título de sessão curto")
        || t.starts_with("Escreva um título curto e específico para a barra lateral")
        || t.starts_with("اكتب عنوان جلسة قصير")
        || t.starts_with("اكتب عنوانًا موجزًا ومحددًا للمحادثة")
}

fn redact_with(
    value: String,
    regex: &'static OnceLock<Regex>,
    pattern: &str,
    replacement: &str,
) -> String {
    regex
        .get_or_init(|| Regex::new(pattern).expect("valid title redaction regex"))
        .replace_all(&value, replacement)
        .into_owned()
}

/// Best-effort local redaction for text used in automatic titles.
///
/// This runs before either the offline heuristic or the optional model prompt.
/// It intentionally targets high-confidence formats and labelled credentials so
/// ordinary issue numbers and short numeric values remain useful title context.
pub fn redact_title_input(message: &str) -> String {
    static URL_CREDENTIAL: OnceLock<Regex> = OnceLock::new();
    static EN_CREDENTIAL: OnceLock<Regex> = OnceLock::new();
    static ZH_CREDENTIAL: OnceLock<Regex> = OnceLock::new();
    static DIRECT_SECRET: OnceLock<Regex> = OnceLock::new();
    static CN_ID: OnceLock<Regex> = OnceLock::new();
    static BANK_CARD: OnceLock<Regex> = OnceLock::new();
    static CN_MOBILE: OnceLock<Regex> = OnceLock::new();
    static CN_LANDLINE: OnceLock<Regex> = OnceLock::new();
    static INTERNATIONAL_PHONE: OnceLock<Regex> = OnceLock::new();
    static EMAIL: OnceLock<Regex> = OnceLock::new();

    let mut redacted = message.to_string();
    redacted = redact_with(
        redacted,
        &URL_CREDENTIAL,
        r"(?i)(https?://[^/\s:@]+:)[^@\s/]+@",
        &format!("${{1}}{REDACTED_SECRET}@"),
    );
    redacted = redact_with(
        redacted,
        &EN_CREDENTIAL,
        r#"(?i)["']?\b(password|passwd|pwd|passcode|api[\s_-]*key|access[\s_-]*token|auth[\s_-]*token|secret)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,，;；}\]]+)"#,
        &format!("${{1}}: {REDACTED_SECRET}"),
    );
    redacted = redact_with(
        redacted,
        &ZH_CREDENTIAL,
        r#"(密码|口令|密钥|令牌)\s*(?:[:=：]|是)\s*(?:"[^"]*"|'[^']*'|[^\s,，;；}\]]+)"#,
        &format!("${{1}}：{REDACTED_SECRET}"),
    );
    redacted = redact_with(
        redacted,
        &DIRECT_SECRET,
        r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:sk|xai)-[A-Za-z0-9_-]{8,}\b|\bgh[pousr]_[A-Za-z0-9]{8,}\b|\bgithub_pat_[A-Za-z0-9_]{8,}\b|\bAIza[A-Za-z0-9_-]{16,}\b|\bAKIA[A-Z0-9]{12,}\b|\bxox[baprs]-[A-Za-z0-9-]{8,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b",
        REDACTED_SECRET,
    );

    // Match structured numeric identifiers before phone numbers so an ID or
    // bank card is represented by its more useful category.
    redacted = redact_with(
        redacted,
        &CN_ID,
        r"(^|[^0-9])(?:[1-9][0-9]{5}(?:18|19|20)[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])[0-9]{3}[0-9Xx]|[1-9][0-9]{14})([^0-9]|$)",
        &format!("${{1}}{REDACTED_ID}${{2}}"),
    );
    redacted = redact_with(
        redacted,
        &BANK_CARD,
        r"(^|[^0-9])(?:[0-9][ -]?){15,18}[0-9]([^0-9]|$)",
        &format!("${{1}}{REDACTED_BANK_CARD}${{2}}"),
    );
    redacted = redact_with(
        redacted,
        &CN_MOBILE,
        r"(^|[^0-9])(?:\+?86[ -]?)?1[3-9][0-9](?:[ -]?[0-9]){8}([^0-9]|$)",
        &format!("${{1}}{REDACTED_PHONE}${{2}}"),
    );
    redacted = redact_with(
        redacted,
        &CN_LANDLINE,
        r"(^|[^0-9])0[0-9]{2,3}[ -]?[0-9]{7,8}([^0-9]|$)",
        &format!("${{1}}{REDACTED_PHONE}${{2}}"),
    );
    redacted = redact_with(
        redacted,
        &INTERNATIONAL_PHONE,
        r"(^|[^0-9])\+[1-9][0-9](?:[ ()-]?[0-9]){6,13}([^0-9]|$)",
        &format!("${{1}}{REDACTED_PHONE}${{2}}"),
    );
    redact_with(
        redacted,
        &EMAIL,
        r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
        REDACTED_EMAIL,
    )
}

/// Offline title: first non-empty line, folded links, collapsed whitespace,
/// max ~28 display chars. Matches grok-app's instant heuristic.
pub fn heuristic_title(message: &str) -> String {
    let redacted = redact_title_input(message);
    let folded = fold_reference_links(&redacted);
    let line = folded
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    if line.is_empty() {
        return String::new();
    }
    let collapsed: String = line.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate_chars(&collapsed, HEURISTIC_MAX_CHARS)
}

pub fn title_seed_from_blocks(blocks: &[crate::acp::types::PromptInputBlock]) -> Option<String> {
    use crate::acp::types::PromptInputBlock;
    let joined = blocks
        .iter()
        .filter_map(|b| match b {
            PromptInputBlock::Text { text } => {
                let t = text.trim();
                (!t.is_empty()).then_some(t)
            }
            _ => None,
        })
        .collect::<Vec<_>>()
        .join(" ");
    let trimmed = joined.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Whether an unlocked title may still be replaced by heuristic / refine.
///
/// True for placeholders, the first-line heuristic, the frontend's raw 80-char
/// create-row seed, the parser's 100-char seed, or a legacy collapsed prefix.
/// False for a later user message against an already-named conversation.
pub fn can_overwrite_auto_title(current: Option<&str>, first_message: &str) -> bool {
    let Some(current) = current.map(str::trim).filter(|t| !t.is_empty()) else {
        return true;
    };
    if is_placeholder_title(current) {
        return true;
    }
    let heuristic = heuristic_title(first_message);
    if !heuristic.is_empty() && current == heuristic {
        return true;
    }
    // A new-tab send creates the row before the backend receives the prompt.
    // Its temporary title preserves whitespace and slices the raw display text
    // to 80 characters, so a multiline prompt cannot be compared against only
    // the whitespace-collapsed form below.
    let frontend_seed: String = first_message.chars().take(80).collect();
    if current == frontend_seed.trim() {
        return true;
    }
    // Once a transcript refresh lands, the same unlocked placeholder may use
    // the parser's whitespace-preserving, 100-character title instead. Accept
    // that exact derivation too, without treating an arbitrary title as safe to
    // overwrite.
    let parser_seed = crate::parsers::title_from_user_text(first_message);
    if !parser_seed.is_empty() && current == parser_seed.trim() {
        return true;
    }
    let redacted = redact_title_input(first_message);
    let folded = fold_reference_links(&redacted);
    let collapsed: String = folded.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.starts_with(current) {
        return true;
    }
    let seed: String = collapsed.chars().take(80).collect();
    current == seed
}

/// Once a model refine has started, only a user-locked title can block its result.
/// Native agent titles may arrive while the request is running and are still automatic.
fn can_commit_model_refine(title_locked: bool) -> bool {
    !title_locked
}

pub fn resolve_title_locale(settings: &SystemLanguageSettings) -> TitleLocale {
    match settings.mode {
        LanguageMode::Manual => TitleLocale::from_app_locale(settings.language),
        LanguageMode::System => detect_os_title_locale()
            .unwrap_or_else(|| TitleLocale::from_app_locale(settings.language)),
    }
}

fn created_date_mmdd(created_at: DateTime<Utc>) -> String {
    created_at
        .with_timezone(&Shanghai)
        .format("%m%d")
        .to_string()
}

pub fn title_prompt(
    snippet: &str,
    original_title: &str,
    created_at: DateTime<Utc>,
    locale: TitleLocale,
) -> String {
    let created_date = created_date_mmdd(created_at);
    match locale {
        TitleLocale::En => format!(
            "Write a concise, specific sidebar title for the conversation below.\n\
             Rules:\n\
             - The date is {created_date}, converted from the conversation's createdAt in Asia/Shanghai. Use it exactly; never use updatedAt.\n\
             - Use exactly this format: MMDD｜type｜topic.\n\
             - Type must be exactly one of: 功能、设计、修复、优化、发布、探索、文档、研究.\n\
             - Derive the topic from the actual conversation content and do not repeat the project name.\n\
             - Keep the title short, concrete, and suitable for the sidebar.\n\
             - If the topic cannot be determined, do not guess; output the current title unchanged.\n\
             Output only the title, with no quotes, prefix, or explanation.\n\n\
             Current title:\n{original_title}\n\n\
             Conversation content:\n{snippet}"
        ),
        TitleLocale::Zh => format!(
            "为下面的对话生成一个简洁、具体、适合左侧栏显示的标题。\n\
             规则：\n\
             - 日期固定为 {created_date}，它由对话创建时间 createdAt 按 Asia/Shanghai 转换得到；直接使用该日期，不要使用 updatedAt。\n\
             - 格式统一为：MMDD｜类型｜主题。\n\
             - 类型只能是：功能、设计、修复、优化、发布、探索、文档、研究。\n\
             - 主题根据对话实际内容提炼，不要重复项目名称。\n\
             - 标题保持简洁、具体，适合左侧栏显示。\n\
             - 无法判断主题时不要猜，原样输出当前标题。\n\
             只输出标题，不要引号、前缀或解释。\n\n\
             当前标题：\n{original_title}\n\n\
             对话内容：\n{snippet}"
        ),
        TitleLocale::ZhTw => format!(
            "為下面的對話產生一個簡潔、具體、適合側邊欄顯示的標題。\n\
             規則：\n\
             - 日期固定為 {created_date}，它由對話建立時間 createdAt 按 Asia/Shanghai 轉換而來；直接使用該日期，不要使用 updatedAt。\n\
             - 格式統一為：MMDD｜類型｜主題。\n\
             - 類型只能是：功能、设计、修复、优化、发布、探索、文档、研究。\n\
             - 主題依據對話實際內容提煉，不要重複專案名稱。\n\
             - 標題保持簡潔、具體，適合側邊欄顯示。\n\
             - 無法判斷主題時不要猜，原樣輸出目前標題。\n\
             只輸出標題，不要引號、前綴或解釋。\n\n\
             目前標題：\n{original_title}\n\n\
             對話內容：\n{snippet}"
        ),
        TitleLocale::Ja => format!(
            "次の会話に、サイドバー向けの簡潔で具体的なタイトルを付けてください。\n\
             ルール：\n\
             - 日付は {created_date}。会話の createdAt を Asia/Shanghai に変換した値です。updatedAt は使わないでください。\n\
             - 形式は必ず MMDD｜タイプ｜トピック。\n\
             - タイプは次のいずれかをそのまま使用：功能、设计、修复、优化、发布、探索、文档、研究。\n\
             - 実際の会話内容からトピックを抽出し、プロジェクト名を繰り返さないでください。\n\
             - 判定できない場合は推測せず、現在のタイトルをそのまま出力してください。\n\
             タイトルだけを出力し、引用符、接頭辞、説明は付けないでください。\n\n\
             現在のタイトル：\n{original_title}\n\n\
             会話内容：\n{snippet}"
        ),
        TitleLocale::Ko => format!(
            "다음 대화에 사이드바용으로 간결하고 구체적인 제목을 만드세요.\n\
             규칙:\n\
             - 날짜는 {created_date}이며 대화 createdAt을 Asia/Shanghai로 변환한 값입니다. updatedAt은 사용하지 마세요.\n\
             - 형식은 반드시 MMDD｜유형｜주제입니다.\n\
             - 유형은 다음 중 하나를 그대로 사용하세요: 功能、设计、修复、优化、发布、探索、文档、研究.\n\
             - 실제 대화 내용에서 주제를 추출하고 프로젝트 이름을 반복하지 마세요.\n\
             - 주제를 판단할 수 없으면 추측하지 말고 현재 제목을 그대로 출력하세요.\n\
             따옴표, 접두사, 설명 없이 제목만 출력하세요.\n\n\
             현재 제목:\n{original_title}\n\n\
             대화 내용:\n{snippet}"
        ),
        TitleLocale::Es => format!(
            "Escribe un título breve y específico para la barra lateral.\n\
             Reglas:\n\
             - La fecha es {created_date}, convertida desde createdAt a Asia/Shanghai. Úsala exactamente y nunca uses updatedAt.\n\
             - El formato exacto es MMDD｜tipo｜tema.\n\
             - El tipo debe ser uno de estos valores exactos: 功能、设计、修复、优化、发布、探索、文档、研究.\n\
             - Extrae el tema del contenido real y no repitas el nombre del proyecto.\n\
             - Si no se puede determinar el tema, no inventes; conserva el título actual sin cambios.\n\
             Devuelve solo el título, sin comillas, prefijos ni explicación.\n\n\
             Título actual:\n{original_title}\n\n\
             Contenido de la conversación:\n{snippet}"
        ),
        TitleLocale::De => format!(
            "Schreibe einen kurzen, konkreten Titel für die Seitenleiste.\n\
             Regeln:\n\
             - Das Datum ist {created_date}, aus createdAt nach Asia/Shanghai umgerechnet. Verwende genau dieses Datum und niemals updatedAt.\n\
             - Das genaue Format ist MMDD｜Typ｜Thema.\n\
             - Der Typ muss exakt einer dieser Werte sein: 功能、设计、修复、优化、发布、探索、文档、研究.\n\
             - Leite das Thema aus dem tatsächlichen Gespräch ab und wiederhole den Projektnamen nicht.\n\
             - Wenn das Thema nicht bestimmbar ist, rate nicht und gib den aktuellen Titel unverändert aus.\n\
             Gib nur den Titel aus, ohne Anführungszeichen, Präfix oder Erklärung.\n\n\
             Aktueller Titel:\n{original_title}\n\n\
             Gesprächsinhalt:\n{snippet}"
        ),
        TitleLocale::Fr => format!(
            "Écris un titre bref et précis adapté à la barre latérale.\n\
             Règles :\n\
             - La date est {created_date}, convertie depuis createdAt vers Asia/Shanghai. Utilise-la telle quelle et n'utilise jamais updatedAt.\n\
             - Le format exact est MMDD｜type｜sujet.\n\
             - Le type doit être exactement l'une de ces valeurs : 功能、设计、修复、优化、发布、探索、文档、研究.\n\
             - Déduis le sujet du contenu réel et ne répète pas le nom du projet.\n\
             - Si le sujet est indéterminable, ne devine pas et conserve le titre actuel sans modification.\n\
             Retourne uniquement le titre, sans guillemets, préfixe ni explication.\n\n\
             Titre actuel :\n{original_title}\n\n\
             Contenu de la conversation :\n{snippet}"
        ),
        TitleLocale::Pt => format!(
            "Escreva um título curto e específico para a barra lateral.\n\
             Regras:\n\
             - A data é {created_date}, convertida de createdAt para Asia/Shanghai. Use-a exatamente e nunca use updatedAt.\n\
             - O formato exato é MMDD｜tipo｜tema.\n\
             - O tipo deve ser exatamente um destes valores: 功能、设计、修复、优化、发布、探索、文档、研究.\n\
             - Extraia o tema do conteúdo real e não repita o nome do projeto.\n\
             - Se não for possível determinar o tema, não adivinhe; mantenha o título atual inalterado.\n\
             Retorne apenas o título, sem aspas, prefixo ou explicação.\n\n\
             Título atual:\n{original_title}\n\n\
             Conteúdo da conversa:\n{snippet}"
        ),
        TitleLocale::Ar => format!(
            "اكتب عنوانًا موجزًا ومحددًا للمحادثة ومناسبًا للشريط الجانبي.\n\
             القواعد:\n\
             - التاريخ هو {created_date} بعد تحويل createdAt إلى Asia/Shanghai. استخدمه كما هو ولا تستخدم updatedAt مطلقًا.\n\
             - التنسيق الدقيق هو MMDD｜النوع｜الموضوع.\n\
             - يجب أن يكون النوع إحدى هذه القيم حرفيًا: 功能、设计、修复、优化、发布、探索、文档、研究.\n\
             - استخلص الموضوع من المحتوى الفعلي ولا تكرر اسم المشروع.\n\
             - إذا تعذر تحديد الموضوع فلا تخمّن، وأخرج العنوان الحالي دون تغيير.\n\
             أخرج العنوان فقط، بلا علامات اقتباس أو بادئة أو شرح.\n\n\
             العنوان الحالي:\n{original_title}\n\n\
             محتوى المحادثة:\n{snippet}"
        ),
    }
}

fn title_prompt_for_message(
    message: &str,
    original_title: &str,
    created_at: DateTime<Utc>,
    locale: TitleLocale,
) -> String {
    let redacted = redact_title_input(message);
    let snippet: String = redacted.chars().take(LLM_SNIPPET_MAX_CHARS).collect();
    let safe_original_title = redact_title_input(original_title);
    title_prompt(&snippet, &safe_original_title, created_at, locale)
}

pub fn clean_llm_title(raw: &str) -> Option<String> {
    let skip_line = |line: &str| -> bool {
        let l = line.trim();
        if l.is_empty() {
            return true;
        }
        let lower = l.to_ascii_lowercase();
        lower.starts_with("error:")
            || lower.starts_with("max turns")
            || lower.contains("max turns reached")
            || lower.starts_with("usage:")
            || lower.starts_with('{')
    };
    let mut t = raw
        .lines()
        .map(str::trim)
        .find(|l| !skip_line(l))?
        .to_string();
    for _ in 0..3 {
        if let Some(inner) = strip_wrapping_quotes(&t) {
            t = inner.to_string();
        } else {
            break;
        }
    }
    if let Some(rest) = t
        .strip_prefix("标题：")
        .or_else(|| t.strip_prefix("标题:"))
        .or_else(|| t.strip_prefix("標題："))
        .or_else(|| t.strip_prefix("標題:"))
        .or_else(|| t.strip_prefix("Title:"))
        .or_else(|| t.strip_prefix("Title："))
    {
        t = rest.trim().to_string();
    }
    if t.is_empty() || t.len() > 120 || is_placeholder_title(&t) || skip_line(&t) {
        return None;
    }
    Some(truncate_chars(&t, LLM_TITLE_MAX_CHARS))
}

/// Agents whose native title behavior needs the locale-matched model refine.
pub fn supports_dedicated_auto_title(agent_type: AgentType) -> bool {
    matches!(
        agent_type,
        AgentType::Codex | AgentType::Grok | AgentType::Pi
    )
}

/// Install the local heuristic first, then run one background HTTP refine when
/// a dedicated title model is configured. A failed request leaves the local
/// title in place.
pub async fn kickoff_auto_title(
    agent_type: AgentType,
    conn: DatabaseConnection,
    emitter: EventEmitter,
    conversation_id: i32,
    first_message: String,
) {
    if !supports_dedicated_auto_title(agent_type) {
        return;
    }
    let heuristic = heuristic_title(&first_message);
    if heuristic.is_empty() {
        return;
    }

    let Ok(summary) = conversation_service::get_by_id(&conn, conversation_id).await else {
        return;
    };
    if summary.title_locked {
        return;
    }
    if !can_overwrite_auto_title(summary.title.as_deref(), &first_message) {
        return;
    }
    // The heuristic is written immediately below, so this is the title that
    // is actually visible while the model request runs. It is also already
    // redacted and short enough that returning it unchanged preserves it
    // exactly through `clean_llm_title`.
    let original_title = heuristic.clone();
    let created_at = summary.created_at;

    match conversation_service::refresh_auto_title(&conn, conversation_id, heuristic.clone()).await
    {
        Ok(true) => {
            crate::commands::conversations::emit_conversation_upsert(
                &emitter,
                &conn,
                conversation_id,
            )
            .await;
        }
        Ok(false) => {}
        Err(e) => tracing::debug!(
            conversation_id,
            error = %e,
            agent = %agent_type.as_wire(),
            "heuristic title write failed"
        ),
    }

    let locale = crate::commands::system_settings::load_system_language_settings(&conn)
        .await
        .map(|s| resolve_title_locale(&s))
        .unwrap_or(TitleLocale::En);
    let title_model =
        match crate::commands::system_settings::load_title_model_runtime_settings(&conn).await {
            Ok(Some(settings)) => settings,
            Ok(None) => return,
            Err(e) => {
                tracing::debug!(error = %e, "title model settings unavailable");
                return;
            }
        };

    if !begin_refine(conversation_id) {
        return;
    }

    tokio::spawn(async move {
        struct RefineGuard(i32);
        impl Drop for RefineGuard {
            fn drop(&mut self) {
                end_refine(self.0);
            }
        }
        let _guard = RefineGuard(conversation_id);

        let refined = match llm_title_via_api(
            &title_model,
            &first_message,
            &original_title,
            created_at,
            locale,
        )
        .await
        {
            Ok(title) => title,
            Err(e) => {
                tracing::debug!(error = %e, "title model refine failed");
                return;
            }
        };

        let Ok(current) = conversation_service::get_by_id(&conn, conversation_id).await else {
            return;
        };
        if !can_commit_model_refine(current.title_locked) {
            return;
        }
        if current.title.as_deref() == Some(refined.as_str()) {
            let _ =
                conversation_service::commit_refined_title(&conn, conversation_id, refined.clone())
                    .await;
            return;
        }

        match conversation_service::commit_refined_title(&conn, conversation_id, refined.clone())
            .await
        {
            Ok(true) => {
                crate::commands::conversations::emit_conversation_upsert(
                    &emitter,
                    &conn,
                    conversation_id,
                )
                .await;
            }
            Ok(false) => {}
            Err(e) => tracing::debug!(
                conversation_id,
                error = %e,
                agent = %agent_type.as_wire(),
                "refined title write failed"
            ),
        }
    });
}

fn strip_wrapping_quotes(t: &str) -> Option<String> {
    let mut chars = t.chars();
    let first = chars.next()?;
    let last = chars.next_back()?;
    let paired = matches!(
        (first, last),
        ('"', '"') | ('\'', '\'') | ('「', '」') | ('“', '”')
    );
    if !paired {
        return None;
    }
    Some(
        t[first.len_utf8()..t.len() - last.len_utf8()]
            .trim()
            .to_string(),
    )
}

fn truncate_chars(s: &str, max: usize) -> String {
    let count = s.chars().count();
    if count <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

fn detect_os_title_locale() -> Option<TitleLocale> {
    if let Some(tag) = posix_lang_tag() {
        if let Some(locale) = TitleLocale::from_lang_tag(&tag) {
            return Some(locale);
        }
    }
    #[cfg(target_os = "macos")]
    if let Some(tag) = apple_languages_tag() {
        return TitleLocale::from_lang_tag(&tag);
    }
    None
}

fn posix_lang_tag() -> Option<String> {
    for key in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(v) = std::env::var(key) {
            let t = v.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn apple_languages_tag() -> Option<String> {
    let output = std::process::Command::new("defaults")
        .args(["read", "-g", "AppleLanguages"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    first_apple_languages_tag(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(any(target_os = "macos", test))]
fn first_apple_languages_tag(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let q = bytes[i];
        if q == b'"' || q == b'\'' {
            if let Some(end) = raw[i + 1..].find(q as char) {
                let inner = raw[i + 1..i + 1 + end].trim();
                if !inner.is_empty() {
                    return Some(inner.to_string());
                }
                i += end + 2;
                continue;
            }
        }
        i += 1;
    }
    None
}

fn refining_ids() -> &'static Mutex<HashSet<i32>> {
    static IDS: OnceLock<Mutex<HashSet<i32>>> = OnceLock::new();
    IDS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn begin_refine(id: i32) -> bool {
    refining_ids()
        .lock()
        .map(|mut set| set.insert(id))
        .unwrap_or(false)
}

fn end_refine(id: i32) {
    if let Ok(mut set) = refining_ids().lock() {
        set.remove(&id);
    }
}

fn title_chat_completions_url(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{base}/chat/completions")
    }
}

fn extract_chat_completion_title(body: &serde_json::Value) -> Option<String> {
    body.pointer("/choices/0/message/content")
        .and_then(serde_json::Value::as_str)
        .and_then(clean_llm_title)
}

fn provider_error_detail(raw: &str) -> String {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| truncate_chars(raw.trim(), 300))
}

async fn llm_title_via_api(
    settings: &crate::commands::system_settings::TitleModelRuntimeSettings,
    message: &str,
    original_title: &str,
    created_at: DateTime<Utc>,
    locale: TitleLocale,
) -> Result<String, crate::app_error::AppCommandError> {
    let prompt = title_prompt_for_message(message, original_title, created_at, locale);
    let client = reqwest::Client::builder()
        .timeout(LLM_TIMEOUT)
        .build()
        .map_err(|e| {
            crate::app_error::AppCommandError::network(
                "Failed to create the title model HTTP client",
            )
            .with_detail(e.to_string())
        })?;
    let url = title_chat_completions_url(&settings.base_url);
    let mut body = serde_json::json!({
        "model": settings.model,
        "messages": [{ "role": "user", "content": prompt }],
        "temperature": 0,
        "max_tokens": 64,
        "stream": false
    });
    if let Some(body) = body.as_object_mut() {
        body.extend(settings.request_params.clone());
    }

    let mut last_error = None;
    for attempt in 0..2 {
        let mut request = client.post(&url).json(&body);
        if let Some(api_key) = settings.api_key.as_deref() {
            request = request.bearer_auth(api_key);
        }
        match request.send().await {
            Ok(response) if response.status().is_success() => {
                let value = response.json::<serde_json::Value>().await.map_err(|e| {
                    crate::app_error::AppCommandError::network("Title model returned invalid JSON")
                        .with_detail(e.to_string())
                })?;
                return extract_chat_completion_title(&value).ok_or_else(|| {
                    crate::app_error::AppCommandError::configuration_invalid(
                        "Title model returned no usable title",
                    )
                });
            }
            Ok(response) => {
                let status = response.status();
                let retryable =
                    status.as_u16() == 408 || status.as_u16() == 429 || status.is_server_error();
                let raw = response.text().await.unwrap_or_default();
                let detail = provider_error_detail(&raw);
                let error = if matches!(status.as_u16(), 401 | 403) {
                    crate::app_error::AppCommandError::authentication_failed(format!(
                        "Title model authentication failed ({status})"
                    ))
                } else {
                    crate::app_error::AppCommandError::network(format!(
                        "Title model request failed ({status})"
                    ))
                };
                let error = if detail.is_empty() {
                    error
                } else {
                    error.with_detail(detail)
                };
                if !retryable {
                    return Err(error);
                }
                last_error = Some(error);
            }
            Err(e) => {
                last_error = Some(
                    crate::app_error::AppCommandError::network("Title model request failed")
                        .with_detail(e.to_string()),
                );
            }
        }
        if attempt == 0 {
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }
    Err(last_error.unwrap_or_else(|| {
        crate::app_error::AppCommandError::network("Title model request failed")
    }))
}

pub(crate) async fn test_title_model_connection(
    settings: &crate::commands::system_settings::TitleModelRuntimeSettings,
    locale: TitleLocale,
) -> Result<String, crate::app_error::AppCommandError> {
    llm_title_via_api(
        settings,
        "Test the conversation title model configuration",
        "Test the conversation title model configuration",
        Utc::now(),
        locale,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed_created_at() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-09-02T16:30:00Z")
            .expect("valid timestamp")
            .with_timezone(&Utc)
    }

    #[test]
    fn placeholders() {
        assert!(is_placeholder_title("新会话"));
        assert!(is_placeholder_title("New chat"));
        assert!(is_placeholder_title(""));
        assert!(!is_placeholder_title("修权限条 bug"));
    }

    #[test]
    fn heuristic_uses_first_line() {
        let t = heuristic_title("  帮我改一下登录页样式\n第二行");
        assert!(t.contains("登录") || t.contains("帮我"));
        assert!(t.chars().count() <= HEURISTIC_MAX_CHARS);
    }

    #[test]
    fn heuristic_folds_file_links() {
        let t = heuristic_title("[README.md](file:///Users/x/README.md) 看看");
        assert!(!t.contains("file://"));
        assert!(t.contains("README.md"));
    }

    #[test]
    fn redacts_labelled_credentials_and_common_api_tokens() {
        let message = r#"password=hunter2, 密码是 \"中文口令 123\", api_key: sk-superSecret123, Authorization: Bearer abc.def-123456"#;
        let redacted = redact_title_input(message);

        assert!(!redacted.contains("hunter2"));
        assert!(!redacted.contains("中文口令 123"));
        assert!(!redacted.contains("sk-superSecret123"));
        assert!(!redacted.contains("abc.def-123456"));
        assert!(redacted.matches(REDACTED_SECRET).count() >= 4);
    }

    #[test]
    fn redacts_identity_contact_and_payment_values() {
        let message = "联系 138 0013 8000，身份证 11010519491231002X，银行卡 6222 0202 0123 4567，邮箱 user@example.com";
        let redacted = redact_title_input(message);

        assert_eq!(
            redacted,
            "联系 <redacted-phone>，身份证 <redacted-id>，银行卡 <redacted-bank-card>，邮箱 <redacted-email>"
        );
    }

    #[test]
    fn redaction_keeps_short_numbers_and_dates_as_title_context() {
        let message = "修复 #12345 在 2026-09-02 访问 11434 端口的问题";
        assert_eq!(redact_title_input(message), message);
    }

    #[test]
    fn heuristic_title_never_exposes_a_recognized_secret() {
        let title = heuristic_title("登录失败，password=do-not-show-this-value");
        assert!(!title.contains("do-not-show-this-value"));
        assert!(title.contains("<redacted"));
    }

    #[test]
    fn clean_strips_quotes_and_prefix() {
        assert_eq!(
            clean_llm_title("  \"修复登录样式\" \n"),
            Some("修复登录样式".into())
        );
        assert_eq!(
            clean_llm_title("Title: List open PRs\n"),
            Some("List open PRs".into())
        );
        assert_eq!(
            clean_llm_title("标题：侧栏未读红点\n"),
            Some("侧栏未读红点".into())
        );
    }

    #[test]
    fn clean_rejects_max_turns_noise() {
        assert_eq!(clean_llm_title("Max turns reached\n"), None);
        assert_eq!(
            clean_llm_title("修复登录样式\nMax turns reached\n"),
            Some("修复登录样式".into())
        );
    }

    #[test]
    fn title_prompt_follows_locale() {
        let created_at = fixed_created_at();
        let zh = title_prompt(
            "list open prs",
            "list open prs",
            created_at,
            TitleLocale::Zh,
        );
        assert!(zh.contains("对话内容："));
        assert!(zh.contains("list open prs"));
        assert!(!zh.contains("Conversation content:"));

        let en = title_prompt(
            "list open prs",
            "list open prs",
            created_at,
            TitleLocale::En,
        );
        assert!(en.contains("Conversation content:"));
        assert!(!en.contains("用户消息"));
    }

    #[test]
    fn title_prompt_uses_created_at_in_shanghai_and_structured_rules() {
        let prompt = title_prompt(
            "修复登录状态",
            "登录状态",
            fixed_created_at(),
            TitleLocale::Zh,
        );

        assert_eq!(created_date_mmdd(fixed_created_at()), "0903");
        assert!(prompt.contains("日期固定为 0903"));
        assert!(prompt.contains("createdAt 按 Asia/Shanghai"));
        assert!(prompt.contains("不要使用 updatedAt"));
        assert!(prompt.contains("MMDD｜类型｜主题"));
        assert!(prompt.contains("功能、设计、修复、优化、发布、探索、文档、研究"));
        assert!(prompt.contains("不要重复项目名称"));
        assert!(prompt.contains("无法判断主题时不要猜，原样输出当前标题"));
        assert!(prompt.contains("当前标题：\n登录状态"));
    }

    #[test]
    fn title_prompt_uses_only_the_first_400_user_characters() {
        let message = format!("{}SHOULD_NOT_APPEAR", "中".repeat(LLM_SNIPPET_MAX_CHARS));
        let prompt =
            title_prompt_for_message(&message, "原始标题", fixed_created_at(), TitleLocale::Zh);
        assert!(prompt.contains(&"中".repeat(LLM_SNIPPET_MAX_CHARS)));
        assert!(!prompt.contains("SHOULD_NOT_APPEAR"));
    }

    #[test]
    fn title_prompt_redacts_before_applying_the_400_character_limit() {
        let message = format!(
            "{} password=secret-near-the-limit user@example.com",
            "中".repeat(350)
        );
        let prompt =
            title_prompt_for_message(&message, "原始标题", fixed_created_at(), TitleLocale::Zh);

        assert!(!prompt.contains("secret-near-the-limit"));
        assert!(!prompt.contains("user@example.com"));
        assert!(prompt.contains(REDACTED_SECRET));
        assert!(prompt.contains(REDACTED_EMAIL));
    }

    #[test]
    fn title_prompt_redacts_the_fallback_title() {
        let prompt = title_prompt_for_message(
            "无法判断主题",
            "登录 password=do-not-send-this",
            fixed_created_at(),
            TitleLocale::Zh,
        );

        assert!(!prompt.contains("do-not-send-this"));
        assert!(prompt.contains("登录 password: <redacted-secret>"));
    }

    #[test]
    fn can_overwrite_placeholder_and_seed() {
        let msg = "帮我改一下登录页样式并且顺便看看权限";
        assert!(can_overwrite_auto_title(None, msg));
        assert!(can_overwrite_auto_title(Some("新会话"), msg));
        assert!(can_overwrite_auto_title(Some(&heuristic_title(msg)), msg));
        let seed: String = msg.chars().take(80).collect();
        assert!(can_overwrite_auto_title(Some(&seed), msg));
        assert!(!can_overwrite_auto_title(Some("用户手改的名字"), msg));
    }

    #[test]
    fn can_overwrite_multiline_frontend_and_parser_seeds() {
        let msg = "修改CustomerAwards\n/*\n * 十万以内按百分之零点五\n * 二十万以内按百分之一\n * 五十万以内按百分之二\n * 五十万以上按百分之三\n */\n请参考现有月结规则处理，并补充对应测试、边界条件和变更说明。";
        let frontend_seed: String = msg.chars().take(80).collect();
        let parser_seed = crate::parsers::title_from_user_text(msg);

        assert!(frontend_seed.contains('\n'));
        assert!(parser_seed.contains('\n'));
        assert_ne!(frontend_seed, parser_seed);
        assert!(can_overwrite_auto_title(Some(&frontend_seed), msg));
        assert!(can_overwrite_auto_title(Some(&parser_seed), msg));
        assert!(!can_overwrite_auto_title(
            Some("用户手动命名的月结规则"),
            msg
        ));
    }

    #[test]
    fn follow_up_message_does_not_overwrite_existing_title() {
        assert!(!can_overwrite_auto_title(
            Some("登录页样式"),
            "再帮我看看单元测试"
        ));
    }

    #[test]
    fn unlocked_native_title_does_not_block_an_in_flight_model_refine() {
        let first_message = "录入金额后刷新动态面板";
        let native_title = "Dynamic Panel Refresh After Money Entry";
        assert!(!can_overwrite_auto_title(Some(native_title), first_message));
        assert!(can_commit_model_refine(false));
        assert!(!can_commit_model_refine(true));
    }

    #[test]
    fn locale_from_lang_tag() {
        assert_eq!(
            TitleLocale::from_lang_tag("zh-CN.UTF-8"),
            Some(TitleLocale::Zh)
        );
        assert_eq!(TitleLocale::from_lang_tag("zh_TW"), Some(TitleLocale::ZhTw));
        assert_eq!(TitleLocale::from_lang_tag("en-US"), Some(TitleLocale::En));
        assert_eq!(TitleLocale::from_lang_tag("C"), None);
    }

    #[test]
    fn apple_languages_first_tag() {
        let raw = "(\n    \"zh-Hans-CN\",\n    \"en-US\"\n)";
        assert_eq!(
            first_apple_languages_tag(raw).as_deref(),
            Some("zh-Hans-CN")
        );
    }

    #[test]
    fn scratch_cwd_and_refine_prompt() {
        assert!(is_grok_title_scratch_cwd(
            "/Users/me/.codeg/grok-title-scratch"
        ));
        assert!(!is_grok_title_scratch_cwd("/Users/me/proj"));
        assert!(is_title_refine_prompt(
            "为下面这条用户消息起一个简短会话标题。要求：最多16个汉字"
        ));
        assert!(is_title_refine_prompt(
            "为下面的对话生成一个简洁、具体、适合左侧栏显示的标题。"
        ));
        assert!(!is_title_refine_prompt("帮我改登录页"));
    }

    #[test]
    fn resolve_manual_locale() {
        let settings = SystemLanguageSettings {
            mode: LanguageMode::Manual,
            language: AppLocale::ZhCn,
        };
        assert_eq!(resolve_title_locale(&settings), TitleLocale::Zh);
    }

    #[test]
    fn dedicated_auto_title_support_includes_codex_grok_and_pi() {
        assert!(supports_dedicated_auto_title(AgentType::Codex));
        assert!(supports_dedicated_auto_title(AgentType::Grok));
        assert!(supports_dedicated_auto_title(AgentType::Pi));
        assert!(!supports_dedicated_auto_title(AgentType::ClaudeCode));
    }

    #[test]
    fn appends_chat_completions_to_api_root() {
        assert_eq!(
            title_chat_completions_url("https://api.groq.com/openai/v1/"),
            "https://api.groq.com/openai/v1/chat/completions"
        );
        assert_eq!(
            title_chat_completions_url("http://localhost:11434/v1/chat/completions"),
            "http://localhost:11434/v1/chat/completions"
        );
    }

    #[test]
    fn extracts_standard_chat_completion_title() {
        let body = serde_json::json!({
            "choices": [{ "message": { "content": "标题：修复登录状态" } }]
        });
        assert_eq!(
            extract_chat_completion_title(&body).as_deref(),
            Some("修复登录状态")
        );
    }
}
