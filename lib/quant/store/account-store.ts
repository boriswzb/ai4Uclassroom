/**
 * 模拟账户 Store
 * 账户 + 持仓 + 订单 + 成交记录 完整生命周期
 * 状态存储于 Dexie (IndexedDB)，刷新不丢失
 */

import { create } from 'zustand';
import { nanoid } from 'nanoid';
import {
  db,
} from '../db/database';
import type {
  DbAccount,
  DbPosition,
  DbTradeRecord,
  DbEquityPoint,
  DbOrder,
  AccountStatus,
} from '../db/schema';
import type { Direction, Position as QuantPosition, Order as QuantOrder } from '../types';

// ==================== 类型 ====================

export interface AccountItem {
  id: string;
  name: string;
  description?: string;
  initialCash: number;
  currentCash: number;
  frozen: number;
  totalAssets: number;
  status: AccountStatus;
  autoPilot: boolean;
  boundStrategies: string[];
  maxPositionPct: number;
  stopLossPct: number;
  takeProfitPct: number;
  totalPnL: number;
  createdAt: number;
  updatedAt: number;
}

export interface PositionItem {
  id: string;
  accountId: string;
  code: string;
  name?: string;
  volume: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  realizedPnL: number;
  frozenVolume: number;
  updatedAt: number;
  buyDate?: string;
}

export interface TradeRecordItem {
  id: string;
  accountId: string;
  timestamp: number;
  code: string;
  name?: string;
  direction: Direction;
  price: number;
  volume: number;
  commission: number;
  pnl: number;
  strategyId?: string;
}

export interface EquityPointItem {
  id: string;
  accountId: string;
  date: string;
  equity: number;
  cash: number;
  positionValue: number;
  dailyReturn: number;
  benchmarkEquity?: number;
}

export interface OrderItem {
  id: string;
  accountId: string;
  code: string;
  direction: Direction;
  type: 'market' | 'limit';
  price: number;
  volume: number;
  filledVolume: number;
  status: 'pending' | 'filled' | 'partial' | 'cancelled' | 'rejected';
  timestamp: number;
  strategyId?: string;
}

interface AccountStore {
  // 状态
  accounts: AccountItem[];
  positions: Map<string, PositionItem[]>; // accountId -> positions
  recentTrades: Map<string, TradeRecordItem[]>; // accountId -> last 50 trades
  isLoaded: boolean;
  currentUserId: string | null;

  // ── 用户切换 ──────────────────────────────────

  /** 设置当前用户（切换用户时调用） */
  setCurrentUser: (userId: string) => void;

  /** 清空状态（登出时调用） */
  clearState: () => void;

  // ── 加载 ──────────────────────────────────

  /** 从 IndexedDB 加载当前用户的所有账户数据 */
  loadFromDb: (userId: string) => Promise<void>;

  /** 恢复指定账户的持仓和最新状态（模拟交易重启时调用） */
  restoreAccount: (accountId: string) => Promise<{
    account: AccountItem;
    positions: PositionItem[];
    recentTrades: TradeRecordItem[];
  } | null>;

  // ── 账户 CRUD ──────────────────────────────────

  createAccount: (params: {
    name: string;
    description?: string;
    initialCash: number;
    maxPositionPct?: number;
    stopLossPct?: number;
    takeProfitPct?: number;
  }) => Promise<string>;

  updateAccount: (id: string, updates: Partial<AccountItem>) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;

  /** 切换自动驾驶 */
  setAutoPilot: (accountId: string, enabled: boolean) => Promise<void>;

  /** 绑定/解绑策略 */
  bindStrategy: (accountId: string, strategyId: string) => Promise<void>;
  unbindStrategy: (accountId: string, strategyId: string) => Promise<void>;

  // ── 持仓操作 ──────────────────────────────────

  /** 更新持仓（成交后调用） */
  updatePosition: (accountId: string, position: Omit<PositionItem, 'id' | 'accountId' | 'updatedAt'>) => Promise<void>;

  /** 删除持仓（全卖后） */
  removePosition: (accountId: string, code: string) => Promise<void>;

  /** 批量更新持仓（从行情数据刷新当前价） */
  refreshPositions: (accountId: string, quotes: { code: string; price: number }[]) => Promise<void>;

