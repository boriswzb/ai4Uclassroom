'use client';

/**
 * 量化系统全局缓存 Context
 *
 * 数据分层策略：
 *   IndexedDB（stockDataCache） → 服务器 API → 远端数据源
 *
 * QuantCacheProvider 在主页 mount 时初始化，为所有子组件提供：
 *   - indexData    ：指数行情（大盘/深证/创业板/科创50）
 *   - stockList    ：全市场股票列表
 *   - industryMap  ：行业板块映射
 *   - cache        ：DataCache 实例（内存 + sessionStorage，30s 内重复读取走内存）
 *
 * 所有行情数据通过 stockDataCache（IndexedDB）持久化，
 * 非交易时段关闭浏览器再打开，数据依然从 IndexedDB 读取，零网络请求。
 * 后台静默刷新保证数据新鲜度。
 */

import React, { createContext, useContext, useEffect, useRef, useCallback, useState } from 'react';
import { getDataCache, isMarketOpen, genScreenerCacheKey, DataCache } from './data-cache';
import { stockDataCache } from './stock-data-cache';
import type { RealtimeQuote } from '../types';

// ============ 类型 ============

interface CacheContextValue {
  cache: DataCache;
  // 指数数据 (大盘指)
  indexData: RealtimeQuote[] | null;
  refreshIndex: () => Promise<void>;
  // 股票列表
  stockList: string[] | null;
  refreshStockList: () => Promise<void>;
  // 行业映射
  industryMap: Record<string, string[]> | null;
  refreshIndustry: () => Promise<void>;
  // 全局刷新状态
  isRefreshing: boolean;
}

const QuantCacheContext = createContext<CacheContextValue | null>(null);

// ============ Provider ============

export function QuantCacheProvider({ children }: { children: React.ReactNode }) {
  const cache = getDataCache();
  const [indexData, setIndexData] = useState<RealtimeQuote[] | null>(null);
  const [stockList, setStockList] = useState<string[] | null>(null);
  const [industryMap, setIndustryMap] = useState<Record<string, string[]> | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 指数代码常量
  const INDEX_CODES = 'sh000001,sh399001,sz399006,sh000688';

  // 加载指数数据 → 优先 IndexedDB 缓存，后台静默刷新
  const refreshIndex = useCallback(async () => {
    const { data } = await stockDataCache.index();
    if (data?.success && data.data) {
      cache.setIndex('main', data.data as any);
      setIndexData(data.data as any);
    }
  }, [cache]);

  // 加载股票列表 → 优先 IndexedDB 缓存
  const refreshStockList = useCallback(async () => {
    const { data } = await stockDataCache.list();
    if (data?.success && data.data) {
      // DataCache 内存缓存（供 DataPanel 内部同步读取）
      const codeList = data.data.map((s: any) => s.code || s);
      cache.setStockList(codeList as any);
      setStockList(codeList as any);
    }
  }, [cache]);

  // 加载行业映射 → 优先 IndexedDB 缓存
  const refreshIndustry = useCallback(async () => {
    const { data } = await stockDataCache.board('avgChangePercent', 'desc', 60);
    if (data?.success && data.data) {
      // 转换为 industryMap 结构
      const map: Record<string, string[]> = {};
      data.data.forEach((b: any) => {
        if (b.name) map[b.name] = [];
      });
      cache.setIndustry(map);
      setIndustryMap(map);
    }
  }, [cache]);

  // 初始化：从 DataCache 内存恢复 + 触发 IndexedDB 后台刷新
  useEffect(() => {
    // 从内存/localStorage 恢复（同步，毫秒级）
    const cachedIndex = cache.getIndex('main');
    if (cachedIndex) setIndexData(cachedIndex.data);

    const cachedList = cache.getStockList();
    if (cachedList) setStockList(cachedList);

    const cachedIndustry = cache.getIndustry();
    if (cachedIndustry) setIndustryMap(cachedIndustry);

    // 后台静默刷新（从 IndexedDB 或网络）
    setTimeout(() => {
      refreshIndex();
      refreshStockList();
      refreshIndustry();
    }, 0);

    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [cache, refreshIndex, refreshStockList, refreshIndustry]);

  // 交易时段自动刷新指数（每 30s）
  useEffect(() => {
    const tick = () => {
      if (isMarketOpen()) refreshIndex();
    };
    refreshTimerRef.current = setInterval(tick, 30000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [refreshIndex]);

  const value: CacheContextValue = {
    cache,
    indexData,
    refreshIndex,
    stockList,
    refreshStockList,
    industryMap,
    refreshIndustry,
    isRefreshing,
  };

  return (
    <QuantCacheContext.Provider value={value}>
      {children}
    </QuantCacheContext.Provider>
  );
}

// ============ Hook ============

export function useQuantCache(): CacheContextValue {
  const ctx = useContext(QuantCacheContext);
  if (!ctx) throw new Error('useQuantCache must be used inside QuantCacheProvider');
  return ctx;
}

// ============ 选股器缓存辅助 ============

export function useScreenerCache() {
  const { cache } = useQuantCache();

  const getCached = useCallback((filters: Record<string, unknown>) => {
    const key = genScreenerCacheKey(filters);
    return cache.getScreener(key);
  }, [cache]);

  const setCached = useCallback((filters: Record<string, unknown>, data: unknown) => {
    const key = genScreenerCacheKey(filters);
    cache.setScreener(key, data);
  }, [cache]);

  return { getCached, setCached };
}
