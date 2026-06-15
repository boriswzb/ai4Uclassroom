/**
 * 量化交易系统 - Dexie 数据库 Schema
 * 基于 IndexedDB 的本地持久化层
 */

import type { Table } from 'dexie';
import type { StrategyConfig, Direction, EnsembleMode } from '../types';
import type { TradeRecord, Position } from '../types';

// ==================== 股票数据缓存类型 ====================
// 与 lib/quant/data/stock-data-cache.ts 保持同步
export type CacheType =
  | 'realtime' | 'index' | 'list' | 'board' | 'flow' | 'screener'
  | 'fundamentals' | 'news' | 'announcement' | 'alerts' | 'kline';

// ==================== 枚举映射 ====================

/** 策略类型 */
export type StrategyType = 'single' | 'ensemble';

/** 组合策略模式 */
export type EnsembleModeDb = 'voting' | 'filter' | 'weighted' | 'dynamic';

/** 账户状态 */
export type AccountStatus = 'running' | 'paused' | 'closed';

// ==================== 策略相关 ====================

/** 用户策略 */
export interface DbStrategy {
  id: string;                   // UUID
  userId: string;               // 所属用户 ID（受邀用户为 username，Guest 为本地 UUID）
  name: string;
  description?: string;
  type: StrategyType;          // single | ensemble
  // 单策略配置
  strategyType?: string;        // 'MACD' | 'KDJ' | 'MA' | 'BOLL' | 'RSI'
  params?: Record<string, number | string | boolean>; // 策略参数
  // 组合策略配置
  ensembleMode?: EnsembleModeDb;
  subStrategies?: string[];     // 子策略ID列表
  weights?: number[];           // 各子策略权重
  // 基础字段
  enabled: boolean;
  tags: string[];
  createdAt: number;            // timestamp
  updatedAt: number;
}

/** 策略与账户绑定 */
export interface DbStrategyBinding {
  id: string;                   // UUID
  userId: string;               // 所属用户 ID
  strategyId: string;
  accountId: string;
  enabled: boolean;            // 该策略在账户中是否启用
  priority: number;            // 执行优先级（数字越小越优先）
}

// ==================== 自选股 ====================

/** 自选股分组 */
export interface DbWatchlist {
  id: string;                   // UUID
  userId: string;               // 所属用户 ID
  name: string;                 // 分组名称，如 "科技股"、"我的持仓"
  codes: string[];              // 股票代码列表
  color?: string;               // UI显示颜色
  sortOrder: number;            // 排序顺序
  createdAt: number;
  updatedAt: number;
}

// ==================== 模拟账户 ====================

/** 模拟账户 */
export interface DbAccount {
  id: string;                   // UUID
  userId: string;               // 所属用户 ID
  name: string;                 // 账户名称，如 "激进策略账户"
  description?: string;
  initialCash: number;          // 初始资金
  currentCash: number;          // 当前可用资金
  frozen: number;               // 冻结资金
  totalAssets: number;          // 总资产
  status: AccountStatus;        // running | paused | closed
  // 自动驾驶
  autoPilot: boolean;           // 是否开启自动驾驶
  boundStrategies: string[];    // 绑定的策略ID列表（已废弃，用DbStrategyBinding）
  // 风控参数
  maxPositionPct: number;       // 单股最大持仓比例（默认0.2=20%）
  stopLossPct: number;          // 止损比例（默认0.07=7%）
  takeProfitPct: number;        // 止盈比例（默认0.15=15%）
  // 统计
  totalPnL: number;             // 累计盈亏
  // 运行时状态持久化（用于页面刷新后重建策略）
  tradingCodes?: string[];      // 当前交易的股票代码列表（可选，初始账户为空）
  strategyType?: string;        // 单策略类型: macd|kdj|ma|bollinger|rsi
  ensembleType?: string;        // 组合策略类型: voting|filter|weighted|dynamic
  createdAt: number;
  updatedAt: number;
}

