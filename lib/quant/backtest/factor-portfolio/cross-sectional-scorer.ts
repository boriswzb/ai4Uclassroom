/**
 * 截面评分器 — CrossSectionalScorer
 *
 * 职责：
 * 1. 调用 getCachedWeights() 获取 IC/IR 因子权重
 * 2. 用截面百分位因子计算每只股票的 Barra 风格综合评分
 * 3. 输出排名后的 StockScore[]
 *
 * 复用：screener/route.ts 的 scoreStock() 核心逻辑 + IC_TO_SCREENER_KEY 映射
 */

import {
  StockFactorSnapshot,
  StockScore,
} from '../../types';
import {
  getCachedWeights,
  IC_TO_SCREENER_KEY,
  type FactorWeight,
} from '../../factor/weight-cache';
import {
  preComputeFactorPercentiles,
  CrossSectionalDataLoader,
  PercentileResult,
} from './cross-sectional-loader';

// ==================== 工具函数（从 screener/route.ts 抽取） ====================

/** 多因子评分（Barra 风格）
 * 这个函数等价于 screener/route.ts 的 scoreStock()
 * 只依赖 pct（截面百分位）和 weights（IC/IR 权重）
 */
function scoreStockFromPct(
  pct: Record<string, number>,
  weights: Record<string, number>
): { total: number; contributions: Record<string, number> } {
  const w = (key: string, defaultVal: number) => weights[key] ?? defaultVal;

  // 1. 估值得分（PE/PB 百分位均值，越被低估分越高）
  const valuation = ((pct.pe + pct.pb) / 2) * (w('pe', 0) / 100);

  // 2. 质量得分
  const quality = pct.quality * (w('quality', 0) / 100);

  // 3. 动量得分
  const momentum = pct.momentum * (w('momentum', 0) / 100);

  // 4. 反转得分（RSI低/跌得多 = 超卖 = 给分高）
  const reversal = ((pct.reversal + (pct.rsiReversal ?? 0)) / 2) * (w('reversal', 0) / 100);

  // 5. 资金流得分
  const moneyFlow = pct.moneyFlow * (w('moneyFlow', 0) / 100);

  // 6. 技术信号得分
  const technical = pct.technical * (w('technical', 0) / 100);

  // 7. 换手率
  const turnover = pct.turnover * (w('turnover', 0) / 100);

  const total = Math.max(0, Math.min(100,
    Math.round((valuation + quality + momentum + reversal + moneyFlow + technical + turnover) * 100) / 100
  ));

  return {
    total,
    contributions: {
      valuation: Math.round(valuation * 100) / 100,
      quality: Math.round(quality * 100) / 100,
      momentum: Math.round(momentum * 100) / 100,
      reversal: Math.round(reversal * 100) / 100,
      moneyFlow: Math.round(moneyFlow * 100) / 100,
      technical: Math.round(technical * 100) / 100,
      turnover: Math.round(turnover * 100) / 100,
    },
  };
}

// ==================== 截面评分器 ====================

export interface ScorerConfig {
  /** 显式传入因子权重（优先级高于 weight-cache） */
  factorWeights?: FactorWeight[] | null;
  /** 评分阈值：综合评分低于此值视为 neutral 信号（不出现在组合中） */
  scoreThreshold?: number;
}

export class CrossSectionalScorer {
  private weights: Record<string, number> = {};
  private factorWeightList: FactorWeight[] = [];
  private scoreThreshold: number;

  constructor(config: ScorerConfig = {}) {
    this.scoreThreshold = config.scoreThreshold ?? 30;

    // 加载因子权重：优先用传入的，否则从缓存读取
    if (config.factorWeights !== undefined && config.factorWeights !== null) {
      this.factorWeightList = config.factorWeights;
    } else {
      const cached = getCachedWeights();
      if (cached) {
        this.factorWeightList = cached.weights;
        console.log(`[Scorer] 从缓存加载 ${cached.weights.length} 个因子权重 (period=${cached.period})`);
      } else {
        console.warn('[Scorer] weight-cache 为空，使用默认等权权重');
        // 默认等权（各因子权重按 screener 默认比例）
        this.factorWeightList = [];
      }
    }

    // 构造成本函数用的权重映射
    this.weights = this.buildWeightMap();
    console.log('[Scorer] 评分权重:', JSON.stringify(this.weights));
  }

  /** 从 FactorWeight[] 构建 scoreStock 可用的权重映射 */
  private buildWeightMap(): Record<string, number> {
    if (this.factorWeightList.length === 0) {
      // 默认权重（screener 的 Barra 默认）
      return {
        pe: 30,
        quality: 20,
        momentum: 15,
        reversal: 15,
        moneyFlow: 15,
        technical: 15,
        turnover: 5,
      };
    }

    // IC/IR 因子名 → screener 因子名 → 累加权重
    const weightMap: Record<string, number> = {};
    for (const fw of this.factorWeightList) {
      const screenerKey = IC_TO_SCREENER_KEY[fw.factorName];
      if (screenerKey) {
        weightMap[screenerKey] = (weightMap[screenerKey] ?? 0) + fw.weight;
      }
    }

    // 如果映射后权重和为0（没有任何有效因子），用默认
    const total = Object.values(weightMap).reduce((s, v) => s + v, 0);
    if (total === 0) {
      return {
        pe: 30, quality: 20, momentum: 15,
        reversal: 15, moneyFlow: 15, technical: 15, turnover: 5,
      };
    }

    return weightMap;
  }

  /**
   * 对截面快照打分
   * @param loader 数据加载器
   * @param dateTs 评分日期时间戳
   * @param prevScores 上一期评分（用于计算评分变化，可选）
   */
  score(
    loader: CrossSectionalDataLoader,
    dateTs: number,
    prevScores?: Map<string, StockScore>
  ): StockScore[] {
    // 1. 提取截面因子快照
    const snapshots = loader.extractSnapshot(dateTs);
    if (snapshots.length === 0) {
      console.warn(`[Scorer] ${new Date(dateTs).toISOString().slice(0,10)} 无有效快照`);
      return [];
    }

    // 2. 截面百分位归一化
    preComputeFactorPercentiles(snapshots);

    // 3. 逐股评分
    const scores: StockScore[] = snapshots.map(s => {
      const { total, contributions } = scoreStockFromPct(s.pct, this.weights);
      const prev = prevScores?.get(s.code);
      const scoreChange = prev ? total - prev.compositeScore : 0;

      let direction: StockScore['direction'] = 'neutral';
      if (total >= this.scoreThreshold + 20) direction = 'long';
      else if (total < this.scoreThreshold) direction = 'neutral';

      return {
        code: s.code,
        compositeScore: total,
        rank: 0,  // 待填充
        direction,
        factorContributions: contributions,
        scoreChange,
      };
    });

    // 4. 按评分排序并填充 rank
    scores.sort((a, b) => b.compositeScore - a.compositeScore);
    for (let i = 0; i < scores.length; i++) {
      scores[i].rank = i + 1;
    }

    return scores;
  }

  /** 获取当前使用的因子权重列表（用于归因分析） */
  getFactorWeights(): FactorWeight[] {
    return this.factorWeightList;
  }

  /** 获取权重映射（调试用） */
  getWeightMap(): Record<string, number> {
    return { ...this.weights };
  }
}
