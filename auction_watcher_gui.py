#!/usr/bin/env python3
"""
Tkinter GUI for configuring and running the STALZONE auction watcher.
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Any

import auction_watcher as watcher


REGIONS = ("EU", "RU", "NA", "SEA", "NEA")
APP_DIR = Path(__file__).resolve().parent
DEFAULT_DB_HINTS = (
    Path.cwd() / "stalzone-database",
    APP_DIR / "stalzone-database",
    Path(os.environ.get("TEMP", "")) / "stalzone-database",
)


def tr(value: Any, lang: str = "ru") -> str:
    if isinstance(value, str):
        return value
    if not isinstance(value, dict):
        return ""
    lines = value.get("lines")
    if isinstance(lines, dict):
        return lines.get(lang) or lines.get("en") or next(iter(lines.values()), "")
    text = value.get("text")
    if isinstance(text, str):
        return text
    return ""


def parse_int(text: str) -> int | None:
    text = (text or "").replace(" ", "").replace("_", "").strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        raise ValueError(f"Не число: {text}")


def parse_percent_ratio(text: str) -> float | None:
    text = (text or "").replace(",", ".").strip()
    if not text:
        return None
    try:
        value = float(text)
    except ValueError as exc:
        raise ValueError(f"Не процент: {text}") from exc
    return value / 100


def parse_optional_level(text: str, field_name: str) -> int | None:
    text = (text or "").strip()
    if not text:
        return None
    value = watcher.parse_level(text)
    if value is None:
        raise ValueError(f"Не удалось разобрать поле '{field_name}': {text}")
    return value


def format_money(value: float | int | None) -> str:
    if value is None:
        return "-"
    return f"{value:,.0f}".replace(",", " ")


class Tooltip:
    def __init__(self, widget: tk.Widget, text: str, delay_ms: int = 450) -> None:
        self.widget = widget
        self.text = text
        self.delay_ms = delay_ms
        self.after_id: str | None = None
        self.window: tk.Toplevel | None = None
        widget.bind("<Enter>", self.schedule)
        widget.bind("<Leave>", self.hide)
        widget.bind("<ButtonPress>", self.hide)

    def schedule(self, _event: tk.Event[Any] | None = None) -> None:
        self.cancel()
        self.after_id = self.widget.after(self.delay_ms, self.show)

    def cancel(self) -> None:
        if self.after_id:
            self.widget.after_cancel(self.after_id)
            self.after_id = None

    def show(self) -> None:
        if self.window or not self.text:
            return
        x = self.widget.winfo_rootx() + 18
        y = self.widget.winfo_rooty() + self.widget.winfo_height() + 8
        self.window = tk.Toplevel(self.widget)
        self.window.wm_overrideredirect(True)
        self.window.wm_geometry(f"+{x}+{y}")
        label = ttk.Label(
            self.window,
            text=self.text,
            justify=tk.LEFT,
            wraplength=340,
            padding=(8, 6),
            relief=tk.SOLID,
            borderwidth=1,
        )
        label.grid()

    def hide(self, _event: tk.Event[Any] | None = None) -> None:
        self.cancel()
        if self.window:
            self.window.destroy()
            self.window = None


class ItemIndex:
    def __init__(self) -> None:
        self.root: Path | None = None
        self.realm = "global"
        self.items: list[dict[str, Any]] = []

    def load(self, root: Path, realm: str) -> None:
        listing = root / realm / "listing.json"
        if not listing.exists():
            raise FileNotFoundError(f"Не найден {listing}")
        data = json.loads(listing.read_text(encoding="utf-8"))
        items: list[dict[str, Any]] = []
        for row in data:
            data_path = row.get("data", "")
            parts = [part for part in data_path.split("/") if part]
            item_id = Path(data_path).stem
            category = parts[1] if len(parts) > 1 else row.get("category", "")
            subcategory = parts[2] if len(parts) > 3 else ""
            name_ru = tr(row.get("name"), "ru")
            name_en = tr(row.get("name"), "en")
            items.append(
                {
                    "id": item_id,
                    "name_ru": name_ru,
                    "name_en": name_en,
                    "category": category,
                    "subcategory": subcategory,
                    "color": row.get("color", ""),
                    "data": data_path,
                    "icon": row.get("icon", ""),
                    "search": f"{item_id} {name_ru} {name_en} {category} {subcategory}".lower(),
                }
            )
        self.root = root
        self.realm = realm
        self.items = items

    def icon_path(self, item: dict[str, Any]) -> Path | None:
        if not self.root or not item.get("icon"):
            return None
        return self.root / self.realm / item["icon"].lstrip("/")


class AuctionWatcherGui(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("STALZONE Auction Watcher")
        self.geometry("1180x760")
        self.minsize(980, 640)

        self.load_runtime_env()
        self.index = ItemIndex()
        self.filtered_items: list[dict[str, Any]] = []
        self.selected_item: dict[str, Any] | None = None
        self.rules: list[dict[str, Any]] = []
        self.monitor_thread: threading.Thread | None = None
        self.stop_event = threading.Event()
        self.events: queue.Queue[tuple[str, Any]] = queue.Queue()
        self.icon_image: tk.PhotoImage | None = None

        self.db_path = tk.StringVar(value=self.find_default_db())
        self.realm = tk.StringVar(value="global")
        self.region = tk.StringVar(value="EU")
        self.search = tk.StringVar()
        self.interval = tk.IntVar(value=60)
        self.status = tk.StringVar(value="Готово")

        self.rule_name = tk.StringVar()
        self.rule_item_id = tk.StringVar()
        self.max_buyout = tk.StringVar()
        self.max_unit_buyout = tk.StringVar()
        self.min_amount = tk.StringVar()
        self.min_tier = tk.StringVar()
        self.max_tier = tk.StringVar()
        self.min_upgrade = tk.StringVar()
        self.max_upgrade = tk.StringVar()
        self.history_percent = tk.StringVar()
        self.current_percent = tk.StringVar()

        self.create_widgets()
        self.load_config_if_exists()
        self.after(150, self.pump_events)

    def find_default_db(self) -> str:
        for hint in DEFAULT_DB_HINTS:
            if (hint / "global" / "listing.json").exists():
                return str(hint)
        return str(Path.cwd() / "stalzone-database")

    def create_widgets(self) -> None:
        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        top = ttk.Frame(self, padding=10)
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(1, weight=1)

        ttk.Label(top, text="stalzone-database").grid(row=0, column=0, sticky="w")
        ttk.Entry(top, textvariable=self.db_path).grid(row=0, column=1, sticky="ew", padx=8)
        ttk.Button(top, text="Выбрать", command=self.pick_db).grid(row=0, column=2)
        ttk.Button(top, text="Загрузить", command=self.load_database).grid(row=0, column=3, padx=(8, 0))
        ttk.Button(top, text="Git clone/pull", command=self.update_database).grid(row=0, column=4, padx=(8, 0))

        ttk.Label(top, text="Realm").grid(row=1, column=0, sticky="w", pady=(8, 0))
        ttk.Combobox(top, textvariable=self.realm, values=("global", "ru"), width=10, state="readonly").grid(
            row=1, column=1, sticky="w", pady=(8, 0)
        )
        ttk.Label(top, text="Регион").grid(row=1, column=2, sticky="e", pady=(8, 0))
        ttk.Combobox(top, textvariable=self.region, values=REGIONS, width=10, state="readonly").grid(
            row=1, column=3, sticky="w", padx=(8, 0), pady=(8, 0)
        )
        self.env_label = ttk.Label(top, text=self.env_status())
        self.env_label.grid(row=1, column=4, sticky="e", pady=(8, 0))

        main = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        main.grid(row=1, column=0, sticky="nsew", padx=10, pady=(0, 10))

        left = ttk.Frame(main, padding=(0, 0, 8, 0))
        right = ttk.Frame(main, padding=(8, 0, 0, 0))
        main.add(left, weight=3)
        main.add(right, weight=2)

        self.create_catalog(left)
        self.create_rules(right)

        bottom = ttk.Frame(self, padding=(10, 0, 10, 10))
        bottom.grid(row=2, column=0, sticky="ew")
        bottom.columnconfigure(0, weight=1)
        ttk.Label(bottom, textvariable=self.status).grid(row=0, column=0, sticky="w")

    def create_catalog(self, parent: ttk.Frame) -> None:
        parent.rowconfigure(2, weight=1)
        parent.columnconfigure(0, weight=1)

        ttk.Label(parent, text="Каталог предметов", font=("", 12, "bold")).grid(row=0, column=0, sticky="w")
        search_row = ttk.Frame(parent)
        search_row.grid(row=1, column=0, sticky="ew", pady=8)
        search_row.columnconfigure(0, weight=1)
        search_entry = ttk.Entry(search_row, textvariable=self.search)
        search_entry.grid(row=0, column=0, sticky="ew")
        ttk.Button(search_row, text="Очистить", command=lambda: self.search.set("")).grid(row=0, column=1, padx=(8, 0))
        self.search.trace_add("write", lambda *_: self.apply_filter())

        columns = ("name", "id", "category", "color")
        self.item_tree = ttk.Treeview(parent, columns=columns, show="headings", height=18)
        self.item_tree.heading("name", text="Название")
        self.item_tree.heading("id", text="ID")
        self.item_tree.heading("category", text="Категория")
        self.item_tree.heading("color", text="Ранг")
        self.item_tree.column("name", width=260)
        self.item_tree.column("id", width=80, anchor="center")
        self.item_tree.column("category", width=130)
        self.item_tree.column("color", width=110)
        self.item_tree.grid(row=2, column=0, sticky="nsew")
        self.item_tree.bind("<<TreeviewSelect>>", self.on_item_select)
        self.item_tree.bind("<Double-1>", lambda _event: self.fill_rule_from_item())

        scroll = ttk.Scrollbar(parent, orient=tk.VERTICAL, command=self.item_tree.yview)
        scroll.grid(row=2, column=1, sticky="ns")
        self.item_tree.configure(yscrollcommand=scroll.set)

        preview = ttk.LabelFrame(parent, text="Предпросмотр", padding=8)
        preview.grid(row=3, column=0, columnspan=2, sticky="ew", pady=(8, 0))
        preview.columnconfigure(1, weight=1)
        self.icon_label = ttk.Label(preview, text="no icon", width=12)
        self.icon_label.grid(row=0, column=0, rowspan=3, sticky="nw")
        self.item_title = ttk.Label(preview, text="Предмет не выбран", font=("", 11, "bold"))
        self.item_title.grid(row=0, column=1, sticky="w")
        self.item_meta = ttk.Label(preview, text="")
        self.item_meta.grid(row=1, column=1, sticky="w")
        ttk.Button(preview, text="Добавить в отслеживание", command=self.fill_rule_from_item).grid(
            row=2, column=1, sticky="w", pady=(6, 0)
        )

    def create_rules(self, parent: ttk.Frame) -> None:
        parent.rowconfigure(3, weight=1)
        parent.columnconfigure(0, weight=1)

        ttk.Label(parent, text="Правило отслеживания", font=("", 12, "bold")).grid(row=0, column=0, sticky="w")

        form = ttk.LabelFrame(parent, text="Фильтры", padding=10)
        form.grid(row=1, column=0, sticky="ew", pady=(8, 0))
        for idx in range(4):
            form.columnconfigure(idx, weight=1)

        self.add_labeled_entry(
            form,
            "Название правила",
            self.rule_name,
            0,
            0,
            "Любое удобное имя для лога и уведомлений. На поиск не влияет.",
        )
        self.add_labeled_entry(
            form,
            "Item ID",
            self.rule_item_id,
            0,
            2,
            "Внутренний ID предмета из stalzone-database. Выберите предмет слева и дважды кликните по нему.",
        )
        self.add_labeled_entry(
            form,
            "Макс. выкуп всего",
            self.max_buyout,
            1,
            0,
            "Абсолютный лимит на полный выкуп лота. Например 500000 значит уведомлять только лоты с выкупом до 500 000.",
        )
        self.add_labeled_entry(
            form,
            "Макс. цена за шт.",
            self.max_unit_buyout,
            1,
            2,
            "Лимит на buyout / количество. Лучше всего подходит для патронов, расходников и других стеков.",
        )
        self.add_labeled_entry(
            form,
            "Мин. количество",
            self.min_amount,
            2,
            0,
            "Отсекает слишком маленькие стаки. Например 100 будет игнорировать лоты с количеством меньше 100.",
        )
        self.add_labeled_entry(
            form,
            "Дешевле медианы, %",
            self.history_percent,
            2,
            2,
            "Сравнение с медианной ценой уже проданных лотов. 90 значит цена за штуку должна быть не выше 90% от медианы, то есть примерно на 10% дешевле рынка.",
        )
        self.add_labeled_entry(
            form,
            "Мин. тир артефакта",
            self.min_tier,
            3,
            0,
            "Минимальный тир артефакта. Можно писать 3 или III. Оставьте пустым для обычных предметов.",
        )
        self.add_labeled_entry(
            form,
            "Макс. тир артефакта",
            self.max_tier,
            3,
            2,
            "Максимальный тир артефакта. Если нужен только тир III, поставьте мин. тир 3 и макс. тир 3.",
        )
        self.add_labeled_entry(
            form,
            "Мин. заточка",
            self.min_upgrade,
            4,
            0,
            "Минимальный уровень заточки/потенциала. Можно писать 10 или +10.",
        )
        self.add_labeled_entry(
            form,
            "Макс. заточка",
            self.max_upgrade,
            4,
            2,
            "Максимальный уровень заточки. Удобно, если нужен строго диапазон, например от +5 до +10.",
        )
        self.add_labeled_entry(
            form,
            "Дешевле текущего мин., %",
            self.current_percent,
            5,
            0,
            "Сравнение с самым дешевым активным лотом. 95 значит уведомлять, если цена за штуку ниже текущего минимума минимум на 5%.",
        )

        hints = ttk.Frame(form)
        hints.grid(row=6, column=0, columnspan=4, sticky="ew", pady=(8, 0))
        ttk.Button(hints, text="Осторожно: 95% рынка", command=lambda: self.apply_filter_preset("safe")).grid(row=0, column=0)
        ttk.Button(hints, text="Выгодно: 90% медианы", command=lambda: self.apply_filter_preset("deal")).grid(row=0, column=1, padx=6)
        ttk.Button(hints, text="Снайпинг: 80% медианы", command=lambda: self.apply_filter_preset("snipe")).grid(row=0, column=2)
        ttk.Button(hints, text="Очистить цены", command=self.clear_price_filters).grid(row=0, column=3, padx=(6, 0))
        ttk.Button(hints, text="Очистить арт.", command=self.clear_artifact_filters).grid(row=0, column=4, padx=(6, 0))

        guide = ttk.Label(
            form,
            text=(
                "Как задавать: для одиночных предметов удобен 'Макс. выкуп всего'; для стеков - 'Макс. цена за шт.'. "
                "Для артефактов укажите тир и заточку, чтобы цена сравнивалась только с похожими лотами."
            ),
            wraplength=520,
            foreground="#555555",
        )
        guide.grid(row=7, column=0, columnspan=4, sticky="ew", pady=(8, 0))

        actions = ttk.Frame(parent)
        actions.grid(row=2, column=0, sticky="ew", pady=8)
        ttk.Button(actions, text="Добавить / обновить", command=self.upsert_rule).grid(row=0, column=0)
        ttk.Button(actions, text="Удалить", command=self.delete_rule).grid(row=0, column=1, padx=6)
        analyze_button = ttk.Button(actions, text="Анализ рынка", command=self.analyze_market)
        analyze_button.grid(row=0, column=2)
        Tooltip(
            analyze_button,
            "Сначала выберите предмет и регион. Анализ покажет текущий минимум, медиану активных лотов и медиану продаж - по ним проще выбрать лимиты.",
        )
        ttk.Button(actions, text="Сохранить", command=self.save_config).grid(row=0, column=3, padx=6)
        ttk.Button(actions, text="Загрузить", command=self.load_config_dialog).grid(row=0, column=4)

        columns = ("name", "item", "region", "filters")
        self.rule_tree = ttk.Treeview(parent, columns=columns, show="headings", height=8)
        self.rule_tree.heading("name", text="Название")
        self.rule_tree.heading("item", text="Item ID")
        self.rule_tree.heading("region", text="Регион")
        self.rule_tree.heading("filters", text="Фильтры")
        self.rule_tree.column("name", width=160)
        self.rule_tree.column("item", width=80, anchor="center")
        self.rule_tree.column("region", width=60, anchor="center")
        self.rule_tree.column("filters", width=240)
        self.rule_tree.grid(row=3, column=0, sticky="nsew")
        self.rule_tree.bind("<<TreeviewSelect>>", self.on_rule_select)

        monitor = ttk.LabelFrame(parent, text="Мониторинг", padding=10)
        monitor.grid(row=4, column=0, sticky="ew", pady=(8, 0))
        ttk.Label(monitor, text="Интервал, сек").grid(row=0, column=0, sticky="w")
        ttk.Spinbox(monitor, from_=10, to=3600, increment=10, textvariable=self.interval, width=8).grid(
            row=0, column=1, padx=8
        )
        ttk.Button(monitor, text="Старт", command=self.start_monitor).grid(row=0, column=2)
        ttk.Button(monitor, text="Стоп", command=self.stop_monitor).grid(row=0, column=3, padx=6)
        ttk.Button(monitor, text="Проверить разово", command=self.check_once).grid(row=0, column=4)

        log_frame = ttk.LabelFrame(parent, text="Лог", padding=6)
        log_frame.grid(row=5, column=0, sticky="nsew", pady=(8, 0))
        log_frame.rowconfigure(0, weight=1)
        log_frame.columnconfigure(0, weight=1)
        self.log = tk.Text(log_frame, height=9, wrap=tk.WORD)
        self.log.grid(row=0, column=0, sticky="nsew")
        log_scroll = ttk.Scrollbar(log_frame, orient=tk.VERTICAL, command=self.log.yview)
        log_scroll.grid(row=0, column=1, sticky="ns")
        self.log.configure(yscrollcommand=log_scroll.set)

    def add_labeled_entry(
        self,
        parent: ttk.Frame,
        label: str,
        variable: tk.StringVar,
        row: int,
        column: int,
        help_text: str = "",
    ) -> None:
        label_box = ttk.Frame(parent)
        label_box.grid(row=row, column=column, sticky="w", pady=3)
        label_widget = ttk.Label(label_box, text=label)
        label_widget.grid(row=0, column=0, sticky="w")
        entry = ttk.Entry(parent, textvariable=variable)
        entry.grid(row=row, column=column + 1, sticky="ew", padx=(6, 10), pady=3)
        if help_text:
            help_label = ttk.Label(label_box, text="?", cursor="question_arrow")
            help_label.grid(row=0, column=1, sticky="w", padx=(4, 0))
            Tooltip(help_label, help_text)
            Tooltip(entry, help_text)

    def apply_filter_preset(self, preset: str) -> None:
        if preset == "safe":
            self.history_percent.set("95")
            self.current_percent.set("98")
        elif preset == "deal":
            self.history_percent.set("90")
            self.current_percent.set("95")
        elif preset == "snipe":
            self.history_percent.set("80")
            self.current_percent.set("90")

    def clear_price_filters(self) -> None:
        self.max_buyout.set("")
        self.max_unit_buyout.set("")
        self.history_percent.set("")
        self.current_percent.set("")

    def clear_artifact_filters(self) -> None:
        self.min_tier.set("")
        self.max_tier.set("")
        self.min_upgrade.set("")
        self.max_upgrade.set("")

    def env_status(self) -> str:
        env_path = APP_DIR / ".env"
        client_id = os.environ.get("STALZONE_CLIENT_ID")
        client_secret = os.environ.get("STALZONE_CLIENT_SECRET")
        ok = not watcher.is_placeholder_secret(client_id) and not watcher.is_placeholder_secret(client_secret)
        if ok:
            return "API ключи: OK"
        if not env_path.exists():
            return f"API ключи: нет {env_path.name}"
        return "API ключи: проверьте .env"

    def load_runtime_env(self) -> None:
        watcher.load_dotenv(APP_DIR / ".env", override=True)
        watcher.load_dotenv(Path.cwd() / ".env", override=True)

    def pick_db(self) -> None:
        path = filedialog.askdirectory(title="Выберите папку stalzone-database")
        if path:
            self.db_path.set(path)

    def update_database(self) -> None:
        path = Path(self.db_path.get())
        def work() -> None:
            try:
                if (path / ".git").exists():
                    subprocess.run(["git", "-C", str(path), "pull", "--ff-only"], check=True, capture_output=True)
                else:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    subprocess.run(
                        ["git", "clone", "--depth", "1", "https://github.com/EXBO-Studio/stalzone-database.git", str(path)],
                        check=True,
                        capture_output=True,
                    )
                self.events.put(("status", "База обновлена"))
                self.events.put(("load_db", None))
            except Exception as exc:  # noqa: BLE001
                self.events.put(("error", f"Не удалось обновить базу: {exc}"))
        threading.Thread(target=work, daemon=True).start()
        self.status.set("Обновляю базу...")

    def load_database(self) -> None:
        try:
            self.index.load(Path(self.db_path.get()), self.realm.get())
            self.apply_filter()
            self.status.set(f"Загружено предметов: {len(self.index.items)}")
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Ошибка", str(exc))

    def apply_filter(self) -> None:
        query = self.search.get().lower().strip()
        self.filtered_items = [item for item in self.index.items if not query or query in item["search"]][:1000]
        self.item_tree.delete(*self.item_tree.get_children())
        for idx, item in enumerate(self.filtered_items):
            name = item["name_ru"] or item["name_en"] or item["id"]
            self.item_tree.insert("", tk.END, iid=str(idx), values=(name, item["id"], item["category"], item["color"]))

    def on_item_select(self, _event: tk.Event[Any] | None = None) -> None:
        selection = self.item_tree.selection()
        if not selection:
            return
        item = self.filtered_items[int(selection[0])]
        self.selected_item = item
        title = item["name_ru"] or item["name_en"] or item["id"]
        self.item_title.configure(text=title)
        self.item_meta.configure(text=f"{item['id']} · {item['category']} / {item['subcategory']} · {item['color']}")
        self.show_icon(item)

    def show_icon(self, item: dict[str, Any]) -> None:
        path = self.index.icon_path(item)
        if not path or not path.exists():
            self.icon_image = None
            self.icon_label.configure(image="", text="no icon")
            return
        try:
            image = tk.PhotoImage(file=str(path))
            max_side = max(image.width(), image.height())
            if max_side > 72:
                factor = max(1, max_side // 72)
                image = image.subsample(factor, factor)
            self.icon_image = image
            self.icon_label.configure(image=image, text="")
        except Exception:
            self.icon_image = None
            self.icon_label.configure(image="", text="icon error")

    def fill_rule_from_item(self) -> None:
        if not self.selected_item:
            messagebox.showinfo("Нет предмета", "Выберите предмет в каталоге.")
            return
        name = self.selected_item["name_ru"] or self.selected_item["name_en"] or self.selected_item["id"]
        self.rule_name.set(name)
        self.rule_item_id.set(self.selected_item["id"])

    def current_rule(self) -> dict[str, Any]:
        item_id = self.rule_item_id.get().strip()
        if not item_id:
            raise ValueError("Укажите Item ID.")
        rule: dict[str, Any] = {
            "name": self.rule_name.get().strip() or item_id,
            "itemId": item_id,
            "region": self.region.get().upper(),
        }
        values = {
            "maxBuyout": parse_int(self.max_buyout.get()),
            "maxUnitBuyout": parse_int(self.max_unit_buyout.get()),
            "minAmount": parse_int(self.min_amount.get()),
            "minTier": parse_optional_level(self.min_tier.get(), "Мин. тир артефакта"),
            "maxTier": parse_optional_level(self.max_tier.get(), "Макс. тир артефакта"),
            "minUpgrade": parse_optional_level(self.min_upgrade.get(), "Мин. заточка"),
            "maxUpgrade": parse_optional_level(self.max_upgrade.get(), "Макс. заточка"),
        }
        ratios = {
            "maxHistoryMedianRatio": parse_percent_ratio(self.history_percent.get()),
            "maxCurrentMinRatio": parse_percent_ratio(self.current_percent.get()),
        }
        for key, value in {**values, **ratios}.items():
            if value is not None:
                rule[key] = value
        return rule

    def upsert_rule(self) -> None:
        try:
            rule = self.current_rule()
        except ValueError as exc:
            messagebox.showerror("Ошибка", str(exc))
            return
        for idx, existing in enumerate(self.rules):
            if existing.get("itemId") == rule["itemId"] and existing.get("region") == rule["region"]:
                self.rules[idx] = rule
                break
        else:
            self.rules.append(rule)
        self.refresh_rules()

    def delete_rule(self) -> None:
        selection = self.rule_tree.selection()
        if not selection:
            return
        index = int(selection[0])
        self.rules.pop(index)
        self.refresh_rules()

    def refresh_rules(self) -> None:
        self.rule_tree.delete(*self.rule_tree.get_children())
        for idx, rule in enumerate(self.rules):
            self.rule_tree.insert(
                "",
                tk.END,
                iid=str(idx),
                values=(rule.get("name", ""), rule.get("itemId", ""), rule.get("region", ""), self.describe_filters(rule)),
            )

    def describe_filters(self, rule: dict[str, Any]) -> str:
        parts: list[str] = []
        if rule.get("maxBuyout") is not None:
            parts.append(f"весь лот <= {format_money(rule['maxBuyout'])}")
        if rule.get("maxUnitBuyout") is not None:
            parts.append(f"за шт. <= {format_money(rule['maxUnitBuyout'])}")
        if rule.get("minAmount") is not None:
            parts.append(f"кол-во >= {rule['minAmount']}")
        if rule.get("minTier") is not None or rule.get("maxTier") is not None:
            parts.append(self.describe_range("тир", rule.get("minTier"), rule.get("maxTier")))
        if rule.get("minUpgrade") is not None or rule.get("maxUpgrade") is not None:
            parts.append(self.describe_range("заточка", rule.get("minUpgrade"), rule.get("maxUpgrade"), prefix="+"))
        if rule.get("maxHistoryMedianRatio") is not None:
            parts.append(f"<= {rule['maxHistoryMedianRatio'] * 100:.0f}% медианы продаж")
        if rule.get("maxCurrentMinRatio") is not None:
            parts.append(f"<= {rule['maxCurrentMinRatio'] * 100:.0f}% текущего минимума")
        return "; ".join(parts) or "без фильтров"

    def describe_range(self, label: str, minimum: Any, maximum: Any, prefix: str = "") -> str:
        if minimum is not None and maximum is not None and minimum == maximum:
            return f"{label} = {prefix}{minimum}"
        if minimum is not None and maximum is not None:
            return f"{label} {prefix}{minimum}-{prefix}{maximum}"
        if minimum is not None:
            return f"{label} >= {prefix}{minimum}"
        return f"{label} <= {prefix}{maximum}"

    def on_rule_select(self, _event: tk.Event[Any] | None = None) -> None:
        selection = self.rule_tree.selection()
        if not selection:
            return
        rule = self.rules[int(selection[0])]
        self.rule_name.set(rule.get("name", ""))
        self.rule_item_id.set(rule.get("itemId", ""))
        self.region.set(rule.get("region", "EU"))
        self.max_buyout.set(str(rule.get("maxBuyout", "") or ""))
        self.max_unit_buyout.set(str(rule.get("maxUnitBuyout", "") or ""))
        self.min_amount.set(str(rule.get("minAmount", "") or ""))
        self.min_tier.set(str(rule.get("minTier", "") or ""))
        self.max_tier.set(str(rule.get("maxTier", "") or ""))
        self.min_upgrade.set(str(rule.get("minUpgrade", "") or ""))
        self.max_upgrade.set(str(rule.get("maxUpgrade", "") or ""))
        self.history_percent.set(str(round(rule.get("maxHistoryMedianRatio", 0) * 100)) if rule.get("maxHistoryMedianRatio") else "")
        self.current_percent.set(str(round(rule.get("maxCurrentMinRatio", 0) * 100)) if rule.get("maxCurrentMinRatio") else "")

    def config_payload(self) -> dict[str, Any]:
        return {
            "defaults": {
                "region": self.region.get().upper(),
                "limit": 50,
                "sort": "time_created",
                "order": "desc",
                "additional": True,
            },
            "items": self.rules,
        }

    def save_config(self) -> None:
        path = Path("auction_watchlist.json")
        path.write_text(json.dumps(self.config_payload(), ensure_ascii=False, indent=2), encoding="utf-8")
        self.status.set(f"Сохранено: {path}")

    def load_config_if_exists(self) -> None:
        path = Path("auction_watchlist.json")
        if path.exists():
            self.load_config(path)

    def load_config_dialog(self) -> None:
        path = filedialog.askopenfilename(filetypes=[("JSON", "*.json"), ("All files", "*.*")])
        if path:
            self.load_config(Path(path))

    def load_config(self, path: Path) -> None:
        data = json.loads(path.read_text(encoding="utf-8"))
        self.rules = list(data.get("items", []))
        default_region = data.get("defaults", {}).get("region")
        if default_region:
            self.region.set(default_region)
        self.refresh_rules()
        self.status.set(f"Загружено правил: {len(self.rules)}")

    def headers(self) -> dict[str, str]:
        self.load_runtime_env()
        self.env_label.configure(text=self.env_status())
        try:
            return watcher.build_api_headers("ArtefactOptimizerAuctionWatcherGui/1.0")
        except RuntimeError as exc:
            raise RuntimeError(
                f"{exc} File: {APP_DIR / '.env'}. "
                "Replace STALZONE_CLIENT_ID and STALZONE_CLIENT_SECRET with real values."
            ) from exc
        client_id = os.environ.get("STALZONE_CLIENT_ID")
        client_secret = os.environ.get("STALZONE_CLIENT_SECRET")
        if not client_id or not client_secret:
            raise RuntimeError(
                f"Нет STALZONE_CLIENT_ID / STALZONE_CLIENT_SECRET. "
                f"Создайте {APP_DIR / '.env'} из .env.example и вставьте ключи."
            )
        return {
            "Client-Id": client_id,
            "Client-Secret": client_secret,
            "Accept": "application/json",
            "User-Agent": "ArtefactOptimizerAuctionWatcherGui/1.0",
        }

    def analyze_market(self) -> None:
        try:
            rule_data = self.current_rule()
            rule = self.rule_from_dict(rule_data)
            headers = self.headers()
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Ошибка", str(exc))
            return

        def work() -> None:
            try:
                lots = watcher.fetch_lots(rule, headers)
                history = watcher.fetch_history(rule, headers)
                comparable_lots = [lot for lot in lots if watcher.matches_variant_filters(rule, lot)]
                comparable_history = [row for row in history if watcher.matches_variant_filters(rule, row)]
                current_units = [
                    value for lot in comparable_lots if (value := watcher.unit_price(lot, "buyoutPrice")) is not None
                ]
                history_units = [
                    value for row in comparable_history if (value := watcher.unit_price(row, "price")) is not None
                ]
                result = {
                    "lots": len(comparable_lots),
                    "history": len(comparable_history),
                    "current_min": min(current_units) if current_units else None,
                    "current_median": watcher.median(current_units),
                    "history_median": watcher.median(history_units),
                }
                self.events.put(("analysis", result))
            except Exception as exc:  # noqa: BLE001
                self.events.put(("error", str(exc)))
        threading.Thread(target=work, daemon=True).start()
        self.status.set("Анализирую рынок...")

    def rule_from_dict(self, data: dict[str, Any]) -> watcher.WatchRule:
        payload = {"items": [data], "defaults": {"region": data.get("region", self.region.get())}}
        tmp = Path(".auction_gui_tmp_rule.json")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        try:
            return watcher.load_rules(tmp)[0]
        finally:
            try:
                tmp.unlink()
            except OSError:
                pass

    def build_rules(self) -> list[watcher.WatchRule]:
        payload = self.config_payload()
        tmp = Path(".auction_gui_tmp_rules.json")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        try:
            return watcher.load_rules(tmp)
        finally:
            try:
                tmp.unlink()
            except OSError:
                pass

    def check_once(self) -> None:
        self.run_monitor_cycle(notify_existing=True)

    def start_monitor(self) -> None:
        if self.monitor_thread and self.monitor_thread.is_alive():
            return
        self.stop_event.clear()
        self.monitor_thread = threading.Thread(target=self.monitor_loop, daemon=True)
        self.monitor_thread.start()
        self.status.set("Мониторинг запущен")

    def stop_monitor(self) -> None:
        self.stop_event.set()
        self.status.set("Остановка мониторинга...")

    def monitor_loop(self) -> None:
        first_run = not Path(watcher.DEFAULT_STATE).exists()
        while not self.stop_event.is_set():
            self.execute_monitor_cycle(notify_existing=not first_run)
            first_run = False
            self.stop_event.wait(max(10, int(self.interval.get())))
        self.events.put(("status", "Мониторинг остановлен"))

    def run_monitor_cycle(self, notify_existing: bool) -> None:
        def work() -> None:
            self.execute_monitor_cycle(notify_existing)
        threading.Thread(target=work, daemon=True).start()

    def execute_monitor_cycle(self, notify_existing: bool) -> None:
        try:
            rules = self.build_rules()
            matches: list[dict[str, Any]] = []

            def on_match(rule: watcher.WatchRule, lot: dict[str, Any], message: str) -> None:
                matches.append(self.match_record(rule, lot, message))

            count = watcher.run_once(
                rules,
                Path(watcher.DEFAULT_STATE),
                self.headers(),
                notify_existing,
                on_match=on_match,
            )
            if matches:
                self.events.put(("matches", matches))
            self.events.put(("log", f"Проверено правил: {len(rules)}, уведомлений: {count}"))
        except Exception as exc:  # noqa: BLE001
            self.events.put(("error", str(exc)))

    def match_record(self, rule: watcher.WatchRule, lot: dict[str, Any], message: str) -> dict[str, Any]:
        amount = int(lot.get("amount") or 0)
        buyout = watcher.parse_price(lot.get("buyoutPrice"))
        unit = buyout / amount if buyout is not None and amount > 0 else None
        return {
            "name": rule.name,
            "region": rule.region,
            "item_id": rule.item_id,
            "tier": watcher.lot_tier(lot),
            "upgrade": watcher.lot_upgrade(lot),
            "amount": amount,
            "buyout": buyout,
            "unit": unit,
            "current": watcher.parse_price(lot.get("currentPrice")),
            "end": lot.get("endTime") or "",
            "message": message,
        }

    def pump_events(self) -> None:
        while True:
            try:
                event, payload = self.events.get_nowait()
            except queue.Empty:
                break
            if event == "status":
                self.status.set(str(payload))
                self.write_log(str(payload))
            elif event == "load_db":
                self.load_database()
            elif event == "analysis":
                message = (
                    f"Активных лотов: {payload['lots']}\n"
                    f"История продаж: {payload['history']}\n"
                    f"Мин. текущая цена/шт: {format_money(payload['current_min'])}\n"
                    f"Медиана текущих/шт: {format_money(payload['current_median'])}\n"
                    f"Медиана продаж/шт: {format_money(payload['history_median'])}\n"
                )
                if payload["history_median"] is not None:
                    message += (
                        f"\n80% медианы: {format_money(payload['history_median'] * 0.8)}"
                        f"\n90% медианы: {format_money(payload['history_median'] * 0.9)}"
                    )
                self.write_log(message)
                messagebox.showinfo("Анализ рынка", message)
                self.status.set("Анализ завершен")
            elif event == "matches":
                matches = list(payload)
                self.write_log(f"Найдено подходящих лотов: {len(matches)}")
                for match in matches:
                    self.write_log(str(match["message"]))
                self.show_matches_window(matches)
            elif event == "log":
                self.write_log(str(payload))
                self.status.set(str(payload))
            elif event == "error":
                self.write_log("Ошибка: " + str(payload))
                self.status.set("Ошибка")
        self.after(150, self.pump_events)

    def write_log(self, text: str) -> None:
        stamp = time.strftime("%H:%M:%S")
        self.log.insert(tk.END, f"[{stamp}] {text}\n")
        self.log.see(tk.END)

    def show_matches_window(self, matches: list[dict[str, Any]]) -> None:
        window = tk.Toplevel(self)
        window.title("Найденные лоты")
        window.geometry("980x360")
        window.minsize(840, 280)
        window.transient(self)

        window.columnconfigure(0, weight=1)
        window.rowconfigure(0, weight=1)

        columns = ("name", "item", "region", "tier", "upgrade", "amount", "buyout", "unit", "current", "end")
        tree = ttk.Treeview(window, columns=columns, show="headings", height=8)
        headings = {
            "name": "Предмет",
            "item": "Item ID",
            "region": "Регион",
            "tier": "Тир",
            "upgrade": "Заточка",
            "amount": "Стак",
            "buyout": "Выкуп",
            "unit": "За шт.",
            "current": "Текущая",
            "end": "Окончание",
        }
        widths = {
            "name": 220,
            "item": 80,
            "region": 70,
            "tier": 60,
            "upgrade": 75,
            "amount": 70,
            "buyout": 110,
            "unit": 110,
            "current": 110,
            "end": 170,
        }
        for column in columns:
            tree.heading(column, text=headings[column])
            tree.column(column, width=widths[column], anchor="center" if column != "name" else "w")

        for index, match in enumerate(matches):
            tree.insert(
                "",
                tk.END,
                iid=str(index),
                values=(
                    match["name"],
                    match["item_id"],
                    match["region"],
                    format_money(match["tier"]),
                    f"+{match['upgrade']}" if match["upgrade"] is not None else "-",
                    match["amount"],
                    format_money(match["buyout"]),
                    format_money(match["unit"]),
                    format_money(match["current"]),
                    match["end"],
                ),
            )
        tree.grid(row=0, column=0, sticky="nsew", padx=10, pady=(10, 6))

        scroll = ttk.Scrollbar(window, orient=tk.VERTICAL, command=tree.yview)
        scroll.grid(row=0, column=1, sticky="ns", pady=(10, 6))
        tree.configure(yscrollcommand=scroll.set)

        details = tk.Text(window, height=7, wrap=tk.WORD)
        details.grid(row=1, column=0, columnspan=2, sticky="ew", padx=10)
        details.insert(tk.END, "\n\n".join(str(match["message"]) for match in matches))
        details.configure(state=tk.DISABLED)

        buttons = ttk.Frame(window)
        buttons.grid(row=2, column=0, columnspan=2, sticky="e", padx=10, pady=10)

        def copy_details() -> None:
            self.clipboard_clear()
            self.clipboard_append("\n\n".join(str(match["message"]) for match in matches))

        ttk.Button(buttons, text="Копировать", command=copy_details).grid(row=0, column=0, padx=(0, 8))
        ttk.Button(buttons, text="Закрыть", command=window.destroy).grid(row=0, column=1)


def main() -> int:
    app = AuctionWatcherGui()
    app.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
