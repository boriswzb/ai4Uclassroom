/**
 * Factor v2 — 单只股票的 11 类因子计算
 *
 * 11 类因子：
 * 0. 行情元信息（code, name, price, mktcap, industry）
 * 1. 估值（pe, pb, ps）
 * 2. 质量（roe, grossMargin, debtRatio, eps）
 * 3. 动量（mom5/10/20/60）
 * 4. 反转（rsi14, cci14, bias20）
 * 5. 资金流（mainNetInflow5d/20d, ratio, volumeRatio, turnoverRate）
 * 6. 技术（macdHist, kdjK, kdjD, bollPosition, adx, lowVolatility）
 * 7. 流动性（avgAmount20d）
 * 8. WorldQuant 10 alpha
 *
 * 数据源依赖：
 * - 行情：东方财富 push2.eastmoney.com（已有 stockDataCache）
 * - 财务：东方财富 datacenter.eastmoney.com 财务数据
 * - 资金流：real-moneyflow.ts（接东财）
 * - K 线：已有 /api/stock/kline
 */

import type { KBar } from '@/lib/quant/types';
import { SMA, EMA, ATR, ADX, RSI, BollingerBands, MFI, WilliamsR, Bias, MACD, KDJ } from '@/lib/quant/strategies/indicators';
import type { FactorRawValues, BarLite } from './types';
import { computeWQAlphas } from './alphas';
import { fetchMainNetInflow, estimateMoneyFlowFromKBars, type RealMoneyFlow } from './real-moneyflow';
import { getIndustry } from '../../industry-map';

// ── 技术指标（单只）──────────────────────────────────
function computeTechnical(kbars: KBar[]): {
  momentum5: number; momentum10: number; momentum20: number; momentum60: number; momentum120: number;
  rsi14: number; cci14: number; bias20: number;
  macdHist: number; kdjK: number; kdjD: number;
  bollPosition: number; adx: number; lowVolatility: number;
} {
  const empty = {
    momentum5: 0, momentum10: 0, momentum20: 0, momentum60: 0, momentum120: 0,
    rsi14: 50, cci14: 0, bias20: 0,
    macdHist: 0, kdjK: 50, kdjD: 50,
    bollPosition: 0.5, adx: 0, lowVolatility: 0,
  };
  if (!kbars || kbars.length < 30) return empty;

  const c = kbars.map(k => k.close);
  const i = c.length - 1;
  const last = c[i];

  // ── 动量 ──
  const mom = (n: number) => i > n ? (last - c[i - n]) / Math.max(c[i - n], 0.01) : 0;

  // ── RSI ──
  const rsiArr = RSI(c, 14);
  const rsi14 = rsiArr[rsiArr.length - 1] ?? 50;

  // ── CCI（手工计算，避免依赖未导入的 CCI 库）──
  // CCI = (TP - SMA(TP, n)) / (0.015 × MAD)
  const n = 14;
  const tp = c.map((v, k) => (v + kbars[k].high + kbars[k].low) / 3);
  const tpSlice = tp.slice(-n);
  const tpMean = tpSlice.reduce((a, b) => a + b, 0) / n;
  const tpMad = tpSlice.reduce((a, b) => a + Math.abs(b - tpMean), 0) / n;
  const cci14 = tpMad > 0 ? (tp[tp.length - 1] - tpMean) / (0.015 * tpMad) : 0;

  // ── Bias ──
  const biasArr = Bias(c, 20);
  const bias20 = biasArr[biasArr.length - 1] ?? 0;

  // ── MACD ──
  const macd = MACD(c);
  const macdHist = macd.histogram[macd.histogram.length - 1] ?? 0;

  // ── KDJ ──
  const kdj = KDJ(kbars.map(k => k.high), kbars.map(k => k.low), c);
  const kdjK = kdj.k[KDJ.length === 0 ? 0 : kdj.k.length - 1] ?? 50;
  const kdjD = kdj.d[KDJ.length === 0 ? 0 : kdj.d.length - 1] ?? 50;

  // ── Boll ──
  const boll = BollingerBands(c, 20);
  const upper = boll.upper[boll.upper.length - 1] ?? last;
  const lower = boll.lower[boll.lower.length - 1] ?? last;
  const bollPosition = upper > lower ? (last - lower) / (upper - lower) : 0.5;

  // ── ADX ──
  const adxRes = ADX(kbars.map(k => k.high), kbars.map(k => k.low), c, 14);
  const adx = adxRes.adx[adxRes.adx.length - 1] ?? 0;

  // ── 低波动率（ATR/close）──
  const atr = ATR(kbars.map(k => k.high), kbars.map(k => k.low), c, 14);
  const atrLast = atr[atr.length - 1] ?? 0;
  const lowVolatility = last > 0 ? atrLast / last : 0;

  return {
    momentum5: mom(5),
    momentum10: mom(10),
    momentum20: mom(20),
    momentum60: mom(60),
    momentum120: mom(120),  // v2.1.1：长动量 120 日
    rsi14: isNaN(rsi14) ? 50 : rsi14,
    cci14: isNaN(cci14) ? 0 : cci14,
    bias20: isNaN(bias20) ? 0 : bias20,
    macdHist: isNaN(macdHist) ? 0 : macdHist,
    kdjK: isNaN(kdjK) ? 50 : kdjK,
    kdjD: isNaN(kdjD) ? 50 : kdjD,
    bollPosition: Math.max(0, Math.min(1, bollPosition)),
    adx: isNaN(adx) ? 0 : adx,
    lowVolatility,
  };
}

