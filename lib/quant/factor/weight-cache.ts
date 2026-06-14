/**
 * 因子中文名映射（IC/IR 因子名 → 中文标签）
 */
export const IC_FACTOR_LABELS: Record<string, string> = {
  pe: '市盈率 PE', pb: '市净率 PB', ps: '市销率 PS',
  roe: '净资产收益率 ROE', grossMargin: '毛利率',
  momentum5: '5日动量', momentum20: '20日动量', momentum60: '60日动量',
  reversal: 'RSI 反转', rsi: 'RSI 超买超卖',
  moneyFlow: '资金流 MFI', mfi: 'MFI 资金流',
  volumeRatio: '量比', turnoverRate: '换手率',
  macdSignal: 'MACD信号', kdjSignal: 'KDJ信号',
  macd: 'MACD', kdj: 'KDJ', adx: 'ADX 趋势',
  volatility: '波动率', bollPosition: '布林位置',
  bias: '乖离率', williamsR: '威廉指标',
};

/**
 * IC/IR 因子名 → screener API 内部百分位因子名的映射
 * 用于把 IC/IR 分析的权重正确注入 scoreStock 的 pct 对象
 */
export const IC_TO_SCREENER_KEY: Record<string, string> = {
  momentum20: 'momentum', momentum5: 'momentum', momentum60: 'momentum',
  rsi: 'reversal', reversal: 'reversal',
  mfi: 'moneyFlow', moneyFlow: 'moneyFlow',
  volatility: 'technical', adx: 'technical', macd: 'technical',
  kdj: 'technical', bollPosition: 'technical', bias: 'technical',
  williamsR: 'technical',
  pe: 'pe', pb: 'pb', ps: 'ps',
  roe: 'quality', grossMargin: 'quality',
  turnoverRate: 'turnover', volumeRatio: 'volumeRatio',
};

/**
 * P2-2 修复：因子失效检测配置
 * 连续 N 次 IC<0 视为因子失效（信号已反转或失效）
 */
export const DEGRADATION_CONFIG = {
  /** 连续多少次 IC<0 触发降权（默认 3） */
  CONSECUTIVE_NEG_THRESHOLD: 3,
  /** 失效后权重乘数（0.3 = 降权到 30%） */
  DEGRADED_WEIGHT_MULTIPLIER: 0.3,
  /** 历史 IC 序列最大保留条数（环形缓冲） */
  MAX_HISTORY_PER_FACTOR: 10,
};



export interface FactorWeight {
  factorName: string;
  ir: number;
  icMean: number;
  weight: number;       // 归一化权重百分比（基于 IC×IR × IC>0 修正）
  period: string;      // '5d' | '20d'
  reason: string;      // 中文说明
  /** P2-2 修复：是否被失效检测降权 */
  degraded?: boolean;
  /** P2-2 修复：连续负 IC 次数（>0 表示已触发降权） */
  consecutiveNegIC?: number;
  /** P2-2 修复：原始权重（降权前） */
  originalWeight?: number;
}

export interface CachedWeights {
  weights: FactorWeight[];
  period: string;
  regime: string;
  updatedAt: number;    // Date.now()
  /** P2-2 修复：失效预警摘要 */
  degradationReport?: {
    degradedFactors: string[];  // 因子名列表
    warnings: { factorName: string; consecutiveNegIC: number; reason: string }[];
    evaluatedAt: number;
  };
}

// 模块级内存缓存
let _cached: CachedWeights | null = null;

// P2-2 修复：每个因子的 IC 时间序列历史（环形缓冲）
// key: factorName, value: IC 值数组（按时间顺序，最近的在末尾）
const _icHistory: Map<string, number[]> = new Map();

// 缓存有效期（默认 24 小时）
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * P2-2 修复：记录一次因子分析结果到历史（用于连续负 IC 检测）
 * @returns 该因子是否被标记为"失效"
 */
export function recordFactorIC(factorName: string, icMean: number): {
  consecutiveNegIC: number;
  degraded: boolean;
} {
  const history = _icHistory.get(factorName) || [];
  history.push(icMean);
  if (history.length > DEGRADATION_CONFIG.MAX_HISTORY_PER_FACTOR) {
    history.shift(); // 弹出最旧的
  }
  _icHistory.set(factorName, history);

  // 计算末尾连续负 IC 次数
  let consecutiveNegIC = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] < 0) consecutiveNegIC++;
    else break;
  }
  const degraded = consecutiveNegIC >= DEGRADATION_CONFIG.CONSECUTIVE_NEG_THRESHOLD;
  return { consecutiveNegIC, degraded };
}

/** P2-2 修复：清空 IC 历史（用户重置或换 regime） */
export function clearICHistory(): void {
  _icHistory.clear();
}

/** P2-2 修复：获取 IC 历史（调试用） */
export function getICHistory(factorName: string): number[] {
  return [...(_icHistory.get(factorName) || [])];
}

