/**
 * Factor Analysis v2 API — 8 类因子 + 中性化 + 共线性 + IC 动态定权
 *
 * 与 v1 (/api/stock/factor-analysis) 并存，对比运行
 *
 * 流程：
 * 1. 拉全市场股票列表（东财）
 * 2. 批量拉 K 线
 * 3. 计算 11 类因子（含 10 个 WQ alpha + 真实主力净流入）
 * 4. 截面百分位归一化（MAD 去极值）
 * 5. 行业 + 市值中性化
 * 6. 共线性检测
 * 7. IC 动态定权（用近期 IC 推导）+ 失效检测
 * 8. 加权合成 8 大类评分
 * 9. 排序 + 标记 flags
 *
 * 缓存策略：
 * - 5 分钟结果级缓存
 * - 1 分钟股票列表缓存
 * - 5 分钟 K 线缓存
 */

import { NextRequest, NextResponse } from 'next/server';
import https from 'node:https';
import type { KBar } from '@/lib/quant/types';
import {
  computeFactors,
  type FactorRawValues,
  scoreV2,
  computeV1VsV2Compare,
  fetchMainNetInflowBatch,
  type V2ScoreOptions,
} from '@/lib/quant/factor/v2';

// ── HTTP 工具（同 v1） ─────────────────────────────
function httpGetRaw(url: string, timeout = 15000): Promise<Buffer> {
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
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

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

// ── 股票列表缓存 ──────────────────────────────────
interface StockRaw {
  symbol: string; name: string; trade: string; changepercent: string;
  volume: string; amount: string; pe: string; pb: string;
  mktcap: string; nmc: string; turnoverratio: string;
}
let stockCache: { stocks: StockRaw[]; timestamp: number } | null = null;
const STOCK_TTL = 60_000;

// ── Fallback：精简 A 股活跃股种子列表 ──────────────
// 选取逻辑：沪深 300 头部 + 创业板/科创板龙头 + 各行业代表
// 约 100 只；当 sina/eastmoney 全市场列表都不可用时，用这个保底让一键分析仍能跑
const STOCK_SEED_CODES: string[] = [
  // 沪市主板（50 只）
  '600519', '600000', '600036', '600276', '600887', '600030', '601318', '601398',
  '601857', '601988', '601288', '601628', '601319', '601336', '601012', '601888',
  '600900', '600028', '600050', '600104', '600196', '600438', '600585', '600690',
  '600837', '600703', '600745', '600460', '600406', '600886', '600188', '600547',
  '600489', '600362', '600183', '600660', '600600', '600009', '600271', '600588',
  '600845', '600271', '600436', '600763', '600893', '600918', '600958', '600999',
  '600011', '600023',
  // 深市主板（30 只）
  '000001', '000002', '000063', '000333', '000651', '000858', '000725', '000538',
  '000568', '000625', '000776', '000792', '000895', '000938', '000963', '000977',
  '000999', '002142', '002230', '002415', '002475', '002594', '002607', '002714',
  '002920', '002230', '300750', '300059', '300015', '300760',
  // 创业板（10 只）
  '300124', '300142', '300223', '300316', '300347', '300408', '300433', '300498',
  '300601', '300628',
  // 科创板（10 只）
  '688981', '688041', '688256', '688271', '688599', '688981', '688111', '688169',
  '688223', '688271',
];

// GBK 解码器（NodeJS 内置）
const GBK_DECODER = new TextDecoder('gbk', { fatal: false });

// ── Fallback：用腾讯 qt.gtimg 批量拉实时报价 ────────
// 响应格式：v_sh600519="1~名称(GBK)~代码~最新~昨收~今开~成交量(手)~...~时间戳~涨跌额~涨跌幅~最高~最低~价/量/额~成交量(手)~成交额(万)~换手率~PE动~...~振幅~流通市值~总市值~PB~...~";
// 实测字段索引（~分隔）：
//   [0] 状态 [1] 名称(GBK) [2] 代码 [3] 最新 [4] 昨收 [5] 今开 [6] 成交量(手)
//   [29] 买卖盘结束
//   [30] 时间戳(YYYYMMDDHHMMSS) [31] 涨跌额 [32] 涨跌幅(%) [33] 最高 [34] 最低
//   [35] 价格/成交量/成交额
//   [36] 成交量(手) [37] 成交额(万) [38] 换手率(%) [39] 市盈率(动)
//   [40..42] 占位
//   [43] 振幅(%) [44] 流通市值(亿) [45] 总市值(亿) [46] 市净率
//   [47..] 涨停价/跌停价/...
// rawLine 是 GBK 编码的原始 bytes（Buffer）
function parseTencentQuote(rawLine: Buffer): StockRaw | null {
  // 整行作为 latin1 安全切分（数字 + ASCII 标点），utf-8 解码会因 GBK 字节失败
  const text = rawLine.toString('latin1');
  // 锚点：v_xxxx="..."（响应末尾是 ";\n 不是单独 "）
  const m = text.match(/^v_(\w+)="(.*?)"[\s;]*$/);
  if (!m) return null;
  const symWithPrefix = m[1];
  const num = symWithPrefix.replace(/^[a-z]+/i, '');
  if (!num || num.length < 6) return null;
  // m[2] 内容：状态~名称(GBK)~代码~...~"  整段
  // m[2].split('~')[0] = "状态"  [1] = "名称(GBK bytes in latin1)"  [2] = 代码
  // 用 latin1 切 ~，fields[1] 是名称的 GBK bytes 当 latin1 字符串，再 GBK 解码
  const fields = m[2].split('~');
  const name = fields[1] ? GBK_DECODER.decode(Buffer.from(fields[1], 'latin1')) : '';
  return {
    symbol: num,  // 关键：保持纯 6 位数字，下游用 startsWith('6') 推断后缀
    name,
    trade: fields[3] || '0',
    changepercent: fields[32] || '0',
    volume: fields[36] || '0',
    amount: fields[37] || '0',
    turnoverratio: fields[38] || '0',
    pe: fields[39] || '-1',
    pb: fields[46] || '-1',
    mktcap: fields[45] || '0',
    nmc: fields[44] || '0',  // 流通市值
  };
}

async function getAllStocksViaTencent(): Promise<StockRaw[]> {
  const BATCH = 80;
  const codes = Array.from(new Set(STOCK_SEED_CODES)).slice(0, 120);  // 限 120 只
  const allStocks: StockRaw[] = [];
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i + BATCH);
    const symList = batch.map(c => (c.startsWith('6') || c.startsWith('5') ? 'sh' : c.startsWith('0') || c.startsWith('3') ? 'sz' : 'bj') + c);
    const url = `https://qt.gtimg.cn/q=${symList.join(',')}`;
    try {
      const rawBuf = await httpGetRaw(url);
      // qt.gtimg 响应是 GBK 编码，每行以 \n 结尾
      const lines: Buffer[] = [];
      let start = 0;
      for (let j = 0; j < rawBuf.length; j++) {
        if (rawBuf[j] === 0x0A) {  // \n
          if (j > start) lines.push(rawBuf.subarray(start, j));
          start = j + 1;
        }
      }
      if (start < rawBuf.length) lines.push(rawBuf.subarray(start));
      for (const lineBuf of lines) {
        const stock = parseTencentQuote(lineBuf);
        if (stock) allStocks.push(stock);
      }
    } catch (e) {
      console.error('[V2-Stocks-Tencent] batch failed:', (e as Error).message);
    }
  }
  console.log(`[V2-Stocks-Tencent] fetched ${allStocks.length} stocks via qt.gtimg`);
  return allStocks;
}

