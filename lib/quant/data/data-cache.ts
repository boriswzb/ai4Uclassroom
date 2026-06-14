/**
 * 数据缓存管理器
 * 
 * 策略:
 * 1. 指数/股票列表等静态数据 → localStorage 持久化，session 内内存缓存
 * 2. K线数据 → 内存缓存 + localStorage 回退，非交易时段不刷新
 * 3. 实时行情 → 内存缓存，交易时段按 interval 自动刷新
 * 4. 缓存分层的 TTL，避免每次打开页面重新加载
 */

import { KBar, RealtimeQuote } from '../types';

// ============ 类型定义 ============

export interface CachedItem<T> {
  data: T;
  timestamp: number;
  ttl: number; // ms, 0 = 永不过期
}

export interface CacheConfig {
  // 指数数据 (上证/深证/创业板等)
  indexTTL: number;        // 默认 30s
  // 股票实时行情
  quoteTTL: number;        // 默认 15s
  // K线数据 (日线)
  klineDayTTL: number;     // 默认 5min
  // 股票列表/基本信息
  stockListTTL: number;    // 默认 24h
  // 行业/板块数据
  industryTTL: number;     // 默认 10min
}

// ============ A股交易时间判断 ============

const MARKET_OPEN_AM  = 9 * 60 + 30; // 9:30
const MARKET_CLOSE_AM = 11 * 60 + 30; // 11:30
const MARKET_OPEN_PM  = 13 * 60;       // 13:00
const MARKET_CLOSE_PM = 15 * 60;       // 15:00

function getBeijingMinutes(): number {
  // 北京时间 (UTC+8)
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const beijing = new Date(utc + 8 * 60 * 60 * 1000);
  return beijing.getHours() * 60 + beijing.getMinutes();
}

export function isMarketOpen(): boolean {
  const min = getBeijingMinutes();
  const isWeekday = new Date().getDay() >= 1 && new Date().getDay() <= 5;
  if (!isWeekday) return false;
  return (min >= MARKET_OPEN_AM && min < MARKET_CLOSE_AM) ||
         (min >= MARKET_OPEN_PM && min < MARKET_CLOSE_PM);
}

export function isMarketClosedToday(): boolean {
  // 简单判断: 15:00 后视为收盘，或周末（周六/周日）也视为休市
  const min = getBeijingMinutes();
  const day = new Date().getDay();
  const isWeekend = day === 0 || day === 6; // 周日=0，周六=6
  return isWeekend || min >= MARKET_CLOSE_PM;
}

export function getSecondsToNextOpen(): number {
  const min = getBeijingMinutes();
  if (isMarketOpen()) return Infinity;
  if (min < MARKET_OPEN_AM) {
    return (MARKET_OPEN_AM - min) * 60;
  }
  if (min >= MARKET_CLOSE_AM && min < MARKET_OPEN_PM) {
    return (MARKET_OPEN_PM - min) * 60;
  }
  // 已收盘，计算到明天 9:30
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 30, 0, 0);
  return Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
}

// ============ 缓存键名约定 ============

const PREFIX = 'quant_cache_';

function key(type: string, id?: string): string {
  return id ? `${PREFIX}${type}_${id}` : `${PREFIX}${type}`;
}

// ============ 内存缓存 (session 级) ============

const memoryCache = new Map<string, CachedItem<any>>();

// ============ localStorage 读写 ============

function lsGet<T>(k: string): CachedItem<T> | null {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    return JSON.parse(raw) as CachedItem<T>;
  } catch {
    return null;
  }
}

function lsSet<T>(k: string, item: CachedItem<T>): void {
  try {
    localStorage.setItem(k, JSON.stringify(item));
  } catch (e) {
    // localStorage 满了，清理旧数据
    clearOldCache(20);
    try {
      localStorage.setItem(k, JSON.stringify(item));
    } catch {}
  }
}

function lsDel(k: string): void {
  try {
    localStorage.removeItem(k);
  } catch {}
}

// 清理旧缓存，保留最新百分比
function clearOldCache(keepPercent: number = 50): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keysToRemove.push(k);
    }
    // 按时间排序，删除最老的
    const sorted = keysToRemove.sort((a, b) => {
      const ia = lsGet(a);
      const ib = lsGet(b);
      return (ia?.timestamp || 0) - (ib?.timestamp || 0);
    });
    const keep = Math.floor(sorted.length * keepPercent / 100);
    sorted.slice(0, keep).forEach(k => lsDel(k));
  } catch {}
}

// ============ 缓存读取核心逻辑 ============

function isExpired(item: CachedItem<any>): boolean {
  if (item.ttl === 0) return false; // 永不过期
  return Date.now() - item.timestamp > item.ttl;
}

// 优先读内存，其次读 localStorage，最后返回 null
function getFromCache<T>(type: string, id?: string, forceFresh?: boolean): T | null {
  const k = key(type, id);
  
  // 1. 内存缓存
  const mem = memoryCache.get(k);
  if (mem && !isExpired(mem) && !forceFresh) {
    return mem.data as T;
  }
  
  // 2. localStorage
  const disk = lsGet<T>(k);
  if (disk && !isExpired(disk) && !forceFresh) {
    // 同步到内存
    memoryCache.set(k, disk);
    return disk.data as T;
  }
  
  // 3. 过期或不存在
  return null;
}

// ============ 缓存写入 ============

function setCache<T>(type: string, id: string | undefined, data: T, ttl: number): void {
  const k = key(type, id);
  const item: CachedItem<T> = { data, timestamp: Date.now(), ttl };
  
  // 写内存
  memoryCache.set(k, item);
  
  // 写 localStorage (id 存在才持久化)
  if (id !== undefined) {
    lsSet(k, item);
  }
}

