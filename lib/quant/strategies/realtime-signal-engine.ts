/**
 * 实时信号引擎 (Realtime Signal Engine)
 *
 * 客户端运行，接收实时行情推送 → 驱动策略引擎 → 产出信号
 *
 * 【架构设计】：
 *
 *   实时行情 (5s轮询)
 *      ↓
 *   RealtimeSignalEngine.updateRealtimeQuote(code, quote)
 *      ↓
 *   1. 缓存的日K线 + quote.price/high/low/open → patch 最新K线
 *   2. computeIndicators(kbars) → 全套指标
 *   3. 各策略 onBar(bar) → 各自 Signal
 *   4. 合成综合信号（投票加权）
 *      ↓
 *   { indicators, strategySignals, compositeSignal }
 *
 * 【优势】：
 *   - 日K线数据每日只fetch一次（60天），之后只用实时行情更新
 *   - 指标计算在客户端执行，不占用服务端资源
 *   - 支持多策略同时运行，信号众数为最终方向
 *
 * 【局限性】：
 *   - 日K线级别信号，不做分钟级（分钟K线需独立数据源）
 *   - 开盘/收盘时K线状态切换需特殊处理
 */

import { KBar, Signal, Direction } from '../types';
import { computeIndicators } from './indicators';
import type { Strategy } from './strategy-engine';
import {
  MACDStrategy, KDJStrategy, MAStrategy, BollingerStrategy, RSIStrategy,
} from './strategy-engine';
import {
  WilliamsRStrategy, BiasStrategy, MFIStrategy, StochasticStrategy,
  VolumeBreakoutStrategy, CompositeStrategy
} from './new-strategies';

// ==================== Types ====================

export interface StrategySignal {
  name: string;
  label: string;
  direction: Direction | 'neutral';
  strength: number; // 0-1
  reason: string;
  /** 该策略当前状态标签（如 "金叉", "超买", "多头排列"） */
  stateLabel: string;
}

export interface CompositeSignal {
  direction: Direction | 'neutral';
  strength: number; // 0-1
  reason: string;
  /** 各策略投票详情 */
  votes: { strategy: string; direction: Direction | 'neutral'; weight: number }[];
  /** 多数票方向 */
  voteCount: { long: number; short: number; neutral: number };
}

export interface RealtimeIndicators {
  sma5: number;
  sma10: number;
  sma20: number;
  sma60: number;
  macd: { value: number; signal: number; histogram: number; state: string };
  kdj: { k: number; d: number; j: number; state: string };
  bollinger: { upper: number; middle: number; lower: number; position: number; state: string };
  cci: { value: number; state: string };
  obv: { value: number; state: string };
  adx: { value: number; adx: number; state: string };
  williamsR: number;
  mfi: number;
  stochastic: { k: number; d: number; state: string };
}

export interface SignalEngineResult {
  code: string;
  /** 最新指标快照 */
  indicators: RealtimeIndicators;
  /** 各策略独立信号 */
  strategySignals: StrategySignal[];
  /** 综合信号 */
  compositeSignal: CompositeSignal;
  /** 原始K线数组（用于调试） */
  kbars: KBar[];
  /** 指标计算结果 */
  rawIndicators: ReturnType<typeof computeIndicators>;
  /** P2-3 修复：是否处于数据加载中（K线不足） */
  loading?: boolean;
  /** P2-3 修复：当前已加载的 K 线数（loading=true 时有效） */
  kbarCount?: number;
  /** P2-3 修复：loading 提示文案 */
  loadingMessage?: string;
}

// ==================== K线缓存管理 ====================

/** 单一股票的K线缓存 */
interface KbarCache {
  /** 日K线数组（固定60根，每天追加最新一根） */
  kbars: KBar[];
  /** 最后一次从服务端fetch K线数据的时间戳 */
  lastFetchTime: number;
  /** 对应当前交易日的K线是否已patch实时价格 */
  todayPatched: boolean;
  /** 最后收盘价（用于判断是否新交易日） */
  lastClose: number;
  /** 最后交易日日期 YYYYMMDD */
  lastTradeDate: string;
}