async function getAllStocks(): Promise<StockRaw[]> {
  if (stockCache && Date.now() - stockCache.timestamp < STOCK_TTL) return stockCache.stocks;
  const allStocks: StockRaw[] = [];
  const pages = 52, pageSize = 100;
  for (let page = 1; page <= pages; page++) {
    try {
      const url = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=${pageSize}&sort=changepercent&asc=0&node=sh_a&symbol=&_s_r_a=page`;
      const text = await httpGet(url);
      const data = JSON.parse(text);
      if (!Array.isArray(data)) continue;
      for (const item of data) {
        allStocks.push({
          symbol: item.symbol || '',
          name: item.name || '',
          trade: item.trade || '0',
          changepercent: item.changepercent || '0',
          volume: item.volume || '0',
          amount: item.amount || '0',
          pe: item.per || '-1',
          pb: item.pb || '-1',
          mktcap: item.mktcap || '0',
          nmc: item.nmc || '0',
          turnoverratio: item.turnoverratio || '0',
        });
      }
    } catch (e) { /* skip */ }
  }
  // 加深圳列表
  for (let page = 1; page <= 52; page++) {
    try {
      const url = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=${pageSize}&sort=changepercent&asc=0&node=sz_a&symbol=&_s_r_a=page`;
      const text = await httpGet(url);
      const data = JSON.parse(text);
      if (!Array.isArray(data)) continue;
      for (const item of data) {
        allStocks.push({
          symbol: item.symbol || '',
          name: item.name || '',
          trade: item.trade || '0',
          changepercent: item.changepercent || '0',
          volume: item.volume || '0',
          amount: item.amount || '0',
          pe: item.per || '-1',
          pb: item.pb || '-1',
          mktcap: item.mktcap || '0',
          nmc: item.nmc || '0',
          turnoverratio: item.turnoverratio || '0',
        });
      }
    } catch (e) { /* skip */ }
  }

  // Fallback：sina 拿不到时（HTML 拦截/IP 黑名单），用腾讯 qt.gtimg 拉精简种子列表
  if (allStocks.length < 50) {
    console.log(`[V2-Stocks] sina returned ${allStocks.length} stocks, fallback to tencent qt.gtimg`);
    const tencentStocks = await getAllStocksViaTencent();
    if (tencentStocks.length > 0) {
      // 用 tencent 替换
      stockCache = { stocks: tencentStocks, timestamp: Date.now() };
      return tencentStocks;
    }
  }

  stockCache = { stocks: allStocks, timestamp: Date.now() };
  return allStocks;
}

