/**
 * LiveSimulator ↔ 持久化 桥接
 *
 * 双环境持久化策略：
 *   - 浏览器侧（Dexie / IndexedDB）：主要持久化层，由 simulator-panel 触发
 *   - 服务器侧（JSON 文件）：备份层 / 跨设备访问 / Node 重启后恢复
 *     路径：/OpenMAIC/data/simulator-state/<userId>.json
 *
 * 工作流：
 *   - 浏览器：写入 IndexedDB（实时）；同时调一次 syncToServer() 把状态同步到服务器 JSON
 *   - 服务器：内存 liveSimulator 状态变化时也调一次 syncToServer() 写盘
 *   - 重启/切换用户：先尝试服务器 JSON（即使浏览器 IndexedDB 是空的也能恢复）
 */
import { liveSimulator } from '../simulator/live-simulator';
import { useAccountStore } from './account-store';
import { db } from '../db/database';
import type { DbPosition, DbTradeRecord, DbOrder } from '../db/schema';
import type { Direction } from '../types';
import {
  simulatorStateStore,
  type SimulatorState,
  type PersistedPosition,
  type PersistedOrder,
  type PersistedTrade,
  type PersistedBuyRecord,
} from './simulator-state-store';

// ==================== 环境检测 ====================

const isBrowser = typeof window !== 'undefined';

// ==================== 工具：从 liveSimulator 提取状态 ====================

/**
 * 从 liveSimulator 提取当前完整状态，构造 SimulatorState
 */
function snapshotSimulator(userId: string): SimulatorState {
  const account = liveSimulator.getAccount();
  const positions = (liveSimulator as any).positionManager?.getAllPositions?.() || [];
  const ordersMap = (liveSimulator as any).orders as Map<string, any> | undefined;
  const orders: PersistedOrder[] = [];
  if (ordersMap) {
    for (const o of ordersMap.values()) {
      orders.push({
        id: o.id, code: o.code, direction: o.direction, type: o.type,
        price: o.price, volume: o.volume, filledVolume: o.filledVolume,
        status: o.status, timestamp: o.timestamp,
      });
    }
  }
  // 按时间倒序，限 100 条
  orders.sort((a, b) => b.timestamp - a.timestamp);
  const ordersLimited = orders.slice(0, 100);

  const tradesMap = (liveSimulator as any).tradeHistory as Map<string, any> | undefined;
  const trades: PersistedTrade[] = [];
  if (tradesMap) {
    for (const t of tradesMap.values()) {
      trades.push({
        id: t.id, timestamp: t.timestamp, code: t.code, name: t.name,
        direction: t.direction, price: t.price, volume: t.volume,
        pnl: t.pnl ?? 0, strategyId: t.strategyId,
      });
    }
  }
  trades.sort((a, b) => b.timestamp - a.timestamp);
  const tradesLimited = trades.slice(0, 200);

  const buyRecords: PersistedBuyRecord[] = (liveSimulator as any).buyRecords || [];
  const tradingCodes = liveSimulator.getTradingCodes?.() || [];

  return {
    userId,
    updatedAt: Date.now(),
    account: {
      cash: account.cash,
      frozen: account.frozen,
      totalAssets: account.totalAssets,
      totalPnL: account.totalPnL,
      initialCash: account.initialCash || 1000000,
    },
    positions: positions.map((p: any) => ({
      code: p.code,
      name: p.name,
      volume: p.volume,
      avgCost: p.avgCost,
      currentPrice: p.currentPrice,
      marketValue: p.marketValue,
      unrealizedPnL: p.unrealizedPnL,
      realizedPnL: p.realizedPnL,
      buyDate: p.buyDate,
    })),
    orders: ordersLimited,
    trades: tradesLimited,
    buyRecords,
    runtime: {
      tradingCodes,
      strategyType: (liveSimulator as any).currentStrategyType,
      ensembleType: (liveSimulator as any).currentEnsembleType,
      autoPilot: liveSimulator.isAutoPilotActive?.() || false,
    },
  };
}

/**
 * 把 SimulatorState 恢复到 liveSimulator
 */