const REALTIME_KLINE_COUNT = 60; // 60天日K足够计算所有指标
const KLINE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时认为K线数据过期

function getTradeDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function isNewTradeDate(lastDate: string): boolean {
  return lastDate !== getTradeDate();
}

/** 判断是否为有效交易日（排除周末） */
function isWeekday(): boolean {
  const day = new Date().getDay();
  return day !== 0 && day !== 6;
}

// ==================== 策略注册表 ====================

type StrategyCtor = new () => Strategy;

const STRATEGY_REGISTRY: { name: string; label: string; ctor: StrategyCtor; weight: number }[] = [
  { name: 'macd',       label: 'MACD',            ctor: MACDStrategy,          weight: 1.5 },
  { name: 'kdj',       label: 'KDJ',             ctor: KDJStrategy,           weight: 1.0 },
  { name: 'bollinger',  label: '布林带',          ctor: BollingerStrategy,      weight: 1.0 },
  { name: 'ma',        label: '均线',             ctor: MAStrategy,            weight: 1.0 },
  { name: 'rsi',       label: 'RSI',             ctor: RSIStrategy,           weight: 0.8 },
  { name: 'williams',  label: '威廉指标',         ctor: WilliamsRStrategy,     weight: 0.6 },
  { name: 'bias',      label: '乖离率',           ctor: BiasStrategy,          weight: 0.6 },
  { name: 'mfi',       label: 'MFI',             ctor: MFIStrategy,           weight: 0.7 },
  { name: 'stochastic',label: 'KD随机',          ctor: StochasticStrategy,    weight: 0.7 },
  { name: 'volume',    label: '成交量突破',        ctor: VolumeBreakoutStrategy, weight: 0.5 },
];

// ==================== 主引擎类 ====================

export class RealtimeSignalEngine {
  private caches: Map<string, KbarCache> = new Map();
  private strategies: Strategy[] = [];

  constructor() {
    // 初始化所有策略实例
    for (const reg of STRATEGY_REGISTRY) {
      const strat = new reg.ctor();
      strat.updateBars([]); // 空初始化
      this.strategies.push(strat);
    }
  }

  // ==================== 公开 API ====================

  /**
   * 获取某股票的缓存K线（用于首次初始化或缓存未命中时从API加载）
   */
  getKbars(code: string): KBar[] {
    return this.caches.get(code)?.kbars ?? [];
  }

  /**
   * 批量设置K线数据（当从API加载日K线时调用）
   * @param code 股票代码
   * @param kbars 日K线数组（按时间升序）
   */
  setKbars(code: string, kbars: KBar[]): void {
    const today = getTradeDate();
    const lastBar = kbars[kbars.length - 1];
    this.caches.set(code, {
      kbars,
      lastFetchTime: Date.now(),
      todayPatched: false,
      lastClose: lastBar?.close ?? 0,
      lastTradeDate: lastBar ? this.barTradeDate(lastBar) : today,
    });
  }

