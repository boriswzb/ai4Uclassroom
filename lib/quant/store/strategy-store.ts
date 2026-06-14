/**
 * 策略管理 Store
 * 状态存储于 Dexie (IndexedDB)，刷新不丢失
 * 策略配置 + 回测结果完整生命周期管理
 */

import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { db } from '../db/database';
import type { DbStrategy, EnsembleModeDb } from '../db/schema';
import type { BacktestResultV2 } from '../types';
import type { Direction } from '../types';

// ==================== 类型 ====================

type StrategyId = 'macd' | 'kdj' | 'ma' | 'bollinger' | 'rsi';

export interface StrategyItem {
  id: string;
  name: string;
  type: StrategyId;         // 'macd' | 'kdj' | 'ma' | 'bollinger' | 'rsi'
  desc: string;
  status: 'running' | 'stopped' | 'untested';
  params: Record<string, string>; // UI参数（字符串，用于配置面板）
  enabled: boolean;
  tags: string[];
  // 回测结果（保存在 strategies 表的 extra 字段）
  cumulativeReturn?: number;
  winRate?: number;
  totalTrades?: number;
  backtestResult?: BacktestResultV2;
  // 绑定的股票
  boundStocks: string[];
  createdAt: number;
  updatedAt: number;
}

export interface EnsembleItem {
  id: string;
  name: string;
  type: 'ensemble';
  ensembleMode: EnsembleModeDb; // 'voting' | 'filter' | 'weighted' | 'dynamic'
  desc: string;
  status: 'running' | 'stopped' | 'untested';
  enabled: boolean;
  subStrategies: string[];     // 子策略ID列表
  weights?: number[];
  backtestResult?: BacktestResultV2;
  boundStocks: string[];
  createdAt: number;
  updatedAt: number;
}

interface StrategyStore {
  // 状态
  strategies: StrategyItem[];
  ensembles: EnsembleItem[];
  isLoaded: boolean;
  currentUserId: string | null; // 当前登录用户 ID

  // 加载（从 Dexie 读入内存，按 userId 隔离）
  loadFromDb: (userId: string) => Promise<void>;

  // 设置当前用户（切换用户时调用）
  setCurrentUser: (userId: string) => void;

  // 清空状态（登出时调用）
  clearState: () => void;

