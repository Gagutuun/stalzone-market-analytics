#!/usr/bin/env python3
"""
Polls STALZONE auction lots and notifies when watched items appear.

Secrets are read from environment variables or a local .env file.
The script intentionally has no third-party dependencies.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


API_BASE = "https://eapi.stalzone.com"
DEFAULT_CONFIG = "auction_watchlist.json"
DEFAULT_STATE = ".auction_seen.json"
APP_DIR = Path(__file__).resolve().parent
PLACEHOLDER_VALUES = {
    "your_client_id",
    "your_client_secret",
    "client_id",
    "client_secret",
    "id",
    "secret",
}


@dataclass
class WatchRule:
    name: str
    item_id: str
    region: str
    max_buyout: int | None = None
    max_unit_buyout: int | None = None
    max_history_median_ratio: float | None = None
    max_current_min_ratio: float | None = None
    history_limit: int = 100
    min_amount: int | None = None
    min_tier: int | None = None
    max_tier: int | None = None
    min_upgrade: int | None = None
    max_upgrade: int | None = None
    sort: str = "time_created"
    order: str = "desc"
    limit: int = 20
    additional: bool = True


def load_dotenv(path: Path, override: bool = False) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if override or key not in os.environ:
            os.environ[key] = value


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing {name}. Put it in .env or environment variables.")
    return value


def is_placeholder_secret(value: str | None) -> bool:
    if value is None:
        return True
    normalized = value.strip().lower()
    return not normalized or normalized in PLACEHOLDER_VALUES or normalized.startswith("your_")


def build_api_headers(user_agent: str) -> dict[str, str]:
    client_id = os.environ.get("STALZONE_CLIENT_ID")
    client_secret = os.environ.get("STALZONE_CLIENT_SECRET")
    invalid: list[str] = []
    if is_placeholder_secret(client_id):
        invalid.append("STALZONE_CLIENT_ID")
    if is_placeholder_secret(client_secret):
        invalid.append("STALZONE_CLIENT_SECRET")
    if invalid:
        names = ", ".join(invalid)
        raise RuntimeError(f"Invalid API credentials in .env: replace placeholder values for {names}.")
    return {
        "Client-Id": client_id or "",
        "Client-Secret": client_secret or "",
        "Accept": "application/json",
        "User-Agent": user_agent,
    }


def read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {path}: {exc}") from exc


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_rules(path: Path) -> list[WatchRule]:
    payload = read_json(path, None)
    if payload is None:
        raise SystemExit(f"Config not found: {path}")
    items = payload.get("items", [])
    if not isinstance(items, list) or not items:
        raise SystemExit(f"{path} must contain a non-empty 'items' list.")

    defaults = payload.get("defaults", {})
    rules: list[WatchRule] = []
    for entry in items:
        item_id = entry.get("itemId") or entry.get("item_id")
        if not item_id:
            raise SystemExit("Every watched item needs itemId.")
        region = (entry.get("region") or defaults.get("region") or "EU").upper()
        rules.append(
            WatchRule(
                name=entry.get("name") or item_id,
                item_id=item_id,
                region=region,
                max_buyout=parse_price(entry.get("maxBuyout") or entry.get("max_buyout")),
                max_unit_buyout=parse_price(entry.get("maxUnitBuyout") or entry.get("max_unit_buyout")),
                max_history_median_ratio=parse_float(
                    entry.get("maxHistoryMedianRatio") or entry.get("max_history_median_ratio")
                ),
                max_current_min_ratio=parse_float(entry.get("maxCurrentMinRatio") or entry.get("max_current_min_ratio")),
                history_limit=int(entry.get("historyLimit") or entry.get("history_limit") or 100),
                min_amount=parse_price(entry.get("minAmount") or entry.get("min_amount")),
                min_tier=parse_level(entry.get("minTier") or entry.get("min_tier")),
                max_tier=parse_level(entry.get("maxTier") or entry.get("max_tier")),
                min_upgrade=parse_level(entry.get("minUpgrade") or entry.get("min_upgrade")),
                max_upgrade=parse_level(entry.get("maxUpgrade") or entry.get("max_upgrade")),
                sort=entry.get("sort") or defaults.get("sort") or "time_created",
                order=entry.get("order") or defaults.get("order") or "desc",
                limit=int(entry.get("limit") or defaults.get("limit") or 20),
                additional=bool(entry.get("additional", defaults.get("additional", True))),
            )
        )
    return rules


def request_json(url: str, headers: dict[str, str], timeout: int = 20) -> Any:
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read().decode("utf-8")
            return json.loads(data)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} for {url}: {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error for {url}: {exc}") from exc


def parse_price(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, str):
        value = value.replace(" ", "").replace("_", "")
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def parse_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, str):
        value = value.replace(",", ".").strip()
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_level(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip().lower()
    if not text:
        return None
    roman = {
        "i": 1,
        "ii": 2,
        "iii": 3,
        "iv": 4,
        "v": 5,
        "vi": 6,
    }
    if text in roman:
        return roman[text]
    digits = "".join(char for char in text if char.isdigit())
    if not digits:
        return None
    return int(digits)


def nested_values(payload: Any, aliases: set[str]) -> list[Any]:
    values: list[Any] = []
    if isinstance(payload, dict):
        for key, value in payload.items():
            if str(key).lower() in aliases:
                values.append(value)
            values.extend(nested_values(value, aliases))
    elif isinstance(payload, list):
        for value in payload:
            values.extend(nested_values(value, aliases))
    return values


def lot_tier(lot: dict[str, Any]) -> int | None:
    aliases = {
        "tier",
        "artifacttier",
        "artefacttier",
        "quality",
        "qualitylevel",
        "grade",
        "q",
    }
    for value in nested_values(lot, aliases):
        parsed = parse_level(value)
        if parsed is not None:
            return parsed
    return None


def lot_upgrade(lot: dict[str, Any]) -> int | None:
    aliases = {
        "upgrade",
        "upgradelevel",
        "enhancement",
        "enhancementlevel",
        "level",
        "potential",
        "potentiallevel",
        "ptn",
    }
    for value in nested_values(lot, aliases):
        parsed = parse_level(value)
        if parsed is not None:
            return parsed
    return None


def median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def lot_key(rule: WatchRule, lot: dict[str, Any]) -> str:
    parts = [
        rule.region,
        rule.item_id,
        str(lot.get("amount")),
        str(lot.get("startTime")),
        str(lot.get("endTime")),
        str(lot.get("currentPrice")),
        str(lot.get("buyoutPrice")),
        json.dumps(lot.get("additional", {}), ensure_ascii=False, sort_keys=True),
    ]
    return "|".join(parts)


def matches_variant_filters(rule: WatchRule, lot: dict[str, Any]) -> bool:
    amount = int(lot.get("amount") or 0)
    if rule.min_amount is not None and amount < rule.min_amount:
        return False

    if rule.min_tier is not None or rule.max_tier is not None:
        tier = lot_tier(lot)
        if tier is None:
            return False
        if rule.min_tier is not None and tier < rule.min_tier:
            return False
        if rule.max_tier is not None and tier > rule.max_tier:
            return False

    if rule.min_upgrade is not None or rule.max_upgrade is not None:
        upgrade = lot_upgrade(lot)
        if upgrade is None:
            return False
        if rule.min_upgrade is not None and upgrade < rule.min_upgrade:
            return False
        if rule.max_upgrade is not None and upgrade > rule.max_upgrade:
            return False

    return True


def matches_rule(rule: WatchRule, lot: dict[str, Any], market: dict[str, Any] | None = None) -> bool:
    amount = int(lot.get("amount") or 0)
    buyout = parse_price(lot.get("buyoutPrice"))
    unit_buyout = buyout / amount if buyout is not None and amount > 0 else None

    if not matches_variant_filters(rule, lot):
        return False
    if rule.max_buyout is not None and (buyout is None or buyout > rule.max_buyout):
        return False
    if rule.max_unit_buyout is not None:
        if unit_buyout is None:
            return False
        if unit_buyout > rule.max_unit_buyout:
            return False
    if market and rule.max_history_median_ratio is not None:
        history_median = market.get("historyMedianUnit")
        if unit_buyout is None or history_median is None:
            return False
        if unit_buyout > history_median * rule.max_history_median_ratio:
            return False
    if market and rule.max_current_min_ratio is not None:
        current_min = market.get("currentMinUnit")
        current_units = list(market.get("currentUnitPrices") or [])
        if unit_buyout is not None and current_units:
            remaining = current_units[:]
            closest_index = min(range(len(remaining)), key=lambda idx: abs(remaining[idx] - unit_buyout))
            remaining.pop(closest_index)
            if remaining:
                current_min = min(remaining)
        if unit_buyout is None or current_min is None:
            return False
        if unit_buyout > current_min * rule.max_current_min_ratio:
            return False
    return True


def fetch_lots(rule: WatchRule, headers: dict[str, str]) -> list[dict[str, Any]]:
    query = {
        "limit": str(max(0, min(rule.limit, 200))),
        "sort": rule.sort,
        "order": rule.order,
        "additional": "true" if rule.additional else "false",
    }
    encoded_item = urllib.parse.quote(rule.item_id, safe="")
    query_string = urllib.parse.urlencode(query)
    url = f"{API_BASE}/{rule.region}/auction/{encoded_item}/lots?{query_string}"
    payload = request_json(url, headers=headers)
    return list(payload.get("lots", []))


def fetch_history(rule: WatchRule, headers: dict[str, str]) -> list[dict[str, Any]]:
    query = {
        "limit": str(max(0, min(rule.history_limit, 200))),
        "additional": "true" if rule.additional else "false",
    }
    encoded_item = urllib.parse.quote(rule.item_id, safe="")
    query_string = urllib.parse.urlencode(query)
    url = f"{API_BASE}/{rule.region}/auction/{encoded_item}/history?{query_string}"
    payload = request_json(url, headers=headers)
    return list(payload.get("prices", []))


def unit_price(entry: dict[str, Any], price_key: str) -> float | None:
    amount = int(entry.get("amount") or 0)
    price = parse_price(entry.get(price_key))
    if amount <= 0 or price is None:
        return None
    return price / amount


def market_context(rule: WatchRule, lots: list[dict[str, Any]], headers: dict[str, str]) -> dict[str, Any]:
    comparable_lots = [lot for lot in lots if matches_variant_filters(rule, lot)]
    lot_units = [value for lot in comparable_lots if (value := unit_price(lot, "buyoutPrice")) is not None]
    context: dict[str, Any] = {
        "currentMinUnit": min(lot_units) if lot_units else None,
        "currentUnitPrices": lot_units,
        "historyMedianUnit": None,
    }
    if rule.max_history_median_ratio is not None:
        history = fetch_history(rule, headers)
        comparable_history = [entry for entry in history if matches_variant_filters(rule, entry)]
        history_units = [value for entry in comparable_history if (value := unit_price(entry, "price")) is not None]
        context["historyMedianUnit"] = median(history_units)
    return context


def format_lot(rule: WatchRule, lot: dict[str, Any]) -> str:
    amount = int(lot.get("amount") or 0)
    buyout = lot.get("buyoutPrice")
    unit = None
    if buyout is not None and amount > 0:
        unit = int(buyout) / amount
    lines = [
        f"Новый лот: {rule.name}",
        f"Регион: {rule.region}",
        f"Item ID: {rule.item_id}",
        f"Количество: {amount}",
        f"Выкуп: {buyout if buyout is not None else 'нет'}",
    ]
    if unit is not None:
        lines.append(f"Цена за штуку: {unit:,.0f}".replace(",", " "))
    tier = lot_tier(lot)
    upgrade = lot_upgrade(lot)
    if tier is not None:
        lines.append(f"Тир артефакта: {tier}")
    if upgrade is not None:
        lines.append(f"Заточка: +{upgrade}")
    if lot.get("currentPrice") is not None:
        lines.append(f"Текущая цена: {lot['currentPrice']}")
    if lot.get("endTime"):
        lines.append(f"Окончание: {lot['endTime']}")
    return "\n".join(lines)


def notify_console(message: str) -> None:
    print("\n" + "=" * 72)
    print(message)
    print("=" * 72 + "\n")


def notify_telegram(message: str) -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    body = urllib.parse.urlencode({"chat_id": chat_id, "text": message}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        response.read()


def notify_discord(message: str) -> None:
    webhook = os.environ.get("DISCORD_WEBHOOK_URL")
    if not webhook:
        return
    body = json.dumps({"content": message}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        webhook,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        response.read()


def send_notification(message: str) -> None:
    notify_console(message)
    errors: list[str] = []
    for notifier in (notify_telegram, notify_discord):
        try:
            notifier(message)
        except Exception as exc:  # noqa: BLE001 - notification failures should not kill polling
            errors.append(str(exc))
    for error in errors:
        print(f"Notification warning: {error}", file=sys.stderr)


def run_once(
    rules: list[WatchRule],
    state_path: Path,
    headers: dict[str, str],
    notify_existing: bool,
    on_match: Callable[[WatchRule, dict[str, Any], str], None] | None = None,
) -> int:
    state = read_json(state_path, {"seen": []})
    seen = set(state.get("seen", []))
    new_seen = set(seen)
    notifications = 0

    for rule in rules:
        lots = fetch_lots(rule, headers)
        context = market_context(rule, lots, headers)
        for lot in lots:
            key = lot_key(rule, lot)
            if key in seen:
                continue
            new_seen.add(key)
            if notify_existing and matches_rule(rule, lot, context):
                message = format_lot(rule, lot)
                if on_match is not None:
                    on_match(rule, lot, message)
                send_notification(message)
                notifications += 1

    state["seen"] = sorted(new_seen)[-5000:]
    state["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    write_json(state_path, state)
    return notifications


def main() -> int:
    parser = argparse.ArgumentParser(description="Watch STALZONE auction lots.")
    parser.add_argument("--config", default=DEFAULT_CONFIG, help="Path to watchlist JSON.")
    parser.add_argument("--state", default=DEFAULT_STATE, help="Path to seen-lots state JSON.")
    parser.add_argument("--interval", type=int, default=60, help="Polling interval in seconds.")
    parser.add_argument("--once", action="store_true", help="Run one poll cycle and exit.")
    parser.add_argument(
        "--notify-existing",
        action="store_true",
        help="Notify for matching lots on the first run. By default first run only seeds state.",
    )
    args = parser.parse_args()

    load_dotenv(APP_DIR / ".env", override=True)
    load_dotenv(Path.cwd() / ".env", override=True)
    try:
        headers = build_api_headers("ArtefactOptimizerAuctionWatcher/1.0")
    except RuntimeError as exc:
        raise SystemExit(str(exc)) from exc

    config_path = Path(args.config)
    state_path = Path(args.state)
    rules = load_rules(config_path)

    first_run = not state_path.exists()
    while True:
        try:
            notify_existing = args.notify_existing or not first_run
            count = run_once(rules, state_path, headers, notify_existing)
            stamp = time.strftime("%Y-%m-%d %H:%M:%S")
            print(f"[{stamp}] Checked {len(rules)} rules, notifications: {count}")
            first_run = False
        except Exception as exc:  # noqa: BLE001 - keep long-running watcher alive
            print(f"Watcher error: {exc}", file=sys.stderr)

        if args.once:
            return 0
        time.sleep(max(10, args.interval))


if __name__ == "__main__":
    raise SystemExit(main())