// ── 财务数据（接东财 datacenter）────────────────────
interface FinancialData {
  pe: number; pb: number; ps: number;
  roe: number; grossMargin: number; debtRatio: number; eps: number;
  marketCap: number; floatMarketCap: number;
  industry: string;
  // v2.1.1（2026-06-15）：Sloan Accruals 盈余质量因子
  //   学术定义：(ΔCA - ΔCash - ΔCL - 折旧) / TA
  //   A 股实现：OCF/NI（经营现金流 / 净利润）作为代理
  //   OCF/NI > 1 表示利润是真金白银（高质量）；< 0.5 表示大量应收账款（低质量）
  //   业界证据（Sloan 1996）：低 Accruals 股票年化超额收益 ~6-10%
  operatingCashFlow: number;  // 经营性现金流（元）
  netProfit: number;           // 净利润（元）
}

/**
 * 拉财务数据（一次拿全）
 * 来源：东方财富数据中心（公开接口）
 * 包含 PE_TTM / PB / PS / ROE / 毛利率 / 资产负债率 / 市值 / 行业
 */
export async function fetchFinancials(code: string): Promise<FinancialData> {
  // secid 转换
  const [num, suffix] = code.split('.');
  const secid = suffix === 'SH' ? '1' : '0';

  const defaults: FinancialData = {
    pe: 0, pb: 0, ps: 0,
    roe: 0, grossMargin: 0, debtRatio: 50, eps: 0,
    marketCap: 0, floatMarketCap: 0,
    industry: '',
    operatingCashFlow: 0,  // v2.1.1
    netProfit: 0,           // v2.1.1
  };

  try {
    // 实时行情 + 财务数据（单接口拿全）
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}.${num}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f114,f115,f116,f117,f162,f167,f168,f169,f170,f171,f173,f191,f192&invt=2&fltt=2`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://quote.eastmoney.com/',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return defaults;
    const json = await res.json();
    if (!json.data) return defaults;
    const d = json.data;
    // f43=最新价, f44=最高, f45=最低, f46=今开, f47=成交量(手), f48=成交额
    // f57=股票代码, f58=股票名称, f60=昨收
    // f114=市净率, f115=总市值, f116=流通市值
    // f117=涨速, f162=市盈率TTM, f167=市销率TTM
    // f168=换手率, f169=涨跌额, f170=涨跌幅
    // f171=振幅, f173=ROE, f191=委比, f192=量比

    // 注意：以上字段在 push2 接口中不全部可用
    // 实际从 push2his 接口拿财务数据更稳（见 fetchFinancialsFromHis）
    return fetchFinancialsFromHis(code, defaults);
  } catch {
    return fetchFinancialsFromHis(code, defaults);
  }
}

/**
 * 财务数据 from 东财 datacenter
 * 路径：RPT_F10_FINANCE_MAINFINADATA
 * 接口：https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&...
 *
 * 历史（已弃用）：原 emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/MainTargetAjax
 *   在服务端 100% 返回 302 重定向到登录页 → 所有股票 roe=0/grossMargin=0/debtRatio=50 defaults
 *   → percentile 全等 → OLS 残差灌水 → 推荐"全是 100"
 * 替换为 datacenter.eastmoney.com v1 接口（API 风格，不走页面 cookie 鉴权）
 * 一次拿全：ROE/毛利率/负债率/EPS/BPS/每股净资产/股本等
 */
async function fetchFinancialsFromHis(code: string, defaults: FinancialData): Promise<FinancialData> {
  const [num, suffix] = code.split('.');
  // SECUCODE 格式：600519.SH（带后缀），用于 datacenter 接口
  const secucode = `${num}.${suffix}`;

  // 主源：datacenter.eastmoney.com
  const url = `https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL&filter=(SECUCODE%3D%22${secucode}%22)&client=PC&pageNumber=1&pageSize=1`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://emweb.securities.eastmoney.com/',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      // P1 修复（2026-06-15）：加日志，否则 100% 失败时 dev server 看不到原因
      console.warn(`[fetchFinancials] ${code} HTTP ${res.status} from datacenter, fallback to defaults`);
      return defaults;
    }
    const json = await res.json();
    if (!json?.result?.data || !Array.isArray(json.result.data) || json.result.data.length === 0) {
      console.warn(`[fetchFinancials] ${code} empty data from datacenter (success=${json?.success} msg=${json?.message}), fallback to defaults`);
      return defaults;
    }
    // data[0] = 最新报告期
    const latest = json.result.data[0];
    return {
      ...defaults,
      // ROE 字段：MAINFINADATA 用 ROEJQ（季报 ROE %），如茅台 10.57 = 10.57%
      roe: parseFloat(latest.ROEJQ || '0') || 0,
      // 销售毛利率（%）：XSMLL
      grossMargin: parseFloat(latest.XSMLL || '0') || 0,
      // 资产负债率（%）：ZCFZL，如茅台 12.12 = 12.12%
      debtRatio: parseFloat(latest.ZCFZL || '50') || 50,
      // 基本每股收益（元）：EPSJB
      eps: parseFloat(latest.EPSJB || '0') || 0,
      // v2.1.1（2026-06-15）：Sloan Accruals 盈余质量
      //   经营现金流（元）：JYJXJL（经营活动产生的现金流量净额）
      operatingCashFlow: parseFloat(latest.JYJXJL || '0') || 0,
      //   净利润（元）：净利润 JLR
      netProfit: parseFloat(latest.JLR || latest.NETPROFIT || '0') || 0,
    };
  } catch (e) {
    console.warn(`[fetchFinancials] ${code} fetch error: ${(e as Error).message}, fallback to defaults`);
    return defaults;
  }
}

// ── 主入口：组装 FactorRawValues ────────────────────
export interface ComputeFactorsInput {
  code: string;
  name: string;
  kbars: KBar[];
  realtime: {
    price: number;
    changePercent: number;
    marketCap: number;
    floatMarketCap: number;
    pe: number;
    pb: number;
    volumeRatio: number;
    turnoverRate: number;
  };
  realFlow?: RealMoneyFlow[];  // 真实东财主力净流入（可选）
}

/**
 * 单只股票 → FactorRawValues
 */
export async function computeFactors(input: ComputeFactorsInput): Promise<FactorRawValues> {
  const { code, name, kbars, realtime, realFlow } = input;

  // 1. 技术因子
  const tech = computeTechnical(kbars);

  // 2. 资金流：优先用东财真实数据，fallback 到 KBar 估算
  let mainNetInflow5d = 0, mainNetInflow20d = 0, mainNetInflowRatio = 0;
  if (realFlow && realFlow.length > 0) {
    mainNetInflow20d = realFlow.reduce((s, f) => s + f.mainNetInflow, 0);
    mainNetInflow5d = realFlow.slice(-5).reduce((s, f) => s + f.mainNetInflow, 0);
    mainNetInflowRatio = realFlow[realFlow.length - 1]?.mainNetInflowRatio ?? 0;
  } else {
    const fb = estimateMoneyFlowFromKBars(kbars);
    mainNetInflow5d = fb.flow5d;
    mainNetInflow20d = fb.flow20d;
    mainNetInflowRatio = fb.ratio;
  }

  // 3. 财务数据（异步，并发其他）
  const fin = await fetchFinancials(code);

  // v2.1.1（2026-06-15）：Sloan Accruals 盈余质量代理
  //   OCF/NI 缺失处理：
  //     - netProfit=0（亏损股）→ accrualsRatio = 1.0（中性，让 pct 排中位）
  //     - operatingCashFlow=0（接口失败）→ 同上
  //     - 负 netProfit + 正 OCF → 1.5（特殊情况：亏本但有现金）
  const accrualsRatio = fin.netProfit > 0 && fin.operatingCashFlow !== 0
    ? fin.operatingCashFlow / fin.netProfit
    : 1.0;

  // 4. 流动性（20 日均成交额）
  const avgAmount20d = kbars.length >= 20
    ? kbars.slice(-20).reduce((s, k) => s + (k.amount || 0), 0) / 20
    : 0;

  // 5. WorldQuant 10 alpha
  const wqAlphaScore = computeWQAlphas(kbars);

  // 6. 行业（v3.0.1 2026-06-15：用 industry-map.ts 静态映射，比 inferIndustryFromCode 更准）
  const industry = getIndustry(code);

  return {
    code, name,
    price: realtime.price,
    changePercent: realtime.changePercent,
    marketCap: realtime.marketCap || fin.marketCap,
    floatMarketCap: realtime.floatMarketCap || fin.floatMarketCap,
    industry: industry || fin.industry,

    pe: realtime.pe > 0 ? realtime.pe : fin.pe,
    pb: realtime.pb > 0 ? realtime.pb : fin.pb,
    ps: fin.ps,
    roe: fin.roe,
    grossMargin: fin.grossMargin,
    debtRatio: fin.debtRatio,
    eps: fin.eps,
    accrualsRatio,  // v2.1.1

    momentum5: tech.momentum5,
    momentum10: tech.momentum10,
    momentum20: tech.momentum20,
    momentum60: tech.momentum60,
    momentum120: tech.momentum120,  // v2.1.1：长动量

    rsi14: tech.rsi14,
    cci14: tech.cci14,
    bias20: tech.bias20,

    mainNetInflow5d,
    mainNetInflow20d,
    mainNetInflowRatio,
    volumeRatio: realtime.volumeRatio,
    turnoverRate: realtime.turnoverRate,

    macdHist: tech.macdHist,
    kdjK: tech.kdjK,
    kdjD: tech.kdjD,
    bollPosition: tech.bollPosition,
    adx: tech.adx,
    lowVolatility: tech.lowVolatility,

    avgAmount20d,

    wqAlphaScore,
  };
}

// ── 标志位检测（ST/涨跌停/停牌/低流动性）─────────────
export function detectFlags(c: FactorRawValues, todayKBar?: BarLite): {
  isST: boolean;
  isLimitUp: boolean;
  isLimitDown: boolean;
  isSuspended: boolean;
  isNewShare: boolean;
  isLowLiquidity: boolean;
} {
  // ST：名字含 ST
  const isST = /ST|退|暂停/.test(c.name);

  // 涨跌停：A 股主板 ±10%，创业板/科创板 ±20%
  // 用 changePercent 粗判
  const isLimitUp = c.changePercent >= 9.95;
  const isLimitDown = c.changePercent <= -9.95;

  // 停牌：价格不变且成交额 = 0
  const isSuspended = c.price === 0 || (c.avgAmount20d < 100);

  // 次新股：上市 < 60 日（用价格异常高 + 流通市值小粗判，精准需要 IPO 日期接口）
  const isNewShare = c.floatMarketCap > 0 && c.floatMarketCap < 1e9 && c.changePercent > 5;

  // 低流动性：20 日均成交额 < 1 亿
  const isLowLiquidity = c.avgAmount20d < 1e8;

  return { isST, isLimitUp, isLimitDown, isSuspended, isNewShare, isLowLiquidity };
}
