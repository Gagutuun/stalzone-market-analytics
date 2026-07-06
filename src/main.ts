import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { ColorType, createChart, LineSeries, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import {
  Activity, BadgeDollarSign, BarChart3, Bell, BellPlus, ChartNoAxesCombined, Check, ChevronRight, CircleHelp, Clock3, Coins, createIcons,
  ChartLine, CircleDollarSign, Database, DatabaseZap, Gauge, Gem, History, KeyRound, LayoutDashboard, Pencil, Play, Plus, RefreshCw,
  Hand, Hourglass, ListChecks, RotateCcw, Save, Search, SearchX, ShieldAlert, ShieldCheck, ShoppingCart, SlidersHorizontal, Sparkles, Square, Table2, TrendingUp, Trash2, TriangleAlert, X, Zap,
} from "lucide";

const appIcons = {
  Activity, BadgeDollarSign, BarChart3, Bell, BellPlus, ChartLine, ChartNoAxesCombined, Check, ChevronRight, Clock3, Coins, Database,
  CircleDollarSign, CircleHelp, DatabaseZap, Gauge, Gem, History, KeyRound, LayoutDashboard, Pencil, Play, Plus, RefreshCw,
  Hand, Hourglass, ListChecks, RotateCcw, Save, Search, SearchX, ShieldAlert, ShieldCheck, ShoppingCart, SlidersHorizontal, Sparkles, Square, Table2, TrendingUp, Trash2, TriangleAlert, X, Zap,
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
  maxAmount?: number;
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
  rapidMonitor?: boolean;
  rapidIntervalSeconds?: number;
  rapidLimit?: number;
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
type ActiveLotView = {
  itemId: string; amount: number; buyout?: number; unitPrice?: number; currentPrice?: number;
  quality?: string; upgrade?: number; startTime?: string; endTime?: string; matchesRule: boolean;
};
type ActiveLotsResponse = {
  total: number; returned: number; markets: number; completeMarkets: number;
  collectedAt?: string; lots: ActiveLotView[];
};

type CheckResult = { checkedRules: number; notifications: number; observedLots: number; collectedSales: number; collectionErrors: string[]; matches: MatchRecord[]; summaries: RuleSummary[] };
type RapidCheckResult = {
  checkedRules: number; requests: number; observedLots: number; newLots: number; baseline: boolean;
  throttled: boolean; rateLimit?: number; rateRemaining?: number; rateResetAt?: number;
  errors: string[]; matches: MatchRecord[];
};
type MarketAnalysis = { lots: number; history: number; currentMin?: number; currentMedian?: number; historyMedian?: number };
type SalesHistoryEntry = { amount: number; price: number; unitPrice: number; time: string; quality?: string; qualityCode?: number; upgrade?: number; source: string };
type SalesHistoryResponse = { total: number; entries: SalesHistoryEntry[] };
type SchistoryImportResponse = { externalItemId: number; fetchedSales: number; matchingSales: number; insertedSales: number; skippedExisting: number; oldestSale?: string; newestSale?: string };
type MarketInsight = {
  name: string; itemId: string; region: string; activeLots: number; matchingLots: number;
  allActiveLots: number; currentMinAmount?: number; comparisonAmountLabel: string;
  comparisonAmountMin: number; comparisonAmountMax?: number;
  stackability: "stackable" | "single" | "unknown"; stackEvidence: number; maxObservedAmount: number;
  artifactQualities: ArtifactQuality[]; minAmount?: number; minUpgrade?: number; maxUpgrade?: number;
  salesSample: number; soldAmount: number; currentMinUnit?: number; medianUnit?: number;
  fairValueUnit?: number; recentMedianUnit?: number; recentP25Unit?: number; recentP75Unit?: number;
  recentSalesSample: number; latestSaleUnit?: number; latestSaleAt?: string;
  averageUnit?: number; p25Unit?: number; p75Unit?: number; discountPercent?: number;
  trendPercent?: number; volatilityPercent?: number; salesPerDay?: number;
  averageSaleIntervalMinutes?: number; opportunityScore: number; liquidity: string;
  movementSupplyChangePercent?: number; movementPriceChangePercent?: number;
  movementCollections: number; movementCoveragePercent: number;
  verdict: string; risks: string[];
};
type MarketAnalyticsResponse = { generatedAt: string; insights: MarketInsight[] };
type TimingBucket = { key: number; medianMinUnit: number; samples: number; discountPercent: number };
type MarketTimingResponse = { periodDays: number; totalSamples: number; overallMedianMin?: number; hourWindows: TimingBucket[]; weekdays: TimingBucket[] };
type DeepPriceWindow = { hours: number; sales: number; units: number; p25Unit?: number; medianUnit?: number; p75Unit?: number };
type DeepStackSegment = { label: string; sales: number; units: number; medianUnit?: number };
type MarketDepthLevel = { price: number; lots: number; units: number };
type MarketDeepAnalysis = {
  generatedAt: string; historyHours: number; totalSales: number; soldUnits: number;
  collections: number; completeCollections: number; currentSupply: number; currentUnits: number;
  currentMinUnit?: number; currentMedianUnit?: number; supplyChangePercent?: number;
  expectedSellUnit?: number; buyForFivePercent?: number; buyForTenPercent?: number;
  windows: DeepPriceWindow[]; stackSegments: DeepStackSegment[]; depth: MarketDepthLevel[]; insights: string[];
};
type StackStrategyAnalysis = {
  buyMaxAmount: number; sellMinAmount: number; targetAmount: number; acquiredAmount: number;
  purchaseLots: number; availableLots: number; availableUnits: number; totalCost: number;
  averageBuyUnit?: number; cheapestBuyUnit?: number; expectedSellUnit?: number;
  recentBulkMedianUnit?: number; bulkSalesSample: number; netRevenue?: number; profit?: number;
  roiPercent?: number; breakEvenBuyUnit?: number; complete: boolean; warnings: string[];
};
type MovementPoint = { time: number; supply: number; minUnit?: number; medianUnit?: number };
type MovementSalePoint = { time: number; medianUnit: number; sales: number; units: number };
type MovementEvent = { kind: "appeared" | "missing" | "ended" | "probable_sale"; time: string; amount: number; buyout?: number; unitPrice?: number; quality?: string; upgrade?: number; lifetimeMinutes?: number; confidence?: number };
type MarketMovement = {
  itemId: string; region: string; currentSupply: number; supplyChangePercent?: number;
  currentMinUnit?: number; currentMedianUnit?: number; priceChangePercent?: number;
  appeared: number; disappeared: number; recordedSales: number; schistorySales: number; stalzoneSales: number;
  probableSales: number; unexplainedMissing: number; ended: number; activeLots: number;
  averageLifetimeMinutes?: number; collections: number; coveragePercent: number;
  lastCollected: string; signal: string; points: MovementPoint[]; salePoints: MovementSalePoint[]; events: MovementEvent[];
};
type MarketMovementResponse = { generatedAt: string; hours: number; markets: MarketMovement[] };
type MarketOpportunity = {
  insight: MarketInsight; score: number; buyPrice: number; expectedSellPrice: number;
  netSellPrice: number; profitPerUnit: number; roiPercent: number; sellThroughPercent: number;
  confidencePercent: number; confidence: "Высокая" | "Средняя" | "Низкая"; warnings: string[];
  mode: "comparable" | "stack"; purchaseAmount: number; purchaseLots: number;
  sellAmountLabel: string; stackStrategy?: StackStrategyAnalysis;
};
type AiMarketAnalysis = {
  action: string; mainScenario: string; summary: string;
  argumentsFor: string[]; argumentsAgainst: string[];
  entryConditions: string[]; cancellationConditions: string[]; missingData: string[];
};
type RecommendationAction = "buy" | "sell" | "wait" | "hold" | "risk";
type MarketRecommendation = {
  insight: MarketInsight; action: RecommendationAction; title: string; summary: string;
  reasons: string[]; buyerAction: string; ownerAction: string; decisionStrength: number;
  currentBuyUnit?: number; marketReferenceUnit?: number; contextLabel: string; decisionRoi?: number; dataSample: number;
  targetLow?: number; targetHigh?: number; dataQuality: "Высокое" | "Среднее" | "Низкое";
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

const escapeHtml = (text: string) => text.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
const helpTip = (text: string, label = "Пояснение") => `<button class="metric-help" type="button" data-help="${escapeHtml(text)}" aria-label="${escapeHtml(label)}"><i data-lucide="circle-help"></i></button>`;

const helpText = {
  coverage: "Доля снимков, в которых приложение получило весь рынок целиком. Только полный обход позволяет надёжно утверждать, что лот исчез. При покрытии ниже 80% осторожнее интерпретируйте исчезновения и время жизни.",
  supply: "Количество активных лотов в последнем полном снимке. Процент показывает изменение от первого до последнего снимка выбранного периода.",
  askMedian: "Медианная цена за штуку среди активных предложений. Это ожидания продавцов, а не цена состоявшейся сделки.",
  askMinimum: "Самое дешёвое активное предложение за штуку в последнем полном снимке. Число проходов показывает, сколько раз рынок был сохранён за выбранный период.",
  lifetime: "Среднее время между первым появлением лота и его исчезновением или завершением. Исчезновение не всегда означает продажу.",
  recordedSales: "Подтверждённые записи продаж из STALZONE API и SCHistory API после удаления дублей. Оба источника имеют одинаковый вес.",
  probableSales: "Исчезнувшие лоты, для которых найдена близкая продажа по времени, цене, количеству, качеству и заточке. Связь вероятная, потому что API не даёт общего lotId.",
  missing: "Лоты исчезли после полного обхода, но не были уверенно сопоставлены с продажей. Их могли купить, снять с аукциона или завершить другим способом.",
  opportunityScore: "Сводная оценка 0–100. Учитывает потенциальную доходность, вероятность реализации, устойчивость цены и качество данных. Это способ ранжирования, а не гарантия прибыли.",
  adaptivePrice: "Оценка актуального уровня продажи. Свежая медиана имеет приоритет, а при малой выборке смешивается с длинной историей.",
  deviation: "Насколько текущий минимум дешевле адаптивной цены. Положительное значение означает скидку, отрицательное — переплату.",
  percentile: "P25 — цена, ниже которой прошла четверть продаж; P75 — цена, ниже которой прошли три четверти. P25 полезен как ориентир выгодной покупки.",
  trend: "Изменение медианы подтверждённых продаж последних 24 часов относительно предыдущих 24 часов.",
  volatility: "Ширина диапазона P25–P75 недавних продаж относительно медианы. Чем больше значение, тем менее предсказуема цена.",
  salesPerDay: "Средняя частота подтверждённых продаж в доступной истории. Она оценивает ликвидность, но не гарантирует продажу по вашей цене.",
  freshSample: "Количество подтверждённых продаж в свежем 24-часовом окне. Чем меньше выборка, тем сильнее расчёт опирается на длинную историю.",
  matchingLots: "Первое число — все активные лоты нужного варианта; второе — лоты, прошедшие ценовые и относительные ограничения правила.",
  expectedSale: "Консервативная цена выхода: адаптивная цена уменьшается с учётом разброса и отрицательного тренда.",
  sellThrough: "Модельная вероятность реализации за выбранный срок. Рассчитывается по частоте продаж относительно числа активных лотов и не учитывает вашу позицию в очереди продавцов.",
  confidence: "Качество исходных данных: объём истории, полнота обходов и число снимков. Высокая уверенность не означает гарантированную прибыль.",
};

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
        <button data-view="analytics"><i data-lucide="sparkles"></i> Рыночный советник</button>
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
          <div class="filter-grid four">
            <label><span>Выкуп всего, до ${helpTip("Жёсткий предел полной стоимости лота независимо от количества предметов внутри.")}</span><div class="money-input"><input id="max-buyout" type="number" min="0" placeholder="Без лимита" /><b>₽</b></div></label>
            <label><span>Цена за штуку, до ${helpTip("Полная цена выкупа делится на количество в лоте. Для одиночного артефакта совпадает с ценой всего лота.")}</span><div class="money-input"><input id="max-unit" type="number" min="0" placeholder="Без лимита" /><b>₽</b></div></label>
            <label><span>Количество, от ${helpTip("Лоты с меньшим количеством не пройдут правило. Оставьте пустым, если размер лота не важен.")}</span><input id="min-amount" type="number" min="1" placeholder="Любое" /></label>
            <label><span>Количество, до ${helpTip("Лоты с большим количеством не пройдут правило. Вместе с нижней границей позволяет выделить сопоставимый размер пачки.")}</span><input id="max-amount" type="number" min="1" placeholder="Любое" /></label>
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
            <label><span>Не дороже медианы продаж ${helpTip("100% — не выше медианы подтверждённых продаж; 90% — минимум на 10% дешевле неё. Сравниваются только тот же регион и вариант предмета.")}</span><div class="percent-input"><input id="history-percent" type="number" min="1" max="200" placeholder="Не учитывать" /><b>%</b></div></label>
            <label><span>Не дороже текущего минимума ${helpTip("Сравнение со следующим самым дешёвым активным лотом. 90% требует скидку минимум 10% к конкурентному предложению.")}</span><div class="percent-input"><input id="current-percent" type="number" min="1" max="200" placeholder="Не учитывать" /><b>%</b></div></label>
          </div>
          <div class="presets"><span>Быстрый выбор</span><button data-preset="safe">95% рынка</button><button data-preset="deal">90% медианы</button><button data-preset="snipe">80% медианы</button></div>
        </div>

        <div class="filter-section rapid-rule-section">
          <div class="rapid-rule-head"><div><i data-lucide="zap"></i><div><strong>Оперативный мониторинг</strong><span>Проверяет только последние 5 предложений и сразу сообщает о выгодном новом лоте</span></div></div><label class="switch-control"><input id="rapid-monitor" type="checkbox" /><span></span></label></div>
          <div id="rapid-settings" class="rapid-settings hidden">
            <label><span>Интервал опроса</span><div class="rapid-slider"><input id="rapid-interval" type="range" min="3" max="10" step="1" value="5" /><output id="rapid-interval-value">5 сек</output></div></label>
            <div class="rapid-budget"><i data-lucide="gauge"></i><div><strong id="rapid-budget-title">До 1 запроса каждые 5 секунд</strong><span id="rapid-budget-note">API опрашивается отдельно для каждого выбранного предмета</span></div></div>
          </div>
          <div id="rapid-warning" class="rapid-warning hidden"><i data-lucide="triangle-alert"></i><span>Сравнение с текущим минимумом отключено: последние лоты не являются полной выборкой рынка.</span></div>
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
          <div class="history-head-actions"><button id="history-import-schistory" class="secondary" title="Импортировать выбранную редкость и заточку из schistory.xyz"><i data-lucide="database-zap"></i> Импорт SCHistory</button><button id="history-load" class="primary"><i data-lucide="refresh-cw"></i> Загрузить</button></div>
        </section>
        <section class="history-filters">
          <div class="history-mode history-source"><span>Источник</span><div class="segmented" id="history-source"><button class="active" data-value="api" title="Свежие продажи напрямую из API">API</button><button data-value="local" title="Продажи, накопленные приложением для выбранного региона">Локально</button></div></div>
          <label><span>Регион</span><select id="history-region"><option>RU</option><option>EU</option><option>NA</option><option>SEA</option><option>NEA</option></select></label>
          <label><span>Последних продаж</span><select id="history-limit"><option>50</option><option selected>100</option><option>200</option><option data-local-only value="500">500</option><option data-local-only value="1000">1 000</option><option data-local-only value="5000">5 000</option><option data-local-only value="10000">10 000</option></select></label>
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
          <div><span>Всего продаж ${helpTip("Количество записей выбранного предмета у источника до применения экранных фильтров.")}</span><strong id="history-total">—</strong></div>
          <div><span>В выборке ${helpTip("Продажи, оставшиеся после фильтров количества, качества и заточки. Именно по ним рассчитаны показатели ниже.")}</span><strong id="history-count">—</strong></div>
          <div><span>Минимум ${helpTip("Самая низкая цена в выборке. Может быть единичным выбросом и сама по себе не является справедливой ценой.")}</span><strong id="history-min">—</strong></div>
          <div><span>Медиана ${helpTip("Середина отсортированных цен: половина продаж дешевле, половина дороже. Обычно устойчивее среднего к ошибочным и экстремальным сделкам.")}</span><strong id="history-median">—</strong></div>
          <div><span>Средняя ${helpTip("Сумма цен, делённая на число продаж. Сильно реагирует на очень дорогие или дешёвые сделки.")}</span><strong id="history-average">—</strong></div>
        </section>
        <section id="history-chart-wrap" class="history-data"><div id="history-legend" class="history-legend"></div><div id="history-chart"></div><div id="history-chart-empty" class="history-empty">Выберите предмет и загрузите продажи</div></section>
        <section id="history-table-wrap" class="history-data hidden"><div class="history-table-scroll"><table><thead><tr><th>Время</th><th class="history-quality-column">Редкость</th><th class="history-quality-column">Заточка</th><th>Источник</th><th>Количество</th><th>За лот</th><th>За штуку</th></tr></thead><tbody id="history-table-body"></tbody></table></div></section>
        <a class="chart-attribution" href="https://www.tradingview.com" target="_blank" rel="noreferrer">Charts by TradingView</a>
      </div>

      <div id="analytics-view" class="workspace-view hidden">
        <section class="analytics-head">
          <div><span class="eyebrow">Решения на основе рынка</span><h2>Рыночный советник</h2><small id="analytics-updated">Один расчёт для рекомендаций, сделок и метрик</small></div>
          <button id="analytics-load" class="primary"><i data-lucide="refresh-cw"></i> Обновить советник</button>
        </section>
        <section class="cache-strip" id="cache-strip" title="Локальный рыночный архив">
          <i data-lucide="database"></i><div><strong id="cache-summary">Локальная база подготавливается</strong><span id="cache-range">Продажи будут накапливаться автоматически</span></div>
          <small id="cache-size">—</small>
        </section>
        <nav class="advisor-tabs" aria-label="Разделы рыночного советника"><button class="active" data-advisor="decisions"><i data-lucide="sparkles"></i> Что делать</button><button data-advisor="deals"><i data-lucide="circle-dollar-sign"></i> Сделки</button><button data-advisor="metrics"><i data-lucide="bar-chart-3"></i> Метрики</button></nav>
        <div id="advisor-decisions-panel" class="advisor-panel">
        <section class="analytics-stats">
          <div><i data-lucide="list-checks"></i><span>Проанализировано</span><strong id="analytics-best">—</strong><small id="analytics-best-name">вариантов рынка</small></div>
          <div><i data-lucide="shopping-cart"></i><span>Покупать</span><strong id="analytics-discount">—</strong><small>цена выглядит выгодно</small></div>
          <div><i data-lucide="badge-dollar-sign"></i><span>Продавать</span><strong id="analytics-liquid">—</strong><small>хорошее окно продажи</small></div>
          <div><i data-lucide="hourglass"></i><span>Ждать / держать</span><strong id="analytics-matches">—</strong><small>вход пока невыгоден</small></div>
        </section>
        <section class="recommendation-section">
          <header><div><span class="eyebrow">Решение</span><h3>Рекомендации</h3></div><small id="recommendation-context">На основе цены, тренда, ликвидности и движения предложения</small></header>
          <div id="recommendation-list" class="recommendation-list"><div class="recommendation-empty">Рекомендации появятся после расчёта аналитики</div></div>
        </section>
        </div>
        <div id="advisor-metrics-panel" class="advisor-panel hidden">
        <section class="analytics-toolbar">
          <label><span>Регион</span><select id="analytics-region"><option value="all">Все</option><option>RU</option><option>EU</option><option>NA</option><option>SEA</option><option>NEA</option></select></label>
          <label><span>Сигнал</span><select id="analytics-signal"><option value="all">Все</option><option value="strong">Сильные</option><option value="interesting">Интересные</option><option value="risk">С риском</option></select></label>
          <label><span>Сортировка</span><select id="analytics-sort"><option value="score">Индекс возможности</option><option value="discount">Скидка</option><option value="liquidity">Ликвидность</option><option value="trend">Рост цены</option></select></label>
        </section>
        <section id="analytics-list" class="analytics-list"><div class="analytics-empty"><i data-lucide="sparkles"></i><strong>Рассчитайте рыночные сигналы</strong><span>Нужны активные правила и доступ к API</span></div></section>
        </div>
      </div>

      <div id="scanner-view" class="workspace-view hidden">
        <section class="analytics-head">
          <div><span class="eyebrow">Рыночный советник</span><h2>Исполнимые сделки</h2><small id="scanner-updated">Текущая покупка, ожидаемый выход и риск</small></div>
          <button id="scanner-load" class="primary"><i data-lucide="refresh-cw"></i> Обновить советник</button>
        </section>
        <nav class="advisor-tabs" aria-label="Разделы рыночного советника"><button data-advisor="decisions"><i data-lucide="sparkles"></i> Что делать</button><button class="active" data-advisor="deals"><i data-lucide="circle-dollar-sign"></i> Сделки</button><button data-advisor="metrics"><i data-lucide="bar-chart-3"></i> Метрики</button></nav>
        <section class="scanner-toolbar">
          <label><span>Регион</span><select id="scanner-region"><option value="all">Все</option><option>RU</option><option>EU</option><option>NA</option><option>SEA</option><option>NEA</option></select></label>
          <label><span>Горизонт продажи ${helpTip("Срок, за который Сканер оценивает вероятность реализации по историческому обороту. Он не меняет историю цен.")}</span><select id="scanner-horizon"><option value="1">1 день</option><option value="3" selected>3 дня</option><option value="7">7 дней</option><option value="14">14 дней</option></select></label>
          <label><span>Расходы ${helpTip("Комиссия аукциона и другие потери при продаже. Вычитаются из ожидаемой цены выхода до расчёта прибыли.")}</span><div class="scanner-number"><input id="scanner-fee" type="number" min="0" max="50" step="0.5" value="5" /><b>%</b></div></label>
          <label><span>Доходность от ${helpTip("Скрывает сценарии с меньшей ожидаемой чистой доходностью. Фильтр не превращает прогноз в гарантированный результат.")}</span><div class="scanner-number"><input id="scanner-min-roi" type="number" min="-100" max="500" step="1" value="5" /><b>%</b></div></label>
          <label class="scanner-search"><span>Поиск</span><div><i data-lucide="search"></i><input id="scanner-search" placeholder="Название или Item ID" /></div></label>
        </section>
        <section class="scanner-stats">
          <div><span>Лучшая сделка</span><strong id="scanner-best">—</strong><small id="scanner-best-name">нет расчёта</small></div>
          <div><span>После фильтров</span><strong id="scanner-count">—</strong><small>исполняемых сценариев</small></div>
          <div><span>Средняя доходность</span><strong id="scanner-average-roi">—</strong><small>после расходов</small></div>
          <div><span>Надёжных данных</span><strong id="scanner-confident">—</strong><small>для оценки сделки</small></div>
        </section>
        <section class="scanner-explainer">
          <i data-lucide="shield-check"></i><span><strong>Сделки отвечают на узкий вопрос:</strong> можно ли купить лучший активный лот сейчас и перепродать его по подтверждённой истории после расходов. Индекс 0–100 сравнивает доходность, срок реализации, риск цены и качество данных; это не гарантия продажи.</span>
        </section>
        <section id="scanner-list" class="scanner-list"><div class="scanner-empty"><i data-lucide="circle-dollar-sign"></i><strong>Обновите рыночный советник</strong><span>Здесь появятся только сделки, которые можно проверить по текущим лотам</span></div></section>
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
          <div class="movement-amount-filter"><span>Размер лота</span><select id="movement-amount-preset"><option value="all">Все</option><option value="1">1</option><option value="2-4">2–4</option><option value="5-9">5–9</option><option value="10-19">10–19</option><option value="20-49">20–49</option><option value="50+">50+</option><option value="custom">Свой</option></select><input id="movement-min-amount" type="number" min="1" placeholder="от" /><b>—</b><input id="movement-max-amount" type="number" min="1" placeholder="до" /></div>
          <button id="movement-reset-variant" class="icon-button" title="Сбросить вариант и размер лота"><i data-lucide="x"></i></button>
        </section>
        <section class="movement-stats">
          <div><span>Рынков</span><strong id="movement-markets">—</strong></div>
          <div><span>Активное предложение ${helpTip(helpText.supply)}</span><strong id="movement-supply">—</strong></div>
          <div><span>Появилось ${helpTip("Количество уникальных лотов, впервые замеченных за выбранный период.")}</span><strong id="movement-appeared">—</strong></div>
          <div><span>Исчезло ${helpTip(helpText.missing)}</span><strong id="movement-disappeared">—</strong></div>
          <div><span>Полнота обходов ${helpTip(helpText.coverage)}</span><strong id="movement-coverage">—</strong></div>
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
    <section class="scenario-basis"><div><span>Последняя продажа</span><strong id="scenario-latest-sale">—</strong><small id="scenario-latest-time">—</small></div><div><span>Медиана свежих 24ч</span><strong id="scenario-recent-median">—</strong><small id="scenario-recent-sample">—</small></div><div><span>Адаптивная цена</span><strong id="scenario-fair-value">—</strong></div><div><span>Медиана 30 дней</span><strong id="scenario-long-median">—</strong></div></section>
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
    <section id="stack-strategy-section" class="stack-strategy-section"><header><div><span class="eyebrow">Премия за пачку</span><h3>Собрать дешевле — продать крупнее</h3></div><button id="stack-strategy-calculate" class="secondary"><i data-lucide="refresh-cw"></i> Рассчитать</button></header><div class="stack-strategy-inputs"><label><span>Покупать лоты до</span><input id="stack-buy-max-amount" type="number" min="1" value="9" /></label><label><span>История пачек от</span><input id="stack-sell-min-amount" type="number" min="1" value="20" /></label><label><span>Собрать единиц</span><input id="stack-target-amount" type="number" min="1" value="20" /></label><label><span>Цена покупки до / шт.</span><div class="money-input"><input id="stack-max-buy-unit" type="number" min="1" placeholder="Без лимита" /><b>₽</b></div></label></div><div id="stack-strategy-result" class="stack-strategy-result"><div class="timing-loading"><span></span>Считаю сборку пачки</div></div></section>
    <section class="timing-section"><header><div><span class="eyebrow">Локальные снимки</span><h3>Когда покупать дешевле</h3></div><small id="timing-sample">Загрузка...</small></header><div id="timing-content" class="timing-content"><div class="timing-loading"><span></span>Анализирую время наблюдений</div></div></section>
  </div></dialog>
  <dialog id="deep-analysis-dialog" class="deep-analysis-dialog"><div class="dialog-head"><div><span class="eyebrow">Локальная аналитика</span><h2 id="deep-analysis-title">Разбор рынка</h2></div><button class="icon-button" data-close="deep-analysis-dialog"><i data-lucide="x"></i></button></div><div id="deep-analysis-content" class="deep-analysis-content"><div class="timing-loading"><span></span>Считаю структуру рынка</div></div></dialog>
  <dialog id="ai-analysis-dialog" class="ai-analysis-dialog"><div class="dialog-head"><div><span class="eyebrow">ИИ-провайдер · необязательно</span><h2 id="ai-analysis-title">ИИ-разбор сделки</h2></div><button class="icon-button" data-close="ai-analysis-dialog"><i data-lucide="x"></i></button></div><div class="ai-analysis-content">
    <section class="ai-provider"><label><span>Адрес</span><input id="ai-endpoint" type="text" value="http://127.0.0.1:11434/api/chat" placeholder="LM Studio: http://server:1234/v1/chat/completions" /></label><label><span>Модель</span><input id="ai-model" type="text" value="gemma3:4b" placeholder="Точный ID из /v1/models" /></label><label><span>API key · не сохраняется</span><input id="ai-api-key" type="password" autocomplete="off" placeholder="Необязательно" /></label><button id="ai-analyze" class="primary"><i data-lucide="sparkles"></i> Анализировать</button></section>
    <div class="ai-privacy"><i data-lucide="shield-check"></i><span>ИИ отключён по умолчанию и вызывается только этой кнопкой. Удалённый сервер получит компактный набор рыночных показателей, но не ключ STALCRAFT и не полную базу.</span></div>
    <div id="ai-analysis-content" class="ai-analysis-result"><div class="timing-empty"><i data-lucide="sparkles"></i><strong>Модель дополнит расчёты объяснением</strong><span>Она не заменяет числовую аналитику и не является гарантией сделки.</span></div></div>
  </div></dialog>
  <div id="help-popover" class="help-popover" role="tooltip"><strong>Как читать показатель</strong><p></p></div>
  <div id="toast" class="toast"></div>
`;

createIcons({ icons: appIcons });

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const input = (id: string) => $<HTMLInputElement>(`#${id}`);
const value = (id: string) => input(id).value.trim();
const numberValue = (id: string): number | undefined => value(id) === "" ? undefined : Number(value(id));
const money = (amount?: number) => amount == null ? "—" : Math.round(amount).toLocaleString("ru-RU");

let catalog: CatalogItem[] = [];
let selected: CatalogItem | undefined;
let rules: Rule[] = [];
let ruleScope: "item" | "category" = "item";
let categorySelectedIds = new Set<string>();
let matches: MatchRecord[] = [];
let category = "";
let realm = "global";
let monitorTimer: number | undefined;
let rapidMonitorTimer: number | undefined;
let checking = false;
let rapidChecking = false;
let rapidBaselinePending = false;
let rapidBackoffUntil = 0;
let rapidNextDue = new Map<string, number>();
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
let scannerInsights: MarketInsight[] = [];
let automaticStackStrategies = new Map<string, StackStrategyAnalysis>();
let scenarioOpportunity: MarketOpportunity | undefined;
let aiOpportunity: MarketOpportunity | undefined;
let movementMarkets: MarketMovement[] = [];
let selectedMovementKey: string | undefined;
let movementChart: IChartApi | undefined;
let movementResizeObserver: ResizeObserver | undefined;
let pinnedHelp: HTMLElement | undefined;

function showHelp(button: HTMLElement, pin = false) {
  const popover = $("#help-popover");
  const message = button.dataset.help;
  if (!message) return;
  popover.querySelector("p")!.textContent = message;
  popover.classList.add("show");
  if (pin) pinnedHelp = button;
  const rect = button.getBoundingClientRect();
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  const left = Math.max(10, Math.min(window.innerWidth - width - 10, rect.left + rect.width / 2 - width / 2));
  const below = rect.bottom + 8;
  const top = below + height <= window.innerHeight - 10 ? below : Math.max(10, rect.top - height - 8);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function hideHelp(force = false) {
  if (pinnedHelp && !force) return;
  pinnedHelp = undefined;
  $("#help-popover").classList.remove("show");
}

document.addEventListener("pointerover", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>(".metric-help");
  if (button && !pinnedHelp) showHelp(button);
});
document.addEventListener("pointerout", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>(".metric-help");
  if (button && !button.contains(event.relatedTarget as Node | null)) hideHelp();
});
document.addEventListener("focusin", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>(".metric-help");
  if (button) showHelp(button);
});
document.addEventListener("focusout", (event) => {
  if ((event.target as HTMLElement).closest(".metric-help")) hideHelp();
});
document.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>(".metric-help");
  if (button) {
    event.preventDefault();
    event.stopPropagation();
    if (pinnedHelp === button) hideHelp(true); else { pinnedHelp = undefined; showHelp(button, true); }
  } else if (pinnedHelp) hideHelp(true);
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") hideHelp(true); });

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
  if (document.querySelector("#rapid-monitor")) renderRapidRuleControls();
}

