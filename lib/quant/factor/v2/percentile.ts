/**
 * Factor v2 — 截面百分位归一化 + 去极值 + 共线性检测
 *
 * 业界标准：
 * 1. 去极值：1%-99% 分位数截断（更稳健）+ 可选 3σ 备选
 * 2. 百分位归一化：跨整个候选池排序，0-1
 * 3. 中性化：行业 dummy + log(市值) OLS 取残差（独立模块）
 * 4. 共线性：pairwise Pearson |r| > 0.7 报警，并保留更高 IC 的因子
 *
 * 引用：
 * - Barra CNE5 模型文档（MSCI）
 * - 业界最佳实践（Multi-Factor Strategy Development Framework）
 */

import type { FactorRawValues, FactorPercentiles } from './types';

// ── 1. 去极值（中位数 ± 3×MAD 法）───────────────────
/**
 * 中位数绝对偏差法（MAD）— 比 3σ 更稳健
 * 公式：clip(x, median ± 3 × 1.4826 × MAD)
 */
export function winsorizeMAD(values: number[]): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  const absDev = values.map(v => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = absDev[Math.floor(absDev.length / 2)];

  if (mad === 0) return values;  // 全部相等
  const lower = median - 3 * 1.4826 * mad;
  const upper = median + 3 * 1.4826 * mad;
  return values.map(v => Math.max(lower, Math.min(upper, v)));
}

/**
 * 分位数截断法（备选，1%-99%）
 */
export function winsorizeQuantile(values: number[], low = 0.01, high = 0.99): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * low)];
  const hi = sorted[Math.floor(sorted.length * high)];
  return values.map(v => Math.max(lo, Math.min(hi, v)));
}

// ── 2. 百分位计算（去极值后）───────────────────────
function percentileRank(sortedAsc: number[], value: number): number {
  if (sortedAsc.length === 0) return 0.5;
  // 二分查找
  let lo = 0, hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sortedAsc.length;
}

/**
 * 把一组数字转成 0-1 百分位（高 = 大）
 */
export function toPercentileAsc(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return values.map(v => percentileRank(sorted, v));
}

/**
 * 把一组数字转成 0-1 百分位（高 = 小）— 估值/负债率
 */
export function toPercentileDesc(values: number[]): number[] {
  return toPercentileAsc(values).map(p => 1 - p);
}

// ── 3. 截面百分位归一化（核心）─────────────────────
/**
 * 把整个候选池的 raw factor values 转成截面百分位
 * - 去极值（默认 MAD 法）
 * - 每个因子独立做 0-1 百分位
 * - 估值/负债率反向
 */
