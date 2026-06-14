/**
 * 服务器侧模拟交易状态持久化
 *
 * 背景：
 *   - 模拟交易引擎（liveSimulator）运行在 Node 进程内存中，是单例
 *   - 浏览器侧 IndexedDB 只能在客户端访问，Node.js 端是 no-op
 *   - 当 Node 进程重启（部署/崩溃/重启）后，内存数据全部丢失
 *   - 也无法在多个客户端间共享一个用户的交易历史
 *
 * 方案：
 *   - 把每个用户的"账户+持仓+订单+成交+T+1记录" 序列化为 JSON 写到磁盘
 *   - 路径：/OpenMAIC/data/simulator-state/<userId>.json
 *   - 文件被 .gitignore 排除（不提交敏感数据）
 *   - 每次账户/持仓/订单变化时调用 save() 持久化
 *   - 启动/用户请求时调用 load() 恢复
 *
 * 限制（与现有架构保持一致，不破坏）：
 *   - 仍按当前单用户活跃模型（同一时刻 liveSimulator 只承载一个用户的活动状态）
 *   - 切换用户时调 load() 把目标用户的状态从磁盘恢复到内存
 *   - 文件 IO 是 best-effort，失败时仅打日志不阻断交易
 */
import { promises as fs } from 'fs';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

// ==================== 类型 ====================

export interface PersistedPosition {
  code: string;
  name?: string;
  volume: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  realizedPnL: number;
  buyDate?: string;       // YYYYMMDD（A 股 T+1 用）
}

export interface PersistedOrder {
  id: string;
  code: string;
  direction: 'long' | 'short';
  type: 'market' | 'limit';
  price: number;
  volume: number;
  filledVolume: number;
  status: 'pending' | 'filled' | 'partial' | 'cancelled' | 'rejected';
  timestamp: number;
}

export interface PersistedTrade {
  id: string;
  timestamp: number;
  code: string;
  name?: string;
  direction: 'long' | 'short';
  price: number;
  volume: number;
  pnl: number;
  strategyId?: string;
}

export interface PersistedBuyRecord {
  code: string;
  date: string;  // YYYYMMDD
  volume: number;
}

export interface SimulatorRuntimeConfig {
  tradingCodes: string[];
  strategyType?: string;
  ensembleType?: string;
  autoPilot: boolean;
}

export interface SimulatorState {
  userId: string;
  updatedAt: number;       // ms timestamp
  account: {
    cash: number;
    frozen: number;
    totalAssets: number;
    totalPnL: number;
  };
  positions: PersistedPosition[];
  orders: PersistedOrder[];            // 最近 100 条
  trades: PersistedTrade[];            // 最近 200 条
  buyRecords: PersistedBuyRecord[];    // T+1 记录
  runtime: SimulatorRuntimeConfig;
}

// ==================== 路径 ====================

const STATE_DIR = path.join(process.cwd(), 'data', 'simulator-state');

function stateFilePath(userId: string): string {
  // userId 形如 "boris" / "guest_xxx" —— 过滤掉非安全字符
  const safe = userId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 64) || 'anonymous';
  return path.join(STATE_DIR, `${safe}.json`);
}

function ensureDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
}

// ==================== 服务 ====================

class SimulatorStateStore {
  private writeQueue = new Map<string, Promise<void>>();  // 串行化同 userId 写入

  /**
   * 加载用户状态。文件不存在或损坏 → 返回 null
   */
  async load(userId: string): Promise<SimulatorState | null> {
    if (!userId) return null;
    const file = stateFilePath(userId);
    if (!existsSync(file)) return null;
    try {
      const raw = await fs.readFile(file, 'utf-8');
      const state = JSON.parse(raw) as SimulatorState;
      // 基础校验
      if (state.userId !== userId) {
        console.warn(`[simulator-state] userId mismatch: ${state.userId} vs ${userId}`);
        return null;
      }
      return state;
    } catch (err) {
      console.error(`[simulator-state] load failed for ${userId}:`, err);
      return null;
    }
  }

  /**
   * 保存用户状态。串行化同 userId 写入，避免并发覆盖
   */
  async save(state: SimulatorState): Promise<void> {
    const userId = state.userId;
    if (!userId) return;
    const prev = this.writeQueue.get(userId) || Promise.resolve();
    const next = prev.then(async () => {
      try {
        ensureDir();
        const file = stateFilePath(userId);
        // 写时附带 updatedAt
        state.updatedAt = Date.now();
        const json = JSON.stringify(state, null, 2);
        // 原子写入：写到 .tmp 再 rename，避免半写状态
        const tmp = `${file}.tmp`;
        await fs.writeFile(tmp, json, 'utf-8');
        await fs.rename(tmp, file);
      } catch (err) {
        console.error(`[simulator-state] save failed for ${userId}:`, err);
      }
    }).catch(() => {});
    this.writeQueue.set(userId, next);
    return next;
  }

  /**
   * 删除用户状态
   */
  async remove(userId: string): Promise<void> {
    if (!userId) return;
    const file = stateFilePath(userId);
    if (!existsSync(file)) return;
    try {
      await fs.unlink(file);
    } catch (err) {
      console.error(`[simulator-state] remove failed for ${userId}:`, err);
    }
  }

  /**
   * 列出所有有状态的用户（调试用）
   */
  async listUsers(): Promise<string[]> {
    ensureDir();
    try {
      const files = await fs.readdir(STATE_DIR);
      return files
        .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
        .map(f => f.replace(/\.json$/, ''));
    } catch {
      return [];
    }
  }
}

export const simulatorStateStore = new SimulatorStateStore();
