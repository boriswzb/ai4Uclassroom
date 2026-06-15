/**
 * v3.0（2026-06-15）— 每日 raw 因子快照工具
 *
 * 核心功能：
 *   1. saveSnapshot() — 保存当日 raw 因子（每天每票一条）
 *   2. fillFutureReturns() — 用当天价格填补 T+5/T+20 收益
 *   3. getHistoricalSnapshots() — 查某只票或某天的历史
 *   4. getFilledSnapshots() — 只查"已填完未来收益"的快照（用于 WF）
 *   5. pruneOldSnapshots() — 清理过期快照（默认保留 1 年）
 *
 * 业界标准：
 *   - 每日收盘后跑：saveSnapshot（写当日因子）
 *   - T+5/T+20 后跑：fillFutureReturns（补未来收益）
 *   - WF 验证时：只查 return5d/return20d 已填的记录
 *
 * 数据流：
 *   ┌────────────────┐   ┌─────────────────┐   ┌──────────────────┐
 *   │ computeFactors │──▶│ saveSnapshot()  │──▶│ IDB.factorSnapshots │
 *   │   (拉数据)     │   │  (raw + price)  │   │     (持久化)      │
 *   └────────────────┘   └─────────────────┘   └────────┬─────────┘
 *                                                       │
 *                                              T+5/T+20 后
 *                                                       │
 *                                              ┌────────▼─────────┐
 *                                              │fillFutureReturns │
 *                                              │  (补 return)     │
 *                                              └────────┬─────────┘
 *                                                       │
 *                                              ┌────────▼─────────┐
 *                                              │getFilledSnapshots│
 *                                              │   (供 WF 使用)   │
 *                                              └──────────────────┘
 */

import type { DbFactorSnapshot } from './schema';
import { db } from './database';

const DEFAULT_RETENTION_DAYS = 365;  // 保留 1 年
const FUTURE_FILL_HORIZON_DAYS = 30;  // 30 天内的快照需要回填检查

// ── IDB 安全包装 ──
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

// ── YYYYMMDD ──
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 转换 FactorRawValues → DbFactorSnapshot
 *
 * 注意：FactorRawValues 的 wqAlphaScore 可能是 0（表示没算），
 *       字段命名有些差异（rsi14 vs rsi），需做兼容
 */
export function rawToSnapshot(
  raw: any,
  date: string,
  timestamp: number = Date.now()
): DbFactorSnapshot {
  return {
    id: `${date}_${raw.code}`,
    date,
    timestamp,
    code: raw.code,
    name: raw.name || '',
    price: raw.price || 0,
    changePercent: raw.changePercent || 0,
    pe: raw.pe || 0,
    pb: raw.pb || 0,
    ps: raw.ps || 0,
    roe: raw.roe || 0,
    grossMargin: raw.grossMargin || 0,
    debtRatio: raw.debtRatio === 50 ? 0 : (raw.debtRatio || 0),  // 50 视为缺失，存 0
    eps: raw.eps || 0,
    accrualsRatio: raw.accrualsRatio ?? 1.0,
    momentum5: raw.momentum5 || 0,
    momentum10: raw.momentum10 || 0,
    momentum20: raw.momentum20 || 0,
    momentum60: raw.momentum60 || 0,
    momentum120: raw.momentum120 || 0,
    rsi14: raw.rsi14 || 50,
    cci14: raw.cci14 || 0,
    bias20: raw.bias20 || 0,
    mainNetInflow5d: raw.mainNetInflow5d || 0,
    mainNetInflow20d: raw.mainNetInflow20d || 0,
    mainNetInflowRatio: raw.mainNetInflowRatio || 0,
    macdHist: raw.macdHist || 0,
    kdjK: raw.kdjK || 50,
    kdjD: raw.kdjD || 50,
    bollPosition: raw.bollPosition || 0.5,
    adx: raw.adx || 0,
    lowVolatility: raw.lowVolatility || 0,
    turnoverRate: raw.turnoverRate || 0,
    volumeRatio: raw.volumeRatio || 1,
    marketCap: raw.marketCap || 0,
    floatMarketCap: raw.floatMarketCap || 0,
    avgAmount20d: raw.avgAmount20d || 0,
    industry: raw.industry || '',
    wqAlphaScore: raw.wqAlphaScore || 0,
  };
}

