/**
 * 策略引擎
 * 基于 VeighNa 的事件驱动策略架构
 * 参考 quant-trading 的信号生成模式
 */

import { KBar, Signal, StrategyConfig, Direction, Position } from '../types';
import { computeIndicators } from './indicators';

/** 策略基类 */
export abstract class Strategy {
  name: string;
  config: StrategyConfig;
  protected kbars: KBar[] = [];
  protected signals: Signal[] = [];

  constructor(name: string, config: StrategyConfig) {
    this.name = name;
    this.config = config;
  }

  /** 更新K线数据 */
  abstract onBar(bar: KBar): void;

  /** 批量更新K线数据 (用于回测) */
  updateBars(bars: KBar[]): void {
    this.kbars = bars;
  }

  /** 获取最新信号 */
  getSignal(): Signal | null {
    return this.signals.length > 0 ? this.signals[this.signals.length - 1] : null;
  }

  /** 获取所有信号 */
  getAllSignals(): Signal[] {
    return [...this.signals];
  }

  /** 获取策略参数 */
  getParams(): Record<string, number | string | boolean> {
    return this.config.params;
  }

  /** 浅克隆策略（用于Walk-Forward等需要独立实例的场景） */
  clone(): Strategy {
    const Cls = this.constructor as new (config?: Partial<StrategyConfig>) => Strategy;
    return new Cls({ ...this.config });
  }
}

// ==================== MACD 策略 ====================

export class MACDStrategy extends Strategy {
  constructor(config?: Partial<StrategyConfig>) {
    super('MACD', {
      name: 'MACD策略',
      enabled: true,
      params: {
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        threshold: 0
      },
      ...config
    });
  }

