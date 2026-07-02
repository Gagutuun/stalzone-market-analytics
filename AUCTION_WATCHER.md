# STALZONE Auction Watcher

## Tauri interface

The primary desktop interface is now implemented with Tauri 2, Rust and TypeScript.

1. Keep `.env` next to `package.json` and fill in `STALZONE_CLIENT_ID` and `STALZONE_CLIENT_SECRET`.
2. Start the development application with `run_auction_watcher_tauri.bat`.

Useful commands:

```powershell
npm run build
npm run tauri dev
npm run tauri build
```

The catalog and item icons are loaded online from EXBO's official
`stalzone-database` repository, as prescribed by the STALCRAFT API documentation.
Auction lots and history are requested from `https://eapi.stalcraft.net`.

The `История продаж` tab loads the latest 50, 100, or 200 completed sales for the
selected catalog item. Every item can be filtered by sold stack size. Artifact
history additionally supports rarity and upgrade-level filters, with chart and
table views and total/unit price modes.

The `Аналитика` tab evaluates the markets referenced by active rules. It ranks
opportunities using discount to the sales median, sales velocity, price spread,
and sample size. Each signal includes P25/median/P75 price zones, trend,
liquidity, active supply, matching lots, and explicit risk indicators.

The Tauri interface reads and writes the existing `auction_watchlist.json` and
`.auction_seen.json`, so rules and notification deduplication remain compatible
with the Python version. API credentials are read only by the Rust backend and
are never exposed to the web interface.

Small dependency-free Python script for watching STALZONE auction lots.

## Setup

1. Copy `.env.example` to `.env`.
2. Put your `STALZONE_CLIENT_ID` and `STALZONE_CLIENT_SECRET` into `.env`.
3. Copy `auction_watchlist.example.json` to `auction_watchlist.json`.
4. Replace `itemId` values with ids from `stalzone-database`.

## Run

Graphical interface:

```powershell
python .\auction_watcher_gui.py
```

When a matching lot is found in the GUI, it is written to the log and shown in a separate `Найденные лоты` window with price, stack size, unit price, current bid, artifact tier, upgrade level, and end time.

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

## Watch Rule Fields

- `name`: human-friendly label for notifications.
- `itemId`: STALZONE item id, for example `y1q9`.
- `region`: `RU`, `EU`, `NA`, `SEA`, or `NEA`.
- `maxBuyout`: maximum total buyout price.
- `maxUnitBuyout`: maximum buyout price per item in a stack.
- `maxHistoryMedianRatio`: maximum unit price relative to median sold unit price from auction history. `0.85` means 85% of median.
- `maxCurrentMinRatio`: maximum unit price relative to the cheapest other active lot. `0.95` means 5% below current minimum.
- `minAmount`: minimum stack size.
- `artifactQualities`: selected artifact rarities. Supported values are `common`, `uncommon`, `special`, `rare`, `exceptional`, and `legendary`.
- `minUpgrade` / `maxUpgrade`: artifact upgrade/potential range. Values like `10` or `+10` are accepted when the API provides upgrade data.
- `limit`: auction page size, max `200`.
- `sort`: `time_created`, `time_left`, `current_price`, or `buyout_price`.
- `order`: `asc` or `desc`.

Notifications always print to console. Telegram and Discord are enabled when their optional environment variables are set.