  // 单策略 CRUD
  addStrategy: (item: Omit<StrategyItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  updateStrategy: (id: string, updates: Partial<Omit<StrategyItem, 'id' | 'createdAt'>>) => Promise<void>;
  removeStrategy: (id: string) => Promise<void>;
  toggleStrategy: (id: string) => Promise<void>;
  updateBacktestResult: (id: string, result: BacktestResultV2, stockCode: string) => Promise<void>;

  // 组合策略 CRUD
  addEnsemble: (item: Omit<EnsembleItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  updateEnsemble: (id: string, updates: Partial<Omit<EnsembleItem, 'id' | 'createdAt'>>) => Promise<void>;
  removeEnsemble: (id: string) => Promise<void>;

  // 股票绑定管理
  bindStocks: (id: string, codes: string[]) => Promise<void>;
  unbindStock: (id: string, code: string) => Promise<void>;

  // 同步运行状态
  setRunningStatus: (id: string, status: 'running' | 'stopped' | 'untested') => Promise<void>;
}

// ==================== 常量 ====================

const STRATEGY_DEFS: Record<StrategyId, { name: string; desc: string; params: { label: string; default: string }[] }> = {
  macd: {
    name: 'MACD 金叉策略',
    desc: 'DIF 上穿 DEA 买入，下穿卖出；适用于趋势型行情',
    params: [
      { label: '快线周期', default: '12' },
      { label: '慢线周期', default: '26' },
      { label: '信号线周期', default: '9' },
    ],
  },
  kdj: {
    name: 'KDJ 超买超卖策略',
    desc: 'K值<20 超卖买入，K值>80 超买卖出；适用于震荡行情',
    params: [
      { label: '周期', default: '9' },
      { label: '超卖阈值', default: '20' },
      { label: '超买阈值', default: '80' },
    ],
  },
  ma: {
    name: '均线多头排列策略',
    desc: '收盘价上穿20日均线买入，下穿卖出；适用于趋势跟踪',
    params: [
      { label: '短期均线', default: '5' },
      { label: '长期均线', default: '20' },
    ],
  },
  bollinger: {
    name: '布林带突破策略',
    desc: '价格突破布林上轨买入，跌破下轨卖出；适用于波动型行情',
    params: [
      { label: '周期', default: '20' },
      { label: '标准差倍数', default: '2' },
    ],
  },
  rsi: {
    name: 'RSI 强弱策略',
    desc: 'RSI<30 超卖买入，RSI>70 超买卖出；适用于震荡行情',
    params: [
      { label: '周期', default: '14' },
      { label: '超卖阈值', default: '30' },
      { label: '超买阈值', default: '70' },
    ],
  },
};

export const useStrategyStore = create<StrategyStore>((set, get) => ({
  strategies: [],
  ensembles: [],
  isLoaded: false,
  currentUserId: null,

  // ── 用户切换 ──────────────────────────────────

  setCurrentUser: (userId) => {
    set({ currentUserId: userId });
  },

  clearState: () => {
    set({ strategies: [], ensembles: [], isLoaded: false });
  },

  // ── 加载 ──────────────────────────────────

  loadFromDb: async (userId) => {
    set({ currentUserId: userId });
    // 按 userId 过滤，只加载当前用户的策略
    const all = await db.strategies!.where('userId').equals(userId).toArray();
    const strategies: StrategyItem[] = [];
    const ensembles: EnsembleItem[] = [];

    for (const row of all) {
      if (row.type === 'single') {
        const def = STRATEGY_DEFS[row.strategyType as StrategyId];
        strategies.push({
          id: row.id,
          name: row.name || def?.name || row.strategyType || '未知策略',
          type: (row.strategyType as StrategyId) || 'macd',
          desc: row.description || def?.desc || '',
          status: row.enabled ? 'running' : 'stopped',
          params: (row.params as Record<string, string>) || {},
          enabled: row.enabled,
          tags: row.tags || [],
          boundStocks: [],
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
      } else if (row.type === 'ensemble') {
        ensembles.push({
          id: row.id,
          name: row.name,
          type: 'ensemble',
          ensembleMode: row.ensembleMode || 'voting',
          desc: row.description || '',
          status: row.enabled ? 'running' : 'stopped',
          enabled: row.enabled,
          subStrategies: row.subStrategies || [],
          weights: row.weights,
          backtestResult: undefined,
          boundStocks: [],
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
      }
    }

    set({ strategies, ensembles, isLoaded: true });
  },

  // ── 单策略 ──────────────────────────────────

  addStrategy: async (item) => {
    const userId = get().currentUserId;
    if (!userId) throw new Error('User not authenticated');
    const id = nanoid();
    const now = Date.now();
    const row: DbStrategy = {
      id,
      userId,
      name: item.name,
      description: item.desc,
      type: 'single',
      strategyType: item.type,
      params: item.params as Record<string, number | string | boolean>,
      enabled: item.enabled,
      tags: item.tags,
      createdAt: now,
      updatedAt: now,
    };
    await db.strategies!.add(row);
    set(state => ({
      strategies: [...state.strategies, { ...item, id, createdAt: now, updatedAt: now }],
    }));
    return id;
  },

  updateStrategy: async (id, updates) => {
    const now = Date.now();
    const row: Partial<DbStrategy> = {
      updatedAt: now,
    };
    if (updates.name !== undefined) row.name = updates.name;
    if (updates.desc !== undefined) row.description = updates.desc;
    if (updates.enabled !== undefined) row.enabled = updates.enabled;
    if (updates.params !== undefined) row.params = updates.params as Record<string, number | string | boolean>;
    if (updates.tags !== undefined) row.tags = updates.tags;

    await db.strategies!.update(id, row);
    set(state => ({
      strategies: state.strategies.map(s =>
        s.id === id ? { ...s, ...updates, updatedAt: now } : s
      ),
    }));
  },

  removeStrategy: async (id) => {
    // loadFromDb 已按 userId 过滤，store 里的数据必然属于当前用户
    await db.strategies!.delete(id);
    await db.strategyBindings!.where('strategyId').equals(id).delete();
    set(state => ({
      strategies: state.strategies.filter(s => s.id !== id),
    }));
  },

  toggleStrategy: async (id) => {
    const item = get().strategies.find(s => s.id === id);
    if (!item) return;
    const enabled = !item.enabled;
    await db.strategies!.update(id, { enabled, updatedAt: Date.now() });
    set(state => ({
      strategies: state.strategies.map(s =>
        s.id === id ? { ...s, enabled, status: enabled ? 'running' : 'stopped', updatedAt: Date.now() } : s
      ),
    }));
  },

  updateBacktestResult: async (id, result, stockCode) => {
    // 找到匹配的策略（按 type 匹配）
    const item = get().strategies.find(s => s.id === id || s.type === (stockCode ? undefined : undefined));
    if (!item) {
      // 找不到匹配的策略，自动创建一个
      const newId = await get().addStrategy({
        name: result.config.strategy.name || '新策略',
        type: result.config.strategy.params?.indicator as StrategyId || 'macd',
        desc: '',
        status: 'stopped',
        params: {},
        enabled: false,
        tags: [],
        boundStocks: [stockCode],
      });
      // 再更新回测结果
      await db.strategies!.update(newId, {
        updatedAt: Date.now(),
      });
      set(state => ({
        strategies: state.strategies.map(s =>
          s.id === newId
            ? { ...s, cumulativeReturn: result.totalReturn, winRate: result.winRate, totalTrades: result.totalTrades, backtestResult: result, status: 'stopped' }
            : s
        ),
      }));
      return;
    }
    // 更新已有策略
    await db.strategies!.update(item.id, { updatedAt: Date.now() });
    set(state => ({
      strategies: state.strategies.map(s =>
        s.id === item.id
          ? {
              ...s,
              cumulativeReturn: result.totalReturn,
              winRate: result.winRate,
              totalTrades: result.totalTrades,
              backtestResult: result,
              status: 'stopped',
              boundStocks: s.boundStocks.includes(stockCode) ? s.boundStocks : [...s.boundStocks, stockCode],
              updatedAt: Date.now(),
            }
          : s
      ),
    }));
  },

  // ── 组合策略 ──────────────────────────────────

  addEnsemble: async (item) => {
    const userId = get().currentUserId;
    if (!userId) throw new Error('User not authenticated');
    const id = nanoid();
    const now = Date.now();
    const row: DbStrategy = {
      id,
      userId,
      name: item.name,
      description: item.desc,
      type: 'ensemble',
      ensembleMode: item.ensembleMode,
      subStrategies: item.subStrategies,
      weights: item.weights,
      enabled: item.enabled,
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
    await db.strategies!.add(row);
    set(state => ({
      ensembles: [...state.ensembles, { ...item, id, createdAt: now, updatedAt: now }],
    }));
    return id;
  },

  updateEnsemble: async (id, updates) => {
    const now = Date.now();
    const row: Partial<DbStrategy> = { updatedAt: now };
    if (updates.name !== undefined) row.name = updates.name;
    if (updates.desc !== undefined) row.description = updates.desc;
    if (updates.enabled !== undefined) row.enabled = updates.enabled;
    if (updates.subStrategies !== undefined) row.subStrategies = updates.subStrategies;
    if (updates.weights !== undefined) row.weights = updates.weights;

    await db.strategies!.update(id, row);
    set(state => ({
      ensembles: state.ensembles.map(e =>
        e.id === id ? { ...e, ...updates, updatedAt: now } : e
      ),
    }));
  },

  removeEnsemble: async (id) => {
    await db.strategies!.delete(id);
    set(state => ({
      ensembles: state.ensembles.filter(e => e.id !== id),
    }));
  },

  // ── 股票绑定 ──────────────────────────────────

  bindStocks: async (id, codes) => {
    set(state => ({
      strategies: state.strategies.map(s =>
        s.id === id
          ? { ...s, boundStocks: [...new Set([...s.boundStocks, ...codes])], updatedAt: Date.now() }
          : s
      ),
    }));
    // 注意：股票绑定信息目前存在内存中，后续可迁移到单独的 binding 表
  },

  unbindStock: async (id, code) => {
    set(state => ({
      strategies: state.strategies.map(s =>
        s.id === id
          ? { ...s, boundStocks: s.boundStocks.filter(c => c !== code), updatedAt: Date.now() }
          : s
      ),
    }));
  },

  // ── 运行状态 ──────────────────────────────────

  setRunningStatus: async (id, status) => {
    set(state => ({
      strategies: state.strategies.map(s =>
        s.id === id ? { ...s, status, updatedAt: Date.now() } : s
      ),
      ensembles: state.ensembles.map(e =>
        e.id === id ? { ...e, status, updatedAt: Date.now() } : e
      ),
    }));
  },
}));
