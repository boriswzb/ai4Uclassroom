/**
 * Factor v2 — 行业 + 市值中性化
 *
 * 业界标准做法（Barra CNE5 核心步骤）：
 * 1. 对每个因子，用 OLS 对【行业 dummy + log(市值)】回归
 * 2. 取残差作为中性化后的因子值
 * 3. 再做一次标准化（z-score）
 *
 * 为什么需要：
 * - 行业偏置：银行/白酒天然估值低，技术股天然高 PE，不中性化会被 PE 因子绑架
 * - 市值偏置：小盘股天然波动率高，残差波动率会被小盘绑架
 *
 * 实现：
 * - 行业 dummy 矩阵：每只股票 31 列（申万一级），1 表示属于该行业
 * - 简单 OLS：用伪逆矩阵求解 (X'X)^-1 X'y
 * - 取残差 r = y - X*beta
 *
 * 注：纯 JS 实现，调用方传入候选池即可，不依赖 ml 库
 */

import type { FactorPercentiles, ShenwanIndustry } from './types';
import { SHENWAN_INDUSTRIES } from './types';

// ── 行业 dummy 矩阵构建 ─────────────────────────────
function buildIndustryMatrix(industries: (string | undefined)[]): number[][] {
  // 每行：31 列，1 表示属于该行业
  return industries.map(ind => {
    const row = new Array(SHENWAN_INDUSTRIES.length).fill(0);
    if (ind && (SHENWAN_INDUSTRIES as readonly string[]).includes(ind)) {
      const idx = (SHENWAN_INDUSTRIES as readonly string[]).indexOf(ind);
      row[idx] = 1;
    }
    return row;
  });
}

// ── OLS 求解（伪逆法）───────────────────────────────
/**
 * 简化版 OLS：y = X * beta + epsilon
 * X: n×p 设计矩阵（含截距项）
 * y: n×1 因变量
 * 返回：beta (p×1) 和 residuals (n×1)
 */
function ols(X: number[][], y: number[]): { beta: number[]; residuals: number[] } {
  const n = X.length;
  if (n === 0 || X[0].length === 0) return { beta: [], residuals: [] };
  const p = X[0].length;

  // X'X
  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += X[k][i] * X[k][j];
      XtX[i][j] = sum;
    }
  }

  // X'y
  const Xty: number[] = new Array(p).fill(0);
  for (let i = 0; i < p; i++) {
    let sum = 0;
    for (let k = 0; k < n; k++) sum += X[k][i] * y[k];
    Xty[i] = sum;
  }

  // (X'X)^-1 用 Cholesky 分解（对正定矩阵）
  // 简化：用伴随矩阵（小数据量可接受）
  const inv = invertMatrix(XtX);
  if (!inv) {
    // 矩阵不可逆，返回原始值（不做中性化）
    return { beta: new Array(p).fill(0), residuals: [...y] };
  }

  // beta = inv * X'y
  const beta: number[] = new Array(p).fill(0);
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) beta[i] += inv[i][j] * Xty[j];
  }

  // residuals = y - X*beta
  const residuals: number[] = new Array(n).fill(0);
  for (let k = 0; k < n; k++) {
    let pred = 0;
    for (let i = 0; i < p; i++) pred += X[k][i] * beta[i];
    residuals[k] = y[k] - pred;
  }

  return { beta, residuals };
}

/**
 * 矩阵求逆（Gauss-Jordan 消元法）
 * 返回 null 表示矩阵奇异
 */
function invertMatrix(M: number[][]): number[][] | null {
  const n = M.length;
  if (n === 0) return [];
  // 构造增广矩阵 [M | I]
  const aug: number[][] = M.map((row, i) => {
    const r = [...row];
    for (let j = 0; j < n; j++) r.push(i === j ? 1 : 0);
    return r;
  });

  // 前向消元
  for (let i = 0; i < n; i++) {
    // 找主元
    let pivot = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(aug[k][i]) > Math.abs(aug[pivot][i])) pivot = k;
    }
    if (Math.abs(aug[pivot][i]) < 1e-10) return null;  // 奇异
    [aug[i], aug[pivot]] = [aug[pivot], aug[i]];

    // 归一化
    const piv = aug[i][i];
    for (let j = 0; j < 2 * n; j++) aug[i][j] /= piv;

    // 消其他行
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = aug[k][i];
      for (let j = 0; j < 2 * n; j++) aug[k][j] -= factor * aug[i][j];
    }
  }

  // 提取逆矩阵
  return aug.map(row => row.slice(n));
}

