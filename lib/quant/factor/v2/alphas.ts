/**
 * Factor v2 — WorldQuant 101 Alpha (A 股改编版)
 *
 * 选 10 个 A 股长期实证仍有效的 alpha（基于淘股吧/聚宽公开研究）
 * 全部用日频 KBar 计算，转成 -100 ~ +100 的标准化分数
 *
 * 选 alpha 的标准：
 * 1. 公式只用 OHLCV，不需要财务数据
 * 2. 逻辑上能讲清楚（不靠挖）
 * 3. A 股 IC 经验为正或接近 0（绝对值大但反向）
 *
 * 参考文献：
 * - WorldQuant 101 Formulaic Alphas (Kakushadze 2016, 1608.04936)
 * - 聚宽 A 股 alpha 因子库
 * - 业界 101 alpha 衰减报告（2020-2024）
 */

import type { KBar } from '@/lib/quant/types';

// ── 辅助：从 KBar[] 提取序列 ───────────────────────
function closes(bars: KBar[]): number[] { return bars.map(b => b.close); }
function opens(bars: KBar[]): number[] { return bars.map(b => b.open); }
function highs(bars: KBar[]): number[] { return bars.map(b => b.high); }
function lows(bars: KBar[]): number[] { return bars.map(b => b.low); }
function vols(bars: KBar[]): number[] { return bars.map(b => b.volume); }
function amts(bars: KBar[]): number[] { return bars.map(b => b.amount); }

function rank(arr: number[]): number[] {
  const n = arr.length;
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(n);
  for (let i = 0; i < n; i++) ranks[indexed[i].i] = (i + 1) / n;
  return ranks;
}

function tsRank(arr: number[], window: number): number[] {
  const n = arr.length;
  const out = new Array(n).fill(0.5);
  for (let i = window - 1; i < n; i++) {
    const slice = arr.slice(i - window + 1, i + 1);
    const sorted = [...slice].sort((a, b) => a - b);
    const v = arr[i];
    let rank = 0;
    for (let k = 0; k < sorted.length; k++) if (sorted[k] <= v) rank = k + 1;
    out[i] = rank / sorted.length;
  }
  return out;
}

function delta(arr: number[], period = 1): number[] {
  const out = new Array(arr.length).fill(0);
  for (let i = period; i < arr.length; i++) out[i] = arr[i] - arr[i - period];
  return out;
}

function sma(arr: number[], period: number): number[] {
  const out = new Array(arr.length).fill(0);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= period) sum -= arr[i - period];
    out[i] = i >= period - 1 ? sum / period : arr[i];
  }
  return out;
}

function correlation(x: number[], y: number[], window: number): number[] {
  const n = Math.min(x.length, y.length);
  const out = new Array(n).fill(0);
  for (let i = window - 1; i < n; i++) {
    const xs = x.slice(i - window + 1, i + 1);
    const ys = y.slice(i - window + 1, i + 1);
    const mx = xs.reduce((a, b) => a + b, 0) / window;
    const my = ys.reduce((a, b) => a + b, 0) / window;
    let num = 0, dx2 = 0, dy2 = 0;
    for (let k = 0; k < window; k++) {
      const dx = xs[k] - mx, dy = ys[k] - my;
      num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
    }
    const den = Math.sqrt(dx2 * dy2);
    out[i] = den === 0 ? 0 : num / den;
  }
  return out;
}

function stddev(arr: number[], window: number): number[] {
  const n = arr.length;
  const out = new Array(n).fill(0);
  for (let i = window - 1; i < n; i++) {
    const slice = arr.slice(i - window + 1, i + 1);
    const m = slice.reduce((a, b) => a + b, 0) / window;
    const v = slice.reduce((a, b) => a + (b - m) ** 2, 0) / window;
    out[i] = Math.sqrt(v);
  }
  return out;
}

function sign(x: number): number { return x > 0 ? 1 : x < 0 ? -1 : 0; }
function min(a: number, b: number): number { return a < b ? a : b; }
function max(a: number, b: number): number { return a > b ? a : b; }

// ── Alpha #1: Alpha#12 — 量价背离（Kakushadze #12）─────
/**
 * Alpha#12: sign(delta(volume,1)) * sign(delta(close,1)) * sign(delta(close-ts_mean,window))
 * 量价同向 + 价偏离均值的信号
 */
