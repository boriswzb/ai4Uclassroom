/**
 * 技术指标计算库
 * 基于 quant-trading 和 VeighNa 的指标实现
 */

import { KBar } from '../types';

/**
 * 计算简单移动平均线 (SMA)
 */
export function SMA(data: number[], period: number): number[] {
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
}

/**
 * 计算指数移动平均线 (EMA)
 */
export function EMA(data: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      result.push(data[0]);
    } else if (i < period - 1) {
      // 计算初始SMA作为EMA起点
      const sum = data.slice(0, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / (i + 1));
    } else if (i === period - 1) {
      const sum = data.slice(0, period).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    } else {
      const ema = (data[i] - result[i - 1]) * multiplier + result[i - 1];
      result.push(ema);
    }
  }
  return result;
}

/**
 * 计算 MACD (Moving Average Convergence Divergence)
 * 返回 { macd, signal, histogram }
 */
export function MACD(
  data: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number[]; signal: number[]; histogram: number[] } {
  const fastEMA = EMA(data, fastPeriod);
  const slowEMA = EMA(data, slowPeriod);

  const macd: number[] = [];
  for (let i = 0; i < data.length; i++) {
    macd.push(fastEMA[i] - slowEMA[i]);
  }

  const signal = EMA(macd, signalPeriod);

  const histogram: number[] = [];
  for (let i = 0; i < macd.length; i++) {
    histogram.push(macd[i] - signal[i]);
  }

  return { macd, signal, histogram };
}

/**
 * 计算 RSI (Relative Strength Index)
 */
export function RSI(data: number[], period: number = 14): number[] {
  const result: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }

  result.push(NaN); // 第一个数据点没有RSI

  for (let i = 1; i < data.length; i++) {
    if (i < period) {
      result.push(NaN);
    } else {
      const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
      const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period;

      if (avgLoss === 0) {
        result.push(100);
      } else {
        const rs = avgGain / avgLoss;
        result.push(100 - 100 / (1 + rs));
      }
    }
  }

  return result;
}

/**
 * 计算布林带 (Bollinger Bands)
 */
export function BollingerBands(
  data: number[],
  period: number = 20,
  stdDev: number = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = SMA(data, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
    } else {
      const slice = data.slice(i - period + 1, i + 1);
      const mean = middle[i];
      const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
      const std = Math.sqrt(variance);
      upper.push(mean + stdDev * std);
      lower.push(mean - stdDev * std);
    }
  }

  return { upper, middle, lower };
}

/**
 * 计算 KDJ 随机指标
 */
export function KDJ(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 9
): { k: number[]; d: number[]; j: number[] } {
  const k: number[] = [];
  const d: number[] = [];
  const j: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      k.push(NaN);
      d.push(NaN);
      j.push(NaN);
    } else {
      const high = Math.max(...highs.slice(i - period + 1, i + 1));
      const low = Math.min(...lows.slice(i - period + 1, i + 1));
      const close = closes[i];

      const rsv = high === low ? 50 : ((close - low) / (high - low)) * 100;

      // 修复（2026-06-15）：i == period - 1 是第一个有值的索引，prevK/prevD 用 50 初始化（KDJ 标准）
      //   旧代码直接读 k[-1] = NaN，导致 rsv 永远被 NaN 污染 → k/d 雪崩全 NaN → 上游 fallback 50
      //   现象：所有股票 kdjK=50 (80/80)，technical 子项的 kdj 完全不贡献区分度
      //   修复后，茅台/银行/科技股等会输出 0~100 范围的有效 KDJ 值
      const isFirst = i === period - 1;
      const prevK = isFirst ? 50 : (k[k.length - 1] ?? 50);
      const prevD = isFirst ? 50 : (d[d.length - 1] ?? 50);

      const kValue = (2 * prevK + rsv) / 3;
      const dValue = (2 * prevD + kValue) / 3;
      const jValue = 3 * kValue - 2 * dValue;

      k.push(kValue);
      d.push(dValue);
      j.push(jValue);
    }
  }

  return { k, d, j };
}

/**
 * 计算 ATR (Average True Range)
 */
export function ATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number[] {
  const tr: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      tr.push(highs[i] - lows[i]);
    } else {
      const hl = highs[i] - lows[i];
      const hc = Math.abs(highs[i] - closes[i - 1]);
      const lc = Math.abs(lows[i] - closes[i - 1]);
      tr.push(Math.max(hl, hc, lc));
    }
  }

  return EMA(tr, period);
}

/**
 * 计算成交量加权平均价格 (VWAP)
 */
