/**
 * 量化交易系统类型定义
 * 基于 VeighNa/TradeMaster 最佳实践设计
 */

// ==================== 基础数据类型 ====================

/** K线数据 */
export interface KBar {
  code: string;       // 股票代码，如 '000001.SZ'
  timestamp: number;  // 时间戳 (毫秒)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;      // 成交量
  amount: number;      // 成交额
}

/** 分时数据 */
export interface TickData {
  code: string;
  timestamp: number;
  lastPrice: number;
  volume: number;
  amount: number;
  bidPrice1: number;
  askPrice1: number;
  bidVol1: number;
  askVol1: number;
}

/** 订单方向 */
export type Direction = 'long' | 'short';

/** 订单类型 */
export type OrderType = 'market' | 'limit';

/** 订单状态 */
export type OrderStatus = 'pending' | 'filled' | 'partial' | 'cancelled' | 'rejected';

/** 订单 */
export interface Order {
  id: string;
  code: string;
  direction: Direction;
  type: OrderType;
  price: number;       // 限价单价格，市价单为0
  volume: number;       // 订单数量
  filledVolume: number;// 已成交数量
  status: OrderStatus;
  timestamp: number;
}

/** 持仓 */
export interface Position {
  code: string;
  volume: number;      // 持仓数量
  avgCost: number;     // 平均成本
  currentPrice: number;
  marketValue: number; // 市值
  unrealizedPnL: number; // 浮动盈亏
  realizedPnL: number;   // 已实现盈亏
}

/** 账户 */
export interface Account {
  cash: number;        // 可用资金
  frozen: number;      // 冻结资金
  totalAssets: number; // 总资产
  totalPnL: number;    // 总盈亏
  positions: Position[];
}

// ==================== 策略类型 ====================

/** 策略信号 */
export interface Signal {
  code: string;
  timestamp: number;
  direction: Direction | 'neutral'; // 多/空/空仓
  strength: number;  // 信号强度 0-1
  reason: string;    // 信号原因
  /** 组合策略的子信号详情（仅组合策略时填充） */
  subSignals?: SubSignalInfo[];
}

/** 组合策略子信号 */
export interface SubSignalInfo {
  strategyName: string;
  direction: Direction | 'neutral';
  strength: number;
  vote: number;     // +1 / 0 / -1
  weight: number;
  passed: boolean;  // 过滤模式下是否通过
}

/** 组合策略模式 */
export type EnsembleMode = 'voting' | 'filter' | 'dynamic' | 'weighted';

/** 策略配置 */
export interface StrategyConfig {
  name: string;
  enabled: boolean;
  params: Record<string, number | string | boolean>;
}

/** 策略状态 */
export interface StrategyState {
  config: StrategyConfig;
  lastSignal: Signal | null;
  position: number; // 当前持仓手数
}

// ==================== 风控类型 ====================

/** 风控规则 */
export interface RiskRule {
  id: string;
  name: string;
  enabled: boolean;
  type: 'stop_loss' | 'stop_profit' | 'position_limit' | 'single_order_limit' | 'daily_loss_limit';
  threshold: number;  // 阈值
  action: 'close' | 'reject' | 'warn';
}

/** 风控事件 */
export interface RiskEvent {
  ruleId: string;
  ruleName: string;
  timestamp: number;
  message: string;
  action: string;
}

// ==================== 回测类型 ====================

/** 回测配置 */
export interface BacktestConfig {
  startDate: string;     // '2024-01-01'
  endDate: string;       // '2024-12-31'
  initialCash: number;   // 初始资金
  commission: number;   // 手续费率 (如 0.0003)
  slippage: number;      // 滑点 (如 0.01)
  strategy: StrategyConfig;
  stockCodes: string[]; // 股票列表
  // 增强字段
  benchmarkCode?: string;    // 基准代码，如 '000001.SH'
  positionSize?: number;     // 单笔仓位比例（默认 0.1 = 10%）
  maxPosition?: number;      // 最大持仓股票数（默认 1）
  stopLossPct?: number;     // 止损比例（默认 0.07 = 7%）
  takeProfitPct?: number;   // 止盈比例（默认 0.15 = 15%）
}

