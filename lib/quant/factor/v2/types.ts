/**
 * Factor v2 — 类型定义
 * 7 大类因子 + WorldQuant 10 alpha + 中性化 + 百分位
 */

import type { KBar } from '@/lib/quant/types';

// ── 原始 K 线数据（轻量级） ─────────────────────────
export interface BarLite {
  date: string;       // YYYYMMDD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
}

// ── 单只股票的 11 类因子原始值（计算后） ─────────────
export interface FactorRawValues {
  // 0. 行情元信息
  code: string;
  name: string;
  price: number;
  changePercent: number;
  marketCap: number;        // 总市值（元）
  floatMarketCap: number;   // 流通市值（元）
  industry?: string;        // 申万一级行业（用于行业中性化）

  // 1. 估值（value）
  pe: number;               // PE_TTM，正数，负数表示亏损
  pb: number;               // PB
  ps: number;               // PS

  // 2. 质量（quality）— 来自东方财富财务接口
  roe: number;              // 净资产收益率 TTM (%)
  grossMargin: number;      // 毛利率 (%)
  debtRatio: number;        // 资产负债率 (%)
  eps: number;              // 每股收益 TTM
  // v2.1.1（2026-06-15）：Sloan Accruals 盈余质量
  //   OCF/NI = 经营现金流 / 净利润，越高说明利润是真金白银
  //   A 股经验值：1.0+ 高质量 / 0.5-1.0 中等 / <0.5 低质量（大量应收账款）
  accrualsRatio: number;    // OCF/NI 比值（缺失时 = 1.0 中性）

  // 3. 动量（momentum）
  momentum5: number;        // 5 日收益
  momentum10: number;
  momentum20: number;
  momentum60: number;
  momentum120?: number;     // v2.1.1（2026-06-15）：120 日收益（Jegadeesh-Titman 长动量）

  // 4. 反转（reversal）
  rsi14: number;            // 0-100
  cci14: number;            // 通道指标
  bias20: number;           // 20 日乖离率 (%)

  // 5. 资金流（money flow）— 真实主力净流入
  mainNetInflow5d: number;  // 5 日主力净流入（万元）
  mainNetInflow20d: number; // 20 日主力净流入
  mainNetInflowRatio: number; // 主力净流入 / 成交额
  volumeRatio: number;      // 量比
  turnoverRate: number;     // 换手率 (%)

  // 6. 技术（technical）
  macdHist: number;
  kdjK: number;
  kdjD: number;
  bollPosition: number;     // 0-1
  adx: number;              // 0-100
  lowVolatility: number;    // 残差波动率（20日 ATR/close）

  // 7. 流动性（liquidity）
  avgAmount20d: number;     // 20 日均成交额（元）

  // 8. WorldQuant 10 alpha（在 alphas.ts 计算）
  wqAlphaScore: number;     // 10 个 alpha 复合 (-100 ~ +100)
}

// ── 截面百分位归一化结果（输入到 scoreStock） ─────────
export interface FactorPercentiles {
  // 0-1 之间的百分位
  valuation: number;        // pe+pb+ps 反向百分位（越低越好）
  quality: number;          // roe+grossMargin 正向
  momentum: number;         // 20d 动量正向
  reversal: number;         // RSI<30 加分（反向）
  moneyFlow: number;        // 主力净流入正向
  technical: number;        // 综合技术信号
  turnover: number;         // 换手率适度区间
  wqAlpha: number;          // 10 alpha 复合正向

  // 原始百分位（用于回测和 IC 计算）
  pe: number;
  pb: number;
  roe: number;
  grossMargin: number;
  momentum20: number;
  momentum60?: number;     // v2.1.1
  momentum120?: number;    // v2.1.1
  rsi: number;
  mainNetInflow: number;
  macd: number;
  kdj: number;
  bollPosition: number;
  adx: number;
  volatility: number;
  turnoverRate: number;
  volumeRatio: number;
  marketCap: number;

