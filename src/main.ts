import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { ColorType, createChart, LineSeries, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import {
  BarChart3, Bell, ChartNoAxesCombined, Check, ChevronRight, Coins, createIcons,
  ChartLine, CircleDollarSign, Database, DatabaseZap, Gauge, Gem, History, KeyRound, LayoutDashboard, Pencil, Play, Plus, RefreshCw,
  RotateCcw, Save, Search, SearchX, ShieldAlert, ShieldCheck, SlidersHorizontal, Sparkles, Square, Table2, TrendingUp, Trash2, X,
} from "lucide";

const appIcons = {
  BarChart3, Bell, ChartLine, ChartNoAxesCombined, Check, ChevronRight, Coins, Database,
  CircleDollarSign, DatabaseZap, Gauge, Gem, History, KeyRound, LayoutDashboard, Pencil, Play, Plus, RefreshCw,
  RotateCcw, Save, Search, SearchX, ShieldAlert, ShieldCheck, SlidersHorizontal, Sparkles, Square, Table2, TrendingUp, Trash2, X,
};

type CatalogItem = {
  id: string;
  nameRu: string;
  nameEn: string;
  category: string;
  subcategory: string;
  color: string;
  iconPath?: string;
};

type Rule = {
  name: string;
  itemId: string;
  region: string;
  maxBuyout?: number;
  maxUnitBuyout?: number;
  maxHistoryMedianRatio?: number;
  maxCurrentMinRatio?: number;
  historyLimit?: number;
  minAmount?: number;
  artifactQualities?: ArtifactQuality[];
  minTier?: number;
  maxTier?: number;
  minUpgrade?: number;
  maxUpgrade?: number;
  sort?: string;
  order?: string;
  limit?: number;
  additional?: boolean;
};

type MatchRecord = {
  name: string;
  itemId: string;
  region: string;
  quality?: string;
  upgrade?: number;
  amount: number;
  buyout?: number;
  unit?: number;
  current?: number;
  end: string;
  message: string;
};

type RuleSummary = {
  name: string;
  itemId: string;
  region: string;
  totalLots: number;
  comparableLots: number;
  matchingLots: number;
  currentMinBuyout?: number;
  currentMinUnit?: number;
  historyMedianUnit?: number;
  checkedAt: string;
};

type CheckResult = { checkedRules: number; notifications: number; matches: MatchRecord[]; summaries: RuleSummary[] };
type MarketAnalysis = { lots: number; history: number; currentMin?: number; currentMedian?: number; historyMedian?: number };
type SalesHistoryEntry = { amount: number; price: number; unitPrice: number; time: string; quality?: string; qualityCode?: number; upgrade?: number };
type SalesHistoryResponse = { total: number; entries: SalesHistoryEntry[] };
type MarketInsight = {
  name: string; itemId: string; region: string; activeLots: number; matchingLots: number;
  salesSample: number; soldAmount: number; currentMinUnit?: number; medianUnit?: number;
  averageUnit?: number; p25Unit?: number; p75Unit?: number; discountPercent?: number;
  trendPercent?: number; volatilityPercent?: number; salesPerDay?: number;
  averageSaleIntervalMinutes?: number; opportunityScore: number; liquidity: string;
  verdict: string; risks: string[];
};
type MarketAnalyticsResponse = { generatedAt: string; insights: MarketInsight[] };

type ArtifactQuality = "common" | "uncommon" | "special" | "rare" | "exceptional" | "legendary";
const artifactQualities: { value: ArtifactQuality; label: string }[] = [
  { value: "common", label: "Обычный" },
  { value: "uncommon", label: "Необычный" },
  { value: "special", label: "Особый" },
  { value: "rare", label: "Редкий" },
  { value: "exceptional", label: "Исключительный" },
  { value: "legendary", label: "Легендарный" },
];

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">AO</span><div><strong>Аукцион</strong><small>STALZONE WATCHER</small></div></div>
      <div class="top-actions">
        <label class="compact-field"><span>Регион</span><select id="region"><option>EU</option><option>RU</option><option>NA</option><option>SEA</option><option>NEA</option></select></label>
        <span id="credentials" class="status-pill"><i data-lucide="key-round"></i> Проверка ключей</span>
        <button id="save" class="icon-button" title="Сохранить правила"><i data-lucide="save"></i></button>
      </div>
    </header>

    <aside class="catalog-panel">
      <div class="panel-heading"><div><span class="eyebrow">База предметов</span><h1>Каталог</h1></div><span id="item-count" class="count">0</span></div>
      <div class="db-controls">
        <div class="source-badge"><i data-lucide="database"></i><span><strong>EXBO Online</strong><small>GitHub API / stalzone-database</small></span></div>
        <button id="catalog-refresh" class="icon-button" title="Обновить каталог из официальной базы"><i data-lucide="refresh-cw"></i></button>
        <div class="segmented" id="realm"><button class="active" data-value="global">Global</button><button data-value="ru">RU</button></div>
      </div>
      <label class="search"><i data-lucide="search"></i><input id="search" placeholder="Название, ID, категория" /></label>
      <div id="category-tabs" class="category-tabs"><button class="active" data-category="">Все</button></div>
      <div id="catalog-list" class="catalog-list"><div class="empty-state"><i data-lucide="database"></i><p>Укажите папку с базой</p></div></div>
      <div id="selected-item" class="selected-item hidden">
        <div class="item-image"><img id="item-image" alt="" /></div>
        <div class="selected-copy"><strong id="item-name"></strong><span id="item-meta"></span></div>
        <button id="item-history" class="icon-button" title="История продаж"><i data-lucide="history"></i></button>
        <button id="use-item" class="icon-button primary" title="Создать правило для предмета"><i data-lucide="plus"></i></button>
      </div>
    </aside>

    <main class="workspace">
      <nav class="workspace-tabs">
        <button class="active" data-view="overview"><i data-lucide="layout-dashboard"></i> Обзор рынка</button>
        <button data-view="config"><i data-lucide="sliders-horizontal"></i> Правила и фильтры</button>
        <button data-view="history"><i data-lucide="history"></i> История продаж</button>
        <button data-view="analytics"><i data-lucide="sparkles"></i> Аналитика</button>
      </nav>

      <div id="overview-view" class="workspace-view">
        <section class="overview-head">
          <div><span class="eyebrow">Состояние рынка</span><h2>Активные правила</h2></div>
          <div class="overview-actions"><span id="overview-updated">Ещё не проверялось</span><button id="overview-check" class="primary"><i data-lucide="refresh-cw"></i> Обновить рынок</button></div>
        </section>
        <section class="overview-stats">
          <div><span>Правил в работе</span><strong id="overview-rules">0</strong><small>в выбранных регионах</small></div>
          <div><span>Подходящих лотов</span><strong id="overview-matches">—</strong><small>сейчас на аукционе</small></div>
          <div><span>Лотов проверено</span><strong id="overview-lots">—</strong><small>последний срез</small></div>
          <div><span>Следующая проверка</span><strong id="overview-next">—</strong><small id="overview-mode">мониторинг выключен</small></div>
        </section>
        <section id="market-rules" class="market-rules"></section>
      </div>

      <div id="config-view" class="workspace-view hidden">
      <section class="rule-editor">
        <div class="section-heading"><div><span class="eyebrow">Условия поиска</span><h2>Правило отслеживания</h2></div><button id="clear-form" class="text-button"><i data-lucide="rotate-ccw"></i> Очистить</button></div>
        <div class="identity-grid">
          <label><span>Название</span><input id="rule-name" placeholder="Например, Атом выгодно" /></label>
          <label><span>Item ID</span><input id="item-id" placeholder="Выберите предмет слева" /></label>
        </div>

        <div class="filter-section">
          <div class="filter-title"><i data-lucide="coins"></i><div><strong>Цена и количество</strong><span>Достаточно одного лимита, остальные можно оставить пустыми</span></div></div>
          <div class="filter-grid three">
            <label title="Максимальная цена выкупа всего лота"><span>Выкуп всего, до</span><div class="money-input"><input id="max-buyout" type="number" min="0" placeholder="Без лимита" /><b>₽</b></div></label>
            <label title="Выкуп, делённый на количество предметов"><span>Цена за штуку, до</span><div class="money-input"><input id="max-unit" type="number" min="0" placeholder="Без лимита" /><b>₽</b></div></label>
            <label title="Минимально допустимое количество в лоте"><span>Количество, от</span><input id="min-amount" type="number" min="1" placeholder="Любое" /></label>
          </div>
        </div>

        <div class="filter-section artifact-section">
          <div class="filter-title"><i data-lucide="gem"></i><div><strong>Вариант артефакта</strong><span>Рыночная цена сравнивается только с такими же вариантами</span></div><button id="clear-artifact" class="icon-button small" title="Очистить редкость и заточку"><i data-lucide="x"></i></button></div>
          <div class="artifact-grid">
            <div class="quality-control"><span>Редкость</span><div id="quality-options" class="quality-options">
              ${artifactQualities.map((quality) => `<label class="quality-chip ${quality.value}"><input type="checkbox" value="${quality.value}" /><span>${quality.label}</span></label>`).join("")}
            </div></div>
            <div class="range-control"><span>Заточка</span><label>от <input id="min-upgrade" type="number" min="0" max="15" placeholder="+0" /></label><span class="dash">—</span><label>до <input id="max-upgrade" type="number" min="0" max="15" placeholder="+15" /></label></div>
          </div>
        </div>

        <div class="filter-section">
          <div class="filter-title"><i data-lucide="chart-no-axes-combined"></i><div><strong>Относительная выгода</strong><span>Процент от ориентира: 90% означает примерно на 10% дешевле</span></div></div>
          <div class="filter-grid two">
            <label title="Сравнение с медианой уже проданных лотов"><span>Не дороже медианы продаж</span><div class="percent-input"><input id="history-percent" type="number" min="1" max="200" placeholder="Не учитывать" /><b>%</b></div></label>
            <label title="Сравнение со следующим самым дешёвым активным лотом"><span>Не дороже текущего минимума</span><div class="percent-input"><input id="current-percent" type="number" min="1" max="200" placeholder="Не учитывать" /><b>%</b></div></label>
          </div>
          <div class="presets"><span>Быстрый выбор</span><button data-preset="safe">95% рынка</button><button data-preset="deal">90% медианы</button><button data-preset="snipe">80% медианы</button></div>
        </div>

        <div class="editor-actions"><button id="analyze" class="secondary"><i data-lucide="bar-chart-3"></i> Анализ рынка</button><button id="upsert" class="primary"><i data-lucide="check"></i> Добавить правило</button></div>
      </section>

      <section class="rules-section">
        <div class="section-heading"><div><span class="eyebrow">Watchlist</span><h2>Активные правила <span id="rule-count">0</span></h2></div></div>
        <div id="rules-list" class="rules-list"><div class="empty-inline">Правил пока нет. Выберите предмет и задайте условия.</div></div>
      </section>
      </div>

      <div id="history-view" class="workspace-view hidden">
        <section class="history-head">
          <div><span class="eyebrow">Проданные лоты</span><h2 id="history-title">Выберите предмет в каталоге</h2><small id="history-subtitle">История ещё не загружена</small></div>
          <button id="history-load" class="primary"><i data-lucide="refresh-cw"></i> Загрузить</button>
        </section>
        <section class="history-filters">
          <label><span>Регион</span><select id="history-region"><option>RU</option><option>EU</option><option>NA</option><option>SEA</option><option>NEA</option></select></label>
          <label><span>Последних продаж</span><select id="history-limit"><option>50</option><option selected>100</option><option>200</option></select></label>
          <label><span>Количество в лоте, от</span><input id="history-min-amount" type="number" min="1" placeholder="Любое" /></label>
          <label><span>до</span><input id="history-max-amount" type="number" min="1" placeholder="Любое" /></label>
          <div class="history-mode"><span>Цена</span><div class="segmented" id="history-price-mode"><button class="active" data-value="total">За лот</button><button data-value="unit">За штуку</button></div></div>
          <div class="history-mode"><span>Вид</span><div class="segmented" id="history-view-mode"><button class="active" data-value="chart"><i data-lucide="chart-line"></i></button><button data-value="table"><i data-lucide="table-2"></i></button></div></div>
          <button id="history-reset" class="secondary"><i data-lucide="rotate-ccw"></i> Сбросить</button>
        </section>
        <section id="history-artifact-filters" class="history-artifact-filters hidden">
          <span>Редкость</span><div id="history-quality-options" class="quality-options">
            ${artifactQualities.map((quality) => `<label class="quality-chip ${quality.value}"><input type="checkbox" value="${quality.value}" /><span>${quality.label}</span></label>`).join("")}
          </div>
          <div class="history-upgrade"><span>Заточка</span><input id="history-min-upgrade" type="number" min="0" max="15" placeholder="от" /><b>—</b><input id="history-max-upgrade" type="number" min="0" max="15" placeholder="до" /></div>
        </section>
        <section class="history-stats">
          <div><span>Всего продаж</span><strong id="history-total">—</strong></div>
          <div><span>В выборке</span><strong id="history-count">—</strong></div>
          <div><span>Минимум</span><strong id="history-min">—</strong></div>
          <div><span>Медиана</span><strong id="history-median">—</strong></div>
          <div><span>Средняя</span><strong id="history-average">—</strong></div>
        </section>
        <section id="history-chart-wrap" class="history-data"><div id="history-legend" class="history-legend"></div><div id="history-chart"></div><div id="history-chart-empty" class="history-empty">Выберите предмет и загрузите продажи</div></section>
        <section id="history-table-wrap" class="history-data hidden"><div class="history-table-scroll"><table><thead><tr><th>Время</th><th class="history-quality-column">Редкость</th><th class="history-quality-column">Заточка</th><th>Количество</th><th>За лот</th><th>За штуку</th></tr></thead><tbody id="history-table-body"></tbody></table></div></section>
        <a class="chart-attribution" href="https://www.tradingview.com" target="_blank" rel="noreferrer">Charts by TradingView</a>
      </div>

      <div id="analytics-view" class="workspace-view hidden">
        <section class="analytics-head">
          <div><span class="eyebrow">Рыночные сигналы</span><h2>Полезная аналитика</h2><small id="analytics-updated">Используются предметы из активных правил</small></div>
          <button id="analytics-load" class="primary"><i data-lucide="refresh-cw"></i> Рассчитать</button>
        </section>
        <section class="analytics-stats">
          <div><i data-lucide="sparkles"></i><span>Лучший сигнал</span><strong id="analytics-best">—</strong><small id="analytics-best-name">нет расчёта</small></div>
          <div><i data-lucide="circle-dollar-sign"></i><span>Средняя скидка</span><strong id="analytics-discount">—</strong><small>к медиане продаж</small></div>
          <div><i data-lucide="trending-up"></i><span>Ликвидных рынков</span><strong id="analytics-liquid">—</strong><small>высокая скорость продаж</small></div>
          <div><i data-lucide="gauge"></i><span>Подходящих лотов</span><strong id="analytics-matches">—</strong><small>по активным правилам</small></div>
        </section>
        <section class="analytics-toolbar">
          <label><span>Регион</span><select id="analytics-region"><option value="all">Все</option><option>RU</option><option>EU</option><option>NA</option><option>SEA</option><option>NEA</option></select></label>
          <label><span>Сигнал</span><select id="analytics-signal"><option value="all">Все</option><option value="strong">Сильные</option><option value="interesting">Интересные</option><option value="risk">С риском</option></select></label>
          <label><span>Сортировка</span><select id="analytics-sort"><option value="score">Индекс возможности</option><option value="discount">Скидка</option><option value="liquidity">Ликвидность</option><option value="trend">Рост цены</option></select></label>
        </section>
        <section id="analytics-list" class="analytics-list"><div class="analytics-empty"><i data-lucide="sparkles"></i><strong>Рассчитайте рыночные сигналы</strong><span>Нужны активные правила и доступ к API</span></div></section>
      </div>
    </main>

    <aside class="monitor-panel">
      <div class="monitor-status"><div class="pulse" id="pulse"></div><div><span class="eyebrow">Мониторинг</span><strong id="monitor-label">Остановлен</strong></div></div>
      <div class="monitor-controls"><label><span>Интервал проверки</span><div><input id="interval" type="number" min="10" max="3600" value="60" /><b>сек</b></div></label><button id="monitor-toggle" class="primary"><i data-lucide="play"></i> Запустить</button><button id="check-once" class="secondary"><i data-lucide="refresh-cw"></i> Проверить сейчас</button></div>

      <div class="stats-grid"><div><span>Правил</span><strong id="stat-rules">0</strong></div><div><span>Найдено</span><strong id="stat-found">0</strong></div><div><span>Проверка</span><strong id="stat-time">—</strong></div></div>

      <section class="matches-section"><div class="side-heading"><h2>Найденные лоты</h2><button id="clear-matches" class="icon-button small" title="Очистить список"><i data-lucide="trash-2"></i></button></div><div id="matches" class="matches"><div class="empty-state compact"><i data-lucide="bell"></i><p>Подходящие лоты появятся здесь</p></div></div></section>
      <section class="log-section"><div class="side-heading"><h2>Журнал</h2></div><div id="log" class="log"></div></section>
    </aside>
  </div>

  <dialog id="analysis-dialog"><div class="dialog-head"><div><span class="eyebrow">Срез рынка</span><h2>Анализ цен</h2></div><button class="icon-button" data-close="analysis-dialog"><i data-lucide="x"></i></button></div><div id="analysis-content"></div></dialog>
  <dialog id="details-dialog"><div class="dialog-head"><div><span class="eyebrow">Уведомление</span><h2>Детали лота</h2></div><button class="icon-button" data-close="details-dialog"><i data-lucide="x"></i></button></div><pre id="details-content"></pre></dialog>
  <div id="toast" class="toast"></div>
`;

createIcons({ icons: appIcons });

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const input = (id: string) => $<HTMLInputElement>(`#${id}`);
const value = (id: string) => input(id).value.trim();
const numberValue = (id: string): number | undefined => value(id) === "" ? undefined : Number(value(id));
const money = (amount?: number) => amount == null ? "—" : Math.round(amount).toLocaleString("ru-RU");
const escapeHtml = (text: string) => text.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);