/** 回撤数据点 */
export interface DrawdownPoint {
  timestamp: number;
  equity: number;        // 当日权益
  peak: number;         // 历史最高权益
  drawdown: number;     // 回撤比例（负数，如 -0.12 表示 -12%）
  drawdownAmount: number; // 回撤金额
}

/** 月度收益 */
export interface MonthlyReturn {
  year: number;
  month: number;        // 1-12
  return: number;       // 月收益率（小数，如 0.05 表示 +5%）
  cumulativeReturn: number; // 截至当月累计收益率
  trades: number;       // 当月交易次数
  tradingDays: number;   // 当月交易日数
}

/** 增强版交易记录 */
export interface TradeDetail extends TradeRecord {
  date: string;             // 交易日期字符串 'YYYY-MM-DD'
  name?: string;            // 股票名称
  turnoverRate: number;     // 换手率（本次成交量/流通股本）
  profitOrLoss: number;    // 绝对盈亏金额
  cumulativePnL: number;    // 累计盈亏（卖出后累加）
  holdingDays: number;     // 持仓天数（卖出日 - 买入日）
  profitOrLossPct: number; // 盈亏比例（盈亏/成本）
  // 基准对比
  benchmarkPrice?: number;  // 基准当日价格（用于计算相对收益）
  relativeReturn: number;   // 相对收益（个股收益 - 基准收益）
}

/** 回测结果 */
export interface BacktestResult {
  config: BacktestConfig;
  totalReturn: number;      // 总收益率
  annualReturn: number;      // 年化收益率
  maxDrawdown: number;       // 最大回撤
  sharpeRatio: number;       // 夏普比率
  winRate: number;           // 胜率
  profitLossRatio: number;    // 盈亏比
  totalTrades: number;       // 总交易次数
  dailyReturns: number[];    // 每日收益率
  equityCurve: number[];     // 权益曲线
  trades: TradeRecord[];     // 交易记录
}

/** 完整回测结果（增强版） */
export interface BacktestResultV2 {
  // 基础指标
  config: BacktestConfig;
  totalReturn: number;
  annualReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  winRate: number;
  profitLossRatio: number;
  totalTrades: number;
  // 基准对比
  benchmarkReturn: number;
  alpha: number;
  beta: number;
  // 波动率
  annualVolatility: number;
  // 交易统计
  maxConsecutiveWin: number;
  maxConsecutiveLoss: number;
  avgHoldingDays: number;
  totalCommission: number;
  // 曲线数据
  equityCurveWithDate: { date: string; equity: number; benchmark?: number }[];
  drawdownCurve: DrawdownPoint[];
  dailyReturns: number[];
  // 月度收益
  monthlyReturns: MonthlyReturn[];
  // 交易详情
  tradeDetails: TradeDetail[];
  // 年化无风险利率（用于夏普/Sortino计算）
  riskFreeRate: number;
}

/** 事件总线类型 */
export type BacktestEventType =
  | 'bar'       // 每根K线触发
  | 'signal'    // 策略信号产生
  | 'order'     // 订单提交
  | 'trade'     // 订单成交
  | 'equity'    // 权益更新
  | 'risk'      // 风控事件
  | 'daily';    // 每日收盘

export interface BacktestEvent {
  type: BacktestEventType;
  timestamp: number;
  data: Record<string, unknown>;
}

export type BacktestEventHandler = (event: BacktestEvent) => void;

/** 交易记录 */
export interface TradeRecord {
  timestamp: number;
  code: string;
  direction: Direction;
  price: number;
  volume: number;
  commission: number;
  pnl: number;
}

// ==================== 数据源类型 ====================