  /**
   * 用实时行情更新信号
   *
   * @param code 股票代码
   * @param quote 实时行情（包含 price, open, high, low, volume 等）
   * @returns 信号计算结果，如果K线数据不足则返回 null
   */
  updateRealtimeQuote(code: string, quote: {
    price: number;
    open: number;
    high: number;
    low: number;
    volume: number;
  }): SignalEngineResult | null {
    let cache = this.caches.get(code);

    // 缓存不存在或已过期：先用假数据初始化，等下次K线fetch补上
    if (!cache || Date.now() - cache.lastFetchTime > KLINE_CACHE_TTL) {
      // 创建一个最小缓存，等真正K线数据到来再重算
      cache = {
        kbars: [],
        lastFetchTime: 0,
        todayPatched: false,
        lastClose: 0,
        lastTradeDate: getTradeDate(),
      };
      this.caches.set(code, cache);
    }

    const today = getTradeDate();

    // 新交易日：追加一根新K线
    if (isNewTradeDate(cache.lastTradeDate)) {
      if (cache.kbars.length > 0) {
        // 把上一根K线标记为正式收盘（避免最后patch的K线残留）
        cache.kbars = [...cache.kbars];
      }
      // 追加今日K线（用当前行情填充）
      const todayBar: KBar = {
        code,
        timestamp: Date.now(),
        open: quote.open || quote.price,
        high: quote.high || quote.price,
        low: quote.low || quote.price,
        close: quote.price,
        volume: quote.volume || 0,
        amount: 0,
      };
      cache.kbars = [...cache.kbars, todayBar];
      cache.lastTradeDate = today;
      cache.todayPatched = true;
    } else if (cache.kbars.length > 0) {
      // 同一交易日：patch最新K线
      const lastBar = cache.kbars[cache.kbars.length - 1];
      lastBar.close = quote.price;
      lastBar.high = Math.max(lastBar.high, quote.high || quote.price);
      lastBar.low = Math.min(lastBar.low === 0 ? quote.price : lastBar.low, quote.low || quote.price);
      lastBar.volume = quote.volume || lastBar.volume;
      cache.todayPatched = true;
    }

    cache.lastClose = quote.price;

    // 需要至少5根K线才能计算基础指标（60天最佳，5天最低可用）
    if (cache.kbars.length < 5) {
      // P2-3 修复：返回降级状态而不是 null（前端可显示 loading 占位）
      return this.buildLoadingResult(code, cache.kbars.length, quote);
    }

    // 计算指标
    const rawIndicators = computeIndicators(cache.kbars);
    const lastIdx = cache.kbars.length - 1;

    // 格式化指标快照
    const indicators = this.formatIndicators(rawIndicators, quote.price, lastIdx);

    // 运行所有策略
    const strategySignals = this.runStrategies(cache.kbars, quote.price);

    // 合成综合信号
    const compositeSignal = this.computeComposite(strategySignals);

    return {
      code,
      indicators,
      strategySignals,
      compositeSignal,
      kbars: cache.kbars,
      rawIndicators,
    };
  }

  /**
   * 清除某股票的缓存（用于切换自选股等场景）
   */
  clearCache(code: string): void {
    this.caches.delete(code);
    // 重置所有策略
    for (const strat of this.strategies) {
      strat.updateBars([]);
    }
  }

  // ==================== 私有方法 ====================

  /** 从KBar获取 YYYYMMDD 格式的日期字符串 */
  private barTradeDate(bar: KBar): string {
    const d = new Date(bar.timestamp);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }

  /** 运行所有策略，返回各策略信号 */
  private runStrategies(kbars: KBar[], currentPrice: number): StrategySignal[] {
    const results: StrategySignal[] = [];

    // 策略实例在构造时按顺序对应 STRATEGY_REGISTRY
    for (let i = 0; i < this.strategies.length; i++) {
      const strat = this.strategies[i];
      const reg = STRATEGY_REGISTRY[i];
      if (!strat || !reg) continue;

      // 浅克隆以保护原始状态
      const cloned = strat.clone() as Strategy;
      cloned.updateBars([...kbars]);

      // 构造模拟当前K线事件（只触发最新一根）
      const lastBar = kbars[kbars.length - 1];
      cloned.onBar(lastBar);

      const sig = cloned.getSignal();

      if (!sig) {
        results.push({
          name: reg.name,
          label: reg.label,
          direction: 'neutral',
          strength: 0,
          reason: '数据不足',
          stateLabel: '-',
        });
        continue;
      }

      // 提取状态标签（从 reason 推断）
      const stateLabel = this.extractStateLabel(reg.name, sig.reason, sig.direction, currentPrice, cloned);

      results.push({
        name: reg.name,
        label: reg.label,
        direction: sig.direction,
        strength: sig.strength,
        reason: sig.reason,
        stateLabel,
      });
    }

    return results;
  }