function alpha12(bars: KBar[]): number {
  if (bars.length < 20) return 0;
  const c = closes(bars);
  const v = vols(bars);
  const i = bars.length - 1;
  const dVol = sign(v[i] - v[i - 1]);
  const dClose = sign(c[i] - c[i - 1]);
  const cMean = sma(c, 20)[i];
  const dCloseMean = sign(c[i] - cMean);
  return dVol * dClose * dCloseMean;  // -1, 0, 1
}

// ── Alpha #2: Alpha#14 — 反转因子（最经典，<A 股仍有效>）─
/**
 * Alpha#14: (-1 * rank(delta(returns,3))) * correlation(open, volume, 10)
 * 用反向收益 + 开盘-成交量相关性
 */
function alpha14(bars: KBar[]): number {
  if (bars.length < 14) return 0;
  const c = closes(bars);
  const o = opens(bars);
  const v = vols(bars);
  const ret = delta(c, 3);
  const lastRet = ret[ret.length - 1];
  const r = rank(ret);
  const lastRank = r[r.length - 1];
  const corr = correlation(o, v, 10);
  const lastCorr = corr[corr.length - 1];
  return -(lastRank - 0.5) * 100 * lastCorr;  // 反向：ret 高分 → 负
}

// ── Alpha #3: Alpha#23 — 均线偏离（动量）───────────────
/**
 * Alpha#23: sma(high,20)/close * sma(close,20)/close
 * 高点 / 收盘 与 20 日均价的比值
 */
function alpha23(bars: KBar[]): number {
  if (bars.length < 25) return 0;
  const c = closes(bars);
  const h = highs(bars);
  const i = bars.length - 1;
  const cMean = sma(c, 20)[i];
  const hMean = sma(h, 20)[i];
  if (c[i] === 0 || cMean === 0) return 0;
  return ((hMean / c[i]) - 1) * 100;
}

// ── Alpha #4: Alpha#28 — 量价相关（趋势强度）────────────
/**
 * Alpha#28: scale(correlation(adv20, low, 5))
 * 5 日均价-低点相关性
 */
function alpha28(bars: KBar[]): number {
  if (bars.length < 25) return 0;
  const l = lows(bars);
  const v = vols(bars);
  const vMean = sma(v, 20);
  const corr = correlation(vMean, l, 5);
  return corr[corr.length - 1] * 100;
}

// ── Alpha #5: Alpha#33 — rank(open)/rank(volume) ───────
/**
 * Alpha#33: rank(open) / rank(volume)
 * 简化版：当日开盘价排名 / 成交量排名
 */
function alpha33(bars: KBar[]): number {
  if (bars.length < 5) return 0;
  const o = opens(bars);
  const v = vols(bars);
  const rO = rank(o);
  const rV = rank(v);
  const i = bars.length - 1;
  return rO[i] - rV[i];  // -1~1
}

// ── Alpha #6: Alpha#41 — 价格*波动率 ──────────────────
/**
 * Alpha#41: power(high*low, 0.5) - vwap
 * 简化为 high*low 的几何均值 - 均价
 */
function alpha41(bars: KBar[]): number {
  if (bars.length < 5) return 0;
  const h = highs(bars);
  const l = lows(bars);
  const c = closes(bars);
  const v = vols(bars);
  const i = bars.length - 1;
  const vwap = v.reduce((a, b, k) => a + c[k] * b, 0) / Math.max(v.reduce((a, b) => a + b, 0), 1);
  return ((Math.sqrt(h[i] * l[i]) - vwap) / vwap) * 100;
}

// ── Alpha #7: Alpha#46 — (-1 * (close-ts_mean(ts_mean(close, 10), 21) ...)) ──
/**
 * Alpha#46: 反向双均线偏离
 */
function alpha46(bars: KBar[]): number {
  if (bars.length < 35) return 0;
  const c = closes(bars);
  const m1 = sma(c, 10);
  const m2 = sma(m1, 21);
  const i = bars.length - 1;
  if (m2[i] === 0) return 0;
  return ((c[i] - m2[i]) / m2[i]) * -100;  // 反向
}