/** 实时行情数据 */
export interface RealtimeQuote {
  code: string;
  name: string;
  price: number;
  change: number;       // 涨跌额
  changePercent: number; // 涨跌幅 %
  open: number;
  high: number;
  low: number;
  volume: number;        // 成交量
  amount: number;       // 成交额
  timestamp: number;
}

/** 数据源接口 */
export interface DataSource {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getKBar(code: string, start: number, end: number): Promise<KBar[]>;
  getTick(code: string, date: number): Promise<TickData[]>;
  getStockList(): Promise<string[]>;
  getRealtimeQuote?(codes: string[]): Promise<RealtimeQuote[]>;
  getNews?(code: string, page?: number, pageSize?: number): Promise<NewsItem[]>;
  getAnnouncements?(code: string, page?: number, pageSize?: number): Promise<Announcement[]>;
  getAlerts?(type: AlertItem['alertType'], date?: string): Promise<AlertItem[]>;
  getResearch?(code: string, page?: number, pageSize?: number): Promise<ResearchReport[]>;
  getSentiment?(): Promise<SentimentIndex>;
}

/** 支持的数据源 */
export type DataSourceType = 'tushare' | 'akshare' | 'csv' | 'mock';

// ==================== 消息面类型 ====================

/** 新闻条目 */
export interface NewsItem {
  id: string;
  title: string;
  content: string;
  source: string;
  publishTime: string;
  url: string;
  code?: string;
  tags: string[];
  sentiment?: 'positive' | 'negative' | 'neutral';
  isImportant: boolean;
}

/** 公司公告 */
export interface Announcement {
  id: string;
  title: string;
  code: string;
  name: string;
  category: string;
  publishTime: string;
  url: string;
  pages?: number;
  abstract?: string;
}

/** 交易异动 */
export type AlertType = 'zt' | 'dt' | 'yd' | 'lhb'; // 涨停/跌停/异动/龙虎榜

export interface AlertItem {
  code: string;
  name: string;
  alertType: AlertType;
  alertReason: string;
  publishTime: string;
  changePercent: number;
  turnover: number;
  amount: number;
  closePrice: number;
  preClose: number;
}

/** 券商研报 */
export interface ResearchReport {
  id: string;
  title: string;
  author: string;
  authors: string[];
  code: string;
  name: string;
  rating: string;
  ratingChange?: string;
  targetPrice?: number;
  currentPrice?: number;
  upside: number;
  publishTime: string;
  reportType: 'industry' | 'company' | 'macro';
  reportPdfUrl?: string;
  abstract?: string;
  盈利预测?: {
    year: string;
    eps: number;
    revenue: number;
    netProfit: number;
  }[];
}

/** 市场舆情 */
export type SentimentLevel = 'fear' | 'neutral' | 'greed';

export interface HotStock {
  rank: number;
  code: string;
  name: string;
  heat: number;
  changePercent: number;
  sentiment: 'positive' | 'negative' | 'neutral';
  mainTopic: string;
}

export interface MarketBreadth {
  upCount: number;
  downCount: number;
  limitUpCount: number;
  limitDownCount: number;
  flatCount: number;
  upDownRatio: number;
  advanceRate: number;
}

export interface MarginBalance {
  marginBalance: number;
  marginBalanceChange: number;
  shortBalance: number;
  shortBalanceChange: number;
  marginBalanceRatio: number;
}

export interface SentimentIndex {
  date: string;
  overall: number;
  level: SentimentLevel;
  hotStocks: HotStock[];
  marketBreadth: MarketBreadth;
  marginBalance: MarginBalance;
  bullBearVote?: {
    bullish: number;
    bearish: number;
    neutral: number;
  };
}

// ==================== 多因子组合回测类型 ====================

/** 截面评分输入 — 单股票在某日的因子快照 */
export interface StockFactorSnapshot {
  code: string;
  timestamp: number;
  close: number;
  /** 因子原始值（用于截面百分位计算） */
  factors: {
    pe: number;
    pb: number;
    ps: number;
    roe: number;
    grossMargin: number;
    momentum5: number;
    momentum20: number;
    momentum60: number;
    reversal: number;
    rsi: number;
    moneyFlow: number;
    volumeRatio: number;
    turnoverRate: number;
    macdSignal: number;
    kdjSignal: number;
  };
  /** 截面百分位 (0-100)，由 preComputeFactorPercentiles 计算 */
  pct: Record<string, number>;
}

