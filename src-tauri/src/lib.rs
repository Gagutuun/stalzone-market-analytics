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
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub group_top_n: Option<usize>,
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
struct MovementPoint {
    time: i64,
    supply: i64,
    min_unit: Option<f64>,
    median_unit: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MovementEvent {
    kind: String,
    time: String,
    amount: i64,
    buyout: Option<i64>,
    unit_price: Option<f64>,
    lifetime_minutes: Option<f64>,
    confidence: Option<f64>,
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
    official_sales: u64,
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
            let base = format!("{:x}", Sha256::digest(format!("{region}|{item_id}|{raw}").as_bytes()));
            let occurrence = occurrences.entry(base.clone()).or_default();
            let fingerprint = if *occurrence == 0 { base } else { format!("{base}#{}", *occurrence) };
            *occurrence += 1;
            inserted += statement.execute(params![
                fingerprint, item_id, &region, time, timestamp, amount(row), row_price,
                lot_quality_code(row), lot_upgrade(row), raw
            ]).map_err(|error| error.to_string())?;
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;
    match_missing_lots_to_sales(item_id, &region)?;
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

fn collection_unit_prices(connection: &Connection, collection_id: i64) -> Result<Vec<f64>, String> {
    let mut statement = connection.prepare(
        "SELECT CAST(buyout_price AS REAL) / amount FROM lot_observations
         WHERE collection_id = ?1 AND buyout_price > 0 AND amount > 0"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![collection_id], |row| row.get::<_, f64>(0))
        .map_err(|error| error.to_string())?;
    Ok(rows.filter_map(Result::ok).collect())
}

#[tauri::command]
fn market_movement(hours: i64, region: String) -> Result<MarketMovementResponse, String> {
    reconcile_all_sale_matches()?;
    let connection = open_cache()?;
    market_movement_from(&connection, hours, region, chrono::Utc::now())
}

fn market_movement_from(
    connection: &Connection,
    hours: i64,
    region: String,
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
        for (collection_id, collected_at, timestamp, supply) in sampled_collections {
            let prices = collection_unit_prices(connection, collection_id)?;
            last_collected = collected_at;
            points.push(MovementPoint {
                time: timestamp,
                supply,
                min_unit: prices.iter().copied().min_by(f64::total_cmp),
                median_unit: median(&prices),
            });
        }
        let appeared = connection.query_row(
            "SELECT COUNT(*) FROM tracked_lots WHERE item_id = ?1 AND region = ?2 AND first_seen_timestamp >= ?3",
            params![&item_id, &market_region, cutoff], |row| row.get::<_, u64>(0)
        ).unwrap_or_default();
        let disappeared = connection.query_row(
            "SELECT COUNT(*) FROM tracked_lots WHERE item_id = ?1 AND region = ?2 AND missing_since_timestamp >= ?3",
            params![&item_id, &market_region, cutoff], |row| row.get::<_, u64>(0)
        ).unwrap_or_default();
        let official_sales = connection.query_row(
            "SELECT COUNT(*) FROM sales WHERE item_id = ?1 AND region = ?2 AND sold_timestamp >= ?3",
            params![&item_id, &market_region, cutoff], |row| row.get::<_, u64>(0)
        ).unwrap_or_default();
        let probable_sales = connection.query_row(
            "SELECT COUNT(*) FROM tracked_lots WHERE item_id = ?1 AND region = ?2
             AND status = 'probable_sold' AND missing_since_timestamp >= ?3",
            params![&item_id, &market_region, cutoff], |row| row.get::<_, u64>(0)
        ).unwrap_or_default();
        let unexplained_missing = connection.query_row(
            "SELECT COUNT(*) FROM tracked_lots WHERE item_id = ?1 AND region = ?2
             AND status = 'missing' AND missing_since_timestamp >= ?3",
            params![&item_id, &market_region, cutoff], |row| row.get::<_, u64>(0)
        ).unwrap_or_default();
        let ended = connection.query_row(
            "SELECT COUNT(*) FROM tracked_lots WHERE item_id = ?1 AND region = ?2 AND status = 'ended' AND end_timestamp >= ?3",
            params![&item_id, &market_region, cutoff], |row| row.get::<_, u64>(0)
        ).unwrap_or_default();
        let active_lots = connection.query_row(
            "SELECT COUNT(*) FROM tracked_lots WHERE item_id = ?1 AND region = ?2 AND status = 'active'",
            params![&item_id, &market_region], |row| row.get::<_, u64>(0)
        ).unwrap_or_default();
        let average_lifetime_minutes = connection.query_row(
            "SELECT AVG(CASE
               WHEN status IN ('missing', 'probable_sold') THEN missing_since_timestamp - first_seen_timestamp
               WHEN status = 'ended' THEN end_timestamp - first_seen_timestamp END) / 60.0
             FROM tracked_lots WHERE item_id = ?1 AND region = ?2 AND status IN ('missing', 'probable_sold', 'ended')
               AND COALESCE(missing_since_timestamp, end_timestamp) >= ?3",
            params![&item_id, &market_region, cutoff], |row| row.get::<_, Option<f64>>(0)
        ).unwrap_or(None);
        let mut events = Vec::new();
        {
            let mut statement = connection.prepare(
                "SELECT t.first_seen_at, t.first_seen_timestamp, t.missing_since_at, t.missing_since_timestamp,
                        t.status, t.end_time, t.end_timestamp, t.amount, t.buyout_price, m.confidence, s.sold_at
                 FROM tracked_lots t
                 LEFT JOIN lot_sale_matches m ON m.lot_key = t.lot_key
                 LEFT JOIN sales s ON s.fingerprint = m.sale_fingerprint
                 WHERE t.item_id = ?1 AND t.region = ?2
                   AND (first_seen_timestamp >= ?3 OR missing_since_timestamp >= ?3
                        OR (status = 'ended' AND end_timestamp >= ?3))
                 ORDER BY MAX(first_seen_timestamp, COALESCE(missing_since_timestamp, 0), COALESCE(end_timestamp, 0)) DESC
                 LIMIT 100"
            ).map_err(|error| error.to_string())?;
            type EventRow = (String, i64, Option<String>, Option<i64>, String, Option<String>, Option<i64>, i64, Option<i64>, Option<f64>, Option<String>);
            let rows = statement.query_map(params![&item_id, &market_region, cutoff], |row| Ok(EventRow::from((
                row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?,
                row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?, row.get(9)?, row.get(10)?
            )))).map_err(|error| error.to_string())?;
            for row in rows.filter_map(Result::ok) {
                let (first_at, first_ts, missing_at, missing_ts, status, end_at, end_ts, amount, buyout, confidence, sold_at) = row;
                let unit_price = buyout.filter(|price| *price > 0).filter(|_| amount > 0).map(|price| price as f64 / amount as f64);
                if first_ts >= cutoff {
                    events.push(MovementEvent { kind: "appeared".into(), time: first_at, amount, buyout, unit_price, lifetime_minutes: None, confidence: None });
                }
                if status == "missing" || status == "probable_sold" {
                    if let (Some(time), Some(timestamp)) = (missing_at, missing_ts) {
                        events.push(MovementEvent { kind: if status == "probable_sold" { "probable_sale".into() } else { "missing".into() },
                            time: sold_at.unwrap_or(time), amount, buyout, unit_price,
                            lifetime_minutes: Some((timestamp - first_ts).max(0) as f64 / 60.0), confidence });
                    }
                } else if status == "ended" {
                    if let (Some(time), Some(timestamp)) = (end_at, end_ts) {
                        events.push(MovementEvent { kind: "ended".into(), time, amount, buyout, unit_price,
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
            price_change_percent, appeared, disappeared, official_sales, probable_sales, unexplained_missing, ended, active_lots,
            average_lifetime_minutes, collections: collection_stats.0,
            coverage_percent: collection_stats.1 as f64 / collection_stats.0 as f64 * 100.0,
            last_collected, signal, points, events,
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
            let collection = match request_lots_for_collection(rule, 1_000).await {
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
        .manage(AppState { check_lock: tokio::sync::Mutex::new(()) })
        .invoke_handler(tauri::generate_handler![credentials_status, cache_status, sync_market_cache, load_catalog, read_image, analyze_market, sales_history, market_movement, market_analytics, check_rules, load_rules, save_rules])
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

        let response = market_movement_from(&connection, 24, "all".into(), now).expect("movement response");
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
    fn missing_lot_matches_one_official_sale_with_confidence() {
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
             (fingerprint, item_id, region, sold_at, sold_timestamp, amount, price, quality_code, upgrade, raw_json)
             VALUES ('sale', 'item', 'RU', ?1, ?2, 1, 100, 2, 15, '{}')",
            params![(now - chrono::Duration::seconds(30)).to_rfc3339(), now.timestamp() - 30]
        ).unwrap();

        assert_eq!(match_missing_lots_to_sales_in(&mut connection, "item", "RU", now).unwrap(), 1);
        let status: String = connection.query_row("SELECT status FROM tracked_lots WHERE lot_key = 'lot'", [], |row| row.get(0)).unwrap();
        let confidence: f64 = connection.query_row("SELECT confidence FROM lot_sale_matches WHERE lot_key = 'lot'", [], |row| row.get(0)).unwrap();
        assert_eq!(status, "probable_sold");
        assert!(confidence >= 0.95);
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