export function setCachedWeights(weights: FactorWeight[], period: string, regime: string): CachedWeights {
  // P2-2 修复：写入缓存前，对每个因子做失效检测
  const degradationWarnings: { factorName: string; consecutiveNegIC: number; reason: string }[] = [];
  const degradedFactors: string[] = [];

  for (const w of weights) {
    const { consecutiveNegIC, degraded } = recordFactorIC(w.factorName, w.icMean);
    w.consecutiveNegIC = consecutiveNegIC;
    if (degraded) {
      w.degraded = true;
      w.originalWeight = w.weight;
      w.weight = Math.round(w.weight * DEGRADATION_CONFIG.DEGRADED_WEIGHT_MULTIPLIER * 10) / 10;
      w.reason = `⚠️ ${w.reason}（连续 ${consecutiveNegIC} 次 IC<0，权重自动降为 ${DEGRADATION_CONFIG.DEGRADED_WEIGHT_MULTIPLIER * 100}%）`;
      degradedFactors.push(w.factorName);
      degradationWarnings.push({
        factorName: w.factorName,
        consecutiveNegIC,
        reason: `连续 ${consecutiveNegIC} 次 IC<0（IC=${w.icMean.toFixed(4)}），因子已失效，权重自动降为 ${DEGRADATION_CONFIG.DEGRADED_WEIGHT_MULTIPLIER * 100}%`,
      });
    }
  }

  const degradationReport = degradedFactors.length > 0
    ? { degradedFactors, warnings: degradationWarnings, evaluatedAt: Date.now() }
    : undefined;

  _cached = {
    weights,
    period,
    regime,
    updatedAt: Date.now(),
    degradationReport,
  };
  if (degradedFactors.length > 0) {
    console.warn(`[WeightCache] ⚠️ ${degradedFactors.length} 个因子失效已自动降权: ${degradedFactors.join(', ')}`);
  } else {
    console.log(`[WeightCache] Cached ${weights.length} factor weights (period=${period}, regime=${regime})`);
  }
  return _cached;
}

export function getCachedWeights(): CachedWeights | null {
  if (!_cached) return null;
  if (Date.now() - _cached.updatedAt > CACHE_TTL_MS) {
    console.log('[WeightCache] Cache expired, clearing');
    _cached = null;
    return null;
  }
  return _cached;
}

/**
 * 基于 IC/IR 计算因子权重
 *
 * 权重公式: weight ∝ |IC_mean| × IR
 *   - IC_mean 为正 → 因子正向预测收益，给正权重
 *   - IC_mean 为负 → 因子反向预测收益，给负权重（或排除）
 *   - IR 衡量 IC 的稳定性，IR 越高稳定性越强
 *
 * 归一化: 正权重因子求和 = 100%
 * 排除: IR < 0.1 或 IC_mean ≈ 0 的因子（统计不显著）
 */
export function computeWeightsFromIR(icResults: {
  factorName: string;
  ir: number;
  icMean: number;
  period?: string;
}[]): FactorWeight[] {
  const MIN_IR = 0.1;   // IR < 0.1 视为统计噪声
  const MIN_IC = 0.01;  // |IC| < 0.01 视为无预测能力

  const effective = icResults.filter(r => {
    if (r.factorName === 'adx' && r.ir === 0) return false; // adx 特殊处理（全0）
    return Math.abs(r.icMean) >= MIN_IC;
  });

  // 计算原始分数：|IC_mean| × IR（捕捉强度 × 稳定性）
  const scored = effective.map(r => {
    const score = Math.abs(r.icMean) * r.ir;
    const isPositive = r.icMean > 0;
    const isSignificant = r.ir >= MIN_IR;
    return { ...r, score, isPositive, isSignificant };
  });

  // 只对正向有效且显著的因子归一化
  const positiveSignificant = scored.filter(s => s.isPositive && s.isSignificant);
  const totalScore = positiveSignificant.reduce((sum, s) => sum + s.score, 0);

  return scored.map(s => {
    let reason: string;
    let weight: number;

    if (!s.isPositive) {
      // IC < 0：反向因子，建议降低权重或取负
      weight = s.score > 0 ? Math.max(2, s.score / (totalScore || 1) * 100 * 0.3) : 0;
      reason = `IC=${s.icMean.toFixed(4)}，与收益反向，建议降低权重`;
    } else if (!s.isSignificant) {
      // IC 有效但 IR 低，弱信号
      weight = Math.max(3, s.score / (totalScore || 1) * 100 * 0.5);
      reason = `IC=${s.icMean.toFixed(4)}，但 IR=${s.ir.toFixed(3)} 不够稳定，权重减半`;
    } else {
      // 标准情况
      weight = (totalScore > 0 ? s.score / totalScore * 100 : 0);
      reason = `IC=${s.icMean.toFixed(4)}，IR=${s.ir.toFixed(3)}，稳定性良好`;
    }

    return {
      factorName: s.factorName,
      ir: s.ir,
      icMean: s.icMean,
      weight: Math.round(weight * 10) / 10,
      period: s.period || '5d',
      reason,
    };
  });
}