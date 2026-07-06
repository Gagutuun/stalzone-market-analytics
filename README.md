# STALZONE Auction Watcher

## Tauri interface

The primary desktop interface is implemented with Tauri 2, Rust, and TypeScript.

1. Keep `.env` next to `package.json` and fill in `STALZONE_CLIENT_ID` and
   `STALZONE_CLIENT_SECRET`.
2. Start the development application with `run_auction_watcher_tauri.bat`.

Useful commands:

```powershell
npm run build
npm run tauri dev
npm run tauri build
```

The catalog and item icons are loaded online from EXBO's official
`stalzone-database` repository, as prescribed by the STALCRAFT API
documentation. Auction lots and sales history are requested from the production
API at `https://eapi.stalzone.com`.

The sales history tab loads the latest 50, 100, or 200 completed sales for the
selected catalog item. Every item can be filtered by sold stack size. Artifact
history additionally supports rarity and upgrade-level filters, with chart and
table views and total/unit price modes.

The analytics tab evaluates the markets referenced by active rules. It ranks
opportunities using discount to the sales median, sales velocity, price spread,
and sample size. Each signal includes P25/median/P75 price zones, trend,
liquidity, active supply, matching lots, and explicit risk indicators.

The recommendations block converts those metrics into an explicit action:
buy now, sell now, wait for a dip, hold, or treat the market as risky. It also
uses 24-hour local supply movement when available, explains the decision, and
can prepare a new purchase rule with a suggested unit-price range.

The market movement tab reads only the local collector database. For 24-hour,
7-day, and 30-day periods it shows supply and median-price charts, appeared and
disappeared lots, average observed lifetime, collection coverage, market-state
signals, and a recent lifecycle event log. A disappeared lot is not presented as
a confirmed sale because the public auction response does not expose that fact.
Artifact rarity and upgrade filters recalculate the complete movement view,
including historical chart points, supply, price statistics, recorded sales,
lot lifecycles, and events. Existing local observations are filtered through
their stored lot metadata, so a new collection is not required.

The movement chart overlays median confirmed sale prices from the combined
STALZONE and SCHistory archive. Sales are grouped into 15-minute, one-hour, or
four-hour buckets for the 24-hour, 7-day, and 30-day views respectively. Source
counts remain visible for provenance, while both sources have equal analytical
weight after deduplication.

Stack-size presets and a custom amount range recalculate supply, asking prices,
confirmed sales, lifecycle events, and market status from the same comparable
lot population.

Missing lots are reconciled with recorded sales using a one-to-one probabilistic
match over item, region, amount, price, artifact quality, upgrade level, and a
bounded time window. A matched lifecycle is labelled `probable_sold` together
with its confidence; the underlying sale remains a confirmed API record, while
the identity link remains explicitly probabilistic because active lots have no
shared `lotId` with sales history.

## Local market archive

Sales used by analytics are stored in `market_cache.sqlite3`. The file is kept
next to the project configuration during development and next to the executable
for a standalone build. It is local-only and excluded from Git.

### SCHistory import

For artifacts, the sales-history toolbar can import a selected rarity and
upgrade range from `https://schistory.xyz`. The importer resolves the site's
numeric item id through its public catalog `externalId`, so no manual mapping is
required. Imported rows are tagged with source `schistory`; direct STALZONE API
rows retain source `stalzone_api`. The source is provenance metadata only: both
are treated as confirmed sales throughout analytics.

The import is repeatable and deduplicated by SCHistory sale id. Overlapping
recent events are matched to direct STALZONE rows by item, region, timestamp, amount,
price, rarity, and upgrade, preventing the combined history from counting both
copies. SCHistory rows extend price analytics, local charts, movement sale
counts, and strict disappeared-lot reconciliation on the same terms as direct
STALZONE rows.

- Opening analytics synchronizes history for every active rule.
- The first synchronization requests up to 1,000 recent sales per item and
  region; later runs continue incrementally and can extend the archive.
- Every sale has a stable SHA-256 fingerprint, so requesting the same API pages
  again does not create duplicate rows.
- Sales and market snapshots are always stored and queried by the composite
  market key `item_id + region`; region names are normalized to uppercase.
- Current market supply is stored as timestamped snapshots at most once every
  30 seconds per item and region.
- While monitoring is active, each unique item/region market is collected once
  per pass, with pagination up to 2,000 active lots. Individual lot observations
  are stored with first/last seen timestamps and active/missing/ended status.
