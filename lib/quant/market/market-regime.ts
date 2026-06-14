/**
 * 市场状态分类器
 * 多维度判断当前市场状态，用于：
 * 1. 动态策略切换（高波动用布林带，趋势强用MACD）
 * 2. 仓位动态调整（高风险市场减仓）
 * 3. 预警提示（市场异常时提醒用户）
 *
 * 判断维度：
 * - 趋势强度（ADX）
 * - 波动率（ATR/Realized Vol）
 * - 成交量（量能变化）
 * - 趋势方向（均线排列）
 * - 市场宽度（涨跌家数比）
 */

import { KBar } from '../types';
import { SMA, EMA, ATR, ADX } from '../strategies/indicators';

// ==================== 市场状态定义 ====================

export type MarketRegime =
  | 'strong_uptrend'    // 强势上涨
  | 'weak_uptrend'      // 弱势上涨
  | 'strong_downtrend'  // 强势下跌
  | 'weak_downtrend'    // 弱势下跌
  | 'high_volatility'   // 高波动横盘
  | 'low_volatility'    // 低波动横盘
  | 'uncertain';        // 方向不明

export interface MarketRegimeResult {
  regime: MarketRegime;
  /** 置信度 0-1 */
  confidence: number;
  /** 各维度评分 */
  scores: {
    trendStrength: number;   // 趋势强度 0-1
    volatility: number;       // 波动率 0-1（越高越动荡）
    volumeStrength: number;   // 量能强度 0-1
    breadthScore: number;     // 市场宽度 -1到1（正=多头主导）
  };
  /** 各维度原始值 */
  rawValues: {
    adx: number;
    atrPercent: number;       // ATR占价格百分比
    volumeRatio: number;      // 量比（当前/均值）
    maAlignment: number;      // 均线多头排列程度 -1到1
  };
  /** 建议的策略类型 */
  recommendedStrategy: string[];
  /** 建议的仓位倍数（相对基础仓位） */
  suggestedPositionMultiplier: number;
  /** 判断理由 */
  reason: string;
}

// ==================== 市场宽度数据（需要外部传入） ====================

export interface MarketBreadthData {
  upCount: number;
  downCount: number;
  flatCount: number;
}

// ==================== 市场分类器 ====================

export class MarketRegimeClassifier {
  private kbars: KBar[] = [];

  /** 更新K线数据 */
  updateBars(bars: KBar[]): void {
    this.kbars = bars;
  }