/** 持仓快照 */
export interface DbPosition {
  id: string;                   // UUID
  accountId: string;
  code: string;                 // 股票代码
  name?: string;                 // 股票名称
  volume: number;               // 持仓数量（股）
  avgCost: number;              // 平均成本
  currentPrice: number;         // 当前价
  marketValue: number;          // 市值
  unrealizedPnL: number;        // 浮动盈亏
  realizedPnL: number;          // 已实现盈亏
  frozenVolume: number;         // 冻结数量（T+1当日不能卖）
  buyDate: string;               // Bug2 fix: 首次买入日期 YYYYMMDD，用于 T+1 跨日判断
  updatedAt: number;
}

/** 历史成交记录 */
export interface DbTradeRecord {
  id: string;                   // UUID
  accountId: string;
  timestamp: number;            // 成交时间戳
  code: string;                 // 股票代码
  name?: string;
  direction: Direction;          // long | short
  price: number;                // 成交价格
  volume: number;               // 成交数量
  commission: number;           // 手续费
  pnl: number;                  // 本笔盈亏（卖出时填写）
  strategyId?: string;          // 触发该交易的策略ID
  signalId?: string;            // 对应信号ID
}

/** 每日净值记录 */
export interface DbEquityPoint {
  id: string;                   // UUID
  accountId: string;
  date: string;                 // YYYYMMDD 格式
  equity: number;               // 当日收盘总资产
  cash: number;                 // 当日收盘现金
  positionValue: number;        // 当日收盘持仓市值
  dailyReturn: number;         // 当日收益率
  benchmarkEquity?: number;     // 基准指数当日净值（用于对比）
}

/** 订单记录 */
export interface DbOrder {
  id: string;                   // UUID
  accountId: string;
  code: string;
  direction: Direction;
  type: 'market' | 'limit';
  price: number;
  volume: number;
  filledVolume: number;
  status: 'pending' | 'filled' | 'partial' | 'cancelled' | 'rejected';
  timestamp: number;
  strategyId?: string;
  updatedAt?: number;
}

// ==================== 用户身份 ====================

/** 本地用户（浏览器生成） */
export interface DbUser {
  id: string;                   // UUID，浏览器首次访问时生成
  createdAt: number;
  // 可选的用户信息（登录后可补充）
  nickname?: string;
  email?: string;
  supabaseUserId?: string;      // 关联 Supabase Auth 用户ID
}

// ==================== 选股历史 ====================

export interface DbScreenerHistory {
  id: string;                   // UUID
  userId: string;               // 所属用户 ID
  timestamp: number;            // 记录时间戳
  // 筛选条件快照
  filters: {
    industry: string;
    priceMin: string;
    priceMax: string;
    peMin: string;
    peMax: string;
    pbMin: string;
    pbMax: string;
    mktCapMin: string;
    mktCapMax: string;
    turnoverMin: string;
    changeMin: string;
    changeMax: string;
    excludeSt: boolean;
    sortBy: string;
    sortOrder: string;
    scoreSort: boolean;
    techSignal: string;
    maFilter: string;
    bollFilter: string;
    cciFilter: string;
    obvFilter: string;
    adxFilter: string;
    sentimentFilter: string;
    ratingFilter: string;
  };
  // 返回结果摘要
  totalCount: number;           // 符合条件总数
  topStocks: string[];          // 前10股票代码（用于快速展示）
  // 执行信息
  duration: number;             // 查询耗时 ms
}

// ==================== 多因子分析 ====================

/**
 * 单股因子快照 + 下期收益（用于 IC/IR 计算）
 * 每日收盘后批量计算，存储用于历史滚动窗口分析
 */
export interface DbFactorICRecord {
  id: string;                       // UUID
  date: string;                     // YYYYMMDD 截面日期
  code: string;                     // 股票代码
  name?: string;

  // 因子原始值
  pe: number | null;
  pb: number | null;
  ps: number | null;
  roe: number | null;
  grossMargin: number | null;
  momentum5: number | null;         // 5日动量
  momentum20: number | null;       // 20日动量
  reversal: number | null;         // 反转因子（RSI-14，>50=超跌）
  moneyFlowScore: number | null;    // 资金流分（主力净流入率）
  volumeRatio: number | null;      // 量比
  turnoverRate: number | null;      // 换手率
  changePercent: number | null;    // 当日涨跌幅
  rsi14: number | null;             // RSI(14)
  macdSignal: number | null;        // MACD信号（1=金叉，-1=死叉，0=无信号）
  kdjSignal: number | null;         // KDJ信号

