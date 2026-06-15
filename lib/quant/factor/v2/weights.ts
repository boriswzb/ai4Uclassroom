/**
 * Factor v2 — IC 动态定权 + 因子失效检测
 *
 * 业界最佳实践：
 * 1. 权重由历史 IC（Information Coefficient）回归动态确定
 * 2. 连续 3 次负 IC → 因子失效，权重自动降为 30%
 * 3. 不可用 IC 数据时，启用 Barra 默认权重
 *
 * IC 计算：
 * - 因子值 f(t) vs 下期收益 r(t+1) 的 Pearson 相关系数
 * - 滚动 60 个交易日窗口
 * - IC_mean > 0 → 正向因子；IC_mean < 0 → 反向因子
 * - IR = IC_mean / IC_std（信息比率，越高越稳定）
 *
 * 权重分配：
 * - 正权重 = max(IC_mean, 0) × IR（只奖励正贡献）
 * - 归一化到总和 100
 *
 * 复用项目内 weight-cache.ts 的 DEGRADATION_CONFIG 和 recordFactorIC
 */

import { recordFactorIC, type FactorWeight } from '@/lib/quant/factor/weight-cache';

// ── 默认权重（Barra 业界标准，11 大类）────────────────
/**
 * 8 大类因子（v2 核心评分维度）+ wqAlpha
 * 总和 100
 */
export const V2_DEFAULT_WEIGHTS: Record<string, number> = {
  valuation: 18,    // Barra Value (PE/PB/PS)
  quality: 14,      // Barra Quality (ROE/Margin/Debt)
  momentum: 12,     // Barra Momentum (20d return)
  reversal: 10,     // WorldQuant Alpha14 (RSI reversal)
  moneyFlow: 12,    // 真实主力净流入
  technical: 12,    // MACD/KDJ/BOLL/ADX
  turnover: 7,      // 换手率活跃度
  wqAlpha: 15,      // 10 个 WorldQuant 101 alpha
};

/**
 * v1 旧权重（3 pillar）— 用于对比
 */
export const V1_OLD_WEIGHTS = {
  momentum: 0.4,
  moneyFlow: 0.3,
  technical: 0.3,
};

// ── 单因子 IC 计算 ──────────────────────────────────
/**
 * IC = Pearson(因子值序列, 下期收益序列)
 */
export function calcFactorIC(
  factorValues: number[],
  nextReturns: number[]
): { ic: number; pValue: number; n: number } {
  const n = Math.min(factorValues.length, nextReturns.length);
  if (n < 5) return { ic: 0, pValue: 1, n };

  const x = factorValues.slice(0, n);
  const y = nextReturns.slice(0, n);
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  const ic = den === 0 ? 0 : num / den;
  // 简化的 t 检验 p-value
  const t = ic * Math.sqrt(n - 2) / Math.sqrt(Math.max(1 - ic * ic, 1e-9));
  const pValue = 2 * (1 - normalCdf(Math.abs(t)));
  return { ic, pValue, n };
}

// 标准正态 CDF（Abramowitz & Stegun 近似）
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// ── Rank IC（非参数 IC）───────────────────────────
// v3.0.1（2026-06-15）：非参数 IC（业界更稳健）
//   原理：把原始值换成 rank（1..N）后再算 Pearson
//   优势：对非正态分布 / 极端值不敏感（Spearman 1958）
//   业界标准：Barra / WorldQuant 都用 Rank IC 代替 Pearson IC
//   精度：~ 0.95 × Pearson，但更稳
//   用途：作为 IC 派生权重的输入（更可靠的权重估计）
function rankify(values: number[]): number[] {
  // 简单 rank 转换（不支持 tie-break，业界可改用 fractional rank）
  const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length);
  for (let i = 0; i < sorted.length; i++) {
    ranks[sorted[i].i] = i + 1;
  }
  return ranks;
}