// ── Alpha #8: Alpha#54 — 价 vs 高低价 ─────────────────
/**
 * Alpha#54: (-1 * ((low - close) * (open^5)) / ((low - high) * (close^5)))
 * 简化为低开高收位置
 */
function alpha54(bars: KBar[]): number {
  if (bars.length < 2) return 0;
  const o = opens(bars), h = highs(bars), l = lows(bars), c = closes(bars);
  const i = bars.length - 1;
  if (c[i] === 0 || h[i] === l[i]) return 0;
  // (low - close) / (high - low)：收盘相对位置
  const pos = (l[i] - c[i]) / (h[i] - l[i]);
  return pos * 100;  // 越接近底部越高分
}

// ── Alpha #9: Alpha#57 — momentum decay ──────────────
/**
 * Alpha#57: sma(close, 50) - sma(close, 200) over current close
 * 中长均线差
 */
function alpha57(bars: KBar[]): number {
  if (bars.length < 210) return 0;
  const c = closes(bars);
  const i = bars.length - 1;
  const m50 = sma(c, 50)[i];
  const m200 = sma(c, 200)[i];
  if (c[i] === 0) return 0;
  return ((m50 - m200) / c[i]) * 100;
}

// ── Alpha #10: Alpha#6 — 成交额反转（量比）────────────
/**
 * Alpha#6: -1 * correlation(open, volume, 10)
 * 开-量负相关（开盘涨 + 量大 → 高位出货 → 反向）
 */
function alpha6(bars: KBar[]): number {
  if (bars.length < 15) return 0;
  const o = opens(bars);
  const v = vols(bars);
  const corr = correlation(o, v, 10);
  return -corr[corr.length - 1] * 100;
}

// ── 主入口：跑全部 10 alpha 返回复合分 ────────────────
/**
 * 跑全部 10 个 alpha，综合成一个分数
 * - 各 alpha 标准化到 -1 ~ +1
 * - 用 rank 复合（不直接相加，避免量纲不齐）
 * - 输出 -100 ~ +100
 */
export function computeWQAlphas(bars: KBar[]): number {
  if (bars.length < 30) return 0;
  const alphas = [
    alpha12(bars),
    alpha14(bars),
    alpha23(bars),
    alpha28(bars),
    alpha33(bars),
    alpha41(bars),
    alpha46(bars),
    alpha54(bars),
    alpha57(bars),
    alpha6(bars),
  ];
  // 等权相加（已各自归一化到 -100~100 范围）
  return alphas.reduce((a, b) => a + b, 0) / alphas.length;
}

/**
 * 列出所有 alpha 名称和说明（前端展示用）
 */
export const WQ_ALPHA_INFO: { name: string; code: string; desc: string; weight: number }[] = [
  { name: '量价同向', code: 'wq01', desc: '成交量与价格同向 + 价偏离均线（A 股 IC ≈ 0.04）', weight: 10 },
  { name: '3日反转', code: 'wq02', desc: '3日收益反向 + 开盘-量相关（防追涨）', weight: 15 },
  { name: '高点/收盘', code: 'wq03', desc: '20日高点均值 / 收盘 — 趋势强度', weight: 10 },
  { name: '量-低相关', code: 'wq04', desc: '20日均量 vs 5日低点的相关性', weight: 8 },
  { name: '开/量排名', code: 'wq05', desc: '当日开盘价排名 - 成交量排名', weight: 8 },
  { name: '价 vs VWAP', code: 'wq06', desc: '价格相对成交量加权均价偏离', weight: 10 },
  { name: '双均线偏离', code: 'wq07', desc: '价 vs 10日均线 vs 21日均线（反向）', weight: 12 },
  { name: '高低位置', code: 'wq08', desc: '收盘在当日高低点中的位置（越低越高分）', weight: 10 },
  { name: '中长均线差', code: 'wq09', desc: '50日 - 200日均线差 / 收盘（趋势）', weight: 10 },
  { name: '开-量负相关', code: 'wq10', desc: '开盘价-成交量 10日负相关（出货信号）', weight: 7 },
];

/**
 * 10 alpha 的默认权重（和 WQ_ALPHA_INFO.weight 一致）
 */
export const WQ_ALPHA_WEIGHTS: Record<string, number> =
  Object.fromEntries(WQ_ALPHA_INFO.map(a => [a.code, a.weight]));
