/**
 * 量化交易系统 - Dexie 数据库实例
 * 基于 IndexedDB 的本地持久化层
 */

import Dexie, { type Table } from 'dexie';
import type {
  DbStrategy,
  DbStrategyBinding,
  DbWatchlist,
  DbAccount,
  DbPosition,
  DbTradeRecord,
  DbEquityPoint,
  DbOrder,
  DbUser,
  DbScreenerHistory,
  DbFactorICRecord,
  DbFactorAnalysisSummary,
  DbStockScore,
  DbStockCache,
  DbWalkforwardReport,  // v2.1.1（2026-06-15）
  DbFactorSnapshot,  // v3.0（2026-06-15）
} from './schema';

export * from './schema';

// ==================== 数据库类 ====================

class QuantDatabase extends Dexie {
  strategies!: Table<DbStrategy>;
  strategyBindings!: Table<DbStrategyBinding>;
  watchlists!: Table<DbWatchlist>;
  accounts!: Table<DbAccount>;
  positions!: Table<DbPosition>;
  tradeRecords!: Table<DbTradeRecord>;
  equityPoints!: Table<DbEquityPoint>;
  orders!: Table<DbOrder>;
  users!: Table<DbUser>;
  screenerHistory!: Table<DbScreenerHistory>;
  factorICRecords!: Table<DbFactorICRecord>;
  factorAnalysisSummary!: Table<DbFactorAnalysisSummary>;
  stockScores!: Table<DbStockScore>;
  stockCache!: Table<DbStockCache>;
  walkforwardReports!: Table<DbWalkforwardReport>;  // v2.1.1（2026-06-15）
  factorSnapshots!: Table<DbFactorSnapshot>;  // v3.0（2026-06-15）

  constructor() {
    super('OpenMAIC_Quant');

    // Version 1: 初始版本
    // Version 2: 添加 userId 字段支持多用户数据隔离
    this.version(1).stores({
      strategies: 'id, name, type, enabled, createdAt, updatedAt, *tags',
      strategyBindings: 'id, strategyId, accountId, [strategyId+accountId]',
      watchlists: 'id, name, sortOrder, createdAt, updatedAt',
      accounts: 'id, name, status, createdAt, updatedAt',
      positions: 'id, accountId, code, [accountId+code]',
      tradeRecords: 'id, accountId, timestamp, code, [accountId+timestamp], [accountId+code]',
      equityPoints: 'id, accountId, date, [accountId+date]',
      orders: 'id, accountId, status, timestamp, [accountId+status], [accountId+timestamp]',
      users: 'id, createdAt, supabaseUserId',
    });

    this.version(2).stores({
      // userId 索引用于多用户数据隔离
      strategies: 'id, userId, name, type, enabled, createdAt, updatedAt, *tags',
      strategyBindings: 'id, userId, strategyId, accountId, [strategyId+accountId]',
      watchlists: 'id, userId, name, sortOrder, createdAt, updatedAt',
      accounts: 'id, userId, name, status, createdAt, updatedAt',
      // positions/equityPoints/tradeRecords/orders 通过 accountId → accounts.userId 间接隔离
      positions: 'id, accountId, code, [accountId+code]',
      tradeRecords: 'id, accountId, timestamp, code, [accountId+timestamp], [accountId+code]',
      equityPoints: 'id, accountId, date, [accountId+date]',
      orders: 'id, accountId, status, timestamp, [accountId+status], [accountId+timestamp]',
      users: 'id, createdAt, supabaseUserId',
    });

    this.version(3).stores({
      // 选股历史表
      screenerHistory: 'id, userId, timestamp',
    });

    this.version(4).stores({
      // DbAccount 新增 tradingCodes/strategyType/ensembleType 字段（刷新后重建策略用）
      accounts: 'id, userId, name, status, createdAt, updatedAt',
    });

  this.version(5).stores({
    // 多因子 IC/IR 分析表
    factorICRecords: 'id, date, code, [date+code], nextReturn5, nextReturn20',
    factorAnalysisSummary: 'id, factorName, period, date, [factorName+period]',
    stockScores: 'id, date, code, period, [date+period+code], compositeScore',
  });

  this.version(6).stores({
    // 股票数据缓存：基本面/新闻/公告/异动/K线统一缓存表
    stockCache: 'id, type, code, [type+code], fetchedAt',
  });

  this.version(7).stores({
    // 升级 stockScores：加 scoreVersion 字段（v1/v2 双版本共存）+ id 加版本后缀
    //   旧 id = `${code}_${period}`（如 "sh600519_5d"）
    //   新 id = `${code}_${period}_${scoreVersion}`（如 "sh600519_5d_v2"）
    // 旧数据保留但不可索引（仍可读），新写入按 [date+period+scoreVersion+code] 复合索引精确查询
    factorICRecords: 'id, date, code, [date+code], nextReturn5, nextReturn20',
    factorAnalysisSummary: 'id, factorName, period, date, [factorName+period]',
    stockScores: 'id, date, code, period, scoreVersion, [date+period+scoreVersion], [date+period+scoreVersion+code], compositeScore',
    stockCache: 'id, type, code, [type+code], fetchedAt',
  });

  this.version(8).stores({
    // v2.1.1（2026-06-15）：Walk-Forward 验证报告快照
    //   id 格式：`${date}_${period}_${weightMode}_${longMomentum ? 'L' : 'S'}`
    //   保证"同一天同一配置"只保留最新一条（用 put 而不是 add）
    factorICRecords: 'id, date, code, [date+code], nextReturn5, nextReturn20',
    factorAnalysisSummary: 'id, factorName, period, date, [factorName+period]',
    stockScores: 'id, date, code, period, scoreVersion, [date+period+scoreVersion], [date+period+scoreVersion+code], compositeScore',
    stockCache: 'id, type, code, [type+code], fetchedAt',
    walkforwardReports: 'id, date, period, weightMode, [date+period+weightMode], timestamp',
  });

  this.version(9).stores({
    // v3.0（2026-06-15）：每日 raw 因子快照表
    //   用途：WF 真实收益回测 + 历史 IC 统计
    //   id 格式：`${date}_${code}`（每天每票一条）
    //   复合索引：[date+code] 用于查某天的所有股票
    //   复合索引：[code+date] 用于查某只股票的历史因子时序
    factorICRecords: 'id, date, code, [date+code], nextReturn5, nextReturn20',
    factorAnalysisSummary: 'id, factorName, period, date, [factorName+period]',
    stockScores: 'id, date, code, period, scoreVersion, [date+period+scoreVersion], [date+period+scoreVersion+code], compositeScore',
    stockCache: 'id, type, code, [type+code], fetchedAt',
    walkforwardReports: 'id, date, period, weightMode, [date+period+weightMode], timestamp',
    factorSnapshots: 'id, date, code, industry, [date+code], [code+date], [date+industry]',
  });
}
}

