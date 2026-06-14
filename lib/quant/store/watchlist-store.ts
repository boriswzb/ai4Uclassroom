/**
 * 自选股管理 Store
 * 多分组自选股，状态存储于 Dexie (IndexedDB)
 */

import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { db } from '../db/database';
import type { DbWatchlist } from '../db/schema';

// ==================== 类型 ====================

export interface WatchlistItem {
  id: string;
  name: string;
  codes: string[];            // 股票代码列表
  color?: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

interface WatchlistStore {
  // 状态
  watchlists: WatchlistItem[];
  activeWatchlistId: string | null;
  isLoaded: boolean;
  currentUserId: string | null;

  // 加载（按 userId 隔离）
  loadFromDb: (userId: string) => Promise<void>;

  // 设置当前用户
  setCurrentUser: (userId: string) => void;

  // 清空状态（登出时调用）
  clearState: () => void;

  // CRUD
  createWatchlist: (name: string, color?: string) => Promise<string>;
  renameWatchlist: (id: string, name: string) => Promise<void>;
  deleteWatchlist: (id: string) => Promise<void>;
  setWatchlistColor: (id: string, color: string) => Promise<void>;
  reorderWatchlists: (orderedIds: string[]) => Promise<void>;

  // 股票操作
  addStock: (watchlistId: string, code: string) => Promise<void>;
  addStocks: (watchlistId: string, codes: string[]) => Promise<void>;
  removeStock: (watchlistId: string, code: string) => Promise<void>;
  clearWatchlist: (watchlistId: string) => Promise<void>;

  // 快捷自选（默认分组）
  getDefaultWatchlist: () => WatchlistItem | null;
  addToDefault: (code: string) => Promise<void>;
  removeFromDefault: (code: string) => Promise<void>;
  isInDefault: (code: string) => boolean;

