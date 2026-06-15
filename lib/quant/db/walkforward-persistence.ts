/**
 * v2.1.1（2026-06-15）— Walk-Forward 报告持久化工具
 *
 * 用途：
 *   1. 每次 WF 验证后保存快照到 IDB（db.walkforwardReports）
 *   2. 读历史快照做趋势对比
 *   3. 检测连续 3 次 C/D 级 → 触发"权重可能失效"告警
 *
 * IDB schema: lib/quant/db/schema.ts DbWalkforwardReport
 */

import type { DbWalkforwardReport } from './schema';
import { db } from './database';

const CONSECUTIVE_BAD_THRESHOLD = 3;  // 连续 3 次 C/D 触发告警
const MAX_HISTORY_PER_CONFIG = 30;    // 每个配置最多保留 30 条历史

// ── IDB 安全包装（Node.js 下静默跳过） ──
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

// ── 生成 id ──
function makeId(
  date: string,
  period: string,
  weightMode: string,
  longMomentum: boolean
): string {
  return `${date}_${period}_${weightMode}_${longMomentum ? 'L' : 'S'}`;
}

// ── YYYYMMDD ──
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 保存 WF 报告到 IDB
 *
 * @param report - walkforward-recommendation.ts 输出
 * @param config - 验证时的配置（period/weightMode/longMomentum）
 * @returns 保存的记录 id（失败返回 null）
 */
export async function saveWalkforwardReport(
  report: any,
  config: { period: '5d' | '20d'; weightMode: 'default' | 'ic' | 'manual'; longMomentum: boolean }
): Promise<string | null> {
  if (!isBrowser()) return null;
  const table = db.walkforwardReports;
  if (!table) return null;

  const date = todayStr();
  const id = makeId(date, config.period, config.weightMode, config.longMomentum);
  const ts = Date.now();

  const record: DbWalkforwardReport = {
    id,
    date,
    timestamp: ts,
    period: config.period,
    weightMode: config.weightMode,
    longMomentum: config.longMomentum,
    useICHistory: false,  // 当前 API 没传此参数，固定 false
    rating: report.rating,
    robustnessScore: report.robustnessScore,
    annualizedSharpe: report.annualizedSharpe,
    winRate: report.winRate,
    excessWinRate: report.excessWinRate,
    totalReturn: report.totalReturn,
    maxDrawdown: report.maxDrawdown,
    windowCount: report.windowCount,
    avgExcessReturn: report.avgExcessReturn,
    diagnosis: report.diagnosis,
    fullReport: JSON.stringify(report),
    updatedAt: ts,
  };

  try {
    // 用 put：同 id 会覆盖（保证每天每配置只存最新一条）
    await table.put(record);
    return id;
  } catch (e) {
    console.warn('[walkforward-persistence] save failed:', (e as Error).message);
    return null;
  }
}

/**
 * 读历史报告（按配置筛选）
 *
 * @param config - 配置筛选；传 null 读全部
 * @param limit - 最多返回多少条（默认 30）
 * @returns 按 timestamp 降序的记录列表
 */
export async function loadWalkforwardHistory(
  config: { period?: '5d' | '20d'; weightMode?: 'default' | 'ic' | 'manual'; longMomentum?: boolean } | null,
  limit = MAX_HISTORY_PER_CONFIG
): Promise<DbWalkforwardReport[]> {
  if (!isBrowser()) return [];
  const table = db.walkforwardReports;
  if (!table) return [];

  try {
    let records = await table.toArray();
    // 内存过滤（避免复合索引部分前缀问题）
    if (config?.period) records = records.filter(r => r.period === config.period);
    if (config?.weightMode) records = records.filter(r => r.weightMode === config.weightMode);
    if (typeof config?.longMomentum === 'boolean') {
      records = records.filter(r => r.longMomentum === config.longMomentum);
    }
    return records.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  } catch (e) {
    console.warn('[walkforward-persistence] load failed:', (e as Error).message);
    return [];
  }
}

// ── 趋势分析输出 ──
export interface WalkforwardTrend {
  /** 最近 N 次平均评分 */
  avgScore: number;
  /** 最近 N 次平均夏普 */
  avgSharpe: number;
  /** 最近 N 次胜率均值 */
  avgWinRate: number;
  /** 趋势方向（up / down / flat） */
  trend: 'improving' | 'stable' | 'declining' | 'insufficient';
  /** 连续 C/D 次数（>=3 时触发告警） */
  consecutiveBad: number;
  /** 告警文案（null = 无告警） */
  alert: string | null;
  /** 最近 5 条历史（按时间正序，前端画图用） */
  recentSeries: { timestamp: number; score: number; rating: string; totalReturn: number }[];
}