let catalog: CatalogItem[] = [];
let selected: CatalogItem | undefined;
let rules: Rule[] = [];
let matches: MatchRecord[] = [];
let category = "";
let realm = "global";
let monitorTimer: number | undefined;
let checking = false;
let editingIndex: number | undefined;
let ruleSummaries: RuleSummary[] = [];
let nextCheckAt: number | undefined;
let historyItem: CatalogItem | undefined;
let historyEntries: SalesHistoryEntry[] = [];
let historyTotal = 0;
let historyPriceMode: "total" | "unit" = "total";
let historyDisplayMode: "chart" | "table" = "chart";
let historyChart: IChartApi | undefined;
let historyResizeObserver: ResizeObserver | undefined;
let analyticsInsights: MarketInsight[] = [];

function toast(message: string, danger = false) {
  const element = $("#toast");
  element.textContent = message;
  element.className = `toast show${danger ? " danger" : ""}`;
  window.setTimeout(() => element.classList.remove("show"), 3200);
}

function log(message: string, danger = false) {
  const line = document.createElement("div");
  line.className = danger ? "danger" : "";
  line.innerHTML = `<time>${new Date().toLocaleTimeString("ru-RU")}</time><span>${escapeHtml(message)}</span>`;
  $("#log").prepend(line);
}

