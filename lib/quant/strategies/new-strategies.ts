/**
 * Phase 2 新策略补全
 * 包含：
 * 1. WilliamsRStrategy — 威廉指标策略
 * 2. BiasStrategy — 乖离率策略（均值回归）
 * 3. MFIStrategy — MFI资金流量策略
 * 4. StochasticStrategy — KD随机震荡策略
 * 5. VolumeBreakoutStrategy — 成交量突破策略
 * 6. Composite趋势确认策略 — 多指标共振
 */

import { KBar, Signal, StrategyConfig, Direction } from '../types';
import { Strategy } from './strategy-engine';
import { computeIndicators } from './indicators';

// ==================== 威廉指标策略 ====================

export class WilliamsRStrategy extends Strategy {
  constructor(config?: Partial<StrategyConfig>) {
    super('WilliamsR', {
      name: '威廉指标策略',
      enabled: true,
      params: {
        period: 14,
        oversoldLine: -80,  // 超卖线
        overboughtLine: -20 // 超买线
      },
      ...config
    });
  }

  onBar(bar: KBar): void {
    this.kbars.push(bar);
    if (this.kbars.length < 16) return;

    const { williamsR } = computeIndicators(this.kbars);
    const currentWR = williamsR[williamsR.length - 1];
    const prevWR = williamsR[williamsR.length - 2];

    const oversold = this.config.params.oversoldLine as number;
    const overbought = this.config.params.overboughtLine as number;

    let direction: Direction | 'neutral' = 'neutral';
    let strength = 0;
    let reason = '';

    // 威廉指标从超卖区上穿：买入信号
    // 威廉指标在 -100 到 0 之间，值越大越超买，越小越超卖
    if (prevWR <= oversold && currentWR > oversold) {
      direction = 'long';
      strength = Math.min(Math.abs(currentWR + 50) / 50, 1);
      reason = `威廉指标脱离超卖: %R=${currentWR.toFixed(2)} > ${oversold}`;
    }
    // 威廉指标从超买区下穿：卖出信号
    else if (prevWR >= overbought && currentWR < overbought) {
      direction = 'short';
      strength = Math.min(Math.abs(currentWR + 50) / 50, 1);
      reason = `威廉指标脱离超买: %R=${currentWR.toFixed(2)} < ${overbought}`;
    }
    // 持续超卖
    else if (currentWR < oversold) {
      direction = 'long';
      strength = 0.3;
      reason = `威廉指标持续超卖: %R=${currentWR.toFixed(2)}`;
    }
    // 持续超买
    else if (currentWR > overbought) {
      direction = 'short';
      strength = 0.3;
      reason = `威廉指标持续超买: %R=${currentWR.toFixed(2)}`;
    }

    this.signals.push({
      code: bar.code,
      timestamp: bar.timestamp,
      direction,
      strength,
      reason
    });
  }
}

// ==================== 乖离率策略 ====================

export class BiasStrategy extends Strategy {
  constructor(config?: Partial<StrategyConfig>) {
    super('Bias', {
      name: '乖离率策略',
      enabled: true,
      params: {
        period: 20,
        upperThreshold: 5,   // 向上乖离过大（均值回归卖出）
        lowerThreshold: -5  // 向下乖离过大（均值回归买入）
      },
      ...config
    });
  }

  onBar(bar: KBar): void {
    this.kbars.push(bar);
    if (this.kbars.length < 22) return;

    const { bias, sma20 } = computeIndicators(this.kbars);
    const currentBias = bias[bias.length - 1];
    const currentClose = bar.close;
    const currentMA = sma20[sma20.length - 1];

    const upper = this.config.params.upperThreshold as number;
    const lower = this.config.params.lowerThreshold as number;

    let direction: Direction | 'neutral' = 'neutral';
    let strength = 0;
    let reason = '';

    // 股价向下偏离均线过大 → 反弹买入
    if (currentBias < lower) {
      direction = 'long';
      strength = Math.min(Math.abs(currentBias) / 10, 1);
      reason = `股价负乖离过大: BIAS=${currentBias.toFixed(2)}% < ${lower}%，均线回归买入`;
    }
    // 股价向上偏离均线过大 → 回落卖出
    else if (currentBias > upper) {
      direction = 'short';
      strength = Math.min(Math.abs(currentBias) / 10, 1);
      reason = `股价正乖离过大: BIAS=${currentBias.toFixed(2)}% > ${upper}%，均线回归卖出`;
    }
    // 乖离率回归中位
    else if (currentBias > 0 && currentBias < upper / 2) {
      direction = 'neutral';
      strength = 0.2;
      reason = `乖离率收敛: BIAS=${currentBias.toFixed(2)}%`;
    }

    this.signals.push({
      code: bar.code,
      timestamp: bar.timestamp,
      direction,
      strength,
      reason
    });
  }
}

