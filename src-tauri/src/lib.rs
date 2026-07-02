use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, USER_AGENT};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    env, fs,
    path::{Path, PathBuf},
};

const API_BASE: &str = "https://eapi.stalzone.com";
const ITEMS_BASE: &str = "https://raw.githubusercontent.com/EXBO-Studio/stalzone-database/main";
const CONFIG_FILE: &str = "auction_watchlist.json";
const STATE_FILE: &str = ".auction_seen.json";
const CACHE_FILE: &str = "market_cache.sqlite3";

struct AppState {
    check_lock: tokio::sync::Mutex<()>,
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
}

fn default_history_limit() -> usize { 100 }
fn default_limit() -> usize { 50 }
fn default_true() -> bool { true }
fn default_sort() -> String { "time_created".into() }
fn default_order() -> String { "desc".into() }

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
    active_lots: usize,
    matching_lots: usize,
    sales_sample: usize,
    sold_amount: i64,
    current_min_unit: Option<f64>,
    median_unit: Option<f64>,
    average_unit: Option<f64>,
    p25_unit: Option<f64>,
    p75_unit: Option<f64>,
    discount_percent: Option<f64>,
    trend_percent: Option<f64>,
    volatility_percent: Option<f64>,
    sales_per_day: Option<f64>,
    average_sale_interval_minutes: Option<f64>,
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckResult {
    checked_rules: usize,
    notifications: usize,
    matches: Vec<MatchRecord>,
    summaries: Vec<RuleSummary>,
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
         CREATE INDEX IF NOT EXISTS snapshots_item_time ON market_snapshots(item_id, region, captured_timestamp DESC);"
    ).map_err(|error| format!("Не удалось подготовить локальную базу: {error}"))?;
    Ok(())
}

