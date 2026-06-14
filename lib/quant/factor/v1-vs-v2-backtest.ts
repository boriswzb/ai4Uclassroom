/**
 * v1 vs v2 因子模型对比回测
 *
 * 设计：
 * - 每日调仓：取前 N 个交易日的 K 线 + 财务（用最近一次）
 * - 每天分别跑 v1 (computeV1Pillars) 和 v2 (scoreV2) → 取各自 Top 10
 * - 等权持仓 1 天（T+1），按次日实际收益累计
 * - 输出每日净值曲线 + 累计收益/最大回撤/Sharpe/胜率
 * - 基准：沪深 300（000300.SH）
 *
 * 简化（与生产 trade 一致）：
 * - 不做真实手续费/滑点（v1/v2 都在同一条件对比）
 * - 不做 T+1 锁仓（v1/v2 同时段选股，次开盘卖）
 * - 财务数据用最近一次（避免回测期"未来函数"）
 */
import {
  getKlinesBatchFromIfzq,
  getAllStocksViaTencent,
  type StockRaw,
} from '@/lib/quant/factor/stock-list-fallback';
import { computeV1Pillars, scoreV2, type FactorRawValues } from '@/lib/quant/factor/v2';
import { computeFactors } from '@/lib/quant/factor/v2/factors';
import type { KBar } from '@/lib/quant/types';
import https from 'node:https';

// ── 公共 https 工具（与 v2 route 一致）────────────────
function httpGet(url: string, timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://finance.qq.com/',
        'Accept': '*/*',
      },
      secureProtocol: 'TLSv1_2_method',
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── 回测参数 ──────────────────────────────────────
export interface BacktestConfig {
  lookbackDays: number;     // 回看天数（含 K 线 lookback + 调仓日数）
  topN: number;             // 每个模型选 Top N
  rebalanceDays: number;    // 每 N 天调仓一次（1 = 每天）
  benchmark: string;        // 基准代码（默认 000300.SH 沪深 300）
  poolSize: number;         // 股票池大小（默认 200，10-300）
  v2Short: boolean;         // v2 是否启用 long-short（多空对冲；默认 true）
}

// ── 回测输出 ──────────────────────────────────────
export interface DailyPoint {
  date: string;          // YYYY-MM-DD
  v1Nav: number;         // v1 long-only 净值
  v2LongNav: number;     // v2 long-only 净值
  v2LongShortNav: number;  // v2 long-short 净值（v2Short=false 时等于 v2LongNav）
  benchNav: number;      // 沪深 300 净值
  v1Top: string[];       // 当日 v1 持仓（long）
  v2Top: string[];       // 当日 v2 long 持仓
  v2ShortTop: string[];  // 当日 v2 short 持仓（v2Short=false 时为空）
  v1DailyReturn: number;
  v2LongDailyReturn: number;
  v2LongShortDailyReturn: number;
  benchDailyReturn: number;
  v1Overlap: number;     // v1/v2 long Top 10 重叠数
}

export interface ModelStats {
  totalReturn: number;   // 累计收益（百分比）
  annualizedReturn: number;
  maxDrawdown: number;   // 最大回撤（百分比，负数）
  sharpe: number;        // 年化 Sharpe
  winRate: number;       // 日胜率
  volatility: number;    // 波动率
  avgDailyReturn: number;
  finalNav: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  daily: DailyPoint[];
  v1Stats: ModelStats;
  v2Stats: ModelStats;            // 兼容旧字段，等于 v2LongStats
  v2LongStats: ModelStats;        // v2 long-only
  v2LongShortStats: ModelStats;   // v2 long-short（市场中性）
  benchStats: ModelStats;
  consensusHits: number;  // 两模型 Top 10 重叠 ≥ 5 的天数
  totalDays: number;
  startDate: string;
  endDate: string;
  warnings: string[];
  ms: number;
}

// ── 1. 拉全市场股票（精简 96 只）─────────────────────
async function fetchAllStocks(): Promise<StockRaw[]> {
  // 复用 v1/v2 共享 fallback（sina 失败时走 qt.gtimg）
  const stocks = await getAllStocksViaTencent();
  if (stocks.length === 0) throw new Error('无法获取股票列表');
  return stocks;
}

// ── 2. 拉 K 线（用共享 lib，已修 amount）──────────────
async function fetchKlines(codes: string[], count: number): Promise<Map<string, KBar[]>> {
  return getKlinesBatchFromIfzq(codes, count, httpGet) as Promise<Map<string, KBar[]>>;
}

