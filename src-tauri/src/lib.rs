use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, USER_AGENT};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
    time::Duration,
};

const API_BASE: &str = "https://eapi.stalcraft.net";
const ITEMS_BASE: &str = "https://raw.githubusercontent.com/EXBO-Studio/stalzone-database/main";
const CONFIG_FILE: &str = "auction_watchlist.json";
const STATE_FILE: &str = ".auction_seen.json";
const RAPID_STATE_FILE: &str = ".auction_rapid_seen.json";
const CACHE_FILE: &str = "market_cache.sqlite3";
const SCHISTORY_BASE: &str = "https://schistory.xyz/api";
const ANALYTICS_HISTORY_DAYS: i64 = 400;
const ANALYTICS_HISTORY_LIMIT: usize = 100_000;
const RAPID_HISTORY_DAYS: i64 = 30;
const RAPID_HISTORY_LIMIT: usize = 5_000;
const RAPID_MEDIAN_TTL_SECONDS: i64 = 300;

struct AppState {
    check_lock: tokio::sync::Mutex<()>,
    rapid_lock: tokio::sync::Mutex<()>,
    rapid_medians: tokio::sync::Mutex<HashMap<String, (i64, Option<f64>)>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchRule {
    pub name: String,
    pub item_id: String,
    pub region: String,
    #[serde(default)]
    pub max_buyout: Option<i64>,
    #[serde(default)]
    pub max_unit_buyout: Option<i64>,
    #[serde(default)]
    pub max_history_median_ratio: Option<f64>,
    #[serde(default)]
    pub max_current_min_ratio: Option<f64>,
    #[serde(default = "default_history_limit")]
    pub history_limit: usize,
    #[serde(default)]
    pub min_amount: Option<i64>,
    #[serde(default)]
    pub max_amount: Option<i64>,
    #[serde(default)]
    pub artifact_qualities: Vec<String>,
    #[serde(default)]
    pub min_tier: Option<i64>,
    #[serde(default)]
    pub max_tier: Option<i64>,
    #[serde(default)]
    pub min_upgrade: Option<i64>,
    #[serde(default)]
    pub max_upgrade: Option<i64>,
    #[serde(default = "default_sort")]
    pub sort: String,
    #[serde(default = "default_order")]
    pub order: String,
    #[serde(default = "default_limit")]
    pub limit: usize,
    #[serde(default = "default_true")]
    pub additional: bool,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub group_top_n: Option<usize>,
    #[serde(default)]
    pub rapid_monitor: bool,
    #[serde(default = "default_rapid_interval")]
    pub rapid_interval_seconds: u64,
    #[serde(default = "default_rapid_limit")]
    pub rapid_limit: usize,
}

fn default_history_limit() -> usize { 100 }
fn default_limit() -> usize { 50 }
fn default_true() -> bool { true }
fn default_sort() -> String { "time_created".into() }
fn default_order() -> String { "desc".into() }
fn default_rapid_interval() -> u64 { 5 }
fn default_rapid_limit() -> usize { 5 }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogItem {
    id: String,
    name_ru: String,
    name_en: String,
    category: String,
    subcategory: String,
    color: String,
    icon_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvStatus {
    ready: bool,
    source: Option<String>,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarketAnalysis {
    lots: usize,
    history: usize,
    current_min: Option<f64>,
    current_median: Option<f64>,
    history_median: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SalesHistoryEntry {
    amount: i64,
    price: i64,
    unit_price: f64,
    time: String,
    quality: Option<String>,
    quality_code: Option<i64>,
    upgrade: Option<i64>,
    source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SalesHistoryResponse {
    total: u64,
    entries: Vec<SalesHistoryEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarketInsight {
    name: String,
    item_id: String,
    region: String,
    artifact_qualities: Vec<String>,
    min_amount: Option<i64>,
    min_upgrade: Option<i64>,
    max_upgrade: Option<i64>,
    active_lots: usize,
    all_active_lots: usize,
    matching_lots: usize,
    current_min_amount: Option<i64>,
    comparison_amount_label: String,
    comparison_amount_min: i64,
    comparison_amount_max: Option<i64>,
    stackability: String,
    stack_evidence: usize,
    max_observed_amount: i64,
    sales_sample: usize,
    sold_amount: i64,
    current_min_unit: Option<f64>,
    median_unit: Option<f64>,
    fair_value_unit: Option<f64>,
    recent_median_unit: Option<f64>,
    recent_p25_unit: Option<f64>,
    recent_p75_unit: Option<f64>,
    recent_sales_sample: usize,
    latest_sale_unit: Option<f64>,
    latest_sale_at: Option<String>,
    average_unit: Option<f64>,
    p25_unit: Option<f64>,
    p75_unit: Option<f64>,
    discount_percent: Option<f64>,
    trend_percent: Option<f64>,
    volatility_percent: Option<f64>,
    sales_per_day: Option<f64>,
    average_sale_interval_minutes: Option<f64>,
    movement_supply_change_percent: Option<f64>,
    movement_price_change_percent: Option<f64>,
    movement_collections: u64,
    movement_coverage_percent: f64,
    opportunity_score: u8,
    liquidity: String,
    verdict: String,
    risks: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarketAnalyticsResponse {
    generated_at: String,
    insights: Vec<MarketInsight>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiMarketAnalysis {
    action: String,
    main_scenario: String,
    summary: String,
    #[serde(default)]
    arguments_for: Vec<String>,
    #[serde(default)]
    arguments_against: Vec<String>,
    #[serde(default)]
    entry_conditions: Vec<String>,
    #[serde(default)]
    cancellation_conditions: Vec<String>,
    #[serde(default)]
    missing_data: Vec<String>,
}

fn ai_endpoint(endpoint: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(endpoint.trim())
        .map_err(|error| format!("Некорректный адрес модели: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Адрес модели должен использовать протокол HTTP или HTTPS".into());
    }
    if url.host_str().is_none() {
        return Err("В адресе модели не указан сервер".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Не указывайте логин или ключ в адресе; используйте отдельное поле API key".into());
    }
    Ok(url)
}

fn normalized_ai_endpoint(endpoint: &str) -> Result<reqwest::Url, String> {
    let mut url = ai_endpoint(endpoint)?;
    if url.path().trim_end_matches('/') == "/api/v1/chat" {
        url.set_path("/v1/chat/completions");
        url.set_query(None);
    }
    Ok(url)
}

fn remove_trailing_json_commas(source: &str) -> String {
    let chars: Vec<char> = source.chars().collect();
    let mut result = String::with_capacity(source.len());
    let mut in_string = false;
    let mut escaped = false;
    let mut index = 0;
    while index < chars.len() {
        let current = chars[index];
        if in_string {
            result.push(current);
            if escaped {
                escaped = false;
            } else if current == '\\' {
                escaped = true;
            } else if current == '"' {
                in_string = false;
            }
        } else if current == '"' {
            in_string = true;
            result.push(current);
        } else if current == ',' {
            let mut next = index + 1;
            while next < chars.len() && chars[next].is_whitespace() {
                next += 1;
            }
            if next >= chars.len() || !matches!(chars[next], ']' | '}') {
                result.push(current);
            }
        } else {
            result.push(current);
        }
        index += 1;
    }
    result
}

fn parse_ai_market_analysis(content: &str) -> Result<AiMarketAnalysis, String> {
    let trimmed = content.trim();
    let json_text = if trimmed.starts_with("```") {
        trimmed
            .strip_prefix("```json").or_else(|| trimmed.strip_prefix("```"))
            .and_then(|value| value.strip_suffix("```"))
            .unwrap_or(trimmed)
            .trim()
    } else {
        trimmed
    };
    let mut analysis: AiMarketAnalysis = serde_json::from_str(json_text).or_else(|_| {
        serde_json::from_str(&remove_trailing_json_commas(json_text))
    }).map_err(|error| format!("Модель вернула ответ не в ожидаемом JSON-формате: {error}"))?;
    analysis.action = analysis.action.trim().chars().take(80).collect();
    analysis.main_scenario = analysis.main_scenario.trim().chars().take(500).collect();
    analysis.summary = analysis.summary.trim().chars().take(800).collect();
    for list in [
        &mut analysis.arguments_for,
        &mut analysis.arguments_against,
        &mut analysis.entry_conditions,
        &mut analysis.cancellation_conditions,
        &mut analysis.missing_data,
    ] {
        list.truncate(6);
        for value in list.iter_mut() {
            *value = value.trim().chars().take(350).collect();
        }
        list.retain(|value| !value.is_empty());
    }
    if analysis.action.is_empty() || analysis.summary.is_empty() {
        return Err("Модель не указала обязательные поля action и summary".into());
    }
    Ok(analysis)
}

#[tauri::command]
async fn ai_market_analysis(endpoint: String, model: String, api_key: Option<String>, context: Value) -> Result<AiMarketAnalysis, String> {
    let url = normalized_ai_endpoint(&endpoint)?;
    let model = model.trim();
    if model.is_empty() {
        return Err("Укажите имя модели".into());
    }
    let system = r#"Ты независимый аудитор внутриигрового рынка STALCRAFT. Тебе намеренно не показан вывод основной аналитики приложения.
Не угадывай его и не пытайся соглашаться с ним. Сформируй собственный вывод только по наблюдаемым фактам из JSON пользователя.
Не пересчитывай и не выдумывай отсутствующие показатели.
Отделяй качество данных от вероятности успешной сделки. Если фактов недостаточно, прямо укажи это.
Учитывай комиссию, ликвидность, тренд, волатильность, глубину предложения и возможность складывания предмета.
collectionCoveragePercent означает полноту обходов, а не ликвидность. Ликвидность оценивай по подтверждённым продажам и их частоте.
Для single и unknown запрещено советовать сборку или продажу пачкой.
Поле action начни с одного из решений: Покупать сейчас, Ждать, Продавать, Держать или Недостаточно данных.
Ответь только JSON-объектом с полями: action, mainScenario, summary, argumentsFor, argumentsAgainst,
entryConditions, cancellationConditions, missingData. Все значения на русском. Массивы содержат короткие строки."#;
    let user = serde_json::to_string(&context).map_err(|error| error.to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| error.to_string())?;
    let ollama = url.path().trim_end_matches('/').ends_with("/api/chat");
    let payload = if ollama {
        json!({
            "model": model,
            "stream": false,
            "format": "json",
            "options": { "temperature": 0.15 },
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user }
            ]
        })
    } else {
        json!({
            "model": model,
            "temperature": 0.15,
            "response_format": { "type": "text" },
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user }
            ]
        })
    };
    let mut request = client.post(url).json(&payload);
    if let Some(key) = api_key.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
        request = request.bearer_auth(key);
    }
    let response = request.send().await
        .map_err(|error| format!("Сервер модели недоступен: {error}"))?;
    let status = response.status();
    let body: Value = response.json().await
        .map_err(|error| format!("Не удалось прочитать ответ локальной модели: {error}"))?;
    if !status.is_success() {
        let message = body.get("error")
            .and_then(|value| value.as_str())
            .or_else(|| body.pointer("/error/message").and_then(|value| value.as_str()))
            .unwrap_or("неизвестная ошибка");
        return Err(format!("Сервер модели вернул HTTP {status}: {message}"));
    }
    let content = if ollama {
        body.pointer("/message/content").and_then(|value| value.as_str())
    } else {
        body.pointer("/choices/0/message/content").and_then(|value| value.as_str())
    }.ok_or_else(|| "В ответе локальной модели нет текста анализа".to_string())?;
    parse_ai_market_analysis(content)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TimingBucket {
    key: u8,
    median_min_unit: f64,
    samples: usize,
    discount_percent: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarketTimingResponse {
    period_days: i64,
    total_samples: usize,
    overall_median_min: Option<f64>,
    hour_windows: Vec<TimingBucket>,
    weekdays: Vec<TimingBucket>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeepPriceWindow {
    hours: i64,
    sales: usize,
    units: i64,
    p25_unit: Option<f64>,
    median_unit: Option<f64>,
    p75_unit: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeepStackSegment {
    label: String,
    sales: usize,
    units: i64,
    median_unit: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarketDepthLevel {
    price: f64,
    lots: usize,
    units: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarketDeepAnalysis {
    generated_at: String,
    history_hours: f64,
    total_sales: usize,
    sold_units: i64,
    collections: u64,
    complete_collections: u64,
    current_supply: usize,
    current_units: i64,
    current_min_unit: Option<f64>,
    current_median_unit: Option<f64>,
    supply_change_percent: Option<f64>,
    expected_sell_unit: Option<f64>,
    buy_for_five_percent: Option<f64>,
    buy_for_ten_percent: Option<f64>,
    windows: Vec<DeepPriceWindow>,
    stack_segments: Vec<DeepStackSegment>,
    depth: Vec<MarketDepthLevel>,
    insights: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StackStrategyAnalysis {
    buy_max_amount: i64,
    sell_min_amount: i64,
    target_amount: i64,
    acquired_amount: i64,
    purchase_lots: usize,
    available_lots: usize,
    available_units: i64,
    total_cost: i64,
    average_buy_unit: Option<f64>,
    cheapest_buy_unit: Option<f64>,
    expected_sell_unit: Option<f64>,
    recent_bulk_median_unit: Option<f64>,
    bulk_sales_sample: usize,
    net_revenue: Option<f64>,
    profit: Option<f64>,
    roi_percent: Option<f64>,
    break_even_buy_unit: Option<f64>,
    complete: bool,
    warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MovementPoint {
    time: i64,
    supply: i64,
    min_unit: Option<f64>,
    median_unit: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MovementSalePoint {
    time: i64,
    median_unit: f64,
    sales: usize,
    units: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MovementEvent {
    kind: String,
    time: String,
    amount: i64,
    buyout: Option<i64>,
    unit_price: Option<f64>,
    quality: Option<String>,
    upgrade: Option<i64>,
    lifetime_minutes: Option<f64>,
    confidence: Option<f64>,
}

#[derive(Clone, Copy, Default)]
struct MovementFilters {
    quality_mask: i64,
    min_upgrade: Option<i64>,
    max_upgrade: Option<i64>,
    min_amount: Option<i64>,
    max_amount: Option<i64>,
}

impl MovementFilters {
    fn active(self) -> bool {
        self.quality_mask != 0 || self.min_upgrade.is_some() || self.max_upgrade.is_some()
            || self.min_amount.is_some() || self.max_amount.is_some()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarketMovement {
    item_id: String,
    region: String,
    current_supply: i64,
    supply_change_percent: Option<f64>,
    current_min_unit: Option<f64>,
    current_median_unit: Option<f64>,
    price_change_percent: Option<f64>,
    appeared: u64,
    disappeared: u64,
    recorded_sales: u64,
    schistory_sales: u64,
    stalzone_sales: u64,
    probable_sales: u64,
    unexplained_missing: u64,
    ended: u64,
    active_lots: u64,
    average_lifetime_minutes: Option<f64>,
    collections: u64,
    coverage_percent: f64,
    last_collected: String,
    signal: String,
    points: Vec<MovementPoint>,
    sale_points: Vec<MovementSalePoint>,
    events: Vec<MovementEvent>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarketMovementResponse {
    generated_at: String,
    hours: i64,
    markets: Vec<MarketMovement>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MatchRecord {
    name: String,
    region: String,
    item_id: String,
    quality: Option<String>,
    upgrade: Option<i64>,
    amount: i64,
    buyout: Option<i64>,
    unit: Option<f64>,
    current: Option<i64>,
    end: String,
    message: String,
    deal_ratio: Option<f64>,
    #[serde(skip)]
    group_id: Option<String>,
    #[serde(skip)]
    group_top_n: Option<usize>,
    #[serde(skip)]
    seen_key: String,
    #[serde(skip)]
    is_new: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckResult {
    checked_rules: usize,
    notifications: usize,
    observed_lots: usize,
    collected_sales: usize,
    collection_errors: Vec<String>,
    matches: Vec<MatchRecord>,
    summaries: Vec<RuleSummary>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RapidSeenState {
    markets: HashMap<String, Vec<String>>,
    updated_at: Option<String>,
}

#[derive(Default)]
struct RateLimitState {
    limit: Option<u64>,
    remaining: Option<u64>,
    reset_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RapidCheckResult {
    checked_rules: usize,
    requests: usize,
    observed_lots: usize,
    new_lots: usize,
    baseline: bool,
    throttled: bool,
    rate_limit: Option<u64>,
    rate_remaining: Option<u64>,
    rate_reset_at: Option<i64>,
    errors: Vec<String>,
    matches: Vec<MatchRecord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuleSummary {
    name: String,
    item_id: String,
    region: String,
    total_lots: usize,
    comparable_lots: usize,
    matching_lots: usize,
    current_min_buyout: Option<i64>,
    current_min_unit: Option<f64>,
    history_median_unit: Option<f64>,
    checked_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveLotView {
    item_id: String,
    amount: i64,
    buyout: Option<i64>,
    unit_price: Option<f64>,
    current_price: Option<i64>,
    quality: Option<String>,
    upgrade: Option<i64>,
    start_time: Option<String>,
    end_time: Option<String>,
    matches_rule: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveLotsResponse {
    total: usize,
    returned: usize,
    markets: usize,
    complete_markets: usize,
    collected_at: Option<String>,
    lots: Vec<ActiveLotView>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeenState {
    seen: Vec<String>,
    updated_at: Option<String>,
}

fn workspace_file(name: &str) -> PathBuf {
    #[cfg(debug_assertions)]
    if let Some(project_root) = Path::new(env!("CARGO_MANIFEST_DIR")).parent() {
        return project_root.join(name);
    }
    #[cfg(not(debug_assertions))]
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() { return parent.join(name); }
    }
    env::current_dir().unwrap_or_else(|_| PathBuf::from(".")).join(name)
}

fn existing_workspace_file(name: &str) -> PathBuf {
    let primary = workspace_file(name);
    if primary.exists() { return primary; }
    #[cfg(debug_assertions)]
    {
        let legacy = Path::new(env!("CARGO_MANIFEST_DIR")).join(name);
        if legacy.exists() { return legacy; }
    }
    primary
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheStatus {
    sales: u64,
    snapshots: u64,
    items: u64,
    collections: u64,
    lot_observations: u64,
    tracked_lots: u64,
    active_lots: u64,
    tracked_markets: u64,
    last_collection: Option<String>,
    oldest_sale: Option<String>,
    newest_sale: Option<String>,
    size_bytes: u64,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheSyncResponse {
    inserted_sales: usize,
    cached_sales: u64,
    cached_items: u64,
    fetched_pages: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SchistoryItem {
    id: i64,
    external_id: String,
}

#[derive(Deserialize)]
struct SchistorySale {
    id: i64,
    item_id: i64,
    price: i64,
    qlt: Option<i64>,
    ptn: Option<i64>,
    sold_at: String,
    region: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SchistoryImportResponse {
    external_item_id: i64,
    fetched_sales: usize,
    matching_sales: usize,
    inserted_sales: usize,
    skipped_existing: usize,
    oldest_sale: Option<String>,
    newest_sale: Option<String>,
}

fn open_cache() -> Result<Connection, String> {
    let path = workspace_file(CACHE_FILE);
    let connection = Connection::open(&path).map_err(|error| format!("Не удалось открыть локальную базу: {error}"))?;
    prepare_cache(&connection)?;
    Ok(connection)
}

fn prepare_cache(connection: &Connection) -> Result<(), String> {
    connection.busy_timeout(std::time::Duration::from_secs(5)).map_err(|error| error.to_string())?;
    connection.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         CREATE TABLE IF NOT EXISTS sales (
           fingerprint TEXT PRIMARY KEY,
           item_id TEXT NOT NULL,
           region TEXT NOT NULL,
           sold_at TEXT NOT NULL,
           sold_timestamp INTEGER NOT NULL,
           amount INTEGER NOT NULL,
           price INTEGER NOT NULL,
           quality_code INTEGER,
           upgrade INTEGER,
           raw_json TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS sales_item_time ON sales(item_id, region, sold_timestamp DESC);
         CREATE TABLE IF NOT EXISTS market_snapshots (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           captured_at TEXT NOT NULL,
           captured_timestamp INTEGER NOT NULL,
           item_id TEXT NOT NULL,
           region TEXT NOT NULL,
           active_lots INTEGER NOT NULL,
           buyout_lots INTEGER NOT NULL,
           matching_lots INTEGER NOT NULL,
           total_amount INTEGER NOT NULL,
           min_unit REAL,
           second_min_unit REAL,
           median_unit REAL
         );
         CREATE INDEX IF NOT EXISTS snapshots_item_time ON market_snapshots(item_id, region, captured_timestamp DESC);
         CREATE TABLE IF NOT EXISTS market_collections (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           collected_at TEXT NOT NULL,
           collected_timestamp INTEGER NOT NULL,
           item_id TEXT NOT NULL,
           region TEXT NOT NULL,
           api_total INTEGER NOT NULL,
           returned_lots INTEGER NOT NULL,
           complete INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS collections_market_time ON market_collections(item_id, region, collected_timestamp DESC);
         CREATE TABLE IF NOT EXISTS tracked_lots (
           lot_key TEXT PRIMARY KEY,
           item_id TEXT NOT NULL,
           region TEXT NOT NULL,
           first_seen_at TEXT NOT NULL,
           first_seen_timestamp INTEGER NOT NULL,
           last_seen_at TEXT NOT NULL,
           last_seen_timestamp INTEGER NOT NULL,
           missing_since_at TEXT,
           missing_since_timestamp INTEGER,
           status TEXT NOT NULL,
           observation_count INTEGER NOT NULL,
           amount INTEGER NOT NULL,
           start_price INTEGER,
           current_price INTEGER,
           buyout_price INTEGER,
           start_time TEXT,
           end_time TEXT,
           end_timestamp INTEGER,
           quality_code INTEGER,
           upgrade INTEGER,
           raw_json TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS tracked_lots_market_status ON tracked_lots(item_id, region, status, last_seen_timestamp DESC);
         CREATE TABLE IF NOT EXISTS lot_observations (
           collection_id INTEGER NOT NULL,
           lot_key TEXT NOT NULL,
           item_id TEXT NOT NULL,
           region TEXT NOT NULL,
           amount INTEGER NOT NULL,
           start_price INTEGER,
           current_price INTEGER,
           buyout_price INTEGER,
           raw_json TEXT NOT NULL,
           PRIMARY KEY (collection_id, lot_key),
           FOREIGN KEY (collection_id) REFERENCES market_collections(id) ON DELETE CASCADE
         );
         CREATE INDEX IF NOT EXISTS observations_market ON lot_observations(item_id, region, collection_id);
         CREATE TABLE IF NOT EXISTS cache_sync_state (
           item_id TEXT NOT NULL,
           region TEXT NOT NULL,
           last_history_sync INTEGER NOT NULL,
           PRIMARY KEY (item_id, region)
         );
         CREATE TABLE IF NOT EXISTS lot_sale_matches (
           lot_key TEXT PRIMARY KEY,
           sale_fingerprint TEXT NOT NULL UNIQUE,
           confidence REAL NOT NULL,
           matched_at TEXT NOT NULL,
           matched_timestamp INTEGER NOT NULL,
           price_delta_percent REAL,
           time_delta_seconds INTEGER,
           FOREIGN KEY (lot_key) REFERENCES tracked_lots(lot_key),
           FOREIGN KEY (sale_fingerprint) REFERENCES sales(fingerprint)
         );
         CREATE INDEX IF NOT EXISTS sale_matches_time ON lot_sale_matches(matched_timestamp DESC);"
    ).map_err(|error| format!("Не удалось подготовить локальную базу: {error}"))?;
    ensure_column(connection, "sales", "source", "TEXT NOT NULL DEFAULT 'stalzone_api'")?;
    ensure_column(connection, "sales", "source_id", "TEXT")?;
    connection.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS sales_source_identity ON sales(source, source_id) WHERE source_id IS NOT NULL",
        [],
    ).map_err(|error| format!("Не удалось подготовить индекс источников продаж: {error}"))?;
    Ok(())
}

fn ensure_column(connection: &Connection, table: &str, column: &str, definition: &str) -> Result<(), String> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})")).map_err(|error| error.to_string())?;
    let columns: Vec<String> = statement.query_map([], |row| row.get(1)).map_err(|error| error.to_string())?
        .filter_map(Result::ok).collect();
    if !columns.iter().any(|name| name == column) {
        connection.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"), [])
            .map_err(|error| format!("Не удалось добавить {table}.{column}: {error}"))?;
    }
    Ok(())
}

fn match_missing_lots_to_sales(item_id: &str, region: &str) -> Result<usize, String> {
    let mut connection = open_cache()?;
    match_missing_lots_to_sales_in(&mut connection, item_id, region, chrono::Utc::now())
}

fn match_missing_lots_to_sales_in(
    connection: &mut Connection,
    item_id: &str,
    region: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<usize, String> {
    type MissingLot = (String, i64, i64, i64, Option<i64>, Option<i64>, Option<i64>, Option<i64>);
    type SaleCandidate = (String, i64, i64, i64, Option<i64>, Option<i64>);
    let region = region.to_ascii_uppercase();
    let missing_lots: Vec<MissingLot> = {
        let mut statement = connection.prepare(
            "SELECT t.lot_key, t.last_seen_timestamp, t.missing_since_timestamp, t.amount,
                    t.buyout_price, t.current_price, t.quality_code, t.upgrade
             FROM tracked_lots t LEFT JOIN lot_sale_matches m ON m.lot_key = t.lot_key
             WHERE t.item_id = ?1 AND t.region = ?2 AND t.status = 'missing'
               AND t.missing_since_timestamp IS NOT NULL AND m.lot_key IS NULL
             ORDER BY t.missing_since_timestamp"
        ).map_err(|error| error.to_string())?;
        let rows = statement.query_map(params![item_id, &region], |row| Ok((
            row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?,
            row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?
        ))).map_err(|error| error.to_string())?;
        rows.filter_map(Result::ok).collect()
    };
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    let mut matched = 0;
    for (lot_key, last_seen, missing_since, lot_amount, buyout, current, quality, upgrade) in missing_lots {
        let candidates: Vec<SaleCandidate> = {
            let mut statement = transaction.prepare(
                "SELECT s.fingerprint, s.sold_timestamp, s.amount, s.price, s.quality_code, s.upgrade
                 FROM sales s LEFT JOIN lot_sale_matches m ON m.sale_fingerprint = s.fingerprint
                 WHERE s.item_id = ?1 AND s.region = ?2 AND s.sold_timestamp BETWEEN ?3 AND ?4
                   AND s.amount = ?5 AND m.sale_fingerprint IS NULL"
            ).map_err(|error| error.to_string())?;
            let rows = statement.query_map(
                params![item_id, &region, last_seen - 60, missing_since + 120, lot_amount],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?))
            ).map_err(|error| error.to_string())?;
            rows.filter_map(Result::ok).collect()
        };
        let mut scored: Vec<(f64, i64, f64, String)> = candidates.into_iter().filter_map(
            |(fingerprint, sold_at, _, sale_price, sale_quality, sale_upgrade)| {
                if quality.is_some() && quality != sale_quality { return None; }
                if upgrade.is_some() && upgrade != sale_upgrade { return None; }
                let reference = buyout.filter(|price| *price > 0).or(current.filter(|price| *price > 0))?;
                let price_delta = (sale_price - reference).abs() as f64 / reference as f64 * 100.0;
                let mut confidence: f64 = if sale_price == reference { 0.90 } else if price_delta <= 1.0 { 0.84 } else if price_delta <= 5.0 { 0.72 } else { return None };
                if quality.is_some() && quality == sale_quality { confidence += 0.04; }
                if upgrade.is_some() && upgrade == sale_upgrade { confidence += 0.04; }
                let time_delta = (sold_at - missing_since).abs();
                if time_delta <= 60 { confidence += 0.02; }
                Some((confidence.min(0.99), time_delta, price_delta, fingerprint))
            }
        ).collect();
        scored.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
        let Some((mut confidence, time_delta, price_delta, fingerprint)) = scored.first().cloned() else { continue };
        if scored.get(1).is_some_and(|second| (confidence - second.0).abs() < 0.02) { confidence -= 0.08; }
        if confidence < 0.75 { continue; }
        transaction.execute(
            "INSERT OR IGNORE INTO lot_sale_matches
             (lot_key, sale_fingerprint, confidence, matched_at, matched_timestamp, price_delta_percent, time_delta_seconds)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![&lot_key, &fingerprint, confidence, now.to_rfc3339(), now.timestamp(), price_delta, time_delta]
        ).map_err(|error| error.to_string())?;
        transaction.execute(
            "UPDATE tracked_lots SET status = 'probable_sold' WHERE lot_key = ?1 AND status = 'missing'",
            params![&lot_key]
        ).map_err(|error| error.to_string())?;
        matched += 1;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(matched)
}

fn reconcile_all_sale_matches() -> Result<usize, String> {
    let connection = open_cache()?;
    let markets: Vec<(String, String)> = {
        let mut statement = connection.prepare(
            "SELECT DISTINCT item_id, region FROM tracked_lots WHERE status = 'missing'"
        ).map_err(|error| error.to_string())?;
        let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|error| error.to_string())?;
        rows.filter_map(Result::ok).collect()
    };
    drop(connection);
    let mut matched = 0;
    for (item_id, region) in markets {
        matched += match_missing_lots_to_sales(&item_id, &region)?;
    }
    Ok(matched)
}

fn save_history_rows(item_id: &str, region: &str, rows: &[Value]) -> Result<usize, String> {
    let region = region.to_ascii_uppercase();
    let mut connection = open_cache()?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    let mut inserted = 0;
    let mut occurrences: HashMap<String, usize> = HashMap::new();
    {
        let mut delete_external = transaction.prepare(
            "DELETE FROM sales WHERE fingerprint = (
               SELECT fingerprint FROM sales WHERE source = 'schistory' AND item_id = ?1 AND region = ?2
                 AND sold_timestamp = ?3 AND amount = ?4 AND price = ?5
                 AND quality_code IS ?6 AND upgrade IS ?7 LIMIT 1
             )"
        ).map_err(|error| error.to_string())?;
        let mut statement = transaction.prepare(
            "INSERT OR IGNORE INTO sales
             (fingerprint, item_id, region, sold_at, sold_timestamp, amount, price, quality_code, upgrade, raw_json, source, source_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'stalzone_api', NULL)"
        ).map_err(|error| error.to_string())?;
        for row in rows {
            let Some(time) = row.get("time").and_then(Value::as_str) else { continue };
            let Some(timestamp) = chrono::DateTime::parse_from_rfc3339(time).ok().map(|value| value.timestamp()) else { continue };
            let Some(row_price) = price(row, "price").filter(|value| *value > 0) else { continue };
            let raw = serde_json::to_string(row).map_err(|error| error.to_string())?;
            let quality_code = lot_quality_code(row);
            let upgrade = lot_upgrade(row);
            delete_external.execute(params![item_id, &region, timestamp, amount(row), row_price, quality_code, upgrade])
                .map_err(|error| error.to_string())?;
            let base = format!("{:x}", Sha256::digest(format!("{region}|{item_id}|{raw}").as_bytes()));
            let occurrence = occurrences.entry(base.clone()).or_default();
            let fingerprint = if *occurrence == 0 { base } else { format!("{base}#{}", *occurrence) };
            *occurrence += 1;
            inserted += statement.execute(params![
                fingerprint, item_id, &region, time, timestamp, amount(row), row_price,
                quality_code, upgrade, raw
            ]).map_err(|error| error.to_string())?;
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;
    match_missing_lots_to_sales(item_id, &region)?;
    Ok(inserted)
}

#[tauri::command]
async fn import_schistory_history(
    item_id: String,
    region: String,
    quality_codes: Vec<i64>,
    min_upgrade: Option<i64>,
    max_upgrade: Option<i64>,
) -> Result<SchistoryImportResponse, String> {
    let item_id = item_id.trim().to_string();
    let region = region.to_ascii_uppercase();
    if item_id.is_empty() { return Err("Не выбран предмет".into()); }
    if !matches!(region.as_str(), "RU" | "EU") { return Err("SCHistory поддерживает импорт только для RU и EU".into()); }
    if quality_codes.is_empty() { return Err("Выберите хотя бы одну редкость для импорта".into()); }
    if quality_codes.iter().any(|code| !(0..=5).contains(code)) { return Err("Неизвестная редкость артефакта".into()); }
    market_filters(&[], min_upgrade, max_upgrade, None, None)?;

    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(90)).build()
        .map_err(|error| format!("Не удалось создать клиент SCHistory: {error}"))?;
    let catalog = client.get(format!("{SCHISTORY_BASE}/items?type=artifact,random_item&historyNeeded=true"))
        .header(USER_AGENT, "STALZONE-Auction-Watcher/0.1")
        .send().await.map_err(|error| format!("SCHistory: ошибка каталога: {error}"))?;
    if !catalog.status().is_success() { return Err(format!("SCHistory: каталог вернул HTTP {}", catalog.status())); }
    let items: Vec<SchistoryItem> = catalog.json().await.map_err(|error| format!("SCHistory: некорректный каталог: {error}"))?;
    let external_item_id = items.iter().find(|item| item.external_id.eq_ignore_ascii_case(&item_id))
        .map(|item| item.id).ok_or_else(|| format!("SCHistory не содержит предмет {item_id}"))?;

    let mut unique_qualities = quality_codes;
    unique_qualities.sort_unstable();
    unique_qualities.dedup();
    let mut fetched_sales = 0;
    let mut matching = Vec::new();
    for quality in unique_qualities {
        let url = format!("{SCHISTORY_BASE}/search/sales-history?itemId={external_item_id}&region={}&qlt={quality}", region.to_ascii_lowercase());
        let response = client.get(url).header(USER_AGENT, "STALZONE-Auction-Watcher/0.1").send().await
            .map_err(|error| format!("SCHistory: ошибка загрузки редкости {quality}: {error}"))?;
        if !response.status().is_success() { return Err(format!("SCHistory: история редкости {quality} вернула HTTP {}", response.status())); }
        let rows: Vec<SchistorySale> = response.json().await
            .map_err(|error| format!("SCHistory: некорректная история редкости {quality}: {error}"))?;
        fetched_sales += rows.len();
        matching.extend(rows.into_iter().filter(|sale| {
            sale.item_id == external_item_id
                && sale.region.eq_ignore_ascii_case(&region)
                && sale.qlt == Some(quality)
                && sale.price > 0
                && min_upgrade.is_none_or(|min| sale.ptn.is_some_and(|upgrade| upgrade >= min))
                && max_upgrade.is_none_or(|max| sale.ptn.is_some_and(|upgrade| upgrade <= max))
        }));
    }
    save_schistory_sales(&item_id, &region, external_item_id, fetched_sales, matching)
}

fn save_schistory_sales(
    item_id: &str,
    region: &str,
    external_item_id: i64,
    fetched_sales: usize,
    rows: Vec<SchistorySale>,
) -> Result<SchistoryImportResponse, String> {
    let mut connection = open_cache()?;
    save_schistory_sales_to(&mut connection, item_id, region, external_item_id, fetched_sales, rows)
}

fn save_schistory_sales_to(
    connection: &mut Connection,
    item_id: &str,
    region: &str,
    external_item_id: i64,
    fetched_sales: usize,
    rows: Vec<SchistorySale>,
) -> Result<SchistoryImportResponse, String> {
    type SaleIdentity = (i64, i64, i64, i64, i64);
    let official_counts: HashMap<SaleIdentity, usize> = {
        let mut statement = connection.prepare(
            "SELECT sold_timestamp, amount, price, COALESCE(quality_code, -1), COALESCE(upgrade, -1), COUNT(*)
             FROM sales WHERE item_id = ?1 AND region = ?2 AND source = 'stalzone_api'
             GROUP BY sold_timestamp, amount, price, quality_code, upgrade"
        ).map_err(|error| error.to_string())?;
        let values = statement.query_map(params![item_id, region], |row| Ok(((
            row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?
        ), row.get::<_, i64>(5)? as usize))).map_err(|error| error.to_string())?;
        values.filter_map(Result::ok).collect()
    };
    let existing_source_ids: HashSet<String> = {
        let mut statement = connection.prepare(
            "SELECT source_id FROM sales WHERE source = 'schistory' AND source_id IS NOT NULL"
        ).map_err(|error| error.to_string())?;
        let values = statement.query_map([], |row| row.get(0)).map_err(|error| error.to_string())?;
        values.filter_map(Result::ok).collect()
    };
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    let mut statement = transaction.prepare(
        "INSERT OR IGNORE INTO sales
         (fingerprint, item_id, region, sold_at, sold_timestamp, amount, price, quality_code, upgrade, raw_json, source, source_id)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8, ?9, 'schistory', ?10)"
    ).map_err(|error| error.to_string())?;
    let mut occurrences: HashMap<SaleIdentity, usize> = HashMap::new();
    let mut inserted_sales = 0;
    let mut skipped_existing = 0;
    let mut oldest_sale: Option<String> = None;
    let mut newest_sale: Option<String> = None;
    for sale in &rows {
        let Some(timestamp) = chrono::DateTime::parse_from_rfc3339(&sale.sold_at).ok().map(|value| value.timestamp()) else { continue };
        let source_id = format!("{}:{}", region.to_ascii_lowercase(), sale.id);
        let identity = (timestamp, 1, sale.price, sale.qlt.unwrap_or(-1), sale.ptn.unwrap_or(-1));
        let occurrence = occurrences.entry(identity).or_default();
        let covered_by_official = *occurrence < official_counts.get(&identity).copied().unwrap_or_default();
        *occurrence += 1;
        if existing_source_ids.contains(&source_id) || covered_by_official {
            skipped_existing += 1;
            continue;
        }
        let raw = json!({
            "time": sale.sold_at, "price": sale.price, "amount": 1,
            "additional": { "qlt": sale.qlt, "ptn": sale.ptn },
            "_source": "schistory", "_sourceId": sale.id, "_externalItemId": external_item_id
        });
        let fingerprint = format!("schistory:{source_id}");
        inserted_sales += statement.execute(params![
            fingerprint, item_id, region, &sale.sold_at, timestamp, sale.price,
            sale.qlt, sale.ptn, raw.to_string(), source_id
        ]).map_err(|error| error.to_string())?;
        if oldest_sale.as_ref().is_none_or(|value| sale.sold_at.as_str() < value.as_str()) { oldest_sale = Some(sale.sold_at.clone()); }
        if newest_sale.as_ref().is_none_or(|value| sale.sold_at.as_str() > value.as_str()) { newest_sale = Some(sale.sold_at.clone()); }
    }
    drop(statement);
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(SchistoryImportResponse {
        external_item_id,
        fetched_sales,
        matching_sales: rows.len(),
        inserted_sales,
        skipped_existing,
        oldest_sale,
        newest_sale,
    })
}

fn load_cached_history(item_id: &str, region: &str, days: i64, limit: usize) -> Result<Vec<Value>, String> {
    let region = region.to_ascii_uppercase();
    let connection = open_cache()?;
    load_cached_history_from(&connection, item_id, &region, days, limit, chrono::Utc::now())
}

fn load_cached_history_from(
    connection: &Connection,
    item_id: &str,
    region: &str,
    days: i64,
    limit: usize,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<Vec<Value>, String> {
    let cutoff = now.timestamp() - days.max(1) * 86_400;
    let mut statement = connection.prepare(
        "SELECT raw_json FROM sales WHERE item_id = ?1 AND region = ?2 AND sold_timestamp >= ?3
         ORDER BY sold_timestamp DESC LIMIT ?4"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![item_id, region.to_ascii_uppercase(), cutoff, limit as i64], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    Ok(rows.filter_map(Result::ok).filter_map(|raw| serde_json::from_str(&raw).ok()).collect())
}

fn load_all_cached_history(item_id: &str, region: &str, limit: usize) -> Result<(u64, Vec<Value>), String> {
    let region = region.to_ascii_uppercase();
    let connection = open_cache()?;
    let total = connection.query_row(
        "SELECT COUNT(*) FROM sales WHERE item_id = ?1 AND region = ?2",
        params![item_id, &region], |row| row.get::<_, u64>(0)
    ).map_err(|error| error.to_string())?;
    let mut statement = connection.prepare(
        "SELECT raw_json FROM sales WHERE item_id = ?1 AND region = ?2
         ORDER BY sold_timestamp DESC LIMIT ?3"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![item_id, &region, limit.clamp(5, 20_000) as i64], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let values = rows.filter_map(Result::ok).filter_map(|raw| serde_json::from_str(&raw).ok()).collect();
    Ok((total, values))
}

fn cached_oldest_timestamp(item_id: &str, region: &str) -> Result<Option<i64>, String> {
    let region = region.to_ascii_uppercase();
    let connection = open_cache()?;
    connection.query_row(
        "SELECT MIN(sold_timestamp) FROM sales WHERE item_id = ?1 AND region = ?2",
        params![item_id, region], |row| row.get(0)
    ).map_err(|error| error.to_string())
}

#[tauri::command]
fn cache_status() -> Result<CacheStatus, String> {
    let path = workspace_file(CACHE_FILE);
    let connection = open_cache()?;
    let sales = connection.query_row("SELECT COUNT(*) FROM sales", [], |row| row.get::<_, u64>(0)).unwrap_or_default();
    let snapshots = connection.query_row("SELECT COUNT(*) FROM market_snapshots", [], |row| row.get::<_, u64>(0)).unwrap_or_default();
    let items = connection.query_row("SELECT COUNT(DISTINCT item_id || '|' || region) FROM sales", [], |row| row.get::<_, u64>(0)).unwrap_or_default();
    let collections = connection.query_row("SELECT COUNT(*) FROM market_collections", [], |row| row.get::<_, u64>(0)).unwrap_or_default();
    let lot_observations = connection.query_row("SELECT COUNT(*) FROM lot_observations", [], |row| row.get::<_, u64>(0)).unwrap_or_default();
    let tracked_lots = connection.query_row("SELECT COUNT(*) FROM tracked_lots", [], |row| row.get::<_, u64>(0)).unwrap_or_default();
    let active_lots = connection.query_row("SELECT COUNT(*) FROM tracked_lots WHERE status = 'active'", [], |row| row.get::<_, u64>(0)).unwrap_or_default();
    let tracked_markets = connection.query_row("SELECT COUNT(DISTINCT item_id || '|' || region) FROM market_collections", [], |row| row.get::<_, u64>(0)).unwrap_or_default();
    let last_collection = connection.query_row("SELECT MAX(collected_at) FROM market_collections", [], |row| row.get::<_, Option<String>>(0)).unwrap_or(None);
    let oldest_sale = connection.query_row("SELECT MIN(sold_at) FROM sales", [], |row| row.get::<_, Option<String>>(0)).unwrap_or(None);
    let newest_sale = connection.query_row("SELECT MAX(sold_at) FROM sales", [], |row| row.get::<_, Option<String>>(0)).unwrap_or(None);
    Ok(CacheStatus {
        sales, snapshots, items, collections, lot_observations, tracked_lots,
        active_lots, tracked_markets, last_collection, oldest_sale, newest_sale,
        size_bytes: fs::metadata(&path).map(|meta| meta.len()).unwrap_or_default(),
        path: path.display().to_string(),
    })
}

fn env_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    #[cfg(debug_assertions)]
    if let Some(project_root) = Path::new(env!("CARGO_MANIFEST_DIR")).parent() {
        paths.push(project_root.join(".env"));
    }
    if let Ok(cwd) = env::current_dir() {
        paths.push(cwd.join(".env"));
        if let Some(parent) = cwd.parent() {
            paths.push(parent.join(".env"));
        }
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            paths.push(parent.join(".env"));
        }
    }
    paths.into_iter().fold(Vec::new(), |mut unique, path| {
        if !unique.contains(&path) { unique.push(path); }
        unique
    })
}

fn reload_env() -> Option<PathBuf> {
    for path in env_candidates() {
        if path.exists() && dotenvy::from_path_override(&path).is_ok() {
            return Some(path);
        }
    }
    None
}

fn placeholder(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();
    value.is_empty()
        || value.starts_with("your_")
        || matches!(value.as_str(), "client_id" | "client_secret" | "id" | "secret")
}

fn api_headers() -> Result<HeaderMap, String> {
    reload_env();
    let id = env::var("STALZONE_CLIENT_ID").unwrap_or_default();
    let secret = env::var("STALZONE_CLIENT_SECRET").unwrap_or_default();
    if placeholder(&id) || placeholder(&secret) {
        return Err("В .env не заданы STALZONE_CLIENT_ID и STALZONE_CLIENT_SECRET".into());
    }
    let mut headers = HeaderMap::new();
    headers.insert(
        HeaderName::from_static("client-id"),
        HeaderValue::from_str(&id).map_err(|_| "Некорректный Client ID")?,
    );
    headers.insert(
        HeaderName::from_static("client-secret"),
        HeaderValue::from_str(&secret).map_err(|_| "Некорректный Client Secret")?,
    );
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert(USER_AGENT, HeaderValue::from_static("ArtefactOptimizerTauri/0.1"));
    Ok(headers)
}

fn translated(value: Option<&Value>, lang: &str) -> String {
    let Some(value) = value else { return String::new() };
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    value.pointer(&format!("/lines/{lang}"))
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/lines/en").and_then(Value::as_str))
        .or_else(|| value.get("text").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string()
}

#[tauri::command]
fn credentials_status() -> EnvStatus {
    let source = reload_env();
    let id = env::var("STALZONE_CLIENT_ID").unwrap_or_default();
    let secret = env::var("STALZONE_CLIENT_SECRET").unwrap_or_default();
    let ready = !placeholder(&id) && !placeholder(&secret);
    EnvStatus {
        ready,
        source: source.map(|path| path.display().to_string()),
        message: if ready { "API-ключи загружены" } else { "Заполните API-ключи в .env" }.into(),
    }
}

#[tauri::command]
async fn load_catalog(realm: String) -> Result<Vec<CatalogItem>, String> {
    let realm = realm.to_ascii_lowercase();
    if !matches!(realm.as_str(), "global" | "ru") { return Err("Неизвестный realm".into()); }
    let url = format!("{ITEMS_BASE}/{realm}/listing.json");
    let response = reqwest::Client::new().get(&url).header(USER_AGENT, "ArtefactOptimizerTauri/0.1").send().await
        .map_err(|error| format!("Не удалось загрузить каталог EXBO: {error}"))?;
    let status = response.status();
    if !status.is_success() { return Err(format!("Каталог EXBO вернул HTTP {}", status.as_u16())); }
    let raw = response.text().await.map_err(|error| format!("Не удалось прочитать каталог EXBO: {error}"))?;
    let rows: Vec<Value> = serde_json::from_str(&raw).map_err(|error| format!("Некорректный удалённый listing.json: {error}"))?;
    Ok(rows.into_iter().filter_map(|row| {
        let data = row.get("data")?.as_str().unwrap_or_default();
        let id = Path::new(data).file_stem()?.to_string_lossy().to_string();
        let parts: Vec<&str> = data.split('/').filter(|part| !part.is_empty()).collect();
        let icon_path = row.get("icon").and_then(Value::as_str).filter(|v| !v.is_empty())
            .map(|icon| format!("{ITEMS_BASE}/{realm}/{}", icon.trim_start_matches('/')));
        Some(CatalogItem {
            id,
            name_ru: translated(row.get("name"), "ru"),
            name_en: translated(row.get("name"), "en"),
            category: parts.get(1).copied().or_else(|| row.get("category").and_then(Value::as_str)).unwrap_or_default().into(),
            subcategory: if parts.len() > 3 { parts[2].into() } else { String::new() },
            color: row.get("color").and_then(Value::as_str).unwrap_or_default().into(),
            icon_path,
        })
    }).collect())
}

#[tauri::command]
async fn read_image(path: String) -> Result<String, String> {
    if !path.starts_with(&format!("{ITEMS_BASE}/")) { return Err("Недопустимый источник изображения".into()); }
    let response = reqwest::Client::new().get(&path).header(USER_AGENT, "ArtefactOptimizerTauri/0.1").send().await
        .map_err(|error| format!("Не удалось загрузить изображение EXBO: {error}"))?;
    let status = response.status();
    if !status.is_success() { return Err(format!("Изображение EXBO вернуло HTTP {}", status.as_u16())); }
    let bytes = response.bytes().await.map_err(|error| format!("Не удалось прочитать изображение EXBO: {error}"))?;
    let mime = match Path::new(&path).extension().and_then(|v| v.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "webp" => "image/webp", "gif" => "image/gif", _ => "application/octet-stream",
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

fn parse_i64(value: Option<&Value>) -> Option<i64> {
    value.and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.replace([' ', '_'], "").parse().ok())))
}

fn parse_level(value: &Value) -> Option<i64> {
    if let Some(number) = value.as_i64() { return Some(number); }
    let text = value.as_str()?.trim().to_ascii_lowercase();
    match text.as_str() {
        "i" => Some(1), "ii" => Some(2), "iii" => Some(3), "iv" => Some(4), "v" => Some(5), "vi" => Some(6),
        _ => {
            let digits: String = text.chars().filter(char::is_ascii_digit).collect();
            digits.parse().ok()
        }
    }
}

fn nested_level(value: &Value, aliases: &[&str]) -> Option<i64> {
    match value {
        Value::Object(map) => map.iter().find_map(|(key, child)| {
            if aliases.iter().any(|alias| key.eq_ignore_ascii_case(alias)) {
                parse_level(child).or_else(|| nested_level(child, aliases))
            } else {
                nested_level(child, aliases)
            }
        }),
        Value::Array(items) => items.iter().find_map(|item| nested_level(item, aliases)),
        _ => None,
    }
}

fn lot_quality_code(lot: &Value) -> Option<i64> {
    nested_level(lot, &["qlt", "quality", "qualitylevel", "tier", "artifacttier", "artefacttier", "grade", "q"])
}

fn quality_name(code: i64) -> Option<&'static str> {
    match code {
        0 => Some("common"), 1 => Some("uncommon"), 2 => Some("special"),
        3 => Some("rare"), 4 => Some("exceptional"), 5 => Some("legendary"),
        _ => None,
    }
}

fn quality_code(name: &str) -> Option<i64> {
    match name.to_ascii_lowercase().as_str() {
        "common" => Some(0), "uncommon" => Some(1), "special" => Some(2),
        "rare" => Some(3), "exceptional" => Some(4), "legendary" => Some(5),
        _ => None,
    }
}

fn quality_label(code: i64) -> Option<&'static str> {
    match code {
        0 => Some("Обычный"), 1 => Some("Необычный"), 2 => Some("Особый"),
        3 => Some("Редкий"), 4 => Some("Исключительный"), 5 => Some("Легендарный"),
        _ => None,
    }
}

fn lot_upgrade(lot: &Value) -> Option<i64> {
    nested_level(lot, &["upgrade", "upgradelevel", "enhancement", "enhancementlevel", "level", "potential", "potentiallevel", "ptn"])
}

fn amount(lot: &Value) -> i64 { parse_i64(lot.get("amount")).unwrap_or(0) }

fn amount_band(value: i64) -> (i64, i64, &'static str) {
    match value {
        ..=1 => (1, 1, "1 шт."),
        2..=4 => (2, 4, "2–4 шт."),
        5..=9 => (5, 9, "5–9 шт."),
        10..=19 => (10, 19, "10–19 шт."),
        20..=49 => (20, 49, "20–49 шт."),
        _ => (50, i64::MAX, "50+ шт."),
    }
}

fn amount_in_band(value: i64, min: i64, max: i64) -> bool {
    value >= min && value <= max
}
fn infer_stackability(amounts: &[i64]) -> (String, usize, i64) {
    let stack_evidence = amounts.iter().filter(|amount| **amount > 1).count();
    let max_observed_amount = amounts.iter().copied().max().unwrap_or(1);
    let kind = if stack_evidence > 0 { "stackable" } else if amounts.len() >= 20 { "single" } else { "unknown" };
    (kind.into(), stack_evidence, max_observed_amount)
}
fn price(lot: &Value, key: &str) -> Option<i64> { parse_i64(lot.get(key)) }
fn unit_price(lot: &Value, key: &str) -> Option<f64> {
    let count = amount(lot);
    let total = price(lot, key)?;
    (count > 0 && total > 0).then_some(total as f64 / count as f64)
}

fn variant_matches(rule: &WatchRule, lot: &Value) -> bool {
    let count = amount(lot);
    if rule.min_amount.is_some_and(|min| count < min) { return false; }
    if rule.max_amount.is_some_and(|max| count > max) { return false; }
    if !rule.artifact_qualities.is_empty() {
        let Some(code) = lot_quality_code(lot) else { return false };
        let Some(name) = quality_name(code) else { return false };
        if !rule.artifact_qualities.iter().any(|selected| selected.eq_ignore_ascii_case(name)) { return false; }
    } else if rule.min_tier.is_some() || rule.max_tier.is_some() {
        let Some(quality) = lot_quality_code(lot) else { return false };
        let legacy_level = quality + 1;
        if rule.min_tier.is_some_and(|min| legacy_level < min) || rule.max_tier.is_some_and(|max| legacy_level > max) { return false; }
    }
    if rule.min_upgrade.is_some() || rule.max_upgrade.is_some() {
        let Some(upgrade) = lot_upgrade(lot) else { return false };
        if rule.min_upgrade.is_some_and(|min| upgrade < min) || rule.max_upgrade.is_some_and(|max| upgrade > max) { return false; }
    }
    true
}

fn median(values: &[f64]) -> Option<f64> {
    if values.is_empty() { return None; }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let middle = sorted.len() / 2;
    Some(if sorted.len() % 2 == 1 { sorted[middle] } else { (sorted[middle - 1] + sorted[middle]) / 2.0 })
}

fn percentile(values: &[f64], percentile: f64) -> Option<f64> {
    if values.is_empty() { return None; }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let position = percentile.clamp(0.0, 1.0) * (sorted.len() - 1) as f64;
    let lower = position.floor() as usize;
    let upper = position.ceil() as usize;
    if lower == upper { return Some(sorted[lower]); }
    let weight = position - lower as f64;
    Some(sorted[lower] * (1.0 - weight) + sorted[upper] * weight)
}

#[derive(Default)]
struct AdaptiveMarketPrice {
    fair_value: Option<f64>,
    recent_median: Option<f64>,
    recent_p25: Option<f64>,
    recent_p75: Option<f64>,
    recent_sample: usize,
    latest_sale: Option<f64>,
    latest_sale_at: Option<String>,
    trend_percent: Option<f64>,
    volatility_percent: Option<f64>,
}

fn adaptive_market_price(timed_prices: &[(i64, f64)], history_median: Option<f64>) -> AdaptiveMarketPrice {
    let Some((latest_timestamp, latest_price)) = timed_prices.first().copied() else { return AdaptiveMarketPrice::default() };
    let recent: Vec<f64> = timed_prices.iter()
        .take_while(|(timestamp, _)| latest_timestamp - *timestamp <= 86_400)
        .map(|(_, price)| *price).collect();
    let previous: Vec<f64> = timed_prices.iter()
        .filter(|(timestamp, _)| latest_timestamp - *timestamp > 86_400 && latest_timestamp - *timestamp <= 172_800)
        .map(|(_, price)| *price).collect();
    let recent_median = median(&recent);
    let recency_weight = match recent.len() { 8.. => 1.0, 5..=7 => 0.85, 3..=4 => 0.65, 1..=2 => 0.35, _ => 0.0 };
    let fair_value = recent_median.zip(history_median)
        .map(|(recent_value, history_value)| recent_value * recency_weight + history_value * (1.0 - recency_weight))
        .or(recent_median).or(history_median);
    let recent_p25 = percentile(&recent, 0.25);
    let recent_p75 = percentile(&recent, 0.75);
    let volatility_percent = recent_p25.zip(recent_p75).zip(recent_median)
        .and_then(|((low, high), center)| (center > 0.0).then_some((high - low) / center * 100.0));
    let trend_percent = if recent.len() >= 3 && previous.len() >= 3 {
        recent_median.zip(median(&previous))
            .and_then(|(current, prior)| (prior > 0.0).then_some((current - prior) / prior * 100.0))
    } else {
        let middle = timed_prices.len() / 2;
        let newest: Vec<f64> = timed_prices.iter().take(middle.max(1)).map(|(_, price)| *price).collect();
        let older: Vec<f64> = timed_prices.iter().skip(middle.max(1)).map(|(_, price)| *price).collect();
        median(&newest).zip(median(&older))
            .and_then(|(current, prior)| (prior > 0.0).then_some((current - prior) / prior * 100.0))
    };
    AdaptiveMarketPrice {
        fair_value,
        recent_median,
        recent_p25,
        recent_p75,
        recent_sample: recent.len(),
        latest_sale: Some(latest_price),
        latest_sale_at: chrono::DateTime::from_timestamp(latest_timestamp, 0).map(|value| value.to_rfc3339()),
        trend_percent,
        volatility_percent,
    }
}

fn save_market_snapshot(rule: &WatchRule, lots: &[Value], matching_lots: usize) -> Result<(), String> {
    let connection = open_cache()?;
    save_market_snapshot_to(&connection, rule, lots, matching_lots, chrono::Utc::now())
}

fn save_market_snapshot_to(
    connection: &Connection,
    rule: &WatchRule,
    lots: &[Value],
    matching_lots: usize,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<(), String> {
    let comparable: Vec<&Value> = lots.iter().filter(|lot| variant_matches(rule, lot)).collect();
    let mut units: Vec<f64> = comparable.iter().filter_map(|lot| unit_price(lot, "buyoutPrice")).collect();
    units.sort_by(f64::total_cmp);
    let region = rule.region.to_ascii_uppercase();
    let previous: Option<i64> = connection.query_row(
        "SELECT MAX(captured_timestamp) FROM market_snapshots WHERE item_id = ?1 AND region = ?2",
        params![rule.item_id, &region], |row| row.get(0)
    ).unwrap_or(None);
    if previous.is_some_and(|timestamp| now.timestamp() - timestamp < 30) { return Ok(()); }
    connection.execute(
        "INSERT INTO market_snapshots
         (captured_at, captured_timestamp, item_id, region, active_lots, buyout_lots, matching_lots, total_amount, min_unit, second_min_unit, median_unit)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            now.to_rfc3339(), now.timestamp(), rule.item_id, &region,
            comparable.len() as i64, units.len() as i64, matching_lots as i64,
            comparable.iter().map(|lot| amount(lot)).sum::<i64>(),
            units.first().copied(), units.get(1).copied(), median(&units)
        ]
    ).map_err(|error| format!("Не удалось сохранить снимок рынка: {error}"))?;
    Ok(())
}

async fn request_history_page(rule: &WatchRule, limit: usize, offset: usize) -> Result<(u64, Vec<Value>), String> {
    let headers = api_headers()?;
    let url = format!("{API_BASE}/{}/auction/{}/history?limit={}&offset={offset}&additional={}",
        rule.region.to_ascii_uppercase(), urlencoding::encode(&rule.item_id), limit.clamp(5, 200), rule.additional);
    let response = reqwest::Client::new().get(&url).headers(headers).send().await
        .map_err(|error| format!("Ошибка сети: {error}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        let hint = if status.as_u16() == 401 { " Проверьте Client ID и Client Secret в .env." } else { "" };
        return Err(format!("HTTP {}: {}{}", status.as_u16(), body, hint));
    }
    let payload: Value = serde_json::from_str(&body).map_err(|error| format!("API вернул некорректный JSON: {error}"))?;
    Ok((payload.get("total").and_then(Value::as_u64).unwrap_or_default(),
        payload.get("prices").and_then(Value::as_array).cloned().unwrap_or_default()))
}

async fn sync_history_for_rule(rule: &WatchRule) -> Result<(usize, usize), String> {
    let existing_oldest = cached_oldest_timestamp(&rule.item_id, &rule.region)?;
    let cutoff = chrono::Utc::now().timestamp() - 30 * 86_400;
    let initial_pages = if existing_oldest.is_some() { 10 } else { 5 };
    let mut inserted = 0;
    let mut fetched_pages = 0;
    let mut reached_existing_on: Option<usize> = None;
    for page in 0..initial_pages {
        let offset = page * 200;
        let (total, rows) = request_history_page(rule, 200, offset).await?;
        fetched_pages += 1;
        if rows.is_empty() { break; }
        inserted += save_history_rows(&rule.item_id, &rule.region, &rows)?;
        let oldest_in_page = rows.iter().filter_map(|row| row.get("time").and_then(Value::as_str))
            .filter_map(|time| chrono::DateTime::parse_from_rfc3339(time).ok().map(|value| value.timestamp())).min();
        if let (Some(cached_oldest), Some(page_oldest)) = (existing_oldest, oldest_in_page) {
            if reached_existing_on.is_none() && page_oldest <= cached_oldest { reached_existing_on = Some(page); }
        }
        if reached_existing_on.is_some_and(|reached| page > reached) { break; }
        if oldest_in_page.is_some_and(|timestamp| timestamp <= cutoff) { break; }
        if offset + rows.len() >= total as usize { break; }
    }
    Ok((inserted, fetched_pages))
}

#[tauri::command]
async fn sync_market_cache(rules: Vec<WatchRule>) -> Result<CacheSyncResponse, String> {
    let mut inserted_sales = 0;
    let mut fetched_pages = 0;
    for rule in &rules {
        let (inserted, pages) = sync_history_for_rule(rule).await?;
        inserted_sales += inserted;
        fetched_pages += pages;
    }
    let status = cache_status()?;
    Ok(CacheSyncResponse { inserted_sales, cached_sales: status.sales, cached_items: status.items, fetched_pages })
}

async fn request_lots_page(rule: &WatchRule, limit: usize, offset: usize) -> Result<(u64, Vec<Value>), String> {
    let headers = api_headers()?;
    let limit = limit.clamp(5, 200);
    let url = format!("{API_BASE}/{}/auction/{}/lots?limit={limit}&offset={offset}&additional={}&sort={}&order={}",
        rule.region.to_ascii_uppercase(), urlencoding::encode(&rule.item_id), rule.additional,
        urlencoding::encode(&rule.sort), urlencoding::encode(&rule.order));
    let response = reqwest::Client::new().get(&url).headers(headers).send().await
        .map_err(|error| format!("Ошибка сети: {error}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        let hint = if status.as_u16() == 401 { " Проверьте Client ID и Client Secret в .env." } else { "" };
        return Err(format!("HTTP {}: {}{}", status.as_u16(), body, hint));
    }
    let payload: Value = serde_json::from_str(&body).map_err(|error| format!("API вернул некорректный JSON: {error}"))?;
    Ok((payload.get("total").and_then(Value::as_u64).unwrap_or_default(),
        payload.get("lots").and_then(Value::as_array).cloned().unwrap_or_default()))
}

fn response_rate_limit(headers: &HeaderMap) -> RateLimitState {
    let parse = |name: &str| headers.get(name).and_then(|value| value.to_str().ok()).and_then(|value| value.parse::<u64>().ok());
    RateLimitState {
        limit: parse("x-ratelimit-limit"),
        remaining: parse("x-ratelimit-remaining"),
        reset_at: parse("x-ratelimit-reset").and_then(|value| i64::try_from(value).ok()),
    }
}

async fn request_recent_lots(rule: &WatchRule) -> (Result<(u64, Vec<Value>), String>, RateLimitState) {
    let headers = match api_headers() {
        Ok(headers) => headers,
        Err(error) => return (Err(error), RateLimitState::default()),
    };
    let limit = rule.rapid_limit.clamp(1, 10);
    let url = format!("{API_BASE}/{}/auction/{}/lots?limit={limit}&offset=0&additional={}&sort=time_created&order=desc",
        rule.region.to_ascii_uppercase(), urlencoding::encode(&rule.item_id), rule.additional);
    let response = match reqwest::Client::new().get(&url).headers(headers).send().await {
        Ok(response) => response,
        Err(error) => return (Err(format!("Ошибка сети: {error}")), RateLimitState::default()),
    };
    let rate = response_rate_limit(response.headers());
    let status = response.status();
    let body = match response.text().await {
        Ok(body) => body,
        Err(error) => return (Err(error.to_string()), rate),
    };
    if !status.is_success() {
        return (Err(format!("HTTP {}: {}", status.as_u16(), body)), rate);
    }
    let payload: Value = match serde_json::from_str(&body) {
        Ok(payload) => payload,
        Err(error) => return (Err(format!("API вернул некорректный JSON: {error}")), rate),
    };
    (Ok((payload.get("total").and_then(Value::as_u64).unwrap_or_default(),
        payload.get("lots").and_then(Value::as_array).cloned().unwrap_or_default())), rate)
}

async fn request_lots_for_collection(rule: &WatchRule, cap: usize) -> Result<(u64, Vec<Value>, bool), String> {
    let cap = cap.clamp(200, 2_000);
    let mut rows = Vec::new();
    let mut total = 0;
    while rows.len() < cap {
        let remaining = cap - rows.len();
        let (page_total, page) = request_lots_page(rule, remaining.min(200), rows.len()).await?;
        total = page_total;
        if page.is_empty() { break; }
        rows.extend(page);
        if rows.len() >= total as usize { break; }
    }
    let complete = rows.len() >= total as usize;
    Ok((total, rows, complete))
}

async fn request_collection(rule: &WatchRule, history: bool) -> Result<Vec<Value>, String> {
    if history { return Ok(request_history_page(rule, rule.history_limit, 0).await?.1); }
    Ok(request_lots_page(rule, rule.limit, 0).await?.1)
}

#[tauri::command]
async fn analyze_market(rule: WatchRule) -> Result<MarketAnalysis, String> {
    let lots = request_collection(&rule, false).await?;
    let history = request_collection(&rule, true).await?;
    let comparable_lots: Vec<_> = lots.iter().filter(|lot| variant_matches(&rule, lot)).collect();
    let comparable_history: Vec<_> = history.iter().filter(|lot| variant_matches(&rule, lot)).collect();
    let current: Vec<f64> = comparable_lots.iter().filter_map(|lot| unit_price(lot, "buyoutPrice")).collect();
    let sold: Vec<f64> = comparable_history.iter().filter_map(|lot| unit_price(lot, "price")).collect();
    Ok(MarketAnalysis {
        lots: comparable_lots.len(), history: comparable_history.len(),
        current_min: current.iter().copied().min_by(f64::total_cmp),
        current_median: median(&current), history_median: median(&sold),
    })
}

fn history_response(total: u64, raw_rows: &[Value]) -> SalesHistoryResponse {
    let entries = raw_rows.iter().filter_map(|row| {
        let amount = amount(row);
        let price = price(row, "price")?;
        if amount <= 0 { return None; }
        let quality_code = lot_quality_code(row);
        Some(SalesHistoryEntry {
            amount, price, unit_price: price as f64 / amount as f64,
            time: row.get("time").and_then(Value::as_str).unwrap_or_default().into(),
            quality: quality_code.and_then(quality_label).map(str::to_string),
            quality_code, upgrade: lot_upgrade(row),
            source: row.get("_source").and_then(Value::as_str).unwrap_or("stalzone_api").into(),
        })
    }).collect();
    SalesHistoryResponse { total, entries }
}

#[tauri::command]
async fn sales_history(item_id: String, region: String, limit: usize, source: String) -> Result<SalesHistoryResponse, String> {
    let region = region.to_ascii_uppercase();
    if !matches!(region.as_str(), "EU" | "RU" | "NA" | "SEA" | "NEA") { return Err("Неизвестный регион".into()); }
    if item_id.trim().is_empty() { return Err("Не выбран предмет".into()); }
    if source == "local" {
        let (total, raw_rows) = load_all_cached_history(item_id.trim(), &region, limit)?;
        return Ok(history_response(total, &raw_rows));
    }
    let url = format!("{API_BASE}/{region}/auction/{}/history?limit={}&additional=true",
        urlencoding::encode(item_id.trim()), limit.clamp(5, 200));
    let response = reqwest::Client::new().get(&url).headers(api_headers()?).send().await
        .map_err(|error| format!("Ошибка сети: {error}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() { return Err(format!("HTTP {}: {}", status.as_u16(), body)); }
    let payload: Value = serde_json::from_str(&body).map_err(|error| format!("API вернул некорректный JSON: {error}"))?;
    let total = payload.get("total").and_then(Value::as_u64).unwrap_or_default();
    let raw_rows = payload.get("prices").and_then(Value::as_array).cloned().unwrap_or_default();
    save_history_rows(item_id.trim(), &region, &raw_rows)?;
    Ok(history_response(total, &raw_rows))
}

fn collection_market_values(
    connection: &Connection,
    collection_id: i64,
    filters: MovementFilters,
) -> Result<(i64, Vec<f64>), String> {
    let mut statement = connection.prepare(
        "SELECT CASE WHEN o.buyout_price > 0 AND o.amount > 0
                     THEN CAST(o.buyout_price AS REAL) / o.amount END
         FROM lot_observations o LEFT JOIN tracked_lots t ON t.lot_key = o.lot_key
         WHERE o.collection_id = ?1
           AND (?2 = 0 OR (t.quality_code IS NOT NULL AND (?2 & (1 << t.quality_code)) != 0))
           AND (?3 IS NULL OR t.upgrade >= ?3)
           AND (?4 IS NULL OR t.upgrade <= ?4)
           AND (?5 IS NULL OR o.amount >= ?5)
           AND (?6 IS NULL OR o.amount <= ?6)"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map(
        params![collection_id, filters.quality_mask, filters.min_upgrade, filters.max_upgrade, filters.min_amount, filters.max_amount],
        |row| row.get::<_, Option<f64>>(0)
    )
        .map_err(|error| error.to_string())?;
    let values: Vec<Option<f64>> = rows.filter_map(Result::ok).collect();
    Ok((values.len() as i64, values.into_iter().flatten().collect()))
}

#[tauri::command]
fn market_movement(
    hours: i64,
    region: String,
    qualities: Vec<String>,
    min_upgrade: Option<i64>,
    max_upgrade: Option<i64>,
    min_amount: Option<i64>,
    max_amount: Option<i64>,
) -> Result<MarketMovementResponse, String> {
    let filters = market_filters(&qualities, min_upgrade, max_upgrade, min_amount, max_amount)?;
    reconcile_all_sale_matches()?;
    let connection = open_cache()?;
    market_movement_from(&connection, hours, region, filters, chrono::Utc::now())
}

fn market_filters(
    qualities: &[String],
    min_upgrade: Option<i64>,
    max_upgrade: Option<i64>,
    min_amount: Option<i64>,
    max_amount: Option<i64>,
) -> Result<MovementFilters, String> {
    if min_upgrade.is_some_and(|value| !(0..=15).contains(&value))
        || max_upgrade.is_some_and(|value| !(0..=15).contains(&value)) {
        return Err("Заточка должна быть в диапазоне от 0 до 15".into());
    }
    if min_upgrade.zip(max_upgrade).is_some_and(|(min, max)| min > max) {
        return Err("Минимальная заточка не может быть больше максимальной".into());
    }
    if min_amount.is_some_and(|value| !(1..=100_000).contains(&value))
        || max_amount.is_some_and(|value| !(1..=100_000).contains(&value)) {
        return Err("Количество должно быть в диапазоне от 1 до 100 000".into());
    }
    if min_amount.zip(max_amount).is_some_and(|(min, max)| min > max) {
        return Err("Минимальное количество не может быть больше максимального".into());
    }
    Ok(MovementFilters {
        quality_mask: qualities.iter().filter_map(|name| quality_code(name)).fold(0, |mask, code| mask | (1 << code)),
        min_upgrade,
        max_upgrade,
        min_amount,
        max_amount,
    })
}

fn timing_buckets(groups: HashMap<u8, Vec<f64>>, overall: f64) -> Vec<TimingBucket> {
    let mut buckets: Vec<TimingBucket> = groups.into_iter().filter_map(|(key, values)| {
        let bucket_median = median(&values)?;
        Some(TimingBucket {
            key,
            median_min_unit: bucket_median,
            samples: values.len(),
            discount_percent: (overall - bucket_median) / overall * 100.0,
        })
    }).collect();
    buckets.sort_by(|a, b| a.median_min_unit.total_cmp(&b.median_min_unit).then_with(|| b.samples.cmp(&a.samples)));
    buckets
}

#[tauri::command]
fn market_timing(
    item_id: String,
    region: String,
    qualities: Vec<String>,
    min_upgrade: Option<i64>,
    max_upgrade: Option<i64>,
    timezone_offset_minutes: i64,
) -> Result<MarketTimingResponse, String> {
    let filters = market_filters(&qualities, min_upgrade, max_upgrade, None, None)?;
    let connection = open_cache()?;
    market_timing_from(
        &connection,
        item_id.trim(),
        &region.to_ascii_uppercase(),
        filters,
        timezone_offset_minutes.clamp(-720, 840),
        chrono::Utc::now(),
    )
}

fn market_timing_from(
    connection: &Connection,
    item_id: &str,
    region: &str,
    filters: MovementFilters,
    timezone_offset_minutes: i64,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<MarketTimingResponse, String> {
    let period_days = 30;
    let cutoff = now.timestamp() - period_days * 86_400;
    let collections: Vec<(i64, i64)> = {
        let mut statement = connection.prepare(
            "SELECT id, collected_timestamp FROM market_collections
             WHERE item_id = ?1 AND region = ?2 AND collected_timestamp >= ?3 AND complete = 1
             ORDER BY collected_timestamp"
        ).map_err(|error| error.to_string())?;
        let rows = statement.query_map(params![item_id, region, cutoff], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|error| error.to_string())?;
        rows.filter_map(Result::ok).collect()
    };
    let mut minima = Vec::new();
    let mut hours: HashMap<u8, Vec<f64>> = HashMap::new();
    let mut weekdays: HashMap<u8, Vec<f64>> = HashMap::new();
    for (collection_id, timestamp) in collections {
        let (_, prices) = collection_market_values(connection, collection_id, filters)?;
        let Some(minimum) = prices.into_iter().min_by(f64::total_cmp) else { continue };
        let local_timestamp = timestamp + timezone_offset_minutes * 60;
        let local_days = local_timestamp.div_euclid(86_400);
        let hour = local_timestamp.rem_euclid(86_400).div_euclid(3_600) as u8;
        let hour_window = hour / 3 * 3;
        let weekday = (local_days + 3).rem_euclid(7) as u8;
        minima.push(minimum);
        hours.entry(hour_window).or_default().push(minimum);
        weekdays.entry(weekday).or_default().push(minimum);
    }
    let overall_median_min = median(&minima);
    let (hour_windows, weekday_buckets) = overall_median_min
        .map(|overall| (timing_buckets(hours, overall), timing_buckets(weekdays, overall)))
        .unwrap_or_default();
    Ok(MarketTimingResponse {
        period_days,
        total_samples: minima.len(),
        overall_median_min,
        hour_windows,
        weekdays: weekday_buckets,
    })
}

fn market_movement_from(
    connection: &Connection,
    hours: i64,
    region: String,
    filters: MovementFilters,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<MarketMovementResponse, String> {
    let hours = match hours { 24 | 168 | 720 => hours, _ => 24 };
    let cutoff = now.timestamp() - hours * 3_600;
    let region_filter = region.to_ascii_uppercase();
    let markets: Vec<(String, String)> = {
        let mut statement = connection.prepare(
            "SELECT DISTINCT item_id, region FROM market_collections
             WHERE (?1 = 'ALL' OR region = ?1) ORDER BY region, item_id"
        ).map_err(|error| error.to_string())?;
        let rows = statement.query_map(params![&region_filter], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|error| error.to_string())?;
        rows.filter_map(Result::ok).collect()
    };
    let mut movements = Vec::new();
    for (item_id, market_region) in markets {
        let collection_stats: (u64, u64) = connection.query_row(
            "SELECT COUNT(*), COALESCE(SUM(complete), 0) FROM market_collections
             WHERE item_id = ?1 AND region = ?2 AND collected_timestamp >= ?3",
            params![&item_id, &market_region, cutoff], |row| Ok((row.get(0)?, row.get(1)?))
        ).map_err(|error| error.to_string())?;
        if collection_stats.0 == 0 { continue; }
        let sampled_collections: Vec<(i64, String, i64, i64)> = {
            let mut statement = connection.prepare(
                "WITH base AS (
                   SELECT id, collected_at, collected_timestamp, api_total
                   FROM market_collections
                   WHERE item_id = ?1 AND region = ?2 AND collected_timestamp >= ?3
                 ), numbered AS (
                   SELECT *, ROW_NUMBER() OVER (ORDER BY collected_timestamp) AS rn, COUNT(*) OVER () AS total_count
                   FROM base
                 )
                 SELECT id, collected_at, collected_timestamp, api_total FROM numbered
                 WHERE total_count <= 240
                    OR (rn - 1) % ((total_count + 239) / 240) = 0
                    OR rn = total_count
                 ORDER BY collected_timestamp"
            ).map_err(|error| error.to_string())?;
            let rows = statement.query_map(params![&item_id, &market_region, cutoff], |row|
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
                .map_err(|error| error.to_string())?;
            rows.filter_map(Result::ok).collect()
        };
        let mut points = Vec::new();
        let mut last_collected = String::new();
        for (collection_id, collected_at, timestamp, api_supply) in sampled_collections {
            let (filtered_supply, prices) = collection_market_values(connection, collection_id, filters)?;
            let supply = if filters.active() { filtered_supply } else { api_supply };
            last_collected = collected_at;
            points.push(MovementPoint {
                time: timestamp,
                supply,
                min_unit: prices.iter().copied().min_by(f64::total_cmp),
                median_unit: median(&prices),
            });
        }
        let appeared = connection.query_row(
            "SELECT COUNT(*) FROM tracked_lots WHERE item_id = ?1 AND region = ?2 AND first_seen_timestamp >= ?3
             AND (?4 = 0 OR (quality_code IS NOT NULL AND (?4 & (1 << quality_code)) != 0))
             AND (?5 IS NULL OR upgrade >= ?5) AND (?6 IS NULL OR upgrade <= ?6)
             AND (?7 IS NULL OR amount >= ?7) AND (?8 IS NULL OR amount <= ?8)",
            params![&item_id, &market_region, cutoff, filters.quality_mask, filters.min_upgrade, filters.max_upgrade, filters.min_amount, filters.max_amount], |row| row.get::<_, u64>(0)
        ).unwrap_or_default();
        let disappeared = connection.query_row(
            "SELECT COUNT(*) FROM tracked_lots WHERE item_id = ?1 AND region = ?2 AND missing_since_timestamp >= ?3
             AND (?4 = 0 OR (quality_code IS NOT NULL AND (?4 & (1 << quality_code)) != 0))
             AND (?5 IS NULL OR upgrade >= ?5) AND (?6 IS NULL OR upgrade <= ?6)
             AND (?7 IS NULL OR amount >= ?7) AND (?8 IS NULL OR amount <= ?8)",
            params![&item_id, &market_region, cutoff, filters.quality_mask, filters.min_upgrade, filters.max_upgrade, filters.min_amount, filters.max_amount], |row| row.get::<_, u64>(0)
        ).unwrap_or_default();
        let sale_rows: Vec<(i64, i64, i64, String)> = {
            let mut statement = connection.prepare(
                "SELECT sold_timestamp, amount, price, source FROM sales
                 WHERE item_id = ?1 AND region = ?2 AND sold_timestamp >= ?3
                   AND amount > 0 AND price > 0
                   AND (?4 = 0 OR (quality_code IS NOT NULL AND (?4 & (1 << quality_code)) != 0))
                   AND (?5 IS NULL OR upgrade >= ?5) AND (?6 IS NULL OR upgrade <= ?6)
                   AND (?7 IS NULL OR amount >= ?7) AND (?8 IS NULL OR amount <= ?8)
                 ORDER BY sold_timestamp"
            ).map_err(|error| error.to_string())?;
            let rows = statement.query_map(
                params![&item_id, &market_region, cutoff, filters.quality_mask, filters.min_upgrade, filters.max_upgrade, filters.min_amount, filters.max_amount],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            ).map_err(|error| error.to_string())?;
            rows.filter_map(Result::ok).collect()
        };
        let recorded_sales = sale_rows.len() as u64;
        let schistory_sales = sale_rows.iter().filter(|row| row.3 == "schistory").count() as u64;
        let stalzone_sales = recorded_sales.saturating_sub(schistory_sales);
        let bucket_seconds = match hours { 24 => 900, 168 => 3_600, _ => 14_400 };
        let mut sale_buckets: HashMap<i64, Vec<(f64, i64)>> = HashMap::new();
        for (timestamp, amount, total_price, _) in &sale_rows {
            let bucket = timestamp.div_euclid(bucket_seconds) * bucket_seconds;
            sale_buckets.entry(bucket).or_default().push((*total_price as f64 / *amount as f64, *amount));
        }
        let mut sale_points: Vec<MovementSalePoint> = sale_buckets.into_iter().filter_map(|(time, rows)| {
            let prices: Vec<f64> = rows.iter().map(|row| row.0).collect();
            Some(MovementSalePoint {
                time,
                median_unit: median(&prices)?,
                sales: rows.len(),
                units: rows.iter().map(|row| row.1).sum(),
            })
        }).collect();
        sale_points.sort_by_key(|point| point.time);
        let probable_sales = connection.query_row(
            "SELECT COUNT(*) FROM tracked_lots WHERE item_id = ?1 AND region = ?2
             AND status = 'probable_sold' AND missing_since_timestamp >= ?3
             AND (?4 = 0 OR (quality_code IS NOT NULL AND (?4 & (1 << quality_code)) != 0))
             AND (?5 IS NULL OR upgrade >= ?5) AND (?6 IS NULL OR upgrade <= ?6)
             AND (?7 IS NULL OR amount >= ?7) AND (?8 IS NULL OR amount <= ?8)",
            params![&item_id, &market_region, cutoff, filters.quality_mask, filters.min_upgrade, filters.max_upgrade, filters.min_amount, filters.max_amount], |row| row.get::<_, u64>(0)
        ).unwrap_or_default();
        let unexplained_missing = connection.query_row(
            "SELECT COUNT(*) FROM tracked_lots WHERE item_id = ?1 AND region = ?2
             AND status = 'missing' AND missing_since_timestamp >= ?3
             AND (?4 = 0 OR (quality_code IS NOT NULL AND (?4 & (1 << quality_code)) != 0))
             AND (?5 IS NULL OR upgrade >= ?5) AND (?6 IS NULL OR upgrade <= ?6)
             AND (?7 IS NULL OR amount >= ?7) AND (?8 IS NULL OR amount <= ?8)",
            params![&item_id, &market_region, cutoff, filters.quality_mask, filters.min_upgrade, filters.max_upgrade, filters.min_amount, filters.max_amount], |row| row.get::<_, u64>(0)
        ).unwrap_or_default();
        let ended = connection.query_row(
            "SELECT COUNT(*) FROM tracked_lots WHERE item_id = ?1 AND region = ?2 AND status = 'ended' AND end_timestamp >= ?3
             AND (?4 = 0 OR (quality_code IS NOT NULL AND (?4 & (1 << quality_code)) != 0))
             AND (?5 IS NULL OR upgrade >= ?5) AND (?6 IS NULL OR upgrade <= ?6)
             AND (?7 IS NULL OR amount >= ?7) AND (?8 IS NULL OR amount <= ?8)",
            params![&item_id, &market_region, cutoff, filters.quality_mask, filters.min_upgrade, filters.max_upgrade, filters.min_amount, filters.max_amount], |row| row.get::<_, u64>(0)
        ).unwrap_or_default();
        let active_lots = connection.query_row(
            "SELECT COUNT(*) FROM tracked_lots WHERE item_id = ?1 AND region = ?2 AND status = 'active'
             AND (?3 = 0 OR (quality_code IS NOT NULL AND (?3 & (1 << quality_code)) != 0))
             AND (?4 IS NULL OR upgrade >= ?4) AND (?5 IS NULL OR upgrade <= ?5)
             AND (?6 IS NULL OR amount >= ?6) AND (?7 IS NULL OR amount <= ?7)",
            params![&item_id, &market_region, filters.quality_mask, filters.min_upgrade, filters.max_upgrade, filters.min_amount, filters.max_amount], |row| row.get::<_, u64>(0)
        ).unwrap_or_default();
        let average_lifetime_minutes = connection.query_row(
            "SELECT AVG(CASE
               WHEN status IN ('missing', 'probable_sold') THEN missing_since_timestamp - first_seen_timestamp
               WHEN status = 'ended' THEN end_timestamp - first_seen_timestamp END) / 60.0
             FROM tracked_lots WHERE item_id = ?1 AND region = ?2 AND status IN ('missing', 'probable_sold', 'ended')
               AND COALESCE(missing_since_timestamp, end_timestamp) >= ?3
               AND (?4 = 0 OR (quality_code IS NOT NULL AND (?4 & (1 << quality_code)) != 0))
               AND (?5 IS NULL OR upgrade >= ?5) AND (?6 IS NULL OR upgrade <= ?6)
               AND (?7 IS NULL OR amount >= ?7) AND (?8 IS NULL OR amount <= ?8)",
            params![&item_id, &market_region, cutoff, filters.quality_mask, filters.min_upgrade, filters.max_upgrade, filters.min_amount, filters.max_amount], |row| row.get::<_, Option<f64>>(0)
        ).unwrap_or(None);
        let mut events = Vec::new();
        {
            let mut statement = connection.prepare(
                "SELECT t.first_seen_at, t.first_seen_timestamp, t.missing_since_at, t.missing_since_timestamp,
                        t.status, t.end_time, t.end_timestamp, t.amount, t.buyout_price, m.confidence, s.sold_at,
                        t.quality_code, t.upgrade
                 FROM tracked_lots t
                 LEFT JOIN lot_sale_matches m ON m.lot_key = t.lot_key
                 LEFT JOIN sales s ON s.fingerprint = m.sale_fingerprint
                 WHERE t.item_id = ?1 AND t.region = ?2
                   AND (first_seen_timestamp >= ?3 OR missing_since_timestamp >= ?3
                        OR (status = 'ended' AND end_timestamp >= ?3))
                   AND (?4 = 0 OR (t.quality_code IS NOT NULL AND (?4 & (1 << t.quality_code)) != 0))
                   AND (?5 IS NULL OR t.upgrade >= ?5) AND (?6 IS NULL OR t.upgrade <= ?6)
                   AND (?7 IS NULL OR t.amount >= ?7) AND (?8 IS NULL OR t.amount <= ?8)
                 ORDER BY MAX(first_seen_timestamp, COALESCE(missing_since_timestamp, 0), COALESCE(end_timestamp, 0)) DESC
                 LIMIT 100"
            ).map_err(|error| error.to_string())?;
            type EventRow = (String, i64, Option<String>, Option<i64>, String, Option<String>, Option<i64>, i64, Option<i64>, Option<f64>, Option<String>, Option<i64>, Option<i64>);
            let rows = statement.query_map(params![&item_id, &market_region, cutoff, filters.quality_mask, filters.min_upgrade, filters.max_upgrade, filters.min_amount, filters.max_amount], |row| Ok(EventRow::from((
                row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?,
                row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?, row.get(9)?, row.get(10)?,
                row.get(11)?, row.get(12)?
            )))).map_err(|error| error.to_string())?;
            for row in rows.filter_map(Result::ok) {
                let (first_at, first_ts, missing_at, missing_ts, status, end_at, end_ts, amount, buyout, confidence, sold_at, quality_code, upgrade) = row;
                let unit_price = buyout.filter(|price| *price > 0).filter(|_| amount > 0).map(|price| price as f64 / amount as f64);
                let quality = quality_code.and_then(quality_label).map(str::to_string);
                if first_ts >= cutoff {
                    events.push(MovementEvent { kind: "appeared".into(), time: first_at, amount, buyout, unit_price, quality: quality.clone(), upgrade, lifetime_minutes: None, confidence: None });
                }
                if status == "missing" || status == "probable_sold" {
                    if let (Some(time), Some(timestamp)) = (missing_at, missing_ts) {
                        events.push(MovementEvent { kind: if status == "probable_sold" { "probable_sale".into() } else { "missing".into() },
                            time: sold_at.unwrap_or(time), amount, buyout, unit_price, quality: quality.clone(), upgrade,
                            lifetime_minutes: Some((timestamp - first_ts).max(0) as f64 / 60.0), confidence });
                    }
                } else if status == "ended" {
                    if let (Some(time), Some(timestamp)) = (end_at, end_ts) {
                        events.push(MovementEvent { kind: "ended".into(), time, amount, buyout, unit_price, quality, upgrade,
                            lifetime_minutes: Some((timestamp - first_ts).max(0) as f64 / 60.0), confidence: None });
                    }
                }
            }
        }
        events.sort_by(|a, b| b.time.cmp(&a.time));
        events.truncate(50);
        let first = points.first();
        let last = points.last();
        let supply_change_percent = first.zip(last).and_then(|(start, current)|
            (start.supply > 0).then_some((current.supply - start.supply) as f64 / start.supply as f64 * 100.0));
        let price_change_percent = first.and_then(|point| point.median_unit).zip(last.and_then(|point| point.median_unit))
            .and_then(|(start, current)| (start > 0.0).then_some((current - start) / start * 100.0));
        if filters.active()
            && points.iter().all(|point| point.supply == 0)
            && appeared + disappeared + recorded_sales + probable_sales + unexplained_missing + ended + active_lots == 0 {
            continue;
        }
        let signal = if points.len() < 2 {
            "Нужно больше данных"
        } else if supply_change_percent.is_some_and(|value| value <= -10.0) && price_change_percent.is_some_and(|value| value >= 5.0) {
            "Дефицит усиливается"
        } else if supply_change_percent.is_some_and(|value| value >= 15.0) && price_change_percent.is_some_and(|value| value <= -5.0) {
            "Перенасыщение"
        } else if disappeared > appeared && price_change_percent.is_some_and(|value| value > 0.0) {
            "Лоты исчезают быстрее"
        } else {
            "Рынок стабилен"
        }.to_string();
        movements.push(MarketMovement {
            item_id, region: market_region,
            current_supply: last.map(|point| point.supply).unwrap_or_default(),
            supply_change_percent,
            current_min_unit: last.and_then(|point| point.min_unit),
            current_median_unit: last.and_then(|point| point.median_unit),
            price_change_percent, appeared, disappeared, recorded_sales, schistory_sales, stalzone_sales,
            probable_sales, unexplained_missing, ended, active_lots,
            average_lifetime_minutes, collections: collection_stats.0,
            coverage_percent: collection_stats.1 as f64 / collection_stats.0 as f64 * 100.0,
            last_collected, signal, points, sale_points, events,
        });
    }
    movements.sort_by(|a, b| b.disappeared.cmp(&a.disappeared).then_with(|| b.appeared.cmp(&a.appeared)));
    Ok(MarketMovementResponse { generated_at: now.to_rfc3339(), hours, markets: movements })
}

#[tauri::command]
async fn market_analytics(rules: Vec<WatchRule>) -> Result<MarketAnalyticsResponse, String> {
    let mut insights = Vec::new();
    for original_rule in rules {
        let mut rule = original_rule.clone();
        rule.history_limit = 200;
        let (_, lots, _) = request_lots_for_collection(&rule, 2_000).await?;
        sync_history_for_rule(&rule).await?;
        let history = load_cached_history(
            &rule.item_id, &rule.region, ANALYTICS_HISTORY_DAYS, ANALYTICS_HISTORY_LIMIT,
        )?;
        let mut stack_rule = rule.clone();
        stack_rule.min_amount = None;
        stack_rule.max_amount = None;
        let stack_active: Vec<&Value> = lots.iter().filter(|lot| variant_matches(&stack_rule, lot)).collect();
        let stack_history: Vec<&Value> = history.iter().filter(|lot| variant_matches(&stack_rule, lot)).collect();
        let stack_amounts: Vec<i64> = stack_active.iter().chain(stack_history.iter()).map(|lot| amount(lot)).collect();
        let (stackability, stack_evidence, max_observed_amount) = infer_stackability(&stack_amounts);
        let all_comparable_lots: Vec<&Value> = lots.iter().filter(|lot| variant_matches(&rule, lot)).collect();
        let current_min_lot = all_comparable_lots.iter().filter_map(|lot| {
            unit_price(lot, "buyoutPrice").map(|unit| (*lot, unit))
        }).min_by(|a, b| a.1.total_cmp(&b.1));
        let current_min_amount = current_min_lot.map(|(lot, _)| amount(lot));
        let (amount_min, amount_max, comparison_amount_label) = current_min_amount
            .map(amount_band).unwrap_or((1, i64::MAX, "все размеры"));
        let comparable_lots: Vec<&Value> = all_comparable_lots.iter().copied()
            .filter(|lot| amount_in_band(amount(lot), amount_min, amount_max)).collect();
        let comparable_history: Vec<&Value> = history.iter().filter(|lot| {
            variant_matches(&rule, lot) && amount_in_band(amount(lot), amount_min, amount_max)
        }).collect();
        let current_units: Vec<f64> = comparable_lots.iter().filter_map(|lot| unit_price(lot, "buyoutPrice")).collect();
        let history_units: Vec<f64> = comparable_history.iter().filter_map(|lot| unit_price(lot, "price")).collect();
        let current_min = current_units.iter().copied().min_by(f64::total_cmp);
        let history_median = median(&history_units);
        let average = (!history_units.is_empty()).then(|| history_units.iter().sum::<f64>() / history_units.len() as f64);
        let p25 = percentile(&history_units, 0.25);
        let p75 = percentile(&history_units, 0.75);

        let mut timed_prices: Vec<(i64, f64)> = comparable_history.iter().filter_map(|row| {
            let time = row.get("time").and_then(Value::as_str)?;
            let timestamp = chrono::DateTime::parse_from_rfc3339(time).ok()?.timestamp();
            Some((timestamp, unit_price(row, "price")?))
        }).collect();
        timed_prices.sort_by(|a, b| b.0.cmp(&a.0));
        let adaptive = adaptive_market_price(&timed_prices, history_median);
        let discount = current_min.zip(adaptive.fair_value).and_then(|(current, market)|
            (market > 0.0).then_some((market - current) / market * 100.0));
        let broad_volatility = p25.zip(p75).zip(history_median).and_then(|((low, high), market)|
            (market > 0.0).then_some((high - low) / market * 100.0));
        let volatility = adaptive.volatility_percent.or(broad_volatility);
        let trend = adaptive.trend_percent;
        let span_seconds = timed_prices.first().zip(timed_prices.last()).map(|(newest, oldest)| (newest.0 - oldest.0).abs() as f64);
        let average_interval = span_seconds.and_then(|span|
            (timed_prices.len() > 1).then_some(span / (timed_prices.len() - 1) as f64 / 60.0));
        let sales_per_day = span_seconds.and_then(|span|
            (span > 0.0).then_some((timed_prices.len().saturating_sub(1)) as f64 / (span / 86_400.0)));
        let liquidity = match sales_per_day.unwrap_or_default() {
            value if value >= 8.0 => "Высокая",
            value if value >= 2.0 => "Средняя",
            _ => "Низкая",
        }.to_string();

        let discount_points = discount.unwrap_or_default().max(0.0).min(22.0) / 22.0 * 55.0;
        let liquidity_points = match liquidity.as_str() { "Высокая" => 25.0, "Средняя" => 16.0, _ => 6.0 };
        let stability_points = (15.0 - volatility.unwrap_or(30.0) * 0.35).max(0.0);
        let sample_points = if history_units.len() >= 100 { 5.0 } else if history_units.len() >= 30 { 3.0 } else { 0.0 };
        let score = (discount_points + liquidity_points + stability_points + sample_points).round().clamp(0.0, 100.0) as u8;
        let verdict = match score { 75..=100 => "Сильная возможность", 55..=74 => "Интересно", 35..=54 => "Наблюдать", _ => "Слабый сигнал" }.to_string();
        let mut risks = Vec::new();
        if history_units.len() < 30 { risks.push("Мало данных".into()); }
        if volatility.is_some_and(|value| value > 35.0) { risks.push("Высокий разброс цены".into()); }
        if liquidity == "Низкая" { risks.push("Медленные продажи".into()); }
        if discount.is_some_and(|value| value < 0.0) { risks.push("Минимум выше адаптивной цены".into()); }
        if comparable_lots.len() <= 2 { risks.push("Мало активных предложений такого размера".into()); }

        let matching_lots = comparable_lots.iter().filter(|lot| lot_matches(&rule, lot, &current_units, history_median)).count();
        save_market_snapshot(&rule, &lots, matching_lots)?;
        let mut movement_rule = rule.clone();
        movement_rule.min_amount = Some(amount_min);
        movement_rule.max_amount = (amount_max != i64::MAX).then_some(amount_max);
        let (movement_supply_change_percent, movement_price_change_percent, movement_collections, movement_coverage_percent) =
            comparable_movement_summary(&movement_rule, chrono::Utc::now())?;
        insights.push(MarketInsight {
            name: rule.name, item_id: rule.item_id, region: rule.region,
            artifact_qualities: rule.artifact_qualities, min_amount: rule.min_amount,
            min_upgrade: rule.min_upgrade, max_upgrade: rule.max_upgrade,
            active_lots: comparable_lots.len(), all_active_lots: all_comparable_lots.len(), matching_lots,
            current_min_amount, comparison_amount_label: comparison_amount_label.into(),
            comparison_amount_min: amount_min,
            comparison_amount_max: (amount_max != i64::MAX).then_some(amount_max),
            stackability, stack_evidence, max_observed_amount,
            sales_sample: history_units.len(),
            sold_amount: comparable_history.iter().map(|row| amount(row)).sum(),
            current_min_unit: current_min, median_unit: history_median, fair_value_unit: adaptive.fair_value,
            recent_median_unit: adaptive.recent_median, recent_p25_unit: adaptive.recent_p25,
            recent_p75_unit: adaptive.recent_p75, recent_sales_sample: adaptive.recent_sample,
            latest_sale_unit: adaptive.latest_sale, latest_sale_at: adaptive.latest_sale_at,
            average_unit: average,
            p25_unit: p25, p75_unit: p75, discount_percent: discount, trend_percent: trend,
            volatility_percent: volatility, sales_per_day, average_sale_interval_minutes: average_interval,
            movement_supply_change_percent, movement_price_change_percent,
            movement_collections, movement_coverage_percent,
            opportunity_score: score, liquidity, verdict, risks,
        });
    }
    insights.sort_by(|a, b| b.opportunity_score.cmp(&a.opportunity_score));
    Ok(MarketAnalyticsResponse { generated_at: chrono::Utc::now().to_rfc3339(), insights })
}

fn comparable_movement_summary(
    rule: &WatchRule,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<(Option<f64>, Option<f64>, u64, f64), String> {
    let connection = open_cache()?;
    let region = rule.region.to_ascii_uppercase();
    let cutoff = now.timestamp() - 86_400;
    let (collections, complete): (u64, u64) = connection.query_row(
        "SELECT COUNT(*), COALESCE(SUM(complete), 0) FROM market_collections
         WHERE item_id = ?1 AND region = ?2 AND collected_timestamp >= ?3",
        params![rule.item_id, &region, cutoff],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).unwrap_or_default();
    let ids: Vec<i64> = {
        let mut statement = connection.prepare(
            "SELECT id FROM market_collections
             WHERE item_id = ?1 AND region = ?2 AND collected_timestamp >= ?3 AND complete = 1
             ORDER BY collected_timestamp"
        ).map_err(|error| error.to_string())?;
        let rows = statement.query_map(params![rule.item_id, &region, cutoff], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        rows.filter_map(Result::ok).collect()
    };
    let endpoints = ids.first().copied().zip(ids.last().copied());
    let (supply_change, price_change) = if let Some((first_id, last_id)) = endpoints {
        let first = collection_variant_values(&connection, first_id, rule)?;
        let last = collection_variant_values(&connection, last_id, rule)?;
        let supply = (first.0 > 0).then_some((last.0 as f64 - first.0 as f64) / first.0 as f64 * 100.0);
        let prices = median(&first.2).zip(median(&last.2))
            .and_then(|(start, current)| (start > 0.0).then_some((current - start) / start * 100.0));
        (supply, prices)
    } else { (None, None) };
    let coverage = if collections > 0 { complete as f64 / collections as f64 * 100.0 } else { 0.0 };
    Ok((supply_change, price_change, collections, coverage))
}

fn collection_variant_values(connection: &Connection, collection_id: i64, rule: &WatchRule) -> Result<(usize, i64, Vec<f64>), String> {
    let mut statement = connection.prepare(
        "SELECT raw_json FROM lot_observations WHERE collection_id = ?1"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![collection_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let values: Vec<Value> = rows.filter_map(Result::ok).filter_map(|raw| serde_json::from_str(&raw).ok())
        .filter(|lot| variant_matches(rule, lot)).collect();
    let units = values.iter().map(amount).sum();
    let prices = values.iter().filter_map(|lot| unit_price(lot, "buyoutPrice")).collect();
    Ok((values.len(), units, prices))
}

fn deep_price_window(timed: &[(i64, f64, i64)], latest: i64, hours: i64) -> DeepPriceWindow {
    let rows: Vec<(f64, i64)> = timed.iter().filter(|(timestamp, _, _)| latest - *timestamp <= hours * 3_600)
        .map(|(_, price, amount)| (*price, *amount)).collect();
    let prices: Vec<f64> = rows.iter().map(|(price, _)| *price).collect();
    DeepPriceWindow {
        hours,
        sales: rows.len(),
        units: rows.iter().map(|(_, amount)| *amount).sum(),
        p25_unit: percentile(&prices, 0.25),
        median_unit: median(&prices),
        p75_unit: percentile(&prices, 0.75),
    }
}

#[tauri::command]
fn stack_strategy_analysis(
    rule: WatchRule,
    buy_max_amount: i64,
    sell_min_amount: i64,
    target_amount: i64,
    fee_percent: f64,
    max_buy_unit: Option<f64>,
) -> Result<StackStrategyAnalysis, String> {
    if !(1..=10_000).contains(&buy_max_amount) || !(1..=10_000).contains(&sell_min_amount)
        || !(1..=10_000).contains(&target_amount) {
        return Err("Размеры пачек должны быть от 1 до 10 000".into());
    }
    if target_amount < sell_min_amount { return Err("Целевая пачка должна быть не меньше продаваемой пачки".into()); }
    if max_buy_unit.is_some_and(|price| !price.is_finite() || price <= 0.0) { return Err("Некорректный лимит закупки".into()); }
    let connection = open_cache()?;
    stack_strategy_from(
        &connection, &rule, buy_max_amount, sell_min_amount, target_amount,
        fee_percent.clamp(0.0, 50.0), max_buy_unit, chrono::Utc::now(),
    )
}

fn stack_strategy_from(
    connection: &Connection,
    rule: &WatchRule,
    buy_max_amount: i64,
    sell_min_amount: i64,
    target_amount: i64,
    fee_percent: f64,
    max_buy_unit: Option<f64>,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<StackStrategyAnalysis, String> {
    let mut variant_rule = rule.clone();
    variant_rule.min_amount = None;
    variant_rule.max_amount = None;
    let region = rule.region.to_ascii_uppercase();
    let latest_collection: Option<i64> = connection.query_row(
        "SELECT id FROM market_collections WHERE item_id = ?1 AND region = ?2 AND complete = 1 ORDER BY collected_timestamp DESC LIMIT 1",
        params![rule.item_id, &region], |row| row.get(0)
    ).ok();
    let mut candidates: Vec<(i64, i64, f64)> = if let Some(collection_id) = latest_collection {
        let mut statement = connection.prepare(
            "SELECT amount, buyout_price, raw_json FROM lot_observations
             WHERE collection_id = ?1 AND buyout_price > 0 AND amount > 0"
        ).map_err(|error| error.to_string())?;
        let rows = statement.query_map(params![collection_id], |row| Ok((
            row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?
        ))).map_err(|error| error.to_string())?;
        rows.filter_map(Result::ok).filter_map(|(amount, buyout, raw)| {
            let lot: Value = serde_json::from_str(&raw).ok()?;
            let unit = buyout as f64 / amount as f64;
            (amount <= buy_max_amount && variant_matches(&variant_rule, &lot)
                && max_buy_unit.is_none_or(|limit| unit <= limit)).then_some((amount, buyout, unit))
        }).collect()
    } else { Vec::new() };
    candidates.sort_by(|a, b| a.2.total_cmp(&b.2).then_with(|| b.0.cmp(&a.0)));
    let available_lots = candidates.len();
    let available_units = candidates.iter().map(|row| row.0).sum();
    let cheapest_buy_unit = candidates.first().map(|row| row.2);
    let mut acquired_amount = 0;
    let mut total_cost = 0;
    let mut purchase_lots = 0;
    for (amount, buyout, _) in &candidates {
        if acquired_amount >= target_amount { break; }
        acquired_amount += *amount;
        total_cost += *buyout;
        purchase_lots += 1;
    }
    let average_buy_unit = (acquired_amount > 0).then_some(total_cost as f64 / acquired_amount as f64);

    let history = load_cached_history_from(
        connection, &rule.item_id, &region, ANALYTICS_HISTORY_DAYS, ANALYTICS_HISTORY_LIMIT, now,
    )?;
    let mut timed_bulk: Vec<(i64, f64)> = history.iter().filter(|row| {
        variant_matches(&variant_rule, row) && amount(row) >= sell_min_amount
    }).filter_map(|row| {
        let timestamp = chrono::DateTime::parse_from_rfc3339(row.get("time")?.as_str()?).ok()?.timestamp();
        Some((timestamp, unit_price(row, "price")?))
    }).collect();
    timed_bulk.sort_by(|a, b| b.0.cmp(&a.0));
    let history_median = median(&timed_bulk.iter().map(|row| row.1).collect::<Vec<_>>());
    let adaptive = adaptive_market_price(&timed_bulk, history_median);
    let volatility = adaptive.volatility_percent.unwrap_or(20.0);
    let negative_trend = adaptive.trend_percent.unwrap_or_default().min(0.0).abs();
    let haircut = ((volatility * 0.15).max(2.0) + (negative_trend * 0.25).min(5.0)).min(12.0);
    let expected_sell_unit = adaptive.fair_value.map(|fair| fair * (1.0 - haircut / 100.0));
    let fee = fee_percent / 100.0;
    let net_revenue = expected_sell_unit.map(|sell| sell * acquired_amount as f64 * (1.0 - fee));
    let profit = net_revenue.map(|revenue| revenue - total_cost as f64);
    let roi_percent = profit.zip((total_cost > 0).then_some(total_cost as f64)).map(|(profit, cost)| profit / cost * 100.0);
    let break_even_buy_unit = expected_sell_unit.map(|sell| sell * (1.0 - fee));
    let complete = acquired_amount >= target_amount && acquired_amount >= sell_min_amount;
    let mut warnings = Vec::new();
    if latest_collection.is_none() { warnings.push("Нет полного снимка активного рынка".into()); }
    if !complete { warnings.push(format!("Не хватает товара: найдено {acquired_amount} из {target_amount}")); }
    if adaptive.recent_sample < 30 { warnings.push(format!("Мало недавних крупных продаж: {}", adaptive.recent_sample)); }
    if acquired_amount > target_amount { warnings.push(format!("Цель превышена на {} из-за покупки целых лотов", acquired_amount - target_amount)); }
    if average_buy_unit.zip(break_even_buy_unit).is_some_and(|(buy, limit)| buy >= limit) { warnings.push("Средняя закупка выше точки безубыточности".into()); }
    Ok(StackStrategyAnalysis {
        buy_max_amount, sell_min_amount, target_amount, acquired_amount, purchase_lots,
        available_lots, available_units, total_cost, average_buy_unit, cheapest_buy_unit,
        expected_sell_unit, recent_bulk_median_unit: adaptive.recent_median,
        bulk_sales_sample: adaptive.recent_sample, net_revenue, profit, roi_percent,
        break_even_buy_unit, complete, warnings,
    })
}

#[tauri::command]
fn market_deep_analysis(rule: WatchRule, fee_percent: f64) -> Result<MarketDeepAnalysis, String> {
    let now = chrono::Utc::now();
    let history = load_cached_history(
        &rule.item_id, &rule.region, ANALYTICS_HISTORY_DAYS, ANALYTICS_HISTORY_LIMIT,
    )?;
    let comparable: Vec<&Value> = history.iter().filter(|row| variant_matches(&rule, row)).collect();
    let mut timed: Vec<(i64, f64, i64)> = comparable.iter().filter_map(|row| {
        let timestamp = chrono::DateTime::parse_from_rfc3339(row.get("time")?.as_str()?).ok()?.timestamp();
        Some((timestamp, unit_price(row, "price")?, amount(row)))
    }).collect();
    timed.sort_by(|a, b| b.0.cmp(&a.0));
    let latest = timed.first().map(|row| row.0).unwrap_or_else(|| now.timestamp());
    let windows: Vec<DeepPriceWindow> = [1, 3, 6, 12, 24].into_iter()
        .map(|hours| deep_price_window(&timed, latest, hours)).collect();
    let history_hours = timed.first().zip(timed.last()).map(|(newest, oldest)| (newest.0 - oldest.0) as f64 / 3_600.0).unwrap_or_default();

    let mut all_amounts_rule = rule.clone();
    all_amounts_rule.min_amount = None;
    all_amounts_rule.max_amount = None;
    let recent_all_amounts: Vec<&Value> = history.iter().filter(|row| variant_matches(&all_amounts_rule, row)).filter(|row| {
        row.get("time").and_then(Value::as_str).and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok())
            .is_some_and(|time| latest - time.timestamp() <= 86_400)
    }).collect();
    let segments = [("1", 1, 1), ("2–4", 2, 4), ("5–9", 5, 9), ("10–19", 10, 19), ("20+", 20, i64::MAX)];
    let stack_segments: Vec<DeepStackSegment> = segments.into_iter().map(|(label, min, max)| {
        let rows: Vec<&&Value> = recent_all_amounts.iter().filter(|row| (min..=max).contains(&amount(row))).collect();
        let prices: Vec<f64> = rows.iter().filter_map(|row| unit_price(row, "price")).collect();
        DeepStackSegment { label: label.into(), sales: rows.len(), units: rows.iter().map(|row| amount(row)).sum(), median_unit: median(&prices) }
    }).collect();

    let connection = open_cache()?;
    let region = rule.region.to_ascii_uppercase();
    let collection_stats: (u64, u64) = connection.query_row(
        "SELECT COUNT(*), COALESCE(SUM(complete), 0) FROM market_collections WHERE item_id = ?1 AND region = ?2",
        params![rule.item_id, &region], |row| Ok((row.get(0)?, row.get(1)?))
    ).unwrap_or_default();
    let latest_collection: Option<(i64, i64)> = connection.query_row(
        "SELECT id, collected_timestamp FROM market_collections WHERE item_id = ?1 AND region = ?2 AND complete = 1 ORDER BY collected_timestamp DESC LIMIT 1",
        params![rule.item_id, &region], |row| Ok((row.get(0)?, row.get(1)?))
    ).ok();
    let (current_supply, current_units, current_prices) = latest_collection
        .map(|(id, _)| collection_variant_values(&connection, id, &rule)).transpose()?.unwrap_or_default();
    let current_min = current_prices.iter().copied().min_by(f64::total_cmp);
    let current_median = median(&current_prices);
    let first_supply = latest_collection.and_then(|(_, timestamp)| connection.query_row(
        "SELECT id FROM market_collections WHERE item_id = ?1 AND region = ?2 AND complete = 1 AND collected_timestamp >= ?3 ORDER BY collected_timestamp LIMIT 1",
        params![rule.item_id, &region, timestamp - 86_400], |row| row.get::<_, i64>(0)
    ).ok()).map(|id| collection_variant_values(&connection, id, &rule)).transpose()?.map(|row| row.0);
    let supply_change_percent = first_supply.filter(|supply| *supply > 0)
        .map(|supply| (current_supply as f64 - supply as f64) / supply as f64 * 100.0);

    let step = current_min.map(|price| if price >= 1_000_000.0 { 100_000.0 } else if price >= 100_000.0 { 10_000.0 } else if price >= 10_000.0 { 1_000.0 } else { 100.0 }).unwrap_or(1.0);
    let depth: Vec<MarketDepthLevel> = current_min.map(|minimum| [0.0, 1.0, 2.0, 3.0, 5.0].into_iter().map(|offset| {
        let threshold = (minimum / step).ceil() * step + offset * step;
        let rows: Vec<(i64, f64)> = latest_collection.map(|(id, _)| {
            let mut statement = connection.prepare("SELECT amount, buyout_price * 1.0 / amount, raw_json FROM lot_observations WHERE collection_id = ?1 AND buyout_price > 0 AND amount > 0").ok()?;
            let mapped = statement.query_map(params![id], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?, row.get::<_, String>(2)?))).ok()?;
            Some(mapped.filter_map(Result::ok).filter_map(|(amount, price, raw)| serde_json::from_str::<Value>(&raw).ok().filter(|lot| variant_matches(&rule, lot)).map(|_| (amount, price))).filter(|(_, price)| *price <= threshold).collect())
        }).flatten().unwrap_or_default();
        MarketDepthLevel { price: threshold, lots: rows.len(), units: rows.iter().map(|(amount, _)| *amount).sum() }
    }).collect()).unwrap_or_default();

    let timed_prices: Vec<(i64, f64)> = timed.iter().map(|(timestamp, price, _)| (*timestamp, *price)).collect();
    let adaptive = adaptive_market_price(&timed_prices, median(&timed_prices.iter().map(|(_, price)| *price).collect::<Vec<_>>()));
    let volatility = adaptive.volatility_percent.unwrap_or(20.0);
    let negative_trend = adaptive.trend_percent.unwrap_or_default().min(0.0).abs();
    let haircut = (volatility * 0.15).max(2.0) + (negative_trend * 0.25).min(5.0);
    let expected_sell = adaptive.fair_value.map(|fair| fair * (1.0 - haircut.min(12.0) / 100.0));
    let fee = fee_percent.clamp(0.0, 50.0) / 100.0;
    let buy_for_five = expected_sell.map(|sell| sell * (1.0 - fee) / 1.05);
    let buy_for_ten = expected_sell.map(|sell| sell * (1.0 - fee) / 1.10);

    let mut insights = Vec::new();
    if let (Some(short), Some(day)) = (windows[0].median_unit, windows[4].median_unit) {
        let change = (short - day) / day * 100.0;
        insights.push(format!("Медиана последнего часа {short:.0} ₽: {change:+.1}% к медиане 24 часов."));
    }
    if let (Some(ask), Some(clear)) = (current_median, windows[0].median_unit.or(windows[2].median_unit)) {
        insights.push(format!("Медиана активных предложений {ask:.0} ₽: на {:+.1}% выше недавней цены сделок.", (ask - clear) / clear * 100.0));
    }
    if let Some(change) = supply_change_percent { insights.push(format!("Предложение за доступные 24 часа изменилось на {change:+.1}%.")); }
    let single = stack_segments.iter().find(|segment| segment.label == "1").and_then(|segment| segment.median_unit);
    let bulk = stack_segments.iter().find(|segment| segment.label == "10–19").and_then(|segment| segment.median_unit);
    if let (Some(single), Some(bulk)) = (single, bulk) { insights.push(format!("Пачки 10–19 продаются с премией {:+.1}% к одиночным.", (bulk - single) / single * 100.0)); }
    if let (Some(level), Some(hour)) = (depth.get(2), windows.first()) {
        if hour.units > 0 { insights.push(format!("До цены {:.0} ₽ доступно {} единиц — примерно {:.1} часа недавнего оборота.", level.price, level.units, level.units as f64 / hour.units as f64)); }
    }
    if history_hours < 72.0 { insights.push(format!("История пока покрывает только {:.1} часа; недельная сезонность ненадёжна.", history_hours)); }

    Ok(MarketDeepAnalysis {
        generated_at: now.to_rfc3339(), history_hours, total_sales: timed.len(), sold_units: timed.iter().map(|row| row.2).sum(),
        collections: collection_stats.0, complete_collections: collection_stats.1,
        current_supply, current_units, current_min_unit: current_min, current_median_unit: current_median,
        supply_change_percent, expected_sell_unit: expected_sell, buy_for_five_percent: buy_for_five,
        buy_for_ten_percent: buy_for_ten, windows, stack_segments, depth, insights,
    })
}

fn lot_matches(rule: &WatchRule, lot: &Value, current: &[f64], history_median: Option<f64>) -> bool {
    if !variant_matches(rule, lot) { return false; }
    let buyout = price(lot, "buyoutPrice").filter(|value| *value > 0);
    let unit = unit_price(lot, "buyoutPrice");
    if rule.max_buyout.is_some_and(|max| buyout.is_none_or(|value| value > max)) { return false; }
    if rule.max_unit_buyout.is_some_and(|max| unit.is_none_or(|value| value > max as f64)) { return false; }
    if rule.max_history_median_ratio.is_some_and(|ratio| unit.zip(history_median).is_none_or(|(value, market)| value > market * ratio)) { return false; }
    if let Some(ratio) = rule.max_current_min_ratio {
        let Some(value) = unit else { return false };
        let mut peers = current.to_vec();
        if let Some((index, _)) = peers.iter().enumerate().min_by(|(_, a), (_, b)| (*a - value).abs().total_cmp(&(*b - value).abs())) { peers.remove(index); }
        let reference = peers.into_iter().min_by(f64::total_cmp);
        if reference.is_none_or(|minimum| value > minimum * ratio) { return false; }
    }
    true
}

fn tracked_lot_key(rule: &WatchRule, lot: &Value) -> String {
    let identity = json!({
        "region": rule.region.to_ascii_uppercase(),
        "itemId": rule.item_id,
        "amount": amount(lot),
        "startPrice": price(lot, "startPrice"),
        "buyoutPrice": price(lot, "buyoutPrice"),
        "startTime": lot.get("startTime"),
        "endTime": lot.get("endTime"),
        "additional": lot.get("additional"),
    });
    format!("{:x}", Sha256::digest(identity.to_string().as_bytes()))
}

fn tracked_lot_keys(rule: &WatchRule, lots: &[Value]) -> Vec<String> {
    let mut occurrences: HashMap<String, usize> = HashMap::new();
    lots.iter().map(|lot| {
        let base = tracked_lot_key(rule, lot);
        let occurrence = occurrences.entry(base.clone()).or_default();
        let key = if *occurrence == 0 { base } else { format!("{base}#{}", *occurrence) };
        *occurrence += 1;
        key
    }).collect()
}

fn record_market_collection(rule: &WatchRule, lots: &[Value], api_total: u64, complete: bool) -> Result<(), String> {
    let region = rule.region.to_ascii_uppercase();
    let now = chrono::Utc::now();
    let mut connection = open_cache()?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    transaction.execute(
        "UPDATE tracked_lots SET status = 'ended' WHERE status = 'active' AND end_timestamp IS NOT NULL AND end_timestamp <= ?1",
        params![now.timestamp()]
    ).map_err(|error| error.to_string())?;
    transaction.execute(
        "INSERT INTO market_collections
         (collected_at, collected_timestamp, item_id, region, api_total, returned_lots, complete)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![now.to_rfc3339(), now.timestamp(), rule.item_id, &region, api_total as i64, lots.len() as i64, complete as i64]
    ).map_err(|error| error.to_string())?;
    let collection_id = transaction.last_insert_rowid();
    if complete {
        transaction.execute(
            "UPDATE tracked_lots SET status = 'candidate_missing'
             WHERE item_id = ?1 AND region = ?2 AND status = 'active'",
            params![rule.item_id, &region]
        ).map_err(|error| error.to_string())?;
    }
    for (lot, key) in lots.iter().zip(tracked_lot_keys(rule, lots)) {
        transaction.execute("DELETE FROM lot_sale_matches WHERE lot_key = ?1", params![&key])
            .map_err(|error| error.to_string())?;
        let raw = serde_json::to_string(lot).map_err(|error| error.to_string())?;
        let end_time = lot.get("endTime").and_then(Value::as_str);
        let end_timestamp = end_time.and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok()).map(|value| value.timestamp());
        transaction.execute(
            "INSERT INTO tracked_lots
             (lot_key, item_id, region, first_seen_at, first_seen_timestamp, last_seen_at, last_seen_timestamp,
              status, observation_count, amount, start_price, current_price, buyout_price, start_time, end_time,
              end_timestamp, quality_code, upgrade, raw_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?5, 'active', 1, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT(lot_key) DO UPDATE SET
               last_seen_at = excluded.last_seen_at,
               last_seen_timestamp = excluded.last_seen_timestamp,
               missing_since_at = NULL,
               missing_since_timestamp = NULL,
               status = 'active',
               observation_count = tracked_lots.observation_count + 1,
               current_price = excluded.current_price,
               raw_json = excluded.raw_json",
            params![
                &key, rule.item_id, &region, now.to_rfc3339(), now.timestamp(), amount(lot),
                price(lot, "startPrice"), price(lot, "currentPrice"), price(lot, "buyoutPrice"),
                lot.get("startTime").and_then(Value::as_str), end_time, end_timestamp,
                lot_quality_code(lot), lot_upgrade(lot), &raw
            ]
        ).map_err(|error| error.to_string())?;
        transaction.execute(
            "INSERT OR IGNORE INTO lot_observations
             (collection_id, lot_key, item_id, region, amount, start_price, current_price, buyout_price, raw_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![collection_id, &key, rule.item_id, &region, amount(lot), price(lot, "startPrice"),
                price(lot, "currentPrice"), price(lot, "buyoutPrice"), &raw]
        ).map_err(|error| error.to_string())?;
    }
    if complete {
        transaction.execute(
            "UPDATE tracked_lots SET status = 'missing', missing_since_at = ?1, missing_since_timestamp = ?2
             WHERE item_id = ?3 AND region = ?4 AND status = 'candidate_missing'",
            params![now.to_rfc3339(), now.timestamp(), rule.item_id, &region]
        ).map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    match_missing_lots_to_sales(&rule.item_id, &region)?;
    Ok(())
}

fn recent_history_sync_due(item_id: &str, region: &str, now: i64) -> Result<bool, String> {
    let connection = open_cache()?;
    let last: Option<i64> = connection.query_row(
        "SELECT last_history_sync FROM cache_sync_state WHERE item_id = ?1 AND region = ?2",
        params![item_id, region.to_ascii_uppercase()], |row| row.get(0)
    ).unwrap_or(None);
    Ok(last.is_none_or(|timestamp| now - timestamp >= 300))
}

fn mark_recent_history_synced(item_id: &str, region: &str, now: i64) -> Result<(), String> {
    let connection = open_cache()?;
    connection.execute(
        "INSERT INTO cache_sync_state (item_id, region, last_history_sync) VALUES (?1, ?2, ?3)
         ON CONFLICT(item_id, region) DO UPDATE SET last_history_sync = excluded.last_history_sync",
        params![item_id, region.to_ascii_uppercase(), now]
    ).map_err(|error| error.to_string())?;
    Ok(())
}

fn lot_key(rule: &WatchRule, lot: &Value) -> String {
    format!("{}|{}|{}|{}|{}|{}|{}|{}", rule.region, rule.item_id, amount(lot),
        lot.get("startTime").unwrap_or(&Value::Null), lot.get("endTime").unwrap_or(&Value::Null),
        price(lot, "currentPrice").unwrap_or_default(), price(lot, "buyoutPrice").unwrap_or_default(),
        lot.get("additional").unwrap_or(&Value::Null))
}

fn format_lot(rule: &WatchRule, lot: &Value) -> String {
    let count = amount(lot);
    let buyout = price(lot, "buyoutPrice").filter(|value| *value > 0);
    let mut lines = vec![format!("Новый лот: {}", rule.name), format!("Регион: {}", rule.region),
        format!("Item ID: {}", rule.item_id), format!("Количество: {count}"),
        format!("Выкуп: {}", buyout.map(|v| v.to_string()).unwrap_or_else(|| "нет".into()))];
    if let Some(unit) = unit_price(lot, "buyoutPrice") { lines.push(format!("Цена за штуку: {unit:.0}")); }
    if let Some(label) = lot_quality_code(lot).and_then(quality_label) { lines.push(format!("Редкость артефакта: {label}")); }
    if let Some(upgrade) = lot_upgrade(lot) { lines.push(format!("Заточка: +{upgrade}")); }
    if let Some(current) = price(lot, "currentPrice") { lines.push(format!("Текущая цена: {current}")); }
    if let Some(end) = lot.get("endTime").and_then(Value::as_str) { lines.push(format!("Окончание: {end}")); }
    lines.join("\n")
}

async fn send_external_notifications(message: &str) {
    reload_env();
    let client = reqwest::Client::new();
    if let (Ok(token), Ok(chat_id)) = (env::var("TELEGRAM_BOT_TOKEN"), env::var("TELEGRAM_CHAT_ID")) {
        let _ = client.post(format!("https://api.telegram.org/bot{token}/sendMessage"))
            .form(&[("chat_id", chat_id.as_str()), ("text", message)]).send().await;
    }
    if let Ok(webhook) = env::var("DISCORD_WEBHOOK_URL") {
        if !webhook.trim().is_empty() { let _ = client.post(webhook).json(&json!({"content": message})).send().await; }
    }
}

#[tauri::command]
fn active_lots_for_rules(rules: Vec<WatchRule>, limit: usize) -> Result<ActiveLotsResponse, String> {
    let connection = open_cache()?;
    active_lots_for_rules_from(&connection, &rules, limit, chrono::Utc::now())
}

fn active_lots_for_rules_from(
    connection: &Connection,
    rules: &[WatchRule],
    limit: usize,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<ActiveLotsResponse, String> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    let mut markets = 0;
    let mut complete_markets = 0;
    let mut latest_timestamp = i64::MIN;
    let mut collected_at = None;

    for rule in rules {
        let region = rule.region.to_ascii_uppercase();
        let collection = connection.query_row(
            "SELECT id, collected_at, collected_timestamp, complete FROM market_collections
             WHERE item_id = ?1 AND region = ?2 ORDER BY collected_timestamp DESC LIMIT 1",
            params![rule.item_id, &region],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?, row.get::<_, bool>(3)?)),
        ).ok();
        let Some((collection_id, observed_at, observed_timestamp, complete)) = collection else { continue };
        markets += 1;
        if complete { complete_markets += 1; }
        if observed_timestamp > latest_timestamp {
            latest_timestamp = observed_timestamp;
            collected_at = Some(observed_at);
        }

        let mut statement = connection.prepare(
            "SELECT lot_key, raw_json FROM lot_observations WHERE collection_id = ?1"
        ).map_err(|error| error.to_string())?;
        let rows = statement.query_map(params![collection_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).map_err(|error| error.to_string())?;
        let lots: Vec<(String, Value)> = rows.filter_map(Result::ok).filter_map(|(key, raw)| {
            serde_json::from_str(&raw).ok().map(|lot| (key, lot))
        }).filter(|(_, lot)| variant_matches(rule, lot)).collect();
        let current: Vec<f64> = lots.iter().filter_map(|(_, lot)| unit_price(lot, "buyoutPrice")).collect();
        let history_median = if rule.max_history_median_ratio.is_some() {
            let history = load_cached_history_from(
                connection, &rule.item_id, &region, ANALYTICS_HISTORY_DAYS, ANALYTICS_HISTORY_LIMIT, now,
            )?;
            let values: Vec<f64> = history.iter().filter(|row| variant_matches(rule, row))
                .filter_map(|row| unit_price(row, "price")).collect();
            median(&values)
        } else { None };

        for (key, lot) in lots {
            let unique = format!("{}|{}|{}", region, rule.item_id, key);
            if !seen.insert(unique) { continue; }
            result.push(ActiveLotView {
                item_id: rule.item_id.clone(),
                amount: amount(&lot),
                buyout: price(&lot, "buyoutPrice").filter(|value| *value > 0),
                unit_price: unit_price(&lot, "buyoutPrice"),
                current_price: price(&lot, "currentPrice").filter(|value| *value > 0),
                quality: lot_quality_code(&lot).and_then(quality_label).map(str::to_string),
                upgrade: lot_upgrade(&lot),
                start_time: lot.get("startTime").and_then(Value::as_str).map(str::to_string),
                end_time: lot.get("endTime").and_then(Value::as_str).map(str::to_string),
                matches_rule: lot_matches(rule, &lot, &current, history_median),
            });
        }
    }

    result.sort_by(|a, b| a.unit_price.unwrap_or(f64::INFINITY).total_cmp(&b.unit_price.unwrap_or(f64::INFINITY))
        .then_with(|| a.buyout.unwrap_or(i64::MAX).cmp(&b.buyout.unwrap_or(i64::MAX))));
    let total = result.len();
    result.truncate(limit.clamp(1, 500));
    Ok(ActiveLotsResponse {
        total, returned: result.len(), markets, complete_markets, collected_at, lots: result,
    })
}

fn rapid_median_key(rule: &WatchRule) -> String {
    format!("{}|{}|{:?}|{:?}|{:?}|{:?}|{:?}",
        rule.region.to_ascii_uppercase(), rule.item_id, rule.artifact_qualities,
        rule.min_amount, rule.max_amount, rule.min_upgrade, rule.max_upgrade)
}

fn update_rapid_keys(previous: &[String], current: &[String], baseline: bool) -> (HashSet<String>, Vec<String>) {
    let previous_set: HashSet<String> = previous.iter().cloned().collect();
    let fresh = if baseline { HashSet::new() } else {
        current.iter().filter(|key| !previous_set.contains(*key)).cloned().collect()
    };
    let current_set: HashSet<String> = current.iter().cloned().collect();
    let mut remembered = current.to_vec();
    remembered.extend(previous.iter().filter(|key| !current_set.contains(*key)).cloned());
    remembered.truncate(100);
    (fresh, remembered)
}

#[tauri::command]
async fn rapid_check_rules(
    rules: Vec<WatchRule>,
    baseline: bool,
    state: tauri::State<'_, AppState>,
) -> Result<RapidCheckResult, String> {
    let _guard = state.rapid_lock.lock().await;
    let state_path = workspace_file(RAPID_STATE_FILE);
    let mut seen_state: RapidSeenState = fs::read_to_string(existing_workspace_file(RAPID_STATE_FILE)).ok()
        .and_then(|value| serde_json::from_str(&value).ok()).unwrap_or_default();
    let connection = open_cache()?;
    let now = chrono::Utc::now();
    let mut median_cache = state.rapid_medians.lock().await;
    let mut markets: HashMap<String, Vec<WatchRule>> = HashMap::new();
    for rule in rules.iter().filter(|rule| rule.rapid_monitor) {
        markets.entry(format!("{}|{}", rule.region.to_ascii_uppercase(), rule.item_id))
            .or_default().push(rule.clone());
    }

    let mut matches = Vec::new();
    let mut errors = Vec::new();
    let mut requests = 0;
    let mut observed_lots = 0;
    let mut new_lots = 0;
    let mut rate_limit = None;
    let mut rate_remaining = None;
    let mut rate_reset_at = None;
    let mut throttled = false;

    for (market_key, market_rules) in markets {
        if throttled { break; }
        let mut request_rule = market_rules[0].clone();
        request_rule.additional = market_rules.iter().any(|rule| rule.additional);
        request_rule.rapid_limit = market_rules.iter().map(|rule| rule.rapid_limit).max().unwrap_or(5).clamp(1, 10);
        let (response, rate) = request_recent_lots(&request_rule).await;
        requests += 1;
        if let Some(value) = rate.limit { rate_limit = Some(value); }
        if let Some(value) = rate.remaining { rate_remaining = Some(rate_remaining.map_or(value, |current: u64| current.min(value))); }
        if let Some(value) = rate.reset_at { rate_reset_at = Some(rate_reset_at.map_or(value, |current: i64| current.max(value))); }
        if rate.remaining.is_some_and(|remaining| remaining <= 5) { throttled = true; }
        let (_, lots) = match response {
            Ok(response) => response,
            Err(error) => {
                if error.contains("HTTP 429") { throttled = true; }
                errors.push(format!("{}: {error}", market_key));
                continue;
            }
        };
        observed_lots += lots.len();
        let keys = tracked_lot_keys(&request_rule, &lots);
        let previous = seen_state.markets.get(&market_key).cloned().unwrap_or_default();
        let (fresh, remembered) = update_rapid_keys(&previous, &keys, baseline);
        new_lots += fresh.len();
        seen_state.markets.insert(market_key, remembered);

        for rule in &market_rules {
            let mut rapid_rule = rule.clone();
            rapid_rule.max_current_min_ratio = None;
            let current: Vec<f64> = lots.iter().filter(|lot| variant_matches(&rapid_rule, lot))
                .filter_map(|lot| unit_price(lot, "buyoutPrice")).collect();
            let history_median = if rapid_rule.max_history_median_ratio.is_some() || rapid_rule.group_id.is_some() {
                let key = rapid_median_key(&rapid_rule);
                if let Some((cached_at, value)) = median_cache.get(&key)
                    .filter(|(cached_at, _)| now.timestamp() - *cached_at < RAPID_MEDIAN_TTL_SECONDS) {
                    let _ = cached_at;
                    *value
                } else {
                    let history = load_cached_history_from(
                        &connection, &rapid_rule.item_id, &rapid_rule.region.to_ascii_uppercase(),
                        RAPID_HISTORY_DAYS, RAPID_HISTORY_LIMIT, now,
                    )?;
                    let values: Vec<f64> = history.iter().filter(|lot| variant_matches(&rapid_rule, lot))
                        .filter_map(|lot| unit_price(lot, "price")).collect();
                    let value = median(&values);
                    median_cache.insert(key, (now.timestamp(), value));
                    value
                }
            } else { None };
            for (lot, key) in lots.iter().zip(keys.iter()) {
                if !fresh.contains(key) || !lot_matches(&rapid_rule, lot, &current, history_median) { continue; }
                let unit = unit_price(lot, "buyoutPrice");
                matches.push(MatchRecord {
                    name: rapid_rule.name.clone(), region: rapid_rule.region.clone(), item_id: rapid_rule.item_id.clone(),
                    quality: lot_quality_code(lot).and_then(quality_label).map(str::to_string),
                    upgrade: lot_upgrade(lot), amount: amount(lot),
                    buyout: price(lot, "buyoutPrice").filter(|value| *value > 0), unit,
                    current: price(lot, "currentPrice"), end: lot.get("endTime").and_then(Value::as_str).unwrap_or_default().into(),
                    message: format!("Оперативный мониторинг\n{}", format_lot(&rapid_rule, lot)),
                    deal_ratio: unit.zip(history_median).and_then(|(value, market)| (market > 0.0).then_some(value / market)),
                    group_id: rapid_rule.group_id.clone(), group_top_n: rapid_rule.group_top_n,
                    seen_key: key.clone(), is_new: true,
                });
            }
        }
    }

    let mut individual = Vec::new();
    let mut groups: HashMap<String, Vec<MatchRecord>> = HashMap::new();
    for record in matches {
        if let Some(group_id) = &record.group_id { groups.entry(group_id.clone()).or_default().push(record); }
        else { individual.push(record); }
    }
    for mut records in groups.into_values() {
        records.sort_by(|a, b| a.deal_ratio.unwrap_or(f64::INFINITY).total_cmp(&b.deal_ratio.unwrap_or(f64::INFINITY))
            .then_with(|| a.unit.unwrap_or(f64::INFINITY).total_cmp(&b.unit.unwrap_or(f64::INFINITY))));
        let top_n = records.first().and_then(|record| record.group_top_n).unwrap_or(1).clamp(1, 20);
        individual.extend(records.into_iter().take(top_n));
    }
    for record in &individual { send_external_notifications(&record.message).await; }
    seen_state.updated_at = Some(chrono::Utc::now().to_rfc3339());
    fs::write(&state_path, serde_json::to_string_pretty(&seen_state).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;

    Ok(RapidCheckResult {
        checked_rules: rules.len(), requests, observed_lots, new_lots, baseline, throttled,
        rate_limit, rate_remaining, rate_reset_at, errors, matches: individual,
    })
}

#[tauri::command]
async fn check_rules(
    rules: Vec<WatchRule>,
    notify_existing: bool,
    include_seen: bool,
    state: tauri::State<'_, AppState>,
) -> Result<CheckResult, String> {
    let _guard = state.check_lock.lock().await;
    let state_read_path = existing_workspace_file(STATE_FILE);
    let state_path = workspace_file(STATE_FILE);
    let mut seen_state: SeenState = fs::read_to_string(&state_read_path).ok().and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default();
    let seen: HashSet<String> = seen_state.seen.iter().cloned().collect();
    let mut updated = seen.clone();
    let mut matches = Vec::new();
    let mut summaries = Vec::new();
    let mut collected_markets: HashMap<String, (u64, Vec<Value>, bool)> = HashMap::new();
    let mut observed_lots = 0;
    let mut collected_sales = 0;
    let mut collection_errors = Vec::new();

    for rule in &rules {
        let market_key = format!("{}|{}", rule.region.to_ascii_uppercase(), rule.item_id);
        if !collected_markets.contains_key(&market_key) {
            let collection = match request_lots_for_collection(rule, 2_000).await {
                Ok(collection) => collection,
                Err(error) => {
                    collection_errors.push(format!("{} {}: {error}", rule.region.to_ascii_uppercase(), rule.item_id));
                    continue;
                }
            };
            if let Err(error) = record_market_collection(rule, &collection.1, collection.0, collection.2) {
                collection_errors.push(format!("{} {}: {error}", rule.region.to_ascii_uppercase(), rule.item_id));
                continue;
            }
            observed_lots += collection.1.len();
            let now = chrono::Utc::now().timestamp();
            if recent_history_sync_due(&rule.item_id, &rule.region, now)? {
                if let Ok((_, rows)) = request_history_page(rule, 200, 0).await {
                    collected_sales += save_history_rows(&rule.item_id, &rule.region, &rows)?;
                    mark_recent_history_synced(&rule.item_id, &rule.region, now)?;
                }
            }
            collected_markets.insert(market_key.clone(), collection);
        }
        let (api_total, lots, _) = collected_markets.get(&market_key).expect("market was collected");
        let current: Vec<f64> = lots.iter().filter(|lot| variant_matches(rule, lot)).filter_map(|lot| unit_price(lot, "buyoutPrice")).collect();
        let history_median = if rule.max_history_median_ratio.is_some() || rule.group_id.is_some() {
            let history = request_collection(rule, true).await?;
            let values: Vec<f64> = history.iter().filter(|lot| variant_matches(rule, lot)).filter_map(|lot| unit_price(lot, "price")).collect();
            median(&values)
        } else { None };
        let comparable: Vec<&Value> = lots.iter().filter(|lot| variant_matches(rule, lot)).collect();
        let matching_lots = comparable.iter().filter(|lot| lot_matches(rule, lot, &current, history_median)).count();
        save_market_snapshot(rule, lots, matching_lots)?;
        summaries.push(RuleSummary {
            name: rule.name.clone(), item_id: rule.item_id.clone(), region: rule.region.clone(),
            total_lots: *api_total as usize, comparable_lots: comparable.len(), matching_lots,
            current_min_buyout: comparable.iter().filter_map(|lot| price(lot, "buyoutPrice")).min(),
            current_min_unit: comparable.iter().filter_map(|lot| unit_price(lot, "buyoutPrice")).min_by(f64::total_cmp),
            history_median_unit: history_median,
            checked_at: chrono::Utc::now().to_rfc3339(),
        });
        for lot in lots {
            let key = lot_key(rule, lot);
            let already_seen = seen.contains(&key);
            if already_seen && !include_seen && rule.group_id.is_none() { continue; }
            if !already_seen && rule.group_id.is_none() { updated.insert(key.clone()); }
            if (notify_existing || include_seen) && lot_matches(rule, lot, &current, history_median) {
                let message = format_lot(rule, lot);
                let unit = unit_price(lot, "buyoutPrice");
                matches.push(MatchRecord {
                    name: rule.name.clone(), region: rule.region.clone(), item_id: rule.item_id.clone(),
                    quality: lot_quality_code(lot).and_then(quality_label).map(str::to_string),
                    upgrade: lot_upgrade(lot), amount: amount(lot),
                    buyout: price(lot, "buyoutPrice").filter(|value| *value > 0), unit,
                    current: price(lot, "currentPrice"), end: lot.get("endTime").and_then(Value::as_str).unwrap_or_default().into(), message,
                    deal_ratio: unit.zip(history_median).and_then(|(price, market)| (market > 0.0).then_some(price / market)),
                    group_id: rule.group_id.clone(), group_top_n: rule.group_top_n,
                    seen_key: key, is_new: !already_seen,
                });
            }
        }
    }
    let mut individual = Vec::new();
    let mut groups: HashMap<String, Vec<MatchRecord>> = HashMap::new();
    for record in matches {
        if let Some(group_id) = &record.group_id {
            groups.entry(group_id.clone()).or_default().push(record);
        } else {
            individual.push(record);
        }
    }
    for mut records in groups.into_values() {
        records.sort_by(|a, b| a.deal_ratio.unwrap_or(f64::INFINITY).total_cmp(&b.deal_ratio.unwrap_or(f64::INFINITY))
            .then_with(|| a.unit.unwrap_or(f64::INFINITY).total_cmp(&b.unit.unwrap_or(f64::INFINITY))));
        let top_n = records.first().and_then(|record| record.group_top_n).unwrap_or(1).clamp(1, 20);
        individual.extend(records.into_iter().take(top_n));
    }
    let matches: Vec<MatchRecord> = if include_seen { individual } else { individual.into_iter().filter(|record| record.is_new).collect() };
    for record in &matches {
        if record.is_new {
            updated.insert(record.seen_key.clone());
            send_external_notifications(&record.message).await;
        }
    }
    let mut seen_values: Vec<String> = updated.into_iter().collect();
    seen_values.sort();
    if seen_values.len() > 5000 { seen_values.drain(..seen_values.len() - 5000); }
    seen_state.seen = seen_values;
    seen_state.updated_at = Some(chrono::Utc::now().to_rfc3339());
    fs::write(&state_path, serde_json::to_string_pretty(&seen_state).map_err(|e| e.to_string())?)
        .map_err(|error| format!("Не удалось сохранить состояние: {error}"))?;
    Ok(CheckResult {
        checked_rules: rules.len(), notifications: matches.len(), observed_lots, collected_sales,
        collection_errors, matches, summaries,
    })
}

#[tauri::command]
fn load_rules() -> Result<Value, String> {
    let path = existing_workspace_file(CONFIG_FILE);
    if !path.exists() { return Ok(json!({"defaults": {"region": "EU", "limit": 50, "sort": "time_created", "order": "desc", "additional": true}, "items": []})); }
    serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?).map_err(|e| format!("Некорректный {CONFIG_FILE}: {e}"))
}

#[tauri::command]
fn save_rules(payload: Value) -> Result<String, String> {
    let path = workspace_file(CONFIG_FILE);
    fs::write(&path, serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?)
        .map_err(|error| format!("Не удалось сохранить правила: {error}"))?;
    Ok(path.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            check_lock: tokio::sync::Mutex::new(()),
            rapid_lock: tokio::sync::Mutex::new(()),
            rapid_medians: tokio::sync::Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![credentials_status, cache_status, sync_market_cache, load_catalog, read_image, analyze_market, sales_history, import_schistory_history, market_movement, market_timing, market_analytics, market_deep_analysis, stack_strategy_analysis, ai_market_analysis, active_lots_for_rules, rapid_check_rules, check_rules, load_rules, save_rules])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_endpoint_accepts_local_and_remote_http_servers() {
        assert!(ai_endpoint("http://localhost:11434/api/chat").is_ok());
        assert!(ai_endpoint("http://[::1]:11434/api/chat").is_ok());
        assert!(ai_endpoint("https://models.example.com/v1/chat/completions").is_ok());
        assert!(ai_endpoint("ftp://models.example.com/model").is_err());
        assert!(ai_endpoint("https://secret@models.example.com/v1/chat/completions").is_err());
    }

    #[test]
    fn lm_studio_native_chat_endpoint_uses_openai_compatible_route() {
        let url = normalized_ai_endpoint("http://192.168.1.116:1234/api/v1/chat")
            .expect("valid LM Studio endpoint");
        assert_eq!(url.as_str(), "http://192.168.1.116:1234/v1/chat/completions");
    }

    #[test]
    fn ai_response_parser_accepts_structured_json_and_code_fence() {
        let source = r#"```json
        {"action":"Наблюдать","mainScenario":"Цена снизится","summary":"Вход только по условию","argumentsFor":["Есть скидка"],"argumentsAgainst":[],"entryConditions":["Минимум ниже"],"cancellationConditions":[],"missingData":["Глубина"]}
        ```"#;
        let analysis = parse_ai_market_analysis(source).expect("valid AI response");
        assert_eq!(analysis.action, "Наблюдать");
        assert_eq!(analysis.arguments_for, vec!["Есть скидка"]);
        assert_eq!(analysis.missing_data, vec!["Глубина"]);
    }

    #[test]
    fn ai_response_parser_repairs_only_trailing_commas() {
        let source = r#"{
          "action":"Ждать",
          "mainScenario":"Коррекция",
          "summary":"Цена входа высока",
          "argumentsFor":["Высокая ликвидность",],
          "argumentsAgainst":["Отрицательный ROI",],
          "entryConditions":[],
          "cancellationConditions":[],
          "missingData":[],
        }"#;
        let analysis = parse_ai_market_analysis(source).expect("repairable AI response");
        assert_eq!(analysis.action, "Ждать");
        assert_eq!(analysis.arguments_for, vec!["Высокая ликвидность"]);
        assert_eq!(analysis.arguments_against, vec!["Отрицательный ROI"]);
        assert_eq!(remove_trailing_json_commas(r#"{"text":"keep,]"}"#), r#"{"text":"keep,]"}"#);
    }

    fn rule_with_quality(quality: &str) -> WatchRule {
        serde_json::from_value(json!({
            "name": "artifact",
            "itemId": "test",
            "region": "RU",
            "artifactQualities": [quality]
        })).expect("valid rule")
    }

    #[test]
    fn artifact_quality_uses_qlt_category() {
        let lot = json!({"amount": 1, "additional": {"qlt": 2, "ptn": 15}});
        assert!(variant_matches(&rule_with_quality("special"), &lot));
        assert!(!variant_matches(&rule_with_quality("rare"), &lot));
        assert_eq!(lot_quality_code(&lot).and_then(quality_label), Some("Особый"));
    }

    #[test]
    fn zero_buyout_is_not_a_market_price() {
        let lot = json!({"amount": 1, "buyoutPrice": 0});
        assert_eq!(unit_price(&lot, "buyoutPrice"), None);
    }

    #[test]
    fn rule_amount_range_and_comparison_bands_are_stable() {
        let rule: WatchRule = serde_json::from_value(json!({
            "name": "tools", "itemId": "tools", "region": "RU", "minAmount": 5, "maxAmount": 9
        })).unwrap();
        assert!(!variant_matches(&rule, &json!({"amount": 4})));
        assert!(variant_matches(&rule, &json!({"amount": 6})));
        assert!(!variant_matches(&rule, &json!({"amount": 10})));
        assert_eq!(amount_band(1), (1, 1, "1 шт."));
        assert_eq!(amount_band(6), (5, 9, "5–9 шт."));
        assert_eq!(amount_band(20), (20, 49, "20–49 шт."));
        assert_eq!(amount_band(100).2, "50+ шт.");
    }

    #[test]
    fn tracked_lot_identity_ignores_changing_bid() {
        let rule = rule_with_quality("special");
        let first = json!({
            "amount": 1, "startPrice": 100, "currentPrice": 150, "buyoutPrice": 500,
            "startTime": "2026-07-02T08:00:00Z", "endTime": "2026-07-03T08:00:00Z",
            "additional": {"qlt": 2, "ptn": 15}
        });
        let mut changed_bid = first.clone();
        changed_bid["currentPrice"] = json!(250);
        assert_eq!(tracked_lot_key(&rule, &first), tracked_lot_key(&rule, &changed_bid));
    }

    #[test]
    fn identical_active_lots_get_distinct_occurrence_keys() {
        let rule = rule_with_quality("special");
        let lot = json!({
            "amount": 1, "buyoutPrice": 500,
            "startTime": "2026-07-02T08:00:00Z", "endTime": "2026-07-03T08:00:00Z",
            "additional": {"qlt": 2}
        });
        let keys = tracked_lot_keys(&rule, &[lot.clone(), lot]);
        assert_eq!(keys.len(), 2);
        assert_ne!(keys[0], keys[1]);
    }

    #[test]
    fn movement_analytics_uses_supply_prices_and_lifecycle_events() {
        let connection = Connection::open_in_memory().expect("in-memory cache");
        prepare_cache(&connection).expect("cache schema");
        let now = chrono::DateTime::parse_from_rfc3339("2026-07-02T12:00:00Z").unwrap().with_timezone(&chrono::Utc);
        for (timestamp, supply) in [(now.timestamp() - 3_600, 10), (now.timestamp(), 8)] {
            connection.execute(
                "INSERT INTO market_collections
                 (collected_at, collected_timestamp, item_id, region, api_total, returned_lots, complete)
                 VALUES (?1, ?2, 'item', 'RU', ?3, ?3, 1)",
                params![chrono::DateTime::from_timestamp(timestamp, 0).unwrap().to_rfc3339(), timestamp, supply]
            ).unwrap();
            let collection_id = connection.last_insert_rowid();
            let prices = if supply == 10 { [80, 120] } else { [100, 200] };
            for (index, price) in prices.into_iter().enumerate() {
                connection.execute(
                    "INSERT INTO lot_observations
                     (collection_id, lot_key, item_id, region, amount, buyout_price, raw_json)
                     VALUES (?1, ?2, 'item', 'RU', 1, ?3, '{}')",
                    params![collection_id, format!("{collection_id}-{index}"), price]
                ).unwrap();
            }
        }
        connection.execute(
            "INSERT INTO tracked_lots
             (lot_key, item_id, region, first_seen_at, first_seen_timestamp, last_seen_at, last_seen_timestamp,
              missing_since_at, missing_since_timestamp, status, observation_count, amount, buyout_price, raw_json)
             VALUES ('gone', 'item', 'RU', ?1, ?2, ?1, ?2, ?3, ?4, 'missing', 2, 1, 100, '{}')",
            params![(now - chrono::Duration::minutes(30)).to_rfc3339(), now.timestamp() - 1_800,
                (now - chrono::Duration::minutes(5)).to_rfc3339(), now.timestamp() - 300]
        ).unwrap();

        let response = market_movement_from(&connection, 24, "all".into(), MovementFilters::default(), now).expect("movement response");
        assert_eq!(response.markets.len(), 1);
        let market = &response.markets[0];
        assert_eq!(market.current_supply, 8);
        assert_eq!(market.current_median_unit, Some(150.0));
        assert_eq!(market.supply_change_percent, Some(-20.0));
        assert_eq!(market.price_change_percent, Some(50.0));
        assert_eq!(market.disappeared, 1);
        assert_eq!(market.coverage_percent, 100.0);
        assert_eq!(market.signal, "Дефицит усиливается");
        assert!(market.events.iter().any(|event| event.kind == "missing"));
    }

    #[test]
    fn movement_filters_artifact_quality_and_upgrade_across_metrics() {
        let connection = Connection::open_in_memory().expect("in-memory cache");
        prepare_cache(&connection).expect("cache schema");
        let now = chrono::DateTime::parse_from_rfc3339("2026-07-02T12:00:00Z").unwrap().with_timezone(&chrono::Utc);
        for (pass, timestamp) in [now.timestamp() - 3_600, now.timestamp()].into_iter().enumerate() {
            connection.execute(
                "INSERT INTO market_collections
                 (collected_at, collected_timestamp, item_id, region, api_total, returned_lots, complete)
                 VALUES (?1, ?2, 'artifact', 'RU', 2, 2, 1)",
                params![chrono::DateTime::from_timestamp(timestamp, 0).unwrap().to_rfc3339(), timestamp]
            ).unwrap();
            let collection_id = connection.last_insert_rowid();
            for (index, (quality, upgrade, price)) in [(2, 15, 100 + pass as i64 * 20), (4, 15, 1_000 + pass as i64 * 200)].into_iter().enumerate() {
                let lot_key = format!("{pass}-{index}");
                connection.execute(
                    "INSERT INTO tracked_lots
                     (lot_key, item_id, region, first_seen_at, first_seen_timestamp, last_seen_at, last_seen_timestamp,
                      status, observation_count, amount, buyout_price, quality_code, upgrade, raw_json)
                     VALUES (?1, 'artifact', 'RU', ?2, ?3, ?2, ?3, 'active', 1, 1, ?4, ?5, ?6, '{}')",
                    params![&lot_key, chrono::DateTime::from_timestamp(timestamp, 0).unwrap().to_rfc3339(), timestamp, price, quality, upgrade]
                ).unwrap();
                connection.execute(
                    "INSERT INTO lot_observations
                     (collection_id, lot_key, item_id, region, amount, buyout_price, raw_json)
                     VALUES (?1, ?2, 'artifact', 'RU', 1, ?3, '{}')",
                    params![collection_id, &lot_key, price]
                ).unwrap();
            }
        }
        for (fingerprint, quality, price) in [("special", 2, 120), ("exceptional", 4, 1_200)] {
            connection.execute(
                "INSERT INTO sales
                 (fingerprint, item_id, region, sold_at, sold_timestamp, amount, price, quality_code, upgrade, raw_json)
                 VALUES (?1, 'artifact', 'RU', ?2, ?3, 1, ?4, ?5, 15, '{}')",
                params![fingerprint, now.to_rfc3339(), now.timestamp(), price, quality]
            ).unwrap();
        }
        connection.execute(
            "INSERT INTO sales
             (fingerprint, item_id, region, sold_at, sold_timestamp, amount, price, quality_code, upgrade, raw_json, source, source_id)
             VALUES ('special-history', 'artifact', 'RU', ?1, ?2, 1, 115, 2, 15, '{}', 'schistory', 'ru:42')",
            params![now.to_rfc3339(), now.timestamp()]
        ).unwrap();

        let filters = MovementFilters {
            quality_mask: 1 << 2,
            min_upgrade: Some(15),
            max_upgrade: Some(15),
            min_amount: None,
            max_amount: None,
        };
        let response = market_movement_from(&connection, 24, "RU".into(), filters, now).expect("filtered movement");
        let market = &response.markets[0];
        assert_eq!(market.current_supply, 1);
        assert_eq!(market.current_median_unit, Some(120.0));
        assert_eq!(market.recorded_sales, 2);
        assert_eq!(market.schistory_sales, 1);
        assert_eq!(market.stalzone_sales, 1);
        assert_eq!(market.sale_points.len(), 1);
        assert_eq!(market.sale_points[0].median_unit, 117.5);
        assert_eq!(market.active_lots, 2);
        assert!(market.events.iter().all(|event| event.quality.as_deref() == Some("Особый") && event.upgrade == Some(15)));
    }

    #[test]
    fn movement_filters_stack_size_across_offers_and_sales() {
        let connection = Connection::open_in_memory().expect("in-memory cache");
        prepare_cache(&connection).expect("cache schema");
        let now = chrono::DateTime::parse_from_rfc3339("2026-07-02T12:00:00Z").unwrap().with_timezone(&chrono::Utc);
        for (pass, timestamp) in [now.timestamp() - 3_600, now.timestamp()].into_iter().enumerate() {
            connection.execute(
                "INSERT INTO market_collections
                 (collected_at, collected_timestamp, item_id, region, api_total, returned_lots, complete)
                 VALUES (?1, ?2, 'tools', 'RU', 2, 2, 1)",
                params![chrono::DateTime::from_timestamp(timestamp, 0).unwrap().to_rfc3339(), timestamp]
            ).unwrap();
            let collection_id = connection.last_insert_rowid();
            for (suffix, amount, unit) in [("single", 1, 100), ("bulk", 20, 600)] {
                let lot_key = format!("{pass}-{suffix}");
                connection.execute(
                    "INSERT INTO tracked_lots
                     (lot_key, item_id, region, first_seen_at, first_seen_timestamp, last_seen_at, last_seen_timestamp,
                      status, observation_count, amount, buyout_price, raw_json)
                     VALUES (?1, 'tools', 'RU', ?2, ?3, ?2, ?3, 'active', 1, ?4, ?5, '{}')",
                    params![&lot_key, chrono::DateTime::from_timestamp(timestamp, 0).unwrap().to_rfc3339(), timestamp, amount, amount * unit]
                ).unwrap();
                connection.execute(
                    "INSERT INTO lot_observations
                     (collection_id, lot_key, item_id, region, amount, buyout_price, raw_json)
                     VALUES (?1, ?2, 'tools', 'RU', ?3, ?4, '{}')",
                    params![collection_id, &lot_key, amount, amount * unit]
                ).unwrap();
            }
        }
        for (fingerprint, amount, unit) in [("single-sale", 1, 100), ("bulk-sale", 20, 550)] {
            connection.execute(
                "INSERT INTO sales
                 (fingerprint, item_id, region, sold_at, sold_timestamp, amount, price, raw_json)
                 VALUES (?1, 'tools', 'RU', ?2, ?3, ?4, ?5, '{}')",
                params![fingerprint, now.to_rfc3339(), now.timestamp(), amount, amount * unit]
            ).unwrap();
        }

        let filters = MovementFilters { min_amount: Some(20), max_amount: Some(49), ..MovementFilters::default() };
        let response = market_movement_from(&connection, 24, "RU".into(), filters, now).expect("stack movement");
        let market = &response.markets[0];
        assert_eq!(market.current_supply, 1);
        assert_eq!(market.current_median_unit, Some(600.0));
        assert_eq!(market.recorded_sales, 1);
        assert_eq!(market.sale_points[0].median_unit, 550.0);
        assert!(market.events.iter().all(|event| event.amount == 20));
    }

    #[test]
    fn market_timing_ranks_local_hour_windows_and_weekdays() {
        let connection = Connection::open_in_memory().expect("in-memory cache");
        prepare_cache(&connection).expect("cache schema");
        let now = chrono::DateTime::parse_from_rfc3339("2026-07-02T12:00:00Z").unwrap().with_timezone(&chrono::Utc);
        for (index, (timestamp, price)) in [
            (now.timestamp(), 100),
            ((now - chrono::Duration::days(1)).timestamp(), 120),
            ((now - chrono::Duration::hours(8)).timestamp(), 80),
        ].into_iter().enumerate() {
            connection.execute(
                "INSERT INTO market_collections
                 (collected_at, collected_timestamp, item_id, region, api_total, returned_lots, complete)
                 VALUES (?1, ?2, 'item', 'RU', 1, 1, 1)",
                params![chrono::DateTime::from_timestamp(timestamp, 0).unwrap().to_rfc3339(), timestamp]
            ).unwrap();
            let collection_id = connection.last_insert_rowid();
            connection.execute(
                "INSERT INTO lot_observations
                 (collection_id, lot_key, item_id, region, amount, buyout_price, raw_json)
                 VALUES (?1, ?2, 'item', 'RU', 1, ?3, '{}')",
                params![collection_id, format!("timing-{index}"), price]
            ).unwrap();
        }

        let timing = market_timing_from(&connection, "item", "RU", MovementFilters::default(), 0, now).expect("timing response");
        assert_eq!(timing.total_samples, 3);
        assert_eq!(timing.overall_median_min, Some(100.0));
        assert_eq!(timing.hour_windows[0].key, 3);
        assert_eq!(timing.hour_windows[0].median_min_unit, 80.0);
        assert_eq!(timing.weekdays[0].key, 3);
        assert_eq!(timing.weekdays[0].median_min_unit, 90.0);
    }

    #[test]
    fn adaptive_price_follows_confirmed_recent_market_level() {
        let latest = chrono::DateTime::parse_from_rfc3339("2026-07-02T22:33:16Z").unwrap().timestamp();
        let recent_prices = [24_400_000.0, 24_333_333.0, 24_000_000.0, 25_000_000.0, 24_444_424.0, 24_000_000.0, 23_500_000.0, 23_000_000.0];
        let mut timed: Vec<(i64, f64)> = recent_prices.into_iter().enumerate()
            .map(|(index, price)| (latest - index as i64 * 8_000, price)).collect();
        timed.extend([(latest - 100_000, 22_000_000.0), (latest - 120_000, 21_500_000.0), (latest - 140_000, 21_000_000.0)]);
        timed.sort_by(|a, b| b.0.cmp(&a.0));

        let adaptive = adaptive_market_price(&timed, Some(20_850_000.0));
        assert_eq!(adaptive.recent_sample, 8);
        assert_eq!(adaptive.recent_median, Some(24_166_666.5));
        assert_eq!(adaptive.fair_value, adaptive.recent_median);
        assert_eq!(adaptive.latest_sale, Some(24_400_000.0));
        assert!(adaptive.trend_percent.is_some_and(|trend| trend > 10.0));
    }

    #[test]
    fn schistory_import_is_idempotent_and_deduplicates_official_sales() {
        let mut connection = Connection::open_in_memory().expect("in-memory cache");
        prepare_cache(&connection).expect("cache schema");
        let official_time = "2026-07-02T22:33:16.000+00:00";
        let official_timestamp = chrono::DateTime::parse_from_rfc3339(official_time).unwrap().timestamp();
        connection.execute(
            "INSERT INTO sales
             (fingerprint, item_id, region, sold_at, sold_timestamp, amount, price, quality_code, upgrade, raw_json)
             VALUES ('official', 'qoq6', 'RU', ?1, ?2, 1, 24400000, 4, 15, '{}')",
            params![official_time, official_timestamp]
        ).unwrap();
        let rows = || vec![
            SchistorySale { id: 10, item_id: 99, price: 24_400_000, qlt: Some(4), ptn: Some(15), sold_at: official_time.into(), region: "ru".into() },
            SchistorySale { id: 11, item_id: 99, price: 18_000_000, qlt: Some(4), ptn: Some(15), sold_at: "2025-08-01T10:00:00.000+00:00".into(), region: "ru".into() },
        ];

        let first = save_schistory_sales_to(&mut connection, "qoq6", "RU", 99, 2, rows()).expect("first import");
        assert_eq!(first.inserted_sales, 1);
        assert_eq!(first.skipped_existing, 1);
        let second = save_schistory_sales_to(&mut connection, "qoq6", "RU", 99, 2, rows()).expect("second import");
        assert_eq!(second.inserted_sales, 0);
        assert_eq!(second.skipped_existing, 2);
        let counts: (i64, i64) = connection.query_row(
            "SELECT SUM(source = 'stalzone_api'), SUM(source = 'schistory') FROM sales WHERE item_id = 'qoq6'",
            [], |row| Ok((row.get(0)?, row.get(1)?))
        ).unwrap();
        assert_eq!(counts, (1, 1));
    }

    #[test]
    fn stack_strategy_combines_small_lots_and_values_bulk_resale() {
        let connection = Connection::open_in_memory().expect("in-memory cache");
        prepare_cache(&connection).expect("cache schema");
        let now = chrono::DateTime::parse_from_rfc3339("2026-07-03T08:00:00Z").unwrap().with_timezone(&chrono::Utc);
        connection.execute(
            "INSERT INTO market_collections
             (collected_at, collected_timestamp, item_id, region, api_total, returned_lots, complete)
             VALUES (?1, ?2, 'tools', 'RU', 20, 20, 1)",
            params![now.to_rfc3339(), now.timestamp()]
        ).unwrap();
        let collection_id = connection.last_insert_rowid();
        for index in 0..20 {
            let raw = json!({"amount": 1, "buyoutPrice": 46_000});
            connection.execute(
                "INSERT INTO lot_observations
                 (collection_id, lot_key, item_id, region, amount, buyout_price, raw_json)
                 VALUES (?1, ?2, 'tools', 'RU', 1, 46000, ?3)",
                params![collection_id, format!("small-{index}"), raw.to_string()]
            ).unwrap();
        }
        for index in 0..8 {
            let sold_at = (now - chrono::Duration::hours(index)).to_rfc3339();
            let raw = json!({"amount": 20, "price": 1_200_000, "time": sold_at});
            connection.execute(
                "INSERT INTO sales
                 (fingerprint, item_id, region, sold_at, sold_timestamp, amount, price, raw_json)
                 VALUES (?1, 'tools', 'RU', ?2, ?3, 20, 1200000, ?4)",
                params![format!("bulk-{index}"), sold_at, now.timestamp() - index * 3_600, raw.to_string()]
            ).unwrap();
        }
        let rule: WatchRule = serde_json::from_value(json!({"name":"tools","itemId":"tools","region":"RU"})).unwrap();
        let analysis = stack_strategy_from(&connection, &rule, 1, 20, 20, 5.0, None, now).expect("stack strategy");
        assert!(analysis.complete);
        assert_eq!(analysis.acquired_amount, 20);
        assert_eq!(analysis.purchase_lots, 20);
        assert_eq!(analysis.average_buy_unit, Some(46_000.0));
        assert_eq!(analysis.recent_bulk_median_unit, Some(60_000.0));
        assert!(analysis.roi_percent.is_some_and(|roi| roi > 20.0));
    }

    #[test]
    fn active_lot_view_uses_latest_snapshot_and_rule_match() {
        let connection = Connection::open_in_memory().expect("in-memory cache");
        prepare_cache(&connection).expect("cache schema");
        let now = chrono::DateTime::parse_from_rfc3339("2026-07-03T08:00:00Z").unwrap().with_timezone(&chrono::Utc);
        for (offset, price) in [(60, 10_i64), (0, 40_i64)] {
            let collected = now - chrono::Duration::minutes(offset);
            connection.execute(
                "INSERT INTO market_collections
                 (collected_at, collected_timestamp, item_id, region, api_total, returned_lots, complete)
                 VALUES (?1, ?2, 'tools', 'RU', 2, 2, 1)",
                params![collected.to_rfc3339(), collected.timestamp()]
            ).unwrap();
            let collection_id = connection.last_insert_rowid();
            let raw = json!({"amount": 1, "buyoutPrice": price, "endTime": "2026-07-04T08:00:00Z"});
            connection.execute(
                "INSERT INTO lot_observations
                 (collection_id, lot_key, item_id, region, amount, buyout_price, raw_json)
                 VALUES (?1, ?2, 'tools', 'RU', 1, ?3, ?4)",
                params![collection_id, format!("snapshot-{offset}"), price, raw.to_string()]
            ).unwrap();
            if offset == 0 {
                let expensive = json!({"amount": 10, "buyoutPrice": 600});
                connection.execute(
                    "INSERT INTO lot_observations
                     (collection_id, lot_key, item_id, region, amount, buyout_price, raw_json)
                     VALUES (?1, 'latest-expensive', 'tools', 'RU', 10, 600, ?2)",
                    params![collection_id, expensive.to_string()]
                ).unwrap();
            }
        }
        let rule: WatchRule = serde_json::from_value(json!({
            "name":"tools", "itemId":"tools", "region":"RU", "maxUnitBuyout":50
        })).unwrap();
        let response = active_lots_for_rules_from(&connection, &[rule], 100, now).expect("active lots");
        assert_eq!(response.total, 2);
        assert_eq!(response.lots[0].unit_price, Some(40.0));
        assert!(response.lots[0].matches_rule);
        assert_eq!(response.lots[1].unit_price, Some(60.0));
        assert!(!response.lots[1].matches_rule);
    }

    #[test]
    fn rapid_monitor_baselines_then_detects_only_new_keys() {
        let first = vec!["lot-a".to_string(), "lot-b".to_string()];
        let (baseline_fresh, remembered) = update_rapid_keys(&[], &first, true);
        assert!(baseline_fresh.is_empty());
        assert_eq!(remembered, first);

        let next = vec!["lot-c".to_string(), "lot-a".to_string()];
        let (fresh, remembered) = update_rapid_keys(&remembered, &next, false);
        assert_eq!(fresh, HashSet::from(["lot-c".to_string()]));
        assert_eq!(remembered, vec!["lot-c", "lot-a", "lot-b"]);

        let (repeated, _) = update_rapid_keys(&remembered, &next, false);
        assert!(repeated.is_empty());
    }

    #[test]
    fn rapid_monitor_rule_defaults_are_conservative() {
        let rule: WatchRule = serde_json::from_value(json!({"name":"item","itemId":"id","region":"RU"})).unwrap();
        assert!(!rule.rapid_monitor);
        assert_eq!(rule.rapid_interval_seconds, 5);
        assert_eq!(rule.rapid_limit, 5);
    }

    #[test]
    fn stackability_requires_observed_multi_item_lot() {
        assert_eq!(infer_stackability(&[1, 1, 1]).0, "unknown");
        assert_eq!(infer_stackability(&vec![1; 20]).0, "single");
        let stackable = infer_stackability(&[1, 1, 20]);
        assert_eq!(stackable.0, "stackable");
        assert_eq!(stackable.1, 1);
        assert_eq!(stackable.2, 20);
    }

    #[test]
    fn missing_lot_matches_one_schistory_sale_with_confidence() {
        let mut connection = Connection::open_in_memory().expect("in-memory cache");
        prepare_cache(&connection).expect("cache schema");
        let now = chrono::DateTime::parse_from_rfc3339("2026-07-02T12:00:00Z").unwrap().with_timezone(&chrono::Utc);
        connection.execute(
            "INSERT INTO tracked_lots
             (lot_key, item_id, region, first_seen_at, first_seen_timestamp, last_seen_at, last_seen_timestamp,
              missing_since_at, missing_since_timestamp, status, observation_count, amount, buyout_price,
              quality_code, upgrade, raw_json)
             VALUES ('lot', 'item', 'RU', ?1, ?2, ?3, ?4, ?5, ?6, 'missing', 2, 1, 100, 2, 15, '{}')",
            params![
                (now - chrono::Duration::hours(1)).to_rfc3339(), now.timestamp() - 3_600,
                (now - chrono::Duration::minutes(10)).to_rfc3339(), now.timestamp() - 600,
                now.to_rfc3339(), now.timestamp()
            ]
        ).unwrap();
        connection.execute(
            "INSERT INTO sales
             (fingerprint, item_id, region, sold_at, sold_timestamp, amount, price, quality_code, upgrade, raw_json, source, source_id)
             VALUES ('sale', 'item', 'RU', ?1, ?2, 1, 100, 2, 15, '{}', 'schistory', 'ru:99')",
            params![(now - chrono::Duration::seconds(30)).to_rfc3339(), now.timestamp() - 30]
        ).unwrap();

        assert_eq!(match_missing_lots_to_sales_in(&mut connection, "item", "RU", now).unwrap(), 1);
        let status: String = connection.query_row("SELECT status FROM tracked_lots WHERE lot_key = 'lot'", [], |row| row.get(0)).unwrap();
        let confidence: f64 = connection.query_row("SELECT confidence FROM lot_sale_matches WHERE lot_key = 'lot'", [], |row| row.get(0)).unwrap();
        assert_eq!(status, "probable_sold");
        assert!(confidence >= 0.95);
    }

    #[test]
    fn analytics_history_includes_long_schistory_records() {
        let connection = Connection::open_in_memory().expect("in-memory cache");
        prepare_cache(&connection).expect("cache schema");
        let now = chrono::DateTime::parse_from_rfc3339("2026-07-03T08:00:00Z").unwrap().with_timezone(&chrono::Utc);
        for (id, age_days) in [("within-window", 180), ("outside-window", 401)] {
            let sold_at = now - chrono::Duration::days(age_days);
            let raw = json!({
                "amount": 1,
                "price": 50_000,
                "time": sold_at.to_rfc3339(),
                "_source": "schistory"
            });
            connection.execute(
                "INSERT INTO sales
                 (fingerprint, item_id, region, sold_at, sold_timestamp, amount, price, raw_json, source, source_id)
                 VALUES (?1, 'tools', 'RU', ?2, ?3, 1, 50000, ?4, 'schistory', ?5)",
                params![id, sold_at.to_rfc3339(), sold_at.timestamp(), raw.to_string(), format!("ru:{id}")]
            ).unwrap();
        }

        let history = load_cached_history_from(
            &connection, "tools", "RU", ANALYTICS_HISTORY_DAYS, ANALYTICS_HISTORY_LIMIT, now,
        ).expect("analytics history");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].get("_source").and_then(Value::as_str), Some("schistory"));
    }

    #[test]
    fn market_snapshots_are_isolated_by_region() {
        let connection = Connection::open_in_memory().expect("in-memory cache");
        prepare_cache(&connection).expect("cache schema");
        let lots = vec![json!({"amount": 2, "buyoutPrice": 200})];
        let now = chrono::Utc::now();
        let mut ru_rule = rule_with_quality("special");
        ru_rule.artifact_qualities.clear();
        let mut eu_rule = ru_rule.clone();
        eu_rule.region = "eu".into();

        save_market_snapshot_to(&connection, &ru_rule, &lots, 1, now).expect("RU snapshot");
        save_market_snapshot_to(&connection, &eu_rule, &lots, 1, now).expect("EU snapshot");
        save_market_snapshot_to(&connection, &ru_rule, &lots, 1, now).expect("throttled RU snapshot");

        let ru_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM market_snapshots WHERE item_id = ?1 AND region = 'RU'",
            params![ru_rule.item_id], |row| row.get(0)
        ).expect("RU count");
        let eu_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM market_snapshots WHERE item_id = ?1 AND region = 'EU'",
            params![ru_rule.item_id], |row| row.get(0)
        ).expect("EU count");
        assert_eq!((ru_count, eu_count), (1, 1));
    }
}
