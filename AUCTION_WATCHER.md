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

## Local market archive

Sales used by analytics are stored in `market_cache.sqlite3`. The file is kept
next to the project configuration during development and next to the executable
for a standalone build. It is local-only and excluded from Git.

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
  per pass, with pagination up to 1,000 active lots. Individual lot observations
  are stored with first/last seen timestamps and active/missing/ended status.
- Missing status is assigned only when the API collection is complete. A market
  above the 1,000-lot safety cap remains a partial collection and cannot produce
  false disappearance events.
- The first page of recent sales is synchronized at most once every five minutes
  per item and region during monitoring.
- Analytics currently reads up to 20,000 cached sales from the last 30 days for
  each rule. The raw API response is retained in SQLite for future metrics.
- The sales history filters include an `API / Local` source switch. Local mode
  can plot or tabulate up to 5,000 cached sales for the selected item and region.

The Tauri interface reads and writes the existing `auction_watchlist.json` and
`.auction_seen.json`, so rules and notification deduplication remain compatible
with the Python version. API credentials are read only by the Rust backend and
are never exposed to the web interface.

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
- `region`: `RU`, `EU`, `NA`, `SEA`, or `NEA`.
- `maxBuyout`: maximum total buyout price.
- `maxUnitBuyout`: maximum buyout price per item in a stack.
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

Notifications always print to the application log. Telegram and Discord are
enabled when their optional environment variables are set.