async function loadCatalog() {
  $("#catalog-list").innerHTML = `<div class="loading"><span></span>Загрузка базы...</div>`;
  $("#catalog-refresh").classList.add("busy");
  try {
    catalog = await invoke<CatalogItem[]>("load_catalog", { realm });
    const categories = [...new Set(catalog.map((item) => item.category).filter(Boolean))].sort();
    $("#category-tabs").innerHTML = `<button class="active" data-category="">Все</button>${categories.map((name) => `<button data-category="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}`;
    category = "";
    renderCatalog();
    log(`Каталог EXBO загружен через API: ${catalog.length} предметов`);
  } catch (error) {
    catalog = [];
    $("#catalog-list").innerHTML = `<div class="empty-state"><i data-lucide="database-zap"></i><p>База не найдена</p><small>${escapeHtml(String(error))}</small></div>`;
    createIcons({ icons: appIcons });
    log(String(error), true);
  } finally {
    $("#catalog-refresh").classList.remove("busy");
  }
}

function renderCatalog() {
  const query = value("search").toLocaleLowerCase("ru");
  const filtered = catalog.filter((item) => (!category || item.category === category) && `${item.id} ${item.nameRu} ${item.nameEn} ${item.category} ${item.subcategory}`.toLocaleLowerCase("ru").includes(query));
  $("#item-count").textContent = String(filtered.length);
  $("#catalog-list").innerHTML = filtered.slice(0, 400).map((item) => `
    <button class="catalog-row${selected?.id === item.id ? " selected" : ""}" data-id="${escapeHtml(item.id)}">
      <span class="rarity" style="--rarity:${/^#[0-9a-f]{6}$/i.test(item.color) ? item.color : "#7f9188"}"></span>
      <span><strong>${escapeHtml(item.nameRu || item.nameEn || item.id)}</strong><small>${escapeHtml(item.id)} · ${escapeHtml(item.subcategory || item.category)}</small></span>
      <i data-lucide="chevron-right"></i>
    </button>`).join("") || `<div class="empty-state compact"><i data-lucide="search-x"></i><p>Ничего не найдено</p></div>`;
  createIcons({ icons: appIcons });
}

async function selectItem(item: CatalogItem) {
  selected = item;
  renderCatalog();
  $("#selected-item").classList.remove("hidden");
  $("#item-name").textContent = item.nameRu || item.nameEn || item.id;
  $("#item-meta").textContent = `${item.id} · ${item.subcategory || item.category}`;
  const image = $<HTMLImageElement>("#item-image");
  image.removeAttribute("src");
  if (item.iconPath) {
    try { image.src = await invoke<string>("read_image", { path: item.iconPath }); } catch { /* icon is optional */ }
  }
}

