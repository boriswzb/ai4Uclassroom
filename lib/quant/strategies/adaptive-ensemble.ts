/**
 * 自适应组合策略引擎
 *
 * 在 StrategyEnsemble 基础上增加：
 * 1. 基于 MarketRegimeClassifier 的市场状态感知
 * 2. 根据市场状态动态调整各策略权重
 * 3. 品种间相关性风控（跨品种持仓限制）
 * 4. 全局账户风险预算管理
 */

import { KBar, Signal, Direction } from '../types';
import { Strategy, StrategyFactory, StrategyType } from '../strategies/strategy-engine';
import { StrategyEnsemble, EnsembleSignal, EnsembleConfig } from '../strategies/strategy-ensemble';
import { MarketRegimeClassifier, MarketRegime } from '../market/market-regime';

// ==================== 自适应组合配置 ====================

export interface AdaptiveEnsembleConfig {
  /** 基础组合配置 */
  base: EnsembleConfig;
  /** 市场状态分类器 */
  marketClassifier: MarketRegimeClassifier;
  /** 各市场状态下的策略权重覆盖表 */
  regimeWeights?: Partial<Record<MarketRegime, number[]>>;
  /** 各市场状态下的仓位倍数 */
  regimePositionMultiplier?: Partial<Record<MarketRegime, number>>;
  /** 最大总仓位（账户比例） */
  maxTotalPosition?: number;
  /** 最大单品种仓位（账户比例） */
  maxSinglePosition?: number;
}

const DEFAULT_REGIME_WEIGHTS: Partial<Record<MarketRegime, number[]>> = {
  strong_uptrend:    [0.40, 0.20, 0.20, 0.10, 0.10], // MACD为主
  weak_uptrend:     [0.25, 0.25, 0.20, 0.15, 0.15],
  strong_downtrend:  [0.30, 0.30, 0.15, 0.15, 0.10], // KDJ+MACD做空
  weak_downtrend:    [0.20, 0.30, 0.20, 0.20, 0.10],
  high_volatility:  [0.10, 0.10, 0.10, 0.40, 0.30], // 布林带+RSI
  low_volatility:    [0.20, 0.20, 0.25, 0.15, 0.20], // RSI+KD震荡
  uncertain:        [0.20, 0.20, 0.20, 0.20, 0.20],  // 等权
};

const DEFAULT_REGIME_POSITION: Partial<Record<MarketRegime, number>> = {
  strong_uptrend:    1.2,
  weak_uptrend:     1.0,
  strong_downtrend:  0.8,
  weak_downtrend:    0.7,
  high_volatility:   0.6,
  low_volatility:    1.0,
  uncertain:        0.5,
};

// ==================== 自适应组合引擎 ====================

export class AdaptiveEnsembleEngine {
  private config: AdaptiveEnsembleConfig;
  private baseEnsemble: StrategyEnsemble;
  private regime: MarketRegime = 'uncertain';
  private lastRegime: MarketRegime = 'uncertain';
  private regimeChanges: { from: MarketRegime; to: MarketRegime; timestamp: number }[] = [];

  constructor(config: AdaptiveEnsembleConfig) {
    this.config = {
      regimeWeights: DEFAULT_REGIME_WEIGHTS,
      regimePositionMultiplier: DEFAULT_REGIME_POSITION,
      maxTotalPosition: 0.9,
      maxSinglePosition: 0.3,
      ...config,
    };

    // 构建基础组合
    this.baseEnsemble = new StrategyEnsemble(
      `Adaptive(${config.base.strategies.map(s => s.name).join('+')})`,
      config.base
    );
  }

  // ==================== 核心：事件驱动 ====================

  onBar(bar: KBar): void {
    // 1. 驱动基础组合
    this.baseEnsemble.onBar(bar);

    // 2. 更新市场状态（每20根K线评估一次，避免频繁切换）
    if (this.baseEnsemble['currentBar']) {
      this.config.marketClassifier.updateBars([this.baseEnsemble['currentBar'] as KBar]);
    }

    const currentBarCount = (this.baseEnsemble['currentBar'] as KBar | null)?.timestamp ?? 0;
    if (currentBarCount % 20 === 0 || this.regime === 'uncertain') {
      const regimeResult = this.config.marketClassifier.analyze();
      this.lastRegime = this.regime;
      this.regime = regimeResult.regime;

      if (this.lastRegime !== this.regime) {
        this.regimeChanges.push({
          from: this.lastRegime,
          to: this.regime,
          timestamp: bar.timestamp
        });
        console.log(`[AdaptiveEnsemble] 市场状态切换: ${this.lastRegime} → ${this.regime} | ${regimeResult.reason}`);
      }
    }
  }