function applyState(state: SimulatorState): void {
  // 账户资金
  (liveSimulator as any).account = {
    cash: state.account.cash,
    frozen: state.account.frozen,
    totalAssets: state.account.totalAssets,
    totalPnL: state.account.totalPnL,
    initialCash: state.account.initialCash,
    positions: [],
  };

  // 持仓
  const positionManager = (liveSimulator as any).positionManager;
  if (positionManager?.restorePosition) {
    for (const p of state.positions) {
      positionManager.restorePosition({
        code: p.code, volume: p.volume, avgCost: p.avgCost,
        currentPrice: p.currentPrice, marketValue: p.marketValue,
        unrealizedPnL: p.unrealizedPnL, realizedPnL: p.realizedPnL,
      });
    }
  }

  // T+1 记录
  const restoredBuyDates = new Map<string, string>();
  for (const p of state.positions) {
    if (p.buyDate) restoredBuyDates.set(p.code, p.buyDate);
  }
  positionManager?.restoreBuyDates?.(restoredBuyDates);

  // 订单
  const ordersMap = (liveSimulator as any).orders as Map<string, any> | undefined;
  if (ordersMap) {
    ordersMap.clear();
    for (const o of state.orders) {
      ordersMap.set(o.id, { ...o });
    }
  }

  // 成交历史
  const tradesMap = (liveSimulator as any).tradeHistory as Map<string, any> | undefined;
  if (tradesMap) {
    tradesMap.clear();
    for (const t of state.trades) {
      tradesMap.set(t.id, { ...t });
    }
  }

  // buyRecords
  (liveSimulator as any).buyRecords = state.buyRecords.map(b => ({ ...b }));

  // 触发账户重算
  liveSimulator.updateAccount?.();
}

// ==================== 持久化服务 ====================

class SimulatorPersistence {
  /**
   * 从持久化层恢复引擎状态
   * - 浏览器：IndexedDB
   * - 服务器：JSON 文件
   */
  async restore(userId: string): Promise<{
    restored: boolean;
    tradingCodes: string[];
    strategyType?: string;
    ensembleType?: string;
    autoPilot: boolean;
  }> {
    if (!userId) {
      return { restored: false, tradingCodes: [], autoPilot: false };
    }

    // ============ 服务器侧：JSON 文件恢复 ============
    if (!isBrowser) {
      try {
        const state = await simulatorStateStore.load(userId);
        if (!state) {
          return { restored: false, tradingCodes: [], autoPilot: false };
        }
        // 注入到 liveSimulator
        applyState(state);
        // 节流日志：restore 被 /api/simulator GET 频繁调用，5s 一次的"恢复"信息会刷屏
        // 只在数据真的有变化时打印，或每 60s 最多打一次
        const lastLogKey = `__sim_restore_log_${userId}`;
        const lastLog = (globalThis as any)[lastLogKey] || { ts: 0, hash: '' };
        const now = Date.now();
        const hash = `${state.positions.length}_${state.account.cash.toFixed(0)}_${state.runtime.autoPilot}`;
        if (now - lastLog.ts > 60_000 || hash !== lastLog.hash) {
          console.log(`[SimulatorPersistence] Restored from server JSON: ${userId}, ${state.positions.length} positions, ¥${state.account.cash.toFixed(2)} cash, autoPilot=${state.runtime.autoPilot}`);
          (globalThis as any)[lastLogKey] = { ts: now, hash };
        }
        return {
          restored: true,
          tradingCodes: state.runtime.tradingCodes,
          strategyType: state.runtime.strategyType,
          ensembleType: state.runtime.ensembleType,
          autoPilot: state.runtime.autoPilot,
        };
      } catch (err) {
        console.error('[SimulatorPersistence] Server restore failed:', err);
        return { restored: false, tradingCodes: [], autoPilot: false };
      }
    }

    // ============ 浏览器侧：IndexedDB 恢复（保留原逻辑）============
    try {
      const accounts = await db.accounts!.where('userId').equals(userId).toArray();
      if (accounts.length === 0) {
        // 兜底：尝试从服务器 JSON 拉（处理"换浏览器/清缓存"场景）
        try {
          const resp = await fetch(`/api/quant/simulator-state?userId=${encodeURIComponent(userId)}`);
          if (resp.ok) {
            const json = await resp.json();
            if (json.success && json.data) {
              // 把服务器数据写回 IndexedDB
              await this._importFromServerState(userId, json.data);
            }
          }
        } catch (e) { /* ignore */ }

        // 再查一次
        const accounts2 = await db.accounts!.where('userId').equals(userId).toArray();
        if (accounts2.length === 0) {
          return { restored: false, tradingCodes: [], autoPilot: false };
        }
        return this._restoreFromIndexedDb(userId, accounts2);
      }
      return this._restoreFromIndexedDb(userId, accounts);
    } catch (err) {
      console.error('[SimulatorPersistence] Restore failed:', err);
      return { restored: false, tradingCodes: [], autoPilot: false };
    }
  }