// ==================== MFI资金流量策略 ====================

export class MFIStrategy extends Strategy {
  constructor(config?: Partial<StrategyConfig>) {
    super('MFI', {
      name: 'MFI资金流量策略',
      enabled: true,
      params: {
        period: 14,
        oversold: 20,
        overbought: 80
      },
      ...config
    });
  }

  onBar(bar: KBar): void {
    this.kbars.push(bar);
    if (this.kbars.length < 16) return;

    const { mfi } = computeIndicators(this.kbars);
    const currentMFI = mfi[mfi.length - 1];
    const prevMFI = mfi[mfi.length - 2];

    const oversold = this.config.params.oversold as number;
    const overbought = this.config.params.overbought as number;

    let direction: Direction | 'neutral' = 'neutral';
    let strength = 0;
    let reason = '';

    // MFI从超卖区上穿
    if (prevMFI <= oversold && currentMFI > oversold) {
      direction = 'long';
      strength = Math.min((currentMFI - oversold) / 30, 1);
      reason = `MFI脱离超卖: MFI=${currentMFI.toFixed(2)} > ${oversold}`;
    }
    // MFI从超买区下穿
    else if (prevMFI >= overbought && currentMFI < overbought) {
      direction = 'short';
      strength = Math.min((overbought - currentMFI) / 30, 1);
      reason = `MFI脱离超买: MFI=${currentMFI.toFixed(2)} < ${overbought}`;
    }
    // MFI与价格背离（价格创新高但MFI没创新高）
    else if (this.kbars.length >= 30) {
      const recentCloses = this.kbars.slice(-30).map(k => k.close);
      const recentMFI = mfi.slice(-30);
      const priceTrend = recentCloses[recentCloses.length - 1] > recentCloses[0];
      const mfiTrend = recentMFI[recentMFI.length - 1] > recentMFI[0];

      if (priceTrend && !mfiTrend) {
        direction = 'short';
        strength = 0.6;
        reason = `MFI与价格顶背离：价格创新高但MFI未跟随`;
      } else if (!priceTrend && mfiTrend) {
        direction = 'long';
        strength = 0.6;
        reason = `MFI与价格底背离：价格创新低但MFI未跟随`;
      }
    }

    this.signals.push({
      code: bar.code,
      timestamp: bar.timestamp,
      direction,
      strength,
      reason
    });
  }
}

// ==================== KD随机震荡策略 ====================

export class StochasticStrategy extends Strategy {
  constructor(config?: Partial<StrategyConfig>) {
    super('Stochastic', {
      name: 'KD随机震荡策略',
      enabled: true,
      params: {
        kPeriod: 14,
        dPeriod: 3,
        oversold: 20,
        overbought: 80
      },
      ...config
    });
  }