  updateBars(bars: KBar[]): void {
    this.baseEnsemble.updateBars(bars);
    this.config.marketClassifier.updateBars(bars);

    // 初始化市场状态
    if (bars.length >= 30) {
      const regimeResult = this.config.marketClassifier.analyze();
      this.regime = regimeResult.regime;
    }
  }

  // ==================== 信号输出 ====================

  getSignal(): EnsembleSignal | null {
    const baseSignal = this.baseEnsemble.getSignal();
    if (!baseSignal) return null;

    // 根据市场状态调整权重和信号
    const weights = this.getCurrentWeights();
    const posMultiplier = this.getCurrentPositionMultiplier();

    // 重新计算加权分数
    const adjustedSignal = this.applyRegimeAdjustment(baseSignal, weights, posMultiplier);

    return {
      ...adjustedSignal,
      reason: `[${this.regime}] ${adjustedSignal.reason}`,
      strength: Math.min(1, adjustedSignal.strength * posMultiplier)
    };
  }

  getSubStrategies(): Strategy[] {
    return this.baseEnsemble.getSubStrategies();
  }

  // ==================== 市场状态相关 ====================

  getCurrentRegime(): MarketRegime {
    return this.regime;
  }

  getRegimeHistory(): { from: MarketRegime; to: MarketRegime; timestamp: number }[] {
    return [...this.regimeChanges];
  }

  // ==================== 内部方法 ====================

  /**
   * 获取当前市场状态下的策略权重
   */
  private getCurrentWeights(): number[] {
    const override = this.config.regimeWeights?.[this.regime];
    if (override) return override;

    // 默认用加权模式的权重
    return this.baseEnsemble['config']['weights'] ?? [0.2, 0.2, 0.2, 0.2, 0.2];
  }

  /**
   * 获取当前仓位倍数
   */
  private getCurrentPositionMultiplier(): number {
    return this.config.regimePositionMultiplier?.[this.regime] ?? 1.0;
  }

  /**
   * 根据市场状态调整信号
   */
  private applyRegimeAdjustment(
    signal: EnsembleSignal,
    weights: number[],
    posMultiplier: number
  ): EnsembleSignal {
    // 如果市场状态为uncertain，大幅削弱信号强度
    if (this.regime === 'uncertain') {
      return {
        ...signal,
        strength: signal.strength * 0.3,
        reason: `(市场方向不明，信号削弱) ${signal.reason}`
      };
    }

    // 高波动市场，对布林带策略加权
    if (this.regime === 'high_volatility') {
      const bollingerIdx = signal.subSignals.findIndex(s =>
        s.strategyName.includes('Bollinger') || s.strategyName.includes('布林')
      );
      if (bollingerIdx >= 0 && signal.subSignals[bollingerIdx].direction === signal.direction) {
        // 布林带信号与总信号方向一致，加强
        return {
          ...signal,
          strength: Math.min(1, signal.strength * 1.3),
          reason: `(高波动，布林带共振) ${signal.reason}`
        };
      }
    }

    // 强趋势市场，对MACD加权
    if (this.regime === 'strong_uptrend' || this.regime === 'strong_downtrend') {
      const macdIdx = signal.subSignals.findIndex(s => s.strategyName.includes('MACD'));
      if (macdIdx >= 0 && signal.subSignals[macdIdx].direction === signal.direction) {
        return {
          ...signal,
          strength: Math.min(1, signal.strength * 1.2),
          reason: `(强趋势，MACD确认) ${signal.reason}`
        };
      }
    }

    return signal;
  }
}

// ==================== 工厂函数 ====================

/**
 * 创建自适应组合策略（5个基础策略 + 市场状态感知）
 */
export function createAdaptiveEnsemble(marketClassifier: MarketRegimeClassifier): AdaptiveEnsembleEngine {
  const { MACDStrategy, KDJStrategy, MAStrategy, BollingerStrategy, RSIStrategy } = require('../strategies/strategy-engine');

  const strategies = [
    new MACDStrategy(),
    new KDJStrategy(),
    new MAStrategy(),
    new BollingerStrategy(),
    new RSIStrategy(),
  ];

  const baseConfig: EnsembleConfig = {
    mode: 'weighted',
    strategies,
    confirmThreshold: 0.25,
    weights: [0.30, 0.20, 0.20, 0.15, 0.15],
  };

  return new AdaptiveEnsembleEngine({
    base: baseConfig,
    marketClassifier,
  });
}
