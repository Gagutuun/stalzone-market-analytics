import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { ColorType, createChart, LineSeries, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import {
  Activity, BadgeDollarSign, BarChart3, Bell, ChartNoAxesCombined, Check, ChevronRight, Clock3, Coins, createIcons,
  ChartLine, CircleDollarSign, Database, DatabaseZap, Gauge, Gem, History, KeyRound, LayoutDashboard, Pencil, Play, Plus, RefreshCw,
  Hand, Hourglass, RotateCcw, Save, Search, SearchX, ShieldAlert, ShieldCheck, ShoppingCart, SlidersHorizontal, Sparkles, Square, Table2, TrendingUp, Trash2, TriangleAlert, X,
} from "lucide";

const appIcons = {
  Activity, BadgeDollarSign, BarChart3, Bell, ChartLine, ChartNoAxesCombined, Check, ChevronRight, Clock3, Coins, Database,
  CircleDollarSign, DatabaseZap, Gauge, Gem, History, KeyRound, LayoutDashboard, Pencil, Play, Plus, RefreshCw,
  Hand, Hourglass, RotateCcw, Save, Search, SearchX, ShieldAlert, ShieldCheck, ShoppingCart, SlidersHorizontal, Sparkles, Square, Table2, TrendingUp, Trash2, TriangleAlert, X,
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
  scope?: "item" | "category";
  category?: string;
  itemIds?: string[];
  topN?: number;
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
  groupId?: string;
  groupTopN?: number;
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
  dealRatio?: number;
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

type CheckResult = { checkedRules: number; notifications: number; observedLots: number; collectedSales: number; collectionErrors: string[]; matches: MatchRecord[]; summaries: RuleSummary[] };
type MarketAnalysis = { lots: number; history: number; currentMin?: number; currentMedian?: number; historyMedian?: number };
type SalesHistoryEntry = { amount: number; price: number; unitPrice: number; time: string; quality?: string; qualityCode?: number; upgrade?: number };
type SalesHistoryResponse = { total: number; entries: SalesHistoryEntry[] };
type MarketInsight = {
  name: string; itemId: string; region: string; activeLots: number; matchingLots: number;
  artifactQualities: ArtifactQuality[]; minUpgrade?: number; maxUpgrade?: number;
  salesSample: number; soldAmount: number; currentMinUnit?: number; medianUnit?: number;
  averageUnit?: number; p25Unit?: number; p75Unit?: number; discountPercent?: number;
  trendPercent?: number; volatilityPercent?: number; salesPerDay?: number;
  averageSaleIntervalMinutes?: number; opportunityScore: number; liquidity: string;
  verdict: string; risks: string[];
};
type MarketAnalyticsResponse = { generatedAt: string; insights: MarketInsight[] };
type TimingBucket = { key: number; medianMinUnit: number; samples: number; discountPercent: number };
type MarketTimingResponse = { periodDays: number; totalSamples: number; overallMedianMin?: number; hourWindows: TimingBucket[]; weekdays: TimingBucket[] };
type MovementPoint = { time: number; supply: number; minUnit?: number; medianUnit?: number };
type MovementEvent = { kind: "appeared" | "missing" | "ended" | "probable_sale"; time: string; amount: number; buyout?: number; unitPrice?: number; quality?: string; upgrade?: number; lifetimeMinutes?: number; confidence?: number };
type MarketMovement = {
  itemId: string; region: string; currentSupply: number; supplyChangePercent?: number;
  currentMinUnit?: number; currentMedianUnit?: number; priceChangePercent?: number;
  appeared: number; disappeared: number; officialSales: number; probableSales: number; unexplainedMissing: number; ended: number; activeLots: number;
  averageLifetimeMinutes?: number; collections: number; coveragePercent: number;
  lastCollected: string; signal: string; points: MovementPoint[]; events: MovementEvent[];
};
type MarketMovementResponse = { generatedAt: string; hours: number; markets: MarketMovement[] };
type MarketOpportunity = {
  insight: MarketInsight; score: number; buyPrice: number; expectedSellPrice: number;
  netSellPrice: number; profitPerUnit: number; roiPercent: number; sellThroughPercent: number;
  confidencePercent: number; confidence: "Высокая" | "Средняя" | "Низкая"; warnings: string[];
};
type RecommendationAction = "buy" | "sell" | "wait" | "hold" | "risk";
type MarketRecommendation = {
  insight: MarketInsight; action: RecommendationAction; title: string; summary: string;
  reasons: string[]; targetLow?: number; targetHigh?: number; confidence: "Высокая" | "Средняя" | "Низкая";
};
type CacheStatus = {
  sales: number; snapshots: number; items: number; collections: number; lotObservations: number;
  trackedLots: number; activeLots: number; trackedMarkets: number; lastCollection?: string;
  oldestSale?: string; newestSale?: string; sizeBytes: number; path: string;
};

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
        <button data-view="scanner"><i data-lucide="circle-dollar-sign"></i> Сканер</button>
        <button data-view="movement"><i data-lucide="activity"></i> Движение рынка</button>
      </nav>

      <div id="overview-view" class="workspace-view">
        <section class="overview-head">
          <div><span class="eyebrow">Состояние рынка</span><h2>Активные правила</h2></div>
          <div class="overview-actions"><span id="overview-updated">Ещё не проверялось</span><button id="overview-check" class="primary"><i data-lucide="refresh-cw"></i> Обновить рынок</button></div>
        </section>
        <section class="cache-strip collector-strip" id="collector-strip" title="Локальный сборщик активного рынка">
          <i data-lucide="database-zap"></i><div><strong id="collector-summary">Сборщик ещё не запускался</strong><span id="collector-range">Запустите мониторинг, чтобы накапливать жизненный цикл лотов</span></div>
          <small id="collector-time">—</small>
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
          <div class="scope-picker"><span>Область поиска</span><div class="segmented" id="rule-scope"><button class="active" data-value="item">Предмет</button><button data-value="category">Категория</button></div></div>
        </div>
        <div id="item-scope" class="scope-fields"><label><span>Item ID</span><input id="item-id" placeholder="Выберите предмет слева" /></label></div>
        <div id="category-scope" class="scope-fields category-scope hidden">
          <label><span>Категория</span><select id="rule-category"><option value="">Выберите категорию</option></select></label>
          <label><span>Лучших предложений</span><select id="category-top"><option value="1">Одно лучшее</option><option value="3">Три лучших</option><option value="5">Пять лучших</option></select></label>
          <div class="category-count"><i data-lucide="database"></i><div><strong id="category-item-count">0 предметов</strong><span>Каждый предмет проверяется отдельно; рейтинг строится по скидке к его медиане</span></div></div>
          <div class="category-selector">
            <div class="category-selector-head"><label class="category-search"><i data-lucide="search"></i><input id="category-item-search" placeholder="Найти предмет по названию или ID" /></label><button id="category-select-visible" class="secondary" type="button">Выбрать найденные</button><button id="category-clear-items" class="icon-button" type="button" title="Очистить выбор"><i data-lucide="x"></i></button></div>
            <div id="category-item-list" class="category-item-list"><div class="category-item-empty">Выберите категорию</div></div>
          </div>
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
          <div class="history-mode history-source"><span>Источник</span><div class="segmented" id="history-source"><button class="active" data-value="api" title="Свежие продажи напрямую из API">API</button><button data-value="local" title="Продажи, накопленные приложением для выбранного региона">Локально</button></div></div>
          <label><span>Регион</span><select id="history-region"><option>RU</option><option>EU</option><option>NA</option><option>SEA</option><option>NEA</option></select></label>
          <label><span>Последних продаж</span><select id="history-limit"><option>50</option><option selected>100</option><option>200</option><option data-local-only value="500">500</option><option data-local-only value="1000">1 000</option><option data-local-only value="5000">5 000</option></select></label>
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
        <section class="cache-strip" id="cache-strip" title="Локальный рыночный архив">
          <i data-lucide="database"></i><div><strong id="cache-summary">Локальная база подготавливается</strong><span id="cache-range">Продажи будут накапливаться автоматически</span></div>
          <small id="cache-size">—</small>
        </section>
        <section class="analytics-stats">
          <div><i data-lucide="sparkles"></i><span>Лучший сигнал</span><strong id="analytics-best">—</strong><small id="analytics-best-name">нет расчёта</small></div>
          <div><i data-lucide="circle-dollar-sign"></i><span>Средняя скидка</span><strong id="analytics-discount">—</strong><small>к медиане продаж</small></div>
          <div><i data-lucide="trending-up"></i><span>Ликвидных рынков</span><strong id="analytics-liquid">—</strong><small>высокая скорость продаж</small></div>
          <div><i data-lucide="gauge"></i><span>Подходящих лотов</span><strong id="analytics-matches">—</strong><small>по активным правилам</small></div>
        </section>
        <section class="recommendation-section">
          <header><div><span class="eyebrow">Решение</span><h3>Рекомендации</h3></div><small id="recommendation-context">На основе цены, тренда, ликвидности и движения предложения</small></header>
          <div id="recommendation-list" class="recommendation-list"><div class="recommendation-empty">Рекомендации появятся после расчёта аналитики</div></div>
        </section>
        <section class="analytics-toolbar">
          <label><span>Регион</span><select id="analytics-region"><option value="all">Все</option><option>RU</option><option>EU</option><option>NA</option><option>SEA</option><option>NEA</option></select></label>
          <label><span>Сигнал</span><select id="analytics-signal"><option value="all">Все</option><option value="strong">Сильные</option><option value="interesting">Интересные</option><option value="risk">С риском</option></select></label>
          <label><span>Сортировка</span><select id="analytics-sort"><option value="score">Индекс возможности</option><option value="discount">Скидка</option><option value="liquidity">Ликвидность</option><option value="trend">Рост цены</option></select></label>
        </section>
        <section id="analytics-list" class="analytics-list"><div class="analytics-empty"><i data-lucide="sparkles"></i><strong>Рассчитайте рыночные сигналы</strong><span>Нужны активные правила и доступ к API</span></div></section>
      </div>

      <div id="scanner-view" class="workspace-view hidden">
        <section class="scanner-head">
          <div><span class="eyebrow">Поиск сделок</span><h2>Сканер возможностей</h2><small id="scanner-updated">Ранжирует предметы из активных правил</small></div>
          <button id="scanner-load" class="primary"><i data-lucide="refresh-cw"></i> Сканировать</button>
        </section>
        <section class="scanner-toolbar">
          <label><span>Регион</span><select id="scanner-region"><option value="all">Все</option><option>RU</option><option>EU</option><option>NA</option><option>SEA</option><option>NEA</option></select></label>
          <label><span>Горизонт продажи</span><select id="scanner-horizon"><option value="1">1 день</option><option value="3" selected>3 дня</option><option value="7">7 дней</option><option value="14">14 дней</option></select></label>
          <label title="Комиссия и другие расходы при перепродаже"><span>Расходы</span><div class="scanner-number"><input id="scanner-fee" type="number" min="0" max="50" step="0.5" value="5" /><b>%</b></div></label>
          <label title="Скрыть сделки с меньшей ожидаемой чистой доходностью"><span>Доходность от</span><div class="scanner-number"><input id="scanner-min-roi" type="number" min="-100" max="500" step="1" value="5" /><b>%</b></div></label>
          <label class="scanner-search"><span>Поиск</span><div><i data-lucide="search"></i><input id="scanner-search" placeholder="Название или Item ID" /></div></label>
        </section>
        <section class="scanner-stats">
          <div><span>Лучший индекс</span><strong id="scanner-best">—</strong><small id="scanner-best-name">нет расчёта</small></div>
          <div><span>Подходит</span><strong id="scanner-count">—</strong><small>после фильтров</small></div>
          <div><span>Средняя доходность</span><strong id="scanner-average-roi">—</strong><small>после расходов</small></div>
          <div><span>Высокая уверенность</span><strong id="scanner-confident">—</strong><small>достаточно наблюдений</small></div>
        </section>
        <section class="scanner-explainer">
          <i data-lucide="shield-check"></i><span><strong>Индекс 0–100</strong> учитывает чистую доходность, скорость реализации, устойчивость цены и качество данных. Это оценка рынка, а не гарантия продажи.</span>
        </section>
        <section id="scanner-list" class="scanner-list"><div class="scanner-empty"><i data-lucide="circle-dollar-sign"></i><strong>Запустите сканирование</strong><span>Нужны активные правила и история продаж</span></div></section>
      </div>

      <div id="movement-view" class="workspace-view hidden">
        <section class="movement-head">
          <div><span class="eyebrow">Локальные наблюдения</span><h2>Движение рынка</h2><small id="movement-updated">Используются данные фонового сборщика</small></div>
          <button id="movement-load" class="primary"><i data-lucide="refresh-cw"></i> Обновить</button>
        </section>
        <section class="movement-toolbar">
          <label><span>Период</span><select id="movement-hours"><option value="24">24 часа</option><option value="168">7 дней</option><option value="720">30 дней</option></select></label>
          <label><span>Регион</span><select id="movement-region"><option value="all">Все</option><option>RU</option><option>EU</option><option>NA</option><option>SEA</option><option>NEA</option></select></label>
          <label class="movement-search"><span>Поиск</span><div><i data-lucide="search"></i><input id="movement-search" placeholder="Название или Item ID" /></div></label>
          <div class="movement-note"><i data-lucide="shield-check"></i><span>Исчезновение фиксируется только при полном обходе рынка</span></div>
        </section>
        <section class="movement-variant-toolbar">
          <div class="movement-variant-title"><i data-lucide="gem"></i><div><strong>Вариант артефакта</strong><span>График и все показатели пересчитываются только по выбранным вариантам</span></div></div>
          <div id="movement-quality-options" class="quality-options movement-quality-options">
            ${artifactQualities.map((quality) => `<label class="quality-chip ${quality.value}"><input type="checkbox" value="${quality.value}" /><span>${quality.label}</span></label>`).join("")}
          </div>
          <div class="movement-upgrade-filter"><span>Заточка</span><label>от <input id="movement-min-upgrade" type="number" min="0" max="15" placeholder="+0" /></label><b>—</b><label>до <input id="movement-max-upgrade" type="number" min="0" max="15" placeholder="+15" /></label></div>
          <button id="movement-reset-variant" class="icon-button" title="Сбросить редкость и заточку"><i data-lucide="x"></i></button>
        </section>
        <section class="movement-stats">
          <div><span>Рынков</span><strong id="movement-markets">—</strong></div>
          <div><span>Активное предложение</span><strong id="movement-supply">—</strong></div>
          <div><span>Появилось</span><strong id="movement-appeared">—</strong></div>
          <div><span>Исчезло</span><strong id="movement-disappeared">—</strong></div>
          <div><span>Покрытие</span><strong id="movement-coverage">—</strong></div>
        </section>
        <section class="movement-layout">
          <div id="movement-list" class="movement-list"><div class="movement-empty">Сначала запустите мониторинг</div></div>
          <div id="movement-detail" class="movement-detail">
            <div class="movement-empty"><i data-lucide="activity"></i><strong>Пока нет наблюдений</strong><span>Сборщик начнёт строить движение после нескольких проходов</span></div>
          </div>
        </section>
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
  <dialog id="scenario-dialog" class="scenario-dialog"><div class="dialog-head"><div><span class="eyebrow">Сценарий сделки</span><h2>А что если?</h2></div><button class="icon-button" data-close="scenario-dialog"><i data-lucide="x"></i></button></div><div class="scenario-content">
    <header class="scenario-market"><div><strong id="scenario-name">—</strong><span id="scenario-context">—</span></div><small>Изменяйте значения — расчёт обновится сразу</small></header>
    <section class="scenario-inputs">
      <label><span>Купить за / шт.</span><div class="money-input"><input id="scenario-buy" type="number" min="0" /><b>₽</b></div></label>
      <label><span>Продать за / шт.</span><div class="money-input"><input id="scenario-sell" type="number" min="0" /><b>₽</b></div></label>
      <label><span>Количество</span><input id="scenario-amount" type="number" min="1" value="1" /></label>
      <label><span>Расходы</span><div class="percent-input"><input id="scenario-fee" type="number" min="0" max="50" step="0.5" /><b>%</b></div></label>
    </section>
    <section class="scenario-results">
      <div><span>Вложение</span><strong id="scenario-investment">—</strong></div><div><span>Выручка</span><strong id="scenario-revenue">—</strong></div><div><span>Чистая прибыль</span><strong id="scenario-profit">—</strong></div><div><span>Доходность</span><strong id="scenario-roi">—</strong></div>
    </section>
    <section class="scenario-summary"><i data-lucide="circle-dollar-sign"></i><div><strong id="scenario-verdict">Введите цены</strong><span id="scenario-break-even">Здесь появится точка безубыточности</span></div></section>
    <section class="timing-section"><header><div><span class="eyebrow">Локальные снимки</span><h3>Когда покупать дешевле</h3></div><small id="timing-sample">Загрузка...</small></header><div id="timing-content" class="timing-content"><div class="timing-loading"><span></span>Анализирую время наблюдений</div></div></section>
  </div></dialog>
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
let ruleScope: "item" | "category" = "item";
let categorySelectedIds = new Set<string>();
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
let historySource: "api" | "local" = "api";
let historyPriceMode: "total" | "unit" = "total";
let historyDisplayMode: "chart" | "table" = "chart";
let historyChart: IChartApi | undefined;
let historyResizeObserver: ResizeObserver | undefined;
let analyticsInsights: MarketInsight[] = [];
let recommendationMovements: MarketMovement[] = [];
let scannerInsights: MarketInsight[] = [];
let scannerMovements: MarketMovement[] = [];
let scenarioOpportunity: MarketOpportunity | undefined;
let movementMarkets: MarketMovement[] = [];
let selectedMovementKey: string | undefined;
let movementChart: IChartApi | undefined;
let movementResizeObserver: ResizeObserver | undefined;

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
    updateRuleCategoryOptions();
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

function categoryItems(categoryName = $<HTMLSelectElement>("#rule-category").value) {
  return catalog.filter((item) => item.category === categoryName);
}

function visibleCategoryItems() {
  const query = value("category-item-search").toLocaleLowerCase("ru");
  return categoryItems().filter((item) =>
    `${item.id} ${item.nameRu} ${item.nameEn} ${item.subcategory}`.toLocaleLowerCase("ru").includes(query));
}

function renderCategoryItemSelector() {
  const items = visibleCategoryItems();
  $("#category-item-list").innerHTML = items.map((item) => `
    <label class="category-item-option"><input type="checkbox" value="${escapeHtml(item.id)}"${categorySelectedIds.has(item.id) ? " checked" : ""} /><span><strong>${escapeHtml(item.nameRu || item.nameEn || item.id)}</strong><small>${escapeHtml(item.id)} · ${escapeHtml(item.subcategory || item.category)}</small></span></label>`).join("")
    || `<div class="category-item-empty">${$<HTMLSelectElement>("#rule-category").value ? "Ничего не найдено" : "Выберите категорию"}</div>`;
  updateCategoryCount();
}

function updateRuleCategoryOptions(preferred?: string) {
  const select = $<HTMLSelectElement>("#rule-category");
  const current = preferred ?? select.value;
  const categories = [...new Set(catalog.map((item) => item.category).filter(Boolean))].sort();
  select.innerHTML = `<option value="">Выберите категорию</option>${categories.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
  if (categories.includes(current)) select.value = current;
  renderCategoryItemSelector();
}

function updateCategoryCount() {
  const total = categoryItems().length;
  const selectedCount = categorySelectedIds.size;
  $("#category-item-count").textContent = `${selectedCount.toLocaleString("ru-RU")} выбрано из ${total.toLocaleString("ru-RU")}`;
}

function renderRuleScope() {
  $("#item-scope").classList.toggle("hidden", ruleScope !== "item");
  $("#category-scope").classList.toggle("hidden", ruleScope !== "category");
  $("#rule-scope").querySelectorAll("button").forEach((button) =>
    button.classList.toggle("active", (button as HTMLButtonElement).dataset.value === ruleScope));
}

function expandedRules(source = rules): Rule[] {
  return source.flatMap((rule) => {
    if (rule.scope !== "category") return [rule];
    const itemIds = rule.itemIds?.length ? rule.itemIds : catalog.filter((item) => item.category === rule.category).map((item) => item.id);
    const groupId = `${rule.region}|${rule.category}|${rule.name}`;
    return itemIds.map((itemId) => {
      const item = catalog.find((candidate) => candidate.id === itemId);
      return {
        ...rule,
        itemId,
        name: `${rule.name} · ${item?.nameRu || item?.nameEn || itemId}`,
        groupId,
        groupTopN: rule.topN || 1,
      };
    });
  });
}

function currentRule(): Rule {
  const categoryName = $<HTMLSelectElement>("#rule-category").value;
  const items = categoryItems(categoryName).filter((item) => categorySelectedIds.has(item.id));
  const itemId = ruleScope === "item" ? value("item-id") : `category:${categoryName}`;
  if (ruleScope === "item" && !itemId) throw new Error("Выберите предмет или укажите Item ID");
  if (ruleScope === "category" && !categoryName) throw new Error("Выберите категорию");
  if (ruleScope === "category" && !items.length) throw new Error("Выберите хотя бы один предмет в категории");
  const selectedQualities = [...document.querySelectorAll<HTMLInputElement>("#quality-options input:checked")].map((checkbox) => checkbox.value as ArtifactQuality);
  const minUpgrade = numberValue("min-upgrade");
  const maxUpgrade = numberValue("max-upgrade");
  if (minUpgrade != null && maxUpgrade != null && minUpgrade > maxUpgrade) throw new Error("Минимальная заточка не может быть больше максимальной");
  return {
    name: value("rule-name") || (ruleScope === "category" ? `Лучшее в ${categoryName}` : selected?.nameRu) || itemId,
    itemId,
    region: $<HTMLSelectElement>("#region").value,
    scope: ruleScope,
    category: ruleScope === "category" ? categoryName : undefined,
    itemIds: ruleScope === "category" ? items.map((item) => item.id) : undefined,
    topN: ruleScope === "category" ? Number($<HTMLSelectElement>("#category-top").value) : undefined,
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
    rule.scope === "category" ? `${rule.itemIds?.length || 0} предметов · топ ${rule.topN || 1}` : "",
    rule.maxBuyout != null ? `лот ≤ ${money(rule.maxBuyout)}` : "",
    rule.maxUnitBuyout != null ? `шт. ≤ ${money(rule.maxUnitBuyout)}` : "",
    rule.minAmount != null ? `кол-во ≥ ${rule.minAmount}` : "",
    qualities?.length ? `редкость: ${qualities.join(", ")}` : "",
    describeRange("заточка", rule.minUpgrade, rule.maxUpgrade, "+"),
    rule.maxHistoryMedianRatio != null ? `≤ ${rule.maxHistoryMedianRatio * 100}% медианы` : "",
    rule.maxCurrentMinRatio != null ? `≤ ${rule.maxCurrentMinRatio * 100}% рынка` : "",
  ].filter(Boolean).join(" · ") || "Без ценовых ограничений";
}

function ruleTargetLabel(rule: Rule) {
  return rule.scope === "category" ? `Категория: ${rule.category}` : rule.itemId;
}

type WorkspaceView = "overview" | "config" | "history" | "analytics" | "scanner" | "movement";

function switchView(view: WorkspaceView) {
  $("#overview-view").classList.toggle("hidden", view !== "overview");
  $("#config-view").classList.toggle("hidden", view !== "config");
  $("#history-view").classList.toggle("hidden", view !== "history");
  $("#analytics-view").classList.toggle("hidden", view !== "analytics");
  $("#scanner-view").classList.toggle("hidden", view !== "scanner");
  $("#movement-view").classList.toggle("hidden", view !== "movement");
  document.querySelectorAll<HTMLButtonElement>(".workspace-tabs button").forEach((button) =>
    button.classList.toggle("active", button.dataset.view === view));
  $(".workspace").scrollTop = 0;
}

function summaryFor(rule: Rule) {
  if (rule.scope === "category") {
    const ids = new Set(rule.itemIds || []);
    const grouped = ruleSummaries.filter((summary) => ids.has(summary.itemId) && summary.region === rule.region);
    if (!grouped.length) return undefined;
    return {
      name: rule.name, itemId: rule.itemId, region: rule.region,
      totalLots: grouped.reduce((sum, summary) => sum + summary.totalLots, 0),
      comparableLots: grouped.reduce((sum, summary) => sum + summary.comparableLots, 0),
      matchingLots: grouped.reduce((sum, summary) => sum + summary.matchingLots, 0),
      currentMinBuyout: grouped.map((summary) => summary.currentMinBuyout).filter((value): value is number => value != null).sort((a, b) => a - b)[0],
      currentMinUnit: grouped.map((summary) => summary.currentMinUnit).filter((value): value is number => value != null).sort((a, b) => a - b)[0],
      checkedAt: grouped[0].checkedAt,
    } satisfies RuleSummary;
  }
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
      <div class="market-rule-main"><span class="rule-region">${escapeHtml(rule.region)}</span><div><strong>${escapeHtml(rule.name)}</strong><small>${escapeHtml(ruleTargetLabel(rule))} · ${escapeHtml(describeRule(rule))}</small></div></div>
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

function updateHistorySourceControls() {
  const limit = $<HTMLSelectElement>("#history-limit");
  limit.querySelectorAll<HTMLOptionElement>("[data-local-only]").forEach((option) => {
    option.disabled = historySource === "api";
    option.hidden = historySource === "api";
  });
  if (historySource === "api" && Number(limit.value) > 200) limit.value = "200";
  $("#history-source").querySelectorAll("button").forEach((button) =>
    button.classList.toggle("active", (button as HTMLButtonElement).dataset.value === historySource));
}

async function loadSalesHistory() {
  if (!historyItem) { toast("Сначала выберите предмет в каталоге", true); return; }
  $("#history-load").classList.add("busy");
  try {
    const response = await invoke<SalesHistoryResponse>("sales_history", {
      itemId: historyItem.id,
      region: $<HTMLSelectElement>("#history-region").value,
      limit: Number($<HTMLSelectElement>("#history-limit").value),
      source: historySource,
    });
    historyEntries = response.entries; historyTotal = response.total;
    const region = $<HTMLSelectElement>("#history-region").value;
    const sourceLabel = historySource === "local" ? "в локальном архиве" : "в API";
    $("#history-subtitle").textContent = `${region} · ${response.total.toLocaleString("ru-RU")} продаж ${sourceLabel} · показано ${response.entries.length}`;
    renderSalesHistory();
    await refreshCacheStatus();
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

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

async function refreshCacheStatus() {
  try {
    const status = await invoke<CacheStatus>("cache_status");
    $("#cache-summary").textContent = `${status.sales.toLocaleString("ru-RU")} продаж · ${status.items} предметов · ${status.snapshots} снимков рынка`;
    $("#cache-range").textContent = status.oldestSale && status.newestSale
      ? `${new Date(status.oldestSale).toLocaleDateString("ru-RU")} — ${new Date(status.newestSale).toLocaleDateString("ru-RU")}`
      : "Архив начнёт заполняться при первом расчёте";
    $("#cache-size").textContent = formatBytes(status.sizeBytes);
    $("#cache-strip").title = status.path;
    $("#collector-summary").textContent = status.collections
      ? `${status.trackedMarkets} рынков · ${status.activeLots.toLocaleString("ru-RU")} активных · ${status.trackedLots.toLocaleString("ru-RU")} лотов известно`
      : "Сборщик ещё не запускался";
    $("#collector-range").textContent = status.collections
      ? `${status.lotObservations.toLocaleString("ru-RU")} наблюдений в ${status.collections.toLocaleString("ru-RU")} проходах`
      : "Запустите мониторинг, чтобы накапливать жизненный цикл лотов";
    $("#collector-time").textContent = status.lastCollection
      ? new Date(status.lastCollection).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
      : "—";
    $("#collector-strip").title = status.path;
  } catch (error) { log(`Локальная база: ${String(error)}`, true); }
}

function roundRecommendationPrice(price: number) {
  const step = price >= 1_000_000 ? 10_000 : price >= 100_000 ? 1_000 : 100;
  return Math.max(step, Math.round(price / step) * step);
}

function recommendationFor(insight: MarketInsight): MarketRecommendation {
  const movement = recommendationMovements.find((item) => item.itemId === insight.itemId && item.region === insight.region);
  const discount = insight.discountPercent ?? 0;
  const trend = insight.trendPercent ?? 0;
  const volatility = insight.volatilityPercent ?? 0;
  const supplyChange = movement?.supplyChangePercent;
  const priceMovement = movement?.priceChangePercent;
  const oversupply = supplyChange != null && supplyChange >= 15 && (priceMovement ?? 0) <= 0;
  const weakData = insight.salesSample < 30;
  const highRisk = weakData || volatility >= 40 || (insight.liquidity === "Низкая" && insight.risks.length > 0);
  let action: RecommendationAction;
  if (highRisk && discount < 20) action = "risk";
  else if (discount >= 12 && insight.opportunityScore >= 60 && insight.liquidity !== "Низкая" && !oversupply && trend >= -5) action = "buy";
  else if (discount <= -8 && insight.liquidity !== "Низкая") action = "sell";
  else if (oversupply || (discount < 8 && trend <= 0)) action = "wait";
  else if (trend >= 5 && !oversupply) action = "hold";
  else action = "wait";

  const labels: Record<RecommendationAction, [string, string]> = {
    buy: ["Купить сейчас", "Цена заметно ниже справедливой, а рынок способен поглотить предложение."],
    sell: ["Продать сейчас", "Текущая рыночная цена выше исторического ориентира."],
    wait: ["Ждать просадки", "Запас выгоды недостаточен для уверенного входа."],
    hold: ["Держать", "Цена сохраняет положительный импульс без явного давления предложения."],
    risk: ["Рискованно", "Данных или ликвидности недостаточно для надёжного решения."],
  };
  const reasons = [
    insight.currentMinUnit != null && insight.medianUnit != null
      ? `Минимум ${money(insight.currentMinUnit)} ₽/шт., справедливая цена ${money(insight.medianUnit)} ₽/шт., отклонение ${signedPercent(discount)}.`
      : "Недостаточно данных для сравнения с медианой.",
    `Тренд ${signedPercent(insight.trendPercent)}, ликвидность ${insight.liquidity.toLocaleLowerCase("ru")}, разброс ${signedPercent(insight.volatilityPercent)}.`,
  ];
  if (supplyChange != null) reasons.push(`Предложение за 24 часа ${signedPercent(supplyChange)}, медианная цена ${signedPercent(priceMovement)}; официальных продаж ${movement?.officialSales ?? 0}.`);
  if (insight.risks.length) reasons.push(`Риски: ${insight.risks.join(", ").toLocaleLowerCase("ru")}.`);
  const fair = insight.medianUnit;
  const targetLow = fair == null ? undefined : roundRecommendationPrice(Math.max(fair * .75, Math.min(insight.p25Unit ?? fair * .85, fair * .85)));
  const targetHigh = fair == null ? undefined : roundRecommendationPrice(fair * .9);
  const confidence = insight.salesSample >= 100 && (movement?.collections ?? 0) >= 5 && volatility < 30
    ? "Высокая" : insight.salesSample >= 30 && volatility < 45 ? "Средняя" : "Низкая";
  return { insight, action, title: labels[action][0], summary: labels[action][1], reasons, targetLow, targetHigh, confidence };
}

function renderRecommendations(region: string) {
  const actionMeta: Record<RecommendationAction, { icon: string; priority: number }> = {
    buy: { icon: "shopping-cart", priority: 5 }, sell: { icon: "badge-dollar-sign", priority: 4 },
    wait: { icon: "hourglass", priority: 3 }, hold: { icon: "hand", priority: 2 }, risk: { icon: "triangle-alert", priority: 1 },
  };
  const recommendations = analyticsInsights.filter((item) => region === "all" || item.region === region)
    .map(recommendationFor)
    .sort((a, b) => actionMeta[b.action].priority - actionMeta[a.action].priority || b.insight.opportunityScore - a.insight.opportunityScore)
    .slice(0, 8);
  $("#recommendation-context").textContent = recommendationMovements.length
    ? "Цена, история продаж и движение предложения за 24 часа"
    : "Цена, история продаж, тренд и ликвидность";
  $("#recommendation-list").innerHTML = recommendations.map((item) => {
    const target = item.targetLow != null && item.targetHigh != null ? `${money(item.targetLow)}–${money(item.targetHigh)} ₽/шт.` : "Недостаточно данных";
    return `<article class="recommendation-card ${item.action}" data-recommendation-id="${escapeHtml(item.insight.itemId)}" data-recommendation-region="${escapeHtml(item.insight.region)}" data-target-high="${item.targetHigh ?? ""}">
      <div class="recommendation-heading"><span class="recommendation-icon"><i data-lucide="${actionMeta[item.action].icon}"></i></span><div><strong>${escapeHtml(item.insight.name)}</strong><small>${escapeHtml(item.insight.region)} · ${escapeHtml(item.insight.itemId)}</small></div><span class="recommendation-action">${escapeHtml(item.title)}</span></div>
      <p>${escapeHtml(item.summary)}</p>
      <div class="recommendation-reasons">${item.reasons.slice(0, 3).map((reason) => `<span>${escapeHtml(reason)}</span>`).join("")}</div>
      <footer><div><span>Цена для правила</span><strong>${target}</strong><small>Уверенность: ${item.confidence.toLocaleLowerCase("ru")}</small></div><button class="secondary recommendation-rule"><i data-lucide="plus"></i> Создать правило</button></footer>
    </article>`;
  }).join("") || `<div class="recommendation-empty">Нет рекомендаций по выбранному региону</div>`;
  createIcons({ icons: appIcons });
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
  renderRecommendations(region);
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
  const analysisRules = expandedRules();
  $("#analytics-load").classList.add("busy");
  $("#analytics-updated").textContent = `Анализирую рынки: ${rules.length}`;
  try {
    const response = await invoke<MarketAnalyticsResponse>("market_analytics", { rules: analysisRules });
    analyticsInsights = response.insights;
    try {
      const movement = await invoke<MarketMovementResponse>("market_movement", { hours: 24, region: "all", qualities: [], minUpgrade: null, maxUpgrade: null });
      recommendationMovements = movement.markets;
    } catch { recommendationMovements = []; }
    $("#analytics-updated").textContent = `Обновлено ${new Date(response.generatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
    renderAnalytics();
    $(".workspace").scrollTop = 0;
    await refreshCacheStatus();
  } catch (error) { toast(String(error), true); log(String(error), true); $("#analytics-updated").textContent = "Не удалось рассчитать аналитику"; }
  finally { $("#analytics-load").classList.remove("busy"); }
}

function opportunityFor(insight: MarketInsight, feePercent: number, horizonDays: number): MarketOpportunity | undefined {
  if (insight.currentMinUnit == null || insight.medianUnit == null || insight.currentMinUnit <= 0 || insight.medianUnit <= 0) return undefined;
  const movement = scannerMovements.find((item) => item.itemId === insight.itemId && item.region === insight.region);
  const volatility = Math.max(0, insight.volatilityPercent ?? 35);
  const negativeTrend = Math.max(0, -(insight.trendPercent ?? 0));
  const haircutPercent = Math.min(12, Math.max(2, volatility * .15) + Math.min(5, negativeTrend * .25));
  const expectedSellPrice = insight.medianUnit * (1 - haircutPercent / 100);
  const netSellPrice = expectedSellPrice * (1 - feePercent / 100);
  const profitPerUnit = netSellPrice - insight.currentMinUnit;
  const roiPercent = profitPerUnit / insight.currentMinUnit * 100;

  const dailyTurnoverPerLot = (insight.salesPerDay ?? 0) / Math.max(1, insight.activeLots);
  const sellThroughPercent = (1 - Math.exp(-dailyTurnoverPerLot * horizonDays)) * 100;
  const sampleQuality = Math.min(1, insight.salesSample / 100);
  const coverageQuality = movement ? Math.min(1, movement.coveragePercent / 100) : .35;
  const collectionQuality = movement ? Math.min(1, movement.collections / 10) : .25;
  const confidencePercent = (sampleQuality * .5 + coverageQuality * .3 + collectionQuality * .2) * 100;
  const confidence = confidencePercent >= 75 ? "Высокая" : confidencePercent >= 45 ? "Средняя" : "Низкая";

  const roiPoints = Math.max(0, Math.min(1, (roiPercent + 5) / 30)) * 45;
  const turnoverPoints = sellThroughPercent / 100 * 25;
  const confidencePoints = confidencePercent / 100 * 20;
  const stabilityPoints = Math.max(0, 10 - volatility / 5);
  const supplyPenalty = Math.max(0, Math.min(10, ((movement?.supplyChangePercent ?? 0) - 15) / 4));
  const score = Math.round(Math.max(0, Math.min(100, roiPoints + turnoverPoints + confidencePoints + stabilityPoints - supplyPenalty)));

  const warnings = [...insight.risks];
  if (haircutPercent >= 8) warnings.push("Цена выхода снижена из-за риска");
  if (sellThroughPercent < 35) warnings.push(`Вероятно долгая продажа: более ${horizonDays} дн.`);
  if ((movement?.supplyChangePercent ?? 0) >= 20) warnings.push("Предложение быстро растёт");
  if (profitPerUnit <= 0) warnings.push("После расходов ожидается убыток");
  return { insight, score, buyPrice: insight.currentMinUnit, expectedSellPrice, netSellPrice, profitPerUnit, roiPercent, sellThroughPercent, confidencePercent, confidence, warnings: [...new Set(warnings)] };
}

function scannerOpportunities() {
  const fee = Math.max(0, Math.min(50, numberValue("scanner-fee") ?? 0));
  const horizon = Number($<HTMLSelectElement>("#scanner-horizon").value);
  return scannerInsights.map((item) => opportunityFor(item, fee, horizon)).filter((item): item is MarketOpportunity => item != null);
}

function insightVariantLabel(insight: MarketInsight) {
  const qualities = insight.artifactQualities.map((value) => artifactQualities.find((quality) => quality.value === value)?.label).filter(Boolean);
  return [...qualities, describeRange("заточка", insight.minUpgrade, insight.maxUpgrade, "+")].filter(Boolean).join(", ");
}

function renderScanner() {
  const region = $<HTMLSelectElement>("#scanner-region").value;
  const minRoi = numberValue("scanner-min-roi") ?? -Infinity;
  const query = value("scanner-search").toLocaleLowerCase("ru");
  const horizon = Number($<HTMLSelectElement>("#scanner-horizon").value);
  const opportunities = scannerOpportunities().filter((item) => {
    if (region !== "all" && item.insight.region !== region) return false;
    if (item.roiPercent < minRoi) return false;
    return `${item.insight.name} ${item.insight.itemId}`.toLocaleLowerCase("ru").includes(query);
  }).sort((a, b) => b.score - a.score || b.roiPercent - a.roiPercent);
  const best = opportunities[0];
  const averageRoi = opportunities.length ? opportunities.reduce((sum, item) => sum + item.roiPercent, 0) / opportunities.length : undefined;
  $("#scanner-best").textContent = best ? `${best.score}/100` : "—";
  $("#scanner-best-name").textContent = best?.insight.name || "нет подходящих рынков";
  $("#scanner-count").textContent = scannerInsights.length ? String(opportunities.length) : "—";
  $("#scanner-average-roi").textContent = signedPercent(averageRoi);
  $("#scanner-confident").textContent = scannerInsights.length ? String(opportunities.filter((item) => item.confidence === "Высокая").length) : "—";

  $("#scanner-list").innerHTML = opportunities.map((item, index) => {
    const scoreClass = item.score >= 75 ? "strong" : item.score >= 55 ? "interesting" : item.score >= 35 ? "watch" : "weak";
    const roiClass = item.roiPercent > 0 ? "positive" : "negative";
    const targetBuy = roundRecommendationPrice(item.netSellPrice / (1 + Math.max(0, minRoi) / 100));
    const insightIndex = scannerInsights.indexOf(item.insight);
    const variant = insightVariantLabel(item.insight);
    return `<article class="opportunity-card ${scoreClass}" data-opportunity-index="${insightIndex}" data-opportunity-id="${escapeHtml(item.insight.itemId)}" data-opportunity-region="${escapeHtml(item.insight.region)}" data-target-buy="${targetBuy}">
      <header><span class="opportunity-rank">${index + 1}</span><div><strong>${escapeHtml(item.insight.name)}</strong><small>${escapeHtml(item.insight.region)} · ${escapeHtml(item.insight.itemId)} · ${item.insight.salesSample} продаж${variant ? ` · ${escapeHtml(variant)}` : ""}</small></div><div class="opportunity-score ${scoreClass}"><strong>${item.score}</strong><span>из 100</span></div></header>
      <div class="opportunity-prices"><div><span>Купить сейчас</span><strong>${money(item.buyPrice)} ₽</strong></div><i data-lucide="chevron-right"></i><div><span>Ожидаемая продажа</span><strong>${money(item.expectedSellPrice)} ₽</strong><small>консервативнее медианы ${money(item.insight.medianUnit)} ₽</small></div><i data-lucide="chevron-right"></i><div><span>После расходов</span><strong>${money(item.netSellPrice)} ₽</strong></div></div>
      <div class="opportunity-result"><div><span>Чистая прибыль / шт.</span><strong class="${roiClass}">${item.profitPerUnit >= 0 ? "+" : ""}${money(item.profitPerUnit)} ₽</strong></div><div><span>Доходность</span><strong class="${roiClass}">${signedPercent(item.roiPercent)}</strong></div><div><span>Реализация за ${horizon} дн.</span><strong>${item.sellThroughPercent.toFixed(0)}%</strong><small>оценка по обороту</small></div><div><span>Уверенность</span><strong>${item.confidence}</strong><small>${item.confidencePercent.toFixed(0)}% качества данных</small></div></div>
      <footer><div class="opportunity-warnings">${item.warnings.length ? item.warnings.slice(0, 3).map((warning) => `<span><i data-lucide="triangle-alert"></i>${escapeHtml(warning)}</span>`).join("") : `<span class="clear"><i data-lucide="shield-check"></i>Критичных рисков не найдено</span>`}</div><div class="opportunity-actions"><button class="secondary scenario-open"><i data-lucide="gauge"></i> А что если?</button><button class="secondary scanner-rule"><i data-lucide="plus"></i> Правило ≤ ${money(targetBuy)} ₽</button></div></footer>
    </article>`;
  }).join("") || `<div class="scanner-empty"><i data-lucide="search-x"></i><strong>${scannerInsights.length ? "Нет сделок по заданным условиям" : "Запустите сканирование"}</strong><span>${scannerInsights.length ? "Снизьте минимальную доходность или измените регион" : "Сканер проверит предметы из активных правил"}</span></div>`;
  createIcons({ icons: appIcons });
}

function renderScenarioCalculation() {
  if (!scenarioOpportunity) return;
  const buy = Math.max(0, numberValue("scenario-buy") ?? 0);
  const sell = Math.max(0, numberValue("scenario-sell") ?? 0);
  const amount = Math.max(1, Math.floor(numberValue("scenario-amount") ?? 1));
  const fee = Math.max(0, Math.min(50, numberValue("scenario-fee") ?? 0));
  const investment = buy * amount;
  const revenue = sell * amount;
  const netRevenue = revenue * (1 - fee / 100);
  const profit = netRevenue - investment;
  const roi = investment > 0 ? profit / investment * 100 : undefined;
  const breakEven = fee < 100 ? buy / (1 - fee / 100) : undefined;
  $("#scenario-investment").textContent = `${money(investment)} ₽`;
  $("#scenario-revenue").textContent = `${money(revenue)} ₽`;
  $("#scenario-profit").textContent = `${profit >= 0 ? "+" : ""}${money(profit)} ₽`;
  $("#scenario-profit").className = profit >= 0 ? "positive" : "negative";
  $("#scenario-roi").textContent = signedPercent(roi);
  $("#scenario-roi").className = (roi ?? 0) >= 0 ? "positive" : "negative";
  const fair = scenarioOpportunity.insight.medianUnit;
  const fairDelta = fair && sell > 0 ? (sell - fair) / fair * 100 : undefined;
  $("#scenario-verdict").textContent = buy <= 0 || sell <= 0 ? "Введите цены покупки и продажи"
    : profit > 0 ? `Сценарий даёт ${money(profit)} ₽ после расходов`
    : profit === 0 ? "Сценарий выходит в ноль" : `Сценарий теряет ${money(Math.abs(profit))} ₽`;
  $("#scenario-break-even").textContent = breakEven == null ? "Точка безубыточности недоступна"
    : `Безубыточная продажа: ${money(breakEven)} ₽/шт.${fairDelta == null ? "" : ` · ваша цена ${signedPercent(fairDelta)} к медиане`}`;
}

function renderMarketTiming(timing: MarketTimingResponse) {
  const weekdays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
  $("#timing-sample").textContent = `${timing.totalSamples} полных снимков · ${timing.periodDays} дней`;
  if (!timing.totalSamples) {
    $("#timing-content").innerHTML = `<div class="timing-empty"><i data-lucide="clock-3"></i><strong>Пока недостаточно локальных снимков</strong><span>Запущенный мониторинг постепенно накопит данные по времени покупки</span></div>`;
    createIcons({ icons: appIcons });
    return;
  }
  const rows = (items: TimingBucket[], label: (key: number) => string) => items.slice(0, 4).map((item, index) => `
    <div class="timing-row${index === 0 ? " best" : ""}"><span>${index + 1}</span><div><strong>${escapeHtml(label(item.key))}</strong><small>${item.samples} снимков</small></div><b>${money(item.medianMinUnit)} ₽</b><em class="${item.discountPercent >= 0 ? "positive" : "negative"}">${signedPercent(item.discountPercent)}</em></div>`).join("");
  $("#timing-content").innerHTML = `<div class="timing-column"><header><i data-lucide="clock-3"></i><strong>Время суток</strong></header>${rows(timing.hourWindows, (key) => `${String(key).padStart(2, "0")}:00–${String((key + 3) % 24).padStart(2, "0")}:00`)}</div><div class="timing-column"><header><i data-lucide="bar-chart-3"></i><strong>Дни недели</strong></header>${rows(timing.weekdays, (key) => weekdays[key] || "—")}</div><p>Скидка рассчитана к медиане минимальных цен всех полных снимков: ${money(timing.overallMedianMin)} ₽. Время показано по часовому поясу компьютера.</p>`;
  createIcons({ icons: appIcons });
}

async function openScenario(opportunity: MarketOpportunity) {
  scenarioOpportunity = opportunity;
  const insight = opportunity.insight;
  $("#scenario-name").textContent = insight.name;
  $("#scenario-context").textContent = `${insight.region} · ${insight.itemId}${insightVariantLabel(insight) ? ` · ${insightVariantLabel(insight)}` : ""}`;
  input("scenario-buy").value = String(Math.round(opportunity.buyPrice));
  input("scenario-sell").value = String(Math.round(opportunity.expectedSellPrice));
  input("scenario-amount").value = "1";
  input("scenario-fee").value = String(numberValue("scanner-fee") ?? 0);
  renderScenarioCalculation();
  $("#timing-sample").textContent = "Загрузка...";
  $("#timing-content").innerHTML = `<div class="timing-loading"><span></span>Анализирую время наблюдений</div>`;
  $<HTMLDialogElement>("#scenario-dialog").showModal();
  try {
    const timing = await invoke<MarketTimingResponse>("market_timing", {
      itemId: insight.itemId,
      region: insight.region,
      qualities: insight.artifactQualities,
      minUpgrade: insight.minUpgrade ?? null,
      maxUpgrade: insight.maxUpgrade ?? null,
      timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
    });
    if (scenarioOpportunity === opportunity) renderMarketTiming(timing);
  } catch (error) {
    $("#timing-content").innerHTML = `<div class="timing-empty"><i data-lucide="triangle-alert"></i><strong>Не удалось рассчитать время</strong><span>${escapeHtml(String(error))}</span></div>`;
    createIcons({ icons: appIcons });
  }
}

async function loadScanner() {
  if (!rules.length) { toast("Для сканера нужно хотя бы одно активное правило", true); return; }
  $("#scanner-load").classList.add("busy");
  $("#scanner-updated").textContent = `Проверяю рынки: ${expandedRules().length}`;
  try {
    const response = await invoke<MarketAnalyticsResponse>("market_analytics", { rules: expandedRules() });
    scannerInsights = response.insights;
    analyticsInsights = response.insights;
    try {
      const movement = await invoke<MarketMovementResponse>("market_movement", { hours: 24, region: "all", qualities: [], minUpgrade: null, maxUpgrade: null });
      scannerMovements = movement.markets;
      recommendationMovements = movement.markets;
    } catch { scannerMovements = []; }
    $("#scanner-updated").textContent = `Обновлено ${new Date(response.generatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} · ${scannerInsights.length} рынков`;
    renderScanner();
    await refreshCacheStatus();
  } catch (error) {
    toast(String(error), true); log(String(error), true); $("#scanner-updated").textContent = "Не удалось выполнить сканирование";
  } finally { $("#scanner-load").classList.remove("busy"); }
}

function movementKey(market: MarketMovement) {
  return `${market.region}|${market.itemId}`;
}

function movementItemName(itemId: string) {
  const item = catalog.find((candidate) => candidate.id === itemId);
  return item?.nameRu || item?.nameEn || itemId;
}

function movementSignalClass(signal: string) {
  if (signal.includes("Дефицит") || signal.includes("исчезают")) return "shortage";
  if (signal.includes("Перенасыщение")) return "oversupply";
  if (signal.includes("больше")) return "pending";
  return "stable";
}

function renderMovementChart(market: MarketMovement) {
  movementResizeObserver?.disconnect();
  movementChart?.remove();
  const container = $("#movement-chart");
  container.innerHTML = "";
  if (!market.points.length) return;
  movementChart = createChart(container, {
    width: container.clientWidth, height: 310,
    layout: { background: { type: ColorType.Solid, color: "#101513" }, textColor: "#899790", attributionLogo: false },
    grid: { vertLines: { color: "#26302c" }, horzLines: { color: "#26302c" } },
    leftPriceScale: { visible: true, borderColor: "#35413c", scaleMargins: { top: .12, bottom: .12 } },
    rightPriceScale: { borderColor: "#35413c", scaleMargins: { top: .12, bottom: .12 } },
    timeScale: { borderColor: "#35413c", timeVisible: true, secondsVisible: false },
    localization: { locale: "ru-RU" },
  });
  const supply = movementChart.addSeries(LineSeries, {
    color: "#58b9c6", lineWidth: 2, priceScaleId: "left", pointMarkersVisible: market.points.length < 80,
    priceLineVisible: false, priceFormat: { type: "custom", formatter: (value: number) => `${Math.round(value)} лотов` },
  });
  supply.setData(market.points.map((point) => ({ time: point.time as UTCTimestamp, value: point.supply })));
  const pricePoints = market.points.filter((point) => point.medianUnit != null)
    .map((point) => ({ time: point.time as UTCTimestamp, value: point.medianUnit! }));
  if (pricePoints.length) {
    const price = movementChart.addSeries(LineSeries, {
      color: "#e2bd64", lineWidth: 2, priceScaleId: "right", pointMarkersVisible: pricePoints.length < 80,
      priceLineVisible: false, priceFormat: { type: "custom", formatter: (value: number) => `${money(value)} ₽` },
    });
    price.setData(pricePoints);
  }
  movementChart.timeScale().fitContent();
  movementResizeObserver = new ResizeObserver(() => {
    if (movementChart && container.clientWidth > 0) movementChart.applyOptions({ width: container.clientWidth });
  });
  movementResizeObserver.observe(container);
}

function renderMovementDetail(market?: MarketMovement) {
  if (!market) {
    $("#movement-detail").innerHTML = `<div class="movement-empty"><i data-lucide="activity"></i><strong>Пока нет наблюдений</strong><span>Сборщик начнёт строить движение после нескольких проходов</span></div>`;
    createIcons({ icons: appIcons });
    return;
  }
  const signalClass = movementSignalClass(market.signal);
  const events = market.events.map((event) => {
    const labels = { appeared: "Появился", missing: "Исчез", ended: "Завершился", probable_sale: "Вероятно продан" };
    const confidence = event.confidence == null ? "" : ` · ${Math.round(event.confidence * 100)}%`;
    const variant = [event.quality, event.upgrade == null ? "" : `+${event.upgrade}`].filter(Boolean).join(" · ") || "—";
    return `<tr><td><span class="movement-event ${event.kind}">${labels[event.kind]}${confidence}</span></td><td>${escapeHtml(new Date(event.time).toLocaleString("ru-RU"))}</td><td>${escapeHtml(variant)}</td><td>${event.amount.toLocaleString("ru-RU")}</td><td>${money(event.unitPrice)} ₽</td><td>${event.lifetimeMinutes == null ? "—" : formatInterval(event.lifetimeMinutes)}</td></tr>`;
  }).join("") || `<tr><td colspan="6" class="table-empty">За период событий пока нет</td></tr>`;
  $("#movement-detail").innerHTML = `
    <header class="movement-detail-head"><div><span class="rule-region">${escapeHtml(market.region)}</span><div><h3>${escapeHtml(movementItemName(market.itemId))}</h3><small>${escapeHtml(market.itemId)} · последнее наблюдение ${escapeHtml(new Date(market.lastCollected).toLocaleString("ru-RU"))}</small></div></div><span class="movement-signal ${signalClass}">${escapeHtml(market.signal)}</span></header>
    <div class="movement-metrics"><div><span>Предложение</span><strong>${market.currentSupply.toLocaleString("ru-RU")}</strong><small class="${(market.supplyChangePercent ?? 0) > 0 ? "negative" : "positive"}">${signedPercent(market.supplyChangePercent)}</small></div><div><span>Медиана / шт.</span><strong>${money(market.currentMedianUnit)} ₽</strong><small class="${(market.priceChangePercent ?? 0) > 0 ? "positive" : "negative"}">${signedPercent(market.priceChangePercent)}</small></div><div><span>Минимум / шт.</span><strong>${money(market.currentMinUnit)} ₽</strong><small>${market.collections} проходов</small></div><div><span>Среднее время жизни</span><strong>${formatInterval(market.averageLifetimeMinutes)}</strong><small>исчезнувшие и завершённые</small></div></div>
    <div class="movement-quality"><div><span>Официальных продаж</span><strong>${market.officialSales.toLocaleString("ru-RU")}</strong></div><div><span>Вероятно сопоставлено</span><strong>${market.probableSales.toLocaleString("ru-RU")}</strong></div><div><span>Необъяснённо исчезло</span><strong>${market.unexplainedMissing.toLocaleString("ru-RU")}</strong></div><div><span>Полнота обходов</span><strong>${market.coveragePercent.toFixed(0)}%</strong></div></div>
    <div class="movement-chart-head"><div><span><i class="supply"></i>Предложение</span><span><i class="price"></i>Медианная цена</span></div><small>Покрытие ${market.coveragePercent.toFixed(0)}%</small></div>
    <div id="movement-chart"></div>
    <div class="movement-events"><div class="movement-section-title"><strong>Последние события</strong><span>Исчезновение не гарантирует продажу</span></div><div class="movement-events-scroll"><table><thead><tr><th>Событие</th><th>Время</th><th>Вариант</th><th>Количество</th><th>Цена / шт.</th><th>Время жизни</th></tr></thead><tbody>${events}</tbody></table></div></div>`;
  renderMovementChart(market);
}

function renderMovement() {
  const query = value("movement-search").toLocaleLowerCase("ru");
  const visibleMarkets = movementMarkets.filter((market) => {
    const item = catalog.find((candidate) => candidate.id === market.itemId);
    return `${market.itemId} ${market.region} ${item?.nameRu || ""} ${item?.nameEn || ""} ${item?.category || ""} ${item?.subcategory || ""}`.toLocaleLowerCase("ru").includes(query);
  });
  const supply = visibleMarkets.reduce((sum, market) => sum + market.currentSupply, 0);
  const appeared = visibleMarkets.reduce((sum, market) => sum + market.appeared, 0);
  const disappeared = visibleMarkets.reduce((sum, market) => sum + market.disappeared, 0);
  const coverage = visibleMarkets.length ? visibleMarkets.reduce((sum, market) => sum + market.coveragePercent, 0) / visibleMarkets.length : undefined;
  $("#movement-markets").textContent = visibleMarkets.length ? String(visibleMarkets.length) : "—";
  $("#movement-supply").textContent = visibleMarkets.length ? supply.toLocaleString("ru-RU") : "—";
  $("#movement-appeared").textContent = visibleMarkets.length ? appeared.toLocaleString("ru-RU") : "—";
  $("#movement-disappeared").textContent = visibleMarkets.length ? disappeared.toLocaleString("ru-RU") : "—";
  $("#movement-coverage").textContent = coverage == null ? "—" : `${coverage.toFixed(0)}%`;
  if (!visibleMarkets.some((market) => movementKey(market) === selectedMovementKey)) selectedMovementKey = visibleMarkets[0] && movementKey(visibleMarkets[0]);
  $("#movement-list").innerHTML = visibleMarkets.map((market) => {
    const key = movementKey(market);
    return `<button class="movement-market${key === selectedMovementKey ? " active" : ""}" data-item-id="${escapeHtml(market.itemId)}" data-region="${escapeHtml(market.region)}"><div><span class="rule-region">${escapeHtml(market.region)}</span><strong>${escapeHtml(movementItemName(market.itemId))}</strong></div><small>${market.currentSupply.toLocaleString("ru-RU")} лотов · ${market.officialSales.toLocaleString("ru-RU")} продаж · медиана ${money(market.currentMedianUnit)} ₽</small><span class="movement-signal ${movementSignalClass(market.signal)}">${escapeHtml(market.signal)}</span></button>`;
  }).join("") || `<div class="movement-empty">${movementMarkets.length ? "Ничего не найдено" : "Нет данных за выбранный период"}</div>`;
  renderMovementDetail(visibleMarkets.find((market) => movementKey(market) === selectedMovementKey));
}

async function loadMovement() {
  const qualities = [...document.querySelectorAll<HTMLInputElement>("#movement-quality-options input:checked")].map((checkbox) => checkbox.value);
  const minUpgrade = numberValue("movement-min-upgrade");
  const maxUpgrade = numberValue("movement-max-upgrade");
  if (minUpgrade != null && maxUpgrade != null && minUpgrade > maxUpgrade) {
    toast("Минимальная заточка не может быть больше максимальной", true);
    return;
  }
  $("#movement-load").classList.add("busy");
  try {
    const response = await invoke<MarketMovementResponse>("market_movement", {
      hours: Number($<HTMLSelectElement>("#movement-hours").value),
      region: $<HTMLSelectElement>("#movement-region").value,
      qualities,
      minUpgrade: minUpgrade ?? null,
      maxUpgrade: maxUpgrade ?? null,
    });
    movementMarkets = response.markets;
    const qualityLabels = qualities.map((value) => artifactQualities.find((quality) => quality.value === value)?.label).filter(Boolean);
    const variant = [...qualityLabels, describeRange("заточка", minUpgrade, maxUpgrade, "+")].filter(Boolean).join(", ");
    $("#movement-updated").textContent = `Обновлено ${new Date(response.generatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} · ${variant || "все варианты"}`;
    renderMovement();
  } catch (error) { toast(String(error), true); log(String(error), true); }
  finally { $("#movement-load").classList.remove("busy"); }
}

function renderRules() {
  $("#rule-count").textContent = String(rules.length);
  $("#stat-rules").textContent = String(rules.length);
  $("#rules-list").innerHTML = rules.map((rule, index) => `
    <article class="rule-row${editingIndex === index ? " editing" : ""}" data-index="${index}">
      <span class="rule-region">${escapeHtml(rule.region)}</span><div><strong>${escapeHtml(rule.name)}</strong><small>${escapeHtml(ruleTargetLabel(rule))} · ${escapeHtml(describeRule(rule))}</small></div>
      <button class="icon-button small edit-rule" title="Изменить"><i data-lucide="pencil"></i></button><button class="icon-button small delete-rule" title="Удалить"><i data-lucide="trash-2"></i></button>
    </article>`).join("") || `<div class="empty-inline">Правил пока нет. Выберите предмет и задайте условия.</div>`;
  createIcons({ icons: appIcons });
  renderOverview();
}

function setForm(rule?: Rule) {
  ruleScope = rule?.scope || "item";
  categorySelectedIds = new Set(rule?.itemIds || []);
  input("category-item-search").value = "";
  updateRuleCategoryOptions(rule?.category);
  $<HTMLSelectElement>("#category-top").value = String(rule?.topN || 1);
  renderRuleScope();
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
    <button class="match-row" data-match="${index}"><div><strong>${escapeHtml(match.name)}</strong><span>${escapeHtml(match.region)}${match.quality ? ` · ${escapeHtml(match.quality)}` : ""}${match.upgrade != null ? ` · +${match.upgrade}` : ""}</span></div><b>${money(match.buyout)} ₽</b><small>${match.amount} шт. · ${money(match.unit)} за шт.${match.dealRatio != null ? ` · ${Math.round((1 - match.dealRatio) * 100)}% к медиане` : ""}</small></button>`).join("") || `<div class="empty-state compact"><i data-lucide="bell"></i><p>Подходящие лоты появятся здесь</p></div>`;
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
    const checkRules = expandedRules();
    const result = await invoke<CheckResult>("check_rules", { rules: checkRules, notifyExisting: true, includeSeen: manual });
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
    log(`Проверено правил: ${result.checkedRules}, наблюдений лотов: ${result.observedLots}, новых продаж в архиве: ${result.collectedSales}, найдено лотов: ${result.notifications}`);
    result.collectionErrors.forEach((error) => log(`Сборщик пропустил рынок: ${error}`, true));
    await refreshCacheStatus();
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
    const minimum = rules.some((rule) => rule.scope === "category") ? 300 : 10;
    const seconds = Math.max(minimum, numberValue("interval") || 60);
    input("interval").value = String(seconds);
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
$("#use-item").addEventListener("click", () => { if (!selected) return; ruleScope = "item"; renderRuleScope(); switchView("config"); input("item-id").value = selected.id; input("rule-name").value = selected.nameRu || selected.nameEn || selected.id; input("rule-name").focus(); });
$("#item-history").addEventListener("click", () => { if (selected) openHistory(selected); });
$("#rule-scope").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!button) return;
  ruleScope = button.dataset.value as "item" | "category";
  renderRuleScope();
});
$("#rule-category").addEventListener("change", () => {
  categorySelectedIds.clear();
  input("category-item-search").value = "";
  renderCategoryItemSelector();
});
input("category-item-search").addEventListener("input", renderCategoryItemSelector);
$("#category-item-list").addEventListener("change", (event) => {
  const checkbox = (event.target as HTMLElement).closest<HTMLInputElement>("input[type=checkbox]");
  if (!checkbox) return;
  if (checkbox.checked) categorySelectedIds.add(checkbox.value); else categorySelectedIds.delete(checkbox.value);
  updateCategoryCount();
});
$("#category-select-visible").addEventListener("click", () => {
  visibleCategoryItems().forEach((item) => categorySelectedIds.add(item.id));
  renderCategoryItemSelector();
});
$("#category-clear-items").addEventListener("click", () => {
  categorySelectedIds.clear();
  renderCategoryItemSelector();
});
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
    scannerInsights = [];
    if (editingIndex != null) rules[editingIndex] = rule;
    else { const duplicate = rules.findIndex((entry) => ruleTargetLabel(entry) === ruleTargetLabel(rule) && entry.region === rule.region); if (duplicate >= 0) rules[duplicate] = rule; else rules.push(rule); }
    editingIndex = undefined; setForm(); renderRules(); void persistRules(false); toast("Правило добавлено");
  } catch (error) { toast(String(error), true); }
});
$("#rules-list").addEventListener("click", (event) => {
  const row = (event.target as HTMLElement).closest<HTMLElement>("[data-index]"); if (!row) return;
  const index = Number(row.dataset.index);
  if ((event.target as HTMLElement).closest(".delete-rule")) { const removed = rules[index]; const removedIds = new Set(removed.itemIds || [removed.itemId]); rules.splice(index, 1); ruleSummaries = ruleSummaries.filter((summary) => !(removedIds.has(summary.itemId) && summary.region === removed.region)); analyticsInsights = []; scannerInsights = []; editingIndex = undefined; renderRules(); renderAnalytics(); renderScanner(); void persistRules(false); return; }
  editingIndex = index; setForm(rules[index]); renderRules(); $(".rule-editor").scrollIntoView({ behavior: "smooth" });
});
$("#save").addEventListener("click", () => void persistRules());
$("#analyze").addEventListener("click", async () => {
  try {
    const rule = currentRule(); $("#analyze").classList.add("busy");
    if (rule.scope === "category") throw new Error("Добавьте групповое правило и используйте вкладку «Аналитика» для сравнения категории");
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
  const view = button.dataset.view as WorkspaceView;
  if (view === "history" && selected && historyItem?.id !== selected.id) openHistory(selected); else switchView(view);
  if (view === "analytics" && !analyticsInsights.length && rules.length) void loadAnalytics();
  if (view === "scanner" && !scannerInsights.length && rules.length) void loadScanner();
  if (view === "movement" && !movementMarkets.length) void loadMovement();
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
$("#history-source").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!button || button.dataset.value === historySource) return;
  historySource = button.dataset.value as "api" | "local";
  updateHistorySourceControls();
  if (historyItem) void loadSalesHistory();
});
["history-region", "history-limit"].forEach((id) => $<HTMLSelectElement>(`#${id}`).addEventListener("change", () => {
  if (historyItem) void loadSalesHistory();
}));
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
updateHistorySourceControls();
$("#analytics-load").addEventListener("click", () => void loadAnalytics());
["analytics-region", "analytics-signal", "analytics-sort"].forEach((id) => $<HTMLSelectElement>(`#${id}`).addEventListener("change", renderAnalytics));
$("#scanner-load").addEventListener("click", () => void loadScanner());
["scanner-region", "scanner-horizon"].forEach((id) => $<HTMLSelectElement>(`#${id}`).addEventListener("change", renderScanner));
["scanner-fee", "scanner-min-roi", "scanner-search"].forEach((id) => input(id).addEventListener("input", renderScanner));
$("#scanner-list").addEventListener("click", (event) => {
  const card = (event.target as HTMLElement).closest<HTMLElement>("[data-opportunity-id]");
  if (!card) return;
  if ((event.target as HTMLElement).closest(".scenario-open")) {
    const insight = scannerInsights[Number(card.dataset.opportunityIndex)];
    const opportunity = insight && opportunityFor(insight, Math.max(0, numberValue("scanner-fee") ?? 0), Number($<HTMLSelectElement>("#scanner-horizon").value));
    if (opportunity) void openScenario(opportunity);
    return;
  }
  const button = (event.target as HTMLElement).closest(".scanner-rule");
  if (!button) return;
  const itemId = card.dataset.opportunityId!;
  const region = card.dataset.opportunityRegion!;
  const item = catalog.find((candidate) => candidate.id === itemId);
  const source = rules.find((rule) => rule.region === region && (rule.itemId === itemId || rule.itemIds?.includes(itemId)));
  const draft: Rule = {
    ...(source || { name: item?.nameRu || item?.nameEn || itemId, itemId, region }),
    name: `${item?.nameRu || item?.nameEn || itemId} · возможность`, itemId, region,
    scope: "item", category: undefined, itemIds: undefined, topN: undefined, groupId: undefined, groupTopN: undefined,
  };
  editingIndex = undefined;
  setForm(draft);
  const targetBuy = Number(card.dataset.targetBuy);
  if (Number.isFinite(targetBuy) && targetBuy > 0) input("max-unit").value = String(targetBuy);
  switchView("config");
  renderRules();
  toast("Правило покупки подготовлено");
});
["scenario-buy", "scenario-sell", "scenario-amount", "scenario-fee"].forEach((id) => input(id).addEventListener("input", renderScenarioCalculation));
$("#movement-load").addEventListener("click", () => void loadMovement());
["movement-hours", "movement-region"].forEach((id) => $<HTMLSelectElement>(`#${id}`).addEventListener("change", () => void loadMovement()));
$("#movement-quality-options").addEventListener("change", () => void loadMovement());
["movement-min-upgrade", "movement-max-upgrade"].forEach((id) => input(id).addEventListener("change", () => void loadMovement()));
$("#movement-reset-variant").addEventListener("click", () => {
  document.querySelectorAll<HTMLInputElement>("#movement-quality-options input").forEach((checkbox) => checkbox.checked = false);
  input("movement-min-upgrade").value = "";
  input("movement-max-upgrade").value = "";
  void loadMovement();
});
input("movement-search").addEventListener("input", renderMovement);
$("#movement-list").addEventListener("click", (event) => {
  const row = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-item-id]");
  if (!row) return;
  selectedMovementKey = `${row.dataset.region}|${row.dataset.itemId}`;
  renderMovement();
});
$("#recommendation-list").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest(".recommendation-rule");
  const card = (event.target as HTMLElement).closest<HTMLElement>("[data-recommendation-id]");
  if (!button || !card) return;
  const itemId = card.dataset.recommendationId!;
  const region = card.dataset.recommendationRegion!;
  const item = catalog.find((candidate) => candidate.id === itemId);
  const source = rules.find((rule) => rule.region === region && (rule.itemId === itemId || rule.itemIds?.includes(itemId)));
  const draft: Rule = {
    ...(source || { name: item?.nameRu || item?.nameEn || itemId, itemId, region }),
    name: `${item?.nameRu || item?.nameEn || itemId} · покупка`, itemId, region,
    scope: "item", category: undefined, itemIds: undefined, topN: undefined, groupId: undefined, groupTopN: undefined,
  };
  editingIndex = undefined;
  setForm(draft);
  const targetHigh = Number(card.dataset.targetHigh);
  if (Number.isFinite(targetHigh) && targetHigh > 0) input("max-unit").value = String(targetHigh);
  input("history-percent").value = "90";
  switchView("config");
  renderRules();
  toast("Черновик правила подготовлен");
});
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
  renderRules(); createIcons({ icons: appIcons }); await Promise.all([loadCatalog(), refreshCacheStatus()]);
}

void initialize();