// 单例数据库实例（懒加载，Node.js 下不初始化）
let _db: QuantDatabase | null = null;
let _dbInitAttempted = false;

export function getQuantDb(): QuantDatabase | null {
  if (typeof window === 'undefined') return null; // Node.js 下返回 null
  if (_db) return _db;
  if (_dbInitAttempted) return null;
  _dbInitAttempted = true;
  try {
    _db = new QuantDatabase();
  } catch (e) {
    console.warn('[QuantDB] Failed to initialize IndexedDB:', e);
    return null;
  }
  return _db;
}

// ==================== 懒初始化的表访问（API route 安全） ====================

export const db = {
  get accounts() { const d = getQuantDb(); return d?.accounts ?? null; },
  get positions() { const d = getQuantDb(); return d?.positions ?? null; },
  get orders() { const d = getQuantDb(); return d?.orders ?? null; },
  get tradeRecords() { const d = getQuantDb(); return d?.tradeRecords ?? null; },
  get equityPoints() { const d = getQuantDb(); return d?.equityPoints ?? null; },
  get strategies() { const d = getQuantDb(); return d?.strategies ?? null; },
  get strategyBindings() { const d = getQuantDb(); return d?.strategyBindings ?? null; },
  get watchlists() { const d = getQuantDb(); return d?.watchlists ?? null; },
  get users() { const d = getQuantDb(); return d?.users ?? null; },
  get screenerHistory() { const d = getQuantDb(); return d?.screenerHistory ?? null; },
  get factorICRecords() { const d = getQuantDb(); return d?.factorICRecords ?? null; },
  get factorAnalysisSummary() { const d = getQuantDb(); return d?.factorAnalysisSummary ?? null; },
  get stockScores() { const d = getQuantDb(); return d?.stockScores ?? null; },
  get stockCache() { const d = getQuantDb(); return d?.stockCache ?? null; },
  get walkforwardReports() { const d = getQuantDb(); return d?.walkforwardReports ?? null; },  // v2.1.1
  get factorSnapshots() { const d = getQuantDb(); return d?.factorSnapshots ?? null; },  // v3.0
// transaction 方法代理，支持 db.transaction('rw', db.accounts!, ...)
  transaction(mode: Parameters<QuantDatabase['transaction']>[0], tables: Table<any, any, any>[], scope: () => Promise<void>): Promise<void> {
    const d = getQuantDb();
    if (!d) throw new Error('IndexedDB not available');
    return d.transaction(mode, tables, scope) as Promise<void>;
  },

  // 主动触发数据库打开（用于预热）
  open(): void {
    const d = getQuantDb();
    if (d) d.open();
  },
};