// ── 主入口：行业 + 市值中性化 ────────────────────────
/**
 * 对每个因子做【行业 + 市值】中性化
 *
 * @param pcts 候选池的截面百分位
 * @param industries 与 pcts 等长的行业列表
 * @param options 启用哪些中性化
 * @returns 中性化后的 FactorPercentiles（已重做 0-1 归一化）
 */
export function neutralize(
  pcts: FactorPercentiles[],
  industries: (string | undefined)[],
  options: { industry: boolean; marketCap: boolean } = { industry: true, marketCap: true }
): { pcts: FactorPercentiles[]; warnings: string[] } {
  const warnings: string[] = [];
  if (pcts.length < 5) {
    return { pcts, warnings: ['样本量过小（<5），跳过中性化'] };
  }
  if (!options.industry && !options.marketCap) {
    return { pcts, warnings: ['中性化全关闭'] };
  }

  // ── 构建设计矩阵 X ──
  // 列：截距 + 行业 dummy（31列）+ log(市值)
  const industryMatrix = buildIndustryMatrix(industries);
  const logMktCap = pcts.map(p => p.marketCap);  // 已是 log

  const X: number[][] = pcts.map((_, i) => {
    const row: number[] = [1];  // 截距
    if (options.industry) {
      row.push(...industryMatrix[i]);
    }
    if (options.marketCap) {
      row.push(logMktCap[i]);
    }
    return row;
  });

  // ── 对每个因子做 OLS ──
  const factorNames: (keyof FactorPercentiles)[] = [
    'valuation', 'quality', 'momentum', 'reversal', 'moneyFlow',
    'technical', 'turnover', 'wqAlpha',
  ];

  const newPcts: FactorPercentiles[] = pcts.map(p => ({ ...p }));

  for (const factor of factorNames) {
    const y = pcts.map(p => p[factor] as number);
    const { residuals } = ols(X, y);
    if (residuals.length !== pcts.length) {
      warnings.push(`⚠️ 因子 ${factor} OLS 失败，保留原值`);
      continue;
    }
    // 残差 → 重新归一化到 0-1
    const sortedResid = [...residuals].sort((a, b) => a - b);
    newPcts.forEach((p, i) => {
      const r = residuals[i];
      let rank = 0;
      for (let k = 0; k < sortedResid.length; k++) {
        if (sortedResid[k] <= r) rank = k + 1;
      }
      (p as any)[factor] = rank / sortedResid.length;
    });
  }

  // 同步市值百分位（中性化后 log(市值) 已被吸收）
  if (options.marketCap) {
    newPcts.forEach((p, i) => {
      p.marketCap = pcts[i].marketCap;  // 保留用于诊断
    });
  }

  return { pcts: newPcts, warnings };
}

// ── 便捷：行业分箱（用 mock 当 fallback）───────────────
/**
 * 当 industry 数据缺失时的兜底分箱
 * 用代码前缀做粗分类（600xxx=沪市主板，300xxx=创业板 等）
 * 实际生产应接东财/同花顺行业接口
 */
export function inferIndustryFromCode(code: string): ShenwanIndustry | undefined {
  const num = code.replace(/\D/g, '');
  const prefix = num.substring(0, 3);
  // 简化：基于经验
  if (prefix.startsWith('600') || prefix.startsWith('601') || prefix.startsWith('603') || prefix.startsWith('605')) {
    if (prefix === '601' && ['088', '318', '628', '857', '898'].some(s => num.includes(s))) return '银行';
    if (prefix === '601' && num.startsWith('6013')) return '建筑装饰';
    return undefined;  // 主板无法仅凭代码精确分类
  }
  if (prefix.startsWith('000') || prefix.startsWith('001') || prefix.startsWith('002')) return undefined;
  if (prefix.startsWith('300')) return undefined;  // 创业板
  if (prefix.startsWith('688')) return undefined;  // 科创板
  return undefined;
}