/**
 * 保存当日 raw 因子快照（批量）
 *
 * @param raws - computeFactors 输出数组
 * @param date - YYYYMMDD（默认今天）
 * @returns 成功保存的数量
 */
export async function saveSnapshots(
  raws: any[],
  date: string = todayStr()
): Promise<number> {
  if (!isBrowser() || raws.length === 0) return 0;
  const table = db.factorSnapshots;
  if (!table) return 0;

  const ts = Date.now();
  const snapshots = raws.map(r => rawToSnapshot(r, date, ts));
  try {
    await table.bulkPut(snapshots);  // bulkPut: 同 id 覆盖
    return snapshots.length;
  } catch (e) {
    console.warn('[snapshot] save failed:', (e as Error).message);
    return 0;
  }
}

/**
 * 填补未来收益（T+5/T+20）
 *
 * 算法：
 *   1. 找所有"未填 return5d/return20d 且创建时间 ≥ 5/20 天前"的快照
 *   2. 对每条快照，查同一只票在 T+5/T+20 天的快照
 *   3. 算 (priceNext - price) / price × 100
 *   4. 写回原快照
 *
 * 业界经验：每天定时跑一次（盘后），把能填的填上
 */
export async function fillFutureReturns(
  rebalanceDays: 5 | 20 = 5
): Promise<{ filled: number; skipped: number; horizon: number }> {
  if (!isBrowser()) return { filled: 0, skipped: 0, horizon: 0 };
  const table = db.factorSnapshots;
  if (!table) return { filled: 0, skipped: 0, horizon: 0 };

  const field = rebalanceDays === 5 ? 'return5d' : 'return20d';
  const priceField = rebalanceDays === 5 ? 'priceNext5' : 'priceNext20';

  try {
    const all = await table.toArray();
    // 已填的跳过
    const toFill = all.filter(s => s[field] === undefined);
    let filled = 0;
    let skipped = 0;
    const ts = Date.now();

    // 建索引：code → 最新快照
    const byCode = new Map<string, DbFactorSnapshot[]>();
    for (const s of all) {
      if (!byCode.has(s.code)) byCode.set(s.code, []);
      byCode.get(s.code)!.push(s);
    }
    Array.from(byCode.values()).forEach(list => {
      list.sort((a, b) => a.date.localeCompare(b.date));
    });

    const updates: DbFactorSnapshot[] = [];
    for (const snap of toFill) {
      const history = byCode.get(snap.code) || [];
      // 找 snap.date + rebalanceDays 天的快照
      const target = findDateAhead(history, snap.date, rebalanceDays);
      if (target && target.price > 0) {
        const ret = ((target.price - snap.price) / snap.price) * 100;
        const updated: DbFactorSnapshot = {
          ...snap,
          [priceField]: target.price,
          [field]: Math.round(ret * 100) / 100,
          filledAt: ts,
        };
        updates.push(updated);
        filled++;
      } else {
        skipped++;
      }
    }

    if (updates.length > 0) {
      await table.bulkPut(updates);
    }
    return { filled, skipped, horizon: rebalanceDays };
  } catch (e) {
    console.warn('[snapshot] fillFutureReturns failed:', (e as Error).message);
    return { filled: 0, skipped: 0, horizon: 0 };
  }
}

/**
 * 找比 fromDate 晚 N 天的最近快照（A 股有节假日，要找最近的交易日）
 */
function findDateAhead(
  sortedHistory: DbFactorSnapshot[],
  fromDate: string,
  n: number
): DbFactorSnapshot | null {
  // 简化：A 股交易日从 fromDate 算起第 5/20 个交易日（含节假日会更多）
  // 业界标准：直接用日历日 +5/+20，然后找最近的可交易日
  // 简单实现：跳过周末 + 找最早的 ≥ 目标日的快照
  const target = new Date(
    `${fromDate.slice(0, 4)}-${fromDate.slice(4, 6)}-${fromDate.slice(6, 8)}`
  );
  target.setDate(target.getDate() + n);
  const targetStr = `${target.getFullYear()}${String(target.getMonth() + 1).padStart(2, '0')}${String(target.getDate()).padStart(2, '0')}`;

  // 找 date >= targetStr 的最早一条
  for (const s of sortedHistory) {
    if (s.date >= targetStr) return s;
  }
  return null;
}