export function VWAP(highs: number[], lows: number[], closes: number[], volumes: number[]): number[] {
  const typicalPrices: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    typicalPrices.push((highs[i] + lows[i] + closes[i]) / 3);
  }

  const cumulativeTpVol: number[] = [];
  const cumulativeVol: number[] = [];
  const vwap: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      cumulativeTpVol.push(typicalPrices[i] * volumes[i]);
      cumulativeVol.push(volumes[i]);
    } else {
      cumulativeTpVol.push(cumulativeTpVol[i - 1] + typicalPrices[i] * volumes[i]);
      cumulativeVol.push(cumulativeVol[i - 1] + volumes[i]);
    }
    vwap.push(cumulativeTpVol[i] / cumulativeVol[i]);
  }

  return vwap;
}

/**
 * 计算 OBV (On Balance Volume / 能量潮)
 * 收盘价比上日高则加成交量，低则减，相同则不变
 */
export function OBV(closes: number[], volumes: number[]): number[] {
  const obv: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      obv.push(volumes[i]);
    } else {
      if (closes[i] > closes[i - 1]) {
        obv.push(obv[i - 1] + volumes[i]);
      } else if (closes[i] < closes[i - 1]) {
        obv.push(obv[i - 1] - volumes[i]);
      } else {
        obv.push(obv[i - 1]);
      }
    }
  }
  return obv;
}

/**
 * 计算 CCI (Commodity Channel Index / 顺势指标)
 * 典型价 = (最高 + 最低 + 收盘) / 3
 * CCI = (典型价 - 典型价N日均值) / (0.015 * 均值离差)
 */
export function CCI(
  highs: number[], lows: number[], closes: number[],
  period: number = 14
): number[] {
  const typicalPrices: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    typicalPrices.push((highs[i] + lows[i] + closes[i]) / 3);
  }

  const tpSMA = SMA(typicalPrices, period);
  const cci: number[] = [];

  for (let i = 0; i < typicalPrices.length; i++) {
    if (i < period - 1) {
      cci.push(NaN);
    } else {
      const tp = typicalPrices[i];
      const mean = tpSMA[i];
      // 均值离差
      let sumDev = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sumDev += Math.abs(typicalPrices[j] - mean);
      }
      const meanDev = sumDev / period;
      if (meanDev === 0) {
        cci.push(0);
      } else {
        cci.push((tp - mean) / (0.015 * meanDev));
      }
    }
  }
  return cci;
}

/**
 * 计算 ADX (Average Directional Index / 平均趋向指数)
 * 步骤：
 *  1. 求 True Range (同 ATR)
 *  2. 求 +DM / -DM（排除震荡的虚假方向）
 *  3. 计算 +DI / -DI（方向指标）
 *  4. 求 DX = |+DI - -DI| / (+DI + -DI) * 100
 *  5. ADX = Wilder平滑(DX, period)
 */
