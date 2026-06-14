/**
 * Factor v2 — 真实主力净流入（接东财/同花顺）
 *
 * 替换 factor-analysis/route.ts:1068-1078 里的"价推量"伪资金流
 *
 * 数据源（按优先级）：
 * 1. 东财 push2his.eastmoney.com 主页面 HTML（公开，无需 token）
 * 2. 腾讯 qt.gtimg.cn 主力资金流（需走代理）
 * 3. 雪球 stock.xueqiu.com（要 cookie）
 *
 * 选东财：免费 + 公开 + 全市场覆盖
 *
 * 接口（实测可用）：
 * https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get
 *   ?lmt=0&klt=1&fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55,f56,f57,f58
 *   &secid=1.600519&secid2=&dectime=
 *
 * 返回主力净流入、超大单、大单、中单、小单的日序列
 */

import type { KBar } from '@/lib/quant/types';

// ── 类型 ─────────────────────────────────────────────
export interface RealMoneyFlow {
  date: string;
  mainNetInflow: number;       // 主力净流入（元）
  superLargeNet: number;       // 超大单净流入
  largeNet: number;            // 大单净流入
  mediumNet: number;           // 中单净流入
  smallNet: number;            // 小单净流入
  mainNetInflowRatio: number;  // 主力净流入 / 成交额
}

interface EastMoneyFlowKline {
  fields: string[];
  klines: string[];  // ["2024-01-02,主力,大单,中单,小单,超大,总成交", ...]
}

// ── secid 转换：code 1.600519 / 0.000001 ─────────────
export function codeToSecid(code: string): string {
  // code 格式: 600519.SH / 000001.SZ / 830799.BJ
  const [num, suffix] = code.split('.');
  const prefix = suffix === 'SH' ? '1' : suffix === 'SZ' ? '0' : '0';
  return `${prefix}.${num}`;
}

// ── 拉单只股票 60 日主力净流入（走东财）───────────────
export async function fetchMainNetInflow(code: string, days = 60): Promise<RealMoneyFlow[]> {
  const secid = codeToSecid(code);
  const url = `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=${days}&klt=1&fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55,f56,f57,f58&secid=${secid}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://quote.eastmoney.com/',
        'Accept': '*/*',
      },
      // 5s 超时
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    if (json.rc !== 0 || !json.data) return [];
    const data = json.data as EastMoneyFlowKline;
    return (data.klines || []).map(line => {
      const parts = line.split(',');
      // 顺序：日期,主力净流入,小单,中单,大单,超大单,主力净流入占比,成交额
      // 但 fields 顺序可能不同，根据实际 fields2 解析
      // 实际接口返回 fields2=f51=日期,f52=主力净流入,f53=小单,f54=中单,f55=大单,f56=超大单,f57=主力净流入占比,f58=成交额
      const date = parts[0];
      const main = parseFloat(parts[1]) || 0;
      const small = parseFloat(parts[2]) || 0;
      const medium = parseFloat(parts[3]) || 0;
      const large = parseFloat(parts[4]) || 0;
      const superLarge = parseFloat(parts[5]) || 0;
      const ratio = parseFloat(parts[6]) || 0;
      return {
        date,
        mainNetInflow: main,
        smallNet: small,
        mediumNet: medium,
        largeNet: large,
        superLargeNet: superLarge,
        mainNetInflowRatio: ratio,
      };
    });
  } catch (e) {
    console.warn(`[RealMoneyFlow] ${code} fetch failed:`, e instanceof Error ? e.message : e);
    return [];
  }
}

// ── 批量拉（并发 5）──────────────────────────────────
export async function fetchMainNetInflowBatch(
  codes: string[],
  days = 60
): Promise<Map<string, RealMoneyFlow[]>> {
  const result = new Map<string, RealMoneyFlow[]>();
  const CONCURRENCY = 5;
  for (let i = 0; i < codes.length; i += CONCURRENCY) {
    const batch = codes.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async c => ({ code: c, flows: await fetchMainNetInflow(c, days) }))
    );
    for (const { code, flows } of results) {
      result.set(code, flows);
    }
  }
  return result;
}

// ── 从 KBar 推算 N 日累计（fallback，没拉到东财时用）───
/**
 * 这个 fallback 比价推量好一些：用 OBV + 量的加权平均
 * 但只能作为降级方案
 */
export function estimateMoneyFlowFromKBars(bars: KBar[]): {
  flow5d: number; flow20d: number; ratio: number;
} {
  if (bars.length < 5) return { flow5d: 0, flow20d: 0, ratio: 0 };
  const recent = bars.slice(-20);

  // 用 OBV 的方向 + 金额的绝对值估算
  let flow20 = 0;
  for (let i = 1; i < recent.length; i++) {
    const change = (recent[i].close - recent[i - 1].close) / Math.max(recent[i - 1].close, 0.01);
    flow20 += recent[i].amount * Math.sign(change) * Math.min(Math.abs(change) * 50, 1);
  }

  const flow5 = flow20 * (5 / 20);
  const todayAmount = recent[recent.length - 1].amount;
  const ratio = todayAmount > 0 ? flow5 / todayAmount : 0;

  return { flow5d: flow5, flow20d: flow20, ratio };
}

// ── 数据质量统计 ─────────────────────────────────────
export interface FlowQuality {
  total: number;
  fetched: number;     // 拉到了真实东财数据
  fallback: number;    // 用了 KBar 估算
  empty: number;       // 完全没数据
  fetchRate: number;   // 0-1
}

export function assessFlowQuality<T>(
  codes: string[],
  flowData: Map<string, T[]>,
  fallbackData: Map<string, T>
): FlowQuality {
  let fetched = 0, fallback = 0, empty = 0;
  for (const c of codes) {
    const flow = flowData.get(c);
    if (flow && flow.length > 0) fetched++;
    else if (fallbackData.has(c)) fallback++;
    else empty++;
  }
  return {
    total: codes.length,
    fetched,
    fallback,
    empty,
    fetchRate: fetched / codes.length,
  };
}