  // 行业内百分位（同行业内的 0-1 排名；样本 < 5 时与全市场一致）
  industryPctValuation?: number;
  industryPctQuality?: number;
  industryPctMomentum?: number;
  industryPctReversal?: number;
  industryPctMoneyFlow?: number;
  industryPctTechnical?: number;
  industryPctTurnover?: number;
  industryPctWqAlpha?: number;
  industrySize?: number;     // 所在行业的样本数（用于"在 N 只同行里排第 X 名"）
}

// ── 单只股票最终评分 ────────────────────────────────
export interface V2ScoreResult {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  industry?: string;

  // 7 大类分项（0-100）
  valuation: number;
  quality: number;
  momentum: number;
  reversal: number;
  moneyFlow: number;
  technical: number;
  turnover: number;
  wqAlpha: number;

  // 复合（0-100）
  composite: number;
  rank: number;

  // 因子贡献（用于归因）
  contributions: Record<string, number>;
  weights: Record<string, number>;  // 实际使用的权重

  // 原始因子值（用于详情弹窗展示计算过程；包含 PE/PB/ROE/动量5-60/RSI/主力净流入等）
  rawFactors?: FactorRawValues;

  // 截面百分位（0-1 之间；用于弹窗展示"在候选池中的排名"）
  // 包含各原始因子的反向/正向归一化结果
  percentiles?: FactorPercentiles;

  // 标记
  flags: {
    isST: boolean;
    isLimitUp: boolean;
    isLimitDown: boolean;
    isSuspended: boolean;
    isNewShare: boolean;     // 上市 < 60 日
    isLowLiquidity: boolean; // 20 日均成交额 < 1 亿
  };

  // 板块热点加持（hot-sector.ts 注入）— 2026-09 新增
  sectorBoost?: number;      // 板块热度加持分（当前值）
  baseComposite?: number;    // 加持前综合分
  sectorHeat?: number;       // 所属板块热度 0-100（若属热点板块）
  sectorIndustry?: string;   // 所属申万行业名
}

// ── 中性化配置 ─────────────────────────────────────
export interface NeutralizationConfig {
  industry: boolean;        // 行业中性化（OLS 取残差）
  marketCap: boolean;       // 市值中性化（对 log(总市值) 回归）
}

// ── 权重配置 ───────────────────────────────────────
export type V2PillarKey = 'valuation' | 'quality' | 'momentum' | 'reversal' | 'moneyFlow' | 'technical' | 'turnover' | 'wqAlpha';
export interface WeightConfig {
  // 默认权重（当 IC 数据不足时使用）
  default: Record<V2PillarKey, number>;
  // IC 动态定权后权重
  icDerived?: Partial<Record<V2PillarKey, number>>;
}

// ── 评分选项 ───────────────────────────────────────
export interface V2ScoreOptions {
  forwardPeriod: 5 | 20;    // 调仓周期
  neutralize: NeutralizationConfig;
  weightMode: 'default' | 'ic' | 'manual';
  customWeights?: Record<string, number>;
  filterFlags?: boolean;     // 是否过滤 ST/涨跌停/停牌
  // v2.1（2026-06-15）：weightMode='ic' 时需要传入 IC 统计
  icStats?: Record<string, { ic: number; ir: number; n: number }>;
  // v2.1.1（2026-06-15）：长动量开关
  longMomentum?: boolean;
}

// ── 行业列表（申万一级） ───────────────────────────
export const SHENWAN_INDUSTRIES = [
  '农林牧渔', '基础化工', '钢铁', '有色金属', '电子', '汽车', '家用电器',
  '食品饮料', '纺织服饰', '轻工制造', '医药生物', '公用事业', '交通运输',
  '房地产', '商贸零售', '社会服务', '综合', '建筑材料', '建筑装饰', '电力设备',
  '机械设备', '煤炭', '石油石化', '环保', '美容护理', '银行', '非银金融',
  '计算机', '传媒', '通信', '国防军工',
] as const;
export type ShenwanIndustry = typeof SHENWAN_INDUSTRIES[number];

export type { KBar };