  /**
   * 分析当前市场状态
   * @param lookbackDays 回看天数（默认20）
   * @param breadthData 市场宽度数据（可选）
   */
  analyze(lookbackDays: number = 20, breadthData?: MarketBreadthData): MarketRegimeResult {
    if (this.kbars.length < 30) {
      return this.defaultResult('uncertain', 0, '数据不足，无法判断市场状态');
    }

    const recent = this.kbars.slice(-lookbackDays);
    const closes = recent.map(k => k.close);
    const highs = recent.map(k => k.high);
    const lows = recent.map(k => k.low);
    const volumes = recent.map(k => k.volume);

    // === 计算各维度指标 ===
    const adxResult = ADX(highs, lows, closes, 14);
    const adx = adxResult.adx[adxResult.adx.length - 1];
    const plusDI = adxResult.plusDI[adxResult.plusDI.length - 1];
    const minusDI = adxResult.minusDI[adxResult.minusDI.length - 1];

    // ATR百分比（波动率）
    const atrValues = ATR(highs, lows, closes, 14);
    const atr = atrValues[atrValues.length - 1];
    const currentClose = closes[closes.length - 1];
    const atrPercent = atr / currentClose; // ATR占价格的百分比

    // 成交量比
    const volMA = SMA(volumes, 20);
    const currentVol = volumes[volumes.length - 1];
    const avgVol = volMA[volMA.length - 1] || 1;
    const volumeRatio = currentVol / avgVol;

    // 均线排列（MA5/MA20/MA60 多头还是空头）
    const ma5 = SMA(closes, 5);
    const ma20 = SMA(closes, 20);
    const ma60 = SMA(closes, 60);
    const currentMA5 = ma5[ma5.length - 1];
    const currentMA20 = ma20[ma20.length - 1];
    const currentMA60 = ma60[ma60.length - 1];
    // 多头排列程度：MA5 > MA20 > MA60 = +1，完全反之为 -1
    let maAlignment = 0;
    if (currentMA5 > currentMA20 && currentMA20 > currentMA60) maAlignment = 1;
    else if (currentMA5 < currentMA20 && currentMA20 < currentMA60) maAlignment = -1;

    // DI差值（方向性）
    const diDiff = plusDI - minusDI;

    // === 汇总评分 ===
    const trendStrength = Math.min(1, adx / 50); // ADX 0-50 映射到 0-1
    const volatility = Math.min(1, atrPercent / 0.05); // 5%波动率 = 高波动
    const volumeStrength = Math.min(1, volumeRatio / 2); // 2倍量 = 强量能

    // 市场宽度
    let breadthScore = 0;
    if (breadthData) {
      const total = breadthData.upCount + breadthData.downCount + breadthData.flatCount || 1;
      breadthScore = (breadthData.upCount - breadthData.downCount) / total;
    }

    // === 判断市场状态 ===
    let regime: MarketRegime;
    let confidence: number;
    let reason: string;
    let recommendedStrategy: string[];
    let suggestedPositionMultiplier: number;

    // 高波动（ADX高 + ATR高）
    if (atrPercent > 0.03 && adx > 30) {
      regime = 'high_volatility';
      confidence = Math.min(1, (atrPercent - 0.02) / 0.03);
      reason = `高波动市场（ATR占价格${(atrPercent * 100).toFixed(1)}%，ADX=${adx.toFixed(1)}）`;
      recommendedStrategy = ['bollinger', 'williams', 'rsi'];
      suggestedPositionMultiplier = 0.6;
    }
    // 强趋势上涨（ADX高 + DI+ > DI- + 均线多头）
    else if (adx > 25 && diDiff > 5 && maAlignment > 0) {
      regime = 'strong_uptrend';
      confidence = Math.min(1, (adx - 20) / 30);
      reason = `强势上涨趋势（ADX=${adx.toFixed(1)}，+DI=${plusDI.toFixed(1)}>-DI=${minusDI.toFixed(1)}，均线多头）`;
      recommendedStrategy = ['macd', 'ma', 'adx'];
      suggestedPositionMultiplier = 1.2;
    }
    // 强趋势下跌
    else if (adx > 25 && diDiff < -5 && maAlignment < 0) {
      regime = 'strong_downtrend';
      confidence = Math.min(1, (adx - 20) / 30);
      reason = `强势下跌趋势（ADX=${adx.toFixed(1)}，-DI=${minusDI.toFixed(1)}>+DI=${plusDI.toFixed(1)}，均线空头）`;
      recommendedStrategy = ['macd', 'kdj', 'adx'];
      suggestedPositionMultiplier = 0.8;
    }
    // 弱趋势上涨
    else if (adx > 15 && diDiff > 0 && maAlignment >= 0) {
      regime = 'weak_uptrend';
      confidence = Math.min(1, (adx - 15) / 20);
      reason = `弱势上涨（ADX=${adx.toFixed(1)}，趋势不强）`;
      recommendedStrategy = ['macd', 'rsi', 'mfi'];
      suggestedPositionMultiplier = 1.0;
    }
    // 弱趋势下跌
    else if (adx > 15 && diDiff < 0 && maAlignment <= 0) {
      regime = 'weak_downtrend';
      confidence = Math.min(1, (adx - 15) / 20);
      reason = `弱势下跌（ADX=${adx.toFixed(1)}，趋势不强）`;
      recommendedStrategy = ['kdj', 'rsi', 'bias'];
      suggestedPositionMultiplier = 0.7;
    }
    // 低波动横盘
    else if (atrPercent < 0.015 && adx < 20) {
      regime = 'low_volatility';
      confidence = Math.min(1, (0.02 - atrPercent) / 0.01);
      reason = `低波动横盘（ATR占价格${(atrPercent * 100).toFixed(2)}%，ADX=${adx.toFixed(1)}，方向不明）`;
      recommendedStrategy = ['rsi', 'kdj', 'stochastic', 'bias'];
      suggestedPositionMultiplier = 1.0;
    }
    // 方向不明
    else {
      regime = 'uncertain';
      confidence = 0.5;
      reason = `方向不明（ADX=${adx.toFixed(1)}，波动率${(atrPercent * 100).toFixed(2)}%，建议观望）`;
      recommendedStrategy = ['rsi', 'composite'];
      suggestedPositionMultiplier = 0.5;
    }

    return {
      regime,
      confidence,
      scores: {
        trendStrength,
        volatility,
        volumeStrength,
        breadthScore
      },
      rawValues: {
        adx,
        atrPercent,
        volumeRatio,
        maAlignment
      },
      recommendedStrategy,
      suggestedPositionMultiplier,
      reason
    };
  }

  private defaultResult(regime: MarketRegime, confidence: number, reason: string): MarketRegimeResult {
    return {
      regime,
      confidence,
      scores: { trendStrength: 0, volatility: 0, volumeStrength: 0, breadthScore: 0 },
      rawValues: { adx: 0, atrPercent: 0, volumeRatio: 1, maAlignment: 0 },
      recommendedStrategy: ['macd'],
      suggestedPositionMultiplier: 1.0,
      reason
    };
  }
}