- Missing status is assigned only when the API collection is complete. A market
  above the 2,000-lot safety cap remains a partial collection and cannot produce
  false disappearance events.
- The first page of recent sales is synchronized at most once every five minutes
  per item and region during monitoring.
- Rules may enable rapid monitoring with a 3-10 second interval. This path asks
  for only the five newest active lots, establishes a silent baseline on start,
  and evaluates only newly observed lot identities. Rapid responses are never
  stored as complete market snapshots and cannot produce missing/ended events.
- Rapid monitoring keeps separate per-market deduplication in
  `.auction_rapid_seen.json`, caches local 30-day sales medians for five minutes,
  and backs off according to the API rate-limit response headers.
- Analytics reads up to 100,000 cached sales from the last 400 days for each
  rule. Recent 24-hour sales still drive adaptive fair value, while the longer
  archive supplies the baseline, liquidity, stack-size, and long-term context.
- The sales history filters include an `API / Local` source switch. Local mode
  can plot or tabulate up to 5,000 cached sales for the selected item and region.

The Tauri interface reads and writes the existing `auction_watchlist.json` and
`.auction_seen.json`, so rules and notification deduplication remain compatible
with the Python version. API credentials are read only by the Rust backend and
are never exposed to the web interface.

### Opportunity scanner

The `Сканер` tab ranks the concrete item and region markets included in active
rules. Its assumptions are adjustable without collecting the market again:

- sale horizon from 1 to 14 days;
- auction commission and other exit costs;
- minimum expected net return;
- region and item-name filters.

The expected exit price starts from an adaptive fair value. With eight or more
sales in the latest 24-hour data window it uses their median; smaller fresh
samples are blended with the long-history median so one exceptional sale cannot reset
the market level. A conservative haircut then reflects recent price dispersion
and a negative trend. The UI exposes the latest sale, recent median, adaptive
value, long median, and sample sizes. Net return is calculated after configured
costs. Estimated sell-through uses sales per day relative to active lots. The
confidence grade combines sales sample size, local collection coverage, and
collection count. These values remain estimates, not a guaranteed sale price.
The scanner first finds the cheapest active lot and then calculates fair value,
trend, volatility, liquidity, and sell-through only from its comparable stack
band: 1, 2–4, 5–9, 10–19, 20–49, or 50+ items.

Each opportunity also has an `А что если?` scenario tool. It recalculates the
investment, gross revenue, net profit, return, and break-even sale price for a
custom purchase price, sale price, quantity, and expense rate. Its timing panel
uses complete local collections from the last 30 days. It ranks three-hour
windows and weekdays by the median observed minimum listing price while keeping
artifact quality, upgrade filters, region, and the computer timezone isolated.

The scenario evaluates repacking only after at least one active or confirmed
sale has demonstrated `amount > 1`. Equipment and artifacts are always treated
as single-item markets; insufficient evidence remains `unknown` and does not
enable stack advice. For confirmed stackable items it can assemble a target
quantity from whole active small lots and value the exit against completed sales
of larger stacks. The buy-lot ceiling, historical sell-stack floor, target quantity, and
maximum purchase price per unit are configurable. Cost, overshoot from buying
whole lots, fees, break-even price, expected net profit, and sample quality are
reported explicitly. Item variant and region filters remain isolated.

The `Разбор` action builds a reproducible local market report for the exact
rule variant. It compares 1/3/6/12/24-hour sale distributions, separates stack
sizes, measures current auction depth and supply change, highlights asking-price
gaps and stack premiums, and calculates conservative entry prices for 5% and
10% net return after the scanner expense rate. Every generated insight is shown
next to the underlying sample counts and percentile tables. It also includes a
default 20-unit repacking check using current lots up to 9 units and historical
sales of stacks from 20 units.

## Python watcher

The older dependency-free watcher remains available.

### Setup

1. Copy `.env.example` to `.env`.
2. Put your `STALZONE_CLIENT_ID` and `STALZONE_CLIENT_SECRET` into `.env`.
3. Copy `auction_watchlist.example.json` to `auction_watchlist.json`.
4. Replace `itemId` values with ids from `stalzone-database`.

### Run

Graphical interface:

```powershell
python .\auction_watcher_gui.py
```

Seed current lots without notifications:

```powershell
python .\auction_watcher.py --once
```

Run continuously and notify only about new lots:

```powershell
python .\auction_watcher.py --interval 60
```

Notify even for already active matching lots on first run:

```powershell
python .\auction_watcher.py --once --notify-existing
```

## Watch rule fields

- `name`: human-friendly label for notifications.
- `itemId`: STALZONE item id, for example `y1q9`.
- `scope`: `item` for one item or `category` for a catalog-wide rule.
- `category` / `itemIds`: catalog category and only the concrete items explicitly
  selected in the searchable category picker. A category is never selected in
  full automatically.
- `topN`: number of best category offers to return. Offers are ranked by unit
  price divided by the matching item's own sales median.
- `region`: `RU`, `EU`, `NA`, `SEA`, or `NEA`.
- `maxBuyout`: maximum total buyout price.
- `maxUnitBuyout`: maximum buyout price per item in a stack.
- `minAmount` / `maxAmount`: comparable stack-size range.
- `maxHistoryMedianRatio`: maximum unit price relative to median sold unit
  price. `0.85` means 85% of median.
- `maxCurrentMinRatio`: maximum unit price relative to the cheapest other active
  lot. `0.95` means 5% below current minimum.
- `minAmount`: minimum stack size.
- `artifactQualities`: selected artifact rarities: `common`, `uncommon`,
  `special`, `rare`, `exceptional`, and `legendary`.
- `minUpgrade` / `maxUpgrade`: artifact upgrade/potential range. Values such as
  `10` or `+10` are accepted when the API provides upgrade data.
- `limit`: auction page size, maximum `200`.
- `sort`: `time_created`, `time_left`, `current_price`, or `buyout_price`.
- `order`: `asc` or `desc`.
- `rapidMonitor`: enables the newest-lot polling path for this rule.
- `rapidIntervalSeconds`: polling interval from 3 to 10 seconds; default `5`.
- `rapidLimit`: number of newest lots requested per item; the UI uses `5`.

Notifications always print to the application log. Telegram and Discord are
enabled when their optional environment variables are set.

## Optional AI analysis

Deal cards in the Scanner include an `AI analysis` action. The model receives a
compact JSON summary of the already calculated market metrics and returns a
structured explanation. It does not receive STALCRAFT credentials or the full
SQLite database. AI is never contacted during application startup or when the
dialog opens; a request is sent only after the user presses `Analyze`.

The default provider is Ollama:

```powershell
ollama pull gemma3:4b
ollama serve
```

The default endpoint is `http://127.0.0.1:11434/api/chat`. Local and remote
HTTP/HTTPS Ollama or OpenAI-compatible servers are supported. Enter a remote
endpoint such as `https://models.example.com/v1/chat/completions` and an
optional Bearer API key. Endpoint and model settings are stored locally; the
API key exists only in the input until the dialog or application is closed.
HTTP redirects are not followed, so the final API endpoint must be entered
directly. LM Studio's native `/api/v1/chat` address is automatically mapped to
its OpenAI-compatible `/v1/chat/completions` route; use the exact model id
returned by `/v1/models`.

The model is an interpretation layer only. Prices, samples, ROI, liquidity,
and data quality continue to be calculated deterministically by the app.
The AI request is deliberately blind to the app's recommendation, opportunity
score, target range, expected resale price, ROI, and warnings. It receives
observed offers, confirmed sales, price windows, market depth, stackability,
fees, and data coverage. After the response, the UI compares the independent
AI action with the deterministic advisor and highlights agreement or conflict.

Category rules use one auction endpoint per concrete item. To avoid excessive
API traffic, starting monitoring with at least one category rule enforces a
minimum full-market interval of five minutes. Rapid monitoring is independent
of that full pass and allows at most 15 selected item/region markets. Because it
does not read the cheapest side of the complete market, `maxCurrentMinRatio` is
disabled for rapid rules; absolute prices and cached sales-median ratios remain
available.

## Deferred improvements

- Add automatic local database retention without changing confirmed sales:
  retain every raw market collection for 7 days, downsample days 8-30 to one
  collection per item/region/hour, delete raw observations older than 30 days,
  and retain compact market snapshots for up to 90 days.
- Run retention at most once per day and expose a manual `Clean and compact
  database` action. Compaction must be explicit or infrequent because SQLite
  `VACUUM` temporarily locks the database and needs additional free disk space.
- Show the projected database growth and the amount of space recoverable before
  cleanup, while keeping the region boundaries intact.