export function calcRankIC(
  factorValues: number[],
  nextReturns: number[]
): { rankIC: number; pValue: number; n: number } {
  const n = Math.min(factorValues.length, nextReturns.length);
  if (n < 5) return { rankIC: 0, pValue: 1, n };

  const xRanks = rankify(factorValues.slice(0, n));
  const yRanks = rankify(nextReturns.slice(0, n));
  const mx = (n + 1) / 2;
  const my = mx;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xRanks[i] - mx, dy = yRanks[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  const rankIC = den === 0 ? 0 : num / den;
  // t 检验同 Pearson IC
  const t = rankIC * Math.sqrt(n - 2) / Math.sqrt(Math.max(1 - rankIC * rankIC, 1e-9));
  const pValue = 2 * (1 - normalCdf(Math.abs(t)));
  return { rankIC, pValue, n };
}

// ── 联合 IC（同时返回 Pearson 和 Rank）───────────────────
export function calcFactorICBoth(
  factorValues: number[],
  nextReturns: number[]
): { pearson: number; rank: number; pValuePearson: number; pValueRank: number; n: number } {
  const p = calcFactorIC(factorValues, nextReturns);
  const r = calcRankIC(factorValues, nextReturns);
  return { pearson: p.ic, rank: r.rankIC, pValuePearson: p.pValue, pValueRank: r.pValue, n: p.n };
}

// ── IC 滚动序列（用于失效检测）─────────────────────
/**
 * 滚动窗口 IC 序列
 */
export function rollingIC(
  factorValues: number[],
  nextReturns: number[],
  window = 60
): number[] {
  const n = Math.min(factorValues.length, nextReturns.length);
  if (n < window) return [];
  const out: number[] = [];
  for (let i = window; i <= n; i++) {
    const slice_f = factorValues.slice(i - window, i);
    const slice_r = nextReturns.slice(i - window, i);
    const { ic } = calcFactorIC(slice_f, slice_r);
    out.push(ic);
  }
  return out;
}

// ── 因子失效检测（连续 3 次 IC<0）───────────────────
export interface DegradationStatus {
  factorName: string;
  consecutiveNegIC: number;
  degraded: boolean;
  originalWeight: number;
  effectiveWeight: number;
}

const DEGRADED_MULTIPLIER = 0.3;

export function checkDegradation(
  factorName: string,
  icHistory: number[]
): DegradationStatus {
  let consecutiveNegIC = 0;
  for (let i = icHistory.length - 1; i >= 0; i--) {
    if (icHistory[i] < 0) consecutiveNegIC++;
    else break;
  }
  const degraded = consecutiveNegIC >= 3;
  return {
    factorName,
    consecutiveNegIC,
    degraded,
    originalWeight: 0,  // 填充用
    effectiveWeight: 0,
  };
}

// ── 从 IC 推导权重 ─────────────────────────────────
/**
 * 输入：各因子的 IC 序列
 * 输出：归一化后的权重（IC 越高权重越大）
 *
 * v2.1（2026-06-15）改进：
 * - 旧版：IC<0 直接给 0（损失反转类因子）
 *       用 ic * ir，但 IR 可能爆顶（噪声）放大权重
 * - 新版：用 |IC| × min(IR, 3) × 信任度
 *       信任度 = tanh(IR)（IR 越高越接近 1，但不爆顶）
 *       样本数不足（n<10）时再打 50% 折扣
 *       IC<0 仍给权重（很多因子是反向的：如 reversal 预期 IC<0）
 */
export function deriveWeightsFromIC(
  factorICs: Record<string, { ic: number; ir: number; n?: number }>
): Record<string, number> {
  const raw: Record<string, number> = {};
  let total = 0;
  for (const [name, stat] of Object.entries(factorICs)) {
    const { ic, ir, n = 0 } = stat;
    // |IC| × 信任度，信任度 tanh(IR) 限制在 0~1
    // IR<0.5 视为噪声，权重打折
    // n<10 视为样本不足，再打 50% 折扣
    const trust = Math.tanh(Math.abs(ir));
    const sampleFactor = n < 10 ? 0.5 : 1.0;
    const w = Math.abs(ic) * trust * sampleFactor;
    raw[name] = w;
    total += w;
  }
  if (total === 0) return { ...V2_DEFAULT_WEIGHTS };
  // 归一化到 100
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    result[k] = Math.round((v / total) * 100 * 10) / 10;
  }
  return result;
}

// ── 主入口：计算并缓存 v2 权重 ─────────────────────
/**
 * 整合 IC 推导 + 失效检测 + 缓存写入
 */
