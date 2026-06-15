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
  opts: {
    winsorizeMethod?: 'mad' | 'quantile';
    // v2.1.1（2026-06-15）：可选的 IC 数据，用于技术类因子自适应 reverse
    // 当传入时，macd/kdj/bollPosition/adx/rsi 会按 IC 方向自动反向
    icStats?: Record<string, { ic: number; ir: number; n: number }>;
    // v2.1.1（2026-06-15）：长动量开关（默认 false 用 20d；true 用 60d×0.3+120d×0.5+20d×0.2）
    //   注意：开启 longMomentum 时 K 线需 ≥ 120 天（factors.ts 会自动处理）
    longMomentum?: boolean;
  } = {}
): { pcts: FactorPercentiles[]; warnings: string[] } {
  const warnings: string[] = [];
  if (candidates.length === 0) return { pcts: [], warnings };

  const method = opts.winsorizeMethod ?? 'mad';
  const icStats = opts.icStats;  // v2.1.1：技术类因子自适应 reverse 用

  // v2.1.1：记录每个技术因子的 reverse 决策（前端 diagnostics 展示）
  const reverseDecisions: Record<string, { reversed: boolean; ic?: number; reason: string }> = {};

  // ── 提取各列原始值 ──
  const cols: Record<string, number[]> = {
    pe: candidates.map(c => c.pe > 0 ? c.pe : 0),
    pb: candidates.map(c => c.pb > 0 ? c.pb : 0),
    ps: candidates.map(c => c.ps > 0 ? c.ps : 0),
    roe: candidates.map(c => c.roe),
    grossMargin: candidates.map(c => c.grossMargin),
    debtRatio: candidates.map(c => c.debtRatio),
    accrualsRatio: candidates.map(c => c.accrualsRatio),  // v2.1.1：Sloan Accruals
    momentum5: candidates.map(c => c.momentum5),
    momentum20: candidates.map(c => c.momentum20),
    momentum60: candidates.map(c => c.momentum60),
    momentum120: candidates.map(c => c.momentum120 ?? 0),  // v2.1.1：长动量 120 日（缺失置 0）
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
  // P1 修复（2026-06-15）：对"全等值"列（如 EM 财务接口全失败时 debtRatio 全 50），
  //   toPercentileDesc/Asc 会返回 0（Asc 全 0）/ 1.0（Desc 全 0→1.0），
  //   但数学上"全等"应该=0.5（中位数）。检测 std<1e-9 时直接置 0.5。
  //
  // v2.1.1（2026-06-15）：自动 reverse 决策
  //   旧实现：reverse 列表硬编码 [pe, pb, ps, bias, volatility, debtRatio]
  //     → 漏掉 macd/kdj/bollPosition/adx 等技术因子（这些因子的"高=好"假设是错的，
  //       IC 数据实测它们 IC 普遍为负）
  //     → 修复后按 IC 数据自动决定方向：IC<0 → 自动 reverse
  //   但 percentile.ts 不依赖 IC 数据（保持纯函数），所以这里接受一个可选的
  //   icStats 参数，由 route.ts 在 scoreV2 时把 IC 数据透传进来。
  const pctCols: Record<string, number[]> = {};
  for (const [key, vals] of Object.entries(winsorized)) {
    // 检测常数列（除 marketCap 这种核心控制变量外）
    if (key !== 'marketCap') {
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
      if (std < 1e-9) {
        pctCols[key] = vals.map(() => 0.5);  // 全等 → 中性 0.5
        continue;
      }
    }
    // 反向因子决策：
    //   1) 基础反向（估值/负债/波动率）— 永远 reverse（PE/PB/PS 低好、debtRatio 低好、波动率低好）
    //   2) 技术类（macd/kdj/bollPosition/adx）— 默认正向（按业内惯例"金叉=好"）
    //      但当 icStats 传入且这些因子的 IC<0 时自动反向（数据驱动覆盖理论）
    //   3) 反转类（bias）— 反向（小乖离更好）
    const baseReverse = ['pe', 'pb', 'ps', 'bias', 'volatility', 'debtRatio'].includes(key);
    let reverse = baseReverse;
    let icMeasured: number | undefined;
    // v2.1.1：技术类因子按 IC 数据自适应
    if (icStats && ['macd', 'kdj', 'bollPosition', 'adx', 'rsi'].includes(key)) {
      // 找到对应的 IC 统计（key 映射：kdj->kdjK, rsi->rsi14, bollPosition->bollPosition）
      const icKeyMap: Record<string, string> = {
        macd: 'macdHist', kdj: 'kdjK', bollPosition: 'bollPosition',
        adx: 'adx', rsi: 'rsi14',
      };
      const icKey = icKeyMap[key];
      // 简单 IC：取该 key 在所有候选上的 Pearson(x, changePercent)
      const xs: number[] = [];
      const ys: number[] = [];
      for (const c of candidates) {
        const x = (c as any)[icKey];
        const y = c.changePercent;
        if (typeof x === 'number' && !isNaN(x) && typeof y === 'number' && !isNaN(y)) {
          xs.push(x);
          ys.push(y);
        }
      }
      if (xs.length >= 10) {
        const ic = pearsonCorr(xs, ys);
        icMeasured = ic;
        // IC<0 → 高 x 对应低收益 → reverse=true（数值小=高分=好）
        // |IC|<0.01 视为无信号，保持默认方向
        if (Math.abs(ic) >= 0.01) reverse = ic < 0;
      }
    }
    pctCols[key] = reverse ? toPercentileDesc(vals) : toPercentileAsc(vals);
    // 记录决策（用于 diagnostics 输出）
    if (['macd', 'kdj', 'bollPosition', 'adx', 'rsi'].includes(key)) {
      reverseDecisions[key] = {
        reversed: reverse,
        ic: icMeasured,
        reason: icMeasured === undefined
          ? '样本不足，按默认方向（金叉=好）'
          : Math.abs(icMeasured) < 0.01
            ? 'IC 信号弱（|IC|<0.01），按默认方向'
            : reverse
              ? `IC=${icMeasured.toFixed(3)}<0，自动反向（数值小=好）`
              : `IC=${icMeasured.toFixed(3)}>0，保持正向（数值大=好）`,
      };
    }
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
    // quality: roe+grossMargin 正向 + debtRatio 反向 + accrualsRatio 正向（v2.1.1）
    //   accrualsRatio 权重 1.0（与其他三项等价），让 Sloan 因子独立贡献
    const quality = (pctCols.roe[i] + pctCols.grossMargin[i] + pctCols.debtRatio[i] + pctCols.accrualsRatio[i]) / 4;
    // momentum: 默认 20d；长动量模式（v2.1.1）: 60d×0.3 + 120d×0.5 + 20d×0.2
    //   Jegadeesh-Titman (1993) 经典：6-12 月动量 IC 远高于 20d
    //   业界共识：长动量更适合月度调仓策略
    let momentum: number;
    if (opts.longMomentum) {
      momentum = pctCols.momentum60[i] * 0.3
               + pctCols.momentum120[i] * 0.5
               + pctCols.momentum20[i] * 0.2;
    } else {
      momentum = pctCols.momentum20[i];
    }
    // 反转: rsi 反向 + bias 反向（小乖离更好）
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
      accrualsRatio: pctCols.accrualsRatio[i],  // v2.1.1
      momentum20: pctCols.momentum20[i],
      momentum60: pctCols.momentum60[i],
      momentum120: pctCols.momentum120[i],
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
      // P1 修复（2026-06-15）：第三个用 debtRatio（reverse=true 已在 indPcts 阶段处理好），不是 roe
      // v2.1.1（2026-06-15）：第四项加 accrualsRatio
      const quality = (indPcts.roe![j] + indPcts.grossMargin![j] + indPcts.debtRatio![j] + (indPcts.accrualsRatio?.[j] ?? 0.5)) / 4;
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

  // v2.1.1：把 reverse 决策加到 warnings（让前端 diagnostics 能展示"哪个因子被反向"）
  for (const [factor, dec] of Object.entries(reverseDecisions)) {
    const arrow = dec.reversed ? '🔄' : '⬆️';
    warnings.push(`${arrow} ${factor}: ${dec.reason}`);
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

// ── 5. 缺失值填充（v2.1.1 — 2026-06-15）──────────────────
/**
 * 用行业中位数填充缺失的 raw 因子值
 *
 * 业界标准：因子缺失不能简单用 0 或均值填充（会污染截面百分位）
 * 最佳实践：同行业内有 ≥3 个有效样本时用行业中位数；否则用全市场分位 0.5
 *
 * 适用：财务因子（PE/PB/ROE/毛利率/负债率/Accruals）
 *     这些因子接口失败时默认为 0（或 debtRatio=50），不修复会拉低质量大类
 *
 * 用法（在 scoreV2 之前调用）：
 *   const filled = fillIndustryMedian(candidates, ['pe', 'pb', 'roe', 'grossMargin', 'debtRatio', 'accrualsRatio']);
 *   scoreV2({ candidates: filled, ... })
 */
export function fillIndustryMedian(
  candidates: FactorRawValues[],
  fields: (keyof FactorRawValues)[]
): FactorRawValues[] {
  // 按行业分组
  const byIndustry = new Map<string, FactorRawValues[]>();
  for (const c of candidates) {
    const ind = c.industry || '__no_industry__';
    if (!byIndustry.has(ind)) byIndustry.set(ind, []);
    byIndustry.get(ind)!.push(c);
  }

  // 全市场分位 0.5 备选（行业样本不足时）
  const globalMedian: Record<string, number> = {};
  for (const f of fields) {
    const vals = candidates
      .map(c => c[f] as number)
      .filter(v => typeof v === 'number' && !isNaN(v));
    if (vals.length > 0) {
      const sorted = [...vals].sort((a, b) => a - b);
      globalMedian[f] = sorted[Math.floor(sorted.length / 2)];
    } else {
      globalMedian[f] = 0;
    }
  }

  // 按行业算中位数
  const industryMedian: Record<string, Record<string, number>> = {};
  for (const [ind, list] of byIndustry.entries()) {
    industryMedian[ind] = {};
    for (const f of fields) {
      const vals = list
        .map(c => c[f] as number)
        .filter(v => typeof v === 'number' && !isNaN(v));
      if (vals.length >= 3) {
        const sorted = [...vals].sort((a, b) => a - b);
        industryMedian[ind][f] = sorted[Math.floor(sorted.length / 2)];
      } else {
        industryMedian[ind][f] = globalMedian[f];
      }
    }
  }

  // 填充缺失（判定规则：raw 是 defaults）
  //   PE/PB/PS/ROE/毛利率/eps/accrualsRatio 默认 0 → 视为缺失
  //   debtRatio 默认 50 → 视为缺失
  return candidates.map(c => {
    const filled = { ...c };
    const ind = c.industry || '__no_industry__';
    for (const f of fields) {
      const v = filled[f] as number;
      const isMissing = f === 'debtRatio' ? v === 50 : v === 0;
      if (isMissing && industryMedian[ind]?.[f] !== undefined) {
        (filled as any)[f] = industryMedian[ind][f];
      }
    }
    return filled;
  });
}
