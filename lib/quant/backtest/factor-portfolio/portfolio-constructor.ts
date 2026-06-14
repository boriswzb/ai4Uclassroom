/**
 * 组合构建器 — PortfolioConstructor
 *
 * 职责：根据截面评分排名和权重分配方式，构建目标持仓组合
 */

import {
  StockScore,
  PortfolioTarget,
  PortfolioHolding,
  WeightMethod,
} from '../../types';

export class PortfolioConstructor {
  private topN: number;
  private weightMethod: WeightMethod;
  private maxSinglePosition: number;

  constructor(
    topN: number,
    weightMethod: WeightMethod,
    maxSinglePosition = 0.2
  ) {
    this.topN = topN;
    this.weightMethod = weightMethod;
    this.maxSinglePosition = maxSinglePosition;
  }

  /**
   * 根据截面评分构建目标组合
   * @param scores 已排序的截面评分
   * @param totalCapital 总资金（用于计算各股的资金分配）
   */
  build(scores: StockScore[]): PortfolioTarget {
    // 取 topN 且 direction !== 'short' 的股票
    const candidates = scores
      .filter(s => s.direction !== 'short' && s.rank <= this.topN * 2) // 初选2倍
      .slice(0, this.topN);

    if (candidates.length === 0) {
      return { date: '', holdings: [] };
    }

    // 计算权重
    const holdings = this.computeWeights(candidates);
    return { date: '', holdings };
  }

  private computeWeights(candidates: StockScore[]): PortfolioHolding[] {
    const n = candidates.length;
    if (n === 0) return [];

    let weights: number[];

    switch (this.weightMethod.type) {
      case 'equal':
        // 等权
        weights = candidates.map(() => 1 / n);
        break;

      case 'score-proportional': {
        // 按评分比例
        const minScore = Math.min(...candidates.map(s => s.compositeScore));
        const adjusted = candidates.map(s => Math.max(0, s.compositeScore - minScore));
        const total = adjusted.reduce((a, b) => a + b, 0);
        if (total === 0) {
          weights = candidates.map(() => 1 / n);
        } else {
          weights = adjusted.map(v => v / total);
        }
        if (this.weightMethod.normalize) {
          // 归一化使权重和为1
          const wTotal = weights.reduce((a, b) => a + b, 0);
          weights = weights.map(w => w / wTotal);
        }
        break;
      }

      case 'risk-parity': {
        // 风险平价：波动率倒数加权（简化：用 momentum20 绝对值作为风险代理）
        const riskProxy = candidates.map(s =>
          Math.abs(s.factorContributions?.momentum ?? 50)
        );
        const invRisk = riskProxy.map(r => 1 / (r + 1));
        const total = invRisk.reduce((a, b) => a + b, 0);
        weights = total > 0 ? invRisk.map(v => v / total) : candidates.map(() => 1 / n);
        break;
      }

      default:
        weights = candidates.map(() => 1 / n);
    }

    // 应用单股最大权重限制
    weights = weights.map(w => Math.min(w, this.maxSinglePosition));

    // 归一化确保和为1
    const wSum = weights.reduce((a, b) => a + b, 0);
    if (wSum > 0) weights = weights.map(w => w / wSum);

    return candidates.map((s, i) => ({
      code: s.code,
      weight: Math.round(weights[i] * 10000) / 10000,
      reason: `rank=${s.rank}, score=${s.compositeScore.toFixed(1)}`,
    }));
  }
}