  private async _restoreFromIndexedDb(userId: string, accounts: any[]): Promise<{
    restored: boolean;
    tradingCodes: string[];
    strategyType?: string;
    ensembleType?: string;
    autoPilot: boolean;
  }> {
    const account = accounts.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const wasReset = account.totalAssets === account.initialCash;
    const positionCount = await db.positions!.where('accountId').equals(account.id).count();
    const skipRestore = wasReset && positionCount === 0;

    const runtime = {
      tradingCodes: (account as any).tradingCodes || [],
      strategyType: (account as any).strategyType as string | undefined,
      ensembleType: (account as any).ensembleType as string | undefined,
      autoPilot: account.autoPilot,
    };

    if (skipRestore) return { restored: false, ...runtime };

    // 恢复持仓
    const positions = await db.positions!.where('accountId').equals(account.id).toArray();
    for (const pos of positions) {
      liveSimulator['positionManager'].restorePosition({
        code: pos.code, volume: pos.volume, avgCost: pos.avgCost,
        currentPrice: pos.currentPrice, marketValue: pos.marketValue,
        unrealizedPnL: pos.unrealizedPnL, realizedPnL: pos.realizedPnL,
      });
    }

    liveSimulator['account'] = {
      cash: account.currentCash, frozen: account.frozen,
      totalAssets: account.totalAssets, totalPnL: account.totalPnL,
      initialCash: account.initialCash,
      positions: [],
    };

    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const restoredBuyDates = new Map<string, string>();
    for (const pos of positions) {
      const posBuyDate: string = (pos as any).buyDate || '';
      if (posBuyDate) restoredBuyDates.set(pos.code, posBuyDate);
      if (posBuyDate === todayStr) {
        liveSimulator['buyRecords'].push({ code: pos.code, date: todayStr, volume: pos.volume });
      }
    }
    liveSimulator['positionManager'].restoreBuyDates(restoredBuyDates);
    liveSimulator.setAccountId(account.id);

    const pendingOrders = await db.orders!
      .where('accountId').equals(account.id)
      .filter(o => o.status === 'pending' || o.status === 'partial')
      .toArray();
    for (const o of pendingOrders) {
      liveSimulator['orders'].set(o.id, {
        id: o.id, code: o.code, direction: o.direction,
        type: o.type as 'market' | 'limit', price: o.price,
        volume: o.volume, filledVolume: o.filledVolume,
        status: o.status, timestamp: o.timestamp,
      });
    }

    liveSimulator.updateAccount();
    const riskEngine = (liveSimulator as any).riskEngine as any;
    if (riskEngine) {
      riskEngine.updateAccount(liveSimulator.getAccount());
      const dailyRule = riskEngine.rules.get('daily_loss_limit') as any;
      if (dailyRule) {
        dailyRule.dailyStartEquity = account.totalAssets;
        dailyRule.triggered = false;
      }
    }

    console.log(`[SimulatorPersistence] Restored account ${account.id}: ${positions.length} positions, ¥${account.currentCash.toFixed(2)} cash`);
    return { restored: true, ...runtime };
  }