  /** 从 reason 字符串和方向推断状态标签 */
  private extractStateLabel(
    strategyName: string,
    reason: string,
    direction: Direction | 'neutral',
    price: number,
    strat: Strategy
  ): string {
    if (direction === 'neutral') return '中性';

    const r = reason.toLowerCase();

    switch (strategyName) {
      case 'macd':
        if (r.includes('金叉')) return '金叉';
        if (r.includes('死叉')) return '死叉';
        if (r.includes('多头动能')) return '多头动能';
        if (r.includes('空头动能')) return '空头动能';
        return direction === 'long' ? '多头' : '空头';

      case 'kdj':
        if (r.includes('超买')) return '超买';
        if (r.includes('超卖')) return '超卖';
        if (r.includes('金叉')) return '金叉';
        if (r.includes('死叉')) return '死叉';
        if (r.includes('多头排列')) return '多头排列';
        if (r.includes('空头排列')) return '空头排列';
        return direction === 'long' ? '偏多' : '偏空';

      case 'bollinger':
        if (r.includes('突破上轨')) return '突破上轨';
        if (r.includes('突破下轨')) return '突破下轨';
        if (r.includes('中轨')) return '中轨附近';
        return direction === 'long' ? '偏多' : '偏空';

      case 'ma':
        if (r.includes('多头排列')) return '均线多头';
        if (r.includes('空头排列')) return '均线空头';
        if (r.includes('站上')) return '价格>均线';
        if (r.includes('跌破')) return '价格<均线';
        return direction === 'long' ? '偏多' : '偏空';

      case 'rsi':
        if (r.includes('超买')) return 'RSI超买';
        if (r.includes('超卖')) return 'RSI超卖';
        return direction === 'long' ? '偏多' : '偏空';

      case 'williams':
        if (r.includes('超卖')) return '超卖';
        if (r.includes('超买')) return '超买';
        return direction === 'long' ? '偏多' : '偏空';

      case 'bias':
        if (r.includes('高估') || r.includes('回归')) return '均值回归';
        if (r.includes('低估')) return '均值回归';
        return direction === 'long' ? '偏低估' : '偏低估';

      case 'mfi':
        if (r.includes('超买')) return 'MFI超买';
        if (r.includes('超卖')) return 'MFI超卖';
        return direction === 'long' ? '资金流入' : '资金流出';

      case 'stochastic':
        if (r.includes('超买')) return '随机超买';
        if (r.includes('超卖')) return '随机超卖';
        return direction === 'long' ? '超卖反弹' : '超买回落';

      case 'volume':
        if (r.includes('放量')) return '放量';
        if (r.includes('缩量')) return '缩量';
        return direction === 'long' ? '量价齐升' : '量价背离';

      default:
        return direction === 'long' ? '做多信号' : direction === 'short' ? '做空信号' : '中性';
    }
  }

  /** 合成综合信号（加权投票） */
  private computeComposite(strategySignals: StrategySignal[]): CompositeSignal {
    const votes: CompositeSignal['votes'] = [];
    let longScore = 0;
    let shortScore = 0;
    let totalWeight = 0;
    let longCount = 0;
    let shortCount = 0;
    let neutralCount = 0;

    const weightMap: Record<string, number> = {};
    for (const reg of STRATEGY_REGISTRY) {
      weightMap[reg.name] = reg.weight;
    }

    const reasons: string[] = [];

    for (const sig of strategySignals) {
      const w = weightMap[sig.name] ?? 1.0;
      totalWeight += w;

      if (sig.direction === 'long' && sig.strength > 0) {
        longScore += w * sig.strength;
        longCount++;
        reasons.push(`${sig.label}:${sig.stateLabel}`);
      } else if (sig.direction === 'short' && sig.strength > 0) {
        shortScore += w * sig.strength;
        shortCount++;
        reasons.push(`${sig.label}:${sig.stateLabel}`);
      } else {
        neutralCount++;
      }

      votes.push({ strategy: sig.label, direction: sig.direction, weight: w });
    }

    const netScore = longScore - shortScore;
    const direction: Direction | 'neutral' =
      netScore > 0.5 ? 'long' : netScore < -0.5 ? 'short' : 'neutral';

    const strength = totalWeight > 0 ? Math.min(Math.abs(netScore) / totalWeight, 1) : 0;

    return {
      direction,
      strength: Math.round(strength * 100) / 100,
      reason: reasons.slice(0, 4).join(' | ') || '无明显信号',
      votes,
      voteCount: { long: longCount, short: shortCount, neutral: neutralCount },
    };
  }

