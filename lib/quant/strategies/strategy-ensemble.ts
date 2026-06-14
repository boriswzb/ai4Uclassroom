/**
 * 策略组合引擎 (Strategy Ensemble)
 *
 * 支持4种组合模式：
 *
 * 1. voting    - 并联投票：多个策略各投一票，少数服从多数
 *                买入条件：>= confirmThreshold 个策略发出做多信号
 *
 * 2. filter    - 串联过滤：主策略产生信号，副策略负责确认或否决
 *                只有主策略信号通过副策略过滤才执行
 *
 * 3. dynamic   - 动态切换：根据市场状态（波动率/趋势强度）在多个策略间自动切换
 *                波动率高 → 布林带；趋势强 → MACD；横盘 → RSI
 *
 * 4. weighted  - 加权融合：各策略按权重投票，累加分数超过阈值执行
 *                longScore = Σ(weight_i * signal_i)   (signal_i: -1/0/+1)
 *
 * 信号流向：
 *   子策略 → EnsembleSignal → 合成信号 → LiveSimulator 执行
 */

import { KBar, Signal, Direction } from '../types';
import { Strategy } from './strategy-engine';

// ==================== 组合模式 ====================

export type EnsembleMode = 'voting' | 'filter' | 'dynamic' | 'weighted';

export interface EnsembleConfig {
  mode: EnsembleMode;
  /** 组合内的策略列表 */
  strategies: Strategy[];
  /** 投票/加权阈值 (0-1)，超过此比例才执行 */
  confirmThreshold?: number;
  /** 各策略权重（加权模式必须，等权模式忽略） */
  weights?: number[];
  /** 各策略角色（过滤模式：'main' | 'filter'） */
  roles?: ('main' | 'filter')[];
  /** 动态切换的波动率阈值（%） */
  volatilityThreshold?: number;
  /** 动态切换的趋势强度阈值（均线斜率） */
  trendThreshold?: number;
  /** 动态模式使用的K线根数 */
  lookbackBars?: number;
}

export interface EnsembleSignal {
  code: string;
  timestamp: number;
  direction: Direction | 'neutral';
  /** 0-1，信号强度（加权模式 = 归一化分数，投票模式 = 同意比例） */
  strength: number;
  /** 组合模式 */
  mode: EnsembleMode;
  /** 各子策略的信号详情 */
  subSignals: SubSignalInfo[];
  reason: string;
}

export interface SubSignalInfo {
  strategyName: string;
  direction: Direction | 'neutral';
  strength: number;
  vote: number; // +1 / 0 / -1
  weight: number;
  passed: boolean; // 过滤模式下是否通过
}

export class StrategyEnsemble {
  name: string;
  private config: EnsembleConfig;
  private currentBar: KBar | null = null;
  private lastEnsembleSignal: EnsembleSignal | null = null;

  constructor(name: string, config: EnsembleConfig) {
    this.name = name;
    this.config = config;

    // 默认等权
    if (!this.config.weights) {
      const n = config.strategies.length;
      this.config.weights = config.strategies.map(() => 1 / n);
    }
    if (!this.config.confirmThreshold) {
      this.config.confirmThreshold = config.mode === 'voting' ? 0.5 : 0.3;
    }
    if (!this.config.roles) {
      this.config.roles = config.strategies.map((_, i) => i === 0 ? 'main' : 'filter');
    }
    if (!this.config.lookbackBars) {
      this.config.lookbackBars = 20;
    }
  }

  // ==================== 事件驱动 ====================

  onBar(bar: KBar): void {
    this.currentBar = bar;

    // 1. 驱动所有子策略
    for (const strategy of this.config.strategies) {
      strategy.onBar(bar);
    }

    // 2. 根据模式合成信号
    const ensembleSignal = this.computeEnsembleSignal(bar);

    this.lastEnsembleSignal = ensembleSignal;
  }

  updateBars(bars: KBar[]): void {
    for (const strategy of this.config.strategies) {
      strategy.updateBars(bars);
    }
    if (bars.length > 0) {
      this.currentBar = bars[bars.length - 1];
    }
  }

  getSignal(): EnsembleSignal | null {
    return this.lastEnsembleSignal;
  }