// ============ 条件刷新逻辑 ============

// 当市场关闭时，使用更长 TTL
function adjustTTL(baseTTL: number): number {
  if (isMarketOpen()) return baseTTL;
  // 收盘后用更长的缓存时间（数据已经定格）
  return Math.max(baseTTL * 10, 60000);
}

// ============ 对外 API ============

const DEFAULT_CONFIG: CacheConfig = {
  indexTTL: 30000,        // 30s
  quoteTTL: 15000,         // 15s
  klineDayTTL: 300000,     // 5min
  stockListTTL: 86400000,  // 24h
  industryTTL: 600000,     // 10min
};

export class DataCache {
  private config: CacheConfig;
  private refreshTimers = new Map<string, NodeJS.Timeout>();
  
  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ---- 指数缓存 ----
  
  getIndex(code: string): { data: RealtimeQuote[]; fromCache: boolean } | null {
    const cached = getFromCache<RealtimeQuote[]>('index', code);
    if (cached) return { data: cached, fromCache: true };
    
    // 检查磁盘缓存
    const disk = lsGet<RealtimeQuote[]>(key('index', code));
    if (disk && !isExpired(disk)) {
      memoryCache.set(key('index', code), disk);
      return { data: disk.data, fromCache: true };
    }
    return null;
  }
  
  setIndex(code: string, data: RealtimeQuote[]): void {
    setCache('index', code, data, adjustTTL(this.config.indexTTL));
  }
  
  // ---- 实时行情缓存 ----
  
  getQuote(codes: string[]): Map<string, RealtimeQuote> {
    const result = new Map<string, RealtimeQuote>();
    
    for (const code of codes) {
      const cached = getFromCache<RealtimeQuote>('quote', code);
      if (cached) {
        result.set(code, cached);
      }
    }
    return result;
  }
  
  setQuote(code: string, data: RealtimeQuote): void {
    setCache('quote', code, data, adjustTTL(this.config.quoteTTL));
  }
  
  // ---- K线缓存 ----
  
  getKLine(code: string, type: 'day' | 'week' | 'month' = 'day'): KBar[] | null {
    const cached = getFromCache<KBar[]>('kline', `${code}_${type}`);
    if (cached) return cached;
    return null;
  }
  
  setKLine(code: string, type: 'day' | 'week' | 'month', data: KBar[]): void {
    const ttl = type === 'day' ? this.config.klineDayTTL : this.config.klineDayTTL * 2;
    setCache('kline', `${code}_${type}`, data, adjustTTL(ttl));
  }
  
  // ---- 股票列表缓存 ----
  
  getStockList(): string[] | null {
    return getFromCache<string[]>('stocklist', undefined);
  }
  
  setStockList(data: string[]): void {
    setCache('stocklist', undefined, data, this.config.stockListTTL);
    lsSet(key('stocklist'), { data, timestamp: Date.now(), ttl: this.config.stockListTTL });
  }
  
  // ---- 行业/板块缓存 ----
  
  getIndustry(): Record<string, string[]> | null {
    return getFromCache<Record<string, string[]>>('industry', 'map');
  }
  
  setIndustry(data: Record<string, string[]>): void {
    setCache('industry', 'map', data, this.config.industryTTL);
  }
  
  // ---- 智能选股结果缓存 ----
  
  getScreener(keyHash: string): any | null {
    return getFromCache('screener', keyHash);
  }
  
  setScreener(keyHash: string, data: any, isClosed?: boolean): void {
    // TTL策略：交易时段5min，非交易时段4h（数据已定格，可放心用缓存）
    const ttl = isClosed ? 14400000 : 300000; // 4h / 5min
    setCache('screener', keyHash, data, ttl);
  }
  
  // ---- 自动刷新调度 ----
  
  // 调度实时行情刷新 (交易时段每 interval ms 一次)
  scheduleQuoteRefresh(codes: string[], fetchFn: (codes: string[]) => Promise<void>, interval?: number): void {
    const keyName = `quote_refresh_${codes.sort().join(',')}`;
    
    // 清除旧的
    this.stopRefresh(keyName);
    
    if (!isMarketOpen()) return; // 休市不调度
    
    const tick = async () => {
      if (!isMarketOpen()) {
        this.stopRefresh(keyName);
        return;
      }
      await fetchFn(codes);
    };
    
    // 立即执行一次
    tick();
    
    const iv = interval || this.config.quoteTTL;
    const timer = setInterval(tick, iv);
    this.refreshTimers.set(keyName, timer);
  }
  
  stopRefresh(keyName: string): void {
    const t = this.refreshTimers.get(keyName);
    if (t) {
      clearInterval(t);
      this.refreshTimers.delete(keyName);
    }
  }
  
  stopAllRefresh(): void {
    this.refreshTimers.forEach(t => clearInterval(t));
    this.refreshTimers.clear();
  }
  
  // ---- 清理 ----
  
  clearAll(): void {
    this.stopAllRefresh();
    memoryCache.clear();
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) keysToRemove.push(k);
      }
      keysToRemove.forEach(k => lsDel(k));
    } catch {}
  }
  
  // 清理特定类型的缓存
  invalidate(type: string, id?: string): void {
    const k = key(type, id);
    memoryCache.delete(k);
    lsDel(k);
  }
}

// ============ 全局单例 ============

let globalCache: DataCache | null = null;

export function getDataCache(): DataCache {
  if (!globalCache) {
    globalCache = new DataCache();
  }
  return globalCache;
}

// ============ 辅助: 生成选股器缓存 key ============

export function genScreenerCacheKey(filters: Record<string, any>): string {
  const str = JSON.stringify(filters, Object.keys(filters).sort());
  // 简单 hash
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