  // 下期收益（用于 IC 计算）
  nextReturn5: number | null;       // 5日后收益率
  nextReturn20: number | null;      // 20日后收益率

  updatedAt: number;
}

/**
 * 因子 IC/IR 分析汇总（每个因子、每个周期一条记录）
 */
export interface DbFactorAnalysisSummary {
  id: string;                       // UUID
  factorName: string;                // 因子名: pe/pb/ps/roe/grossMargin/momentum5/momentum20/reversal/moneyFlow/volumeRatio/turnoverRate/macdSignal/kdjSignal
  period: string;                   // 收益周期: 5d / 20d
  date: string;                     // YYYYMMDD 统计截止日期

  // IC 统计（滚动窗口）
  icMean: number;                   // 近30期 IC 均值
  icStd: number;                    // 近30期 IC 标准差
  ir: number;                        // IC均值/IC标准差
  icLast: number;                   // 最新一期 IC

  // IC 序列（用于画图）
  icSeries: number[];               // 近期60期 IC 序列 [最新, 次新, ...]

  // IC 累计曲线（用于可视化）
  cumulativeIC: number;             // 累计 IC（趋势方向）
  positiveICRate: number;           // IC>0 的比例

  // 有效性评级
  effectiveness: 'excellent' | 'good' | 'neutral' | 'poor'; // IR>0.8=excellent, >0.5=good, >0.3=neutral, else=poor

  updatedAt: number;
}

/**
 * 个股因子评分快照（展示详情用）
 */
export interface DbStockScore {
  id: string;                       // 股票代码 + 周期 + 评分版本: `${code}_${period}_${scoreVersion}`
  period: string;                   // 收益周期: 5d / 20d
  scoreVersion: 'v1' | 'v2';        // 评分系统版本：v1 = 3-pillar / v2 = 8 大类中性化
  date: string;                     // YYYYMMDD
  code: string;
  name: string;
  price: number;
  changePercent: number;
  compositeScore: number;
  momentumScore: number;
  moneyFlowScore: number;
  technicalScore: number;
  factorScores: string;             // JSON string of Record<string, number>
  regime: string;
  updatedAt: number;
}

// ==================== 股票数据缓存 ====================

/**
 * 个股每日 raw 因子快照（用于真实 WF 回测 + 历史 IC 计算）
 *
 * v3.0（2026-06-15）：新增"每日 raw 因子快照"表
 *
 * 与 stockScores 的区别：
 *   - stockScores：只存"分析当时的 Top N"（每天只 10 条）
 *   - factorSnapshots：存每天全候选池的 raw 因子（每天 50-100 条）
 *
 * 用途：
 *   1. WF 用真实 T+1 收益（从 priceNext 推算）替代代理收益
 *   2. IC 统计用历史 snapshot 算滚动 IC（无需每次重跑全市场）
 *   3. 因子失效检测（哪些因子最近 IC 突然变负）
 *
 * 业界标准：
 *   - WorldQuant/聚宽每日 raw 因子库 = 200+ GB（百万股 × 数千因子）
 *   - 个人版用 100-500 只候选 + 14 个 raw 因子 ≈ 14KB/天 ≈ 5MB/年
 */
export interface DbFactorSnapshot {
  id: string;                       // `${date}_${code}` — 每天每票一条
  date: string;                     // YYYYMMDD
  timestamp: number;                // 抓取时间

  // ── 价格 ──
  code: string;
  name: string;
  price: number;                    // 当日收盘
  changePercent: number;            // 当日涨跌幅（%）