function currentRule(): Rule {
  const itemId = value("item-id");
  if (!itemId) throw new Error("Выберите предмет или укажите Item ID");
  const selectedQualities = [...document.querySelectorAll<HTMLInputElement>("#quality-options input:checked")].map((checkbox) => checkbox.value as ArtifactQuality);
  const minUpgrade = numberValue("min-upgrade");
  const maxUpgrade = numberValue("max-upgrade");
  if (minUpgrade != null && maxUpgrade != null && minUpgrade > maxUpgrade) throw new Error("Минимальная заточка не может быть больше максимальной");
  return {
    name: value("rule-name") || selected?.nameRu || itemId,
    itemId,
    region: $<HTMLSelectElement>("#region").value,
    maxBuyout: numberValue("max-buyout"), maxUnitBuyout: numberValue("max-unit"), minAmount: numberValue("min-amount"),
    artifactQualities: selectedQualities, minUpgrade, maxUpgrade,
    maxHistoryMedianRatio: numberValue("history-percent") == null ? undefined : numberValue("history-percent")! / 100,
    maxCurrentMinRatio: numberValue("current-percent") == null ? undefined : numberValue("current-percent")! / 100,
    historyLimit: 100, limit: 50, sort: "time_created", order: "desc", additional: true,
  };
}

function describeRange(label: string, min?: number, max?: number, prefix = "") {
  if (min == null && max == null) return "";
  if (min === max) return `${label} ${prefix}${min}`;
  if (min != null && max != null) return `${label} ${prefix}${min}–${prefix}${max}`;
  return min != null ? `${label} от ${prefix}${min}` : `${label} до ${prefix}${max}`;
}

function describeRule(rule: Rule) {
  const qualities = rule.artifactQualities?.map((value) => artifactQualities.find((quality) => quality.value === value)?.label).filter(Boolean);
  return [
    rule.maxBuyout != null ? `лот ≤ ${money(rule.maxBuyout)}` : "",
    rule.maxUnitBuyout != null ? `шт. ≤ ${money(rule.maxUnitBuyout)}` : "",
    rule.minAmount != null ? `кол-во ≥ ${rule.minAmount}` : "",
    qualities?.length ? `редкость: ${qualities.join(", ")}` : "",
    describeRange("заточка", rule.minUpgrade, rule.maxUpgrade, "+"),
    rule.maxHistoryMedianRatio != null ? `≤ ${rule.maxHistoryMedianRatio * 100}% медианы` : "",
    rule.maxCurrentMinRatio != null ? `≤ ${rule.maxCurrentMinRatio * 100}% рынка` : "",
  ].filter(Boolean).join(" · ") || "Без ценовых ограничений";
}

function switchView(view: "overview" | "config" | "history" | "analytics") {
  $("#overview-view").classList.toggle("hidden", view !== "overview");
  $("#config-view").classList.toggle("hidden", view !== "config");
  $("#history-view").classList.toggle("hidden", view !== "history");
  $("#analytics-view").classList.toggle("hidden", view !== "analytics");
  document.querySelectorAll<HTMLButtonElement>(".workspace-tabs button").forEach((button) =>
    button.classList.toggle("active", button.dataset.view === view));
  $(".workspace").scrollTop = 0;
}

function summaryFor(rule: Rule) {
  return ruleSummaries.find((summary) => summary.itemId === rule.itemId && summary.region === rule.region);
}

function marketPosition(rule: Rule, summary: RuleSummary) {
  const limit = rule.maxBuyout ?? rule.maxUnitBuyout;
  const market = rule.maxBuyout != null ? summary.currentMinBuyout : summary.currentMinUnit;
  if (limit == null || market == null) return { text: "Относительные условия", percent: 0, favorable: summary.matchingLots > 0 };
  const difference = limit - market;
  return {
    text: difference >= 0 ? `ниже лимита на ${money(difference)} ₽` : `выше лимита на ${money(Math.abs(difference))} ₽`,
    percent: Math.min(100, Math.max(4, market / limit * 100)),
    favorable: difference >= 0,
  };
}

function renderOverview() {
  const totalMatches = ruleSummaries.reduce((sum, summary) => sum + summary.matchingLots, 0);
  const totalLots = ruleSummaries.reduce((sum, summary) => sum + summary.totalLots, 0);
  $("#overview-rules").textContent = String(rules.length);
  $("#overview-matches").textContent = ruleSummaries.length ? String(totalMatches) : "—";
  $("#overview-lots").textContent = ruleSummaries.length ? String(totalLots) : "—";

  $("#market-rules").innerHTML = rules.map((rule, index) => {
    const summary = summaryFor(rule);
    if (!summary) return `<article class="market-rule pending" data-market-rule="${index}">
      <div class="market-rule-main"><span class="rule-region">${escapeHtml(rule.region)}</span><div><strong>${escapeHtml(rule.name)}</strong><small>${escapeHtml(describeRule(rule))}</small></div></div>
      <div class="market-pending"><span></span>Ожидает проверки</div>
      <button class="icon-button small market-edit" title="Изменить правило"><i data-lucide="pencil"></i></button>
    </article>`;
    const position = marketPosition(rule, summary);
    const stateClass = summary.matchingLots > 0 ? "success" : summary.totalLots ? "quiet" : "empty";
    const stateText = summary.matchingLots > 0 ? `Подходит: ${summary.matchingLots}` : summary.totalLots ? "Подходящих нет" : "Нет лотов";
    const limit = rule.maxBuyout ?? rule.maxUnitBuyout;
    const market = rule.maxBuyout != null ? summary.currentMinBuyout : summary.currentMinUnit;
    return `<article class="market-rule ${stateClass}" data-market-rule="${index}">
      <div class="market-rule-main"><span class="rule-region">${escapeHtml(rule.region)}</span><div><strong>${escapeHtml(rule.name)}</strong><small>${escapeHtml(rule.itemId)} · ${escapeHtml(describeRule(rule))}</small></div></div>
      <div class="market-state ${stateClass}"><span></span>${stateText}</div>
      <button class="icon-button small market-edit" title="Изменить правило"><i data-lucide="pencil"></i></button>
      <div class="market-metrics">
        <div><span>Минимум рынка</span><strong>${money(market)} ₽</strong></div>
        <div><span>Ваш лимит</span><strong>${money(limit)} ₽</strong></div>
        <div><span>Активных</span><strong>${summary.totalLots}</strong></div>
        <div><span>Сравнимых</span><strong>${summary.comparableLots}</strong></div>
      </div>
      <div class="price-position"><div><span>${position.favorable ? "В пределах правила" : "Пока вне правила"}</span><b>${position.text}</b></div><div class="price-track"><span class="${position.favorable ? "favorable" : ""}" style="width:${position.percent}%"></span></div></div>
    </article>`;
  }).join("") || `<div class="overview-empty"><i data-lucide="sliders-horizontal"></i><strong>Добавьте первое правило</strong><button class="secondary" data-open-config>Настроить фильтры</button></div>`;
  createIcons({ icons: appIcons });
}

function itemIsArtifact(item?: CatalogItem) {
  const categoryName = `${item?.category || ""} ${item?.subcategory || ""}`.toLowerCase();
  return categoryName.includes("artefact") || categoryName.includes("artifact");
}

function selectedHistoryQualityCodes() {
  return [...document.querySelectorAll<HTMLInputElement>("#history-quality-options input:checked")]
    .map((checkbox) => artifactQualities.findIndex((quality) => quality.value === checkbox.value))
    .filter((code) => code >= 0);
}