  // ── 成交记录 ──────────────────────────────────

  /** 记录一笔成交 */
  addTradeRecord: (record: Omit<TradeRecordItem, 'id'>) => Promise<void>;

  /** 批量加载成交记录 */
  getTradeRecords: (accountId: string, limit?: number) => Promise<TradeRecordItem[]>;

  // ── 净值记录 ──────────────────────────────────

  /** 记录每日净值（收盘时） */
  recordEquityPoint: (accountId: string, data: Omit<EquityPointItem, 'id' | 'accountId'>) => Promise<void>;

  /** 获取净值曲线 */
  getEquityCurve: (accountId: string) => Promise<EquityPointItem[]>;

  // ── 订单操作 ──────────────────────────────────

  addOrder: (order: Omit<OrderItem, 'id'>) => Promise<string>;
  updateOrder: (orderId: string, updates: Partial<OrderItem>) => Promise<void>;
  getOrders: (accountId: string, status?: OrderItem['status']) => Promise<OrderItem[]>;

  // ── 账户资金同步 ──────────────────────────────────

  /** 更新账户资金（买入/卖出后） */
  syncAccountCash: (accountId: string) => Promise<void>;
}

// ==================== 实现 ====================

function now() { return Date.now(); }

export const useAccountStore = create<AccountStore>((set, get) => ({
  accounts: [],
  positions: new Map(),
  recentTrades: new Map(),
  isLoaded: false,
  currentUserId: null,

  // ── 用户切换 ──────────────────────────────────

  setCurrentUser: (userId) => {
    set({ currentUserId: userId });
  },

  clearState: () => {
    set({ accounts: [], positions: new Map(), recentTrades: new Map(), isLoaded: false });
  },

  // ── 加载 ──────────────────────────────────

  loadFromDb: async (userId) => {
    set({ currentUserId: userId });
    // 按 userId 过滤，只加载当前用户的账户
    const accounts = await db.accounts!.where('userId').equals(userId).toArray();
    const accountItems: AccountItem[] = accounts.map(a => ({
      id: a.id,
      name: a.name,
      description: a.description,
      initialCash: a.initialCash,
      currentCash: a.currentCash,
      frozen: a.frozen,
      totalAssets: a.totalAssets,
      status: a.status,
      autoPilot: a.autoPilot,
      boundStrategies: a.boundStrategies,
      maxPositionPct: a.maxPositionPct,
      stopLossPct: a.stopLossPct,
      takeProfitPct: a.takeProfitPct,
      totalPnL: a.totalPnL,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }));

    // 加载所有持仓
    const allPositions = await db.positions!.toArray();
    const posMap = new Map<string, PositionItem[]>();
    for (const p of allPositions) {
      const item: PositionItem = {
        id: p.id,
        accountId: p.accountId,
        code: p.code,
        name: p.name,
        volume: p.volume,
        avgCost: p.avgCost,
        currentPrice: p.currentPrice,
        marketValue: p.marketValue,
        unrealizedPnL: p.unrealizedPnL,
        realizedPnL: p.realizedPnL,
        frozenVolume: p.frozenVolume,
        updatedAt: p.updatedAt,
      };
      if (!posMap.has(p.accountId)) posMap.set(p.accountId, []);
      posMap.get(p.accountId)!.push(item);
    }

    // 加载最近成交（每个账户50条）
    const allTrades = await db.tradeRecords!.orderBy('timestamp').reverse().limit(500).toArray();
    const tradeMap = new Map<string, TradeRecordItem[]>();
    for (const t of allTrades) {
      const item: TradeRecordItem = {
        id: t.id,
        accountId: t.accountId,
        timestamp: t.timestamp,
        code: t.code,
        name: t.name,
        direction: t.direction,
        price: t.price,
        volume: t.volume,
        commission: t.commission,
        pnl: t.pnl,
        strategyId: t.strategyId,
      };
      if (!tradeMap.has(t.accountId)) tradeMap.set(t.accountId, []);
      if (tradeMap.get(t.accountId)!.length < 50) {
        tradeMap.get(t.accountId)!.push(item);
      }
    }

    set({ accounts: accountItems, positions: posMap, recentTrades: tradeMap, isLoaded: true });
  },

  restoreAccount: async (accountId) => {
    const account = await db.accounts!.get(accountId);
    if (!account) return null;

    const positions = await db.positions!.where('accountId').equals(accountId).toArray();
    const trades = await db.tradeRecords!
      .where('accountId').equals(accountId)
      .reverse()
      .limit(50)
      .toArray();

    return {
      account: {
        id: account.id,
        name: account.name,
        description: account.description,
        initialCash: account.initialCash,
        currentCash: account.currentCash,
        frozen: account.frozen,
        totalAssets: account.totalAssets,
        status: account.status,
        autoPilot: account.autoPilot,
        boundStrategies: account.boundStrategies,
        maxPositionPct: account.maxPositionPct,
        stopLossPct: account.stopLossPct,
        takeProfitPct: account.takeProfitPct,
        totalPnL: account.totalPnL,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      },
      positions: positions.map(p => ({
        id: p.id,
        accountId: p.accountId,
        code: p.code,
        name: p.name,
        volume: p.volume,
        avgCost: p.avgCost,
        currentPrice: p.currentPrice,
        marketValue: p.marketValue,
        unrealizedPnL: p.unrealizedPnL,
        realizedPnL: p.realizedPnL,
        frozenVolume: p.frozenVolume,
        updatedAt: p.updatedAt,
      })),
      recentTrades: trades.reverse().map(t => ({
        id: t.id,
        accountId: t.accountId,
        timestamp: t.timestamp,
        code: t.code,
        name: t.name,
        direction: t.direction,
        price: t.price,
        volume: t.volume,
        commission: t.commission,
        pnl: t.pnl,
        strategyId: t.strategyId,
      })),
    };
  },

  // ── 账户 ──────────────────────────────────

  createAccount: async ({ name, description, initialCash, maxPositionPct = 0.2, stopLossPct = 0.07, takeProfitPct = 0.15 }) => {
    const userId = get().currentUserId;
    if (!userId) throw new Error('User not authenticated');
    const id = nanoid();
    const t = now();
    const row: DbAccount = {
      id,
      userId,
      name,
      description,
      initialCash,
      currentCash: initialCash,
      frozen: 0,
      totalAssets: initialCash,
      status: 'paused',
      autoPilot: false,
      boundStrategies: [],
      maxPositionPct,
      stopLossPct,
      takeProfitPct,
      totalPnL: 0,
      createdAt: t,
      updatedAt: t,
    };
    await db.accounts!.add(row);
    const item: AccountItem = { ...row };
    set(state => ({ accounts: [...state.accounts, item] }));
    return id;
  },

  updateAccount: async (id, updates) => {
    const t = now();
    const row: Partial<DbAccount> = { updatedAt: t };
    if (updates.name !== undefined) row.name = updates.name;
    if (updates.description !== undefined) row.description = updates.description;
    if (updates.status !== undefined) row.status = updates.status;
    if (updates.autoPilot !== undefined) row.autoPilot = updates.autoPilot;
    if (updates.currentCash !== undefined) row.currentCash = updates.currentCash;
    if (updates.frozen !== undefined) row.frozen = updates.frozen;
    if (updates.totalAssets !== undefined) row.totalAssets = updates.totalAssets;
    if (updates.totalPnL !== undefined) row.totalPnL = updates.totalPnL;
    if (updates.boundStrategies !== undefined) row.boundStrategies = updates.boundStrategies;
    if (updates.maxPositionPct !== undefined) row.maxPositionPct = updates.maxPositionPct;
    if (updates.stopLossPct !== undefined) row.stopLossPct = updates.stopLossPct;
    if (updates.takeProfitPct !== undefined) row.takeProfitPct = updates.takeProfitPct;

    await db.accounts!.update(id, row);
    set(state => ({
      accounts: state.accounts.map(a =>
        a.id === id ? { ...a, ...updates, updatedAt: t } : a
      ),
    }));
  },

  deleteAccount: async (id) => {
    await db.transaction('rw', [db.accounts!, db.positions!, db.tradeRecords!, db.equityPoints!, db.orders!], async () => {
      await db.accounts!.delete(id);
      await db.positions!.where('accountId').equals(id).delete();
      await db.tradeRecords!.where('accountId').equals(id).delete();
      await db.equityPoints!.where('accountId').equals(id).delete();
      await db.orders!.where('accountId').equals(id).delete();
    });
    set(state => {
      const newPositions = new Map(state.positions);
      newPositions.delete(id);
      const newTrades = new Map(state.recentTrades);
      newTrades.delete(id);
      return {
        accounts: state.accounts.filter(a => a.id !== id),
        positions: newPositions,
        recentTrades: newTrades,
      };
    });
  },

  setAutoPilot: async (accountId, enabled) => {
    await get().updateAccount(accountId, { autoPilot: enabled, status: enabled ? 'running' : 'paused' });
  },

  bindStrategy: async (accountId, strategyId) => {
    const acc = get().accounts.find(a => a.id === accountId);
    if (!acc || acc.boundStrategies.includes(strategyId)) return;
    const boundStrategies = [...acc.boundStrategies, strategyId];
    await get().updateAccount(accountId, { boundStrategies });
  },

  unbindStrategy: async (accountId, strategyId) => {
    const acc = get().accounts.find(a => a.id === accountId);
    if (!acc) return;
    const boundStrategies = acc.boundStrategies.filter(id => id !== strategyId);
    await get().updateAccount(accountId, { boundStrategies });
  },

  // ── 持仓 ──────────────────────────────────

  updatePosition: async (accountId, position) => {
    const existing = await db.positions!.where({ accountId, code: position.code }).first();
    const t = now();

    if (existing) {
      await db.positions!.update(existing.id, {
        volume: position.volume,
        avgCost: position.avgCost,
        currentPrice: position.currentPrice,
        marketValue: position.marketValue,
        unrealizedPnL: position.unrealizedPnL,
        realizedPnL: position.realizedPnL,
        frozenVolume: position.frozenVolume,
        updatedAt: t,
      });
    } else {
      const row: DbPosition = {
        id: nanoid(),
        accountId,
        code: position.code,
        name: position.name,
        volume: position.volume,
        avgCost: position.avgCost,
        currentPrice: position.currentPrice,
        marketValue: position.marketValue,
        unrealizedPnL: position.unrealizedPnL,
        realizedPnL: position.realizedPnL,
        frozenVolume: position.frozenVolume,
        updatedAt: t,
        buyDate: position.buyDate ?? '',
      };
      await db.positions!.add(row);
    }

    // 更新内存状态
    set(state => {
      const newPositions = new Map(state.positions);
      const existing = newPositions.get(accountId) || [];
      const idx = existing.findIndex(p => p.code === position.code);
      const updated: PositionItem = {
        id: existing[idx]?.id || nanoid(),
        accountId,
        code: position.code,
        name: position.name,
        volume: position.volume,
        avgCost: position.avgCost,
        currentPrice: position.currentPrice,
        marketValue: position.marketValue,
        unrealizedPnL: position.unrealizedPnL,
        realizedPnL: position.realizedPnL,
        frozenVolume: position.frozenVolume,
        updatedAt: t,
      };
      if (idx >= 0) {
        existing[idx] = updated;
        newPositions.set(accountId, [...existing]);
      } else {
        newPositions.set(accountId, [...existing, updated]);
      }
      return { positions: newPositions };
    });
  },

  removePosition: async (accountId, code) => {
    await db.positions!.where({ accountId, code }).delete();
    set(state => {
      const newPositions = new Map(state.positions);
      const existing = newPositions.get(accountId) || [];
      newPositions.set(accountId, existing.filter(p => p.code !== code));
      return { positions: newPositions };
    });
  },

  refreshPositions: async (accountId, quotes) => {
    const positions = get().positions.get(accountId) || [];
    const quoteMap = new Map(quotes.map(q => [q.code, q.price]));

    for (const pos of positions) {
      const price = quoteMap.get(pos.code);
      if (price !== undefined && price !== pos.currentPrice) {
        const marketValue = pos.volume * price;
        const unrealizedPnL = marketValue - pos.volume * pos.avgCost;
        await get().updatePosition(accountId, {
          code: pos.code,
          name: pos.name,
          volume: pos.volume,
          avgCost: pos.avgCost,
          currentPrice: price,
          marketValue,
          unrealizedPnL,
          realizedPnL: pos.realizedPnL,
          frozenVolume: pos.frozenVolume,
        });
      }
    }
  },

  // ── 成交记录 ──────────────────────────────────

  addTradeRecord: async (record) => {
    const id = nanoid();
    const row: DbTradeRecord = {
      id,
      accountId: record.accountId,
      timestamp: record.timestamp,
      code: record.code,
      name: record.name,
      direction: record.direction,
      price: record.price,
      volume: record.volume,
      commission: record.commission,
      pnl: record.pnl,
      strategyId: record.strategyId,
    };
    await db.tradeRecords!.add(row);

    set(state => {
      const newTrades = new Map(state.recentTrades);
      const existing = newTrades.get(record.accountId) || [];
      const updated = [{
        id,
        accountId: record.accountId,
        timestamp: record.timestamp,
        code: record.code,
        name: record.name,
        direction: record.direction,
        price: record.price,
        volume: record.volume,
        commission: record.commission,
        pnl: record.pnl,
        strategyId: record.strategyId,
      }, ...existing].slice(0, 50);
      newTrades.set(record.accountId, updated);
      return { recentTrades: newTrades };
    });
  },

  getTradeRecords: async (accountId, limit = 50) => {
    const rows = await db.tradeRecords!
      .where('accountId').equals(accountId)
      .reverse()
      .limit(limit)
      .toArray();
    return rows.map(t => ({
      id: t.id,
      accountId: t.accountId,
      timestamp: t.timestamp,
      code: t.code,
      name: t.name,
      direction: t.direction,
      price: t.price,
      volume: t.volume,
      commission: t.commission,
      pnl: t.pnl,
      strategyId: t.strategyId,
    }));
  },

  // ── 净值 ──────────────────────────────────

  recordEquityPoint: async (accountId, data) => {
    const id = nanoid();
    const row: DbEquityPoint = { id, accountId, ...data };
    await db.equityPoints!.add(row);
  },

  getEquityCurve: async (accountId) => {
    const rows = await db.equityPoints!
      .where('accountId').equals(accountId)
      .sortBy('date');
    return rows.map(r => ({
      id: r.id,
      accountId: r.accountId,
      date: r.date,
      equity: r.equity,
      cash: r.cash,
      positionValue: r.positionValue,
      dailyReturn: r.dailyReturn,
      benchmarkEquity: r.benchmarkEquity,
    }));
  },

  // ── 订单 ──────────────────────────────────

  addOrder: async (order) => {
    const id = nanoid();
    const row: DbOrder = { id, ...order };
    await db.orders!.add(row);
    return id;
  },

  updateOrder: async (orderId, updates) => {
    await db.orders!.update(orderId, updates);
  },

  getOrders: async (accountId, status) => {
    let query = db.orders!.where('accountId').equals(accountId);
    if (status) {
      const rows = await query.toArray();
      return rows.filter(r => r.status === status).map(r => ({
        id: r.id,
        accountId: r.accountId,
        code: r.code,
        direction: r.direction,
        type: r.type,
        price: r.price,
        volume: r.volume,
        filledVolume: r.filledVolume,
        status: r.status,
        timestamp: r.timestamp,
        strategyId: r.strategyId,
      }));
    }
    const rows = await query.toArray();
    return rows.map(r => ({
      id: r.id,
      accountId: r.accountId,
      code: r.code,
      direction: r.direction,
      type: r.type,
      price: r.price,
      volume: r.volume,
      filledVolume: r.filledVolume,
      status: r.status,
      timestamp: r.timestamp,
      strategyId: r.strategyId,
    }));
  },

  // ── 资金同步 ──────────────────────────────────

  syncAccountCash: async (accountId) => {
    const positions = get().positions.get(accountId) || [];
    const totalPositionValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
    const totalRealizedPnL = positions.reduce((sum, p) => sum + p.realizedPnL, 0);
    const frozen = positions.reduce((sum, p) => sum + p.frozenVolume * p.avgCost, 0);

    const acc = get().accounts.find(a => a.id === accountId);
    if (!acc) return;

    const totalAssets = acc.currentCash + totalPositionValue;
    const totalPnL = totalAssets - acc.initialCash;

    await get().updateAccount(accountId, {
      currentCash: acc.currentCash,
      frozen,
      totalAssets,
      totalPnL,
    });
  },
}));