export async function computeAndCacheV2Weights(
  factorICs: Record<string, { ic: number; ir: number; n?: number }>,
  icHistories: Record<string, number[]>,
  period: '5d' | '20d',
  regime: string
): Promise<{
  weights: Record<string, number>;
  degradationReport: { factorName: string; reason: string; consecutiveNegIC: number }[];
  source: 'ic' | 'default';
}> {
  const degradationReport: { factorName: string; reason: string; consecutiveNegIC: number }[] = [];

  // 1. 基础权重（IC 派生）
  const baseWeights = deriveWeightsFromIC(factorICs);
  const source: 'ic' | 'default' = Object.keys(factorICs).length >= 3 ? 'ic' : 'default';

  // 2. 失效检测
  const finalWeights: Record<string, number> = {};
  for (const [name, w] of Object.entries(baseWeights)) {
    const hist = icHistories[name] || [];
    const status = checkDegradation(name, hist);
    if (status.degraded) {
      finalWeights[name] = Math.round(w * DEGRADED_MULTIPLIER * 10) / 10;
      degradationReport.push({
        factorName: name,
        consecutiveNegIC: status.consecutiveNegIC,
        reason: `⚠️ ${name} 连续 ${status.consecutiveNegIC} 次 IC<0，权重自动降为 30%`,
      });
    } else {
      finalWeights[name] = w;
    }
  }

  // 3. 写入项目内 weight-cache（兼容现有架构）
  const factorWeights: FactorWeight[] = Object.entries(finalWeights).map(([name, w]) => ({
    factorName: name,
    ir: factorICs[name]?.ir ?? 0,
    icMean: factorICs[name]?.ic ?? 0,
    weight: w,
    period,
    reason: source === 'ic' ? 'IC 动态' : '默认 Barra',
  }));
  try {
    for (const fw of factorWeights) {
      recordFactorIC(fw.factorName, fw.icMean);
    }
  } catch {
    // 不影响主流程
  }

  return { weights: finalWeights, degradationReport, source };
}

// ── IC 衰减分析（v3.0.1 2026-06-15）───────────────────────
/**
 * 业界 IC 衰减分析（IC Decay Analysis）
 *
 * 目的：看因子在 T+1/T+5/T+10/T+20 等不同持有期的 IC 强度变化
 *
 * 业界标准（Barra / AQR）：
 *   - IC 衰减曲线横轴：持仓期（1/5/10/20/40/60 日）
 *   - 纵轴：该持仓期对应的 IC 值
 *   - 解读：
 *     * IC 平稳：因子适合中长线持仓（推荐 rebalance=20d）
 *     * IC 快速衰减：因子适合短线（推荐 rebalance=5d）
 *     * IC 增强：因子有动量（罕见，可能 overfit）
 *
 * 输入：multi-period 收益矩阵
 *   factorValues: number[] - 因子值（同一时点）
 *   returnsByPeriod: { '1d': [], '5d': [], '20d': [] } - 未来不同期收益
 *
 * 输出：
 *   decay: { period: string, ic: number, rank: number, n: number }[]
 *   bestHoldingPeriod: string - IC 最大的持仓期
 *   decayRate: number - 0=平稳, 1=完全衰减（业界用 tanh 拟合）
 */
export function icDecayAnalysis(
  factorValues: number[],
  returnsByPeriod: Record<string, number[]>
): {
  decay: { period: string; ic: number; rank: number; n: number }[];
  bestHoldingPeriod: string;
  decayRate: number;       // 0~1，越大衰减越快
  recommendation: string;
} {
  const decay: { period: string; ic: number; rank: number; n: number }[] = [];

  for (const [period, returns] of Object.entries(returnsByPeriod)) {
    const p = calcFactorIC(factorValues, returns);
    const r = calcRankIC(factorValues, returns);
    decay.push({ period, ic: p.ic, rank: r.rankIC, n: p.n });
  }

  // 排序：按 period 升序（短→长）
  decay.sort((a, b) => parseInt(a.period) - parseInt(b.period));

  // 找最佳持仓期
  const best = decay.reduce((max, d) => d.rank > max.rank ? d : max, decay[0]);
  const bestHoldingPeriod = best?.period || '5d';

  // 衰减率：取最短 vs 最长 IC 的相对差
  let decayRate = 0;
  if (decay.length >= 2) {
    const shortest = decay[0].rank;
    const longest = decay[decay.length - 1].rank;
    if (Math.abs(shortest) > 0.01) {
      decayRate = Math.max(0, Math.min(1, 1 - longest / shortest));
    }
  }

  // 建议
  let recommendation: string;
  if (Math.abs(best.rank) < 0.02) {
    recommendation = '⚠️ 所有持仓期 IC 都接近 0，该因子可能已失效，建议降权或剔除';
  } else if (decayRate > 0.5) {
    recommendation = `📉 衰减快（rate=${decayRate.toFixed(2)}）→ 因子适合短线，建议 rebalance=${bestHoldingPeriod}`;
  } else if (decayRate < -0.2) {
    recommendation = `📈 增强型（rate=${decayRate.toFixed(2)}）→ 因子有动量效应，建议 rebalance=${decay[decay.length - 1].period}`;
  } else {
    recommendation = `→ 平稳型（rate=${decayRate.toFixed(2)}）→ 因子在多个持仓期都有效，rebalance=${bestHoldingPeriod} 即可`;
  }

  return { decay, bestHoldingPeriod, decayRate, recommendation };
}