function filteredHistoryEntries() {
  const minAmount = numberValue("history-min-amount");
  const maxAmount = numberValue("history-max-amount");
  const minUpgrade = numberValue("history-min-upgrade");
  const maxUpgrade = numberValue("history-max-upgrade");
  const qualities = selectedHistoryQualityCodes();
  const artifact = itemIsArtifact(historyItem);
  return historyEntries.filter((entry) => {
    if (minAmount != null && entry.amount < minAmount) return false;
    if (maxAmount != null && entry.amount > maxAmount) return false;
    if (artifact && qualities.length && (entry.qualityCode == null || !qualities.includes(entry.qualityCode))) return false;
    if (artifact && minUpgrade != null && (entry.upgrade == null || entry.upgrade < minUpgrade)) return false;
    if (artifact && maxUpgrade != null && (entry.upgrade == null || entry.upgrade > maxUpgrade)) return false;
    return true;
  });
}

function medianValue(values: number[]) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function renderHistoryChart(entries: SalesHistoryEntry[]) {
  historyResizeObserver?.disconnect();
  historyChart?.remove();
  historyChart = undefined;
  const container = $("#history-chart");
  container.innerHTML = "";
  if (!entries.length || historyDisplayMode !== "chart") return;

  historyChart = createChart(container, {
    width: container.clientWidth,
    height: Math.max(330, container.clientHeight),
    layout: { background: { type: ColorType.Solid, color: "#101513" }, textColor: "#899790", attributionLogo: false },
    grid: { vertLines: { color: "#26302c" }, horzLines: { color: "#26302c" } },
    rightPriceScale: { borderColor: "#35413c", scaleMargins: { top: 0.12, bottom: 0.12 } },
    timeScale: { borderColor: "#35413c", timeVisible: true, secondsVisible: false, rightOffset: 4 },
    localization: { locale: "ru-RU", priceFormatter: (price: number) => `${money(price)} ₽` },
  });

  const groups = new Map<string, SalesHistoryEntry[]>();
  for (const entry of entries) {
    const group = itemIsArtifact(historyItem) ? entry.quality || "Без редкости" : historyItem?.nameRu || historyItem?.id || "Цена";
    groups.set(group, [...(groups.get(group) || []), entry]);
  }
  const colors: Record<string, string> = {
    "Обычный": "#c5cbc8", "Необычный": "#61d36d", "Особый": "#54a8ff",
    "Редкий": "#c379df", "Исключительный": "#ef7169", "Легендарный": "#e8bd64",
    "Без редкости": "#8d9b94",
  };
  $("#history-legend").innerHTML = [...groups.keys()].map((name) => `<span><i style="--series-color:${colors[name] || "#70cf98"}"></i>${escapeHtml(name)}</span>`).join("");

  for (const [name, groupEntries] of groups) {
    const byTime = new Map<number, number[]>();
    for (const entry of groupEntries) {
      const timestamp = Math.floor(Date.parse(entry.time) / 1000);
      if (!Number.isFinite(timestamp)) continue;
      const priceValue = historyPriceMode === "unit" ? entry.unitPrice : entry.price;
      byTime.set(timestamp, [...(byTime.get(timestamp) || []), priceValue]);
    }
    const points = [...byTime.entries()].sort(([a], [b]) => a - b).map(([time, prices]) => ({
      time: time as UTCTimestamp,
      value: prices.reduce((sum, price) => sum + price, 0) / prices.length,
    }));
    if (!points.length) continue;
    const series = historyChart.addSeries(LineSeries, {
      color: colors[name] || "#70cf98", lineWidth: 2, pointMarkersVisible: true,
      pointMarkersRadius: 2, crosshairMarkerRadius: 4, priceLineVisible: false,
    });
    series.setData(points);
  }
  historyChart.timeScale().fitContent();
  historyResizeObserver = new ResizeObserver(() => {
    if (historyChart && container.clientWidth > 0) historyChart.applyOptions({ width: container.clientWidth, height: Math.max(330, container.clientHeight) });
  });
  historyResizeObserver.observe(container);
}

function renderSalesHistory() {
  const artifact = itemIsArtifact(historyItem);
  $("#history-artifact-filters").classList.toggle("hidden", !artifact);
  document.querySelectorAll<HTMLElement>(".history-quality-column").forEach((cell) => cell.classList.toggle("hidden", !artifact));
  const entries = filteredHistoryEntries();
  const prices = entries.map((entry) => historyPriceMode === "unit" ? entry.unitPrice : entry.price);
  $("#history-total").textContent = historyTotal ? historyTotal.toLocaleString("ru-RU") : "—";
  $("#history-count").textContent = String(entries.length);
  $("#history-min").textContent = prices.length ? `${money(Math.min(...prices))} ₽` : "—";
  $("#history-median").textContent = prices.length ? `${money(medianValue(prices))} ₽` : "—";
  $("#history-average").textContent = prices.length ? `${money(prices.reduce((sum, price) => sum + price, 0) / prices.length)} ₽` : "—";
  $("#history-chart-wrap").classList.toggle("hidden", historyDisplayMode !== "chart");
  $("#history-table-wrap").classList.toggle("hidden", historyDisplayMode !== "table");
  $("#history-chart-empty").classList.toggle("hidden", entries.length > 0);

  $("#history-table-body").innerHTML = [...entries].sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).map((entry) => `<tr>
    <td>${escapeHtml(new Date(entry.time).toLocaleString("ru-RU"))}</td>
    ${artifact ? `<td><span class="table-quality quality-${entry.qualityCode ?? "none"}">${escapeHtml(entry.quality || "—")}</span></td><td>${entry.upgrade == null ? "—" : `+${entry.upgrade}`}</td>` : ""}
    <td>${entry.amount.toLocaleString("ru-RU")}</td><td>${money(entry.price)} ₽</td><td>${money(entry.unitPrice)} ₽</td>
  </tr>`).join("") || `<tr><td colspan="6" class="table-empty">Нет продаж по выбранным фильтрам</td></tr>`;
  renderHistoryChart(entries);
}

async function loadSalesHistory() {
  if (!historyItem) { toast("Сначала выберите предмет в каталоге", true); return; }
  $("#history-load").classList.add("busy");
  try {
    const response = await invoke<SalesHistoryResponse>("sales_history", {
      itemId: historyItem.id,
      region: $<HTMLSelectElement>("#history-region").value,
      limit: Number($<HTMLSelectElement>("#history-limit").value),
    });
    historyEntries = response.entries; historyTotal = response.total;
    $("#history-subtitle").textContent = `${response.total.toLocaleString("ru-RU")} продаж в API · загружено ${response.entries.length}`;
    renderSalesHistory();
  } catch (error) { toast(String(error), true); log(String(error), true); }
  finally { $("#history-load").classList.remove("busy"); }
}

function openHistory(item: CatalogItem) {
  historyItem = item; historyEntries = []; historyTotal = 0;
  $("#history-title").textContent = item.nameRu || item.nameEn || item.id;
  $("#history-subtitle").textContent = `${item.id} · ${item.subcategory || item.category}`;
  $<HTMLSelectElement>("#history-region").value = $<HTMLSelectElement>("#region").value;
  switchView("history"); renderSalesHistory(); void loadSalesHistory();
}