  // 激活
  setActive: (id: string | null) => void;
}

// ==================== 颜色预设 ====================

const DEFAULT_COLORS = [
  'blue', 'green', 'purple', 'orange', 'red',
  'cyan', 'pink', 'amber', 'violet', 'teal',
];

function nextColor(existing: string[]): string {
  for (const c of DEFAULT_COLORS) {
    if (!existing.includes(c)) return c;
  }
  return DEFAULT_COLORS[existing.length % DEFAULT_COLORS.length];
}

// ==================== 实现 ====================

export const useWatchlistStore = create<WatchlistStore>((set, get) => ({
  watchlists: [],
  activeWatchlistId: null,
  isLoaded: false,
  currentUserId: null,

  // ── 用户切换 ──────────────────────────────────

  setCurrentUser: (userId) => {
    set({ currentUserId: userId });
  },

  clearState: () => {
    set({ watchlists: [], activeWatchlistId: null, isLoaded: false });
  },

  // ── 加载 ──────────────────────────────────

  loadFromDb: async (userId) => {
    set({ currentUserId: userId });
    const rows = await db.watchlists!.where('userId').equals(userId).sortBy('sortOrder');
    const watchlists: WatchlistItem[] = rows.map(row => ({
      id: row.id,
      name: row.name,
      codes: row.codes || [],
      color: row.color,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

    // 确保有默认分组（loadFromDb 在每次页面刷新时都会被调用，
    // 如果用户已存在但无 watchlist，需要重新创建默认分组）
    if (watchlists.length === 0) {
      const id = nanoid();
      const now = Date.now();
      const defaultList: DbWatchlist = {
        id,
        userId, // 使用实际的 userId（可能是 guest UUID 或 username）
        name: '我的自选',
        codes: [],
        color: 'blue',
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      };
      await db.watchlists!.add(defaultList);
      watchlists.push({
        id: defaultList.id,
        name: defaultList.name,
        codes: [],
        color: 'blue',
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    set({
      watchlists,
      activeWatchlistId: watchlists[0]?.id ?? null,
      isLoaded: true,
    });
  },

  // ── CRUD ──────────────────────────────────

  createWatchlist: async (name, color) => {
    const userId = get().currentUserId;
    if (!userId) throw new Error('User not authenticated');
    const existingColors = get().watchlists.map(w => w.color || 'blue');
    const resolvedColor = color || nextColor(existingColors);
    const maxOrder = Math.max(0, ...get().watchlists.map(w => w.sortOrder));
    const now = Date.now();

    const row: DbWatchlist = {
      id: nanoid(),
      userId,
      name,
      codes: [],
      color: resolvedColor,
      sortOrder: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    };
    await db.watchlists!.add(row);

    const item: WatchlistItem = {
      id: row.id,
      name: row.name,
      codes: [],
      color: resolvedColor,
      sortOrder: row.sortOrder,
      createdAt: now,
      updatedAt: now,
    };

    set(state => ({
      watchlists: [...state.watchlists, item],
    }));
    return row.id;
  },

  renameWatchlist: async (id, name) => {
    const now = Date.now();
    await db.watchlists!.update(id, { name, updatedAt: now });
    set(state => ({
      watchlists: state.watchlists.map(w =>
        w.id === id ? { ...w, name, updatedAt: now } : w
      ),
    }));
  },

  deleteWatchlist: async (id) => {
    if (get().watchlists.length <= 1) return; // 至少保留一个
    await db.watchlists!.delete(id);
    const remaining = get().watchlists.filter(w => w.id !== id);
    set(state => ({
      watchlists: remaining,
      activeWatchlistId:
        state.activeWatchlistId === id ? (remaining[0]?.id ?? null) : state.activeWatchlistId,
    }));
  },

  setWatchlistColor: async (id, color) => {
    const now = Date.now();
    await db.watchlists!.update(id, { color, updatedAt: now });
    set(state => ({
      watchlists: state.watchlists.map(w =>
        w.id === id ? { ...w, color, updatedAt: now } : w
      ),
    }));
  },

  reorderWatchlists: async (orderedIds) => {
    const now = Date.now();
    await db.transaction('rw', [db.watchlists!], async () => {
      for (let i = 0; i < orderedIds.length; i++) {
        await db.watchlists!.update(orderedIds[i], { sortOrder: i, updatedAt: now });
      }
    });
    set(state => {
      const map = new Map(state.watchlists.map(w => [w.id, w]));
      const reordered = orderedIds
        .map((id, i) => {
          const w = map.get(id);
          return w ? { ...w, sortOrder: i, updatedAt: now } : null;
        })
        .filter(Boolean) as WatchlistItem[];
      return { watchlists: reordered };
    });
  },

  // ── 股票操作 ──────────────────────────────────

  addStock: async (watchlistId, code) => {
    const w = get().watchlists.find(w => w.id === watchlistId);
    if (!w || w.codes.includes(code)) return;
    const now = Date.now();
    const codes = [...w.codes, code];
    await db.watchlists!.update(watchlistId, { codes, updatedAt: now });
    set(state => ({
      watchlists: state.watchlists.map(wl =>
        wl.id === watchlistId ? { ...wl, codes, updatedAt: now } : wl
      ),
    }));
  },

  addStocks: async (watchlistId, codes) => {
    const w = get().watchlists.find(w => w.id === watchlistId);
    if (!w) return;
    const now = Date.now();
    const newCodes = [...new Set([...w.codes, ...codes])];
    await db.watchlists!.update(watchlistId, { codes: newCodes, updatedAt: now });
    set(state => ({
      watchlists: state.watchlists.map(wl =>
        wl.id === watchlistId ? { ...wl, codes: newCodes, updatedAt: now } : wl
      ),
    }));
  },

  removeStock: async (watchlistId, code) => {
    const w = get().watchlists.find(w => w.id === watchlistId);
    if (!w) return;
    const now = Date.now();
    const codes = w.codes.filter(c => c !== code);
    await db.watchlists!.update(watchlistId, { codes, updatedAt: now });
    set(state => ({
      watchlists: state.watchlists.map(wl =>
        wl.id === watchlistId ? { ...wl, codes, updatedAt: now } : wl
      ),
    }));
  },

  clearWatchlist: async (watchlistId) => {
    const now = Date.now();
    await db.watchlists!.update(watchlistId, { codes: [], updatedAt: now });
    set(state => ({
      watchlists: state.watchlists.map(wl =>
        wl.id === watchlistId ? { ...wl, codes: [], updatedAt: now } : wl
      ),
    }));
  },

  // ── 快捷自选（默认分组）────────────────────────────

  getDefaultWatchlist: () => {
    return get().watchlists[0] ?? null;
  },

  addToDefault: async (code) => {
    // 确保有默认分组（即使未登录也可用本地自选）
    let defaultList = get().getDefaultWatchlist();
    if (!defaultList) {
      const id = nanoid();
      const now = Date.now();
      const row: DbWatchlist = {
        id,
        userId: get().currentUserId ?? 'anonymous',
        name: '我的自选',
        codes: [],
        color: 'blue',
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      };
      await db.watchlists!.add(row);
      const item: WatchlistItem = {
        id: row.id,
        name: row.name,
        codes: [],
        color: 'blue',
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      };
      set(state => ({
        watchlists: [...state.watchlists, item],
        activeWatchlistId: item.id,
      }));
      defaultList = item;
    }
    await get().addStock(defaultList.id, code);
  },

  removeFromDefault: async (code) => {
    const defaultList = get().getDefaultWatchlist();
    if (defaultList) {
      await get().removeStock(defaultList.id, code);
    }
  },

  isInDefault: (code) => {
    const defaultList = get().getDefaultWatchlist();
    return defaultList ? defaultList.codes.includes(code) : false;
  },

  // ── 激活 ──────────────────────────────────

  setActive: (id) => {
    set({ activeWatchlistId: id });
  },
}));
