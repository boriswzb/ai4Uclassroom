/**
 * Factor v2 — 主入口
 *
 * 提供：
 * 1. scoreStocks() — 跑 v2 全流程
 * 2. computeV1VsV2Compare() — 同一票池跑 v1/v2，输出对比
 *
 * 外部用法（推荐）：
 *   import { scoreStocks, computeV1VsV2Compare } from '@/lib/quant/factor/v2';
 */

export * from './types';
export * from './factors';
export * from './alphas';
export * from './percentile';
export * from './neutralize';
export * from './real-moneyflow';
export * from './weights';
export {
  scoreV2,
  computeV1Pillars,
  type ScoreV2Input,
  type ScoreV2Output,
  type V1PillarScores,
} from './scorer';
export {
  runRecommendationWalkForward,
  type WalkForwardRecommendationConfig,
  type WalkForwardRecommendationReport,
  type WalkForwardWindowResult,
} from './walkforward-recommendation';
export {
  computeConcentration,
  type ConcentrationConfig,
  type ConcentrationReport,
} from './concentration';
export {
  optimizePortfolio,
  buildFactorCovariance,
  STYLE_FACTORS,
  type BarraConfig,
  type StyleFactor,
} from './barra-optimizer';

// ── 便捷入口（带 v1/v2 对比）─────────────────────────
import type { FactorRawValues, V2ScoreResult, V2ScoreOptions } from './types';
import { scoreV2, computeV1Pillars } from './scorer';

export interface V1V2CompareResult {
  v1: { code: string; name: string; compositeScore: number; rank: number; isLimitUp: boolean }[];
  v2: V2ScoreResult[];
  overlap: {
    top10: number;          // top10 重合数
    top10Rate: number;      // 0-1
    top20: number;
    top20Rate: number;
  };
  v1Bias: {
    avgChangePct: number;   // v1 top10 平均涨幅（应该接近 0 或略负，否则是追涨）
    limitUpCount: number;   // 涨停股数（应该 = 0）
    stCount: number;        // ST 数量（应该 = 0）
  };
  v2Bias: {
    avgChangePct: number;
    limitUpCount: number;
    stCount: number;
  };
  improvements: string[];
}

export function computeV1VsV2Compare(
  candidates: FactorRawValues[],
  options: V2ScoreOptions = {
    forwardPeriod: 5,
    neutralize: { industry: true, marketCap: true },
    weightMode: 'default',
    filterFlags: true,
  }
): V1V2CompareResult {
  // 跑 v2
  const v2Out = scoreV2({ candidates, options });

  // 跑 v1（不复用过滤，用全部票）
  const v1All = candidates.map(c => {
    const pillars = computeV1Pillars(c);
    return {
      code: c.code,
      name: c.name,
      compositeScore: pillars.compositeScore,
      changePct: c.changePercent,
      isST: /ST|退/.test(c.name),
      isLimitUp: c.changePercent >= 9.95,
    };
  }).sort((a, b) => b.compositeScore - a.compositeScore);

  const v1Top10 = v1All.slice(0, 10).map((r, i) => ({
    code: r.code,
    name: r.name,
    compositeScore: r.compositeScore,
    rank: i + 1,
    isLimitUp: r.isLimitUp,
  }));
  const v2Top10 = v2Out.results.slice(0, 10);

  // 重合度
  const v1Codes = new Set(v1Top10.map(r => r.code));
  const v2Codes = new Set(v2Top10.map(r => r.code));
  const top10 = v1Top10.filter(r => v2Codes.has(r.code)).length;

  const v1Top20 = new Set(v1All.slice(0, 20).map(r => r.code));
  const v2Top20 = new Set(v2Top10.map(r => r.code));
  const top20 = v1All.slice(0, 20).filter(r => v2Top20.has(r.code)).length;

  // 偏差统计
  const v1Bias = {
    avgChangePct: avg(v1Top10.map(r => candidates.find(c => c.code === r.code)?.changePercent ?? 0)),
    limitUpCount: v1Top10.filter(r => r.isLimitUp).length,
    stCount: v1Top10.filter(r => /ST|退/.test(r.name)).length,
  };
  const v2Bias = {
    avgChangePct: avg(v2Top10.map(r => r.changePercent)),
    limitUpCount: v2Top10.filter(r => r.flags.isLimitUp).length,
    stCount: v2Top10.filter(r => r.flags.isST).length,
  };

  // 改进点
  const improvements: string[] = [];
  if (v1Bias.limitUpCount > 0 && v2Bias.limitUpCount === 0) {
    improvements.push(`✅ 涨停过滤：v1 top10 有 ${v1Bias.limitUpCount} 只涨停，v2 已过滤为 0`);
  }
  if (v1Bias.stCount > 0 && v2Bias.stCount === 0) {
    improvements.push(`✅ ST 过滤：v1 有 ${v1Bias.stCount} 只 ST，v2 已过滤`);
  }
  if (Math.abs(v1Bias.avgChangePct) > 3 && Math.abs(v2Bias.avgChangePct) < 2) {
    improvements.push(`✅ 动量偏置降低：v1 平均涨 ${v1Bias.avgChangePct.toFixed(1)}% → v2 ${v2Bias.avgChangePct.toFixed(1)}%`);
  }
  if (v2Out.diagnostics.collinearityPairs.length > 0) {
    improvements.push(`📊 v2 检测到 ${v2Out.diagnostics.collinearityPairs.length} 对高相关因子（已记录）`);
  }
  if (v2Out.diagnostics.filteredCount > 0) {
    improvements.push(`🛡️ v2 过滤了 ${v2Out.diagnostics.filteredCount}/${v2Out.diagnostics.originalCount} 只异常股票`);
  }

  return {
    v1: v1Top10,
    v2: v2Top10,
    overlap: {
      top10,
      top10Rate: top10 / 10,
      top20,
      top20Rate: top20 / 20,
    },
    v1Bias,
    v2Bias,
    improvements,
  };
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