// ── 3. 构造单只股票的 FactorRawValues（用历史 K 线切片）────
// 财务数据用最近一次（避免回测期未来函数）
// 真实资金流用 K 线估算（回测期没法拉历史资金流，K 线推算是合理降级）
async function buildFactorRaw(
  code: string,
  name: string,
  barsUpToDay: KBar[],         // 截至当日的 K 线
  realtime: { price: number; changePercent: number; marketCap: number; floatMarketCap: number; pe: number; pb: number; volumeRatio: number; turnoverRate: number }
): Promise<FactorRawValues | null> {
  if (barsUpToDay.length < 30) return null;
  // 临时把 K 线贴 code 进 computeFactors（它需要 code/name/kbars/realtime/realFlow）
  // realFlow 传 undefined → computeFactors 内部用 K 线估算
  try {
    return await computeFactors({
      code,
      name,
      kbars: barsUpToDay,
      realtime,
      realFlow: undefined,  // 回测期不拉真实资金流，用 K 线估算
    });
  } catch {
    return null;
  }
}

// ── 4. v1 评分（复用 lib 内 computeV1Pillars）─────────
// regime 简化为 'uncertain'（回测期不分类市场状态，避免过度拟合）
const scoreV1 = (c: FactorRawValues) => computeV1Pillars(c, 'uncertain').compositeScore;

// ── 5. v2 评分（批量跑 scoreV2）───────────────────
function scoreV2Batch(candidates: FactorRawValues[], options: { forwardPeriod: 5 | 20 }) {
  return scoreV2({ candidates, options: { ...options, neutralize: { industry: true, marketCap: true }, weightMode: 'default', filterFlags: true } });
}

