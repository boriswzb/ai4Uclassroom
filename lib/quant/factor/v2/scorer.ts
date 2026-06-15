/**
 * Factor v2 — 主评分器
 *
 * 调用链：
 * 1. computeFactorPercentiles() — 截面百分位归一化
 * 2. neutralize() — 行业 + 市值中性化（OLS）
 * 3. checkCollinearity() — 共线性检测
 * 4. computeAndCacheV2Weights() — IC 动态定权（可选）
 * 5. scoreStocks() — 8 大类加权合成
 * 6. detectFlags() — ST/涨跌停/停牌/低流动性过滤
 *
 * 输入：候选池的 raw factor values
 * 输出：v2 评分结果（按 composite 降序）
 */

import type {
  FactorRawValues,
  FactorPercentiles,
  V2ScoreResult,
  V2ScoreOptions,
  ShenwanIndustry,
} from './types';
import { computeFactorPercentiles, checkCollinearity, fillIndustryMedian } from './percentile';
import { neutralize } from './neutralize';
import { detectFlags } from './factors';
import { V2_DEFAULT_WEIGHTS, deriveWeightsFromIC } from './weights';

// ── 评分（输入 pcts，输出 V2ScoreResult[]）────────────
function scoreFromPercentiles(
  pcts: FactorPercentiles[],
  raws: FactorRawValues[],
  weights: Record<string, number>,
  flagsList: V2ScoreResult['flags'][]
): V2ScoreResult[] {
  return pcts.map((p, i) => {
    const raw = raws[i];
    const flag = flagsList[i];

    // 8 大类分项（0-1 → 0-100）
    const valuation = p.valuation * 100;
    const quality = p.quality * 100;
    const momentum = p.momentum * 100;
    const reversal = p.reversal * 100;
    const moneyFlow = p.moneyFlow * 100;
    const technical = p.technical * 100;
    const turnover = p.turnover * 100;
    const wqAlpha = p.wqAlpha * 100;

    // 复合 = Σ(pillar × weight)
    const totalWeight = Object.values(weights).reduce((s, v) => s + v, 0) || 100;
    const norm = 100 / totalWeight;

    const composite = (
      valuation * (weights.valuation ?? V2_DEFAULT_WEIGHTS.valuation) +
      quality * (weights.quality ?? V2_DEFAULT_WEIGHTS.quality) +
      momentum * (weights.momentum ?? V2_DEFAULT_WEIGHTS.momentum) +
      reversal * (weights.reversal ?? V2_DEFAULT_WEIGHTS.reversal) +
      moneyFlow * (weights.moneyFlow ?? V2_DEFAULT_WEIGHTS.moneyFlow) +
      technical * (weights.technical ?? V2_DEFAULT_WEIGHTS.technical) +
      turnover * (weights.turnover ?? V2_DEFAULT_WEIGHTS.turnover) +
      wqAlpha * (weights.wqAlpha ?? V2_DEFAULT_WEIGHTS.wqAlpha)
    ) * norm / 100;

    // 因子贡献（归因用）
    const contributions = {
      valuation: valuation * (weights.valuation ?? V2_DEFAULT_WEIGHTS.valuation) * norm / 100,
      quality: quality * (weights.quality ?? V2_DEFAULT_WEIGHTS.quality) * norm / 100,
      momentum: momentum * (weights.momentum ?? V2_DEFAULT_WEIGHTS.momentum) * norm / 100,
      reversal: reversal * (weights.reversal ?? V2_DEFAULT_WEIGHTS.reversal) * norm / 100,
      moneyFlow: moneyFlow * (weights.moneyFlow ?? V2_DEFAULT_WEIGHTS.moneyFlow) * norm / 100,
      technical: technical * (weights.technical ?? V2_DEFAULT_WEIGHTS.technical) * norm / 100,
      turnover: turnover * (weights.turnover ?? V2_DEFAULT_WEIGHTS.turnover) * norm / 100,
      wqAlpha: wqAlpha * (weights.wqAlpha ?? V2_DEFAULT_WEIGHTS.wqAlpha) * norm / 100,
    };

    return {
      code: raw.code,
      name: raw.name,
      price: raw.price,
      changePercent: raw.changePercent,
      industry: raw.industry,
      valuation, quality, momentum, reversal, moneyFlow, technical, turnover, wqAlpha,
      composite: Math.round(composite * 100) / 100,
      rank: 0,  // 主流程后填
      contributions,
      weights: { ...weights },
      // 原始因子值（详情弹窗展示用）— 不含反向归一化
      rawFactors: raw,
      // 截面百分位（0-1；详情弹窗显示"在候选池中的排名"）
      percentiles: p,
      flags: flag,
    };
  });
}

