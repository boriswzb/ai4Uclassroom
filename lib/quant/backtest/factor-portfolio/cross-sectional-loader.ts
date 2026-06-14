/**
 * 截面数据加载器 & 因子计算工具
 *
 * 职责：
 * 1. 回测初始化时批量加载所有股票的历史K线
 * 2. 在每日循环中快速提取截面数据（单日所有股票的因子快照）
 * 3. 计算因子原始值（从K线序列）
 * 4. 截面百分位归一化
 */

import { KBar, StockFactorSnapshot } from '../../types';
import { dataSourceManager } from '../../data/data-source';

// ==================== 工具函数（从 screener/route.ts 抽取） ====================

/** 跨截面百分位排名 — 将数组值转换为0-100百分位分数 */
function percentileScore(vals: number[], reverse = false): number[] {
  const n = vals.length;
  if (n === 0) return [];
  // 建立索引数组并按值排序
  const indexed = vals.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    // 排名转百分位 (i/n * 100)
    result[indexed[i].i] = (i / (n - 1 || 1)) * 100;
  }
  if (reverse) result.forEach((_, i) => { result[i] = 100 - result[i]; });
  return result;
}

/** 计算 RSI（用于反转因子） */
function computeRSI(kbars: KBar[], period = 14): number {
  if (kbars.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = kbars.length - period; i < kbars.length; i++) {
    const delta = kbars[i].close - kbars[i - 1].close;
    if (delta > 0) gains += delta;
    else losses += Math.abs(delta);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

// ==================== 因子计算 ====================

/**
 * 从单只股票的历史K线计算所有因子原始值（取最新一根K线的值）
 */
export function computeFactorValues(kbars: KBar[]): StockFactorSnapshot['factors'] {
  const n = kbars.length;
  if (n === 0) {
    return {
      pe: 0, pb: 0, ps: 0, roe: 0, grossMargin: 0,
      momentum5: 0, momentum20: 0, momentum60: 0,
      reversal: 0, rsi: 50, moneyFlow: 50,
      volumeRatio: 1, turnoverRate: 0,
      macdSignal: 0, kdjSignal: 0,
    };
  }

  const latest = kbars[n - 1];
  const close = latest.close;

  // 动量因子：过去N日收益率
  const momentum5 = n >= 6 ? (close - kbars[n - 6].close) / kbars[n - 6].close : 0;
  const momentum20 = n >= 21 ? (close - kbars[n - 21].close) / kbars[n - 21].close : 0;
  const momentum60 = n >= 61 ? (close - kbars[n - 61].close) / kbars[n - 61].close : 0;

  // 反转因子：当日涨跌幅
  const reversal = n >= 2 ? (close - kbars[n - 2].close) / kbars[n - 2].close : 0;

  // RSI
  const rsi = computeRSI(kbars);

  // 量比：今日成交量 / 过去5日平均成交量
  let volumeRatio = 1;
  if (n >= 6) {
    const avgVol5 = kbars.slice(n - 6, n - 1).reduce((s, b) => s + b.volume, 0) / 5;
    volumeRatio = avgVol5 > 0 ? latest.volume / avgVol5 : 1;
  }

  // 换手率（简化：成交量/总股本估算，这里用成交量/价格粗估）
  const turnoverRate = latest.amount > 0 && close > 0 ? (latest.amount / close) / (1e8) * 100 : 0;

  // MACD 信号（简化版：收盘价相对均线位置）
  const macdSignal = computeMACDSignal(kbars);

  // KDJ 信号（简化版）
  const kdjSignal = computeKDJSignal(kbars);

  // 资金流（简化：基于涨跌幅和成交量的关系估算）
  const moneyFlow = computeMoneyFlowProxy(kbars);

  return {
    // 估值因子：需要基本面数据，这里用模拟值占位
    // 在真实场景中，PE/PB/PS/ROE/毛利率需要从财务数据接口获取
    pe: 0, pb: 0, ps: 0, roe: 0, grossMargin: 0,
    momentum5, momentum20, momentum60,
    reversal, rsi, moneyFlow,
    volumeRatio, turnoverRate,
    macdSignal, kdjSignal,
  };
}

/** MACD 信号值：>0 看多，<0 看空 */
function computeMACDSignal(kbars: KBar[]): number {
  const n = kbars.length;
  if (n < 27) return 0;
  // 简化：EMA12 - EMA26 的正负代表 MACD 线
  const ema12 = computeEMA(kbars, 12);
  const ema26 = computeEMA(kbars, 26);
  return ema12 - ema26;
}

/** KDJ 信号值：K值（0-100） */
function computeKDJSignal(kbars: KBar[]): number {
  const n = kbars.length;
  if (n < 9) return 50;
  // 取最近9日高低点
  const recent = kbars.slice(n - 9);
  const highs = recent.map(b => b.high);
  const lows = recent.map(b => b.low);
  const highestHigh = Math.max(...highs);
  const lowestLow = Math.min(...lows);
  const latestClose = recent[recent.length - 1].close;
  if (highestHigh === lowestLow) return 50;
  const rsv = ((latestClose - lowestLow) / (highestHigh - lowestLow)) * 100;
  // K = 2/3 * prevK + 1/3 * rsv（假设 prevK=50）
  const k = (2 / 3) * 50 + (1 / 3) * rsv;
  return k;
}

/** 资金流代理指标：基于量价关系估算 */
function computeMoneyFlowProxy(kbars: KBar[]): number {
  const n = kbars.length;
  if (n < 5) return 50;
  const latest = kbars[n - 1];
  const avgAmount = kbars.slice(n - 6, n - 1).reduce((s, b) => s + b.amount, 0) / 5;
  // 资金流入：价格上涨且成交量放大
  const priceChg = n >= 2 ? (latest.close - kbars[n - 2].close) / kbars[n - 2].close : 0;
  const volRatio = avgAmount > 0 ? latest.amount / avgAmount : 1;
  // 综合打分（0-100）
  const flowScore = 50 + (priceChg > 0 ? 25 : -25) * Math.min(volRatio, 2) / 2 + (volRatio - 1) * 12.5;
  return Math.max(0, Math.min(100, flowScore));
}

/** 计算 EMA */
function computeEMA(kbars: KBar[], period: number): number {
  const n = kbars.length;
  if (n < period) return kbars[n - 1].close;
  const multiplier = 2 / (period + 1);
  let ema = kbars.slice(0, period).reduce((s, b) => s + b.close, 0) / period;
  for (let i = period; i < n; i++) {
    ema = (kbars[i].close - ema) * multiplier + ema;
  }
  return ema;
}

// ==================== 截面百分位归一化 ====================

export interface PercentileResult {
  pct: Record<string, number>;   // 各因子的截面百分位
  raw: Record<string, number>;    // 各因子的原始值（便于调试）
}

/**
 * 对截面内所有股票的因子做百分位归一化
 * 这个函数等价于 screener/route.ts 的 preComputeFactorPercentiles()
 */
export function preComputeFactorPercentiles(
  snapshots: StockFactorSnapshot[]
): PercentileResult {
  const n = snapshots.length;
  if (n === 0) return { pct: {}, raw: {} };

  // 提取各因子数组
  const momVals = snapshots.map(s => s.factors.momentum20);
  const mfVals = snapshots.map(s => s.factors.moneyFlow);
  const rsiVals = snapshots.map(s => s.factors.rsi);
  const revVals = snapshots.map(s => s.factors.reversal);
  const turnVals = snapshots.map(s => s.factors.turnoverRate);
  const volRatioVals = snapshots.map(s => s.factors.volumeRatio);
  const macdVals = snapshots.map(s => s.factors.macdSignal);
  const kdjVals = snapshots.map(s => s.factors.kdjSignal);
  const mom5Vals = snapshots.map(s => s.factors.momentum5);
  const mom60Vals = snapshots.map(s => s.factors.momentum60);

  // 计算百分位
  const momPct = percentileScore(momVals);
  const mfPct = percentileScore(mfVals);
  const rsiPct = percentileScore(rsiVals);
  const revPct = percentileScore(revVals, true); // 反转：跌得多给分高
  const turnPct = percentileScore(turnVals);
  const volPct = percentileScore(volRatioVals);
  const macdPct = percentileScore(macdVals);
  const kdjPct = percentileScore(kdjVals);
  const mom5Pct = percentileScore(mom5Vals);
  const mom60Pct = percentileScore(mom60Vals);

  // 填充 pct
  for (let i = 0; i < n; i++) {
    const s = snapshots[i];
    s.pct = {
      momentum: momPct[i],
      momentum5: mom5Pct[i],
      momentum60: mom60Pct[i],
      reversal: revPct[i],
      rsiReversal: rsiPct[i],   // RSI 超卖给高分
      moneyFlow: mfPct[i],
      turnover: turnPct[i],
      volumeRatio: volPct[i],
      technical: (macdPct[i] + kdjPct[i]) / 2, // 技术信号综合
    };
  }

  return {
    pct: {},  // 已填充到 snapshots
    raw: {
      momentumMean: momVals.reduce((a, b) => a + b, 0) / n,
      moneyFlowMean: mfVals.reduce((a, b) => a + b, 0) / n,
    },
  };
}

// ==================== 截面数据加载器 ====================

/**
 * 截面数据加载器
 * 回测初始化时批量加载所有股票历史K线缓存在内存，
 * 每日提取截面时无需网络请求。
 */
export class CrossSectionalDataLoader {
  private kbarsCache: Map<string, KBar[]> = new Map(); // code -> sorted KBar[]
  private benchmarkCache: KBar[] = [];
  private loading: Promise<void> | null = null;

  /**
   * 预加载所有股票的历史K线（回测初始化时调用一次）
   * @param codes 股票代码列表
   * @param start 起始时间戳
   * @param end 结束时间戳
   * @param lookback 往前多加载的天数（用于计算因子，默认多取120天）
   */
  async preload(codes: string[], start: number, end: number, lookback = 120): Promise<void> {
    const actualStart = start - lookback * 86400000;
    console.log(`[CrossSectionalLoader] 预加载 ${codes.length} 只股票 K线 (${new Date(actualStart).toISOString().slice(0,10)} ~ ${new Date(end).toISOString().slice(0,10)})`);

    // 串行加载每只股票（避免并发请求过多）
    for (const code of codes) {
      const kbars = await dataSourceManager.getKBar(code, actualStart, end);
      kbars.sort((a, b) => a.timestamp - b.timestamp);
      this.kbarsCache.set(code, kbars);
    }
    console.log(`[CrossSectionalLoader] 预加载完成，${this.kbarsCache.size} 只股票`);
  }

  /**
   * 加载基准指数K线
   */
  async preloadBenchmark(code: string, start: number, end: number): Promise<void> {
    const kbars = await dataSourceManager.getKBar(code, start, end);
    kbars.sort((a, b) => a.timestamp - b.timestamp);
    this.benchmarkCache = kbars;
  }

  /**
   * 获取某只股票的历史K线（已缓存）
   */
  getKBar(code: string): KBar[] {
    return this.kbarsCache.get(code) ?? [];
  }

  /**
   * 获取基准指数在某日期的价格
   */
  getBenchmarkPrice(dateTs: number): number | null {
    // 找最接近但不超过 dateTs 的 bar
    let closest: KBar | null = null;
    for (const b of this.benchmarkCache) {
      if (b.timestamp <= dateTs) closest = b;
      else break;
    }
    return closest?.close ?? null;
  }

  /**
   * 提取某日所有股票的因子快照
   * @param dateTs 那一天的日期时间戳（00:00 UTC）
   */
  extractSnapshot(dateTs: number): StockFactorSnapshot[] {
    const snapshots: StockFactorSnapshot[] = [];

    for (const [code, kbars] of this.kbarsCache) {
      // 找最接近但不超过 dateTs 的 K线
      let bar: KBar | null = null;
      for (const b of kbars) {
        if (b.timestamp <= dateTs) bar = b;
        else break;
      }
      if (!bar) continue;

      // 取截至 bar 为止的所有历史K线（用于计算动量、RSI等需要历史序列的因子）
      const historyEndIdx = kbars.indexOf(bar);
      if (historyEndIdx < 0) continue;
      const historyKb = kbars.slice(0, historyEndIdx + 1);

      const factors = computeFactorValues(historyKb);
      snapshots.push({
        code,
        timestamp: bar.timestamp,
        close: bar.close,
        factors,
        pct: {},  // 待 preComputeFactorPercentiles 填充
      });
    }

    return snapshots;
  }

  /**
   * 获取有数据的交易日列表
   */
  buildTradingDays(start: number, end: number): { timestamp: number; date: string }[] {
    const days = new Map<number, string>();
    for (const [, kbars] of this.kbarsCache) {
      for (const b of kbars) {
        if (b.timestamp >= start && b.timestamp <= end) {
          const d = new Date(b.timestamp);
          const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
          if (!days.has(dayStart)) {
            days.set(dayStart, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
          }
        }
      }
    }
    return Array.from(days.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ts, date]) => ({ timestamp: ts, date }));
  }
}