// ── 6. 业绩统计 ────────────────────────────────
function computeStats(navSeries: number[], dailyReturns: number[]): ModelStats {
  if (navSeries.length === 0) {
    return { totalReturn: 0, annualizedReturn: 0, maxDrawdown: 0, sharpe: 0, winRate: 0, volatility: 0, avgDailyReturn: 0, finalNav: 1 };
  }
  const finalNav = navSeries[navSeries.length - 1];
  const totalReturn = (finalNav - 1) * 100;
  // 年化（按 252 交易日）
  const days = navSeries.length;
  const annualizedReturn = ((Math.pow(finalNav, 252 / Math.max(days, 1)) - 1) * 100);
  // 最大回撤
  let peak = navSeries[0];
  let maxDD = 0;
  for (const nav of navSeries) {
    if (nav > peak) peak = nav;
    const dd = (nav - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  // 日均收益 & 波动率
  const avgRet = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / dailyReturns.length;
  const stdRet = Math.sqrt(variance);
  const annualizedVol = stdRet * Math.sqrt(252) * 100;
  const sharpe = stdRet > 0 ? (avgRet / stdRet) * Math.sqrt(252) : 0;
  const winRate = (dailyReturns.filter(r => r > 0).length / dailyReturns.length) * 100;
  return {
    totalReturn: Math.round(totalReturn * 100) / 100,
    annualizedReturn: Math.round(annualizedReturn * 100) / 100,
    maxDrawdown: Math.round(maxDD * 100 * 100) / 100,
    sharpe: Math.round(sharpe * 100) / 100,
    winRate: Math.round(winRate * 100) / 100,
    volatility: Math.round(annualizedVol * 100) / 100,
    avgDailyReturn: Math.round(avgRet * 10000) / 10000,
    finalNav: Math.round(finalNav * 10000) / 10000,
  };
}

// ── 7. 主入口：跑回测 ────────────────────────────
export async function runV1VsV2Backtest(config: BacktestConfig): Promise<BacktestResult> {
  const t0 = Date.now();
  const warnings: string[] = [];

  // 拉股票列表
  const allStocks = await fetchAllStocks();
  // 选深沪主板（去掉 .BJ 北交所，避免财务接口差异）
  const targetStocks = allStocks.filter(s => {
    const num = s.symbol.replace(/^[a-z]+/i, '');
    if (num.length < 6) return false;
    if (s.symbol.startsWith('bj') || s.symbol.startsWith('BJ')) return false;
    return true;
  }).slice(0, config.poolSize || 200);  // 默认 200 只（横截面 percentile 更稳）
  if (targetStocks.length < 10) throw new Error('股票池过少');

  // 转成 code
  const codes = targetStocks.map(s => {
    const num = s.symbol.replace(/^[a-z]+/i, '').padStart(6, '0');
    const suffix = s.symbol.startsWith('sh') || s.symbol.startsWith('SH') ? '.SH' : '.SZ';
    return num + suffix;
  });
  warnings.push(`股票池：${targetStocks.length} 只（沪深主板）`);

  // 拉 K 线（lookbackDays + 60 天缓冲）
  const klineDays = config.lookbackDays + 80;
  const allKlines = await fetchKlines(codes, klineDays);
  warnings.push(`K 线拉取：${allKlines.size}/${codes.length} 只成功`);

  // 拉基准 K 线（沪深 300）
  const benchKlines = (await fetchKlines([config.benchmark], klineDays)).get(config.benchmark);
  warnings.push(`沪深 300 拉取：${benchKlines ? benchKlines.length + ' 根' : '失败'}`);
  if (!benchKlines || benchKlines.length < 30) {
    warnings.push('沪深 300 基准 K 线拉取失败，使用 000001.SH 替代');
    const fallback = (await fetchKlines(['000001.SH'], klineDays)).get('000001.SH');
    if (fallback) {
      // 用 000001 顶替
      allKlines.set(config.benchmark, fallback);
    }
  } else {
    // 把基准 K 线也存进 allKlines 以便 computeAvgReturn 能找到
    allKlines.set(config.benchmark, benchKlines);
  }

  // 决定调仓日：取 K 线最后 N 天的交易日期（每 rebalanceDays 一天）
  // 用任一只有效 K 线的日期序列作时间轴
  const sampleKlines = Array.from(allKlines.values()).find(kb => kb.length >= 30);
  if (!sampleKlines) throw new Error('K 线数据不足');
  const allDates = sampleKlines.map(k => new Date(k.timestamp).toISOString().slice(0, 10));
  // 取最后 lookbackDays 个不同日期
  const uniqueDates = Array.from(new Set(allDates)).sort();
  const startIdx = Math.max(0, uniqueDates.length - config.lookbackDays);
  const backtestDates = uniqueDates.slice(startIdx);
  if (backtestDates.length < 5) throw new Error('回测日期不足 5 天');

  // 跑每天的 v1/v2 评分 + 计算次日收益
  const daily: DailyPoint[] = [];
  let v1Nav = 1, v2LongNav = 1, v2LongShortNav = 1, benchNav = 1;
  const v1DailyReturns: number[] = [];
  const v2LongDailyReturns: number[] = [];
  const v2LongShortDailyReturns: number[] = [];
  const benchDailyReturns: number[] = [];

  for (let i = 0; i < backtestDates.length - 1; i++) {  // 留最后一天算收益
    const date = backtestDates[i];
    const nextDate = backtestDates[i + 1];

    // 收集截至当日的 K 线（每只股票）
    const candidates: { code: string; name: string; bars: KBar[]; realtime: any }[] = [];
    for (const s of targetStocks) {
      const num = s.symbol.replace(/^[a-z]+/i, '').padStart(6, '0');
      const suffix = s.symbol.startsWith('sh') || s.symbol.startsWith('SH') ? '.SH' : '.SZ';
      const code = num + suffix;
      const allBars = allKlines.get(code);
      if (!allBars) continue;
      const barsUpTo = allBars.filter(b => new Date(b.timestamp).toISOString().slice(0, 10) <= date);
      if (barsUpTo.length < 30) continue;
      candidates.push({
        code,
        name: s.name,
        bars: barsUpTo,
        realtime: {
          price: parseFloat(s.trade) || 0,
          changePercent: parseFloat(s.changepercent) || 0,
          marketCap: parseFloat(s.mktcap) * 1e8 || 0,
          floatMarketCap: parseFloat(s.nmc) * 1e8 || 0,
          pe: parseFloat(s.pe) || 0,
          pb: parseFloat(s.pb) || 0,
          volumeRatio: 1,
          turnoverRate: parseFloat(s.turnoverratio) || 0,
        },
      });
    }
    if (candidates.length < 5) continue;

    // 算 factor raw（并发 8 个，避免 200 只 × 30 天 串行太慢）
    const CONCURRENCY = 8;
    const rawValues: FactorRawValues[] = [];
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const batch = candidates.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(c => buildFactorRaw(c.code, c.name, c.bars, c.realtime))
      );
      for (const r of batchResults) {
        if (r) rawValues.push(r);
      }
    }
    if (rawValues.length < 5) continue;

    // v1: 单股绝对值打分，取 Top N
    const v1Scores = rawValues.map(r => ({ code: r.code, name: r.name, score: scoreV1(r) }));
    v1Scores.sort((a, b) => b.score - a.score);
    const v1Top = v1Scores.slice(0, config.topN).map(s => s.code);

    // v2: 横截面 percentile + 中性化，跑完取 Top N（long）+ Bottom N（short）
    let v2Top: string[] = [];
    let v2ShortTop: string[] = [];
    try {
      const v2Out = scoreV2Batch(rawValues, { forwardPeriod: 5 });
      const sorted = [...v2Out.results].sort((a, b) => b.composite - a.composite);
      v2Top = sorted.slice(0, config.topN).map(r => r.code);
      if (config.v2Short !== false) {
        v2ShortTop = sorted.slice(-config.topN).reverse().map(r => r.code);
      }
    } catch (e) {
      warnings.push(`日期 ${date} v2 评分失败：${(e as Error).message}`);
    }

    // 计算次日收益
    const v1DailyRet = computeAvgReturn(allKlines, v1Top, date, nextDate);
    const v2LongDailyRet = computeAvgReturn(allKlines, v2Top, date, nextDate);
    // long-short 收益 = (long 等权) - (short 等权)，市场中性
    // A 股不允许做空（融券稀少），这里是"理论最大能力"参考
    const v2ShortDailyRet = v2ShortTop.length > 0 ? computeAvgReturn(allKlines, v2ShortTop, date, nextDate) : 0;
    const v2LongShortDailyRet = v2LongDailyRet - v2ShortDailyRet;
    const benchRet = computeAvgReturn(allKlines, [config.benchmark], date, nextDate);

    v1Nav *= (1 + v1DailyRet);
    v2LongNav *= (1 + v2LongDailyRet);
    v2LongShortNav *= (1 + v2LongShortDailyRet);
    benchNav *= (1 + benchRet);
    v1DailyReturns.push(v1DailyRet);
    v2LongDailyReturns.push(v2LongDailyRet);
    v2LongShortDailyReturns.push(v2LongShortDailyRet);
    benchDailyReturns.push(benchRet);

    const overlap = v1Top.filter(c => v2Top.includes(c)).length;
    daily.push({
      date,
      v1Nav: Math.round(v1Nav * 10000) / 10000,
      v2LongNav: Math.round(v2LongNav * 10000) / 10000,
      v2LongShortNav: Math.round(v2LongShortNav * 10000) / 10000,
      benchNav: Math.round(benchNav * 10000) / 10000,
      v1Top,
      v2Top,
      v2ShortTop,
      v1DailyReturn: Math.round(v1DailyRet * 10000) / 10000,
      v2LongDailyReturn: Math.round(v2LongDailyRet * 10000) / 10000,
      v2LongShortDailyReturn: Math.round(v2LongShortDailyRet * 10000) / 10000,
      benchDailyReturn: Math.round(benchRet * 10000) / 10000,
      v1Overlap: overlap,
    });
  }

  // 算 stats
  const v1Stats = computeStats(daily.map(d => d.v1Nav), v1DailyReturns);
  const v2LongStats = computeStats(daily.map(d => d.v2LongNav), v2LongDailyReturns);
  const v2LongShortStats = computeStats(daily.map(d => d.v2LongShortNav), v2LongShortDailyReturns);
  const benchStats = computeStats(daily.map(d => d.benchNav), benchDailyReturns);
  const consensusHits = daily.filter(d => d.v1Overlap >= 5).length;

  return {
    config,
    daily,
    v1Stats,
    v2Stats: v2LongStats,  // 兼容旧字段
    v2LongStats,
    v2LongShortStats,
    benchStats,
    consensusHits,
    totalDays: daily.length,
    startDate: daily[0]?.date || '',
    endDate: daily[daily.length - 1]?.date || '',
    warnings,
    ms: Date.now() - t0,
  };
}

// ── 工具：算某组股票在 [date, nextDate] 的等权平均收益 ──
function computeAvgReturn(
  allKlines: Map<string, KBar[]>,
  codes: string[],
  date: string,
  nextDate: string
): number {
  if (codes.length === 0) return 0;
  let sumRet = 0, count = 0;
  for (const code of codes) {
    const bars = allKlines.get(code);
    if (!bars) continue;
    const todayBar = bars.find(b => new Date(b.timestamp).toISOString().slice(0, 10) === date);
    const nextBar = bars.find(b => new Date(b.timestamp).toISOString().slice(0, 10) === nextDate);
    if (!todayBar || !nextBar || todayBar.close === 0) continue;
    sumRet += (nextBar.close - todayBar.close) / todayBar.close;
    count++;
  }
  return count > 0 ? sumRet / count : 0;
}