/**
 * 查某只票的历史 raw 因子时序（按日期升序）
 */
export async function getHistoricalSnapshotsByCode(
  code: string,
  limit: number = 120
): Promise<DbFactorSnapshot[]> {
  if (!isBrowser()) return [];
  const table = db.factorSnapshots;
  if (!table) return [];
  try {
    const all = await table.where('code').equals(code).toArray();
    return all.sort((a, b) => a.date.localeCompare(b.date)).slice(-limit);
  } catch (e) {
    console.warn('[snapshot] getHistory failed:', (e as Error).message);
    return [];
  }
}

/**
 * 查某天的所有快照
 */
export async function getSnapshotsByDate(date: string): Promise<DbFactorSnapshot[]> {
  if (!isBrowser()) return [];
  const table = db.factorSnapshots;
  if (!table) return [];
  try {
    return await table.where('date').equals(date).toArray();
  } catch (e) {
    return [];
  }
}

/**
 * 只查"已填完未来收益"的快照（用于 WF 真实回测）
 */
export async function getFilledSnapshots(
  rebalanceDays: 5 | 20 = 5,
  lookbackDays: number = 120
): Promise<DbFactorSnapshot[]> {
  if (!isBrowser()) return [];
  const table = db.factorSnapshots;
  if (!table) return [];
  const field = rebalanceDays === 5 ? 'return5d' : 'return20d';
  try {
    const all = await table.toArray();
    // 算"足够早"的截止日期（lookbackDays 天前）
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);
    const cutoffStr = `${cutoff.getFullYear()}${String(cutoff.getMonth() + 1).padStart(2, '0')}${String(cutoff.getDate()).padStart(2, '0')}`;

    return all
      .filter(s => s[field] !== undefined && s.date <= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (e) {
    return [];
  }
}

/**
 * 清理过期快照（保留最近 N 天）
 */
export async function pruneOldSnapshots(
  retentionDays: number = DEFAULT_RETENTION_DAYS
): Promise<number> {
  if (!isBrowser()) return 0;
  const table = db.factorSnapshots;
  if (!table) return 0;

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffStr = `${cutoff.getFullYear()}${String(cutoff.getMonth() + 1).padStart(2, '0')}${String(cutoff.getDate()).padStart(2, '0')}`;

    const all = await table.toArray();
    const toDelete = all.filter(s => s.date < cutoffStr);
    if (toDelete.length > 0) {
      await table.bulkDelete(toDelete.map(s => s.id));
    }
    return toDelete.length;
  } catch (e) {
    return 0;
  }
}

/**
 * 统计：当前有多少条快照，已填未来收益的有多少
 */
export async function getSnapshotStats(): Promise<{
  total: number;
  filled5d: number;
  filled20d: number;
  uniqueCodes: number;
  dateRange: { earliest: string; latest: string } | null;
}> {
  if (!isBrowser()) return { total: 0, filled5d: 0, filled20d: 0, uniqueCodes: 0, dateRange: null };
  const table = db.factorSnapshots;
  if (!table) return { total: 0, filled5d: 0, filled20d: 0, uniqueCodes: 0, dateRange: null };

  try {
    const all = await table.toArray();
    const codes = new Set(all.map(s => s.code));
    const dates = all.map(s => s.date).sort();
    return {
      total: all.length,
      filled5d: all.filter(s => s.return5d !== undefined).length,
      filled20d: all.filter(s => s.return20d !== undefined).length,
      uniqueCodes: codes.size,
      dateRange: dates.length > 0 ? { earliest: dates[0], latest: dates[dates.length - 1] } : null,
    };
  } catch (e) {
    return { total: 0, filled5d: 0, filled20d: 0, uniqueCodes: 0, dateRange: null };
  }
}