function signedPercent(value?: number) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatInterval(minutes?: number) {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  if (minutes < 1) return "<1 мин";
  if (minutes < 60) return `${Math.round(minutes)} мин`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)} ч`;
  return `${(minutes / 1440).toFixed(1)} дн`;
}

function renderAnalytics() {
  const discounts = analyticsInsights.map((item) => item.discountPercent).filter((value): value is number => value != null);
  const best = analyticsInsights[0];
  $("#analytics-best").textContent = best ? `${best.opportunityScore}/100` : "—";
  $("#analytics-best-name").textContent = best?.name || "нет расчёта";
  $("#analytics-discount").textContent = discounts.length ? signedPercent(discounts.reduce((sum, value) => sum + value, 0) / discounts.length) : "—";
  $("#analytics-liquid").textContent = analyticsInsights.length ? String(analyticsInsights.filter((item) => item.liquidity === "Высокая").length) : "—";
  $("#analytics-matches").textContent = analyticsInsights.length ? String(analyticsInsights.reduce((sum, item) => sum + item.matchingLots, 0)) : "—";

  const region = $<HTMLSelectElement>("#analytics-region").value;
  const signal = $<HTMLSelectElement>("#analytics-signal").value;
  const sort = $<HTMLSelectElement>("#analytics-sort").value;
  const liquidityRank: Record<string, number> = { "Высокая": 3, "Средняя": 2, "Низкая": 1 };
  const filtered = analyticsInsights.filter((item) => {
    if (region !== "all" && item.region !== region) return false;
    if (signal === "strong" && item.opportunityScore < 75) return false;
    if (signal === "interesting" && (item.opportunityScore < 55 || item.opportunityScore >= 75)) return false;
    if (signal === "risk" && !item.risks.length) return false;
    return true;
  }).sort((a, b) => {
    if (sort === "discount") return (b.discountPercent ?? -Infinity) - (a.discountPercent ?? -Infinity);
    if (sort === "liquidity") return (liquidityRank[b.liquidity] || 0) - (liquidityRank[a.liquidity] || 0);
    if (sort === "trend") return (b.trendPercent ?? -Infinity) - (a.trendPercent ?? -Infinity);
    return b.opportunityScore - a.opportunityScore;
  });

  $("#analytics-list").innerHTML = filtered.map((item) => {
    const scoreClass = item.opportunityScore >= 75 ? "strong" : item.opportunityScore >= 55 ? "interesting" : item.opportunityScore >= 35 ? "watch" : "weak";
    const discountClass = (item.discountPercent ?? 0) > 0 ? "positive" : "negative";
    const trendClass = (item.trendPercent ?? 0) > 0 ? "positive" : (item.trendPercent ?? 0) < 0 ? "negative" : "";
    return `<article class="insight-card ${scoreClass}" data-insight-id="${escapeHtml(item.itemId)}" data-insight-region="${escapeHtml(item.region)}">
      <div class="insight-heading"><span class="rule-region">${escapeHtml(item.region)}</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.itemId)} · ${item.salesSample} продаж в расчёте</small></div></div>
      <div class="score-box ${scoreClass}"><strong>${item.opportunityScore}</strong><span>${escapeHtml(item.verdict)}</span></div>
      <div class="insight-actions"><button class="icon-button small insight-history" title="Открыть историю продаж"><i data-lucide="history"></i></button><button class="icon-button small insight-edit" title="Изменить правило"><i data-lucide="pencil"></i></button></div>
      <div class="insight-signal"><div><span>Текущий минимум</span><strong>${money(item.currentMinUnit)} ₽/шт.</strong></div><div><span>Справедливая цена</span><strong>${money(item.medianUnit)} ₽/шт.</strong></div><div><span>Скидка к медиане</span><strong class="${discountClass}">${signedPercent(item.discountPercent)}</strong></div></div>
      <div class="opportunity-track"><span class="${scoreClass}" style="width:${item.opportunityScore}%"></span></div>
      <div class="price-zones"><div><span>Зона покупки · P25</span><strong>${money(item.p25Unit)} ₽</strong></div><div><span>Медиана</span><strong>${money(item.medianUnit)} ₽</strong></div><div><span>Дорогая зона · P75</span><strong>${money(item.p75Unit)} ₽</strong></div></div>
      <div class="insight-metrics"><div><span>Тренд</span><strong class="${trendClass}">${signedPercent(item.trendPercent)}</strong></div><div><span>Разброс цены</span><strong>${signedPercent(item.volatilityPercent)}</strong></div><div><span>Продаж в день</span><strong>${item.salesPerDay == null ? "—" : item.salesPerDay.toFixed(1)}</strong></div><div><span>Интервал продажи</span><strong>${formatInterval(item.averageSaleIntervalMinutes)}</strong></div><div><span>Ликвидность</span><strong>${escapeHtml(item.liquidity)}</strong></div><div><span>Активных / подходит</span><strong>${item.activeLots} / ${item.matchingLots}</strong></div></div>
      <div class="risk-row">${item.risks.length ? item.risks.map((risk) => `<span><i data-lucide="shield-alert"></i>${escapeHtml(risk)}</span>`).join("") : `<span class="clear"><i data-lucide="shield-check"></i>Явных рисков нет</span>`}</div>
    </article>`;
  }).join("") || `<div class="analytics-empty"><i data-lucide="sparkles"></i><strong>${analyticsInsights.length ? "Нет сигналов по выбранным фильтрам" : "Рассчитайте рыночные сигналы"}</strong><span>${rules.length ? "Расчёт использует активные правила" : "Сначала добавьте хотя бы одно правило"}</span></div>`;
  createIcons({ icons: appIcons });
}

async function loadAnalytics() {
  if (!rules.length) { toast("Для аналитики нужно хотя бы одно активное правило", true); return; }
  $("#analytics-load").classList.add("busy");
  $("#analytics-updated").textContent = `Анализирую рынки: ${rules.length}`;
  try {
    const response = await invoke<MarketAnalyticsResponse>("market_analytics", { rules });
    analyticsInsights = response.insights;
    $("#analytics-updated").textContent = `Обновлено ${new Date(response.generatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
    renderAnalytics();
    $(".workspace").scrollTop = 0;
  } catch (error) { toast(String(error), true); log(String(error), true); $("#analytics-updated").textContent = "Не удалось рассчитать аналитику"; }
  finally { $("#analytics-load").classList.remove("busy"); }
}

function renderRules() {
  $("#rule-count").textContent = String(rules.length);
  $("#stat-rules").textContent = String(rules.length);
  $("#rules-list").innerHTML = rules.map((rule, index) => `
    <article class="rule-row${editingIndex === index ? " editing" : ""}" data-index="${index}">
      <span class="rule-region">${escapeHtml(rule.region)}</span><div><strong>${escapeHtml(rule.name)}</strong><small>${escapeHtml(rule.itemId)} · ${escapeHtml(describeRule(rule))}</small></div>
      <button class="icon-button small edit-rule" title="Изменить"><i data-lucide="pencil"></i></button><button class="icon-button small delete-rule" title="Удалить"><i data-lucide="trash-2"></i></button>
    </article>`).join("") || `<div class="empty-inline">Правил пока нет. Выберите предмет и задайте условия.</div>`;
  createIcons({ icons: appIcons });
  renderOverview();
}