/** 单股评分结果 */
export interface StockScore {
  code: string;
  compositeScore: number;           // 综合评分 0-100
  rank: number;                    // 截面排名 1-N
  direction: 'long' | 'short' | 'neutral';
  factorContributions: Record<string, number>; // 各因子对总分的贡献
  scoreChange?: number;            // 较上期变化（用于阈值调仓）
}

/** 目标持仓 */
export interface PortfolioHolding {
  code: string;
  weight: number;        // 目标权重（总资金比例，0-1）
  reason: string;        // 为什么选这只（因子贡献摘要）
}

/** 目标组合 */
export interface PortfolioTarget {
  date: string;          // 调仓日期
  holdings: PortfolioHolding[];
}

/** 调仓记录 */
export interface RebalanceRecord {
  date: string;          // 调仓执行日期
  scoreDate: string;     // 评分日期（T日收盘后评分）
  target: PortfolioTarget;
  trades: {
    code: string;
    direction: 'buy' | 'sell';
    volume: number;       // 股数
    price: number;        // 成交价
    weight: number;       // 目标权重
  }[];
  portfolioFactorExposure: Record<string, number>; // 各因子加权暴露
}

/** 因子贡献（归因用） */
export interface FactorContribution {
  factorName: string;
  icMean: number;           // IC均值（方向）
  portfolioExposure: number; // 组合因子暴露（加权平均）
  factorReturn: number;      // 因子本期收益
  contribution: number;       // portfolioExposure × factorReturn（bp）
}

/** 调仓模式 */
export type RebalanceMode =
  | { type: 'daily' }
  | { type: 'weekly'; dayOfWeek: 0 | 1 | 2 | 3 | 4 }
  | { type: 'biweekly'; dayOfWeek: 0 | 1 | 2 | 3 | 4 }
  | { type: 'threshold'; scoreChangePct: number } // 评分变化超过阈值触发
  | { type: 'ic-signal'; icThreshold: number };   // IC方向指示

/** 权重分配方式 */
export type WeightMethod =
  | { type: 'equal' }
  | { type: 'score-proportional'; normalize: boolean }
  | { type: 'risk-parity' };

/** 组合回测配置 */
export interface FactorBacktestConfig {
  startDate: string;
  endDate: string;
  initialCash: number;
  commission: number;
  slippage: number;
  stockPool: string[];         // 股票池（代替单股票代码）
  benchmarkCode?: string;
  // 因子权重：null 表示从 weight-cache 读取
  factorWeights?: import('../factor/weight-cache').FactorWeight[] | null;
  // 调仓
  rebalanceMode: RebalanceMode;
  topN: number;                // 持仓股数
  weightMethod: WeightMethod;
  // 风控
  maxSinglePosition?: number;   // 单股最大权重（默认 0.2）
  stopLossPct?: number;
  takeProfitPct?: number;
}

/** 组合回测结果 */
export interface PortfolioBacktestResult {
  // 基础绩效
  totalReturn: number;
  annualReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  winRate: number;
  alpha: number;
  beta: number;
  annualVolatility: number;
  // 组合特有
  turnover: number;              // 平均单次调仓换手率
  avgHoldingPeriod: number;      // 平均持仓期（天）
  rebalanceCount: number;       // 调仓次数
  totalCommission: number;
  // 曲线
  equityCurveWithDate: { date: string; equity: number; benchmark?: number }[];
  drawdownCurve: DrawdownPoint[];
  monthlyReturns: MonthlyReturn[];
  // 调仓日志
  rebalanceLog: RebalanceRecord[];
  // 因子归因（长期）
  factorAttribution?: FactorContribution[];
}