function renderRuleScope() {
  $("#item-scope").classList.toggle("hidden", ruleScope !== "item");
  $("#category-scope").classList.toggle("hidden", ruleScope !== "category");
  $("#rule-scope").querySelectorAll("button").forEach((button) =>
    button.classList.toggle("active", (button as HTMLButtonElement).dataset.value === ruleScope));
  renderRapidRuleControls();
}

function renderRapidRuleControls() {
  const enabled = input("rapid-monitor").checked;
  const interval = Math.max(3, Math.min(10, Number(input("rapid-interval").value) || 5));
  const itemCount = ruleScope === "category" ? Math.max(1, categorySelectedIds.size) : 1;
  $("#rapid-settings").classList.toggle("hidden", !enabled);
  $("#rapid-warning").classList.toggle("hidden", !enabled);
  $("#rapid-interval-value").textContent = `${interval} сек`;
  $("#rapid-budget-title").textContent = `${itemCount} ${itemCount === 1 ? "запрос" : itemCount < 5 ? "запроса" : "запросов"} каждые ${interval} сек`;
  $("#rapid-budget-note").textContent = `${(itemCount / interval).toFixed(2)} запроса/с · запрашиваются 5 последних лотов каждого предмета`;
  input("current-percent").disabled = enabled;
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
  const minAmount = numberValue("min-amount");
  const maxAmount = numberValue("max-amount");
  const rapidMonitor = input("rapid-monitor").checked;
  const rapidIntervalSeconds = Math.max(3, Math.min(10, Math.round(numberValue("rapid-interval") ?? 5)));
  if (minUpgrade != null && maxUpgrade != null && minUpgrade > maxUpgrade) throw new Error("Минимальная заточка не может быть больше максимальной");
  if (minAmount != null && maxAmount != null && minAmount > maxAmount) throw new Error("Минимальное количество не может быть больше максимального");
  if (rapidMonitor && ruleScope === "category" && items.length > 15) throw new Error("Для оперативного мониторинга выберите не более 15 предметов");
  return {
    name: value("rule-name") || (ruleScope === "category" ? `Лучшее в ${categoryName}` : selected?.nameRu) || itemId,
    itemId,
    region: $<HTMLSelectElement>("#region").value,
    scope: ruleScope,
    category: ruleScope === "category" ? categoryName : undefined,
    itemIds: ruleScope === "category" ? items.map((item) => item.id) : undefined,
    topN: ruleScope === "category" ? Number($<HTMLSelectElement>("#category-top").value) : undefined,
    maxBuyout: numberValue("max-buyout"), maxUnitBuyout: numberValue("max-unit"), minAmount, maxAmount,
    artifactQualities: selectedQualities, minUpgrade, maxUpgrade,
    maxHistoryMedianRatio: numberValue("history-percent") == null ? undefined : numberValue("history-percent")! / 100,
    maxCurrentMinRatio: rapidMonitor || numberValue("current-percent") == null ? undefined : numberValue("current-percent")! / 100,
    historyLimit: 100, limit: 50, sort: "time_created", order: "desc",
    additional: selectedQualities.length > 0 || minUpgrade != null || maxUpgrade != null,
    rapidMonitor, rapidIntervalSeconds, rapidLimit: 5,
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
    rule.rapidMonitor ? `оперативно · ${rule.rapidIntervalSeconds || 5} сек` : "",
    rule.scope === "category" ? `${rule.itemIds?.length || 0} предметов · топ ${rule.topN || 1}` : "",
    rule.maxBuyout != null ? `лот ≤ ${money(rule.maxBuyout)}` : "",
    rule.maxUnitBuyout != null ? `шт. ≤ ${money(rule.maxUnitBuyout)}` : "",
    describeRange("кол-во", rule.minAmount, rule.maxAmount),
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
type AdvisorSection = "decisions" | "deals" | "metrics";

function switchView(view: WorkspaceView) {
  $("#overview-view").classList.toggle("hidden", view !== "overview");
  $("#config-view").classList.toggle("hidden", view !== "config");
  $("#history-view").classList.toggle("hidden", view !== "history");
  $("#analytics-view").classList.toggle("hidden", view !== "analytics");
  $("#scanner-view").classList.toggle("hidden", view !== "scanner");
  $("#movement-view").classList.toggle("hidden", view !== "movement");
  const navigationView = view === "scanner" ? "analytics" : view;
  document.querySelectorAll<HTMLButtonElement>(".workspace-tabs button").forEach((button) =>
    button.classList.toggle("active", button.dataset.view === navigationView));
  $(".workspace").scrollTop = 0;
}

function switchAdvisorSection(section: AdvisorSection) {
  if (section === "deals") {
    switchView("scanner");
  } else {
    switchView("analytics");
    $("#advisor-decisions-panel").classList.toggle("hidden", section !== "decisions");
    $("#advisor-metrics-panel").classList.toggle("hidden", section !== "metrics");
  }
  document.querySelectorAll<HTMLButtonElement>(".advisor-tabs button").forEach((button) =>
    button.classList.toggle("active", button.dataset.advisor === section));
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
      <div class="market-rule-actions"><button class="icon-button small market-edit" title="Изменить правило"><i data-lucide="pencil"></i></button></div>
    </article>`;
    const position = marketPosition(rule, summary);
    const stateClass = summary.matchingLots > 0 ? "success" : summary.totalLots ? "quiet" : "empty";
    const stateText = summary.matchingLots > 0 ? `Подходит: ${summary.matchingLots}` : summary.totalLots ? "Подходящих нет" : "Нет лотов";
    const limit = rule.maxBuyout ?? rule.maxUnitBuyout;
    const market = rule.maxBuyout != null ? summary.currentMinBuyout : summary.currentMinUnit;
    return `<article class="market-rule ${stateClass}" data-market-rule="${index}">
      <div class="market-rule-main"><span class="rule-region">${escapeHtml(rule.region)}</span><div><strong>${escapeHtml(rule.name)}</strong><small>${escapeHtml(ruleTargetLabel(rule))} · ${escapeHtml(describeRule(rule))}</small></div></div>
      <div class="market-state ${stateClass}"><span></span>${stateText}</div>
      <div class="market-rule-actions"><button class="secondary small market-lots" title="Показать активные лоты"><i data-lucide="table-2"></i> Лоты</button><button class="icon-button small market-edit" title="Изменить правило"><i data-lucide="pencil"></i></button></div>
      <div class="market-metrics">
        <div><span>Минимум рынка</span><strong>${money(market)} ₽</strong></div>
        <div><span>Ваш лимит</span><strong>${money(limit)} ₽</strong></div>
        <div><span>Активных</span><strong>${summary.totalLots}</strong></div>
        <div><span>Сравнимых</span><strong>${summary.comparableLots}</strong></div>
      </div>
      <div class="price-position"><div><span>${position.favorable ? "В пределах правила" : "Пока вне правила"}</span><b>${position.text}</b></div><div class="price-track"><span class="${position.favorable ? "favorable" : ""}" style="width:${position.percent}%"></span></div></div>
      <div class="market-active-lots hidden"></div>
    </article>`;
  }).join("") || `<div class="overview-empty"><i data-lucide="sliders-horizontal"></i><strong>Добавьте первое правило</strong><button class="secondary" data-open-config>Настроить фильтры</button></div>`;
  createIcons({ icons: appIcons });
}

function activeLotTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function toggleActiveLots(card: HTMLElement, ruleIndex: number) {
  const panel = card.querySelector<HTMLElement>(".market-active-lots");
  const button = card.querySelector<HTMLButtonElement>(".market-lots");
  if (!panel || !button) return;
  if (panel.dataset.loaded === "true") {
    panel.classList.toggle("hidden");
    button.classList.toggle("active", !panel.classList.contains("hidden"));
    return;
  }
  panel.classList.remove("hidden");
  button.classList.add("active", "busy");
  panel.innerHTML = `<div class="active-lots-loading"><span></span>Читаю последний снимок рынка</div>`;
  try {
    const response = await invoke<ActiveLotsResponse>("active_lots_for_rules", {
      rules: expandedRules([rules[ruleIndex]]), limit: 100,
    });
    const snapshotState = response.markets === response.completeMarkets ? "полный обход" : `${response.completeMarkets} из ${response.markets} полных обходов`;
    const rows = response.lots.map((lot) => {
      const item = catalog.find((candidate) => candidate.id === lot.itemId);
      const variant = [lot.quality, lot.upgrade == null ? "" : `+${lot.upgrade}`].filter(Boolean).join(" · ") || "—";
      return `<tr class="${lot.matchesRule ? "matches" : ""}"><td><strong>${escapeHtml(item?.nameRu || item?.nameEn || lot.itemId)}</strong><small>${escapeHtml(lot.itemId)}</small></td><td>${escapeHtml(variant)}</td><td>${lot.amount.toLocaleString("ru-RU")}</td><td><strong>${money(lot.unitPrice)} ₽</strong></td><td>${money(lot.buyout)} ₽</td><td>${money(lot.currentPrice)} ₽</td><td>${escapeHtml(activeLotTime(lot.endTime))}</td><td><span class="active-lot-state ${lot.matchesRule ? "match" : "outside"}">${lot.matchesRule ? "Подходит" : "Вне правила"}</span></td></tr>`;
    }).join("");
    panel.innerHTML = `<div class="active-lots-head"><div><strong>Активные лоты</strong><span>${response.total.toLocaleString("ru-RU")} сравнимых · показано ${response.returned.toLocaleString("ru-RU")} самых дешёвых</span></div><small>${response.collectedAt ? activeLotTime(response.collectedAt) : "нет снимка"} · ${escapeHtml(snapshotState)}</small></div><div class="active-lots-table"><table><thead><tr><th>Предмет</th><th>Вариант</th><th>Шт.</th><th>За штуку</th><th>Выкуп</th><th>Ставка</th><th>Окончание</th><th>Правило</th></tr></thead><tbody>${rows || `<tr><td colspan="8" class="table-empty">В последнем снимке нет сравнимых активных лотов</td></tr>`}</tbody></table></div>`;
    panel.dataset.loaded = "true";
  } catch (error) {
    panel.innerHTML = `<div class="active-lots-error"><i data-lucide="triangle-alert"></i><span>${escapeHtml(String(error))}</span></div>`;
    createIcons({ icons: appIcons });
  } finally {
    button.classList.remove("busy");
  }
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
    <td><span class="history-source-badge ${entry.source === "schistory" ? "external" : "official"}">${entry.source === "schistory" ? "SCHistory API" : "STALZONE API"}</span></td><td>${entry.amount.toLocaleString("ru-RU")}</td><td>${money(entry.price)} ₽</td><td>${money(entry.unitPrice)} ₽</td>
  </tr>`).join("") || `<tr><td colspan="7" class="table-empty">Нет продаж по выбранным фильтрам</td></tr>`;
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

async function importSchistoryHistory() {
  if (!historyItem) { toast("Сначала выберите артефакт в каталоге", true); return; }
  if (!itemIsArtifact(historyItem)) { toast("SCHistory импортируется только для артефактов", true); return; }
  const qualityCodes = selectedHistoryQualityCodes();
  if (!qualityCodes.length) { toast("Выберите хотя бы одну редкость артефакта", true); return; }
  const minUpgrade = numberValue("history-min-upgrade");
  const maxUpgrade = numberValue("history-max-upgrade");
  if (minUpgrade != null && maxUpgrade != null && minUpgrade > maxUpgrade) { toast("Минимальная заточка не может быть больше максимальной", true); return; }
  const button = $("#history-import-schistory");
  button.classList.add("busy");
  try {
    const response = await invoke<SchistoryImportResponse>("import_schistory_history", {
      itemId: historyItem.id,
      region: $<HTMLSelectElement>("#history-region").value,
      qualityCodes,
      minUpgrade: minUpgrade ?? null,
      maxUpgrade: maxUpgrade ?? null,
    });
    historySource = "local";
    updateHistorySourceControls();
    $<HTMLSelectElement>("#history-limit").value = response.matchingSales > 5000 ? "10000" : response.matchingSales > 1000 ? "5000" : "1000";
    await loadSalesHistory();
    const range = response.oldestSale && response.newestSale
      ? ` · ${new Date(response.oldestSale).toLocaleDateString("ru-RU")}–${new Date(response.newestSale).toLocaleDateString("ru-RU")}` : "";
    toast(`SCHistory: добавлено ${response.insertedSales.toLocaleString("ru-RU")} продаж`);
    log(`SCHistory item ${response.externalItemId}: получено ${response.fetchedSales}, подходит ${response.matchingSales}, добавлено ${response.insertedSales}, уже было ${response.skippedExisting}${range}`);
  } catch (error) { toast(String(error), true); log(String(error), true); }
  finally { button.classList.remove("busy"); }
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
  const discount = insight.discountPercent ?? 0;
  const trend = insight.trendPercent ?? 0;
  const volatility = insight.volatilityPercent ?? 0;
  const supplyChange = insight.movementSupplyChangePercent;
  const priceMovement = insight.movementPriceChangePercent;
  const oversupply = supplyChange != null && supplyChange >= 15 && (priceMovement ?? 0) <= 0;
  const weakData = insight.salesSample < 30;
  const highRisk = weakData || volatility >= 40 || (insight.liquidity === "Низкая" && insight.risks.length > 0);
  const stack = automaticStackStrategies.get(insightKey(insight));
  const stackFee = Math.max(0, Math.min(50, numberValue("scanner-fee") ?? 5)) / 100;
  const stackRoi = stack?.complete && stack.averageBuyUnit != null && stack.expectedSellUnit != null
    ? (stack.expectedSellUnit * (1 - stackFee) - stack.averageBuyUnit) / stack.averageBuyUnit * 100 : undefined;
  const stackOpportunity = stackRoi != null && stackRoi >= 5 && (stack?.bulkSalesSample ?? 0) >= 5;
  let action: RecommendationAction;
  if (stackOpportunity) action = "buy";
  else if (highRisk && discount < 20) action = "risk";
  else if (discount >= 12 && insight.opportunityScore >= 60 && insight.liquidity !== "Низкая" && !oversupply && trend >= -5) action = "buy";
  else if (discount <= -8 && insight.liquidity !== "Низкая") action = "sell";
  else if (oversupply || (discount < 8 && trend <= 0)) action = "wait";
  else if (trend >= 5 && !oversupply) action = "hold";
  else action = "wait";

  const labels: Record<RecommendationAction, [string, string, string, string]> = {
    buy: ["Покупка выглядит выгодно", stackOpportunity ? `Можно собрать пачку ${stack!.targetAmount} шт. из дешёвых малых лотов и продать по истории крупных пачек.` : "Цена заметно ниже рыночного ориентира, а ликвидность поддерживает вход.", stackOpportunity ? `Собрать пачку из ${stack!.purchaseLots} лотов` : "Рассмотреть покупку", "Держать: рынок поддерживает цену"],
    sell: ["Хорошее окно для продажи", "Текущее предложение дороже подтверждённых продаж сопоставимого варианта.", "Не покупать по текущей цене", "Рассмотреть продажу"],
    wait: ["Лучше подождать", "Запас выгоды пока недостаточен для уверенного входа.", "Ждать более низкую цену", oversupply ? "Продать раньше роста конкуренции" : "Не спешить с продажей"],
    hold: ["Рынок поддерживает удержание", "Цена растёт, а заметного давления предложения пока нет.", "Не догонять рост цены", "Держать и следить за предложением"],
    risk: ["Надёжного сигнала пока нет", "Данных или ликвидности недостаточно для уверенного решения.", "Пропустить до новых данных", "Решать только с запасом по цене"],
  };
  const reasons = [
    insight.currentMinUnit != null && (insight.fairValueUnit ?? insight.medianUnit) != null
      ? `Минимум ${money(insight.currentMinUnit)} ₽/шт., адаптивная цена ${money(insight.fairValueUnit ?? insight.medianUnit)} ₽/шт., отклонение ${signedPercent(discount)}.`
      : "Недостаточно данных для сравнения с медианой.",
    `Тренд ${signedPercent(insight.trendPercent)}, ликвидность ${insight.liquidity.toLocaleLowerCase("ru")}, разброс ${signedPercent(insight.volatilityPercent)}.`,
  ];
  if (stackOpportunity) reasons.unshift(`Средняя закупка ${money(stack!.averageBuyUnit)} ₽/шт., ожидаемая продажа пачкой ${money(stack!.expectedSellUnit)} ₽/шт., доходность после расходов ${signedPercent(stackRoi)}.`);
  if (supplyChange != null) reasons.push(`Сопоставимое предложение за 24 часа ${signedPercent(supplyChange)}, медиана предложений ${signedPercent(priceMovement)}.`);
  if (insight.risks.length) reasons.push(`Риски: ${insight.risks.join(", ").toLocaleLowerCase("ru")}.`);
  const fair = stackOpportunity ? stack!.expectedSellUnit : insight.fairValueUnit ?? insight.medianUnit;
  const stackBuyLimit = stackOpportunity && fair != null ? fair * (1 - stackFee) / 1.05 : undefined;
  const targetLow = stackBuyLimit != null ? roundRecommendationPrice(stackBuyLimit * .95)
    : fair == null ? undefined : roundRecommendationPrice(Math.max(fair * .75, Math.min(insight.p25Unit ?? fair * .85, fair * .85)));
  const targetHigh = stackBuyLimit != null ? roundRecommendationPrice(stackBuyLimit)
    : fair == null ? undefined : roundRecommendationPrice(fair * .9);
  const decisionSample = stackOpportunity ? stack!.bulkSalesSample : insight.salesSample;
  const dataQuality = decisionSample >= 100 && insight.movementCollections >= 5 && insight.movementCoveragePercent >= 80 && volatility < 30
    ? "Высокое" : decisionSample >= 30 && volatility < 45 ? "Среднее" : "Низкое";
  const decisionStrength = Math.abs(stackRoi ?? discount) + Math.min(20, Math.abs(trend))
    + Math.min(20, decisionSample / 10) + (dataQuality === "Высокое" ? 12 : dataQuality === "Среднее" ? 6 : 0);
  return {
    insight, action, title: labels[action][0], summary: labels[action][1], reasons,
    buyerAction: labels[action][2], ownerAction: labels[action][3], decisionStrength,
    currentBuyUnit: stackOpportunity ? stack!.averageBuyUnit : insight.currentMinUnit,
    marketReferenceUnit: fair, contextLabel: stackOpportunity ? `сборка ${stack!.targetAmount} шт. → продажа ${stack!.sellMinAmount}+` : insight.comparisonAmountLabel,
    decisionRoi: stackOpportunity ? stackRoi : undefined, dataSample: decisionSample,
    targetLow, targetHigh, dataQuality,
  };
}

function renderRecommendations(region: string) {
  const actionMeta: Record<RecommendationAction, { icon: string }> = {
    buy: { icon: "shopping-cart" }, sell: { icon: "badge-dollar-sign" },
    wait: { icon: "hourglass" }, hold: { icon: "hand" }, risk: { icon: "triangle-alert" },
  };
  const recommendations = analyticsInsights.filter((item) => region === "all" || item.region === region)
    .map(recommendationFor)
    .sort((a, b) => b.decisionStrength - a.decisionStrength)
    .slice(0, 8);
  $("#recommendation-context").textContent = "Сравниваются обычная перепродажа и сборка крупных пачек, если предмет складывается";
  $("#recommendation-list").innerHTML = recommendations.map((item) => {
    const target = item.targetLow != null && item.targetHigh != null ? `${money(item.targetLow)}–${money(item.targetHigh)} ₽/шт.` : "Недостаточно данных";
    const canCreateRule = (item.action === "buy" || item.action === "wait" || item.action === "risk") && item.targetHigh != null;
    const ruleButton = canCreateRule
      ? `<button class="secondary recommendation-rule"><i data-lucide="bell-plus"></i> Следить ≤ ${money(item.targetHigh)} ₽</button>` : "";
    return `<article class="recommendation-card ${item.action}" data-recommendation-id="${escapeHtml(item.insight.itemId)}" data-recommendation-region="${escapeHtml(item.insight.region)}" data-target-high="${item.targetHigh ?? ""}">
      <div class="recommendation-heading"><span class="recommendation-icon"><i data-lucide="${actionMeta[item.action].icon}"></i></span><div><strong>${escapeHtml(item.insight.name)}</strong><small>${escapeHtml(item.insight.region)} · ${escapeHtml(item.contextLabel)} · ${escapeHtml(item.insight.itemId)}</small></div><span class="recommendation-action">${escapeHtml(item.title)}</span></div>
      <p>${escapeHtml(item.summary)}</p>
      <div class="recommendation-market"><div><span>${item.contextLabel.startsWith("сборка") ? "Средняя закупка" : "Сейчас / шт."}</span><strong>${money(item.currentBuyUnit)} ₽</strong></div><div><span>${item.contextLabel.startsWith("сборка") ? "Ожидаемая продажа" : "Рыночный ориентир"}</span><strong>${money(item.marketReferenceUnit)} ₽</strong></div><div><span>${item.contextLabel.startsWith("сборка") ? "ROI после расходов" : "Отклонение"}</span><strong class="${(item.decisionRoi ?? item.insight.discountPercent ?? 0) >= 0 ? "positive" : "negative"}">${item.contextLabel.startsWith("сборка") ? signedPercent(item.decisionRoi) : signedPercent(item.insight.discountPercent)}</strong></div><div><span>Зона покупки</span><strong>${target}</strong></div></div>
      <div class="recommendation-paths"><div><span>Если хотите купить</span><strong>${escapeHtml(item.buyerAction)}</strong></div><div><span>Если предмет уже у вас</span><strong>${escapeHtml(item.ownerAction)}</strong></div></div>
      <details class="recommendation-details"><summary>Почему такой вывод</summary><div class="recommendation-reasons">${item.reasons.slice(0, 4).map((reason) => `<span>${escapeHtml(reason)}</span>`).join("")}</div></details>
      <footer><div><span>Качество данных</span><strong>${item.dataQuality}</strong><small>${item.dataSample.toLocaleString("ru-RU")} продаж · ${item.insight.movementCollections} снимков · полнота ${item.insight.movementCoveragePercent.toFixed(0)}%</small></div><div class="recommendation-buttons"><button class="secondary recommendation-metrics"><i data-lucide="bar-chart-3"></i> Метрики</button>${ruleButton}</div></footer>
    </article>`;
  }).join("") || `<div class="recommendation-empty">Нет рекомендаций по выбранному региону</div>`;
  createIcons({ icons: appIcons });
}

function renderAnalytics() {
  const decisions = analyticsInsights.map(recommendationFor);
  $("#analytics-best").textContent = analyticsInsights.length ? String(analyticsInsights.length) : "—";
  $("#analytics-best-name").textContent = analyticsInsights.length === 1 ? analyticsInsights[0].name : "вариантов рынка";
  $("#analytics-discount").textContent = analyticsInsights.length ? String(decisions.filter((item) => item.action === "buy").length) : "—";
  $("#analytics-liquid").textContent = analyticsInsights.length ? String(decisions.filter((item) => item.action === "sell").length) : "—";
  $("#analytics-matches").textContent = analyticsInsights.length ? String(decisions.filter((item) => item.action === "wait" || item.action === "hold").length) : "—";

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
      <div class="insight-heading"><span class="rule-region">${escapeHtml(item.region)}</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.itemId)} · пачки ${escapeHtml(item.comparisonAmountLabel)} · ${item.salesSample} продаж</small></div></div>
      <div class="score-box ${scoreClass}"><strong>${item.opportunityScore}</strong><span>${escapeHtml(item.verdict)} ${helpTip(helpText.opportunityScore)}</span></div>
      <div class="insight-actions"><button class="icon-button small insight-history" title="Открыть историю продаж"><i data-lucide="history"></i></button><button class="icon-button small insight-edit" title="Изменить правило"><i data-lucide="pencil"></i></button></div>
      <div class="insight-signal"><div><span>Текущий минимум ${helpTip(helpText.askMinimum)}</span><strong>${money(item.currentMinUnit)} ₽/шт.</strong></div><div><span>Адаптивная цена ${helpTip(helpText.adaptivePrice)}</span><strong>${money(item.fairValueUnit ?? item.medianUnit)} ₽/шт.</strong></div><div><span>Отклонение ${helpTip(helpText.deviation)}</span><strong class="${discountClass}">${signedPercent(item.discountPercent)}</strong></div></div>
      <div class="opportunity-track"><span class="${scoreClass}" style="width:${item.opportunityScore}%"></span></div>
      <div class="price-zones"><div><span>Недавний P25 ${helpTip(helpText.percentile)}</span><strong>${money(item.recentP25Unit ?? item.p25Unit)} ₽</strong></div><div><span>Адаптивная / длинная ${helpTip(helpText.adaptivePrice)}</span><strong>${money(item.fairValueUnit ?? item.medianUnit)} / ${money(item.medianUnit)} ₽</strong></div><div><span>Недавний P75 ${helpTip(helpText.percentile)}</span><strong>${money(item.recentP75Unit ?? item.p75Unit)} ₽</strong></div></div>
      <div class="insight-metrics"><div><span>Тренд 24ч ${helpTip(helpText.trend)}</span><strong class="${trendClass}">${signedPercent(item.trendPercent)}</strong></div><div><span>Недавний разброс ${helpTip(helpText.volatility)}</span><strong>${signedPercent(item.volatilityPercent)}</strong></div><div><span>Продаж в день ${helpTip(helpText.salesPerDay)}</span><strong>${item.salesPerDay == null ? "—" : item.salesPerDay.toFixed(1)}</strong></div><div><span>Свежая выборка ${helpTip(helpText.freshSample)}</span><strong>${item.recentSalesSample}</strong></div><div><span>Тип лотов ${helpTip("Пачки считаются уместными только после фактического наблюдения amount > 1. Экипировка и артефакты всегда считаются поштучными.")}</span><strong>${escapeHtml(stackabilityLabel(item))}</strong></div><div><span>Размер / активных ${helpTip("Размерная группа самого дешёвого лота; далее число предложений в группе и всего по варианту.")}</span><strong>${escapeHtml(item.comparisonAmountLabel)} · ${item.activeLots}/${item.allActiveLots}</strong></div></div>
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
    scannerInsights = response.insights;
    $("#analytics-updated").textContent = `Обновлено ${new Date(response.generatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
    $("#scanner-updated").textContent = `Тот же расчёт · ${new Date(response.generatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
    $("#scanner-updated").textContent = "Проверяю премию за крупные пачки...";
    await loadAutomaticStackStrategies(response.insights);
    $("#scanner-updated").textContent = `Обновлено ${new Date(response.generatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} · проверены обычная перепродажа и сборка пачек`;
    renderAnalytics();
    renderScanner();
    $(".workspace").scrollTop = 0;
    await refreshCacheStatus();
  } catch (error) { toast(String(error), true); log(String(error), true); $("#analytics-updated").textContent = "Не удалось рассчитать аналитику"; }
  finally { $("#analytics-load").classList.remove("busy"); }
}

function insightKey(insight: MarketInsight) {
  return `${insight.region}|${insight.itemId}|${insight.artifactQualities.join(",")}|${insight.minUpgrade ?? ""}|${insight.maxUpgrade ?? ""}`;
}

function inherentlySingleItem(insight: MarketInsight) {
  const item = catalog.find((candidate) => candidate.id === insight.itemId);
  const kind = `${item?.category || ""} ${item?.subcategory || ""}`.toLocaleLowerCase("ru");
  const nonStackable = [
    "weapon", "armor", "armour", "container", "artefact", "artifact", "backpack", "device",
    "оруж", "брон", "контейнер", "артефакт", "рюкзак",
  ];
  return insight.artifactQualities.length > 0 || nonStackable.some((marker) => kind.includes(marker));
}

function stackabilityFor(insight: MarketInsight): MarketInsight["stackability"] {
  return inherentlySingleItem(insight) ? "single" : insight.stackability;
}

function supportsStackStrategy(insight: MarketInsight) {
  return stackabilityFor(insight) === "stackable";
}

function stackabilityLabel(insight: MarketInsight) {
  const kind = stackabilityFor(insight);
  if (kind === "stackable") return `Складывается · найдено пачек: ${insight.stackEvidence}`;
  if (kind === "single") return "Только поштучно";
  return "Пачки пока не подтверждены";
}

async function loadAutomaticStackStrategies(insights: MarketInsight[]) {
  automaticStackStrategies = new Map();
  const feePercent = Math.max(0, Math.min(50, numberValue("scanner-fee") ?? 5));
  const candidates = insights.filter(supportsStackStrategy);
  for (let index = 0; index < candidates.length; index += 4) {
    const batch = candidates.slice(index, index + 4);
    const results = await Promise.allSettled(batch.map((insight) => invoke<StackStrategyAnalysis>("stack_strategy_analysis", {
      rule: analysisRuleForInsight(insight), buyMaxAmount: 9, sellMinAmount: 20,
      targetAmount: 20, feePercent, maxBuyUnit: null,
    })));
    results.forEach((result, resultIndex) => {
      if (result.status !== "fulfilled") return;
      const strategy = result.value;
      if (strategy.bulkSalesSample >= 5 && strategy.expectedSellUnit != null) {
        automaticStackStrategies.set(insightKey(batch[resultIndex]), strategy);
      }
    });
  }
}

function opportunityFor(insight: MarketInsight, feePercent: number, horizonDays: number): MarketOpportunity | undefined {
  const fairValue = insight.fairValueUnit ?? insight.medianUnit;
  if (insight.currentMinUnit == null || fairValue == null || insight.currentMinUnit <= 0 || fairValue <= 0) return undefined;
  const volatility = Math.max(0, insight.volatilityPercent ?? 35);
  const negativeTrend = Math.max(0, -(insight.trendPercent ?? 0));
  const haircutPercent = Math.min(12, Math.max(2, volatility * .15) + Math.min(5, negativeTrend * .25));
  let mode: MarketOpportunity["mode"] = "comparable";
  let buyPrice = insight.currentMinUnit;
  let expectedSellPrice = fairValue * (1 - haircutPercent / 100);
  let netSellPrice = expectedSellPrice * (1 - feePercent / 100);
  let profitPerUnit = netSellPrice - buyPrice;
  let roiPercent = profitPerUnit / buyPrice * 100;
  let purchaseAmount = insight.currentMinAmount ?? 1;
  let purchaseLots = 1;
  let sellAmountLabel = insight.comparisonAmountLabel;
  const stackStrategy = automaticStackStrategies.get(insightKey(insight));
  if (stackStrategy?.complete && stackStrategy.averageBuyUnit != null && stackStrategy.expectedSellUnit != null) {
    const stackNetSell = stackStrategy.expectedSellUnit * (1 - feePercent / 100);
    const stackProfitUnit = stackNetSell - stackStrategy.averageBuyUnit;
    const stackRoi = stackProfitUnit / stackStrategy.averageBuyUnit * 100;
    if (stackRoi > roiPercent) {
      mode = "stack";
      buyPrice = stackStrategy.averageBuyUnit;
      expectedSellPrice = stackStrategy.expectedSellUnit;
      netSellPrice = stackNetSell;
      profitPerUnit = stackProfitUnit;
      roiPercent = stackRoi;
      purchaseAmount = stackStrategy.acquiredAmount;
      purchaseLots = stackStrategy.purchaseLots;
      sellAmountLabel = `${stackStrategy.sellMinAmount}+`;
    }
  }

  const dailyTurnoverPerLot = (insight.salesPerDay ?? 0) / Math.max(1, insight.activeLots);
  const sellThroughPercent = (1 - Math.exp(-dailyTurnoverPerLot * horizonDays)) * 100;
  const relevantSample = mode === "stack" ? stackStrategy!.bulkSalesSample : insight.salesSample;
  const sampleQuality = Math.min(1, relevantSample / 100);
  const coverageQuality = Math.min(1, insight.movementCoveragePercent / 100);
  const collectionQuality = Math.min(1, insight.movementCollections / 10);
  const confidencePercent = (sampleQuality * .5 + coverageQuality * .3 + collectionQuality * .2) * 100;
  const confidence = confidencePercent >= 75 ? "Высокая" : confidencePercent >= 45 ? "Средняя" : "Низкая";

  const roiPoints = Math.max(0, Math.min(1, (roiPercent + 5) / 30)) * 45;
  const turnoverPoints = sellThroughPercent / 100 * 25;
  const confidencePoints = confidencePercent / 100 * 20;
  const stabilityPoints = Math.max(0, 10 - volatility / 5);
  const supplyPenalty = Math.max(0, Math.min(10, ((insight.movementSupplyChangePercent ?? 0) - 15) / 4));
  const score = Math.round(Math.max(0, Math.min(100, roiPoints + turnoverPoints + confidencePoints + stabilityPoints - supplyPenalty)));

  const warnings = [...insight.risks];
  if (mode === "stack") warnings.push(`Сборка ${purchaseAmount} шт. из ${purchaseLots} дешёвых лотов`);
  else if (haircutPercent >= 8) warnings.push("Цена выхода снижена из-за риска");
  if (sellThroughPercent < 35) warnings.push(`Вероятно долгая продажа: более ${horizonDays} дн.`);
  if ((insight.movementSupplyChangePercent ?? 0) >= 20) warnings.push("Сопоставимое предложение быстро растёт");
  if (insight.medianUnit != null && Math.abs(fairValue / insight.medianUnit - 1) >= .1) warnings.push("Рынок сменил ценовой уровень");
  if (profitPerUnit <= 0) warnings.push("После расходов ожидается убыток");
  return {
    insight, score, buyPrice, expectedSellPrice, netSellPrice, profitPerUnit, roiPercent,
    sellThroughPercent, confidencePercent, confidence, warnings: [...new Set(warnings)],
    mode, purchaseAmount, purchaseLots, sellAmountLabel,
    stackStrategy: mode === "stack" ? stackStrategy : undefined,
  };
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

function analysisRuleForInsight(insight: MarketInsight): Rule {
  return {
    name: insight.name, itemId: insight.itemId, region: insight.region,
    artifactQualities: insight.artifactQualities,
    minAmount: insight.comparisonAmountMin,
    maxAmount: insight.comparisonAmountMax,
    minUpgrade: insight.minUpgrade, maxUpgrade: insight.maxUpgrade,
    additional: true, historyLimit: 200, limit: 200, sort: "time_created", order: "desc",
  };
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
    const isStack = item.mode === "stack";
    const strategy = item.stackStrategy;
    const stackability = stackabilityFor(item.insight);
    const context = isStack
      ? `сборка ${item.purchaseAmount} шт. из ${item.purchaseLots} лотов · продажа пачкой ${item.sellAmountLabel} · ${strategy?.bulkSalesSample ?? 0} крупных продаж`
      : stackability === "single" ? `поштучный рынок · ${item.insight.salesSample} продаж`
      : stackability === "unknown" ? `пачки не подтверждены · размер ${item.insight.comparisonAmountLabel} · ${item.insight.salesSample} продаж`
      : `сопоставимые пачки ${item.insight.comparisonAmountLabel} · ${item.insight.salesSample} продаж`;
    const buyNote = isStack ? `${item.purchaseLots} лотов · ${item.purchaseAmount} шт. суммарно` : `${item.insight.currentMinAmount ?? "—"} шт. в лоте`;
    const sellNote = isStack
      ? `пачки ${item.sellAmountLabel} · медиана ${money(strategy?.recentBulkMedianUnit)} ₽`
      : `${stackability === "single" ? "поштучно" : `размер ${item.insight.comparisonAmountLabel}`} · последняя ${money(item.insight.latestSaleUnit)} ₽`;
    return `<article class="opportunity-card ${scoreClass}" data-opportunity-index="${insightIndex}" data-opportunity-id="${escapeHtml(item.insight.itemId)}" data-opportunity-region="${escapeHtml(item.insight.region)}" data-target-buy="${targetBuy}">
      <header><span class="opportunity-rank">${index + 1}</span><div><strong>${escapeHtml(item.insight.name)}${isStack ? " · сборка пачки" : ""}</strong><small>${escapeHtml(item.insight.region)} · ${escapeHtml(item.insight.itemId)} · ${escapeHtml(context)}${variant ? ` · ${escapeHtml(variant)}` : ""}</small></div><div class="opportunity-score ${scoreClass}"><strong>${item.score}</strong><span>из 100 ${helpTip(helpText.opportunityScore)}</span></div></header>
      <div class="opportunity-prices"><div><span>${isStack ? "Собрать сейчас" : "Купить сейчас"} ${helpTip(isStack ? "Средняя цена закупки всех малых лотов, необходимых для целевой пачки. Лоты берутся из последнего полного снимка рынка от дешёвых к дорогим." : "Самое дешёвое активное предложение нужного варианта. История выхода выбрана по его размерной группе.")}</span><strong>${money(item.buyPrice)} ₽/шт.</strong><small>${escapeHtml(buyNote)}</small></div><i data-lucide="chevron-right"></i><div><span>Ожидаемая продажа ${helpTip(isStack ? "Консервативная цена выхода по подтверждённым продажам крупных пачек. Она учитывает недавний уровень, тренд и разброс цены." : helpText.expectedSale)}</span><strong>${money(item.expectedSellPrice)} ₽/шт.</strong><small>${escapeHtml(sellNote)}</small></div><i data-lucide="chevron-right"></i><div><span>После расходов ${helpTip("Ожидаемая цена продажи за вычетом указанной комиссии и других расходов. Стоимость покупки вычитается уже в показателе чистой прибыли.")}</span><strong>${money(item.netSellPrice)} ₽/шт.</strong></div></div>
      <div class="opportunity-result"><div><span>Чистая прибыль / шт. ${helpTip("Ожидаемая цена после расходов минус текущая цена покупки. Это модельный результат, пока лот фактически не продан.")}</span><strong class="${roiClass}">${item.profitPerUnit >= 0 ? "+" : ""}${money(item.profitPerUnit)} ₽</strong></div><div><span>Доходность ${helpTip("Чистая прибыль, делённая на стоимость покупки. Не учитывает альтернативную стоимость замороженного капитала.")}</span><strong class="${roiClass}">${signedPercent(item.roiPercent)}</strong></div><div><span>Реализация за ${horizon} дн. ${helpTip(helpText.sellThrough)}</span><strong>${item.sellThroughPercent.toFixed(0)}%</strong><small>оценка по обороту</small></div><div><span>Уверенность ${helpTip(helpText.confidence)}</span><strong>${item.confidence}</strong><small>${item.confidencePercent.toFixed(0)}% качества данных</small></div></div>
      <footer><div class="opportunity-warnings">${item.warnings.length ? item.warnings.slice(0, 3).map((warning) => `<span><i data-lucide="triangle-alert"></i>${escapeHtml(warning)}</span>`).join("") : `<span class="clear"><i data-lucide="shield-check"></i>Критичных рисков не найдено</span>`}</div><div class="opportunity-actions"><button class="secondary deep-analysis-open"><i data-lucide="bar-chart-3"></i> Разбор</button><button class="secondary scenario-open"><i data-lucide="gauge"></i> А что если?</button><button class="secondary ai-analysis-open"><i data-lucide="sparkles"></i> ИИ-разбор</button><button class="secondary scanner-rule"><i data-lucide="plus"></i> Правило ≤ ${money(targetBuy)} ₽</button></div></footer>
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
  const fair = scenarioOpportunity.insight.fairValueUnit ?? scenarioOpportunity.insight.medianUnit;
  const fairDelta = fair && sell > 0 ? (sell - fair) / fair * 100 : undefined;
  $("#scenario-verdict").textContent = buy <= 0 || sell <= 0 ? "Введите цены покупки и продажи"
    : profit > 0 ? `Сценарий даёт ${money(profit)} ₽ после расходов`
    : profit === 0 ? "Сценарий выходит в ноль" : `Сценарий теряет ${money(Math.abs(profit))} ₽`;
  $("#scenario-break-even").textContent = breakEven == null ? "Точка безубыточности недоступна"
    : `Безубыточная продажа: ${money(breakEven)} ₽/шт.${fairDelta == null ? "" : ` · ваша цена ${signedPercent(fairDelta)} к адаптивной цене`}`;
}

function aiList(title: string, values: string[], tone = "") {
  if (!values.length) return "";
  return `<section class="ai-list ${tone}"><h3>${escapeHtml(title)}</h3><ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul></section>`;
}

function aiActionCategory(action: string): RecommendationAction | undefined {
  const value = action.toLocaleLowerCase("ru");
  if (/недостаточно|неопредел/.test(value)) return undefined;
  if (/не покупать|ждать|наблюдать|воздерж/.test(value)) return "wait";
  if (/продав/.test(value)) return "sell";
  if (/держать|удерживать|придерж/.test(value)) return "hold";
  if (/покуп|входить|брать/.test(value)) return "buy";
  return undefined;
}

function renderAiAnalysis(analysis: AiMarketAnalysis, opportunity: MarketOpportunity) {
  const program = recommendationFor(opportunity.insight);
  const aiAction = aiActionCategory(analysis.action);
  const comparable = aiAction != null;
  const agrees = comparable && aiAction === program.action;
  const comparison = !comparable ? "Вывод ИИ сформулирован неоднозначно"
    : agrees ? "Независимые выводы совпали" : "Выводы расходятся — проверьте аргументы";
  $("#ai-analysis-content").innerHTML = `
    <section class="ai-verdict"><div><span>Вывод модели</span><strong>${escapeHtml(analysis.action)}</strong></div><p>${escapeHtml(analysis.summary)}</p></section>
    <section class="ai-comparison ${comparable ? (agrees ? "agree" : "disagree") : "unclear"}"><div><span>Алгоритм программы</span><strong>${escapeHtml(program.title)}</strong><small>${escapeHtml(program.summary)}</small></div><div><span>Независимый ИИ-аудитор</span><strong>${escapeHtml(analysis.action)}</strong><small>${escapeHtml(comparison)}</small></div></section>
    <section class="ai-scenario"><span>Основной сценарий</span><p>${escapeHtml(analysis.mainScenario)}</p></section>
    <div class="ai-columns">${aiList("Что поддерживает идею", analysis.argumentsFor, "positive")}${aiList("Что может помешать", analysis.argumentsAgainst, "negative")}</div>
    <div class="ai-columns">${aiList("Условия входа", analysis.entryConditions)}${aiList("Когда отказаться", analysis.cancellationConditions, "negative")}</div>
    ${aiList("Каких данных не хватает", analysis.missingData, "muted")}
    <p class="ai-disclaimer">ИИ не видел рекомендацию, целевые зоны, рейтинг возможности, ожидаемую продажу или ROI программы. Совпадение выводов не является гарантией сделки.</p>`;
}

function aiContext(opportunity: MarketOpportunity, deep?: MarketDeepAnalysis) {
  const insight = opportunity.insight;
  return {
    task: "Независимо оценить покупку сейчас и дальнейшее действие, сформулировать условия входа и опровержения идеи",
    contextPolicy: "Рекомендация, рейтинг, целевая зона, ожидаемая цена продажи и ROI алгоритма приложения намеренно не переданы",
    item: {
      name: insight.name, itemId: insight.itemId, region: insight.region,
      variant: insightVariantLabel(insight) || "без варианта",
      stackability: stackabilityFor(insight), comparisonAmount: insight.comparisonAmountLabel,
    },
    userConstraints: {
      feePercent: Math.max(0, numberValue("scanner-fee") ?? 0),
      horizonDays: Number($<HTMLSelectElement>("#scanner-horizon").value),
    },
    activeMarket: {
      activeLots: insight.activeLots, currentMinUnit: insight.currentMinUnit,
      currentMinAmount: insight.currentMinAmount,
      currentMedianUnit: deep?.currentMedianUnit,
      currentUnits: deep?.currentUnits,
      supplyChangePercent: insight.movementSupplyChangePercent,
      collectionCoveragePercent: insight.movementCoveragePercent, collections: insight.movementCollections,
      depth: deep?.depth,
    },
    confirmedSales: {
      totalSample: insight.salesSample, recent24hSample: insight.recentSalesSample,
      latestSaleUnit: insight.latestSaleUnit, latestSaleAt: insight.latestSaleAt,
      recentMedianUnit: insight.recentMedianUnit,
      longMedianUnit: insight.medianUnit, p25Unit: insight.recentP25Unit, p75Unit: insight.recentP75Unit,
      trendPercent24hVsPrevious24h: insight.trendPercent, volatilityPercent: insight.volatilityPercent,
      salesPerDay: insight.salesPerDay, averageSaleIntervalMinutes: insight.averageSaleIntervalMinutes,
      priceWindows: deep?.windows,
      stackSegments: stackabilityFor(insight) === "stackable" ? deep?.stackSegments : undefined,
    },
    dataQuality: {
      totalCollections: deep?.collections ?? insight.movementCollections,
      completeCollections: deep?.completeCollections,
      collectionCoveragePercent: insight.movementCoveragePercent,
      recentSalesSample: insight.recentSalesSample,
    },
  };
}

async function runAiAnalysis() {
  if (!aiOpportunity) return;
  const endpoint = value("ai-endpoint");
  const model = value("ai-model");
  localStorage.setItem("stalzone-ai-endpoint", endpoint);
  localStorage.setItem("stalzone-ai-model", model);
  const button = $<HTMLButtonElement>("#ai-analyze");
  button.disabled = true;
  button.classList.add("busy");
  $("#ai-analysis-content").innerHTML = `<div class="timing-loading"><span></span>Модель изучает факты и проверяет сценарии</div>`;
  try {
    let deep: MarketDeepAnalysis | undefined;
    try {
      deep = await invoke<MarketDeepAnalysis>("market_deep_analysis", {
        rule: analysisRuleForInsight(aiOpportunity.insight),
        feePercent: Math.max(0, numberValue("scanner-fee") ?? 0),
      });
    } catch {
      // The independent review can still run on the compact market insight.
    }
    const analysis = await invoke<AiMarketAnalysis>("ai_market_analysis", {
      endpoint, model, apiKey: value("ai-api-key") || null, context: aiContext(aiOpportunity, deep),
    });
    renderAiAnalysis(analysis, aiOpportunity);
  } catch (error) {
    $("#ai-analysis-content").innerHTML = `<div class="ai-error"><i data-lucide="triangle-alert"></i><div><strong>Не удалось получить ИИ-разбор</strong><p>${escapeHtml(String(error))}</p><small>Проверьте адрес, имя модели и API key. Для Ollama также убедитесь, что сервис запущен.</small></div></div>`;
  } finally {
    button.disabled = false;
    button.classList.remove("busy");
    createIcons({ icons: appIcons });
  }
}

function openAiAnalysis(opportunity: MarketOpportunity) {
  aiOpportunity = opportunity;
  input("ai-endpoint").value = localStorage.getItem("stalzone-ai-endpoint") || "http://127.0.0.1:11434/api/chat";
  input("ai-model").value = localStorage.getItem("stalzone-ai-model") || "gemma3:4b";
  input("ai-api-key").value = "";
  $("#ai-analysis-title").textContent = `${opportunity.insight.name} · ИИ-разбор`;
  $("#ai-analysis-content").innerHTML = `<div class="timing-empty"><i data-lucide="sparkles"></i><strong>ИИ-разбор не запускается автоматически</strong><span>Проверьте настройки и нажмите «Анализировать». Без этого приложение работает как обычно.</span></div>`;
  $<HTMLDialogElement>("#ai-analysis-dialog").showModal();
  createIcons({ icons: appIcons });
}

function stackStrategyMarkup(strategy: StackStrategyAnalysis) {
  const profitClass = (strategy.profit ?? 0) >= 0 ? "positive" : "negative";
  return `<div class="stack-strategy-flow"><div><span>Закупка</span><strong>${strategy.purchaseLots} лотов · ${strategy.acquiredAmount} шт.</strong><small>средняя ${money(strategy.averageBuyUnit)} ₽ · всего ${money(strategy.totalCost)} ₽</small></div><i data-lucide="chevron-right"></i><div><span>Продажа пачкой</span><strong>${money(strategy.expectedSellUnit)} ₽/шт.</strong><small>медиана крупных продаж ${money(strategy.recentBulkMedianUnit)} ₽ · ${strategy.bulkSalesSample} сделок</small></div><i data-lucide="chevron-right"></i><div><span>После расходов</span><strong class="${profitClass}">${(strategy.profit ?? 0) >= 0 ? "+" : ""}${money(strategy.profit)} ₽</strong><small>ROI ${signedPercent(strategy.roiPercent)}</small></div></div><div class="stack-strategy-meta"><span>Доступно: ${strategy.availableLots} лотов / ${strategy.availableUnits} шт.</span><span>Точка безубыточности закупки: ${money(strategy.breakEvenBuyUnit)} ₽/шт.</span><span class="${strategy.complete ? "positive" : "negative"}">${strategy.complete ? "Пачку можно собрать сейчас" : "Товара для цели недостаточно"}</span></div>${strategy.warnings.length ? `<div class="opportunity-warnings">${strategy.warnings.map((warning) => `<span><i data-lucide="triangle-alert"></i>${escapeHtml(warning)}</span>`).join("")}</div>` : ""}`;
}

function renderStackStrategy(strategy: StackStrategyAnalysis) {
  $("#stack-strategy-result").innerHTML = stackStrategyMarkup(strategy);
  createIcons({ icons: appIcons });
}

async function loadStackStrategy() {
  if (!scenarioOpportunity) return;
  const button = $("#stack-strategy-calculate");
  button.classList.add("busy");
  $("#stack-strategy-result").innerHTML = `<div class="timing-loading"><span></span>Считаю сборку пачки</div>`;
  try {
    const strategy = await invoke<StackStrategyAnalysis>("stack_strategy_analysis", {
      rule: analysisRuleForInsight(scenarioOpportunity.insight),
      buyMaxAmount: Math.floor(numberValue("stack-buy-max-amount") ?? 9),
      sellMinAmount: Math.floor(numberValue("stack-sell-min-amount") ?? 20),
      targetAmount: Math.floor(numberValue("stack-target-amount") ?? 20),
      feePercent: numberValue("scenario-fee") ?? 0,
      maxBuyUnit: numberValue("stack-max-buy-unit") ?? null,
    });
    renderStackStrategy(strategy);
  } catch (error) {
    $("#stack-strategy-result").innerHTML = `<div class="timing-empty"><i data-lucide="triangle-alert"></i><strong>Не удалось рассчитать сборку</strong><span>${escapeHtml(String(error))}</span></div>`;
    createIcons({ icons: appIcons });
  } finally { button.classList.remove("busy"); }
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
  const stackable = supportsStackStrategy(insight);
  $("#stack-strategy-section").classList.toggle("hidden", !stackable);
  $("#scenario-name").textContent = insight.name;
  $("#scenario-context").textContent = `${insight.region} · ${insight.itemId}${insightVariantLabel(insight) ? ` · ${insightVariantLabel(insight)}` : ""}`;
  $("#scenario-latest-sale").textContent = `${money(insight.latestSaleUnit)} ₽`;
  $("#scenario-latest-time").textContent = insight.latestSaleAt ? new Date(insight.latestSaleAt).toLocaleString("ru-RU") : "нет времени продажи";
  $("#scenario-recent-median").textContent = `${money(insight.recentMedianUnit)} ₽`;
  $("#scenario-recent-sample").textContent = `${insight.recentSalesSample} продаж`;
  $("#scenario-fair-value").textContent = `${money(insight.fairValueUnit ?? insight.medianUnit)} ₽`;
  $("#scenario-long-median").textContent = `${money(insight.medianUnit)} ₽`;
  input("scenario-buy").value = String(Math.round(opportunity.buyPrice));
  input("scenario-sell").value = String(Math.round(opportunity.expectedSellPrice));
  input("scenario-amount").value = String(opportunity.purchaseAmount);
  input("scenario-fee").value = String(numberValue("scanner-fee") ?? 0);
  input("stack-buy-max-amount").value = String(opportunity.stackStrategy?.buyMaxAmount ?? 9);
  input("stack-sell-min-amount").value = String(opportunity.stackStrategy?.sellMinAmount ?? 20);
  input("stack-target-amount").value = String(opportunity.stackStrategy?.targetAmount ?? 20);
  input("stack-max-buy-unit").value = "";
  renderScenarioCalculation();
  $("#timing-sample").textContent = "Загрузка...";
  $("#timing-content").innerHTML = `<div class="timing-loading"><span></span>Анализирую время наблюдений</div>`;
  $<HTMLDialogElement>("#scenario-dialog").showModal();
  if (stackable) void loadStackStrategy();
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

function renderDeepAnalysis(analysis: MarketDeepAnalysis, stackStrategy?: StackStrategyAnalysis) {
  const maxDepth = Math.max(1, ...analysis.depth.map((level) => level.units));
  const coverage = analysis.collections ? `${(analysis.completeCollections / analysis.collections * 100).toFixed(0)}%` : "—";
  const windows = analysis.windows.map((window) => `<tr><td>${window.hours} ч.</td><td>${window.sales.toLocaleString("ru-RU")}</td><td>${window.units.toLocaleString("ru-RU")}</td><td>${money(window.p25Unit)} ₽</td><td><strong>${money(window.medianUnit)} ₽</strong></td><td>${money(window.p75Unit)} ₽</td></tr>`).join("");
  const stacks = analysis.stackSegments.map((segment) => `<tr><td>${escapeHtml(segment.label)}</td><td>${segment.sales.toLocaleString("ru-RU")}</td><td>${segment.units.toLocaleString("ru-RU")}</td><td><strong>${money(segment.medianUnit)} ₽</strong></td></tr>`).join("");
  const depth = analysis.depth.map((level) => `<div class="deep-depth-row"><div><strong>≤ ${money(level.price)} ₽</strong><small>${level.lots} лотов · ${level.units.toLocaleString("ru-RU")} шт.</small></div><span><i style="width:${Math.max(2, level.units / maxDepth * 100)}%"></i></span></div>`).join("");
  $("#deep-analysis-content").innerHTML = `
    <section class="deep-summary"><div><span>Продаж в выборке</span><strong>${analysis.totalSales.toLocaleString("ru-RU")}</strong><small>${analysis.soldUnits.toLocaleString("ru-RU")} единиц</small></div><div><span>Период данных</span><strong>${formatInterval(analysis.historyHours * 60)}</strong><small>до 30 дней, максимум 20 000 строк</small></div><div><span>Текущее предложение</span><strong>${analysis.currentSupply.toLocaleString("ru-RU")}</strong><small>${analysis.currentUnits.toLocaleString("ru-RU")} единиц</small></div><div><span>Полнота снимков</span><strong>${coverage}</strong><small>${analysis.completeCollections} из ${analysis.collections}</small></div></section>
    <section class="deep-insights">${analysis.insights.map((insight) => `<div><i data-lucide="sparkles"></i><span>${escapeHtml(insight)}</span></div>`).join("") || `<div><span>Недостаточно данных для устойчивых выводов</span></div>`}</section>
    <section class="deep-targets"><div><span>Консервативная продажа</span><strong>${money(analysis.expectedSellUnit)} ₽/шт.</strong></div><div><span>Покупка для 5% ROI</span><strong>${money(analysis.buyForFivePercent)} ₽/шт.</strong></div><div><span>Покупка для 10% ROI</span><strong>${money(analysis.buyForTenPercent)} ₽/шт.</strong></div><div><span>Предложение за 24ч</span><strong class="${(analysis.supplyChangePercent ?? 0) > 0 ? "negative" : "positive"}">${signedPercent(analysis.supplyChangePercent)}</strong></div></section>
    <section class="deep-grid${stackStrategy ? "" : " single"}"><div class="deep-table"><header><div><span class="eyebrow">Исполненные сделки</span><h3>Динамика цены</h3></div><small>P25 · медиана · P75</small></header><div><table><thead><tr><th>Окно</th><th>Сделок</th><th>Единиц</th><th>P25</th><th>Медиана</th><th>P75</th></tr></thead><tbody>${windows}</tbody></table></div></div>${stackStrategy ? `<div class="deep-table"><header><div><span class="eyebrow">Последние 24 часа</span><h3>Размер пачки</h3></div><small>Цена за штуку</small></header><div><table><thead><tr><th>Количество</th><th>Сделок</th><th>Единиц</th><th>Медиана</th></tr></thead><tbody>${stacks}</tbody></table></div></div>` : ""}</section>
    <section class="deep-depth"><header><div><span class="eyebrow">Последний полный снимок</span><h3>Глубина предложения</h3></div><small>Минимум ${money(analysis.currentMinUnit)} ₽ · медиана ${money(analysis.currentMedianUnit)} ₽</small></header><div>${depth || "Нет активных предложений по условиям правила"}</div></section>${stackStrategy ? `<section class="deep-stack-strategy"><header><div><span class="eyebrow">Премия за размер</span><h3>Сборка пачки ${stackStrategy.targetAmount} шт.</h3></div><small>покупаем лоты до ${stackStrategy.buyMaxAmount} · сравниваем с продажами от ${stackStrategy.sellMinAmount}</small></header>${stackStrategyMarkup(stackStrategy)}</section>` : ""}`;
  createIcons({ icons: appIcons });
}

async function openDeepAnalysis(opportunity: MarketOpportunity) {
  const insight = opportunity.insight;
  $("#deep-analysis-title").textContent = `${insight.name} · разбор рынка`;
  $("#deep-analysis-content").innerHTML = `<div class="timing-loading"><span></span>Считаю структуру рынка</div>`;
  $<HTMLDialogElement>("#deep-analysis-dialog").showModal();
  const rule = analysisRuleForInsight(insight);
  try {
    const feePercent = numberValue("scanner-fee") ?? 0;
    const stackable = supportsStackStrategy(insight);
    const [analysis, stackStrategy] = await Promise.all([
      invoke<MarketDeepAnalysis>("market_deep_analysis", { rule, feePercent }),
      stackable ? invoke<StackStrategyAnalysis>("stack_strategy_analysis", { rule, buyMaxAmount: 9, sellMinAmount: 20, targetAmount: 20, feePercent, maxBuyUnit: null }) : Promise.resolve(undefined),
    ]);
    renderDeepAnalysis(analysis, stackStrategy);
  } catch (error) {
    $("#deep-analysis-content").innerHTML = `<div class="timing-empty"><i data-lucide="triangle-alert"></i><strong>Не удалось построить разбор</strong><span>${escapeHtml(String(error))}</span></div>`;
    createIcons({ icons: appIcons });
  }
}

async function loadScanner() {
  if (!rules.length) { toast("Для советника нужно хотя бы одно активное правило", true); return; }
  $("#scanner-load").classList.add("busy");
  await loadAnalytics();
  $("#scanner-load").classList.remove("busy");
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

function movementSignalHelp(signal: string) {
  if (signal.includes("Дефицит")) return "Активных лотов стало минимум на 10% меньше, а медиана предложений выросла минимум на 5%. Для владельца это благоприятно; покупателю важно проверить, растёт ли также красная линия продаж.";
  if (signal.includes("Перенасыщение")) return "Активных лотов стало минимум на 15% больше, а медиана предложений упала минимум на 5%. Продавцы конкурируют, поэтому покупателю часто выгоднее дождаться стабилизации.";
  if (signal.includes("исчезают")) return "За период исчезло больше лотов, чем появилось, и медиана предложений выросла. Это может означать спрос, но исчезновение без сопоставленной продажи не является доказанной сделкой.";
  if (signal.includes("больше данных")) return "Есть меньше двух снимков рынка. Изменение предложения и цены пока невозможно оценить надёжно.";
  return "Ни одно сильное условие дефицита или перенасыщения не выполнено. Это не означает, что цена совершенно неподвижна.";
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
  if (market.salePoints.length) {
    const sales = movementChart.addSeries(LineSeries, {
      color: "#ef7169", lineWidth: 2, priceScaleId: "right", pointMarkersVisible: market.salePoints.length < 120,
      priceLineVisible: false, priceFormat: { type: "custom", formatter: (value: number) => `${money(value)} ₽` },
    });
    sales.setData(market.salePoints.map((point) => ({ time: point.time as UTCTimestamp, value: point.medianUnit })));
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
    <header class="movement-detail-head"><div><span class="rule-region">${escapeHtml(market.region)}</span><div><h3>${escapeHtml(movementItemName(market.itemId))}</h3><small>${escapeHtml(market.itemId)} · последнее наблюдение ${escapeHtml(new Date(market.lastCollected).toLocaleString("ru-RU"))}</small></div></div><div class="movement-status-wrap"><span class="movement-signal ${signalClass}">${escapeHtml(market.signal)}</span>${helpTip(movementSignalHelp(market.signal), `Что означает статус ${market.signal}`)}</div></header>
    <div class="movement-metrics"><div><span>Предложение ${helpTip(helpText.supply)}</span><strong>${market.currentSupply.toLocaleString("ru-RU")}</strong><small class="${(market.supplyChangePercent ?? 0) > 0 ? "negative" : "positive"}">${signedPercent(market.supplyChangePercent)}</small></div><div><span>Медиана / шт. ${helpTip(helpText.askMedian)}</span><strong>${money(market.currentMedianUnit)} ₽</strong><small class="${(market.priceChangePercent ?? 0) > 0 ? "positive" : "negative"}">${signedPercent(market.priceChangePercent)}</small></div><div><span>Минимум / шт. ${helpTip(helpText.askMinimum)}</span><strong>${money(market.currentMinUnit)} ₽</strong><small>${market.collections} проходов</small></div><div><span>Среднее время жизни ${helpTip(helpText.lifetime)}</span><strong>${formatInterval(market.averageLifetimeMinutes)}</strong><small>исчезнувшие и завершённые</small></div></div>
    <div class="movement-quality"><div><span>Продаж в истории ${helpTip(helpText.recordedSales)}</span><strong>${market.recordedSales.toLocaleString("ru-RU")}</strong><small>STALZONE ${market.stalzoneSales.toLocaleString("ru-RU")} · SCHistory ${market.schistorySales.toLocaleString("ru-RU")}</small></div><div><span>Вероятно сопоставлено ${helpTip(helpText.probableSales)}</span><strong>${market.probableSales.toLocaleString("ru-RU")}</strong></div><div><span>Необъяснённо исчезло ${helpTip(helpText.missing)}</span><strong>${market.unexplainedMissing.toLocaleString("ru-RU")}</strong></div><div><span>Полнота обходов ${helpTip(helpText.coverage)}</span><strong>${market.coveragePercent.toFixed(0)}%</strong></div></div>
    <div class="movement-chart-head"><div><span><i class="supply"></i>Предложение</span><span><i class="price"></i>Медиана предложений</span><span><i class="sales"></i>Медиана продаж</span></div><small>Полнота снимков ${market.coveragePercent.toFixed(0)}% ${helpTip(helpText.coverage)}</small></div>
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
    return `<button class="movement-market${key === selectedMovementKey ? " active" : ""}" data-item-id="${escapeHtml(market.itemId)}" data-region="${escapeHtml(market.region)}"><div><span class="rule-region">${escapeHtml(market.region)}</span><strong>${escapeHtml(movementItemName(market.itemId))}</strong></div><small>${market.currentSupply.toLocaleString("ru-RU")} лотов · ${market.recordedSales.toLocaleString("ru-RU")} продаж · медиана ${money(market.currentMedianUnit)} ₽</small><span class="movement-signal ${movementSignalClass(market.signal)}">${escapeHtml(market.signal)}</span></button>`;
  }).join("") || `<div class="movement-empty">${movementMarkets.length ? "Ничего не найдено" : "Нет данных за выбранный период"}</div>`;
  renderMovementDetail(visibleMarkets.find((market) => movementKey(market) === selectedMovementKey));
}

function applyMovementAmountPreset() {
  const preset = $<HTMLSelectElement>("#movement-amount-preset").value;
  const ranges: Record<string, [string, string]> = {
    all: ["", ""], "1": ["1", "1"], "2-4": ["2", "4"], "5-9": ["5", "9"],
    "10-19": ["10", "19"], "20-49": ["20", "49"], "50+": ["50", ""],
  };
  const range = ranges[preset];
  if (range) {
    input("movement-min-amount").value = range[0];
    input("movement-max-amount").value = range[1];
  }
}

async function loadMovement() {
  const qualities = [...document.querySelectorAll<HTMLInputElement>("#movement-quality-options input:checked")].map((checkbox) => checkbox.value);
  const minUpgrade = numberValue("movement-min-upgrade");
  const maxUpgrade = numberValue("movement-max-upgrade");
  const minAmount = numberValue("movement-min-amount");
  const maxAmount = numberValue("movement-max-amount");
  if (minUpgrade != null && maxUpgrade != null && minUpgrade > maxUpgrade) {
    toast("Минимальная заточка не может быть больше максимальной", true);
    return;
  }
  if (minAmount != null && maxAmount != null && minAmount > maxAmount) {
    toast("Минимальное количество не может быть больше максимального", true);
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
      minAmount: minAmount ?? null,
      maxAmount: maxAmount ?? null,
    });
    movementMarkets = response.markets;
    const qualityLabels = qualities.map((value) => artifactQualities.find((quality) => quality.value === value)?.label).filter(Boolean);
    const variant = [...qualityLabels, describeRange("заточка", minUpgrade, maxUpgrade, "+"), describeRange("лот", minAmount, maxAmount)].filter(Boolean).join(", ");
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
  input("rapid-monitor").checked = Boolean(rule?.rapidMonitor);
  input("rapid-interval").value = String(rule?.rapidIntervalSeconds || 5);
  renderRuleScope();
  const fields: [string, string | number | undefined][] = [
    ["rule-name", rule?.name], ["item-id", rule?.itemId], ["max-buyout", rule?.maxBuyout], ["max-unit", rule?.maxUnitBuyout], ["min-amount", rule?.minAmount], ["max-amount", rule?.maxAmount],
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
  renderRapidRuleControls();
  $("#upsert").innerHTML = `<i data-lucide="${rule ? "save" : "check"}"></i> ${rule ? "Сохранить изменения" : "Добавить правило"}`;
  createIcons({ icons: appIcons });
}

async function persistRules(showToast = true) {
  const region = $<HTMLSelectElement>("#region").value;
  const path = await invoke<string>("save_rules", { payload: { defaults: { region, limit: 50, sort: "time_created", order: "desc", additional: true }, items: rules } });
  if (showToast) toast("Правила сохранены");
  log(`Конфигурация сохранена: ${path}`);
  if (monitorTimer != null) resetRapidSchedule();
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

function rapidRuleKey(rule: Rule, index: number) {
  return `${index}|${rule.region}|${rule.itemId}|${rule.category || ""}|${rule.name}`;
}

function rapidRulesExpandedCount() {
  return expandedRules(rules.filter((rule) => rule.rapidMonitor)).length;
}

async function runRapidCheck(baseline = false) {
  if (baseline) rapidBaselinePending = true;
  if (rapidChecking || rapidBackoffUntil > Date.now()) return;
  baseline = baseline || rapidBaselinePending;
  const enabled = rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => rule.rapidMonitor);
  if (!enabled.length) return;
  const now = Date.now();
  const due = baseline ? enabled : enabled.filter(({ rule, index }) => (rapidNextDue.get(rapidRuleKey(rule, index)) ?? 0) <= now);
  if (!due.length) return;
  due.forEach(({ rule, index }) => rapidNextDue.set(rapidRuleKey(rule, index), now + Math.max(3, Math.min(10, rule.rapidIntervalSeconds || 5)) * 1000));
  rapidChecking = true;
  try {
    const rapidRules = expandedRules(due.map(({ rule }) => rule));
    const result = await invoke<RapidCheckResult>("rapid_check_rules", { rules: rapidRules, baseline });
    if (baseline) rapidBaselinePending = false;
    if (result.throttled) {
      rapidBackoffUntil = Math.max(Date.now() + 3_000, (result.rateResetAt || 0) + 250);
      log(`Оперативный мониторинг ждёт лимит API до ${new Date(rapidBackoffUntil).toLocaleTimeString("ru-RU")}`);
    }
    result.errors.forEach((error) => log(`Оперативный мониторинг: ${error}`, true));
    if (result.matches.length) {
      const combined = [...result.matches, ...matches];
      matches = combined.filter((match, index) => combined.findIndex((candidate) =>
        candidate.itemId === match.itemId && candidate.region === match.region &&
        candidate.end === match.end && candidate.buyout === match.buyout && candidate.amount === match.amount
      ) === index).slice(0, 100);
      renderMatches();
      result.matches.forEach((match) => { void desktopNotify(match); });
      toast(`Оперативно найдено лотов: ${result.matches.length}`);
      log(`Оперативно: новых лотов ${result.newLots}, совпадений ${result.matches.length}`);
    }
    const rate = result.rateRemaining == null ? "" : ` · API ${result.rateRemaining}/${result.rateLimit ?? "—"}`;
    $("#overview-mode").textContent = `обычный сбор + оперативный поиск${rate}`;
    if (baseline) log(`Оперативный мониторинг подготовлен: ${result.checkedRules} рынков, текущие лоты приняты за базу`);
  } catch (error) {
    log(`Оперативный мониторинг: ${String(error)}`, true);
    rapidBackoffUntil = Date.now() + 5_000;
  } finally {
    rapidChecking = false;
    if (rapidBaselinePending) window.setTimeout(() => void runRapidCheck(true), 0);
  }
}

function resetRapidSchedule() {
  rapidNextDue.clear();
  rapidBackoffUntil = 0;
  const rapidMarkets = rapidRulesExpandedCount();
  if (monitorTimer == null || !rapidMarkets) {
    if (rapidMonitorTimer != null) clearInterval(rapidMonitorTimer);
    rapidMonitorTimer = undefined;
    return;
  }
  if (rapidMonitorTimer == null) rapidMonitorTimer = window.setInterval(() => void runRapidCheck(), 500);
  void runRapidCheck(true);
}

function toggleMonitor() {
  const button = $("#monitor-toggle");
  if (monitorTimer != null) {
    clearInterval(monitorTimer); monitorTimer = undefined;
    if (rapidMonitorTimer != null) clearInterval(rapidMonitorTimer);
    rapidMonitorTimer = undefined;
    rapidNextDue.clear();
    rapidBackoffUntil = 0;
    rapidBaselinePending = false;
    nextCheckAt = undefined;
    $("#pulse").classList.remove("active"); $("#monitor-label").textContent = "Остановлен";
    $("#overview-mode").textContent = "мониторинг выключен";
    button.innerHTML = `<i data-lucide="play"></i> Запустить`; log("Мониторинг остановлен");
  } else {
    const rapidMarkets = rapidRulesExpandedCount();
    if (rapidMarkets > 15) { toast(`В оперативном мониторинге ${rapidMarkets} предметов. Оставьте не более 15.`, true); return; }
    const minimum = rules.some((rule) => rule.scope === "category") ? 300 : 10;
    const seconds = Math.max(minimum, numberValue("interval") || 60);
    input("interval").value = String(seconds);
    void runCheck();
    monitorTimer = window.setInterval(() => void runCheck(), seconds * 1000);
    if (rapidMarkets) {
      void runRapidCheck(true);
      rapidMonitorTimer = window.setInterval(() => void runRapidCheck(), 500);
    }
    nextCheckAt = Date.now() + seconds * 1000;
    $("#pulse").classList.add("active"); $("#monitor-label").textContent = `Активен · ${seconds} сек`;
    $("#overview-mode").textContent = rapidMarkets ? `полный сбор ${seconds} сек · оперативно 3–10 сек` : `автоматически каждые ${seconds} сек`;
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
input("rapid-monitor").addEventListener("change", renderRapidRuleControls);
input("rapid-interval").addEventListener("input", renderRapidRuleControls);
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
    automaticStackStrategies.clear();
    if (editingIndex != null) rules[editingIndex] = rule;
    else { const duplicate = rules.findIndex((entry) => ruleTargetLabel(entry) === ruleTargetLabel(rule) && entry.region === rule.region); if (duplicate >= 0) rules[duplicate] = rule; else rules.push(rule); }
    editingIndex = undefined; setForm(); renderRules(); void persistRules(false); toast("Правило добавлено");
  } catch (error) { toast(String(error), true); }
});
$("#rules-list").addEventListener("click", (event) => {
  const row = (event.target as HTMLElement).closest<HTMLElement>("[data-index]"); if (!row) return;
  const index = Number(row.dataset.index);
  if ((event.target as HTMLElement).closest(".delete-rule")) { const removed = rules[index]; const removedIds = new Set(removed.itemIds || [removed.itemId]); rules.splice(index, 1); ruleSummaries = ruleSummaries.filter((summary) => !(removedIds.has(summary.itemId) && summary.region === removed.region)); analyticsInsights = []; scannerInsights = []; automaticStackStrategies.clear(); editingIndex = undefined; renderRules(); renderAnalytics(); renderScanner(); void persistRules(false); return; }
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
  if (view === "history" && selected && historyItem?.id !== selected.id) openHistory(selected);
  else if (view === "analytics") switchAdvisorSection("decisions");
  else switchView(view);
  if (view === "analytics" && !analyticsInsights.length && rules.length) void loadAnalytics();
  if (view === "movement" && !movementMarkets.length) void loadMovement();
});
document.querySelectorAll<HTMLElement>(".advisor-tabs").forEach((navigation) => navigation.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-advisor]");
  if (!button) return;
  switchAdvisorSection(button.dataset.advisor as AdvisorSection);
  if (!analyticsInsights.length && rules.length) void loadAnalytics();
}));
$("#market-rules").addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("[data-open-config]")) { switchView("config"); return; }
  const row = (event.target as HTMLElement).closest<HTMLElement>("[data-market-rule]");
  if (!row) return;
  if ((event.target as HTMLElement).closest(".market-lots")) {
    void toggleActiveLots(row, Number(row.dataset.marketRule));
    return;
  }
  if (!(event.target as HTMLElement).closest(".market-edit")) return;
  editingIndex = Number(row.dataset.marketRule); setForm(rules[editingIndex]); renderRules(); switchView("config");
});
$("#clear-matches").addEventListener("click", () => { matches = []; renderMatches(); });
$("#matches").addEventListener("click", (event) => { const row = (event.target as HTMLElement).closest<HTMLElement>("[data-match]"); if (!row) return; $("#details-content").textContent = matches[Number(row.dataset.match)].message; $<HTMLDialogElement>("#details-dialog").showModal(); });
$("#history-load").addEventListener("click", () => void loadSalesHistory());
$("#history-import-schistory").addEventListener("click", () => void importSchistoryHistory());
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
["scanner-min-roi", "scanner-search"].forEach((id) => input(id).addEventListener("input", renderScanner));
input("scanner-fee").addEventListener("input", () => { renderScanner(); renderAnalytics(); });
$("#scanner-list").addEventListener("click", (event) => {
  const card = (event.target as HTMLElement).closest<HTMLElement>("[data-opportunity-id]");
  if (!card) return;
  if ((event.target as HTMLElement).closest(".deep-analysis-open")) {
    const insight = scannerInsights[Number(card.dataset.opportunityIndex)];
    const opportunity = insight && opportunityFor(insight, Math.max(0, numberValue("scanner-fee") ?? 0), Number($<HTMLSelectElement>("#scanner-horizon").value));
    if (opportunity) void openDeepAnalysis(opportunity);
    return;
  }
  if ((event.target as HTMLElement).closest(".scenario-open")) {
    const insight = scannerInsights[Number(card.dataset.opportunityIndex)];
    const opportunity = insight && opportunityFor(insight, Math.max(0, numberValue("scanner-fee") ?? 0), Number($<HTMLSelectElement>("#scanner-horizon").value));
    if (opportunity) void openScenario(opportunity);
    return;
  }
  if ((event.target as HTMLElement).closest(".ai-analysis-open")) {
    const insight = scannerInsights[Number(card.dataset.opportunityIndex)];
    const opportunity = insight && opportunityFor(insight, Math.max(0, numberValue("scanner-fee") ?? 0), Number($<HTMLSelectElement>("#scanner-horizon").value));
    if (opportunity) openAiAnalysis(opportunity);
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
$("#ai-analyze").addEventListener("click", () => void runAiAnalysis());
["scenario-buy", "scenario-sell", "scenario-amount", "scenario-fee"].forEach((id) => input(id).addEventListener("input", renderScenarioCalculation));
$("#stack-strategy-calculate").addEventListener("click", () => void loadStackStrategy());
["stack-buy-max-amount", "stack-sell-min-amount", "stack-target-amount", "stack-max-buy-unit"].forEach((id) => input(id).addEventListener("change", () => void loadStackStrategy()));
input("scenario-fee").addEventListener("change", () => void loadStackStrategy());
$("#movement-load").addEventListener("click", () => void loadMovement());
["movement-hours", "movement-region"].forEach((id) => $<HTMLSelectElement>(`#${id}`).addEventListener("change", () => void loadMovement()));
$("#movement-quality-options").addEventListener("change", () => void loadMovement());
["movement-min-upgrade", "movement-max-upgrade"].forEach((id) => input(id).addEventListener("change", () => void loadMovement()));
$<HTMLSelectElement>("#movement-amount-preset").addEventListener("change", () => { applyMovementAmountPreset(); void loadMovement(); });
["movement-min-amount", "movement-max-amount"].forEach((id) => input(id).addEventListener("change", () => {
  $<HTMLSelectElement>("#movement-amount-preset").value = "custom";
  void loadMovement();
}));
$("#movement-reset-variant").addEventListener("click", () => {
  document.querySelectorAll<HTMLInputElement>("#movement-quality-options input").forEach((checkbox) => checkbox.checked = false);
  input("movement-min-upgrade").value = "";
  input("movement-max-upgrade").value = "";
  $<HTMLSelectElement>("#movement-amount-preset").value = "all";
  applyMovementAmountPreset();
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
  const card = (event.target as HTMLElement).closest<HTMLElement>("[data-recommendation-id]");
  if (!card) return;
  if ((event.target as HTMLElement).closest(".recommendation-metrics")) {
    switchAdvisorSection("metrics");
    return;
  }
  const button = (event.target as HTMLElement).closest(".recommendation-rule");
  if (!button) return;
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