  getSubStrategies(): Strategy[] {
    return [...this.config.strategies];
  }

  // ==================== 核心：合成信号 ====================

  private computeEnsembleSignal(bar: KBar): EnsembleSignal {
    switch (this.config.mode) {
      case 'voting':    return this.votingSignal(bar);
      case 'filter':    return this.filterSignal(bar);
      case 'dynamic':   return this.dynamicSignal(bar);
      case 'weighted':  return this.weightedSignal(bar);
      default:          return this.votingSignal(bar);
    }
  }

  /**
   * 模式一：并联投票
   * 逻辑：各策略各自判断方向，少数服从多数
   * 买入 = long票数 > short票数 且 超过阈值
   * 卖出 = short票数 > long票数 且 超过阈值
   */
  private votingSignal(bar: KBar): EnsembleSignal {
    const subSignals = this.collectSubSignals(bar);

    let longVotes = 0, shortVotes = 0, neutralVotes = 0;
    for (const s of subSignals) {
      if (s.direction === 'long')      longVotes++;
      else if (s.direction === 'short') shortVotes++;
      else                               neutralVotes++;
    }

    const totalVoters = subSignals.length;
    const longRatio  = longVotes  / totalVoters;
    const shortRatio = shortVotes / totalVoters;
    const threshold  = this.config.confirmThreshold!;

    let direction: Direction | 'neutral' = 'neutral';
    let reason = '';

    if (longVotes > shortVotes && longRatio >= threshold) {
      direction = 'long';
      reason = `投票通过：${longVotes}/${totalVoters} 个策略看多（阈值${(threshold*100).toFixed(0)}%）`;
    } else if (shortVotes > longVotes && shortRatio >= threshold) {
      direction = 'short';
      reason = `投票通过：${shortVotes}/${totalVoters} 个策略看空（阈值${(threshold*100).toFixed(0)}%）`;
    } else {
      reason = `投票未通过：多${longVotes} 空${shortVotes} 中${neutralVotes}（需${(threshold*100).toFixed(0)}%}）`;
    }

    const strength = Math.max(longRatio, shortRatio);

    return { code: bar.code, timestamp: bar.timestamp, direction, strength, mode: 'voting', subSignals, reason };
  }

  /**
   * 模式二：串联过滤
   * 逻辑：主策略产生信号，过滤策略有权否决
   * 主策略买入 → 所有过滤策略必须没有发出相反信号才能执行
   */
  private filterSignal(bar: KBar): EnsembleSignal {
    const subSignals = this.collectSubSignals(bar);

    const mainIdx = this.config.roles!.indexOf('main');
    const mainSignal = subSignals[mainIdx >= 0 ? mainIdx : 0];

    // 检查每个过滤策略是否通过
    let allPassed = true;
    let vetoReason = '';

    for (let i = 0; i < subSignals.length; i++) {
      if (this.config.roles![i] === 'filter') {
        const passed = this.checkFilterPass(mainSignal.direction, subSignals[i]);
        subSignals[i].passed = passed;
        if (!passed) {
          allPassed = false;
          vetoReason = `${subSignals[i].strategyName} 否决（${subSignals[i].direction}）`;
        }
      }
    }

    let direction: Direction | 'neutral' = 'neutral';
    let reason = '';

    if (mainSignal.direction === 'long' && allPassed) {
      direction = 'long';
      reason = `主策略 ${mainSignal.strategyName} 买入信号，过滤器全部通过`;
    } else if (mainSignal.direction === 'short' && allPassed) {
      direction = 'short';
      reason = `主策略 ${mainSignal.strategyName} 卖出信号，过滤器全部通过`;
    } else if (!allPassed) {
      direction = 'neutral';
      reason = `主信号被拦截：${vetoReason}`;
    } else {
      reason = `主策略 ${mainSignal.strategyName} 无信号`;
    }

    return {
      code: bar.code, timestamp: bar.timestamp, direction,
      strength: mainSignal.strength, mode: 'filter',
      subSignals, reason
    };
  }

