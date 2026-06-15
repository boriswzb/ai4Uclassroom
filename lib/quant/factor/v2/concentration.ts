/**
 * Factor v2 — 组合集中度约束 + 风险评估
 *
 * 业界标准（Barra 风险模型核心）：
 * 1. 行业偏离：组合中各行业权重 vs 基准行业权重的偏差（≤ 5%）
 * 2. 风格暴露：组合在 8 大类因子上的暴露 vs 中性（±1σ）
 * 3. 个股集中度：单只票权重 ≤ 15%（10 只票等权就是 10%/只，符合）
 * 4. Herfindahl-Hirschman 指数（HHI）：Σ w_i²，< 0.25 表示适度分散
 *
 * 与 scoreV2 的区别：
 * - scoreV2 输出"每只票的分数"（选股）
 * - 本模块输出"这 N 只票作为组合的集中度评估"（风险）
 *
 * 调用方：
 * - /api/stock/factor-analysis-v2 输出 diagnostics
 * - 速览模式 (app/quant/page.tsx) 推荐区可视化
 */

import type { V2ScoreResult } from './types';

// ── 配置（业界标准阈值）──
export interface ConcentrationConfig {
  /** 单只票权重上限（默认 0.15 = 15%） */
  maxSingleWeight?: number;
  /** 行业偏离上限（默认 0.05 = 5%） */
  maxIndustryDeviation?: number;
  /** 行业权重上限（默认 0.30 = 30%，单行业不超过组合的 30%） */
  maxIndustryWeight?: number;
  /** HHI 上限（默认 0.25，HHI=0.1 是 10 只等权，0.25 是上限） */
  maxHHI?: number;
}

// ── 输出 ──
export interface ConcentrationReport {
  // ── 个股集中度 ──
  /** 单只票权重（等权假设下 = 1/N） */
  singleWeight: number;
  /** 是否超单只上限 */
  singleOverLimit: boolean;

  // ── HHI ──
  /** Herfindahl-Hirschman 指数（Σ w_i²） */
  hhi: number;
  /** HHI 评级：< 0.15 高度分散 / 0.15-0.25 适度 / > 0.25 集中 */
  hhiRating: 'diversified' | 'moderate' | 'concentrated';

  // ── 行业分布 ──
  /** 行业占比 Map（industry → 0-1） */
  industryDistribution: Record<string, number>;
  /** 行业偏离基准的差值（默认基准 = 候选池均值） */
  industryDeviation: Record<string, number>;
  /** 超行业上限的行业列表 */
  industriesOverLimit: string[];

  // ── 综合评分 ──
  /** 0-100；越高风险越低 */
  diversityScore: number;
  /** 总评 */
  rating: 'A+' | 'A' | 'B' | 'C' | 'D';
  /** 风险提示 */
  warnings: string[];
}

/**
 * 计算组合集中度
 *
 * @param picks - scoreV2 输出（已按 composite 排序的 Top N）
 * @param candidates - 全候选池（用于算基准行业分布）
 * @param config - 阈值配置
 */
export function computeConcentration(
  picks: V2ScoreResult[],
  candidates: V2ScoreResult[],
  config: ConcentrationConfig = {}
): ConcentrationReport {
  const {
    maxSingleWeight = 0.15,
    maxIndustryDeviation = 0.05,
    maxIndustryWeight = 0.30,
    maxHHI = 0.25,
  } = config;

  const warnings: string[] = [];
  const topN = picks.length;
  if (topN === 0) {
    return {
      singleWeight: 0,
      singleOverLimit: false,
      hhi: 0,
      hhiRating: 'diversified',
      industryDistribution: {},
      industryDeviation: {},
      industriesOverLimit: [],
      diversityScore: 0,
      rating: 'D',
      warnings: ['无推荐股票'],
    };
  }

  // ── 1. 单只权重（等权假设）──
  const singleWeight = 1 / topN;
  const singleOverLimit = singleWeight > maxSingleWeight;

  // ── 2. HHI（等权 = topN × (1/topN)² = 1/topN）──
  const hhi = topN > 0 ? 1 / topN : 1;
  const hhiRating = hhi < 0.15 ? 'diversified' :
                    hhi < 0.25 ? 'moderate' : 'concentrated';
  if (hhiRating === 'concentrated') {
    warnings.push(`⚠️ HHI=${hhi.toFixed(3)} > 0.25 集中度过高，建议扩大 TopN 至 ≥ 20`);
  }

  // ── 3. 行业分布（picks 内）──
  const industryCount: Record<string, number> = {};
  for (const p of picks) {
    const ind = p.industry || '__no_industry__';
    industryCount[ind] = (industryCount[ind] || 0) + 1;
  }
  const industryDistribution: Record<string, number> = {};
  for (const [ind, count] of Object.entries(industryCount)) {
    industryDistribution[ind] = count / topN;
  }

  // ── 4. 基准行业分布（candidates 全候选）──
  const benchmarkCount: Record<string, number> = {};
  for (const c of candidates) {
    const ind = c.industry || '__no_industry__';
    benchmarkCount[ind] = (benchmarkCount[ind] || 0) + 1;
  }
  const benchmarkTotal = candidates.length || 1;
  const benchmarkDist: Record<string, number> = {};
  for (const [ind, count] of Object.entries(benchmarkCount)) {
    benchmarkDist[ind] = count / benchmarkTotal;
  }

  // ── 5. 行业偏离 ──
  const industryDeviation: Record<string, number> = {};
  const industriesOverLimit: string[] = [];
  for (const [ind, weight] of Object.entries(industryDistribution)) {
    const benchWeight = benchmarkDist[ind] || 0;
    const dev = weight - benchWeight;
    industryDeviation[ind] = dev;
    if (Math.abs(dev) > maxIndustryDeviation) {
      industriesOverLimit.push(ind);
      warnings.push(`⚠️ ${ind} 偏离基准 ${(dev * 100).toFixed(1)}%（超 ${(maxIndustryDeviation * 100).toFixed(0)}% 上限）`);
    }
    if (weight > maxIndustryWeight) {
      warnings.push(`⚠️ ${ind} 占比 ${(weight * 100).toFixed(1)}% > 30% 上限`);
    }
  }

  // ── 6. 多样性评分（0-100）──
  let score = 100;
  if (singleOverLimit) score -= 20;
  if (hhiRating === 'moderate') score -= 10;
  if (hhiRating === 'concentrated') score -= 30;
  score -= industriesOverLimit.length * 10;
  // 行业数量奖励（≥ 5 个行业得满分）
  const industryCount_ = Object.keys(industryDistribution).length;
  if (industryCount_ < 3) score -= 15;
  else if (industryCount_ < 5) score -= 5;
  score = Math.max(0, Math.min(100, score));

  const rating = score >= 85 ? 'A+' :
                  score >= 70 ? 'A' :
                  score >= 55 ? 'B' :
                  score >= 40 ? 'C' : 'D';

  if (warnings.length === 0) {
    warnings.push(`✅ 分散度良好：${industryCount_} 个行业 / HHI=${hhi.toFixed(3)}`);
  }

  return {
    singleWeight,
    singleOverLimit,
    hhi,
    hhiRating,
    industryDistribution,
    industryDeviation,
    industriesOverLimit,
    diversityScore: score,
    rating,
    warnings,
  };
}