// ── K 线缓存 ─────────────────────────────────────
let klineCache: Map<string, { bars: KBar[]; ts: number }> = new Map();
const KLINE_TTL = 300_000;

async function getKlinesBatch(codes: string[], count = 200): Promise<Map<string, KBar[]>> {
  const result = new Map<string, KBar[]>();
  const now = Date.now();
  const toFetch: string[] = [];
  for (const c of codes) {
    const cached = klineCache.get(c);
    // 缓存命中条件：bar 数 >= 30 + amount 有效（避免旧缓存全是 0）
    if (cached && now - cached.ts < KLINE_TTL && cached.bars.length >= 30 && cached.bars.some(b => b.amount > 0)) {
      result.set(c, cached.bars);
    } else {
      toFetch.push(c);
    }
  }
  if (toFetch.length === 0) return result;

  // 腾讯 K 线接口（首选日线，休市时降级到周线/月线）
  const BATCH = 30;
  let firstErrorSample = '';  // 记录第一次失败的真实响应，帮助诊断
  for (let i = 0; i < toFetch.length; i += BATCH) {
    const batch = toFetch.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(async (code): Promise<[string, KBar[]]> => {
        const num = code.replace(/\D/g, '');
        const suffix = code.endsWith('.SH') ? 'sh' : code.endsWith('.SZ') ? 'sz' : 'bj';
        const qqCode = `${suffix}${num}`;
        const sinaCode = code.endsWith('.SH') ? `sh${num}` : `sz${num}`;

        // 数据源 0：sina 日线（最稳定 — 休市日也返回完整历史数据，且包含 ma_price 字段）
        try {
          const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaCode}&scale=240&datalen=${count}`;
          const text = await httpGet(url);
          const bars = parseSinaKline(text, code);
          if (bars.length >= 20) {
            klineCache.set(code, { bars, ts: Date.now() });
            return [code, bars];
          }
          if (!firstErrorSample && text && text.length > 0) {
            firstErrorSample = `[sina day scale=240] textLen=${text.length} head=${text.slice(0, 200)}`;
          }
        } catch (e: any) {
          if (!firstErrorSample) {
            firstErrorSample = `[sina day scale=240] error: ${e?.message || String(e)}`;
          }
        }

        // 数据源 1：腾讯 K 线（4 周期链：日 → 周 → 月）
        const periods: Array<{ name: string; key: 'day' | 'week' | 'month' | 'qfqday' | 'qfqweek' | 'qfqmonth'; url: string }> = [
          { name: 'day', key: 'day', url: `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?_var=kline_day&param=${qqCode},day,,,${count}` },
          { name: 'qfqday', key: 'qfqday', url: `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?_var=kline_dayqfq&param=${qqCode},day,,,${count},qfq` },
          { name: 'week', key: 'week', url: `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?_var=kline_week&param=${qqCode},week,,,${Math.max(count, 60)}` },
          { name: 'month', key: 'month', url: `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?_var=kline_month&param=${qqCode},month,,,${Math.max(count, 36)}` },
        ];
        for (const p of periods) {
          try {
            const text = await httpGet(p.url);
            const bars = parseIfzqKline(text, qqCode, p.key);
            if (bars.length >= 20) {  // 周线/日线都放低阈值到 20
              klineCache.set(code, { bars, ts: Date.now() });
              return [code, bars];
            }
            // 记录第一次响应样本
            if (!firstErrorSample && text && text.length > 0) {
              firstErrorSample = `[tencent period=${p.name}] textLen=${text.length} day=${(text.match(/"day":\[/) ? 'present' : 'empty')} head=${text.slice(0, 200)}`;
            }
          } catch (e: any) {
            if (!firstErrorSample) {
              firstErrorSample = `[tencent period=${p.name}] error: ${e?.message || String(e)}`;
            }
          }
        }
        return [code, []];
      })
    );
    for (const [code, bars] of batchResults) {
      if (bars.length > 0) result.set(code, bars);
    }
  }
  // 第一次跑且所有 K 线都失败时，打印一次样本（让 dev server 日志能看到真实响应）
  if (result.size === 0 && toFetch.length > 0 && firstErrorSample) {
    console.warn(`[V2-Kline] all ${toFetch.length} kline fetches failed across sina+tencent. Sample: ${firstErrorSample.slice(0, 400)}`);
  }
  return result;
}

// 解析 sina 日 K 线（scale=240）响应
// 格式：[{"day":"2026-06-08","open":"1272.000","high":"1278.000","low":"1260.000","close":"1262.980","volume":"3082836",...}, ...]
// 注意：sina 没有成交额字段，要用 volume × close 估算（元）
function parseSinaKline(text: string, code: string): KBar[] {
  if (!text || text.length < 2) return [];
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(json) || json.length === 0) return [];
  return json.map((bar: any) => {
    const close = parseFloat(bar.close) || 0;
    // sina volume 单位：股（不是手），不需要 × 100
    const volumeShares = parseFloat(bar.volume) || 0;
    return {
      code,
      timestamp: new Date(bar.day).getTime(),
      open: parseFloat(bar.open) || 0,
      high: parseFloat(bar.high) || 0,
      low: parseFloat(bar.low) || 0,
      close,
      volume: volumeShares / 100,  // 转成"手"以和腾讯数据源保持一致
      amount: volumeShares * close,  // 成交额 = 成交量(股) × 收盘价（元）
    };
  });
}

// 解析 ifzq gtimg K 线响应文本 → KBar[]
// 响应格式：var kline_day={"code":1,"data":{"sh600519":{"day":[["2024-01-02","169.50",...],...],...}}}
// 休市时 day 数组为空 → 自动回退到 qfqday / week / month（由 caller 决定周期链）
function parseIfzqKline(text: string, qqCode: string, preferKey: 'day' | 'week' | 'month' | 'qfqday' | 'qfqweek' | 'qfqmonth' = 'day'): KBar[] {
  if (!text) return [];
  // 多种响应格式兼容：
  // 1. "var kline_day={...}" — 带 var 前缀
  // 2. "{...}" — 纯 JSON
  let jsonStr = text;
  const eqIdx = text.indexOf('=');
  if (eqIdx >= 0) jsonStr = text.slice(eqIdx + 1).trim();
  let json: any;
  try {
    json = JSON.parse(jsonStr);
  } catch {
    return [];
  }
  const stockData = json?.data?.[qqCode] || {};
  // 优先级：preferKey → 其它备选
  const order = [preferKey, 'day', 'qfqday', 'week', 'qfqweek', 'month', 'qfqmonth'];
  let dayArr: any[] = [];
  for (const k of order) {
    if (Array.isArray(stockData[k]) && stockData[k].length > 0) {
      dayArr = stockData[k];
      break;
    }
  }
  return (dayArr as string[][]).map((bar: string[]) => {
    const close = parseFloat(bar[2]) || 0;
    const volumeHand = parseFloat(bar[5]) || 0;
    return {
      code: qqCode,
      timestamp: new Date(bar[0]).getTime(),
      open: parseFloat(bar[1]) || 0,
      high: parseFloat(bar[3]) || 0,
      low: parseFloat(bar[4]) || 0,
      close,
      volume: volumeHand,
      amount: volumeHand * 100 * close,
    };
  });
}

// ── 结果级缓存 ──────────────────────────────────
interface ResultCacheEntry { data: any; ts: number }
const RESULT_TTL = 5 * 60_000;
const resultCache: Map<string, ResultCacheEntry> = new Map();
const RESULT_CACHE_MAX = 32;

function getResultCacheKey(opts: any): string {
  return JSON.stringify(opts);
}

function getCachedResult(key: string): any | null {
  const entry = resultCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > RESULT_TTL) {
    resultCache.delete(key);
    return null;
  }
  resultCache.delete(key);
  resultCache.set(key, entry);
  return entry.data;
}

function setCachedResult(key: string, data: any): void {
  if (resultCache.size >= RESULT_CACHE_MAX) {
    const firstKey = resultCache.keys().next().value;
    if (firstKey) resultCache.delete(firstKey);
  }
  resultCache.set(key, { data, ts: Date.now() });
}

// ── 真实资金流缓存 ────────────────────────────────
let flowCache: { data: Map<string, any[]>; ts: number } | null = null;
const FLOW_TTL = 5 * 60_000;

// ── API 入口 ─────────────────────────────────────
export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'scores';
  const limit = parseInt(searchParams.get('limit') || '80');
  const forwardPeriod = (parseInt(searchParams.get('forwardPeriod') || '5') === 20 ? 20 : 5) as 5 | 20;
  const filterFlags = searchParams.get('filterFlags') !== 'false';
  const neutralize = searchParams.get('neutralize') !== 'manual';  // 手动 = false
  const weightMode = (searchParams.get('weightMode') || 'default') as 'default' | 'ic' | 'manual';
  const noCache = searchParams.get('nocache') === '1';
  const icHistory = searchParams.get('icHistory') || '0';  // '0' 简易 / '1' 严谨（用已实现收益）

  // 缓存命中（nocache=1 强制重跑；空结果（results=[]）永远不缓存，避免污染 5 分钟窗口）
  const cacheKey = getResultCacheKey({ action, limit, forwardPeriod, filterFlags, weightMode, icHistory });
  const cached = !noCache ? getCachedResult(cacheKey) : null;
  if (cached) {
    return NextResponse.json({ ...cached, _cache: 'hit', _ms: Date.now() - t0 });
  }

  try {
    // 1. 拉全市场股票
    const allStocks = await getAllStocks();
    if (allStocks.length === 0) {
      return NextResponse.json({ success: false, error: '股票列表拉取失败' }, { status: 500 });
    }

    // 2. 转 code（统一加 .SH/.SZ/.BJ 后缀）
    // 修复：sina symbol 格式是 'sh688507' / 'sz000001' / 'bj430017'（带 sh/sz/bj 前缀）
    // 必须先去掉前缀再用 startsWith('6') 等判断数字开头
    // 之前用 s.symbol.startsWith('6') 在 'sh688507' 上永远 false → 全部 fallback 到 .BJ
    // 导致 sina 拉 K 线时拼成 bj688507 / bj833454 → sina 不支持这些代码 → 返回 null
    const codeMap = new Map<string, StockRaw>();
    for (const s of allStocks) {
      // 去掉 sh/sz/bj/bj 前缀（兼容大写 SH/SZ/BJ）
      const numPart = s.symbol.replace(/^[a-z]+/i, '').padStart(6, '0');
      const suffix = numPart.startsWith('6') || numPart.startsWith('5') ? '.SH'
        : numPart.startsWith('0') || numPart.startsWith('3') || numPart.startsWith('1') ? '.SZ'
          : '.BJ';
      const code = numPart + suffix;
      codeMap.set(code, s);
    }
    const codes = Array.from(codeMap.keys());

    // 3. 批量拉 K 线（用 limit 控制规模，避免 dev server OOM）
    // 修复：原 500 只 × 200 根 = 100,000 根 KBar 在 V8 默认 4GB 堆下会 OOM
    // 限制为 limit*3 只（前端 limit=80 → 240 只），count 降为 100
    const targetCodes = codes.slice(0, Math.min(limit * 3, 300));
    const klines = await getKlinesBatch(targetCodes, 100);

    // 4. 拉真实主力净流入（批量）
    let flowData: Map<string, any[]> = new Map();
    if (flowCache && Date.now() - flowCache.ts < FLOW_TTL) {
      flowData = flowCache.data;
    } else {
      flowData = await fetchMainNetInflowBatch(targetCodes, 30);
      flowCache = { data: flowData, ts: Date.now() };
    }

    // 5. 计算 11 类因子（并发）
    const CONCURRENCY = 8;
    const candidates: FactorRawValues[] = [];
    // 诊断：分阶段统计，帮助定位"K线拉取全失败 vs 股票列表空 vs K线<30根"
    let klineSuccessCount = 0;  // 成功拉到 ≥1 根 K 线的股票数
    let klineEmptyCount = 0;   // 拉到 0 根 K 线的股票数（fetch 失败或返回空）
    let klineShortCount = 0;   // 拉到 <30 根 K 线的股票数（数据不足）
    for (let i = 0; i < targetCodes.length; i += CONCURRENCY) {
      const batch = targetCodes.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async code => {
          const stock = codeMap.get(code);
          const kbars = klines.get(code);
          if (!stock) return null;
          if (!kbars || kbars.length === 0) { klineEmptyCount++; return null; }
          if (kbars.length < 30) { klineShortCount++; return null; }
          klineSuccessCount++;
          try {
            const changePct = parseFloat(stock.changepercent) || 0;
            return await computeFactors({
              code,
              name: stock.name,
              kbars,
              realtime: {
                price: parseFloat(stock.trade) || 0,
                changePercent: changePct,
                marketCap: parseFloat(stock.mktcap) * 1e8 || 0,  // 东财单位是亿元
                floatMarketCap: parseFloat(stock.nmc) * 1e8 || 0,
                pe: parseFloat(stock.pe) || 0,
                pb: parseFloat(stock.pb) || 0,
                volumeRatio: 1,
                turnoverRate: parseFloat(stock.turnoverratio) || 0,
              },
              realFlow: flowData.get(code),
            });
          } catch (e) {
            return null;
          }
        })
      );
      for (const r of results) if (r) candidates.push(r);
    }

    if (candidates.length === 0) {
      // 不再 500 抛错：返回 success 但 results 空 + 精准诊断
      console.warn(`[V2] no valid candidates: totalCodes=${targetCodes.length}, allStocks=${allStocks.length}, klineSuccess=${klineSuccessCount}, klineEmpty=${klineEmptyCount}, klineShort=${klineShortCount}`);
      const response = {
        success: true,
        version: 'v2',
        action,
        count: 0,
        results: [],
        diagnostics: {
          warning: '无有效候选股票',
          allStocksCount: allStocks.length,
          targetCodesCount: targetCodes.length,
          klineSuccessCount,
          klineEmptyCount,
          klineShortCount,
          // 友好分类提示
          detail: allStocks.length === 0
            ? '股票列表为空（sina + tencent fallback 都失败）'
            : klineEmptyCount > 0 && klineEmptyCount >= klineSuccessCount
            ? `K线拉取全失败（${klineEmptyCount}/${targetCodes.length} 只返回空）— 可能是腾讯服务器限流/IP 黑名单`
            : klineShortCount > targetCodes.length * 0.8
            ? `K线数据普遍不足（${klineShortCount}/${targetCodes.length} 只<30根）— 新股/次新股太多或K线源返回截断`
            : '未知原因，看 dev server 日志',
        },
        timestamp: Date.now(),
      };
      // ⚠️ 空结果不写 cache：避免连续 5 分钟都返回空（数据源临时挂的时候污染用户）
      return NextResponse.json({ ...response, _cache: 'miss', _ms: Date.now() - t0 });
    }

    // 6. 跑 v2 + v1 对比
    const options: V2ScoreOptions = {
      forwardPeriod,
      neutralize: { industry: neutralize, marketCap: neutralize },
      weightMode,
      filterFlags,
    };

    if (action === 'compare') {
      const compare = computeV1VsV2Compare(candidates, options);
      const response = {
        success: true,
        version: 'v2',
        action: 'compare',
        count: candidates.length,
        compare,
        timestamp: Date.now(),
      };
      setCachedResult(cacheKey, response);
      return NextResponse.json({ ...response, _cache: 'miss', _ms: Date.now() - t0 });
    }

    // 7. 跑 v2 评分
    const v2Out = scoreV2({ candidates, options });
    const topResults = v2Out.results.slice(0, limit);

    // 7.5 IC 统计
    // 默认：简易 IC（当前 raw 值 vs 当日 changePercent）—— 单截面
    // icHistory=1：严谨 IC（当前 raw 值 vs 过去 forwardPeriod 日累计收益）—— 已知实现收益
    // 注意：因 IDB 不存历史 raw 因子时序，无法算"每日截面的历史 IC 时间序列"
    // 这里的"严谨版"用"已实现收益"代替下期收益，更接近 backtest 视角
    const icStats = computeSimpleIC(candidates, { useBacktestReturn: icHistory === '1' });

    const response = {
      success: true,
      version: 'v2',
      action,
      count: candidates.length,
      results: topResults,
      diagnostics: { ...v2Out.diagnostics, icStats },
      timestamp: Date.now(),
    };
    setCachedResult(cacheKey, response);
    return NextResponse.json({ ...response, _cache: 'miss', _ms: Date.now() - t0 });
  } catch (e: any) {
    console.error('[FactorAnalysisV2] error:', e);
    return NextResponse.json({ success: false, error: e.message || 'unknown' }, { status: 500 });
  }
}

// ── 简易/严谨 IC 计算（横截面 Pearson）───────────────────
/**
 * 输入：candidates 池（含 raw 因子值）
 * 选项：useBacktestReturn = false → 简易 IC（vs 当日 changePercent）
 *      useBacktestReturn = true  → 严谨 IC（vs momentum20 已实现收益，≈过去 20 日总收益）
 * 输出：每个 8 大类因子的 IC（与收益的相关系数）
 *
 * 注意：严格的"历史滚动 IC"需要每日 raw 因子时序 + 下期收益。
 * 这里用 raw values（当前截面快照）vs 已实现收益（momentum20 / changePercent）
 * 优点：实现简单 + 给用户直观感受"哪些因子和过去 20 日涨幅相关"
 * 缺点：截面快照 vs 同步已知收益，IC 数值会被 raw 因子构造方式污染（如 momentum20 自身）
 *
 * 返回 { valuation: { ic, ir, n }, momentum: {...}, ... }
 */
function computeSimpleIC(
  candidates: FactorRawValues[],
  opts: { useBacktestReturn?: boolean } = {}
): Record<string, { ic: number; ir: number; n: number }> {
  // 收益口径：useBacktestReturn=true 用 momentum20（过去 20 日累计收益）；
  // false 用当日 changePercent（最易解释但样本最小）
  const yGetter = opts.useBacktestReturn
    ? (c: FactorRawValues) => c.momentum20
    : (c: FactorRawValues) => c.changePercent;
  const validReturns = candidates.map(yGetter).filter(x => typeof x === 'number' && !isNaN(x));
  if (validReturns.length < 5) return {};

  // 8 大类对应的 raw 因子键（注意：momentum 类因子如果用 momentum20 作 y，IC 会被高估——保留为参考）
  const factorKeys: Record<string, string[]> = {
    valuation: ['pe', 'pb', 'ps'],
    quality: ['roe', 'grossMargin'],
    momentum: ['momentum5', 'momentum20', 'momentum60'],
    reversal: ['rsi14', 'bias20'],
    moneyFlow: ['mainNetInflow5d', 'mainNetInflow20d'],
    technical: ['macdHist', 'kdjK', 'adx'],
    turnover: ['turnoverRate', 'volumeRatio'],
    wqAlpha: ['wqAlphaScore'],
  };

  const out: Record<string, { ic: number; ir: number; n: number }> = {};
  for (const [dim, keys] of Object.entries(factorKeys)) {
    const ics: number[] = [];
    for (const k of keys) {
      // 严谨模式时剔除 raw key 自身就是收益的情况（momentum20 vs momentum20 = 1.0 是无意义的）
      if (opts.useBacktestReturn && k === 'momentum20') continue;
      const xs: number[] = [];
      const ys: number[] = [];
      for (const c of candidates) {
        const x = (c as any)[k];
        const y = yGetter(c);
        if (typeof x === 'number' && !isNaN(x) && typeof y === 'number' && !isNaN(y)) {
          xs.push(x);
          ys.push(y);
        }
      }
      if (xs.length < 5) continue;
      ics.push(pearson(xs, ys));
    }
    if (ics.length === 0) {
      out[dim] = { ic: 0, ir: 0, n: 0 };
      continue;
    }
    const meanIc = ics.reduce((s, x) => s + x, 0) / ics.length;
    const stdIc = ics.length > 1 ? Math.sqrt(ics.reduce((s, x) => s + (x - meanIc) ** 2, 0) / ics.length) : 0;
    const ir = stdIc > 0.01 ? meanIc / stdIc : 0;
    out[dim] = { ic: meanIc, ir, n: validReturns.length };
  }
  return out;
}

function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den === 0 ? 0 : num / den;
}