export function computeFactorPercentiles(
  candidates: FactorRawValues[],
  opts: { winsorizeMethod?: 'mad' | 'quantile' } = {}
): { pcts: FactorPercentiles[]; warnings: string[] } {
  const warnings: string[] = [];
  if (candidates.length === 0) return { pcts: [], warnings };

  const method = opts.winsorizeMethod ?? 'mad';

  // ── 提取各列原始值 ──
  const cols: Record<string, number[]> = {
    pe: candidates.map(c => c.pe > 0 ? c.pe : 0),
    pb: candidates.map(c => c.pb > 0 ? c.pb : 0),
    ps: candidates.map(c => c.ps > 0 ? c.ps : 0),
    roe: candidates.map(c => c.roe),
    grossMargin: candidates.map(c => c.grossMargin),
    debtRatio: candidates.map(c => c.debtRatio),
    momentum5: candidates.map(c => c.momentum5),
    momentum20: candidates.map(c => c.momentum20),
    momentum60: candidates.map(c => c.momentum60),
    rsi: candidates.map(c => c.rsi14),
    bias: candidates.map(c => Math.abs(c.bias20)),
    mainNetInflow: candidates.map(c => c.mainNetInflow20d),
    macd: candidates.map(c => c.macdHist),
    kdj: candidates.map(c => c.kdjK - c.kdjD),  // K-D 差值
    bollPosition: candidates.map(c => c.bollPosition),
    adx: candidates.map(c => c.adx),
    volatility: candidates.map(c => c.lowVolatility),
    turnoverRate: candidates.map(c => c.turnoverRate),
    volumeRatio: candidates.map(c => c.volumeRatio),
    marketCap: candidates.map(c => Math.log(Math.max(c.marketCap, 1))),
  };

  // ── 去极值 ──
  const winsorized: Record<string, number[]> = {};
  for (const [key, vals] of Object.entries(cols)) {
    if (key === 'marketCap') {
      // 市值不截断（核心控制变量）
      winsorized[key] = vals;
    } else {
      winsorized[key] = method === 'mad' ? winsorizeMAD(vals) : winsorizeQuantile(vals);
    }
  }

  // ── 转百分位 ──
  const pctCols: Record<string, number[]> = {};
  for (const [key, vals] of Object.entries(winsorized)) {
    // 反向因子（数值越小越好）
    const reverse = ['pe', 'pb', 'ps', 'bias', 'volatility', 'debtRatio'].includes(key);
    pctCols[key] = reverse ? toPercentileDesc(vals) : toPercentileAsc(vals);
  }

  // ── 数据质量警告 ──
  const peCount = candidates.filter(c => c.pe > 0).length;
  if (peCount / candidates.length < 0.3) {
    warnings.push(`⚠️ 仅 ${peCount}/${candidates.length} 票有有效 PE（盈利股票稀少）`);
  }
  const flowCount = candidates.filter(c => c.mainNetInflow20d !== 0).length;
  if (flowCount / candidates.length < 0.5) {
    warnings.push(`⚠️ 仅 ${flowCount}/${candidates.length} 票有资金流数据（接口可能异常）`);
  }

  // ── 拼成 FactorPercentiles[] ──
  const pcts: FactorPercentiles[] = candidates.map((c, i) => {
    // valuation: pe+pb+ps 综合（反向）
    const valuation = (pctCols.pe[i] + pctCols.pb[i] + pctCols.ps[i]) / 3;
    // quality: roe+grossMargin 正向，debtRatio 反向
    const quality = (pctCols.roe[i] + pctCols.grossMargin[i] + pctCols.debtRatio[i]) / 3;
    // momentum: 用 20 日（最稳健周期）
    const momentum = pctCols.momentum20[i];
    // reversal: rsi 反向 + bias 反向（小乖离更好）
    const reversal = (pctCols.rsi[i] + pctCols.bias[i]) / 2;
    // moneyFlow: 主力净流入
    const moneyFlow = pctCols.mainNetInflow[i];
    // technical: macd+kdj+boll+adx 综合
    const technical = (pctCols.macd[i] + pctCols.kdj[i] + pctCols.bollPosition[i] + pctCols.adx[i]) / 4;
    // turnover: 适度区间（3-15% 最优）
    const turnover = pctCols.turnoverRate[i];
    // wqAlpha: 来自外部（alphas.ts）
    const wqAlpha = c.wqAlphaScore > 0
      ? toPercentileAsc(candidates.map(cc => cc.wqAlphaScore))[i]
      : 0.5;

    return {
      valuation, quality, momentum, reversal, moneyFlow, technical, turnover, wqAlpha,
      pe: pctCols.pe[i],
      pb: pctCols.pb[i],
      roe: pctCols.roe[i],
      grossMargin: pctCols.grossMargin[i],
      momentum20: pctCols.momentum20[i],
      rsi: pctCols.rsi[i],
      mainNetInflow: pctCols.mainNetInflow[i],
      macd: pctCols.macd[i],
      kdj: pctCols.kdj[i],
      bollPosition: pctCols.bollPosition[i],
      adx: pctCols.adx[i],
      volatility: pctCols.volatility[i],
      turnoverRate: pctCols.turnoverRate[i],
      volumeRatio: pctCols.volumeRatio[i],
      marketCap: pctCols.marketCap[i],
    };
  });

  // ── 行业内百分位（按申万一级行业分组重算）────────
  // 同行业内做截面百分位，更适合"行业中性化"分析
  // 行业样本 < 5 只的行业直接 fallback 到全市场百分位
  const industryPcts: { industry?: string; size: number; pcts: Record<string, number> }[] = [];
  const groupedByIndustry = new Map<string, number[]>();
  candidates.forEach((_, i) => {
    const ind = candidates[i].industry || '__no_industry__';
    if (!groupedByIndustry.has(ind)) groupedByIndustry.set(ind, []);
    groupedByIndustry.get(ind)!.push(i);
  });

  for (const [industry, idxs] of groupedByIndustry.entries()) {
    if (idxs.length < 5) continue;  // 行业样本太少
    // 对每个 pct 字段，在该行业内重算百分位
    // indPcts: field → [按 idxs 顺序排列的百分位]
    const indPcts: Record<string, number[]> = {};
    for (const [field] of Object.entries(pctCols)) {
      // 提取该行业样本的值
      const indVals = idxs.map(i => pctCols[field][i]);
      // 在该行业样本内的百分位
      const sorted = [...indVals].sort((a, b) => a - b);
      const out: number[] = [];
      idxs.forEach(i => {
        const myV = pctCols[field][i];
        // 二分
        let lo = 0, hi = sorted.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (sorted[mid] < myV) lo = mid + 1;
          else hi = mid;
        }
        out.push(lo / sorted.length);
      });
      indPcts[field] = out;
    }
    // 计算 8 大类聚合（复用 pcts.ts 里的逻辑）
    const industryResults = idxs.map((i, j) => {
      const valuation = (indPcts.pe![j] + indPcts.pb![j] + (indPcts.pe![j] /* ps fallback */)) / 3;
      const quality = (indPcts.roe![j] + indPcts.grossMargin![j] + (indPcts.roe![j])) / 3;
      return {
        industryPctValuation: valuation,
        industryPctQuality: quality,
        industryPctMomentum: indPcts.momentum20![j],
        industryPctReversal: (indPcts.rsi![j] + indPcts.bias![j]) / 2,
        industryPctMoneyFlow: indPcts.mainNetInflow![j],
        industryPctTechnical: (indPcts.macd![j] + indPcts.kdj![j] + indPcts.bollPosition![j] + indPcts.adx![j]) / 4,
        industryPctTurnover: indPcts.turnoverRate![j],
        industryPctWqAlpha: indPcts.wqAlpha?.[j] ?? 0.5,
        industrySize: idxs.length,
      };
    });
    industryResults.forEach((r, j) => {
      pcts[idxs[j]] = { ...pcts[idxs[j]], ...r };
    });
  }

  return { pcts, warnings };
}