fn save_history_rows(item_id: &str, region: &str, rows: &[Value]) -> Result<usize, String> {
    let region = region.to_ascii_uppercase();
    let mut connection = open_cache()?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    let mut inserted = 0;
    {
        let mut statement = transaction.prepare(
            "INSERT OR IGNORE INTO sales
             (fingerprint, item_id, region, sold_at, sold_timestamp, amount, price, quality_code, upgrade, raw_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
        ).map_err(|error| error.to_string())?;
        for row in rows {
            let Some(time) = row.get("time").and_then(Value::as_str) else { continue };
            let Some(timestamp) = chrono::DateTime::parse_from_rfc3339(time).ok().map(|value| value.timestamp()) else { continue };
            let Some(row_price) = price(row, "price").filter(|value| *value > 0) else { continue };
            let raw = serde_json::to_string(row).map_err(|error| error.to_string())?;
            let fingerprint = format!("{:x}", Sha256::digest(format!("{region}|{item_id}|{raw}").as_bytes()));
            inserted += statement.execute(params![
                fingerprint, item_id, &region, time, timestamp, amount(row), row_price,
                lot_quality_code(row), lot_upgrade(row), raw
            ]).map_err(|error| error.to_string())?;
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(inserted)
}

fn load_cached_history(item_id: &str, region: &str, days: i64, limit: usize) -> Result<Vec<Value>, String> {
    let region = region.to_ascii_uppercase();
    let connection = open_cache()?;
    let cutoff = chrono::Utc::now().timestamp() - days.max(1) * 86_400;
    let mut statement = connection.prepare(
        "SELECT raw_json FROM sales WHERE item_id = ?1 AND region = ?2 AND sold_timestamp >= ?3
         ORDER BY sold_timestamp DESC LIMIT ?4"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![item_id, region, cutoff, limit as i64], |row| row.get::<_, String>(0))
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
    let oldest_sale = connection.query_row("SELECT MIN(sold_at) FROM sales", [], |row| row.get::<_, Option<String>>(0)).unwrap_or(None);
    let newest_sale = connection.query_row("SELECT MAX(sold_at) FROM sales", [], |row| row.get::<_, Option<String>>(0)).unwrap_or(None);
    Ok(CacheStatus {
        sales, snapshots, items, oldest_sale, newest_sale,
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
fn price(lot: &Value, key: &str) -> Option<i64> { parse_i64(lot.get(key)) }
fn unit_price(lot: &Value, key: &str) -> Option<f64> {
    let count = amount(lot);
    let total = price(lot, key)?;
    (count > 0 && total > 0).then_some(total as f64 / count as f64)
}

fn variant_matches(rule: &WatchRule, lot: &Value) -> bool {
    let count = amount(lot);
    if rule.min_amount.is_some_and(|min| count < min) { return false; }
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

async fn request_collection(rule: &WatchRule, history: bool) -> Result<Vec<Value>, String> {
    if history { return Ok(request_history_page(rule, rule.history_limit, 0).await?.1); }
    let headers = api_headers()?;
    let limit = rule.limit.min(200);
    let url = format!("{API_BASE}/{}/auction/{}/lots?limit={limit}&additional={}&sort={}&order={}",
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
    Ok(payload.get("lots").and_then(Value::as_array).cloned().unwrap_or_default())
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

#[tauri::command]
async fn market_analytics(rules: Vec<WatchRule>) -> Result<MarketAnalyticsResponse, String> {
    let mut insights = Vec::new();
    for original_rule in rules {
        let mut rule = original_rule.clone();
        rule.limit = 200;
        rule.history_limit = 200;
        let lots = request_collection(&rule, false).await?;
        sync_history_for_rule(&rule).await?;
        let history = load_cached_history(&rule.item_id, &rule.region, 30, 20_000)?;
        let comparable_lots: Vec<&Value> = lots.iter().filter(|lot| variant_matches(&rule, lot)).collect();
        let comparable_history: Vec<&Value> = history.iter().filter(|lot| variant_matches(&rule, lot)).collect();
        let current_units: Vec<f64> = comparable_lots.iter().filter_map(|lot| unit_price(lot, "buyoutPrice")).collect();
        let history_units: Vec<f64> = comparable_history.iter().filter_map(|lot| unit_price(lot, "price")).collect();
        let current_min = current_units.iter().copied().min_by(f64::total_cmp);
        let history_median = median(&history_units);
        let average = (!history_units.is_empty()).then(|| history_units.iter().sum::<f64>() / history_units.len() as f64);
        let p25 = percentile(&history_units, 0.25);
        let p75 = percentile(&history_units, 0.75);
        let discount = current_min.zip(history_median).and_then(|(current, market)|
            (market > 0.0).then_some((market - current) / market * 100.0));
        let volatility = p25.zip(p75).zip(history_median).and_then(|((low, high), market)|
            (market > 0.0).then_some((high - low) / market * 100.0));

        let mut timed_prices: Vec<(i64, f64)> = comparable_history.iter().filter_map(|row| {
            let time = row.get("time").and_then(Value::as_str)?;
            let timestamp = chrono::DateTime::parse_from_rfc3339(time).ok()?.timestamp();
            Some((timestamp, unit_price(row, "price")?))
        }).collect();
        timed_prices.sort_by(|a, b| b.0.cmp(&a.0));
        let middle = timed_prices.len() / 2;
        let newest: Vec<f64> = timed_prices.iter().take(middle.max(1)).map(|(_, price)| *price).collect();
        let older: Vec<f64> = timed_prices.iter().skip(middle.max(1)).map(|(_, price)| *price).collect();
        let trend = median(&newest).zip(median(&older)).and_then(|(recent, previous)|
            (previous > 0.0).then_some((recent - previous) / previous * 100.0));
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
        if discount.is_some_and(|value| value < 0.0) { risks.push("Минимум выше медианы".into()); }
        if comparable_lots.len() <= 2 { risks.push("Мало активных предложений".into()); }

        let matching_lots = comparable_lots.iter().filter(|lot| lot_matches(&rule, lot, &current_units, history_median)).count();
        save_market_snapshot(&rule, &lots, matching_lots)?;
        insights.push(MarketInsight {
            name: rule.name, item_id: rule.item_id, region: rule.region,
            active_lots: comparable_lots.len(), matching_lots, sales_sample: history_units.len(),
            sold_amount: comparable_history.iter().map(|row| amount(row)).sum(),
            current_min_unit: current_min, median_unit: history_median, average_unit: average,
            p25_unit: p25, p75_unit: p75, discount_percent: discount, trend_percent: trend,
            volatility_percent: volatility, sales_per_day, average_sale_interval_minutes: average_interval,
            opportunity_score: score, liquidity, verdict, risks,
        });
    }
    insights.sort_by(|a, b| b.opportunity_score.cmp(&a.opportunity_score));
    Ok(MarketAnalyticsResponse { generated_at: chrono::Utc::now().to_rfc3339(), insights })
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

    for rule in &rules {
        let lots = request_collection(rule, false).await?;
        let current: Vec<f64> = lots.iter().filter(|lot| variant_matches(rule, lot)).filter_map(|lot| unit_price(lot, "buyoutPrice")).collect();
        let history_median = if rule.max_history_median_ratio.is_some() {
            let history = request_collection(rule, true).await?;
            let values: Vec<f64> = history.iter().filter(|lot| variant_matches(rule, lot)).filter_map(|lot| unit_price(lot, "price")).collect();
            median(&values)
        } else { None };
        let comparable: Vec<&Value> = lots.iter().filter(|lot| variant_matches(rule, lot)).collect();
        let matching_lots = comparable.iter().filter(|lot| lot_matches(rule, lot, &current, history_median)).count();
        save_market_snapshot(rule, &lots, matching_lots)?;
        summaries.push(RuleSummary {
            name: rule.name.clone(), item_id: rule.item_id.clone(), region: rule.region.clone(),
            total_lots: lots.len(), comparable_lots: comparable.len(), matching_lots,
            current_min_buyout: comparable.iter().filter_map(|lot| price(lot, "buyoutPrice")).min(),
            current_min_unit: comparable.iter().filter_map(|lot| unit_price(lot, "buyoutPrice")).min_by(f64::total_cmp),
            history_median_unit: history_median,
            checked_at: chrono::Utc::now().to_rfc3339(),
        });
        for lot in &lots {
            let key = lot_key(rule, lot);
            let already_seen = seen.contains(&key);
            if already_seen && !include_seen { continue; }
            if !already_seen { updated.insert(key); }
            if (notify_existing || include_seen) && lot_matches(rule, lot, &current, history_median) {
                let message = format_lot(rule, lot);
                if !already_seen { send_external_notifications(&message).await; }
                matches.push(MatchRecord {
                    name: rule.name.clone(), region: rule.region.clone(), item_id: rule.item_id.clone(),
                    quality: lot_quality_code(lot).and_then(quality_label).map(str::to_string),
                    upgrade: lot_upgrade(lot), amount: amount(lot),
                    buyout: price(lot, "buyoutPrice").filter(|value| *value > 0), unit: unit_price(lot, "buyoutPrice"),
                    current: price(lot, "currentPrice"), end: lot.get("endTime").and_then(Value::as_str).unwrap_or_default().into(), message,
                });
            }
        }
    }
    let mut seen_values: Vec<String> = updated.into_iter().collect();
    seen_values.sort();
    if seen_values.len() > 5000 { seen_values.drain(..seen_values.len() - 5000); }
    seen_state.seen = seen_values;
    seen_state.updated_at = Some(chrono::Utc::now().to_rfc3339());
    fs::write(&state_path, serde_json::to_string_pretty(&seen_state).map_err(|e| e.to_string())?)
        .map_err(|error| format!("Не удалось сохранить состояние: {error}"))?;
    Ok(CheckResult { checked_rules: rules.len(), notifications: matches.len(), matches, summaries })
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
        .manage(AppState { check_lock: tokio::sync::Mutex::new(()) })
        .invoke_handler(tauri::generate_handler![credentials_status, cache_status, sync_market_cache, load_catalog, read_image, analyze_market, sales_history, market_analytics, check_rules, load_rules, save_rules])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

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