/**
 * 计算趋势 + 告警
 *
 * 规则：
 *   - 最近 5 次评分趋势（线性回归斜率）：
 *     slope > +2  → 'improving'
 *     slope < -2  → 'declining'
 *     其他        → 'stable'
 *   - 连续 3+ 次 rating ∈ {C, D} → alert = "⚠️ 权重连续 N 次失效，建议..."
 *   - 不足 2 条历史 → 'insufficient'（不告警）
 */
export function analyzeWalkforwardTrend(history: DbWalkforwardReport[]): WalkforwardTrend {
  const empty: WalkforwardTrend = {
    avgScore: 0, avgSharpe: 0, avgWinRate: 0,
    trend: 'insufficient', consecutiveBad: 0, alert: null,
    recentSeries: [],
  };
  if (history.length === 0) return empty;

  // 按时序正序（最旧 → 最新）
  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
  const recent5 = sorted.slice(-5);

  // 均值（用全部历史）
  const avgScore = history.reduce((s, r) => s + r.robustnessScore, 0) / history.length;
  const avgSharpe = history.reduce((s, r) => s + r.annualizedSharpe, 0) / history.length;
  const avgWinRate = history.reduce((s, r) => s + r.winRate, 0) / history.length;

  // 连续 C/D
  let consecutiveBad = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].rating === 'C' || history[i].rating === 'D') {
      consecutiveBad++;
    } else break;
  }

  // 趋势：用最近 5 条做线性回归斜率
  let trend: WalkforwardTrend['trend'] = 'stable';
  if (recent5.length >= 3) {
    const n = recent5.length;
    const xs = recent5.map((_, i) => i);
    const ys = recent5.map(r => r.robustnessScore);
    const mx = xs.reduce((s, x) => s + x, 0) / n;
    const my = ys.reduce((s, y) => s + y, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    const slope = den === 0 ? 0 : num / den;
    if (slope > 2) trend = 'improving';
    else if (slope < -2) trend = 'declining';
    else trend = 'stable';
  } else if (recent5.length < 2) {
    trend = 'insufficient';
  }

  // 告警
  let alert: string | null = null;
  if (consecutiveBad >= CONSECUTIVE_BAD_THRESHOLD) {
    alert = `⚠️ 权重连续 ${consecutiveBad} 次评级 C/D，当前 ${history[history.length - 1].rating} 级 — 建议：① 切 IC 权重模式试试 ② 切长动量 ③ 暂停模拟交易观察`;
  } else if (trend === 'declining') {
    alert = `📉 最近 ${recent5.length} 次评分趋势下滑（斜率 -${recent5[0].robustnessScore}→${recent5[recent5.length - 1].robustnessScore}），建议关注权重稳定性`;
  }

  return {
    avgScore: Math.round(avgScore * 10) / 10,
    avgSharpe: Math.round(avgSharpe * 100) / 100,
    avgWinRate: Math.round(avgWinRate * 1000) / 10,  // 百分比保留 1 位小数
    trend,
    consecutiveBad,
    alert,
    // v2.1.1（2026-06-15）：recentSeries 扩到 30 条，前端画 sparkline 折线图
    recentSeries: sorted.map(r => ({
      timestamp: r.timestamp,
      score: r.robustnessScore,
      rating: r.rating,
      totalReturn: r.totalReturn,
      annualizedSharpe: r.annualizedSharpe,
      excessWinRate: r.excessWinRate,
    })),
  };
}

/**
 * 清理过期历史（保留最近 MAX_HISTORY_PER_CONFIG 条）
 */
export async function pruneWalkforwardHistory(): Promise<number> {
  if (!isBrowser()) return 0;
  const table = db.walkforwardReports;
  if (!table) return 0;

  try {
    const all = await table.toArray();
    if (all.length <= MAX_HISTORY_PER_CONFIG) return 0;
    const sorted = all.sort((a, b) => a.timestamp - b.timestamp);
    const toDelete = sorted.slice(0, sorted.length - MAX_HISTORY_PER_CONFIG);
    await table.bulkDelete(toDelete.map(r => r.id));
    return toDelete.length;
  } catch (e) {
    console.warn('[walkforward-persistence] prune failed:', (e as Error).message);
    return 0;
  }
}