  onBar(bar: KBar): void {
    this.kbars.push(bar);
    if (this.kbars.length < 20) return;

    const { stochastic } = computeIndicators(this.kbars);
    const { k, d } = stochastic;

    const currentK = k[k.length - 1];
    const currentD = d[d.length - 1];
    const prevK = k[k.length - 2];
    const prevD = d[d.length - 2];

    const oversold = this.config.params.oversold as number;
    const overbought = this.config.params.overbought as number;

    let direction: Direction | 'neutral' = 'neutral';
    let strength = 0;
    let reason = '';

    // K从下穿越D，且两者都在低位
    if (prevK <= prevD && currentK > currentD && currentK < oversold) {
      direction = 'long';
      strength = 0.7;
      reason = `KD低位金叉: K=${currentK.toFixed(2)} > D=${currentD.toFixed(2)}，超卖区间`;
    }
    // K从上穿越D，且两者都在高位
    else if (prevK >= prevD && currentK < currentD && currentK > overbought) {
      direction = 'short';
      strength = 0.7;
      reason = `KD高位死叉: K=${currentK.toFixed(2)} < D=${currentD.toFixed(2)}，超买区间`;
    }
    // K和D都在超卖区且开始向上
    else if (currentK < oversold && currentK > prevK) {
      direction = 'long';
      strength = 0.4;
      reason = `KD超卖反弹: K=${currentK.toFixed(2)}`;
    }

    this.signals.push({
      code: bar.code,
      timestamp: bar.timestamp,
      direction,
      strength,
      reason
    });
  }
}

// ==================== 成交量突破策略 ====================

export class VolumeBreakoutStrategy extends Strategy {
  constructor(config?: Partial<StrategyConfig>) {
    super('VolumeBreakout', {
      name: '放量突破策略',
      enabled: true,
      params: {
        volumePeriod: 20,
        breakoutMultiplier: 1.5,
        priceBreakoutType: 'high' // 'high' | 'close'
      },
      ...config
    });
  }

  onBar(bar: KBar): void {
    this.kbars.push(bar);
    if (this.kbars.length < 22) return;

    const { volumeBreakout } = computeIndicators(this.kbars);
    const { isBreakout } = volumeBreakout;

    const currentVolumeBreakout = isBreakout[isBreakout.length - 1];
    const prevVolumeBreakout = isBreakout[isBreakout.length - 2];

    const currentClose = bar.close;
    const currentHigh = bar.high;
    const prevClose = this.kbars[this.kbars.length - 2].close;
    const prevHigh = this.kbars[this.kbars.length - 2].high;

    // 计算近20日最高价和最低价
    const lookback = 20;
    const recentHighs = this.kbars.slice(-lookback).map(k => k.high);
    const recentLows = this.kbars.slice(-lookback).map(k => k.low);
    const highest20 = Math.max(...recentHighs);
    const lowest20 = Math.min(...recentLows);

    let direction: Direction | 'neutral' = 'neutral';
    let strength = 0;
    let reason = '';

    // 放量 + 价格突破20日高点
    if (currentVolumeBreakout && currentHigh > highest20 && prevHigh <= highest20) {
      direction = 'long';
      strength = 0.8;
      reason = `放量突破20日高点: 成交量放大，价格突破${highest20.toFixed(2)}`;
    }
    // 放量 + 价格跌破20日低点
    else if (currentVolumeBreakout && currentClose < lowest20 && prevClose >= lowest20) {
      direction = 'short';
      strength = 0.8;
      reason = `放量跌破20日低点: 成交量放大，价格跌破${lowest20.toFixed(2)}`;
    }
    // 缩量突破（弱信号）
    else if (!currentVolumeBreakout && currentHigh > highest20 && prevHigh <= highest20) {
      direction = 'long';
      strength = 0.4;
      reason = `缩量突破20日高点（量能不配合）: ${highest20.toFixed(2)}`;
    }

    this.signals.push({
      code: bar.code,
      timestamp: bar.timestamp,
      direction,
      strength,
      reason
    });
  }
}

// ==================== 复合趋势确认策略（多指标共振） ====================

export class CompositeStrategy extends Strategy {
  constructor(config?: Partial<StrategyConfig>) {
    super('Composite', {
      name: '复合趋势确认策略',
      enabled: true,
      params: {
        requiredConfirmations: 2, // 至少需要几个指标确认
        useMACD: true,
        useADX: true,
        useRSI: true,
        useVolume: true
      },
      ...config
    });
  }