export function ADX(
  highs: number[], lows: number[], closes: number[],
  period: number = 14
): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      tr.push(highs[i] - lows[i]);
      plusDM.push(0);
      minusDM.push(0);
    } else {
      const hl = highs[i] - lows[i];
      const hc = Math.abs(highs[i] - closes[i - 1]);
      const lc = Math.abs(lows[i] - closes[i - 1]);
      tr.push(Math.max(hl, hc, lc));

      const upMove = highs[i] - highs[i - 1];
      const downMove = lows[i - 1] - lows[i];

      // +DM：只在上升趋势中取正值，且要大于 -DM
      if (upMove > downMove && upMove > 0) {
        plusDM.push(upMove);
      } else {
        plusDM.push(0);
      }
      // -DM：只在下降趋势中取正值，且要大于 +DM
      if (downMove > upMove && downMove > 0) {
        minusDM.push(downMove);
      } else {
        minusDM.push(0);
      }
    }
  }

  // Wilder 平滑：EMA with alpha = 1/period
  const alpha = 1 / period;
  const smooth = (arr: number[], n: number): number[] => {
    const result: number[] = new Array(arr.length).fill(NaN);
    // 修复（2026-06-15）：跳过 NaN 找第一个有效值；sum 仅累加有效值；保持 result 长度与输入一致
    //   旧代码：sum 包含前 13 个 NaN（dx 在 i<13 时都是 NaN）→ result 第一个值是 NaN → 雪崩全 NaN
    //   上游 factors.ts:adx fallback 0 → 80/80 全 0
    let firstValid = -1;
    for (let i = 0; i < arr.length; i++) {
      if (!isNaN(arr[i])) { firstValid = i; break; }
    }
    if (firstValid === -1) {
      // 全 NaN：返回全 0（让上游不要 fallback NaN）
      return arr.map(() => 0);
    }

    // 第一个有效值 = sum of [firstValid, firstValid+n) 内的所有有效值
    // 这是 Wilder 标准：first = sum of n 个值
    let sum = 0;
    const upper = Math.min(firstValid + n, arr.length);
    for (let i = firstValid; i < upper; i++) {
      if (!isNaN(arr[i])) sum += arr[i];
    }
    result[firstValid] = sum;

    // firstValid+1..firstValid+n-1 之间：用 EMA 形式（prev * (1-a) + cur * a）递推
    //   prev 是 result[firstValid] = sum，但 sum 是 n 个的累计 → 之后 n 步要把"窗口"归一到 1 个值
    //   标准的 Wilder 平滑：从 firstValid 之后，result[i] = result[i-1] * (1-a) + arr[i] * a
    //   这才是对的（firstValid 之后每一步 EMA 一格）
    for (let i = firstValid + 1; i < arr.length; i++) {
      const prev = result[i - 1];
      const cur = isNaN(arr[i]) ? 0 : arr[i];
      result[i] = prev * (1 - alpha) + cur * alpha;
    }
    return result;
  };

  const trSmooth = smooth(tr, period);
  const plusDMSmooth = smooth(plusDM, period);
  const minusDMSmooth = smooth(minusDM, period);

  const plusDI: number[] = [];
  const minusDI: number[] = [];
  const dx: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      plusDI.push(NaN);
      minusDI.push(NaN);
      dx.push(NaN);
    } else {
      const trVal = trSmooth[i];
      const pDM = plusDMSmooth[i];
      const mDM = minusDMSmooth[i];
      if (trVal === 0) {
        plusDI.push(0);
        minusDI.push(0);
      } else {
        plusDI.push((pDM / trVal) * 100);
        minusDI.push((mDM / trVal) * 100);
      }
      const pdi = plusDI[plusDI.length - 1];
      const mdi = minusDI[minusDI.length - 1];
      const sumDI = pdi + mdi;
      if (sumDI === 0) {
        dx.push(0);
      } else {
        dx.push(Math.abs(pdi - mdi) / sumDI * 100);
      }
    }
  }

  // ADX = EMA(dx, period) with Wilder smoothing
  const adxRaw = smooth(dx, period);
  const adx: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < 2 * period - 2) {
      adx.push(NaN);
    } else {
      adx.push(adxRaw[i]);
    }
  }

  return { adx, plusDI, minusDI };
}

// ==================== Williams %R (威廉指标) ====================

/**
 * Williams %R / 威廉指标
 * 公式：%R = (最高价 - 收盘价) / (最高价 - 最低价) * -100
 * 区间：-100 到 0
 * 超卖区间：<-80，超买区间：>-20
 */
export function WilliamsR(
  highs: number[], lows: number[], closes: number[],
  period: number = 14
): number[] {
  const result: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const high = Math.max(...highs.slice(i - period + 1, i + 1));
      const low = Math.min(...lows.slice(i - period + 1, i + 1));
      const close = closes[i];

      if (high === low) {
        result.push(-50); // 避免除零
      } else {
        const wr = ((high - close) / (high - low)) * -100;
        result.push(wr);
      }
    }
  }

  return result;
}

// ==================== 乖离率 (Bias) ====================

/**
 * 乖离率 BIAS
 * 公式：BIAS = (收盘价 - N日均线) / N日均线 * 100
 * 用途：股价偏离均线过远时的回归机会
 */
export function Bias(closes: number[], period: number = 20): number[] {
  const ma = SMA(closes, period);
  return closes.map((close, i) => {
    if (i < period - 1) return NaN;
    return ((close - ma[i]) / ma[i]) * 100;
  });
}

// ==================== MFI (Money Flow Index / 资金流量指标) ====================

/**
 * MFI 资金流量指标
 * 类似于RSI，但考虑了成交量
 * 典型价 = (最高 + 最低 + 收盘) / 3
 * 资金流量 = 典型价 * 成交量
 * 区间：0 到 100
 * 超卖：<20，超买：>80
 */
export function MFI(
  highs: number[], lows: number[], closes: number[], volumes: number[],
  period: number = 14
): number[] {
  const result: number[] = [];
  const typicalPrices: number[] = [];
  const moneyFlows: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    typicalPrices.push(tp);
    moneyFlows.push(tp * volumes[i]);
  }

  result.push(NaN); // 第一个数据点没有MFI

  for (let i = 1; i < typicalPrices.length; i++) {
    if (i < period) {
      result.push(NaN);
    } else {
      let positiveFlow = 0;
      let negativeFlow = 0;

      for (let j = i - period + 1; j <= i; j++) {
        if (typicalPrices[j] > typicalPrices[j - 1]) {
          positiveFlow += moneyFlows[j];
        } else if (typicalPrices[j] < typicalPrices[j - 1]) {
          negativeFlow += moneyFlows[j];
        }
      }

      if (negativeFlow === 0) {
        result.push(100); // 上涨趋势
      } else {
        const moneyRatio = positiveFlow / negativeFlow;
        result.push(100 - (100 / (1 + moneyRatio)));
      }
    }
  }

  return result;
}