  // ── raw 因子（与 FactorRawValues 一致）──
  pe: number; pb: number; ps: number;
  roe: number; grossMargin: number; debtRatio: number; eps: number; accrualsRatio: number;
  momentum5: number; momentum10: number; momentum20: number; momentum60: number; momentum120: number;
  rsi14: number; cci14: number; bias20: number;
  mainNetInflow5d: number; mainNetInflow20d: number; mainNetInflowRatio: number;
  macdHist: number; kdjK: number; kdjD: number;
  bollPosition: number; adx: number; lowVolatility: number;
  turnoverRate: number; volumeRatio: number;
  marketCap: number; floatMarketCap: number; avgAmount20d: number;
  industry: string; wqAlphaScore: number;

  // ── 未来收益（每日跑完才填，填后这条记录才"完整"）──
  //   T+5 / T+20 收益用于 WF 真实回测
  //   缺这些字段的快照不能用于 WF
  priceNext5?: number;              // T+5 收盘价
  priceNext20?: number;             // T+20 收盘价
  return5d?: number;                // (priceNext5 - price) / price × 100（%）
  return20d?: number;
  filledAt?: number;                // 未来收益填补时间
}

/**
 * Walk-Forward 验证报告快照（每次验证保存一条）
 *
 * v2.1.1（2026-06-15）：用于追踪"当前权重设置在历史上是否持续有效"
 * 每次点"🚀 开始验证" → 保存一条记录 + 与上一次对比
 * 如果连续 3 次都 C/D 级 → 触发"⚠️ 权重可能失效"提示
 */
export interface DbWalkforwardReport {
  id: string;                       // `${date}_${period}_${weightMode}`，保证每天每配置只存最新一条
  date: string;                     // YYYYMMDD
  timestamp: number;                // 保存时间戳（用于排序）

  // 配置快照
  period: string;                   // 5d / 20d
  weightMode: 'default' | 'ic' | 'manual';  // 权重模式
  longMomentum: boolean;            // 是否长动量
  useICHistory: boolean;            // 是否严谨 IC（仅诊断参考）

  // 评级（v2.1.1 walkforward-recommendation.ts 输出）
  rating: 'A+' | 'A' | 'B' | 'C' | 'D';
  robustnessScore: number;          // 0-100
  annualizedSharpe: number;
  winRate: number;
  excessWinRate: number;
  totalReturn: number;              // 累计收益（%）
  maxDrawdown: number;              // 最大回撤（%）
  windowCount: number;              // 验证窗口数
  avgExcessReturn: number;          // 平均超额收益（%）

  // 一句话诊断
  diagnosis: string;

  // 完整报告（JSON 字符串，含 windows[] 明细）
  fullReport: string;

  updatedAt: number;
}

/**
 * 股票多类数据统一缓存表
 * 非交易时段数据不变，一次抓取长期有效
 * stale-while-revalidate: 先读缓存，后台静默刷新
 */
export interface DbStockCache {
  id: string;                        // 主键：类型前缀+代码+周期，如 "fundamentals_sh600519" / "news_sz000001" / "alerts_zt_20240101"
  type: CacheType;
  code: string;                       // 股票代码（如 600519，不带后缀）
  params?: string;                    // 查询参数快照（如 period=day&count=200）
  data: string;                       // JSON.stringify 后的数据
  fetchedAt: number;                  // 抓取时间戳
  expireAt: number;                   // 过期时间（非交易时段数据长期有效）
  source: string;                     // 数据来源：eastmoney / sina / tencent
}

// ==================== 表定义类型 ====================

export type QuantTables = {
  strategies: Table<DbStrategy>;
  strategyBindings: Table<DbStrategyBinding>;
  watchlists: Table<DbWatchlist>;
  accounts: Table<DbAccount>;
  positions: Table<DbPosition>;
  tradeRecords: Table<DbTradeRecord>;
  equityPoints: Table<DbEquityPoint>;
  orders: Table<DbOrder>;
  users: Table<DbUser>;
  factorICRecords: Table<DbFactorICRecord>;
  factorAnalysisSummary: Table<DbFactorAnalysisSummary>;
  stockScores: Table<DbStockScore>;
  stockCache: Table<DbStockCache>;
  walkforwardReports: Table<DbWalkforwardReport>;  // v2.1.1（2026-06-15）
  factorSnapshots: Table<DbFactorSnapshot>;  // v3.0（2026-06-15）— 每日 raw 因子快照
};