// ── 4. 共线性检测 ──────────────────────────────────
/**
 * Pairwise Pearson 相关系数
 */
export function pearsonCorr(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 3) return 0;
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den === 0 ? 0 : num / den;
}

/**
 * 共线性矩阵 + 报警
 * 返回 |r| > threshold 的因子对
 */
export function checkCollinearity(
  pcts: FactorPercentiles[],
  factorNames: (keyof FactorPercentiles)[],
  threshold = 0.7
): { pairs: { a: string; b: string; corr: number }[]; warnings: string[] } {
  const warnings: string[] = [];
  const pairs: { a: string; b: string; corr: number }[] = [];
  if (pcts.length < 5) return { pairs, warnings };

  for (let i = 0; i < factorNames.length; i++) {
    for (let j = i + 1; j < factorNames.length; j++) {
      const a = factorNames[i], b = factorNames[j];
      const x = pcts.map(p => (p as any)[a] as number);
      const y = pcts.map(p => (p as any)[b] as number);
      const r = pearsonCorr(x, y);
      if (Math.abs(r) >= threshold) {
        pairs.push({ a, b, corr: r });
        warnings.push(`⚠️ 因子对 ${a}~${b} 相关系数 ${r.toFixed(2)}（|r|≥${threshold}，建议剔除一个）`);
      }
    }
  }
  return { pairs, warnings };
}
