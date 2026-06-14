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
 * 输出：归一化后的权重（IC 越高权重越大，IC<0 不给权重）
 */
export function deriveWeightsFromIC(
  factorICs: Record<string, { ic: number; ir: number }>
): Record<string, number> {
  const raw: Record<string, number> = {};
  let total = 0;
  for (const [name, { ic, ir }] of Object.entries(factorICs)) {
    if (ic > 0) {
      // 正向 IC 才给权重；权重 ∝ IC × IR
      const w = ic * Math.max(ir, 0.1);
      raw[name] = w;
      total += w;
    }
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
  factorICs: Record<string, { ic: number; ir: number }>,
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
