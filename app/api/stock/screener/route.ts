/**
 * 选股器 API v3
 * 支持：
 *   1. 基本面筛选（复用新浪全量数据，60秒缓存）
 *   2. 技术面筛选（批量获取K线，计算MACD/KDJ/均线/布林带）
 *   3. 多因子评分（IC/IR评分）
 *   4. 资金流因子
 *   5. 动量因子
 *   6. 市场状态检测
 *   7. 快捷模板
 */
import { NextRequest, NextResponse } from 'next/server';
import https from 'node:https';
import { getIndustry } from '@/lib/quant/industry-map';
import { computeIndicators } from '@/lib/quant/strategies/indicators';
import { MarketRegimeClassifier, MarketRegime } from '@/lib/quant/market/market-regime';
import type { KBar } from '@/lib/quant/types';
import { SMA, EMA, ATR, ADX, RSI, BollingerBands, MFI, WilliamsR, Bias, OBV, MACD, KDJ } from '@/lib/quant/strategies/indicators';
import { getCachedWeights, IC_TO_SCREENER_KEY } from '@/lib/quant/factor/weight-cache';

// ── HTTP 工具 ──────────────────────────────────
function httpGet(url: string, timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://finance.qq.com/',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
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

// ── 类型定义 ──────────────────────────────────
interface StockRaw {
  symbol: string; name: string; trade: string; pricechange: string;
  changepercent: string; volume: string; amount: string;
  pe: string; pb: string; mktcap: string; nmc: string; turnoverratio: string;
  mainNetInflow: number;
  // 驼峰别名（方便 CandidateStock 直接访问）
  changePercent?: number; turnoverRate?: number; marketCap?: number;
}

export interface ScreenerStock {
  code: string; name: string; price: number; changePercent: number;
  volume: number; amount: number; pe: number; pb: number;
  marketCap: number; floatCap: number; turnoverRate: number;
  industry: string; mainNetInflow: number;
  // 技术指标
  macdSignal?: 'golden_cross' | 'dead_cross' | 'above_zero' | 'below_zero';
  kdjSignal?: 'oversold' | 'overbought' | 'golden_cross' | 'dead_cross';
  maSignal?: 'above_ma20' | 'below_ma20' | 'above_ma60' | 'below_ma60';
  bollSignal?: 'above_upper' | 'below_lower' | 'near_upper' | 'near_lower';
  cciSignal?: 'cci_oversold' | 'cci_overbought' | 'cci_neutral';
  obvSignal?: 'obv_rise' | 'obv_fall' | 'obv_neutral';
  adxSignal?: 'strong_up' | 'strong_down' | 'weak';
  score?: number; // 多因子评分
  // 资金流因子
  moneyFlowScore?: number;        // 资金流综合得分 0-100
  mainNetInflowRatio?: number;    // 主力净流入占成交额比
  volumeRatio?: number;           // 量比
  // 动量因子
  momentum5?: number;             // 5日动量
  momentum20?: number;            // 20日动量
  momentumScore?: number;         // 动量综合得分
  // 市场状态
  marketRegime?: MarketRegime;    // 当前股票所在市场状态
  regimeConfidence?: number;      // 状态置信度
  // IC/IR评分
  icScore?: number;               // 基于IC-IR的因子评分
  irScore?: number;               // IR评分
  compositeScore?: number;        // 复合因子评分
}

export interface ScreenerResult {
  stocks: ScreenerStock[];
  total: number;
  template: string;
  filters: FilterSummary;
}

interface FilterSummary {
  priceRange: [number, number]; peRange: [number, number];
  pbRange: [number, number]; mktCapRange: [number, number];
  turnoverRange: [number, number]; changeRange: [number, number];
  industryCounts: { industry: string; count: number }[];
  totalStocks: number;
}

// ── 行业映射 ──────────────────────────────────
function stockIndustry(symbol: string): string {
  const code = symbol.replace(/^[a-z]+/, '').padStart(6, '0');
  return getIndustry(code);
}

// ── 基本面数据缓存 ──────────────────────────────
let cache: { stocks: StockRaw[]; timestamp: number } | null = null;
const CACHE_TTL = 60_000;

async function getAllStocks(): Promise<StockRaw[]> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) return cache.stocks;

  console.log('[ScreenerAPI] 刷新全量股票缓存...');
  const allStocks: StockRaw[] = [];
  const pages = 52, pageSize = 100;

  for (let page = 1; page <= pages; page++) {
    try {
      const url = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=${pageSize}&sort=changepercent&asc=0&node=sh_a&symbol=&_s_r_a=page`;
      const text = await httpGet(url);
      const data = JSON.parse(text);
      if (!Array.isArray(data)) continue;
      for (const item of data) {
        const sym = item.symbol as string;
        const rawCode = sym.replace(/^[a-z]+/, '').padStart(6, '0');
        const price = parseFloat(item.trade) || 0;
        const turnRate = parseFloat(item.turnoverratio) || 0;
        const amount = parseFloat(item.amount) || 0;
        const changePercent = parseFloat(item.changepercent) || 0;
        allStocks.push({
          symbol: sym, name: item.name || '',
          trade: item.trade || '0', pricechange: item.pricechange || '0',
          changepercent: item.changepercent || '0', volume: item.volume || '0',
          amount: item.amount || '0', pe: item.per || '-1', pb: item.pb || '-1',
          mktcap: item.mktcap || '0', nmc: item.nmc || '0',
          turnoverratio: item.turnoverratio || '0',
          mainNetInflow: amount * (turnRate / 100) * Math.sign(changePercent) / 10000,
        });
      }
    } catch (e) { console.error(`[ScreenerAPI] page ${page} error:`, e); }
  }
  cache = { stocks: allStocks, timestamp: Date.now() };
  console.log(`[ScreenerAPI] 缓存完成，共 ${allStocks.length} 只`);
  return allStocks;
}

// ── K线获取（批量，60秒缓存）────────────────────
let klineCache: Map<string, { bars: KBar[]; ts: number }> = new Map();
const KLINE_TTL = 60_000;

async function getKlineBatch(codes: string[], count = 60): Promise<Map<string, KBar[]>> {
  const result = new Map<string, KBar[]>();
  const uncached: string[] = [];

  for (const code of codes) {
    const cached = klineCache.get(code);
    if (cached && Date.now() - cached.ts < KLINE_TTL) {
      result.set(code, cached.bars);
    } else {
      uncached.push(code);
    }
  }

  if (uncached.length === 0) return result;

  // 批量并发获取（每批10个，并发3批）
  const BATCH = 10, CONCURRENCY = 3;
  for (let i = 0; i < uncached.length; i += BATCH * CONCURRENCY) {
    const chunk = uncached.slice(i, i + BATCH * CONCURRENCY);
    const batches: string[][] = [];
    for (let j = 0; j < chunk.length; j += BATCH) batches.push(chunk.slice(j, j + BATCH));

    const results = await Promise.all(
      batches.slice(0, CONCURRENCY).map(batch =>
        Promise.all(batch.map(async (code) => {
          try {
            const suffix = code.endsWith('.SH') ? '.SH' : code.endsWith('.SZ') ? '.SZ' : '.BJ';
            const num = code.replace('.SH', '').replace('.SZ', '').replace('.BJ', '');
            const qqCode = suffix === '.SH' ? `sh${num}` : suffix === '.SZ' ? `sz${num}` : `bj${num}`;
            const url = `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?_var=kline_day&param=${qqCode},day,,,${count}`;
            const text = await httpGet(url);
            const jsonStr = text.split('=', 2)[1] || '{}';
            const json = JSON.parse(jsonStr);
            const bars: KBar[] = (json.data?.[qqCode]?.day || []).map((bar: string[]) => ({
              code, timestamp: new Date(bar[0]).getTime(),
              open: parseFloat(bar[1]) || 0, high: parseFloat(bar[3]) || 0,
              low: parseFloat(bar[4]) || 0, close: parseFloat(bar[2]) || 0,
              volume: parseFloat(bar[5]) || 0, amount: parseFloat(bar[6]) || 0,
            }));
            klineCache.set(code, { bars, ts: Date.now() });
            return [code, bars] as [string, KBar[]];
          } catch { return [code, [] as KBar[]] as [string, KBar[]]; }
        }))
      )
    );
    for (const r of results) {
      for (const [code, bars] of r) result.set(code, bars);
    }
  }
  return result;
}

// ── 技术指标信号类型 ─────────────────────────────────
type MacdSignal = 'golden_cross' | 'dead_cross' | 'above_zero' | 'below_zero';
type KdjSignal = 'oversold' | 'overbought' | 'golden_cross' | 'dead_cross';
type MaSignal = 'above_ma20' | 'below_ma20' | 'above_ma60' | 'below_ma60';
type BollSignal = 'above_upper' | 'below_lower' | 'near_upper' | 'near_lower';
type CciSignal = 'cci_oversold' | 'cci_overbought' | 'cci_neutral';
type ObvSignal = 'obv_rise' | 'obv_fall' | 'obv_neutral';
type AdxSignal = 'strong_up' | 'strong_down' | 'weak';

interface TechSignals {
  macdSignal?: MacdSignal;
  kdjSignal?: KdjSignal;
  maSignal?: MaSignal;
  bollSignal?: BollSignal;
  cciSignal?: CciSignal;
  obvSignal?: ObvSignal;
  adxSignal?: AdxSignal;
}

// ── 技术指标计算 ─────────────────────────────────
function computeTechSignals(kbars: KBar[]): TechSignals {
  if (kbars.length < 30) return {};

  const closes = kbars.map(k => k.close);
  const highs = kbars.map(k => k.high);
  const lows = kbars.map(k => k.low);
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];

  const indicators = computeIndicators(kbars);
  const macdLine = indicators.macd.macd;
  const signalLine = indicators.macd.signal;
  const macdLast = macdLine[macdLine.length - 1];
  const macdPrev = macdLine[macdLine.length - 2];
  const sigLast = signalLine[signalLine.length - 1];
  const sigPrev = signalLine[signalLine.length - 2];

  let macdSig: MacdSignal | undefined;
  if (!isNaN(macdLast) && !isNaN(sigLast)) {
    if (macdPrev < sigPrev && macdLast > sigLast) macdSig = 'golden_cross';
    else if (macdPrev > sigPrev && macdLast < sigLast) macdSig = 'dead_cross';
    else if (macdLast > 0) macdSig = 'above_zero';
    else macdSig = 'below_zero';
  }

  const kdjRes = indicators.kdj;
  const kLast = kdjRes.k[kdjRes.k.length - 1];
  const kPrev = kdjRes.k[kdjRes.k.length - 2];
  const dLast = kdjRes.d[kdjRes.d.length - 1];
  const dPrev = kdjRes.d[kdjRes.d.length - 2];
  let kdjSig: KdjSignal | undefined;
  if (!isNaN(kLast) && !isNaN(dLast)) {
    if (kLast < 20 && dLast < 20) kdjSig = 'oversold';
    else if (kLast > 80 && dLast > 80) kdjSig = 'overbought';
    else if (kPrev < dPrev && kLast > dLast) kdjSig = 'golden_cross';
    else if (kPrev > dPrev && kLast < dLast) kdjSig = 'dead_cross';
  }

  const ma20Last = indicators.sma20[indicators.sma20.length - 1];
  let maSig: MaSignal | undefined;
  if (!isNaN(ma20Last)) {
    maSig = last > ma20Last ? 'above_ma20' : 'below_ma20';
  }

  const upper = indicators.bollinger.upper[indicators.bollinger.upper.length - 1];
  const lower = indicators.bollinger.lower[indicators.bollinger.lower.length - 1];
  let bollSig: BollSignal | undefined;
  if (!isNaN(upper) && !isNaN(lower)) {
    if (last > upper) bollSig = 'above_upper';
    else if (last < lower) bollSig = 'below_lower';
    else if (last > upper * 0.98) bollSig = 'near_upper';
    else if (last < lower * 1.02) bollSig = 'near_lower';
  }

  // CCI 信号
  const cciArr = indicators.cci;
  const cciLast = cciArr[cciArr.length - 1];
  const cciPrev = cciArr[cciArr.length - 2];
  let cciSig: CciSignal | undefined;
  if (!isNaN(cciLast) && !isNaN(cciPrev)) {
    if (cciLast < -100) cciSig = 'cci_oversold';
    else if (cciLast > 100) cciSig = 'cci_overbought';
    else cciSig = 'cci_neutral';
  }

  // OBV 信号（取最近5根K线的OBV变化趋势）
  const obvArr = indicators.obv;
  const obvLast = obvArr[obvArr.length - 1];
  const obvPrev = obvArr[obvArr.length - 2];
  const obvPrev2 = obvArr[obvArr.length - 3];
  let obvSig: ObvSignal | undefined;
  if (!isNaN(obvLast) && !isNaN(obvPrev)) {
    if (obvLast > obvPrev && obvPrev > obvPrev2) obvSig = 'obv_rise';
    else if (obvLast < obvPrev && obvPrev < obvPrev2) obvSig = 'obv_fall';
    else obvSig = 'obv_neutral';
  }

  // ADX 信号
  const adxArr = indicators.adx;
  const adxLast = adxArr.adx[adxArr.adx.length - 1];
  const plusDILast = adxArr.plusDI[adxArr.plusDI.length - 1];
  const minusDILast = adxArr.minusDI[adxArr.minusDI.length - 1];
  const plusDIPrev = adxArr.plusDI[adxArr.plusDI.length - 2];
  const minusDIPrev = adxArr.minusDI[adxArr.minusDI.length - 2];
  let adxSig: AdxSignal | undefined;
  if (!isNaN(adxLast) && !isNaN(plusDILast) && !isNaN(minusDILast)) {
    if (adxLast > 25 && plusDIPrev <= minusDIPrev && plusDILast > minusDILast) adxSig = 'strong_up';
    else if (adxLast > 25 && minusDIPrev <= plusDIPrev && minusDILast > plusDILast) adxSig = 'strong_down';
    else adxSig = 'weak';
  }

  return { macdSignal: macdSig, kdjSignal: kdjSig, maSignal: maSig, bollSignal: bollSig, cciSignal: cciSig, obvSignal: obvSig, adxSignal: adxSig };
}

// ── 得分组成结构 ─────────────────────────────────
// 业界标准多因子体系（Barra + WorldQuant）：
//   估 值：PE/PB/PCF 等低估值因子（value因子）
//   盈 利：ROE/毛利率/净利润率（quality因子）
//   动 量：20日动量（momentum因子）+ RSI超卖反转（reverse因子）
//   资金流：主力净流入/量比（liquidity因子）
//   技 术：MACD/KDJ/MA信号（technical因子），双向给分
// 所有因子通过跨截面百分位排名归一化，消除量纲差异
export interface ScoreBreakdown {
  total: number;
  valuation: number;       // 估值维度（PE/PB百分位，越低越好）
  quality: number;         // 质量维度（ROE/毛利隐含分）
  momentum: number;        // 动量维度（20日动量百分位）
  reversal: number;        // 反转维度（RSI超卖程度，越超卖越高）
  moneyFlow: number;       // 资金流维度
  icIr: number;            // IC_IR 因子有效性
  technical: number;       // 技术信号综合
  changePercent: number;   // 涨跌幅（占位字段）
  turnover: number;        // 换手率活跃度
  riskLevel: '低' | '中' | '高';
}

// ── 跨截面百分位排名 ─────────────────────────────────
// 将数组值转换为0-100百分位分数，排名越高得分越高
function percentileScore(vals: number[], reverse = false): number[] {
  const n = vals.length;
  if (n === 0) return [];
  // 建立索引数组并按值排序
  const indexed = vals.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  // 计算百分位 (0~100)
  const pct = indexed.map((item, rank) => {
    // 使用 rank / (n-1) * 100，如果 n=1 则为 100
    return n === 1 ? 100 : (rank / (n - 1)) * 100;
  });
  // 还原原始顺序
  const result = new Array(n);
  indexed.forEach((item, rank) => { result[item.i] = pct[rank]; });
  if (reverse) result.forEach((_, i) => { result[i] = 100 - result[i]; });
  return result;
}

// ── RSI 计算（用于反转因子） ─────────────────────────────────
function computeRSI(kbars: KBar[], period = 14): number {
  if (kbars.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = kbars.length - period; i < kbars.length; i++) {
    const delta = kbars[i].close - kbars[i - 1].close;
    if (delta > 0) gains += delta;
    else losses += Math.abs(delta);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ── 批量预计算所有股票的百分位因子 ─────────────────────────────────
// 在主循环之前调用，为所有 techCandidates 预先计算百分位归一化因子
function preComputeFactorPercentiles(candidates: CandidateStock[], kbarsMap: Map<string, KBar[]>): void {
  const n = candidates.length;
  if (n === 0) return;

  // 提取各因子原始值
  const peVals = candidates.map(s => { const v = parseFloat(s.pe); return v > 0 ? v : 999; });
  const pbVals = candidates.map(s => { const v = parseFloat(s.pb); return v > 0 ? v : 999; });
  const momVals = candidates.map(s => s.momentumScore ?? 50);
  const mfVals = candidates.map(s => s.moneyFlowScore ?? 50);
  const icVals = candidates.map(s => s.icScore ?? 50);
  const irVals = candidates.map(s => s.irScore ?? 50);
  const chgVals = candidates.map(s => s.changePercent ?? 0);
  const turnVals = candidates.map(s => s.turnoverRate ?? 0);
  const mktcapVals = candidates.map(s => s.marketCap ?? 0);

  // 计算百分位（估值类 reverse=true 表示越低越好）
  const pePct = percentileScore(peVals, true);
  const pbPct = percentileScore(pbVals, true);
  const momPct = percentileScore(momVals);
  const mfPct = percentileScore(mfVals);
  const icPct = percentileScore(icVals);
  const irPct = percentileScore(irVals);
  const chgPct = percentileScore(chgVals, true); // 反转：跌得多给分高
  const turnPct = percentileScore(turnVals);
  const sizePct = percentileScore(mktcapVals, true); // 小市值优先

  // 计算 RSI（反转因子）
  const rsiVals = candidates.map(s => {
    const kbars = kbarsMap.get(s.code) ?? [];
    return computeRSI(kbars);
  });
  const rsiPct = percentileScore(rsiVals); // RSI低（超卖）给高分

  // 技术信号百分位：统计各信号的数量
  const techScoreRaw = candidates.map(s => {
    let score = 0;
    // 趋势类（金叉、水上）加正向分
    if (s.macdSignal === 'golden_cross') score += 3;
    else if (s.macdSignal === 'above_zero') score += 1.5;
    if (s.kdjSignal === 'golden_cross') score += 2.5;
    else if (s.kdjSignal === 'oversold') score += 2; // 超卖也是正向（反转）
    if (s.maSignal === 'above_ma20') score += 2;
    if (s.bollSignal === 'above_upper' || s.bollSignal === 'near_upper') score += 1.5;
    if (s.adxSignal === 'strong_up') score += 2.5;
    if (s.cciSignal === 'cci_oversold') score += 2; // 超卖给分
    if (s.cciSignal === 'cci_overbought') score += 1;
    return score;
  });
  const techPct = percentileScore(techScoreRaw);

  // 质量因子百分位（用 IC*IR 联合有效性代表质量）
  const qualityRaw = candidates.map(s => (s.icScore ?? 50) * (s.irScore ?? 50));
  const qualityPct = percentileScore(qualityRaw);

  // 写入各股票
  for (let i = 0; i < n; i++) {
    const c = candidates[i];
    // 使用百分位 × 100/100 = 直接归一化分（0-100）
    (c as any)._pct = {
      pe: pePct[i],
      pb: pbPct[i],
      momentum: momPct[i],
      reversal: chgPct[i],    // 涨跌幅反转：跌多给高分
      rsiReversal: rsiPct[i], // RSI超卖反转
      moneyFlow: mfPct[i],
      ic: icPct[i],
      ir: irPct[i],
      turnover: turnPct[i],
      size: sizePct[i],
      technical: techPct[i],
      quality: qualityPct[i],
    };
  }
}

// ── 多因子评分（业界标准：百分位归一化 + Barra风格因子体系） ─────────────────────────────────
function scoreStock(s: ScreenerStock, opts?: {
  moneyFlowScore?: number;
  momentumScore?: number;
  icScore?: number;
  irScore?: number;
  pct?: Record<string, number>;
  kbars?: KBar[];
  weights?: Record<string, number>;  // IC/IR derived weights override, e.g. { pe: 30, momentum: 15 }
}): ScoreBreakdown {
  const pct = opts?.pct;
  const weights = opts?.weights;

  // Helper: apply weight override if available, else use hardcoded default
  const w = (key: string, defaultVal: number) => weights?.[key] ?? defaultVal;

  // 1. 估值得分（0-30分） Barra Value因子
  // PE/PB 百分位均值，越被低估分越高
  const valuation = pct
    ? ((pct.pe + pct.pb) / 2) * (w('pe', 30) / 100)
    : (() => {
      let v = 0;
      if (s.pe > 0 && s.pe < 50) v = Math.max(0, (50 - s.pe) / 10) * 5;
      if (s.pb > 0 && s.pb < 10) v += Math.max(0, (10 - s.pb)) * 2;
      return Math.min(30, v);
    })();

  // 2. 质量得分（0-20分） Barra Quality因子
  // 用 IC×IR 联合有效性间接代表因子预测质量
  const quality = pct
    ? pct.quality * (w('quality', 20) / 100)
    : (() => {
      if (opts?.icScore !== undefined && opts?.irScore !== undefined) {
        return Math.min(20, (opts.icScore * opts.irScore) / 50);
      }
      return 0;
    })();

  // 3. 动量得分 Barra Momentum因子
  const momentum = pct
    ? pct.momentum * (w('momentum', 15) / 100)
    : (opts?.momentumScore !== undefined ? (opts.momentumScore - 50) / 3.33 : 0);

  // 4. 反转得分 WorldQuant Alpha14 反转型
  const reversal = pct
    ? ((pct.reversal + pct.rsiReversal) / 2) * (w('reversal', 15) / 100)
    : (() => {
      const chg = s.changePercent;
      let chgScore = 0;
      if (chg < -8) chgScore = 10;
      else if (chg < -5) chgScore = 7;
      else if (chg < -2) chgScore = 4;
      else if (chg <= 3) chgScore = 2;
      else chgScore = 0;
      const kbars = opts?.kbars ?? [];
      const rsi = computeRSI(kbars);
      const rsiScore = rsi < 30 ? (30 - rsi) / 3 : 0;
      return Math.min(15, chgScore + rsiScore);
    })();

  // 5. 资金流得分 Barra Liquidity因子
  const moneyFlow = pct
    ? pct.moneyFlow * (w('moneyFlow', 15) / 100)
    : (opts?.moneyFlowScore !== undefined ? (opts.moneyFlowScore - 50) / 3.33 : 0);

  // 6. 技术信号得分
  const technical = pct
    ? pct.technical * (w('technical', 15) / 100)
    : (() => {
      let t = 0;
      if (s.macdSignal === 'golden_cross') t += 4;
      else if (s.macdSignal === 'above_zero') t += 2;
      if (s.kdjSignal === 'golden_cross') t += 3;
      else if (s.kdjSignal === 'oversold') t += 3;
      if (s.maSignal === 'above_ma20') t += 3;
      if (s.bollSignal === 'above_upper' || s.bollSignal === 'near_upper') t += 2;
      if (s.adxSignal === 'strong_up') t += 3;
      if (s.cciSignal === 'cci_oversold') t += 3;
      return Math.min(15, t);
    })();

  // 7. 换手率活跃度得分
  const turnover = pct
    ? pct.turnover * (w('turnover', 5) / 100)
    : (() => {
      if (s.turnoverRate >= 3 && s.turnoverRate <= 15) return 5;
      if (s.turnoverRate > 15) return 3;
      if (s.turnoverRate > 1) return 2;
      return 0;
    })();

  // 风险等级
  const riskLevel: '低' | '中' | '高' =
    (s.pe > 0 && s.pe < 30 && s.pb < 5) ? '低' :
    (s.pe > 60 || s.pb > 10) ? '高' : '中';

  const total = Math.max(0, Math.min(100,
    Math.round((valuation + quality + momentum + reversal + moneyFlow + technical + turnover) * 100) / 100
  ));

  return {
    total,
    valuation: Math.round(valuation * 100) / 100,
    quality: Math.round(quality * 100) / 100,
    momentum: Math.round(momentum * 100) / 100,
    reversal: Math.round(reversal * 100) / 100,
    moneyFlow: Math.round(moneyFlow * 100) / 100,
    icIr: 0,
    technical: Math.round(technical * 100) / 100,
    changePercent: 0,
    turnover: Math.round(turnover * 100) / 100,
    riskLevel,
  };
}

// ── 资金流因子计算 ─────────────────────────────────
// 注：真实主力净流入数据需要东财Level-2接口（服务器端不可用）
// 此处基于K线量价关系估算，适合作为筛选因子而非精确数据
function computeMoneyFlowFactors(kbars: KBar[]): {
  moneyFlowScore: number;
  mainNetInflow: number;     // 估算主力净流入（万元）
  mainNetInflowRatio: number;
  volumeRatio: number;
} {
  if (kbars.length < 20) {
    return { moneyFlowScore: 50, mainNetInflow: 0, mainNetInflowRatio: 0, volumeRatio: 1 };
  }

  const recent = kbars.slice(-20);
  const avgVolume = recent.slice(0, -1).reduce((a, b) => a + b.volume, 0) / (recent.length - 1);
  const currentVolume = recent[recent.length - 1].volume;
  const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

  // 估算主力净流入（万元）= 近20日累计
  // 涨时：涨幅 × 成交额 × 0.7（主力主动买入占比估算）
  // 跌时：跌幅 × 成交额 × 0.5（主力出货占比估算）
  let mainNetInflow = 0;
  for (let i = 1; i < recent.length; i++) {
    const change = (recent[i].close - recent[i - 1].close) / recent[i - 1].close;
    const amount = recent[i].amount / 10000; // amount 原始单位是元，转万元
    if (change > 0) {
      mainNetInflow += amount * Math.abs(change) * 0.7;
    } else {
      mainNetInflow -= amount * Math.abs(change) * 0.5;
    }
  }

  const totalAmount = recent[recent.length - 1].amount / 10000 || 1;
  const mainNetInflowRatio = mainNetInflow / totalAmount;

  let moneyFlowScore = 50;
  if (mainNetInflow > 10000) moneyFlowScore += 20;
  else if (mainNetInflow > 5000) moneyFlowScore += 15;
  else if (mainNetInflow > 1000) moneyFlowScore += 10;
  else if (mainNetInflow < -10000) moneyFlowScore -= 20;
  else if (mainNetInflow < -5000) moneyFlowScore -= 15;
  else if (mainNetInflow < -1000) moneyFlowScore -= 10;

  if (volumeRatio > 2) moneyFlowScore += 10;
  else if (volumeRatio > 1.5) moneyFlowScore += 5;

  return {
    moneyFlowScore: Math.max(0, Math.min(100, moneyFlowScore)),
    mainNetInflow: Math.round(mainNetInflow),              // 估算净流入（万元）
    mainNetInflowRatio: Math.round(mainNetInflowRatio * 10000) / 100,
    volumeRatio: Math.round(volumeRatio * 100) / 100,
  };
}

// ── 动量因子计算 ─────────────────────────────────
function computeMomentumFactors(kbars: KBar[]): {
  momentum5: number;
  momentum20: number;
  momentumScore: number;
} {
  if (kbars.length < 25) {
    return { momentum5: 0, momentum20: 0, momentumScore: 50 };
  }

  const momentum5 = kbars.length >= 6
    ? (kbars[kbars.length - 1].close - kbars[kbars.length - 6].close) / kbars[kbars.length - 6].close
    : 0;
  const momentum20 = kbars.length >= 21
    ? (kbars[kbars.length - 1].close - kbars[kbars.length - 21].close) / kbars[kbars.length - 21].close
    : 0;

  let momentumScore = 50;
  momentumScore += momentum5 * 200;
  momentumScore += momentum20 * 100;

  return {
    momentum5: Math.round(momentum5 * 10000) / 10000,
    momentum20: Math.round(momentum20 * 10000) / 10000,
    momentumScore: Math.max(0, Math.min(100, momentumScore)),
  };
}

// ── 简化 IC 估算（基于因子与收益相关性） ─────────────────────────────────
function estimateICScore(kbars: KBar[]): { icScore: number; irScore: number } {
  if (kbars.length < 60) return { icScore: 0, irScore: 0 };

  // 用最近20天数据估算IC
  const returns: number[] = [];
  const momentumVals: number[] = [];

  for (let i = kbars.length - 20; i < kbars.length - 1; i++) {
    const ret = (kbars[i + 1].close - kbars[i].close) / kbars[i].close;
    const mom = (kbars[i].close - kbars[i - 5].close) / kbars[i - 5].close;
    returns.push(ret);
    momentumVals.push(mom);
  }

  if (returns.length < 10) return { icScore: 0, irScore: 0 };

  // 简化的 IC 计算
  const meanRet = returns.reduce((a, b) => a + b, 0) / returns.length;
  const meanMom = momentumVals.reduce((a, b) => a + b, 0) / momentumVals.length;

  let covariance = 0;
  let varRet = 0;
  let varMom = 0;

  for (let i = 0; i < returns.length; i++) {
    const dRet = returns[i] - meanRet;
    const dMom = momentumVals[i] - meanMom;
    covariance += dRet * dMom;
    varRet += dRet * dRet;
    varMom += dMom * dMom;
  }

  const stdRet = Math.sqrt(varRet / returns.length);
  const stdMom = Math.sqrt(varMom / momentumVals.length);
  const denominator = stdRet * stdMom;

  const ic = denominator > 0 ? covariance / denominator : 0;
  const ir = stdMom > 0 ? (meanMom / stdMom) : 0;

  // 标准化到 0-100 分
  const icScore = Math.max(0, Math.min(100, 50 + ic * 500));
  const irScore = Math.max(0, Math.min(100, 50 + ir * 100));

  return { icScore, irScore };
}

// ── 市场状态检测 ─────────────────────────────────
let globalRegime: MarketRegime = 'uncertain';
let globalRegimeConfidence = 0;
let lastRegimeUpdate = 0;

function detectMarketRegime(kbars: KBar[]): { regime: MarketRegime; confidence: number } {
  if (kbars.length < 30) return { regime: 'uncertain', confidence: 0 };

  const classifier = new MarketRegimeClassifier();
  classifier.updateBars(kbars);
  const result = classifier.analyze(20);
  return { regime: result.regime, confidence: result.confidence };
}

// ── 转换函数 ─────────────────────────────────
function toScreenerStock(s: StockRaw): ScreenerStock {
  const changePercent = parseFloat(s.changepercent) || 0;
  const marketCap = parseFloat(s.mktcap) || 0;
  const turnoverRate = parseFloat(s.turnoverratio) || 0;
  return {
    code: (s.symbol.replace(/^[a-z]+/, '').padStart(6, '0')) +
      (s.symbol.startsWith('sh') ? '.SH' : s.symbol.startsWith('sz') ? '.SZ' : '.BJ'),
    name: s.name || '',
    price: parseFloat(s.trade) || 0,
    changePercent,
    volume: parseFloat(s.volume) || 0,
    amount: parseFloat(s.amount) || 0,
    pe: parseFloat(s.pe) || -1,
    pb: parseFloat(s.pb) || -1,
    marketCap,
    floatCap: parseFloat(s.nmc) || 0,
    turnoverRate,
    industry: stockIndustry(s.symbol),
    mainNetInflow: s.mainNetInflow || 0,
  };
}

// ── 候选股类型（含技术信号+资金流+动量+市场状态）────────────────────────────
interface CandidateStock extends StockRaw {
  code: string; // 标准化代码 e.g. "600519.SH"
  macdSignal?: MacdSignal;
  kdjSignal?: KdjSignal;
  maSignal?: MaSignal;
  bollSignal?: BollSignal;
  cciSignal?: CciSignal;
  obvSignal?: ObvSignal;
  adxSignal?: AdxSignal;
  score?: number;
  // 新增
  moneyFlowScore?: number;
  mainNetInflowRatio?: number;
  volumeRatio?: number;
  momentum5?: number;
  momentum20?: number;
  momentumScore?: number;
  marketRegime?: MarketRegime;
  regimeConfidence?: number;
  icScore?: number;
  irScore?: number;
  compositeScore?: number;
}

// ── 筛选器参数 ─────────────────────────────────
interface FilterParams {
  industry?: string;
  priceMin?: number; priceMax?: number;
  peMin?: number; peMax?: number;
  pbMin?: number; pbMax?: number;
  mktCapMin?: number; mktCapMax?: number;
  turnoverMin?: number; turnoverMax?: number;
  changeMin?: number; changeMax?: number;
  volumeMin?: number; amountMin?: number;
  excludeSt?: boolean;
  sortBy?: string; sortOrder?: 'asc' | 'desc';
  limit?: number; offset?: number;
  // 技术面筛选
  techSignal?: string; // macd_golden_cross | kdj_oversold | ...
  maFilter?: string;  // above_ma20 | below_ma20
  bollFilter?: string; // above_upper | below_lower
  cciFilter?: string; // oversold | overbought
  obvFilter?: string; // rise | fall
  adxFilter?: string; // strong_up | strong_down | weak
  // 消息面筛选
  sentiment?: 'positive' | 'negative' | 'important'; // 利好/利空/重大消息
  rating?: string; // 机构评级：买入/增持/中性
  // 评分排序
  scoreSort?: boolean;
  // 快捷模板
  template?: string;
  // 资金流筛选
  moneyFlowMin?: number; // 资金流得分下限
  mainNetInflowMin?: number; // 主力净流入下限（万元）
  volumeRatioMin?: number; // 量比下限
  // 动量筛选
  momentumMin?: number; // 动量得分下限
  momentum20Min?: number; // 20日动量下限
  // 市场状态筛选
  regimeFilter?: MarketRegime; // 只看特定市场状态的股票
  // IC/IR 筛选
  icScoreMin?: number; // IC评分下限
  irScoreMin?: number; // IR评分下限
}

// ── 基本面筛选 ─────────────────────────────────
function applyFundamentalFilters(stocks: StockRaw[], params: FilterParams): StockRaw[] {
  return stocks.filter(s => {
    const stockIndustry = getIndustry(s.symbol);
    if (params.industry && params.industry !== '不限' && stockIndustry !== params.industry) return false;

    const price = parseFloat(s.trade) || 0;
    if (params.priceMin !== undefined && price < params.priceMin) return false;
    if (params.priceMax !== undefined && price > params.priceMax) return false;

    const pe = parseFloat(s.pe) || -1;
    if (params.peMin !== undefined && pe < params.peMin) return false;
    if (params.peMax !== undefined && (pe < 0 || pe > params.peMax)) return false;

    const pb = parseFloat(s.pb) || -1;
    if (params.pbMin !== undefined && (pb < 0 || pb < params.pbMin)) return false;
    if (params.pbMax !== undefined && (pb < 0 || pb > params.pbMax)) return false;

    const mktCap = parseFloat(s.mktcap) || 0;
    if (params.mktCapMin !== undefined && mktCap < params.mktCapMin) return false;
    if (params.mktCapMax !== undefined && mktCap > params.mktCapMax) return false;

    const turnover = parseFloat(s.turnoverratio) || 0;
    if (params.turnoverMin !== undefined && turnover < params.turnoverMin) return false;
    if (params.turnoverMax !== undefined && turnover > params.turnoverMax) return false;

    const change = parseFloat(s.changepercent) || 0;
    if (params.changeMin !== undefined && change < params.changeMin) return false;
    if (params.changeMax !== undefined && change > params.changeMax) return false;

    const volume = parseFloat(s.volume) || 0;
    if (params.volumeMin !== undefined && volume < params.volumeMin) return false;

    const amount = parseFloat(s.amount) || 0;
    if (params.amountMin !== undefined && amount < params.amountMin) return false;

    if (params.excludeSt !== false) {
      const name = s.name || '';
      if (name.includes('ST') || name.includes('退') || name.includes('*ST')) return false;
    }

    return true;
  });
}

// ── FilterSummary ─────────────────────────────────
function calcFilterSummary(stocks: StockRaw[]): FilterSummary {
  const valid = stocks.filter(s => {
    const name = s.name || '';
    if (name.includes('ST') || name.includes('退') || name.includes('*ST')) return false;
    return true;
  });
  const prices = valid.map(s => parseFloat(s.trade) || 0).filter(v => v > 0);
  const pes = valid.map(s => parseFloat(s.pe) || -1).filter(v => v > 0 && v < 10000);
  const pbs = valid.map(s => parseFloat(s.pb) || -1).filter(v => v > 0 && v < 100);
  const caps = valid.map(s => parseFloat(s.mktcap) || 0).filter(v => v > 0);
  const turns = valid.map(s => parseFloat(s.turnoverratio) || 0).filter(v => v >= 0);
  const changes = valid.map(s => parseFloat(s.changepercent) || 0);
  const industryMap = new Map<string, number>();
  for (const s of valid) {
    const ind = getIndustry(s.symbol);
    industryMap.set(ind, (industryMap.get(ind) || 0) + 1);
  }
  return {
    priceRange: [Math.min(...prices) || 0, Math.max(...prices) || 0],
    peRange: [Math.min(...pes) || 0, Math.max(...pes) || 100],
    pbRange: [Math.min(...pbs) || 0, Math.max(...pbs) || 10],
    mktCapRange: [Math.min(...caps) || 0, Math.max(...caps) || 0],
    turnoverRange: [Math.min(...turns) || 0, Math.max(...turns) || 0],
    changeRange: [Math.min(...changes) || -10, Math.max(...changes) || 10],
    industryCounts: [...industryMap.entries()].map(([industry, count]) => ({ industry, count })).sort((a, b) => b.count - a.count),
    totalStocks: valid.length,
  };
}

// ── 消息面辅助函数 ─────────────────────────────────

/** 获取指定情感标签的股票代码集合
 * 策略：
 * 1. 利好(positive): 取近20日涨幅>5%的股票（价格动量驱动）
 * 2. 利空(negative): 取近20日跌幅>5%的股票
 * 3. 重大消息(important): 取近5日换手率异常高的股票（高换手暗示消息刺激）
 *
 * 注：东方财富涨停原因池接口 push2ex 已失效(rc=102)，改用价量因子代替
 */
async function fetchSentimentForCodes(
  codes: string[],
  sentiment: 'positive' | 'negative' | 'important'
): Promise<Set<string>> {
  // 舆情按价量因子筛选（无需外部API调用，直接用候选股K线数据）
  // 缓存： sentiment -> code -> matched (静态缓存，60秒有效)
  const cacheKey = `_sentiment_${sentiment}`;
  const cached = (global as any)[cacheKey] as { codes: string[]; ts: number; result: Set<string> } | undefined;
  if (cached && Date.now() - cached.ts < 60_000 && cached.codes.length === codes.length) {
    return cached.result;
  }

  const matched = new Set<string>();
  try {
    // 从候选股中获取K线数据用于舆情判断（每次最多处理100只，防止超时）
    // codes 格式：["600519.SH", "000001.SZ", ...]
    const BATCH = 100;
    for (let i = 0; i < codes.length; i += BATCH) {
      const batch = codes.slice(i, i + BATCH);
      const klineMap = await getKlineBatch(batch, 20);
      for (const code of batch) {
        const kbars = klineMap.get(code) || [];
        if (kbars.length < 5) continue;

        const recent = kbars.slice(-5);
        // 计算近5日涨跌幅（相比20日前）
        const priceChange = kbars.length >= 6
          ? (kbars[kbars.length - 1].close - kbars[kbars.length - 6].close) / kbars[kbars.length - 6].close
          : 0;

        // 换手率 proxy：当日成交额 / 期初流通市值（amount / floatCap）
        // 用 amount 增长率近似换手率变化
        const avgAmount = recent.reduce((a, b) => a + b.amount, 0) / recent.length;
        const currentAmount = recent[recent.length - 1].amount;
        const amountRatio = avgAmount > 0 ? currentAmount / avgAmount : 1;

        // 利好：近5日涨幅 > 5% 或 K线呈连续上涨形态
        if (sentiment === 'positive' && (priceChange > 0.05 || isConsecutiveUp(kbars, 3))) {
          matched.add(code.replace('.SH', '').replace('.SZ', '').replace('.BJ', '').padStart(6, '0'));
        }
        // 利空：近5日跌幅 > 5%
        else if (sentiment === 'negative' && priceChange < -0.05) {
          matched.add(code.replace('.SH', '').replace('.SZ', '').replace('.BJ', '').padStart(6, '0'));
        }
        // 重大消息：近5日成交额异常放大（量比>2倍）
        else if (sentiment === 'important' && amountRatio > 2) {
          matched.add(code.replace('.SH', '').replace('.SZ', '').replace('.BJ', '').padStart(6, '0'));
        }
      }
    }
  } catch (e) {
    console.error('[ScreenerAPI] fetchSentimentForCodes error:', e);
  }

  (global as any)[cacheKey] = { codes, ts: Date.now(), result: matched };
  return matched;
}

/** 判断近N日是否连续上涨（N=3时更可靠） */
function isConsecutiveUp(kbars: KBar[], n = 3): boolean {
  if (kbars.length < n + 1) return false;
  const recent = kbars.slice(-n - 1, -1);
  for (let i = 0; i < n; i++) {
    if (recent[i].close <= recent[i + 1].close) return false;
  }
  return true;
}

/** 获取指定评级（如"买入"）的股票代码集合
 * 策略：东方财富 datacenter RPT_RESEARCH_REPORT 接口已失效(RC=9501)
 * 改用K线量价因子推算机构关注度作为评级代理
 *
 * 评级代理：
 * - 增持/买入：近5日涨幅>5% 且 换手率>3% （机构被动增持假设）
 * - 中性：近5日涨跌幅在-5%~5%之间
 * - 卖出/减持：（当前市场极少，不提供）
 */
async function fetchRatingForCodes(codes: string[], rating: string): Promise<Set<string>> {
  const matched = new Set<string>();
  try {
    const BATCH = 100;
    for (let i = 0; i < codes.length; i += BATCH) {
      const rawBatch = codes.slice(i, i + BATCH);
      // codes 格式: ["600519", "000001"]，需要转换为 getKlineBatch 格式
      const batch = rawBatch.map(c => {
        const num = c.padStart(6, '0');
        return num.startsWith('6') || num.startsWith('9') ? `${num}.SH` : `${num}.SZ`;
      });
      const klineMap = await getKlineBatch(batch, 20);
      for (const rawCode of rawBatch) {
        const num = rawCode.padStart(6, '0');
        const code = num.startsWith('6') || num.startsWith('9') ? `${num}.SH` : `${num}.SZ`;
        const kbars = klineMap.get(code) || [];
        if (kbars.length < 5) continue;

        const recent = kbars.slice(-5);
        const priceChange = kbars.length >= 6
          ? (kbars[kbars.length - 1].close - kbars[kbars.length - 6].close) / kbars[kbars.length - 6].close
          : 0;
        const avgAmount = recent.reduce((a, b) => a + b.amount, 0) / recent.length;
        const currentAmount = recent[recent.length - 1].amount;
        const amountRatio = avgAmount > 0 ? currentAmount / avgAmount : 1;

        // 增持/买入：涨幅>5% 或 涨幅>2%但量比>1.5倍
        if (rating === '增持' || rating === '买入') {
          if (priceChange > 0.05 || (priceChange > 0.02 && amountRatio > 1.5)) {
            matched.add(rawCode.padStart(6, '0'));
          }
        }
        // 中性：涨幅在-5%~5%之间
        else if (rating === '中性') {
          if (priceChange >= -0.05 && priceChange <= 0.05) {
            matched.add(rawCode.padStart(6, '0'));
          }
        }
      }
    }
  } catch (e) {
    console.error('[ScreenerAPI] fetchRatingForCodes error:', e);
  }
  return matched;
}

// ── API 入口 ─────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const isNaN = (v: number) => Number.isNaN(v);

  const params: FilterParams = {
    industry: searchParams.get('industry') || undefined,
    priceMin: parseFloat(searchParams.get('priceMin') || ''),
    priceMax: parseFloat(searchParams.get('priceMax') || ''),
    peMin: parseFloat(searchParams.get('peMin') || ''),
    peMax: parseFloat(searchParams.get('peMax') || ''),
    pbMin: parseFloat(searchParams.get('pbMin') || ''),
    pbMax: parseFloat(searchParams.get('pbMax') || ''),
    mktCapMin: parseFloat(searchParams.get('mktCapMin') || ''),
    mktCapMax: parseFloat(searchParams.get('mktCapMax') || ''),
    turnoverMin: parseFloat(searchParams.get('turnoverMin') || ''),
    turnoverMax: parseFloat(searchParams.get('turnoverMax') || ''),
    changeMin: parseFloat(searchParams.get('changeMin') || ''),
    changeMax: parseFloat(searchParams.get('changeMax') || ''),
    volumeMin: parseFloat(searchParams.get('volumeMin') || ''),
    amountMin: parseFloat(searchParams.get('amountMin') || ''),
    excludeSt: searchParams.get('excludeSt') !== 'false',
    sortBy: searchParams.get('sortBy') || undefined,
    sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc',
    limit: Math.min(parseInt(searchParams.get('limit') || '50', 10), 200),
    offset: parseInt(searchParams.get('offset') || '0', 10),
    techSignal: searchParams.get('techSignal') || undefined,
    maFilter: searchParams.get('maFilter') || undefined,
    bollFilter: searchParams.get('bollFilter') || undefined,
    sentiment: (searchParams.get('sentiment') as FilterParams['sentiment']) || undefined,
    rating: searchParams.get('rating') || undefined,
    scoreSort: searchParams.get('scoreSort') === 'true',
    template: searchParams.get('template') || undefined,
    // 资金流筛选
    moneyFlowMin: parseFloat(searchParams.get('moneyFlowMin') || ''),
    mainNetInflowMin: parseFloat(searchParams.get('mainNetInflowMin') || ''),
    volumeRatioMin: parseFloat(searchParams.get('volumeRatioMin') || ''),
    // 动量筛选
    momentumMin: parseFloat(searchParams.get('momentumMin') || ''),
    momentum20Min: parseFloat(searchParams.get('momentum20Min') || ''),
    // 市场状态筛选
    regimeFilter: (searchParams.get('regimeFilter') as MarketRegime) || undefined,
    // IC/IR 筛选
    icScoreMin: parseFloat(searchParams.get('icScoreMin') || ''),
    irScoreMin: parseFloat(searchParams.get('irScoreMin') || ''),
  };

  // 清理 NaN
  const clean = (k: keyof FilterParams) => { if (isNaN(params[k] as number)) delete params[k]; };
  ['priceMin','priceMax','peMin','peMax','pbMin','pbMax','mktCapMin','mktCapMax','turnoverMin','turnoverMax','changeMin','changeMax','volumeMin','amountMin','moneyFlowMin','mainNetInflowMin','volumeRatioMin','momentumMin','momentum20Min','icScoreMin','irScoreMin'].forEach(k => clean(k as keyof FilterParams));

  // 快捷模板
  if (params.template) {
    switch (params.template) {
      case 'lowPe': params.peMax = 15; params.excludeSt = true; params.sortBy = 'pe'; params.sortOrder = 'asc'; params.limit = 30; break;
      case 'highGrowth': params.peMin = 15; params.peMax = 40; params.excludeSt = true; params.sortBy = 'changePercent'; params.sortOrder = 'desc'; params.limit = 30; break;
      case 'smallCap': params.mktCapMax = 50; params.turnoverMin = 3; params.excludeSt = true; params.sortBy = 'marketCap'; params.sortOrder = 'asc'; params.limit = 30; break;
      case 'hotMoney': params.turnoverMin = 5; params.sortBy = 'mainNetInflow'; params.sortOrder = 'desc'; params.limit = 50; break;
      case 'limitUp': params.changeMin = 9.5; params.sortBy = 'changePercent'; params.sortOrder = 'desc'; params.limit = 50; break;
      case 'value': params.peMax = 20; params.pbMax = 2; params.excludeSt = true; params.sortBy = 'pe'; params.sortOrder = 'asc'; params.limit = 30; break;
      // 技术面模板
      case 'macdGolden': params.techSignal = 'macd_golden_cross'; params.sortBy = 'changePercent'; params.limit = 30; break;
      case 'kdjOversold': params.techSignal = 'kdj_oversold'; params.sortBy = 'changePercent'; params.limit = 30; break;
      case 'bollBreak': params.techSignal = 'boll_above_upper'; params.sortBy = 'changePercent'; params.limit = 30; break;
      case 'ma20Above': params.maFilter = 'above_ma20'; params.sortBy = 'changePercent'; params.limit = 50; break;
      case 'combo': params.techSignal = 'macd_golden_cross'; params.maFilter = 'above_ma20'; params.changeMin = -3; params.changeMax = 5; params.excludeSt = true; params.limit = 30; break;
      // 资金流模板
      case 'moneyFlow': params.moneyFlowMin = 60; params.sortBy = 'moneyFlowScore'; params.limit = 50; break;
      case 'mainInflow': params.mainNetInflowMin = 500; params.sortBy = 'mainNetInflow'; params.limit = 50; break;
      case 'highVolume': params.volumeRatioMin = 1.5; params.sortBy = 'volumeRatio'; params.limit = 50; break;
      // 动量模板
      case 'strongMomentum': params.momentumMin = 65; params.sortBy = 'momentumScore'; params.limit = 50; break;
      case 'momentum20Up': params.momentum20Min = 0.03; params.sortBy = 'momentum20'; params.limit = 50; break;
      // IC/IR 模板
      case 'highIC': params.icScoreMin = 60; params.sortBy = 'icScore'; params.limit = 50; break;
      case 'highIR': params.irScoreMin = 60; params.sortBy = 'irScore'; params.limit = 50; break;
      // 市场状态模板
      case 'uptrend': params.regimeFilter = 'strong_uptrend'; params.sortBy = 'changePercent'; params.limit = 50; break;
      case 'highVol': params.regimeFilter = 'high_volatility'; params.sortBy = 'volumeRatio'; params.limit = 50; break;
      // 复合评分模板
      case 'compositeScore': params.scoreSort = true; params.limit = 50; break;
      case 'icIrCombo': params.icScoreMin = 55; params.irScoreMin = 55; params.momentumMin = 55; params.scoreSort = true; params.limit = 50; break;
    }
  }

  try {
    const allStocks = await getAllStocks();
    const filtered = applyFundamentalFilters(allStocks, params);
    const summary = calcFilterSummary(allStocks);

    // 如果需要技术面筛选或消息面筛选或新因子，先取候选股（前200只）计算
    // 注意：scoreSort=true 时也需要计算资金流/动量/IC/IR 因子，否则 compositeScore 全为0
    const needsNewFactors = params.moneyFlowMin !== undefined || params.mainNetInflowMin !== undefined ||
      params.volumeRatioMin !== undefined || params.momentumMin !== undefined ||
      params.momentum20Min !== undefined || params.regimeFilter !== undefined ||
      params.icScoreMin !== undefined || params.irScoreMin !== undefined ||
      params.scoreSort === true;
    const needsTechFilter = params.techSignal || params.maFilter || params.bollFilter || params.scoreSort || params.sentiment || params.rating || needsNewFactors;
    let techCandidates: CandidateStock[] = filtered.slice(0, needsTechFilter ? 200 : 0) as CandidateStock[];

    // 全局市场状态（用第一只候选股代表）
    let globalRegimeResult: { regime: MarketRegime; confidence: number } = { regime: 'uncertain', confidence: 0 };

    if (needsTechFilter && techCandidates.length > 0) {
      const codes = techCandidates.map(s => {
        const sym = s.symbol;
        const rawCode = sym.replace(/^[a-z]+/, '').padStart(6, '0');
        return (rawCode) + (sym.startsWith('sh') ? '.SH' : sym.startsWith('sz') ? '.SZ' : '.BJ');
      });

      const klineMap = await getKlineBatch(codes, 60);

      // 检测全局市场状态
      if (codes.length > 0) {
        const firstKbars = klineMap.get(codes[0]);
        if (firstKbars && firstKbars.length >= 30) {
          globalRegimeResult = detectMarketRegime(firstKbars);
        }
      }

      for (const s of techCandidates) {
        const sym = s.symbol;
        const rawCode = sym.replace(/^[a-z]+/, '').padStart(6, '0');
        const code = rawCode + (sym.startsWith('sh') ? '.SH' : sym.startsWith('sz') ? '.SZ' : '.BJ');
        s.code = code;
        const kbars = klineMap.get(code) || [];

        // 技术信号
        const signals = computeTechSignals(kbars);
        Object.assign(s, signals);

        // 资金流因子
        if (needsNewFactors && kbars.length >= 20) {
          const mf = computeMoneyFlowFactors(kbars);
          s.moneyFlowScore = mf.moneyFlowScore;
          s.mainNetInflow = mf.mainNetInflow;   // 估算主力净流入（万元）
          s.mainNetInflowRatio = mf.mainNetInflowRatio;
          s.volumeRatio = mf.volumeRatio;

          // 动量因子
          const mom = computeMomentumFactors(kbars);
          s.momentum5 = mom.momentum5;
          s.momentum20 = mom.momentum20;
          s.momentumScore = mom.momentumScore;

          // IC/IR 估算
          const icResult = estimateICScore(kbars);
          s.icScore = icResult.icScore;
          s.irScore = icResult.irScore;

          // 市场状态（每只股票单独检测）
          const regimeResult = detectMarketRegime(kbars);
          s.marketRegime = regimeResult.regime;
          s.regimeConfidence = regimeResult.confidence;

          // 复合评分（s 是 CandidateStock，需转 unknown 再转类型）
          const minStock = s as unknown as ScreenerStock;
          const bd = scoreStock(minStock, {
            moneyFlowScore: s.moneyFlowScore,
            momentumScore: s.momentumScore,
            icScore: s.icScore,
            irScore: s.irScore,
          });
          s.compositeScore = bd.total;
          (s as any).scoreBreakdown = bd;
        }

        s.marketRegime = s.marketRegime || globalRegimeResult.regime;
        s.regimeConfidence = s.regimeConfidence || globalRegimeResult.confidence;
      }

      // ── 技术面/基本面过滤（计算完因子之后、评分之前） ─────────────────────────────
      if (params.techSignal) {
        const map: Record<string, string[]> = {
          macd_golden_cross: ['golden_cross'], macd_dead_cross: ['dead_cross'],
          kdj_oversold: ['oversold'], kdj_overbought: ['overbought'],
          kdj_golden_cross: ['golden_cross'], kdj_dead_cross: ['dead_cross'],
          boll_above_upper: ['above_upper'], boll_below_lower: ['below_lower'],
        };
        const allowed = map[params.techSignal] || [];
        if (allowed.length > 0) {
          techCandidates = techCandidates.filter(s => {
            const macd = s.macdSignal && allowed.includes(s.macdSignal);
            const kdj = s.kdjSignal && allowed.includes(s.kdjSignal);
            const boll = s.bollSignal && allowed.includes(s.bollSignal);
            return macd || kdj || boll;
          });
        }
      }
      if (params.maFilter) techCandidates = techCandidates.filter(s => s.maSignal === params.maFilter);
      if (params.bollFilter) techCandidates = techCandidates.filter(s => s.bollSignal === params.bollFilter);
      if (params.cciFilter) techCandidates = techCandidates.filter(s => s.cciSignal === params.cciFilter);
      if (params.obvFilter) techCandidates = techCandidates.filter(s => s.obvSignal === params.obvFilter);
      if (params.adxFilter) techCandidates = techCandidates.filter(s => s.adxSignal === params.adxFilter);
      if (params.moneyFlowMin !== undefined) techCandidates = techCandidates.filter(s => (s.moneyFlowScore || 0) >= params.moneyFlowMin!);
      if (params.mainNetInflowMin !== undefined) techCandidates = techCandidates.filter(s => s.mainNetInflow >= params.mainNetInflowMin!);
      if (params.volumeRatioMin !== undefined) techCandidates = techCandidates.filter(s => (s.volumeRatio || 0) >= params.volumeRatioMin!);
      if (params.momentumMin !== undefined) techCandidates = techCandidates.filter(s => (s.momentumScore || 0) >= params.momentumMin!);
      if (params.momentum20Min !== undefined) techCandidates = techCandidates.filter(s => (s.momentum20 || 0) >= params.momentum20Min!);
      if (params.regimeFilter) techCandidates = techCandidates.filter(s => s.marketRegime === params.regimeFilter);
      if (params.icScoreMin !== undefined) techCandidates = techCandidates.filter(s => (s.icScore || 0) >= params.icScoreMin!);
      if (params.irScoreMin !== undefined) techCandidates = techCandidates.filter(s => (s.irScore || 0) >= params.irScoreMin!);

      // 消息面筛选（舆情/评级）
      if (params.sentiment || params.rating) {
        const rawCodes = techCandidates.map(s => {
          const sym = (s as any).symbol || '';
          return sym.replace(/^[a-z]+/, '').padStart(6, '0');
        });
        if (params.sentiment) {
          const sentimentMap = await fetchSentimentForCodes(rawCodes, params.sentiment);
          techCandidates = techCandidates.filter(s => {
            const sym = (s as any).symbol || '';
            const rawCode = sym.replace(/^[a-z]+/, '').padStart(6, '0');
            return sentimentMap.has(rawCode);
          });
        }
        if (params.rating) {
          const ratingMap = await fetchRatingForCodes(rawCodes, params.rating);
          techCandidates = techCandidates.filter(s => {
            const sym = (s as any).symbol || '';
            const rawCode = sym.replace(/^[a-z]+/, '').padStart(6, '0');
            return ratingMap.has(rawCode);
          });
        }
      }

      // ── 业界标准多因子评分 ─────────────────────────────────
      // 核心：所有因子跨截面百分位归一化后，再计算综合评分
      // 避免原始值量纲不统一的问题（金叉=1分 vs PE=8也有1分）
      if (params.scoreSort && techCandidates.length > 0) {
        // 获取 IC/IR 缓存权重（如果已做过因子分析）
        const cachedWeights = getCachedWeights();
        const weightOverrides: Record<string, number> = {};
        if (cachedWeights) {
          // 把 IC/IR 因子名映射到 screener 的 pct 因子名
          for (const w of cachedWeights.weights) {
            const screenerKey = IC_TO_SCREENER_KEY[w.factorName];
            if (screenerKey) {
              // 累加同一个 screener 因子对应多个 IC 因子的权重
              weightOverrides[screenerKey] = (weightOverrides[screenerKey] ?? 0) + w.weight;
            }
          }
          console.log('[ScreenerAPI] IC/IR weights applied:', JSON.stringify(weightOverrides));
        }

        // 1. 预计算全市场百分位因子（需要 klineMap 来算 RSI）
        preComputeFactorPercentiles(techCandidates, klineMap);

        // 2. 用百分位因子重新计算每个股票的评分
        for (const s of techCandidates) {
          const pct = (s as any)._pct;
          const minStock = s as unknown as ScreenerStock;
          const bd = scoreStock(minStock, {
            moneyFlowScore: s.moneyFlowScore,
            momentumScore: s.momentumScore,
            icScore: s.icScore,
            irScore: s.irScore,
            pct,
            weights: weightOverrides,
          });
          (s as any).scoreBreakdown = bd;
          (s as any).compositeScore = (s as any).score = bd.total;
        }

        techCandidates.sort((a, b) => ((b as any).score || 0) - ((a as any).score || 0));
      }
    }

    const resultStocks = needsTechFilter ? techCandidates : filtered;
    const total = resultStocks.length;

    // 排序（基本面模式下）
    if (!params.scoreSort && params.sortBy) {
      const order = params.sortOrder === 'asc' ? 1 : -1;
      resultStocks.sort((a, b) => {
        const getVal = (s: StockRaw | ScreenerStock | CandidateStock, field: string) => {
          if (field === 'price') return parseFloat((s as any).trade || (s as any).price || '0');
          if (field === 'changePercent') return parseFloat((s as any).changepercent || (s as any).changePercent || '0');
          if (field === 'pe') { const v = parseFloat((s as any).pe || '-1'); return v < 0 ? 99999 : v; }
          if (field === 'pb') { const v = parseFloat((s as any).pb || '-1'); return v < 0 ? 99999 : v; }
          if (field === 'marketCap') return parseFloat((s as any).mktcap || (s as any).marketCap || '0');
          if (field === 'turnover') return parseFloat((s as any).turnoverratio || (s as any).turnoverRate || '0');
          if (field === 'volume') return parseFloat((s as any).volume || '0');
          if (field === 'amount') return parseFloat((s as any).amount || '0');
          if (field === 'mainNetInflow') return (s as any).mainNetInflow || 0;
          if (field === 'name') return ((s as any).name || '').localeCompare((b as any).name || '');
          // 新增排序字段
          if (field === 'moneyFlowScore') return (s as any).moneyFlowScore || 0;
          if (field === 'momentumScore') return (s as any).momentumScore || 0;
          if (field === 'momentum20') return (s as any).momentum20 || 0;
          if (field === 'volumeRatio') return (s as any).volumeRatio || 0;
          if (field === 'icScore') return (s as any).icScore || 0;
          if (field === 'irScore') return (s as any).irScore || 0;
          if (field === 'compositeScore') return (s as any).compositeScore || 0;
          if (field === 'marketRegime') return ((s as any).marketRegime || '').localeCompare((b as any).marketRegime || '');
          return 0;
        };
        return (getVal(a, params.sortBy!) - getVal(b, params.sortBy!)) * order;
      });
    }

    const offset = params.offset || 0;
    const limit = params.limit || 50;
    const paged = resultStocks.slice(offset, offset + limit);

    // 构建 code -> techSignals 的映射（从原始 techCandidates 中提取）
    const techMap = new Map<string, TechSignals & {
      score?: number;
      moneyFlowScore?: number;
      mainNetInflow?: number;
      mainNetInflowRatio?: number;
      volumeRatio?: number;
      momentum5?: number;
      momentum20?: number;
      momentumScore?: number;
      marketRegime?: MarketRegime;
      regimeConfidence?: number;
      icScore?: number;
      irScore?: number;
      compositeScore?: number;
      scoreBreakdown?: ScoreBreakdown;
    }>();
    if (needsTechFilter) {
      for (const tc of techCandidates) {
        if (!techMap.has(tc.code)) {
          techMap.set(tc.code, {
            macdSignal: tc.macdSignal,
            kdjSignal: tc.kdjSignal,
            maSignal: tc.maSignal,
            bollSignal: tc.bollSignal,
            score: tc.score,
            moneyFlowScore: tc.moneyFlowScore,
            // P1-4 修复：补全 mainNetInflow 字段透传给前端
            mainNetInflow: tc.mainNetInflow,
            mainNetInflowRatio: tc.mainNetInflowRatio,
            volumeRatio: tc.volumeRatio,
            momentum5: tc.momentum5,
            momentum20: tc.momentum20,
            momentumScore: tc.momentumScore,
            marketRegime: tc.marketRegime,
            regimeConfidence: tc.regimeConfidence,
            icScore: tc.icScore,
            irScore: tc.irScore,
            compositeScore: tc.compositeScore,
            scoreBreakdown: (tc as any).scoreBreakdown,
          });
        }
      }
    }

    // 转换时补充所有指标
    const stocks = paged.map((s: StockRaw | CandidateStock) => {
      const st = toScreenerStock(s as StockRaw);
      if (needsTechFilter) {
        const signals = techMap.get(st.code);
        if (signals) {
          st.macdSignal = signals.macdSignal;
          st.kdjSignal = signals.kdjSignal;
          st.maSignal = signals.maSignal;
          st.bollSignal = signals.bollSignal;
          st.score = signals.score;
          st.moneyFlowScore = signals.moneyFlowScore;
          // P1-4 修复：补全 mainNetInflow 字段透传给前端
          st.mainNetInflow = signals.mainNetInflow ?? st.mainNetInflow;
          st.mainNetInflowRatio = signals.mainNetInflowRatio;
          st.volumeRatio = signals.volumeRatio;
          st.momentum5 = signals.momentum5;
          st.momentum20 = signals.momentum20;
          st.momentumScore = signals.momentumScore;
          st.marketRegime = signals.marketRegime;
          st.regimeConfidence = signals.regimeConfidence;
          st.icScore = signals.icScore;
          st.irScore = signals.irScore;
          st.compositeScore = signals.compositeScore;
          (st as any).scoreBreakdown = signals.scoreBreakdown;
        }
      }
      return st;
    });

    return NextResponse.json({
      stocks, total,
      template: params.template || 'custom',
      filters: summary,
      page: Math.floor((params.offset || 0) / (params.limit || 50)) + 1,
      pageSize: params.limit,
      hasTechFilter: needsTechFilter,
      marketRegime: globalRegimeResult.regime,
      regimeConfidence: globalRegimeResult.confidence,
      success: true,
    });
  } catch (error) {
    console.error('[ScreenerAPI]', error);
    return NextResponse.json({ error: 'Screener failed', success: false }, { status: 500 });
  }
}
