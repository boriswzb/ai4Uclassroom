/**
 * 股票数据缓存服务
 *
 * 数据分层策略：
 *   本地缓存（IndexedDB） → 服务器数据库 → 远端数据源（东方财富/腾讯）
 *
 * 非交易时段数据变化极少，一次抓取后长期有效：
 *   - realtime（实时行情）   ：非交易时段几乎不变，缓存 5 分钟
 *   - index（指数行情）      ：非交易时段几乎不变，缓存 5 分钟
 *   - list（股票列表）       ：退市/新股变动极少，缓存 7 天
 *   - board（板块行情）      ：收盘后基本不变，缓存 30 分钟
 *   - flow（主力资金流）     ：盘中间隔刷新，非交易时段缓存 5 分钟
 *   - fundamentals（基本面） ：盘中变化，隔天刷新，缓存 1 天
 *   - kline（K线历史）      ：历史数据永不变化，缓存 30 天
 *   - announcement（公告）  ：历史公告永不变化，缓存 30 天
 *   - news（新闻/舆情）     ：有时效性，缓存 1 小时
 *   - alerts（涨停/龙虎榜）  ：每日收盘更新，缓存 12 小时
 *
 * stale-while-revalidate:
 *   1. 先从 IndexedDB 读取缓存，立即返回（毫秒级）
 *   2. 判断是否过期，过期则后台静默重新抓取并更新缓存
 *   3. 非过期数据直接使用，完全零网络请求
 */

import { db } from '@/lib/quant/db/database';
import type { DbStockCache } from '@/lib/quant/db/schema';

// ==================== 类型定义 ====================

export type CacheType =
  | 'realtime' | 'index' | 'list' | 'board' | 'flow' | 'screener'
  | 'fundamentals' | 'news' | 'announcement' | 'alerts' | 'kline';

interface CacheConfig {
  /** 缓存过期时间（毫秒） */
  expireMs: number;
}

const CACHE_CONFIG: Record<CacheType, CacheConfig> = {
  // ── 行情类（变化频率高但非交易时段基本不变）────────────
  realtime:    { expireMs: 5 * 60 * 1000 },           // 5 分钟（非交易时段几乎不变）
  index:       { expireMs: 5 * 60 * 1000 },           // 5 分钟
  list:        { expireMs: 7 * 24 * 60 * 60 * 1000 }, // 7 天（股票列表极少变化）
  board:       { expireMs: 30 * 60 * 1000 },           // 30 分钟（板块收盘后稳定）
  flow:        { expireMs: 5 * 60 * 1000 },            // 5 分钟
  screener:    { expireMs: 30 * 60 * 1000 },           // 30 分钟（综合评分排序变化不快）
  // ── 个股类 ─────────────────────────────────────────
  fundamentals: { expireMs: 24 * 60 * 60 * 1000 },    // 1 天
  kline:        { expireMs: 30 * 24 * 60 * 60 * 1000 },// 30 天
  announcement: { expireMs: 30 * 24 * 60 * 60 * 1000 },// 30 天
  news:         { expireMs: 60 * 60 * 1000 },          // 1 小时
  alerts:       { expireMs: 12 * 60 * 60 * 1000 },     // 12 小时
};

// ==================== API 响应类型 ====================

interface ApiResponse<T> {
  success: boolean;
  data?: T;
}

// ── 行情类 ─────────────────────────────────────────

interface RealtimeQuoteResult {
  code: string; name: string; price: number; change: number;
  changePercent: number; open: number; high: number; low: number;
  volume: number; amount: number; turnover: number; amplitude: number;
  volumeRatio: number; buy1: number; buy2: number; buy3: number; buy4: number; buy5: number;
  buyVol1: number; buyVol2: number; buyVol3: number; buyVol4: number; buyVol5: number;
  sell1: number; sell2: number; sell3: number; sell4: number; sell5: number;
  sellVol1: number; sellVol2: number; sellVol3: number; sellVol4: number; sellVol5: number;
  date: string; time: string;
}

interface IndexQuoteResult {
  code: string; name: string; price: number; change: number; changePercent: number;
  volume: number; amount: number; amplitude: number; open: number; high: number; low: number;
}

interface StockListItem {
  code: string; name: string; industry?: string; sector?: string;
}

interface BoardItem {
  name: string; count: number; upCount: number; avgChangePercent: number;
  leadStock: string; leadChangePercent: number; totalAmount: number;
}

interface FlowItem {
  code: string; name: string; price: number; changePercent: number;
  mainNetInflow: number; mainNetInflowPct: number; turnover: number; amount: number;
}

// ── 个股类 ─────────────────────────────────────────