// ── 主入口 ─────────────────────────────────────────
export interface ScoreV2Input {
  candidates: FactorRawValues[];
  options: V2ScoreOptions;
}

export interface ScoreV2Output {
  results: V2ScoreResult[];
  diagnostics: {
    percentileWarnings: string[];
    neutralizeWarnings: string[];
    collinearityWarnings: string[];
    collinearityPairs: { a: string; b: string; corr: number }[];
    filteredCount: number;
    originalCount: number;
    weightsUsed: Record<string, number>;
    weightSource: 'ic' | 'default' | 'manual';
    // P0 修复（2026-06-15）：暴露数据缺失率给前端 diagnostics UI
    dataLossRate?: Record<string, number>;
    dataLossWarnings?: string[];
  };
}

/**
 * 跑 v2 全流程
 */
export function scoreV2(input: ScoreV2Input): ScoreV2Output {
  const { candidates, options } = input;
  const originalCount = candidates.length;

  // 1. 检测 flags
  const flagsList = candidates.map(c => detectFlags(c));

  // 2. 过滤（ST/涨跌停/停牌/低流动性/次新）
  let filteredCandidates = candidates;
  let filteredFlags = flagsList;
  if (options.filterFlags) {
    const keepIdx: number[] = [];
    candidates.forEach((c, i) => {
      const f = flagsList[i];
      if (f.isST || f.isLimitUp || f.isLimitDown || f.isSuspended || f.isLowLiquidity) return;
      keepIdx.push(i);
    });
    filteredCandidates = keepIdx.map(i => candidates[i]);
    filteredFlags = keepIdx.map(i => flagsList[i]);
  }

  // 3. 截面百分位归一化
  // v2.1.1（2026-06-15）：先做缺失值填充（用行业中位数），再做百分位归一化
  const filledCandidates = fillIndustryMedian(filteredCandidates, [
    'pe', 'pb', 'ps', 'roe', 'grossMargin', 'debtRatio', 'accrualsRatio',
  ]);
  // v2.1.1（2026-06-15）：传入 icStats 让技术类因子按 IC 方向自适应反向；传入 longMomentum 启用长动量
  const { pcts, warnings: percentileWarnings } = computeFactorPercentiles(
    filledCandidates,
    { icStats: options.icStats, longMomentum: options.longMomentum }
  );

  // 4. 中性化（行业 + 市值）
  const industries = filteredCandidates.map(c => c.industry);
  const { pcts: neutralPcts, warnings: neutralizeWarnings } = neutralize(
    pcts,
    industries,
    { industry: options.neutralize.industry, marketCap: options.neutralize.marketCap }
  );

  // 5. 共线性检测
  const factorNames: (keyof FactorPercentiles)[] = [
    'valuation', 'quality', 'momentum', 'reversal', 'moneyFlow',
    'technical', 'turnover', 'wqAlpha',
  ];
  const { pairs: collinearityPairs, warnings: collinearityWarnings } =
    checkCollinearity(neutralPcts, factorNames, 0.7);

  // 6. 选权重
  //    v2.1（2026-06-15）：新增 'ic' 模式支持 — 之前 weightMode='ic' 是个空选项（只 'manual' 生效）
  //      现在用本地算出的 icStats（来自 route.ts computeSimpleIC）覆盖默认权重
  //      IC 历史有 1+ 条时优先用 IC 派生，否则降级 default
  let weightsUsed: Record<string, number>;
  let weightSource: 'default' | 'ic' | 'manual';
  if (options.weightMode === 'manual' && options.customWeights) {
    weightsUsed = { ...options.customWeights };
    weightSource = 'manual';
  } else if (options.weightMode === 'ic' && options.icStats && Object.keys(options.icStats).length >= 3) {
    // IC 动态定权：|IC| × tanh(|IR|)，保留正负号
    weightsUsed = deriveWeightsFromIC(options.icStats);
    weightSource = 'ic';
  } else {
    weightsUsed = { ...V2_DEFAULT_WEIGHTS };
    weightSource = 'default';
  }

  // ── P0 修复（2026-06-15）：原始数据缺失率检测 + 自动降权 ───────
  // 背景：EM 财务接口在服务端 100% 失败时，roe/grossMargin 全 0、debtRatio 全 50（defaults），
  //   即便 percentile/neutralize 两层都修了（前面已置 0.5），这一大类的"区分能力"仍然是 0。
  // 检测：每只票的 quality 原始值 = (roe_pct + gm_pct + dr_pct) 三个 pct 的均值。
  //   当 roe/gm/dr 三个 raw 中两个以上是 0/默认时，认为该股 quality 数据缺失。
  // 阈值：>50% 候选缺失则把 quality 权重降为 0（其它大类按比例放大补偿）
  // 范围（保守）：valuation 也做同样检测（PE 来自 sina，PB 来自 EM）
  const dataLossWarnings: string[] = [];
  const factorLossRate: Record<string, number> = {};
  const lossDetect = (factor: 'quality' | 'valuation'): { keys: (keyof FactorRawValues)[] } => {
    if (factor === 'quality') return { keys: ['roe', 'grossMargin', 'debtRatio'] };
    return { keys: ['pe', 'pb', 'ps'] };
  };
  for (const factor of ['quality', 'valuation'] as const) {
    const { keys } = lossDetect(factor);
    let missing = 0;
    for (const c of filteredCandidates) {
      // 缺失判定：raw 值是 defaults（roe=0, gm=0, debtRatio=50, pe=0, pb=0, ps=0）
      const isMissing = keys.every((k) => {
        const v = c[k] as number;
        // debtRatio 默认 50，roe/gm/pe/pb/ps 默认 0
        return v === 0 || v === 50;
      });
      if (isMissing) missing++;
    }
    const rate = filteredCandidates.length > 0 ? missing / filteredCandidates.length : 0;
    factorLossRate[factor] = rate;
    if (rate > 0.5) {
      dataLossWarnings.push(`⚠️ ${factor} 原始数据 ${(rate * 100).toFixed(0)}% 缺失（接口失败），自动降权至 0`);
      weightsUsed[factor] = 0;
    } else if (rate > 0.2) {
      dataLossWarnings.push(`⚠️ ${factor} 原始数据 ${(rate * 100).toFixed(0)}% 缺失（接口降级）`);
    }
  }
  // 权重归一化：被降权为 0 后剩余的权重按比例放大，确保综合分总量稳定
  const totalWeight = Object.values(weightsUsed).reduce((s, v) => s + v, 0);
  if (totalWeight > 0 && totalWeight < 100) {
    const scale = 100 / totalWeight;
    for (const k of Object.keys(weightsUsed)) {
      weightsUsed[k] = Math.round(weightsUsed[k] * scale * 100) / 100;
    }
    dataLossWarnings.push(`ℹ️ 权重按剩余总和归一化（×${scale.toFixed(2)}）`);
  }

  // 7. 评分
  let results = scoreFromPercentiles(neutralPcts, filteredCandidates, weightsUsed, filteredFlags);

  // 8. 排序
  results.sort((a, b) => b.composite - a.composite);
  results.forEach((r, i) => { r.rank = i + 1; });

  return {
    results,
    diagnostics: {
      percentileWarnings,
      neutralizeWarnings,
      collinearityWarnings,
      collinearityPairs,
      filteredCount: originalCount - filteredCandidates.length,
      originalCount,
      weightsUsed,
      weightSource,
      // P0 修复：暴露数据缺失率给前端
      dataLossRate: factorLossRate,
      dataLossWarnings,
    },
  };
}