  onBar(bar: KBar): void {
    this.kbars.push(bar);
    if (this.kbars.length < 35) return;

    const indicators = computeIndicators(this.kbars);
    const { macd, adx, rsi } = indicators;
    const closes = this.kbars.map(k => k.close);
    const volumes = this.kbars.map(k => k.volume);

    const confirmations: { name: string; direction: Direction }[] = [];

    // 1. MACD 确认
    const macdHist = macd.histogram;
    const prevHist = macdHist[macdHist.length - 2];
    const currHist = macdHist[macdHist.length - 1];
    if (prevHist < 0 && currHist > 0) {
      confirmations.push({ name: 'MACD', direction: 'long' });
    } else if (prevHist > 0 && currHist < 0) {
      confirmations.push({ name: 'MACD', direction: 'short' });
    }

    // 2. ADX 确认
    const currentADX = adx.adx[adx.adx.length - 1];
    const currentPlusDI = adx.plusDI[adx.plusDI.length - 1];
    const currentMinusDI = adx.minusDI[adx.minusDI.length - 1];
    const prevPlusDI = adx.plusDI[adx.plusDI.length - 2];
    const prevMinusDI = adx.minusDI[adx.minusDI.length - 2];
    if (currentADX > 25) {
      if (prevPlusDI <= prevMinusDI && currentPlusDI > currentMinusDI) {
        confirmations.push({ name: 'ADX', direction: 'long' });
      } else if (prevMinusDI <= prevPlusDI && currentMinusDI > currentPlusDI) {
        confirmations.push({ name: 'ADX', direction: 'short' });
      }
    }

    // 3. RSI 确认
    const currentRSI = rsi[rsi.length - 1];
    if (currentRSI < 30) {
      confirmations.push({ name: 'RSI', direction: 'long' });
    } else if (currentRSI > 70) {
      confirmations.push({ name: 'RSI', direction: 'short' });
    }

    // 4. 成交量确认（放量上涨/缩量下跌）
    const volMa = indicators.volumeBreakout.volumeMA;
    const currentVol = volumes[volumes.length - 1];
    const avgVol = volMa[volMa.length - 1];
    const priceUp = closes[closes.length - 1] > closes[closes.length - 2];
    if (currentVol > avgVol * 1.2 && priceUp) {
      confirmations.push({ name: 'Volume', direction: 'long' });
    } else if (currentVol < avgVol * 0.8 && !priceUp) {
      confirmations.push({ name: 'Volume', direction: 'short' });
    }

    const required = this.config.params.requiredConfirmations as number;

    let direction: Direction | 'neutral' = 'neutral';
    let strength = 0;
    let reason = '';

    const longCount = confirmations.filter(c => c.direction === 'long').length;
    const shortCount = confirmations.filter(c => c.direction === 'short').length;

    if (longCount >= required && longCount > shortCount) {
      direction = 'long';
      strength = Math.min(longCount / 4, 1);
      reason = `多指标共振看多(${longCount}/${confirmations.length}): ${confirmations.map(c => c.name).join('+')}`;
    } else if (shortCount >= required && shortCount > longCount) {
      direction = 'short';
      strength = Math.min(shortCount / 4, 1);
      reason = `多指标共振看空(${shortCount}/${confirmations.length}): ${confirmations.map(c => c.name).join('+')}`;
    } else {
      reason = `指标未共振: 多${longCount} 空${shortCount}，需${required}个确认`;
    }

    this.signals.push({
      code: bar.code,
      timestamp: bar.timestamp,
      direction,
      strength,
      reason
    });
  }
}

// ==================== 策略工厂扩展 ====================

export type NewStrategyType = 'williams' | 'bias' | 'mfi' | 'stochastic' | 'volume' | 'composite';

export const NewStrategyFactory = {
  create(type: NewStrategyType, params?: Partial<StrategyConfig>): Strategy {
    switch (type) {
      case 'williams':   return new WilliamsRStrategy(params);
      case 'bias':       return new BiasStrategy(params);
      case 'mfi':        return new MFIStrategy(params);
      case 'stochastic': return new StochasticStrategy(params);
      case 'volume':     return new VolumeBreakoutStrategy(params);
      case 'composite':  return new CompositeStrategy(params);
      default:           return new WilliamsRStrategy(params);
    }
  },

  list(): { type: NewStrategyType; name: string; description: string }[] {
    return [
      { type: 'williams',   name: '威廉指标策略',   description: '基于威廉%R超买超卖，适用震荡行情' },
      { type: 'bias',       name: '乖离率策略',     description: '基于均线偏离度均值回归，适合反弹行情' },
      { type: 'mfi',        name: 'MFI资金流策略',  description: '带成交量的RSI，识别资金流向' },
      { type: 'stochastic', name: 'KD随机震荡策略', description: 'K-D指标在0-100波动，低位金叉买入' },
      { type: 'volume',     name: '放量突破策略',    description: '量价共振，识别突破性行情' },
      { type: 'composite',  name: '复合趋势策略',    description: 'MACD+ADX+RSI+成交量多指标共振确认' },
    ];
  }
};