interface FundamentalsResult {
  code: string; name: string; price: number; changePercent: number;
  pe: number; pb: number; turnover: number; marketCap: number;
  negMarketCap: number; high52w: number; low52w: number; volume: number; amount: number;
}

interface KLineResult {
  timestamp: number; open: number; close: number; high: number; low: number; volume: number;
}

interface NewsResult {
  id: string; title: string; content: string; source: string;
  publishTime: string; url: string; sentiment?: string; isImportant: boolean;
}

interface AnnouncementResult {
  id: string; title: string; code: string; name: string;
  category: string; publishTime: string; url: string; abstract?: string;
}

interface AlertResult {
  code: string; name: string; alertType: string; alertReason: string;
  publishTime: string; changePercent: number; closePrice: number;
}

// ==================== 核心缓存读写 ====================

function makeId(type: CacheType, code: string, params?: string): string {
  const p = params ? `_${params}` : '';
  return `${type}_${code}${p}`;
}

/**
 * 读取缓存（立即返回，不等待网络）
 * @returns 缓存数据或 null（无缓存）
 */
async function getFromCache<T>(type: CacheType, code: string, params?: string): Promise<T | null> {
  const table = db.stockCache;
  if (!table) return null;

  const id = makeId(type, code, params);
  const row = await table.get(id);
  if (!row) return null;

  if (Date.now() > row.expireAt) return null;

  try {
    return JSON.parse(row.data) as T;
  } catch {
    return null;
  }
}

/**
 * 写入缓存
 */
async function setCache(
  type: CacheType,
  code: string,
  data: unknown,
  params?: string,
  source: string = 'eastmoney'
): Promise<void> {
  const table = db.stockCache;
  if (!table) return;

  const config = CACHE_CONFIG[type];
  const now = Date.now();
  const id = makeId(type, code, params);

  await table.put({
    id,
    type,
    code,
    params,
    data: JSON.stringify(data),
    fetchedAt: now,
    expireAt: now + config.expireMs,
    source,
  });
}

// ==================== 公开 API ====================

/**
 * stale-while-revalidate 读取
 *
 * @param type 数据类型
 * @param code 股票代码（纯数字，如 600519）
 * @param params 额外参数（如 kline 的 period=day）
 * @param fetchFn 如果缓存不存在或已过期，用此函数抓取数据
 * @returns { data, fromCache, isStale } data=数据内容，fromCache=是否来自缓存，isStale=数据是否已过期（后台会刷新）
 */
export async function getCachedData<T>(
  type: CacheType,
  code: string,
  params: string | undefined,
  fetchFn: () => Promise<T>
): Promise<{ data: T | null; fromCache: boolean; isStale: boolean }> {
  const table = db.stockCache;
  if (!table) {
    // 无 IndexedDB，直接抓取
    const data = await fetchFn();
    return { data, fromCache: false, isStale: false };
  }

  const id = makeId(type, code, params);
  const row = await table.get(id);
  const now = Date.now();

  // 有缓存，未过期 → 直接返回
  if (row && now <= row.expireAt) {
    try {
      const data = JSON.parse(row.data) as T;
      return { data, fromCache: true, isStale: false };
    } catch {
      // 数据损坏，当作无缓存处理
    }
  }

  // 缓存不存在或已过期
  if (row && now > row.expireAt) {
    // 已过期，后台静默刷新（不阻塞，立即返回旧数据）
    fetchFn().then(fresh => setCache(type, code, fresh, params)).catch(console.error);
    try {
      const data = JSON.parse(row.data) as T;
      return { data, fromCache: true, isStale: true };
    } catch {
      // 损坏也当作过期处理
    }
  }

  // 无缓存，直接抓取并缓存
  try {
    const data = await fetchFn();
    await setCache(type, code, data, params);
    return { data, fromCache: false, isStale: false };
  } catch (err) {
    console.error(`[StockDataCache] fetch failed: ${type}/${code}`, err);
    return { data: null, fromCache: false, isStale: false };
  }
}

// ==================== 便捷封装（带类型） ====================