  onBar(bar: KBar): void {
    this.kbars.push(bar);
    if (this.kbars.length < 27) return; // 需要足够的数据计算MACD

    const closes = this.kbars.map(k => k.close);
    const { macd, signal, histogram } = computeIndicators(this.kbars).macd;

    const currentMacd = macd[macd.length - 1];
    const currentSignal = signal[signal.length - 1];
    const currentHist = histogram[histogram.length - 1];
    const prevHist = histogram[histogram.length - 2];

    let direction: Direction | 'neutral' = 'neutral';
    let strength = 0;
    let reason = '';

    // 金叉: MACD从下方穿越信号线
    if (prevHist < 0 && currentHist > 0) {
      direction = 'long';
      strength = Math.min(Math.abs(currentHist) / 3, 1);
      if (strength < 0.3) { direction = 'neutral'; strength = 0; } // 过滤弱信号
      reason = `MACD金叉: MACD=${currentMacd.toFixed(4)}, Signal=${currentSignal.toFixed(4)}`;
    }
    // 死叉: MACD从上方穿越信号线
    else if (prevHist > 0 && currentHist < 0) {
      direction = 'short';
      strength = Math.min(Math.abs(currentHist) / 3, 1);
      if (strength < 0.3) { direction = 'neutral'; strength = 0; } // 过滤弱信号
      reason = `MACD死叉: MACD=${currentMacd.toFixed(4)}, Signal=${currentSignal.toFixed(4)}`;
    }
    // MACD柱状图持续放大且处于零轴上方（多头动能强劲）
    else if (currentHist > 0 && currentHist > prevHist && currentHist > prevHist * 1.5) {
      direction = 'long';
      strength = 0.6;
      reason = `MACD柱状图强势放大，多头力量增强`;
    } else if (currentHist < 0 && currentHist < prevHist && currentHist < prevHist * 1.5) {
      direction = 'short';
      strength = 0.6;
      reason = `MACD柱状图强势缩小，空头力量增强`;
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

// ==================== 布林带策略 ====================

export class BollingerStrategy extends Strategy {
  constructor(config?: Partial<StrategyConfig>) {
    super('BollingerBands', {
      name: '布林带策略',
      enabled: true,
      params: {
        period: 20,
        stdDev: 2,
        breakoutRatio: 0.5
      },
      ...config
    });
  }

  onBar(bar: KBar): void {
    this.kbars.push(bar);
    if (this.kbars.length < 21) return;

    const { bollinger } = computeIndicators(this.kbars);
    const { upper, middle, lower } = bollinger;

    const currentClose = bar.close;
    const currentUpper = upper[upper.length - 1];
    const currentMiddle = middle[middle.length - 1];
    const currentLower = lower[lower.length - 1];
    const prevClose = this.kbars[this.kbars.length - 2].close;

    let direction: Direction | 'neutral' = 'neutral';
    let strength = 0;
    let reason = '';

    // 价格突破上轨
    if (prevClose < currentUpper && currentClose > currentUpper) {
      direction = 'long';
      strength = 0.8;
      reason = `价格突破布林上轨: ${currentClose.toFixed(2)} > ${currentUpper.toFixed(2)}`;
    }
    // 价格跌破下轨
    else if (prevClose > currentLower && currentClose < currentLower) {
      direction = 'short';
      strength = 0.8;
      reason = `价格跌破布林下轨: ${currentClose.toFixed(2)} < ${currentLower.toFixed(2)}`;
    }
    // 价格触及下轨且反弹
    else if (currentClose <= currentLower * 1.01 && currentClose > prevClose) {
      direction = 'long';
      strength = 0.6;
      reason = `价格触及布林下轨反弹`;
    }
    // 价格触及上轨且回落
    else if (currentClose >= currentUpper * 0.99 && currentClose < prevClose) {
      direction = 'short';
      strength = 0.6;
      reason = `价格触及布林上轨回落`;
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

// ==================== RSI 策略 ====================

export class RSIStrategy extends Strategy {
  constructor(config?: Partial<StrategyConfig>) {
    super('RSI', {
      name: 'RSI策略',
      enabled: true,
      params: {
        period: 14,
        oversold: 30,
        overbought: 70
      },
      ...config
    });
  }

  onBar(bar: KBar): void {
    this.kbars.push(bar);
    if (this.kbars.length < 20) return;

    const { rsi } = computeIndicators(this.kbars);
    const closes = this.kbars.map(k => k.close);
    const currentRSI = rsi[rsi.length - 1];
    const prevRSI = rsi[rsi.length - 2];

    const oversold = this.config.params.oversold as number;
    const overbought = this.config.params.overbought as number;

    // 趋势过滤：计算最近20日均线方向
    const maPeriod = 20;
    const recentCloses = closes.slice(-maPeriod);
    const currentMA = recentCloses.reduce((a, b) => a + b, 0) / maPeriod;
    const prevMA = closes.slice(-maPeriod - 1, -1).reduce((a, b) => a + b, 0) / maPeriod;
    const inUptrend = currentMA > prevMA;

    let direction: Direction | 'neutral' = 'neutral';
    let strength = 0;
    let reason = '';

    // RSI超卖 + 处于上升趋势中 = 买入信号
    if (currentRSI < oversold && inUptrend) {
      direction = 'long';
      strength = Math.min((oversold - currentRSI) / 30, 1) * 0.8 + 0.2;
      reason = `RSI超卖+趋势向上: RSI=${currentRSI.toFixed(2)} < ${oversold}`;
    } else if (currentRSI < oversold) {
      // 无趋势过滤的超卖：降低强度
      direction = 'neutral';
      strength = 0;
      reason = `RSI超卖（趋势未确认，信号过滤）: RSI=${currentRSI.toFixed(2)}`;
    } else if (currentRSI > overbought) {
      direction = 'short';
      strength = Math.min((currentRSI - overbought) / 30, 1);
      reason = `RSI超买: RSI=${currentRSI.toFixed(2)} > ${overbought}`;
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

// ==================== KDJ 策略 ====================

export class KDJStrategy extends Strategy {
  constructor(config?: Partial<StrategyConfig>) {
    super('KDJ', {
      name: 'KDJ策略',
      enabled: true,
      params: {
        period: 9,
        oversold: 20,
        overbought: 80
      },
      ...config
    });
  }

  onBar(bar: KBar): void {
    this.kbars.push(bar);
    if (this.kbars.length < 10) return;

    const { kdj } = computeIndicators(this.kbars);
    const { k, d, j } = kdj;

    const currentK = k[k.length - 1];
    const currentD = d[d.length - 1];
    const currentJ = j[j.length - 1];
    const prevK = k[k.length - 2];
    const prevD = d[d.length - 2];
    const prevJ = j[j.length - 2];

    const oversold = this.config.params.oversold as number;
    const overbought = this.config.params.overbought as number;

    let direction: Direction | 'neutral' = 'neutral';
    let strength = 0;
    let reason = '';

    // 金叉
    if (prevK < prevD && currentK > currentD) {
      direction = 'long';
      strength = Math.min(Math.abs(currentK - currentD) / 20, 1);
      reason = `KDJ金叉: K=${currentK.toFixed(2)}, D=${currentD.toFixed(2)}`;
    }
    // 死叉
    else if (prevK > prevD && currentK < currentD) {
      direction = 'short';
      strength = Math.min(Math.abs(currentK - currentD) / 20, 1);
      reason = `KDJ死叉: K=${currentK.toFixed(2)}, D=${currentD.toFixed(2)}`;
    }
    // J值极低反弹（J<0表明严重超卖）
    else if (currentJ < 0 && currentJ > prevJ) {
      direction = 'long';
      strength = 0.6;
      reason = `KDJ J值超卖反弹: J=${currentJ.toFixed(2)}`;
    }
    // K值处于极端超卖区且价格企稳
    else if (currentK < 20 && currentK > prevK) {
      direction = 'long';
      strength = 0.5;
      reason = `KDJ K值低位回升: K=${currentK.toFixed(2)}`;
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

// ==================== 均线交叉策略 ====================

export class MAStrategy extends Strategy {
  constructor(config?: Partial<StrategyConfig>) {
    super('MAStrategy', {
      name: '均线交叉策略',
      enabled: true,
      params: {
        fastPeriod: 5,
        slowPeriod: 20
      },
      ...config
    });
  }

  onBar(bar: KBar): void {
    this.kbars.push(bar);

    const fastPeriod = this.config.params.fastPeriod as number;
    const slowPeriod = this.config.params.slowPeriod as number;

    if (this.kbars.length < slowPeriod + 2) return;

    const closes = this.kbars.map(k => k.close);

    // 直接调用同步的 SMA 函数
    const smaFunc = (data: number[], period: number) => {
      const result: number[] = [];
      for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
          result.push(NaN);
        } else {
          const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
          result.push(sum / period);
        }
      }
      return result;
    };

    const fastMA = smaFunc(closes, fastPeriod);
    const slowMA = smaFunc(closes, slowPeriod);

    const currentFastMA = fastMA[fastMA.length - 1];
    const currentSlowMA = slowMA[slowMA.length - 1];
    const prevFastMA = fastMA[fastMA.length - 2];
    const prevSlowMA = slowMA[slowMA.length - 2];

    let direction: Direction | 'neutral' = 'neutral';
    let strength = 0;
    let reason = '';

    // 金叉
    if (prevFastMA <= prevSlowMA && currentFastMA > currentSlowMA) {
      direction = 'long';
      strength = 0.8;
      reason = `均线金叉: MA${fastPeriod}=${currentFastMA.toFixed(2)}, MA${slowPeriod}=${currentSlowMA.toFixed(2)}`;
    }
    // 死叉
    else if (prevFastMA >= prevSlowMA && currentFastMA < currentSlowMA) {
      direction = 'short';
      strength = 0.8;
      reason = `均线死叉: MA${fastPeriod}=${currentFastMA.toFixed(2)}, MA${slowPeriod}=${currentSlowMA.toFixed(2)}`;
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

// ==================== CCI 策略 ====================

export class CCIStrategy extends Strategy {
  constructor(config?: Partial<StrategyConfig>) {
    super('CCI', {
      name: 'CCI策略',
      enabled: true,
      params: {
        period: 14,
        oversold: -100,
        overbought: 100
      },
      ...config
    });
  }

  onBar(bar: KBar): void {
    this.kbars.push(bar);
    if (this.kbars.length < 15) return;

    const { cci } = computeIndicators(this.kbars);
    const currentCCI = cci[cci.length - 1];
    const prevCCI = cci[cci.length - 2];

    const oversold = this.config.params.oversold as number;
    const overbought = this.config.params.overbought as number;

    let direction: Direction | 'neutral' = 'neutral';
    let strength = 0;
    let reason = '';

    // CCI 从超卖区上穿 -100：买入信号
    if (prevCCI <= oversold && currentCCI > oversold) {
      direction = 'long';
      strength = 0.7;
      reason = `CCI脱离超卖区: CCI=${currentCCI.toFixed(2)} > ${oversold}`;
    }
    // CCI 从超买区下穿 +100：卖出信号
    else if (prevCCI >= overbought && currentCCI < overbought) {
      direction = 'short';
      strength = 0.7;
      reason = `CCI脱离超买区: CCI=${currentCCI.toFixed(2)} < ${overbought}`;
    }
    // CCI 在极端区域持续
    else if (currentCCI < oversold) {
      direction = 'long';
      strength = 0.4;
      reason = `CCI深度超卖: CCI=${currentCCI.toFixed(2)}`;
    } else if (currentCCI > overbought) {
      direction = 'short';
      strength = 0.4;
      reason = `CCI深度超买: CCI=${currentCCI.toFixed(2)}`;
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

// ==================== OBV 策略 ====================

export class OBVStrategy extends Strategy {
  constructor(config?: Partial<StrategyConfig>) {
    super('OBV', {
      name: 'OBV策略',
      enabled: true,
      params: {
        period: 20
      },
      ...config
    });
  }

  onBar(bar: KBar): void {
    this.kbars.push(bar);
    if (this.kbars.length < 21) return;

    const { obv } = computeIndicators(this.kbars);
    const closes = this.kbars.map(k => k.close);

    const period = this.config.params.period as number;
    const currentOBV = obv[obv.length - 1];
    const prevOBV = obv[obv.length - 2];

    // 计算 OBV 的简单移动平均
    let obvSMA = 0;
    for (let i = obv.length - period; i < obv.length; i++) {
      obvSMA += obv[i];
    }
    obvSMA /= period;

    let direction: Direction | 'neutral' = 'neutral';
    let strength = 0;
    let reason = '';

    // OBV 上穿其均线：量价配合，多头
    if (prevOBV <= obvSMA && currentOBV > obvSMA) {
      direction = 'long';
      strength = 0.6;
      reason = `OBV上穿均线: OBV=${currentOBV.toFixed(2)} > SMA=${obvSMA.toFixed(2)}`;
    }
    // OBV 下穿其均线：量价背离，空头
    else if (prevOBV >= obvSMA && currentOBV < obvSMA) {
      direction = 'short';
      strength = 0.6;
      reason = `OBV下穿均线: OBV=${currentOBV.toFixed(2)} < SMA=${obvSMA.toFixed(2)}`;
    }
    // OBV 持续上升且价格也在上升
    else if (currentOBV > prevOBV && closes[closes.length - 1] > closes[closes.length - 2]) {
      direction = 'long';
      strength = 0.4;
      reason = `OBV持续上升，量价齐升: OBV=${currentOBV.toFixed(2)}`;
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

// ==================== ADX 策略 ====================

export class ADXStrategy extends Strategy {
  constructor(config?: Partial<StrategyConfig>) {
    super('ADX', {
      name: 'ADX策略',
      enabled: true,
      params: {
        period: 14,
        adxThreshold: 25
      },
      ...config
    });
  }

  onBar(bar: KBar): void {
    this.kbars.push(bar);
    if (this.kbars.length < 30) return; // ADX 需要较长的预热期

    const { adx } = computeIndicators(this.kbars);
    const { adx: adxArr, plusDI, minusDI } = adx;

    const currentADX = adxArr[adxArr.length - 1];
    const currentPlusDI = plusDI[plusDI.length - 1];
    const currentMinusDI = minusDI[minusDI.length - 1];
    const prevPlusDI = plusDI[plusDI.length - 2];
    const prevMinusDI = minusDI[minusDI.length - 2];

    const adxThreshold = this.config.params.adxThreshold as number;

    let direction: Direction | 'neutral' = 'neutral';
    let strength = 0;
    let reason = '';

    // ADX > threshold 且 +DI 上穿 -DI：上升趋势确立
    if (currentADX > adxThreshold && prevPlusDI <= prevMinusDI && currentPlusDI > currentMinusDI) {
      direction = 'long';
      strength = Math.min(currentADX / 50, 1);
      reason = `ADX趋势确认: ADX=${currentADX.toFixed(2)} > ${adxThreshold}, +DI=${currentPlusDI.toFixed(2)} > -DI=${currentMinusDI.toFixed(2)}`;
    }
    // ADX > threshold 且 -DI 上穿 +DI：下降趋势确立
    else if (currentADX > adxThreshold && prevMinusDI <= prevPlusDI && currentMinusDI > currentPlusDI) {
      direction = 'short';
      strength = Math.min(currentADX / 50, 1);
      reason = `ADX趋势确认: ADX=${currentADX.toFixed(2)} > ${adxThreshold}, -DI=${currentMinusDI.toFixed(2)} > +DI=${currentPlusDI.toFixed(2)}`;
    }
    // ADX 下降趋势减弱
    else if (currentADX < adxThreshold) {
      direction = 'neutral';
      strength = 0;
      reason = `ADX=${currentADX.toFixed(2)} < ${adxThreshold}，趋势不明显`;
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

// ==================== 策略工厂 ====================

export type StrategyType = 'macd' | 'bollinger' | 'rsi' | 'kdj' | 'ma' | 'cci' | 'obv' | 'adx';

export const StrategyFactory = {
  create(type: StrategyType, params?: Partial<StrategyConfig>): Strategy {
    switch (type) {
      case 'macd':
        return new MACDStrategy(params);
      case 'bollinger':
        return new BollingerStrategy(params);
      case 'rsi':
        return new RSIStrategy(params);
      case 'kdj':
        return new KDJStrategy(params);
      case 'ma':
        return new MAStrategy(params);
      case 'cci':
        return new CCIStrategy(params);
      case 'obv':
        return new OBVStrategy(params);
      case 'adx':
        return new ADXStrategy(params);
      default:
        return new MACDStrategy(params);
    }
  },

  list(): { type: StrategyType; name: string; description: string }[] {
    return [
      { type: 'macd', name: 'MACD策略', description: '基于MACD指标的金叉死叉信号' },
      { type: 'bollinger', name: '布林带策略', description: '基于布林带突破和回归信号' },
      { type: 'rsi', name: 'RSI策略', description: '基于RSI超买超卖信号' },
      { type: 'kdj', name: 'KDJ策略', description: '基于KDJ随机指标的金叉死叉' },
      { type: 'ma', name: '均线交叉策略', description: '快慢均线交叉信号' },
      { type: 'cci', name: 'CCI策略', description: '基于CCI顺势指标的超买超卖信号' },
      { type: 'obv', name: 'OBV策略', description: '基于能量潮量价配合信号' },
      { type: 'adx', name: 'ADX策略', description: '基于ADX趋向指数的趋势强度信号' },
    ];
  }
};