  /**
   * 把服务器 JSON 状态导入浏览器 IndexedDB（处理换浏览器场景）
   */
  private async _importFromServerState(userId: string, state: SimulatorState): Promise<void> {
    try {
      // 找到/创建账户
      let account = (await db.accounts!.where('userId').equals(userId).toArray())[0];
      if (!account) {
        const { nanoid } = await import('nanoid');
        account = {
          id: nanoid(), userId, name: '模拟账户',
          initialCash: state.account.totalAssets - state.account.totalPnL,
          currentCash: state.account.cash, frozen: state.account.frozen,
          totalAssets: state.account.totalAssets, totalPnL: state.account.totalPnL,
          status: 'running', autoPilot: state.runtime.autoPilot,
          boundStrategies: [], maxPositionPct: 0.2,
          stopLossPct: 0.07, takeProfitPct: 0.15,
          tradingCodes: state.runtime.tradingCodes,
          strategyType: state.runtime.strategyType,
          ensembleType: state.runtime.ensembleType,
          createdAt: state.updatedAt, updatedAt: state.updatedAt,
        } as any;
        await db.accounts!.add(account);
      } else {
        await db.accounts!.update(account.id, {
          currentCash: state.account.cash, frozen: state.account.frozen,
          totalAssets: state.account.totalAssets, totalPnL: state.account.totalPnL,
          autoPilot: state.runtime.autoPilot,
          tradingCodes: state.runtime.tradingCodes,
          strategyType: state.runtime.strategyType,
          ensembleType: state.runtime.ensembleType,
          updatedAt: Date.now(),
        });
      }

      // 持仓
      await db.positions!.where('accountId').equals(account.id).delete();
      for (const p of state.positions) {
        await db.positions!.add({
          id: `pos_${p.code}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          accountId: account.id, code: p.code, name: p.name,
          volume: p.volume, avgCost: p.avgCost,
          currentPrice: p.currentPrice, marketValue: p.marketValue,
          unrealizedPnL: p.unrealizedPnL, realizedPnL: p.realizedPnL,
          frozenVolume: 0, buyDate: p.buyDate || '',
          updatedAt: Date.now(),
        } as DbPosition);
      }

      // 订单
      await db.orders!.where('accountId').equals(account.id).delete();
      for (const o of state.orders) {
        await db.orders!.add({
          ...o, accountId: account.id, name: undefined,
        } as DbOrder);
      }

      // 成交
      await db.tradeRecords!.where('accountId').equals(account.id).delete();
      for (const t of state.trades) {
        await db.tradeRecords!.add({
          ...t, accountId: account.id, commission: 0,
        } as DbTradeRecord);
      }
    } catch (err) {
      console.error('[SimulatorPersistence] Import from server failed:', err);
    }
  }

  /**
   * 查找或创建账户
   * - 浏览器：写 IndexedDB
   * - 服务器：返回临时 ID（用 userId 派生）
   */
  async findOrCreateAccount(userId: string, initialCash: number): Promise<string> {
    if (!isBrowser) {
      // 服务器侧直接用 userId 作为 accountId 标识
      return `srv_${userId}`;
    }
    try {
      const accounts = await db.accounts!.where('userId').equals(userId).toArray();
      if (accounts.length > 0) {
        return accounts.sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
      }
      const { nanoid } = await import('nanoid');
      const accountId = nanoid();
      await db.accounts!.add({
        id: accountId, userId, name: '模拟账户',
        initialCash, currentCash: initialCash, frozen: 0,
        totalAssets: initialCash, totalPnL: 0,
        status: 'running', autoPilot: false,
        boundStrategies: [], maxPositionPct: 0.2,
        stopLossPct: 0.07, takeProfitPct: 0.15,
        tradingCodes: [], createdAt: Date.now(), updatedAt: Date.now(),
      });
      return accountId;
    } catch (err) {
      console.error('[SimulatorPersistence] findOrCreateAccount failed:', err);
      return '';
    }
  }

  /**
   * 更新账户 runtime 配置（tradingCodes/strategyType/ensembleType）
   */
  async updateAccountRuntime(accountId: string, tradingCodes: string[], strategyType?: string, ensembleType?: string): Promise<void> {
    if (!isBrowser) {
      // 服务器侧：直接写到 liveSimulator + 同步 JSON
      (liveSimulator as any).currentStrategyType = strategyType;
      (liveSimulator as any).currentEnsembleType = ensembleType;
      // 同步整个状态到 JSON
      const userId = this._extractUserId();
      if (userId) {
        const state = snapshotSimulator(userId);
        state.runtime.tradingCodes = tradingCodes;
        state.runtime.strategyType = strategyType;
        state.runtime.ensembleType = ensembleType;
        await simulatorStateStore.save(state);
      }
      return;
    }
    try {
      await db.accounts!.update(accountId, {
        tradingCodes, strategyType, ensembleType, updatedAt: Date.now(),
      });
    } catch (err) {
      console.error('[SimulatorPersistence] updateAccountRuntime failed:', err);
    }
  }

  /**
   * 获取账户 runtime 配置
   */
  async getAccountRuntime(accountId: string): Promise<{ tradingCodes: string[]; strategyType?: string; ensembleType?: string } | null> {
    if (!isBrowser) {
      const userId = this._extractUserId();
      if (!userId) return null;
      const state = await simulatorStateStore.load(userId);
      if (!state) return null;
      return {
        tradingCodes: state.runtime.tradingCodes,
        strategyType: state.runtime.strategyType,
        ensembleType: state.runtime.ensembleType,
      };
    }
    try {
      const account = await db.accounts!.get(accountId);
      if (!account) return null;
      return {
        tradingCodes: (account as any).tradingCodes || [],
        strategyType: (account as any).strategyType,
        ensembleType: (account as any).ensembleType,
      };
    } catch {
      return null;
    }
  }

  /**
   * 更新账户资金（每次 updateAccount 时调用）
   */
  async updateAccountCash(accountId: string, cash: number, frozen: number, totalAssets: number, totalPnL: number): Promise<void> {
    if (!isBrowser) {
      // 服务器侧：增量更新 JSON
      const userId = this._extractUserId();
      if (userId) {
        const state = await simulatorStateStore.load(userId) || snapshotSimulator(userId);
        state.userId = userId;
        state.account = { cash, frozen, totalAssets, totalPnL, initialCash: state.account?.initialCash || 1000000 };
        await simulatorStateStore.save(state);
      }
      return;
    }
    try {
      await db.accounts!.update(accountId, {
        currentCash: cash, frozen, totalAssets, totalPnL, updatedAt: Date.now(),
      });
    } catch (err) {
      console.error('[SimulatorPersistence] updateAccountCash failed:', err);
    }
  }

  /**
   * 重置账户
   */
  async resetAccountData(accountId: string, initialCash: number): Promise<void> {
    if (!isBrowser) {
      const userId = this._extractUserId();
      if (userId) {
        await simulatorStateStore.remove(userId);
      }
      return;
    }
    try {
      await db.transaction('rw', [db.accounts!, db.positions!, db.tradeRecords!, db.orders!, db.equityPoints!], async () => {
        await db.positions!.where('accountId').equals(accountId).delete();
        await db.tradeRecords!.where('accountId').equals(accountId).delete();
        await db.orders!.where('accountId').equals(accountId).delete();
        await db.equityPoints!.where('accountId').equals(accountId).delete();
        await db.accounts!.update(accountId, {
          currentCash: initialCash, frozen: 0,
          totalAssets: initialCash, totalPnL: 0, status: 'paused',
          updatedAt: Date.now(),
          tradingCodes: [], strategyType: undefined, ensembleType: undefined, autoPilot: false,
        });
      });
    } catch (err) {
      console.error('[SimulatorPersistence] resetAccountData failed:', err);
    }
  }

  /**
   * 保存账户（兼容旧接口）
   */
  async saveAccount(accountId: string, cash: number, frozen: number, totalAssets: number, totalPnL: number): Promise<void> {
    return this.updateAccountCash(accountId, cash, frozen, totalAssets, totalPnL);
  }

  /**
   * 保存/更新持仓
   */
  async savePosition(pos: {
    accountId: string; code: string; name?: string;
    volume: number; avgCost: number; currentPrice: number;
    marketValue: number; unrealizedPnL: number; realizedPnL: number;
    frozenVolume?: number; buyDate?: string;
  }): Promise<void> {
    if (!isBrowser) {
      // 服务器侧：批量同步整个状态
      const userId = this._extractUserId();
      if (userId) {
        const state = await simulatorStateStore.load(userId) || snapshotSimulator(userId);
        state.userId = userId;
        const idx = state.positions.findIndex(p => p.code === pos.code);
        if (idx >= 0) {
          if (pos.volume <= 0) state.positions.splice(idx, 1);
          else state.positions[idx] = { ...state.positions[idx], ...pos, buyDate: pos.buyDate || state.positions[idx].buyDate };
        } else if (pos.volume > 0) {
          state.positions.push({
            code: pos.code, name: pos.name, volume: pos.volume,
            avgCost: pos.avgCost, currentPrice: pos.currentPrice,
            marketValue: pos.marketValue, unrealizedPnL: pos.unrealizedPnL,
            realizedPnL: pos.realizedPnL, buyDate: pos.buyDate,
          });
        }
        await simulatorStateStore.save(state);
      }
      return;
    }
    const existing = await db.positions!.where({ accountId: pos.accountId, code: pos.code }).first();
    const frozenVolume = pos.frozenVolume ?? 0;
    if (existing) {
      const existingBuyDate: string = (existing as any).buyDate || '';
      const newBuyDate = pos.buyDate || existingBuyDate;
      await db.positions!.update(existing.id, {
        volume: pos.volume, avgCost: pos.avgCost,
        currentPrice: pos.currentPrice, marketValue: pos.marketValue,
        unrealizedPnL: pos.unrealizedPnL, realizedPnL: pos.realizedPnL,
        frozenVolume, buyDate: newBuyDate, updatedAt: Date.now(),
      });
    } else if (pos.volume > 0) {
      await db.positions!.add({
        id: `pos_${pos.code}_${Date.now()}`,
        accountId: pos.accountId, code: pos.code, name: pos.name,
        volume: pos.volume, avgCost: pos.avgCost,
        currentPrice: pos.currentPrice, marketValue: pos.marketValue,
        unrealizedPnL: pos.unrealizedPnL, realizedPnL: pos.realizedPnL,
        frozenVolume, buyDate: pos.buyDate || '', updatedAt: Date.now(),
      } as DbPosition);
    }
  }

  /**
   * 删除持仓
   */
  async removePosition(accountId: string, code: string): Promise<void> {
    if (!isBrowser) {
      const userId = this._extractUserId();
      if (userId) {
        const state = await simulatorStateStore.load(userId);
        if (state) {
          state.positions = state.positions.filter(p => p.code !== code);
          state.buyRecords = state.buyRecords.filter(b => b.code !== code);
          await simulatorStateStore.save(state);
        }
      }
      return;
    }
    await db.positions!.where({ accountId, code }).delete();
  }

  /**
   * 保存成交记录
   */
  async saveTrade(record: {
    accountId: string; timestamp: number; code: string; name?: string;
    direction: Direction; price: number; volume: number;
    commission: number; pnl: number; strategyId?: string;
  }): Promise<void> {
    if (!isBrowser) {
      const userId = this._extractUserId();
      if (userId) {
        const state = await simulatorStateStore.load(userId) || snapshotSimulator(userId);
        state.userId = userId;
        const id = `trade_${record.timestamp}_${Math.random().toString(36).slice(2, 6)}`;
        state.trades.unshift({
          id, timestamp: record.timestamp, code: record.code, name: record.name,
          direction: record.direction, price: record.price, volume: record.volume,
          pnl: record.pnl, strategyId: record.strategyId,
        });
        if (state.trades.length > 200) state.trades = state.trades.slice(0, 200);
        await simulatorStateStore.save(state);
      }
      return;
    }
    await db.tradeRecords!.add({
      id: `trade_${record.timestamp}_${Math.random().toString(36).slice(2, 6)}`,
      ...record,
    } as DbTradeRecord);
  }

  /**
   * 批量保存所有持仓
   */
  async persistPositions(accountId: string, positions: Array<{
    code: string; name?: string; volume: number; avgCost: number;
    currentPrice: number; marketValue: number; unrealizedPnL: number;
    realizedPnL: number; buyDate: string;
  }>): Promise<void> {
    if (!isBrowser) {
      const userId = this._extractUserId();
      if (userId) {
        const state = await simulatorStateStore.load(userId) || snapshotSimulator(userId);
        state.userId = userId;
        state.positions = positions;
        await simulatorStateStore.save(state);
      }
      return;
    }
    for (const pos of positions) {
      await this.savePosition({ accountId, ...pos });
    }
  }

  /**
   * 保存订单
   */
  async saveOrder(order: {
    id: string; accountId: string; code: string; name?: string;
    direction: Direction; type: 'market' | 'limit';
    price: number; volume: number; filledVolume: number;
    status: 'pending' | 'filled' | 'partial' | 'cancelled' | 'rejected';
    timestamp: number; strategyId?: string;
  }): Promise<void> {
    if (!isBrowser) {
      const userId = this._extractUserId();
      if (userId) {
        const state = await simulatorStateStore.load(userId) || snapshotSimulator(userId);
        state.userId = userId;
        const idx = state.orders.findIndex(o => o.id === order.id);
        if (idx >= 0) {
          state.orders[idx] = {
            id: order.id, code: order.code, direction: order.direction,
            type: order.type, price: order.price, volume: order.volume,
            filledVolume: order.filledVolume, status: order.status, timestamp: order.timestamp,
          };
        } else {
          state.orders.unshift({
            id: order.id, code: order.code, direction: order.direction,
            type: order.type, price: order.price, volume: order.volume,
            filledVolume: order.filledVolume, status: order.status, timestamp: order.timestamp,
          });
          if (state.orders.length > 100) state.orders = state.orders.slice(0, 100);
        }
        await simulatorStateStore.save(state);
      }
      return;
    }
    const existing = await db.orders!.get(order.id);
    if (existing) {
      await db.orders!.update(order.id, {
        filledVolume: order.filledVolume, status: order.status, updatedAt: Date.now(),
      });
    } else {
      await db.orders!.add(order as DbOrder);
    }
  }

  /**
   * 创建新账户
   */
  async createAccount(name: string, initialCash: number): Promise<string> {
    if (!isBrowser) return '';
    return useAccountStore.getState().createAccount({ name, initialCash });
  }

  /**
   * 重置账户
   */
  async resetAccount(accountId: string, initialCash: number): Promise<void> {
    if (!isBrowser) {
      const userId = this._extractUserId();
      if (userId) await simulatorStateStore.remove(userId);
      return;
    }
    const account = await db.accounts!.get(accountId);
    if (!account) return;
    await db.transaction('rw', [db.accounts!, db.positions!, db.tradeRecords!, db.orders!, db.equityPoints!], async () => {
      await db.positions!.where('accountId').equals(accountId).delete();
      await db.tradeRecords!.where('accountId').equals(accountId).delete();
      await db.orders!.where('accountId').equals(accountId).delete();
      await db.equityPoints!.where('accountId').equals(accountId).delete();
      await db.accounts!.update(accountId, {
        currentCash: initialCash, frozen: 0,
        totalAssets: initialCash, totalPnL: 0, status: 'paused', updatedAt: Date.now(),
      });
    });
  }

  /**
   * 记录每日净值
   */
  async recordEquityPoint(accountId: string): Promise<void> {
    if (!isBrowser) return;
    const account = liveSimulator.getAccount();
    const positions = liveSimulator['positionManager'].getAllPositions();
    const cash = account.cash;
    const equity = account.totalAssets;
    const positionValue = positions.reduce((s: number, p: any) => s + p.marketValue, 0);
    const today = new Date().toISOString().slice(0, 10);
    const yesterdayEquity = await db.equityPoints!
      .where('accountId').equals(accountId)
      .sortBy('date')
      .then((pts: any[]) => pts[pts.length - 1]?.equity);
    const dailyReturn = yesterdayEquity ? (equity - yesterdayEquity) / yesterdayEquity : 0;
    await useAccountStore.getState().recordEquityPoint(accountId, {
      date: today, equity, cash, positionValue, dailyReturn,
    });
  }

  /**
   * 私有：尝试从当前 liveSimulator 的 accountId 推断 userId
   */
  private _extractUserId(): string | null {
    const accountId = (liveSimulator as any).accountId;
    if (typeof accountId === 'string' && accountId.startsWith('srv_')) {
      return accountId.slice(4);
    }
    return null;
  }

  /**
   * 服务器侧：把当前内存状态写盘（API 路由在每个 POST 后调用）
   */
  async syncCurrentToDisk(userId: string): Promise<void> {
    if (isBrowser) return;
    if (!userId) return;
    try {
      const state = snapshotSimulator(userId);
      await simulatorStateStore.save(state);
    } catch (err) {
      console.error(`[SimulatorPersistence] syncCurrentToDisk failed for ${userId}:`, err);
    }
  }
}

export const simulatorPersistence = new SimulatorPersistence();