export const stockDataCache = {
  // ── 行情类 ─────────────────────────────────────────

  /**
   * 实时行情（多股批量）
   * @param codes 逗号分隔的股票代码，如 "sh600519,sz000001"
   */
  async realtime(codes: string): Promise<{ data: ApiResponse<RealtimeQuoteResult[]> | null; fromCache: boolean; isStale: boolean }> {
    return getCachedData('realtime', codes, undefined,
      () => fetch(`/api/stock/realtime?codes=${codes}`).then(r => r.json() as Promise<ApiResponse<RealtimeQuoteResult[]>>)
    );
  },

  /**
   * 指数行情（批量）
   * 注：/api/stock/index 内部写死了常用指数，返回值固定
   */
  async index(): Promise<{ data: ApiResponse<IndexQuoteResult[]> | null; fromCache: boolean; isStale: boolean }> {
    return getCachedData('index', 'main', undefined,
      () => fetch(`/api/stock/index`).then(r => r.json() as Promise<ApiResponse<IndexQuoteResult[]>>)
    );
  },

  /**
   * 股票列表（全市场）
   */
  async list(): Promise<{ data: ApiResponse<StockListItem[]> | null; fromCache: boolean; isStale: boolean }> {
    return getCachedData('list', 'all', undefined,
      () => fetch(`/api/stock/list`).then(r => r.json() as Promise<ApiResponse<StockListItem[]>>)
    );
  },

  /**
   * 板块行情
   * @param sortBy 排序字段，如 "avgChangePercent"
   * @param order  "desc" | "asc"
   * @param limit  返回条数
   */
  async board(sortBy: string, order: string, limit: number): Promise<{ data: ApiResponse<BoardItem[]> | null; fromCache: boolean; isStale: boolean }> {
    const params = `sort=${sortBy}&order=${order}&limit=${limit}`;
    return getCachedData('board', params, undefined,
      () => fetch(`/api/stock/board?${params}`).then(r => r.json() as Promise<ApiResponse<BoardItem[]>>)
    );
  },

  /**
   * 主力资金流
   * @param codes 逗号分隔股票代码
   * @param sortBy 排序字段
   * @param order "desc" | "asc"
   * @param limit 返回条数
   */
  async flow(codes: string, sortBy: string, order: string, limit: number): Promise<{ data: ApiResponse<FlowItem[]> | null; fromCache: boolean; isStale: boolean }> {
    const params = `codes=${codes}&sort=${sortBy}&order=${order}&limit=${limit}`;
    return getCachedData('flow', params, undefined,
      () => fetch(`/api/stock/flow?${params}`).then(r => r.json() as Promise<ApiResponse<FlowItem[]>>)
    );
  },

  /** 综合评分选股结果（推荐页面） */
  async screener(template: string, limit: number): Promise<{ data: any | null; fromCache: boolean; isStale: boolean }> {
    return getCachedData('screener', template, `limit=${limit}`,
      () => fetch(`/api/stock/screener?template=${template}&limit=${limit}`).then(r => r.json())
    );
  },

  // ── 个股类 ─────────────────────────────────────────

  /** 基本面数据（PE/PB/市值等） */
  async fundamentals(code: string): Promise<{ data: ApiResponse<FundamentalsResult[]> | null; fromCache: boolean; isStale: boolean }> {
    return getCachedData('fundamentals', code, undefined,
      () => fetch(`/api/stock/fundamentals?codes=${code}`).then(r => r.json() as Promise<ApiResponse<FundamentalsResult[]>>)
    );
  },

  /** K线历史数据 */
  async kline(code: string, params: string): Promise<{ data: ApiResponse<KLineResult[]> | null; fromCache: boolean; isStale: boolean }> {
    return getCachedData('kline', code, params,
      () => fetch(`/api/stock/kline?code=${code}&${params}`).then(r => r.json() as Promise<ApiResponse<KLineResult[]>>)
    );
  },

  /** 个股新闻 */
  async news(code: string): Promise<{ data: ApiResponse<NewsResult[]> | null; fromCache: boolean; isStale: boolean }> {
    return getCachedData('news', code, undefined,
      () => fetch(`/api/stock/news?code=${code}&pageSize=10`).then(r => r.json() as Promise<ApiResponse<NewsResult[]>>)
    );
  },

  /** 个股公告 */
  async announcement(code: string): Promise<{ data: ApiResponse<AnnouncementResult[]> | null; fromCache: boolean; isStale: boolean }> {
    return getCachedData('announcement', code, undefined,
      () => fetch(`/api/stock/announcement?code=${code}&pageSize=10`).then(r => r.json() as Promise<ApiResponse<AnnouncementResult[]>>)
    );
  },

  /** 异动数据（涨停/龙虎榜等） */
  async alerts(alertType: string, date: string): Promise<{ data: ApiResponse<AlertResult[]> | null; fromCache: boolean; isStale: boolean }> {
    const key = `${alertType}_${date}`;
    return getCachedData('alerts', key, undefined,
      () => fetch(`/api/stock/alerts?type=${alertType}&pageSize=200`).then(r => r.json() as Promise<ApiResponse<AlertResult[]>>)
    );
  },
};