function setForm(rule?: Rule) {
  const fields: [string, string | number | undefined][] = [
    ["rule-name", rule?.name], ["item-id", rule?.itemId], ["max-buyout", rule?.maxBuyout], ["max-unit", rule?.maxUnitBuyout], ["min-amount", rule?.minAmount],
    ["min-upgrade", rule?.minUpgrade], ["max-upgrade", rule?.maxUpgrade],
    ["history-percent", rule?.maxHistoryMedianRatio == null ? undefined : rule.maxHistoryMedianRatio * 100],
    ["current-percent", rule?.maxCurrentMinRatio == null ? undefined : rule.maxCurrentMinRatio * 100],
  ];
  fields.forEach(([id, fieldValue]) => input(id).value = fieldValue?.toString() || "");
  const legacyQualities = rule && !rule.artifactQualities?.length && (rule.minTier != null || rule.maxTier != null)
    ? artifactQualities.filter((_, index) => index + 1 >= (rule.minTier ?? 1) && index + 1 <= (rule.maxTier ?? 6)).map((quality) => quality.value)
    : [];
  const selectedQualities = rule?.artifactQualities?.length ? rule.artifactQualities : legacyQualities;
  document.querySelectorAll<HTMLInputElement>("#quality-options input").forEach((checkbox) => checkbox.checked = selectedQualities.includes(checkbox.value as ArtifactQuality));
  if (rule) $<HTMLSelectElement>("#region").value = rule.region;
  $("#upsert").innerHTML = `<i data-lucide="${rule ? "save" : "check"}"></i> ${rule ? "Сохранить изменения" : "Добавить правило"}`;
  createIcons({ icons: appIcons });
}

async function persistRules(showToast = true) {
  const region = $<HTMLSelectElement>("#region").value;
  const path = await invoke<string>("save_rules", { payload: { defaults: { region, limit: 50, sort: "time_created", order: "desc", additional: true }, items: rules } });
  if (showToast) toast("Правила сохранены");
  log(`Конфигурация сохранена: ${path}`);
}

function renderMatches() {
  $("#stat-found").textContent = String(matches.length);
  $("#matches").innerHTML = matches.map((match, index) => `
    <button class="match-row" data-match="${index}"><div><strong>${escapeHtml(match.name)}</strong><span>${escapeHtml(match.region)}${match.quality ? ` · ${escapeHtml(match.quality)}` : ""}${match.upgrade != null ? ` · +${match.upgrade}` : ""}</span></div><b>${money(match.buyout)} ₽</b><small>${match.amount} шт. · ${money(match.unit)} за шт.</small></button>`).join("") || `<div class="empty-state compact"><i data-lucide="bell"></i><p>Подходящие лоты появятся здесь</p></div>`;
  createIcons({ icons: appIcons });
}

async function desktopNotify(match: MatchRecord) {
  let permission = await isPermissionGranted();
  if (!permission) permission = (await requestPermission()) === "granted";
  if (permission) sendNotification({ title: `Найден лот: ${match.name}`, body: `${money(match.buyout)} ₽ · ${match.amount} шт.${match.upgrade != null ? ` · +${match.upgrade}` : ""}` });
}