// ==================== KD 随机震荡指标（不同于KDJ的简化版） ====================

/**
 * 简化KD指标（与KDJ不同，这里是纯随机震荡）
 * K和D在0-100波动，K穿越D产生信号
 * 股价在周期内位置 = (C - L) / (H - L)
 */
export function Stochastic(
  highs: number[], lows: number[], closes: number[],
  kPeriod: number = 14, dPeriod: number = 3
): { k: number[]; d: number[] } {
  const k: number[] = [];
  const d: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < kPeriod - 1) {
      k.push(NaN);
      d.push(NaN);
    } else {
      const high = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
      const low = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
      const close = closes[i];

      if (high === low) {
        k.push(50);
      } else {
        const fastK = ((close - low) / (high - low)) * 100;
        k.push(fastK);
      }
    }
  }

  // D = SMA(K, dPeriod)
  for (let i = 0; i < k.length; i++) {
    if (i < kPeriod + dPeriod - 2) {
      d.push(NaN);
    } else {
      const slice = k.slice(i - dPeriod + 1, i + 1).filter(v => !isNaN(v));
      if (slice.length === 0) {
        d.push(NaN);
      } else {
        d.push(slice.reduce((a, b) => a + b, 0) / slice.length);
      }
    }
  }

  return { k, d };
}

// ==================== 成交量突破确认 ====================

/**
 * 成交量突破策略的辅助函数
 * 计算成交量MA，判断当前成交量是否超过MA的倍数
 */
export function VolumeBreakout(
  volumes: number[],
  period: number = 20,
  multiplier: number = 1.5
): { isBreakout: boolean[]; volumeMA: number[] } {
  const volumeMA = SMA(volumes, period);
  const isBreakout: boolean[] = [];

  for (let i = 0; i < volumes.length; i++) {
    if (i < period) {
      isBreakout.push(false);
    } else {
      isBreakout.push(volumes[i] > volumeMA[i] * multiplier);
    }
  }

  return { isBreakout, volumeMA };
}

/**
 * 从K线数据提取技术指标（增强版）
 */
export function computeIndicators(kbars: KBar[]): {
  sma5: number[];
  sma10: number[];
  sma20: number[];
  sma60: number[];
  ema12: number[];
  ema26: number[];
  macd: { macd: number[]; signal: number[]; histogram: number[] };
  rsi: number[];
  bollinger: { upper: number[]; middle: number[]; lower: number[] };
  kdj: { k: number[]; d: number[]; j: number[] };
  atr: number[];
  vwap: number[];
  cci: number[];
  obv: number[];
  adx: { adx: number[]; plusDI: number[]; minusDI: number[] };
  williamsR: number[];
  bias: number[];
  mfi: number[];
  stochastic: { k: number[]; d: number[] };
  volumeBreakout: { isBreakout: boolean[]; volumeMA: number[] };
} {
  const closes = kbars.map(k => k.close);
  const highs = kbars.map(k => k.high);
  const lows = kbars.map(k => k.low);
  const volumes = kbars.map(k => k.volume);

  return {
    sma5: SMA(closes, 5),
    sma10: SMA(closes, 10),
    sma20: SMA(closes, 20),
    sma60: SMA(closes, 60),
    ema12: EMA(closes, 12),
    ema26: EMA(closes, 26),
    macd: MACD(closes, 12, 26, 9),
    rsi: RSI(closes, 14),
    bollinger: BollingerBands(closes, 20, 2),
    kdj: KDJ(highs, lows, closes, 9),
    atr: ATR(highs, lows, closes, 14),
    vwap: VWAP(highs, lows, closes, volumes),
    cci: CCI(highs, lows, closes, 14),
    obv: OBV(closes, volumes),
    adx: ADX(highs, lows, closes, 14),
    williamsR: WilliamsR(highs, lows, closes, 14),
    bias: Bias(closes, 20),
    mfi: MFI(highs, lows, closes, volumes, 14),
    stochastic: Stochastic(highs, lows, closes, 14, 3),
    volumeBreakout: VolumeBreakout(volumes, 20, 1.5),
  };
}