  /**
   * P2-3 修复：K 线不足时构造 loading 占位结果（不再返回 null 让前端瞎等）
   * 保留 quote.price 实时显示，并提示"还需 N 根 K 线开始计算信号"
   */
  private buildLoadingResult(code: string, kbarCount: number, quote: any): SignalEngineResult {
    const need = Math.max(0, 5 - kbarCount);
    const emptyIndicators: RealtimeIndicators = {
      sma5: 0, sma10: 0, sma20: 0, sma60: 0,
      macd: { value: 0, signal: 0, histogram: 0, state: 'loading' },
      kdj: { k: 0, d: 0, j: 0, state: 'loading' },
      bollinger: { upper: 0, middle: 0, lower: 0, position: 0, state: 'loading' },
      cci: { value: 0, state: 'loading' },
      obv: { value: 0, state: 'loading' },
      adx: { value: 0, adx: 0, state: 'loading' },
      williamsR: 0,
      mfi: 0,
      stochastic: { k: 0, d: 0, state: 'loading' },
    };
    const neutralComposite: CompositeSignal = {
      direction: 'neutral',
      strength: 0,
      reason: `K线数据加载中（${kbarCount}/5）`,
      votes: [],
      voteCount: { long: 0, short: 0, neutral: 0 },
    };
    return {
      code,
      indicators: emptyIndicators,
      strategySignals: [],
      compositeSignal: neutralComposite,
      kbars: [],
      rawIndicators: {} as ReturnType<typeof computeIndicators>,
      loading: true,
      kbarCount,
      loadingMessage: `正在加载K线数据（${kbarCount}/5）${need > 0 ? `，还需 ${need} 根开始计算信号` : ''}（当前价 ¥${quote.price?.toFixed(2) ?? '--'}）`,
    };
  }