  /** 过滤策略通过条件：不能发出与主策略相反的信号 */
  private checkFilterPass(mainDir: Direction | 'neutral', filterSignal: SubSignalInfo): boolean {
    if (mainDir === 'neutral') return true;
    if (filterSignal.direction === 'neutral') return true;
    if (mainDir === 'long'  && filterSignal.direction === 'short') return false;
    if (mainDir === 'short' && filterSignal.direction === 'long')  return false;
    return true;
  }

  /**
   * 模式三：动态切换
   * 逻辑：根据市场状态自动选择最佳策略
   * 高波动 → 布林带（均值回归）
   * 趋势强 → MACD（趋势跟随）
   * 横盘   → RSI（超买超卖）
   */
  private dynamicSignal(bar: KBar): EnsembleSignal {
    const subSignals = this.collectSubSignals(bar);
    const lookback = this.config.lookbackBars!;

    // 计算市场状态指标
    const { volatility, trendStrength } = this.computeMarketRegime(bar);

    const volThresh  = this.config.volatilityThreshold ?? 0.02; // 2%日波幅阈值
    const trendThresh = this.config.trendThreshold ?? 0.01;      // 1%均线斜率阈值

    let selectedIdx = 0;
    let reason = '';

    if (volatility > volThresh) {
      // 高波动 → 布林带
      selectedIdx = subSignals.findIndex(s => s.strategyName.includes('Bollinger') || s.strategyName.includes('布林'));
      reason = `高波动市场（波动率${(volatility*100).toFixed(2)}% > 阈值${(volThresh*100).toFixed(1)}%）→ 布林带策略`;
    } else if (trendStrength > trendThresh) {
      // 强趋势 → MACD
      selectedIdx = subSignals.findIndex(s => s.strategyName.includes('MACD'));
      reason = `趋势市场（趋势强度${(trendStrength*100).toFixed(2)}% > 阈值${(trendThresh*100).toFixed(1)}%）→ MACD策略`;
    } else {
      // 横盘 → RSI
      selectedIdx = subSignals.findIndex(s => s.strategyName.includes('RSI'));
      reason = `横盘市场（波动率${(volatility*100).toFixed(2)}%，趋势${(trendStrength*100).toFixed(2)}%）→ RSI策略`;
    }

    if (selectedIdx < 0) selectedIdx = 0;
    const selectedSignal = subSignals[selectedIdx];

    // 未被选中的策略标记为未通过
    for (let i = 0; i < subSignals.length; i++) {
      subSignals[i].passed = (i === selectedIdx);
    }

    return {
      code: bar.code, timestamp: bar.timestamp,
      direction: selectedSignal.direction,
      strength: selectedSignal.strength * 1.2, // 动态切换给一个加成
      mode: 'dynamic',
      subSignals,
      reason: `[${selectedSignal.strategyName}] ${reason}`
    };
  }

  /** 计算市场状态：波动率 + 趋势强度 */
  private computeMarketRegime(bar: KBar): { volatility: number; trendStrength: number } {
    // 用最近N根K线计算
    const bars = this.currentBar ? [this.currentBar] : [];
    // 简单用当日涨跌幅作为波动率代理
    const volatility = Math.abs(bar.close - bar.open) / bar.open;

    // 趋势强度：用收盘价相对均线的偏离
    let trendStrength = 0;
    if (this.currentBar && this.currentBar.close > 0) {
      const ma5 = this.computeSimpleMA(bars, 5);
      trendStrength = ma5 > 0 ? Math.abs(this.currentBar.close - ma5) / this.currentBar.close : 0;
    }

    return { volatility, trendStrength };
  }

  private computeSimpleMA(bars: KBar[], period: number): number {
    if (bars.length < period) return bars[bars.length - 1]?.close ?? 0;
    const slice = bars.slice(-period);
    return slice.reduce((sum, b) => sum + b.close, 0) / slice.length;
  }