// ── 复用：v1 旧 3-pillar 评分（仅供对比，禁止新调用）───────
/**
 * ⚠️ DEPRECATED — 仅作为「历史策略基线」保留，禁止在生产路径中调用。
 *
 * 历史：模拟 factor-analysis/route.ts:1003-1023 的 3-pillar 评分
 *       v1 endpoint `/api/stock/factor-analysis` 和 v1 页面
 *       `/quant/factor-analysis` 已于 README 注明废弃并删除。
 *
 * 允许调用方：
 *   - `lib/quant/factor/v1-vs-v2-backtest.ts`（回测对比）
 *   - `lib/quant/factor/v2/compare.ts`（对比报告）
 *
 * 禁止：
 *   - 新建任何 v1 端点或页面
 *   - 在 scoreV2/screener/simulator 等生产路径里调用本函数
 *   - 复制本函数到其他地方去"复活" v1 流程
 */
export interface V1PillarScores {
  momentumScore: number;
  moneyFlowScore: number;
  technicalScore: number;
  compositeScore: number;
}

export function computeV1Pillars(c: FactorRawValues, regime = 'uncertain'): V1PillarScores {
  // 子项（从 raw 转 0-100 子分）
  const momScore = Math.max(0, Math.min(100, 50 + c.momentum20 * 200));
  const mom5Score = Math.max(0, Math.min(100, 50 + c.momentum5 * 500));
  const mom20Score = Math.max(0, Math.min(100, 50 + c.momentum20 * 200));
  const biasScore = Math.max(0, 100 - Math.abs(c.bias20) * 20);

  // v1 公式（完全照搬旧代码）
  const momentumScore = (momScore * 0.4 + mom5Score * 0.2 + mom20Score * 0.2 + biasScore * 0.2);

  // 资金流子分（v1 价推量伪逻辑的近似）
  const mfiScore = c.macdHist !== 0 ? Math.max(0, Math.min(100, 50 + c.macdHist * 1000)) : 50;
  const wrScore = Math.max(0, Math.min(100, c.rsi14));
  const adxScore = Math.min(100, c.adx * 2);
  const moneyFlowScore = (mfiScore * 0.4 + wrScore * 0.3 + adxScore * 0.3);

  // 技术面子分
  const rsiScore = c.rsi14;
  const bollScore = c.bollPosition * 100;
  const macdScore = c.macdHist !== 0 ? (c.macdHist > 0 ? Math.min(100, 60 + c.macdHist * 1000) : Math.max(0, 40 - Math.abs(c.macdHist) * 1000)) : 50;
  const kdjScore = c.kdjK;
  const volScore = Math.max(0, 100 - c.lowVolatility * 2000);
  const technicalScore = (rsiScore * 0.2 + bollScore * 0.2 + macdScore * 0.2 + kdjScore * 0.2 + volScore * 0.2);

  // marketRegime 调整
  const mults: Record<string, { m: number; mf: number; t: number }> = {
    strong_uptrend: { m: 1.3, mf: 1.0, t: 0.8 },
    weak_uptrend: { m: 1.1, mf: 1.0, t: 0.9 },
    strong_downtrend: { m: 0.7, mf: 1.2, t: 1.1 },
    weak_downtrend: { m: 0.8, mf: 1.1, t: 1.0 },
    high_volatility: { m: 0.8, mf: 1.0, t: 1.2 },
    low_volatility: { m: 1.0, mf: 0.9, t: 1.0 },
    uncertain: { m: 0.9, mf: 1.0, t: 1.0 },
  };
  const mult = mults[regime] || mults.uncertain;

  const compositeScore = (
    momentumScore * mult.m * 0.4 +
    moneyFlowScore * mult.mf * 0.3 +
    technicalScore * mult.t * 0.3
  );

  return {
    momentumScore: Math.round(momentumScore * 100) / 100,
    moneyFlowScore: Math.round(moneyFlowScore * 100) / 100,
    technicalScore: Math.round(technicalScore * 100) / 100,
    compositeScore: Math.round(compositeScore * 100) / 100,
  };
}