async function runCheck(manual = false) {
  if (checking) return;
  if (!rules.length) { toast("Сначала добавьте хотя бы одно правило", true); return; }
  checking = true;
  $("#check-once").classList.add("busy");
  $("#overview-check").classList.add("busy");
  $("#overview-updated").textContent = "Получаю данные аукциона...";
  try {
    const result = await invoke<CheckResult>("check_rules", { rules, notifyExisting: true, includeSeen: manual });
    ruleSummaries = result.summaries;
    const combined = [...result.matches, ...matches];
    matches = combined.filter((match, index) => combined.findIndex((candidate) =>
      candidate.itemId === match.itemId && candidate.region === match.region &&
      candidate.end === match.end && candidate.buyout === match.buyout && candidate.amount === match.amount
    ) === index).slice(0, 100);
    renderMatches();
    $("#stat-time").textContent = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    $("#overview-updated").textContent = `Обновлено ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
    renderOverview();
    log(`Проверено правил: ${result.checkedRules}, найдено новых лотов: ${result.notifications}`);
    if (!manual) result.matches.forEach((match) => { void desktopNotify(match); });
    if (result.matches.length) toast(`Найдено лотов: ${result.matches.length}`);
    else if (manual) toast("Проверка завершена, новых лотов нет");
  } catch (error) {
    log(String(error), true); toast(String(error), true);
    $("#overview-updated").textContent = "Ошибка последней проверки";
  } finally {
    checking = false;
    $("#check-once").classList.remove("busy");
    $("#overview-check").classList.remove("busy");
    if (monitorTimer != null) nextCheckAt = Date.now() + Math.max(10, numberValue("interval") || 60) * 1000;
  }
}

function toggleMonitor() {
  const button = $("#monitor-toggle");
  if (monitorTimer != null) {
    clearInterval(monitorTimer); monitorTimer = undefined;
    nextCheckAt = undefined;
    $("#pulse").classList.remove("active"); $("#monitor-label").textContent = "Остановлен";
    $("#overview-mode").textContent = "мониторинг выключен";
    button.innerHTML = `<i data-lucide="play"></i> Запустить`; log("Мониторинг остановлен");
  } else {
    const seconds = Math.max(10, numberValue("interval") || 60);
    void runCheck();
    monitorTimer = window.setInterval(() => void runCheck(), seconds * 1000);
    nextCheckAt = Date.now() + seconds * 1000;
    $("#pulse").classList.add("active"); $("#monitor-label").textContent = `Активен · ${seconds} сек`;
    $("#overview-mode").textContent = `автоматически каждые ${seconds} сек`;
    button.innerHTML = `<i data-lucide="square"></i> Остановить`; log(`Мониторинг запущен, интервал ${seconds} сек`);
  }
  createIcons({ icons: appIcons });
}

$("#catalog-refresh").addEventListener("click", () => void loadCatalog());
$("#realm").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button"); if (!button) return;
  realm = button.dataset.value!; $("#realm").querySelectorAll("button").forEach((node) => node.classList.toggle("active", node === button)); void loadCatalog();
});
$("#search").addEventListener("input", renderCatalog);
$("#category-tabs").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button"); if (!button) return;
  category = button.dataset.category || ""; $("#category-tabs").querySelectorAll("button").forEach((node) => node.classList.toggle("active", node === button)); renderCatalog();
});
$("#catalog-list").addEventListener("click", (event) => {
  const row = (event.target as HTMLElement).closest<HTMLElement>("[data-id]"); const item = catalog.find((entry) => entry.id === row?.dataset.id); if (item) void selectItem(item);
});
$("#use-item").addEventListener("click", () => { if (!selected) return; switchView("config"); input("item-id").value = selected.id; input("rule-name").value = selected.nameRu || selected.nameEn || selected.id; input("rule-name").focus(); });
$("#item-history").addEventListener("click", () => { if (selected) openHistory(selected); });
$("#clear-form").addEventListener("click", () => { editingIndex = undefined; setForm(); renderRules(); });
$("#clear-artifact").addEventListener("click", () => {
  document.querySelectorAll<HTMLInputElement>("#quality-options input").forEach((checkbox) => checkbox.checked = false);
  ["min-upgrade", "max-upgrade"].forEach((id) => input(id).value = "");
});
document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((button) => button.addEventListener("click", () => {
  input("history-percent").value = button.dataset.preset === "safe" ? "" : button.dataset.preset === "deal" ? "90" : "80";
  input("current-percent").value = button.dataset.preset === "safe" ? "95" : "";
}));
$("#upsert").addEventListener("click", () => {
  try {
    const rule = currentRule();
    ruleSummaries = ruleSummaries.filter((summary) => !(summary.itemId === rule.itemId && summary.region === rule.region));
    analyticsInsights = [];
    if (editingIndex != null) rules[editingIndex] = rule;
    else { const duplicate = rules.findIndex((entry) => entry.itemId === rule.itemId && entry.region === rule.region); if (duplicate >= 0) rules[duplicate] = rule; else rules.push(rule); }
    editingIndex = undefined; setForm(); renderRules(); void persistRules(false); toast("Правило добавлено");
  } catch (error) { toast(String(error), true); }
});
$("#rules-list").addEventListener("click", (event) => {
  const row = (event.target as HTMLElement).closest<HTMLElement>("[data-index]"); if (!row) return;
  const index = Number(row.dataset.index);
  if ((event.target as HTMLElement).closest(".delete-rule")) { const removed = rules[index]; rules.splice(index, 1); ruleSummaries = ruleSummaries.filter((summary) => !(summary.itemId === removed.itemId && summary.region === removed.region)); analyticsInsights = []; editingIndex = undefined; renderRules(); renderAnalytics(); void persistRules(false); return; }
  editingIndex = index; setForm(rules[index]); renderRules(); $(".rule-editor").scrollIntoView({ behavior: "smooth" });
});
$("#save").addEventListener("click", () => void persistRules());
$("#analyze").addEventListener("click", async () => {
  try {
    const rule = currentRule(); $("#analyze").classList.add("busy");
    const result = await invoke<MarketAnalysis>("analyze_market", { rule });
    $("#analysis-content").innerHTML = `<div class="analysis-grid"><div><span>Активных лотов</span><strong>${result.lots}</strong></div><div><span>Продаж в истории</span><strong>${result.history}</strong></div><div><span>Текущий минимум / шт.</span><strong>${money(result.currentMin)} ₽</strong></div><div><span>Медиана активных / шт.</span><strong>${money(result.currentMedian)} ₽</strong></div><div class="wide"><span>Медиана продаж / шт.</span><strong>${money(result.historyMedian)} ₽</strong></div></div>${result.historyMedian != null ? `<div class="recommendations"><span>Ориентиры</span><button data-price="${Math.round(result.historyMedian * .8)}">80% · ${money(result.historyMedian * .8)} ₽</button><button data-price="${Math.round(result.historyMedian * .9)}">90% · ${money(result.historyMedian * .9)} ₽</button></div>` : ""}`;
    $<HTMLDialogElement>("#analysis-dialog").showModal();
  } catch (error) { toast(String(error), true); log(String(error), true); } finally { $("#analyze").classList.remove("busy"); }
});
$("#analysis-content").addEventListener("click", (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-price]"); if (button) { input("max-unit").value = button.dataset.price!; $<HTMLDialogElement>("#analysis-dialog").close(); toast("Лимит цены за штуку подставлен"); } });
$("#monitor-toggle").addEventListener("click", toggleMonitor);
$("#check-once").addEventListener("click", () => void runCheck(true));
$("#overview-check").addEventListener("click", () => void runCheck(true));
$(".workspace-tabs").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-view]"); if (!button) return;
  const view = button.dataset.view as "overview" | "config" | "history" | "analytics";
  if (view === "history" && selected && historyItem?.id !== selected.id) openHistory(selected); else switchView(view);
  if (view === "analytics" && !analyticsInsights.length && rules.length) void loadAnalytics();
});
$("#market-rules").addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("[data-open-config]")) { switchView("config"); return; }
  const row = (event.target as HTMLElement).closest<HTMLElement>("[data-market-rule]");
  if (!row || !(event.target as HTMLElement).closest(".market-edit")) return;
  editingIndex = Number(row.dataset.marketRule); setForm(rules[editingIndex]); renderRules(); switchView("config");
});
$("#clear-matches").addEventListener("click", () => { matches = []; renderMatches(); });
$("#matches").addEventListener("click", (event) => { const row = (event.target as HTMLElement).closest<HTMLElement>("[data-match]"); if (!row) return; $("#details-content").textContent = matches[Number(row.dataset.match)].message; $<HTMLDialogElement>("#details-dialog").showModal(); });
$("#history-load").addEventListener("click", () => void loadSalesHistory());
$("#history-price-mode").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button"); if (!button) return;
  historyPriceMode = button.dataset.value as "total" | "unit";
  $("#history-price-mode").querySelectorAll("button").forEach((node) => node.classList.toggle("active", node === button)); renderSalesHistory();
});
$("#history-view-mode").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button"); if (!button) return;
  historyDisplayMode = button.dataset.value as "chart" | "table";
  $("#history-view-mode").querySelectorAll("button").forEach((node) => node.classList.toggle("active", node === button)); renderSalesHistory();
});
["history-min-amount", "history-max-amount", "history-min-upgrade", "history-max-upgrade"].forEach((id) => input(id).addEventListener("input", renderSalesHistory));
$("#history-quality-options").addEventListener("change", renderSalesHistory);
$("#history-reset").addEventListener("click", () => {
  ["history-min-amount", "history-max-amount", "history-min-upgrade", "history-max-upgrade"].forEach((id) => input(id).value = "");
  document.querySelectorAll<HTMLInputElement>("#history-quality-options input").forEach((checkbox) => checkbox.checked = false);
  renderSalesHistory();
});
$("#analytics-load").addEventListener("click", () => void loadAnalytics());
["analytics-region", "analytics-signal", "analytics-sort"].forEach((id) => $<HTMLSelectElement>(`#${id}`).addEventListener("change", renderAnalytics));
$("#analytics-list").addEventListener("click", (event) => {
  const card = (event.target as HTMLElement).closest<HTMLElement>("[data-insight-id]"); if (!card) return;
  const itemId = card.dataset.insightId!; const region = card.dataset.insightRegion!;
  if ((event.target as HTMLElement).closest(".insight-history")) {
    const item = catalog.find((candidate) => candidate.id === itemId);
    if (item) { $<HTMLSelectElement>("#region").value = region; openHistory(item); } else toast("Предмет не найден в загруженном каталоге", true);
  }
  if ((event.target as HTMLElement).closest(".insight-edit")) {
    const index = rules.findIndex((rule) => rule.itemId === itemId && rule.region === region);
    if (index >= 0) { editingIndex = index; setForm(rules[index]); renderRules(); switchView("config"); }
  }
});
document.querySelectorAll<HTMLElement>("[data-close]").forEach((button) => button.addEventListener("click", () => $<HTMLDialogElement>(`#${button.dataset.close}`).close()));

window.setInterval(() => {
  if (nextCheckAt == null) { $("#overview-next").textContent = "—"; return; }
  const seconds = Math.max(0, Math.ceil((nextCheckAt - Date.now()) / 1000));
  $("#overview-next").textContent = seconds > 59 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : `${seconds} сек`;
}, 1000);

async function initialize() {
  try {
    const status = await invoke<{ ready: boolean; source?: string; message: string }>("credentials_status");
    $("#credentials").classList.toggle("ready", status.ready); $("#credentials").innerHTML = `<i data-lucide="${status.ready ? "shield-check" : "shield-alert"}"></i> ${escapeHtml(status.message)}`; $("#credentials").title = status.source || "Файл .env не найден";
    const config = await invoke<{ defaults?: { region?: string }; items?: Rule[] }>("load_rules");
    rules = config.items || []; if (config.defaults?.region) $<HTMLSelectElement>("#region").value = config.defaults.region;
  } catch (error) { log(String(error), true); }
  renderRules(); createIcons({ icons: appIcons }); await loadCatalog();
}

void initialize();