  /**
   * 模式四：加权融合
   * 逻辑：每个策略的信号强度 × 权重 = 加权分数
   * longScore  >  threshold → 买入
   * shortScore < -threshold → 卖出
   */
  private weightedSignal(bar: KBar): EnsembleSignal {
    const subSignals = this.collectSubSignals(bar);

    let longScore = 0, shortScore = 0;

    for (let i = 0; i < subSignals.length; i++) {
      const s = subSignals[i];
      const w = this.config.weights![i];
      const vote = s.direction === 'long' ? 1 : s.direction === 'short' ? -1 : 0;
      const contribution = w * s.strength * vote;
      if (vote > 0) longScore  += contribution;
      else if (vote < 0) shortScore += contribution;
    }

    const netScore = longScore - shortScore; // 净值在 [-1, 1]
    const threshold = this.config.confirmThreshold!;

    let direction: Direction | 'neutral' = 'neutral';
    let reason = '';

    if (netScore > threshold) {
      direction = 'long';
      reason = `加权融合：综合得分${netScore.toFixed(3)} > 阈值${threshold}，看多`;
    } else if (netScore < -threshold) {
      direction = 'short';
      reason = `加权融合：综合得分${netScore.toFixed(3)} < ${-threshold}，看空`;
    } else {
      reason = `加权融合：综合得分${netScore.toFixed(3)}，信号未达阈值${threshold}`;
    }

    return {
      code: bar.code, timestamp: bar.timestamp,
      direction, strength: Math.abs(netScore),
      mode: 'weighted',
      subSignals, reason
    };
  }

  // ==================== 工具 ====================

  private collectSubSignals(bar: KBar): SubSignalInfo[] {
    return this.config.strategies.map((strategy, i) => {
      const sig = strategy.getSignal();
      const dir: Direction | 'neutral' = sig?.direction ?? 'neutral';
      const strength = sig?.strength ?? 0;
      const vote = dir === 'long' ? 1 : dir === 'short' ? -1 : 0;

      return {
        strategyName: strategy.name,
        direction: dir,
        strength,
        vote,
        weight: this.config.weights![i],
        passed: true, // 默认通过，过滤模式下会被改写
      };
    });
  }
}

// ==================== 工厂函数 ====================

/** 创建投票组合策略（MACD + KDJ + RSI 三投票） */
export function createVotingEnsemble(): StrategyEnsemble {
  const { MACDStrategy, KDJStrategy, RSIStrategy } = require('./strategy-engine');
  return new StrategyEnsemble('投票组合(MACD+KDJ+RSI)', {
    mode: 'voting',
    strategies: [new MACDStrategy(), new KDJStrategy(), new RSIStrategy()],
    confirmThreshold: 0.5,
  });
}

/** 创建过滤组合策略（MACD主策略 + RSI过滤） */
export function createFilterEnsemble(): StrategyEnsemble {
  const { MACDStrategy, RSIStrategy } = require('./strategy-engine');
  return new StrategyEnsemble('过滤组合(MACD+RSI)', {
    mode: 'filter',
    strategies: [new MACDStrategy(), new RSIStrategy()],
    roles: ['main', 'filter'],
    confirmThreshold: 0.3,
  });
}

/** 创建加权组合策略（全5策略加权融合） */
export function createWeightedEnsemble(): StrategyEnsemble {
  const { MACDStrategy, KDJStrategy, MAStrategy, BollingerStrategy, RSIStrategy } = require('./strategy-engine');
  return new StrategyEnsemble('加权融合(5策略)', {
    mode: 'weighted',
    strategies: [
      new MACDStrategy(),
      new KDJStrategy(),
      new MAStrategy(),
      new BollingerStrategy(),
      new RSIStrategy(),
    ],
    weights: [0.30, 0.20, 0.20, 0.15, 0.15], // MACD权重最高
    confirmThreshold: 0.25,
  });
}

/** 创建动态切换组合策略（全5策略自适应） */
export function createDynamicEnsemble(): StrategyEnsemble {
  const { MACDStrategy, KDJStrategy, MAStrategy, BollingerStrategy, RSIStrategy } = require('./strategy-engine');
  return new StrategyEnsemble('动态切换(自适应)', {
    mode: 'dynamic',
    strategies: [
      new MACDStrategy(),
      new KDJStrategy(),
      new MAStrategy(),
      new BollingerStrategy(),
      new RSIStrategy(),
    ],
    volatilityThreshold: 0.015,
    trendThreshold: 0.008,
    lookbackBars: 20,
  });
}