/**
 * 因子评分策略
 * 基于选股器输出的 compositeScore 进行交易决策
 * - compositeScore >= 70：强势信号，持有多头
 * - compositeScore < 40：弱势信号，持有空头
 * - 50 <= compositeScore < 70：中性，观望
 */
export class FactorScoreStrategy extends Strategy {
  private factorScores: Record<string, number> = {}; // 各股因子评分

  constructor(config?: Partial<Omit<StrategyConfig, 'params'>> & { factorScores?: Record<string, number>; params?: Partial<{ buyThreshold: number; sellThreshold: number; holdBars: number }> }) {
    const factorScores = config?.factorScores ?? {};
    const { params: configParams, ...restConfig } = config ?? {};
    super('FactorScore', {
      name: '因子综合评分策略',
      enabled: true,
      params: {
        buyThreshold: 70,   // 买入阈值
        sellThreshold: 40,   // 卖出阈值
        holdBars: 5,        // 持仓周期（K线根数）
        ...configParams,
      },
    });
    this.factorScores = factorScores;
  }

  /** 注入因子评分（从选股器传入） */
  setFactorScores(scores: Record<string, number>): void {
    this.factorScores = scores;
  }

  onBar(bar: KBar): void {
    this.kbars.push(bar);
    if (this.kbars.length < 5) return;

    // 如果有外部注入的因子评分，直接使用
    const externalScore = bar.code ? this.factorScores[bar.code] : undefined;

    if (externalScore !== undefined) {
      this.evaluateByFactorScore(externalScore, bar.code);
      return;
    }

    // 否则用内置技术指标计算模拟评分
    this.evaluateByIndicators(bar.code);
  }

  private evaluateByFactorScore(score: number, code: string = ''): void {
    const { buyThreshold, sellThreshold } = this.config.params as any;
    const prevSignal = this.signals.length > 0 ? this.signals[this.signals.length - 1].direction : null;

    if (score >= buyThreshold && prevSignal !== 'long') {
      this.signals.push({ code, direction: 'long', strength: score / 100, timestamp: Date.now(), reason: `因子评分${score}超过买入阈值${buyThreshold}` });
    } else if (score < sellThreshold && prevSignal !== 'short') {
      this.signals.push({ code, direction: 'short', strength: (100 - score) / 100, timestamp: Date.now(), reason: `因子评分${score}低于卖出阈值${sellThreshold}` });
    }
  }

  private evaluateByIndicators(code: string = ''): void {
    if (this.kbars.length < 20) return;
    const indicators = computeIndicators(this.kbars);
    const { macd, rsi, mfi } = indicators;

    // 模拟综合评分（模拟选股器的 compositeScore 逻辑）
    const macdScore = macd.histogram[macd.histogram.length - 1] > 0 ? 30 : 0;
    const rsiScore = rsi[rsi.length - 1] > 50 ? 20 : 0;
    const mfiScore = mfi[mfi.length - 1] > 50 ? 20 : 0;
    const momentum = this.kbars.length >= 20
      ? ((this.kbars[this.kbars.length - 1].close - this.kbars[this.kbars.length - 20].close) / this.kbars[this.kbars.length - 20].close) * 200
      : 0;
    const momentumScore = momentum > 0 ? 30 : 0;

    const simulatedScore = Math.min(100, Math.max(0, macdScore + rsiScore + mfiScore + momentumScore));
    this.evaluateByFactorScore(simulatedScore, code);
  }
}