  /** 格式化原始指标为可展示的快照 */
  private formatIndicators(
    ind: ReturnType<typeof computeIndicators>,
    price: number,
    lastIdx: number
  ): RealtimeIndicators {
    const idx = Math.min(lastIdx, ind.sma5.length - 1);
    const macd = ind.macd;
    const kdj = ind.kdj;
    const bb = ind.bollinger;

    // MACD state
    let macdState = '中性';
    if (idx >= 1) {
      const currHist = macd.histogram[idx];
      const prevHist = macd.histogram[idx - 1];
      if (prevHist < 0 && currHist > 0) macdState = '金叉';
      else if (prevHist > 0 && currHist < 0) macdState = '死叉';
      else if (currHist > 0 && currHist > prevHist) macdState = '多头动能';
      else if (currHist < 0 && currHist < prevHist) macdState = '空头动能';
      else if (currHist > 0) macdState = '多方';
      else macdState = '空方';
    }

    // KDJ state
    let kdjState = '中性';
    const k = kdj.k[idx];
    const d = kdj.d[idx];
    const j = kdj.j[idx];
    if (!isNaN(k)) {
      if (k > 80) kdjState = '超买';
      else if (k < 20) kdjState = '超卖';
      else if (k > d && d > j && k > 50) kdjState = '多头排列';
      else if (k < d && d < j && k < 50) kdjState = '空头排列';
      else kdjState = '中性';
    }

    // Bollinger state
    let bbState = '中性';
    const bbUpper = bb.upper[idx];
    const bbLower = bb.lower[idx];
    if (!isNaN(bbUpper) && !isNaN(bbLower) && bbUpper !== bbLower) {
      const pos = (price - bbLower) / (bbUpper - bbLower);
      if (pos > 0.95) bbState = '突破上轨';
      else if (pos > 0.7) bbState = '上轨附近';
      else if (pos < 0.05) bbState = '突破下轨';
      else if (pos < 0.3) bbState = '下轨附近';
      else if (pos > 0.5) bbState = '中轨上方';
      else bbState = '中轨下方';
    }

    // CCI state
    let cciState = '中性';
    const cciVal = ind.cci[idx];
    if (!isNaN(cciVal)) {
      if (cciVal > 100) cciState = '超买';
      else if (cciVal < -100) cciState = '超卖';
      else if (cciVal > 0) cciState = '偏多';
      else cciState = '偏空';
    }

    // OBV state
    let obvState = '中性';
    const obvVal = ind.obv[idx];
    const obvPrev = ind.obv[idx - 1];
    if (!isNaN(obvVal) && !isNaN(obvPrev)) {
      if (obvVal > obvPrev) obvState = '上升';
      else if (obvVal < obvPrev) obvState = '下降';
    }

    // ADX state
    let adxState = '趋弱';
    const adxVal = ind.adx.adx[idx];
    const plusDI = ind.adx.plusDI[idx];
    const minusDI = ind.adx.minusDI[idx];
    if (!isNaN(adxVal) && !isNaN(plusDI) && !isNaN(minusDI)) {
      if (adxVal > 25 && plusDI > minusDI) adxState = '强势上涨';
      else if (adxVal > 25 && minusDI > plusDI) adxState = '强势下跌';
      else if (adxVal < 20) adxState = '趋势不明';
    }

    // Stochastic state
    let stochState = '中性';
    const sk = ind.stochastic.k[idx];
    const sd = ind.stochastic.d[idx];
    if (!isNaN(sk) && !isNaN(sd)) {
      if (sk > 80) stochState = '超买';
      else if (sk < 20) stochState = '超卖';
      else stochState = '中性';
    }

    return {
      sma5: isNaN(ind.sma5[idx]) ? 0 : ind.sma5[idx],
      sma10: isNaN(ind.sma10[idx]) ? 0 : ind.sma10[idx],
      sma20: isNaN(ind.sma20[idx]) ? 0 : ind.sma20[idx],
      sma60: isNaN(ind.sma60[idx]) ? 0 : ind.sma60[idx],
      macd: {
        value: isNaN(macd.macd[idx]) ? 0 : macd.macd[idx],
        signal: isNaN(macd.signal[idx]) ? 0 : macd.signal[idx],
        histogram: isNaN(macd.histogram[idx]) ? 0 : macd.histogram[idx],
        state: macdState,
      },
      kdj: {
        k: isNaN(k) ? 0 : k,
        d: isNaN(d) ? 0 : d,
        j: isNaN(j) ? 0 : j,
        state: kdjState,
      },
      bollinger: {
        upper: isNaN(bbUpper) ? 0 : bbUpper,
        middle: isNaN(bb.middle[idx]) ? 0 : bb.middle[idx],
        lower: isNaN(bbLower) ? 0 : bbLower,
        position: !isNaN(bbUpper) && !isNaN(bbLower) && bbUpper !== bbLower
          ? Math.round(((price - bbLower) / (bbUpper - bbLower)) * 100) / 100
          : 0.5,
        state: bbState,
      },
      cci: { value: isNaN(cciVal) ? 0 : cciVal, state: cciState },
      obv: { value: isNaN(obvVal) ? 0 : obvVal, state: obvState },
      adx: {
        value: isNaN(plusDI) ? 0 : plusDI,
        adx: isNaN(adxVal) ? 0 : adxVal,
        state: adxState,
      },
      williamsR: isNaN(ind.williamsR[idx]) ? 0 : ind.williamsR[idx],
      mfi: isNaN(ind.mfi[idx]) ? 0 : ind.mfi[idx],
      stochastic: { k: isNaN(sk) ? 0 : sk, d: isNaN(sd) ? 0 : sd, state: stochState },
    };
  }
}

// ==================== 单例导出 ====================

let engineInstance: RealtimeSignalEngine | null = null;

export function getRealtimeSignalEngine(): RealtimeSignalEngine {
  if (!engineInstance) {
    engineInstance = new RealtimeSignalEngine();
  }
  return engineInstance;
}
