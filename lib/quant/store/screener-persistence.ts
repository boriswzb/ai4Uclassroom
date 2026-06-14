/**
 * 选股历史持久化
 * 将用户每次选股的筛选条件和结果摘要存入 IndexedDB
 */

import { db } from '../db/database';
import type { DbScreenerHistory } from '../db/schema';

// ==================== 类型 ====================

export interface ScreenerFilters {
  industry: string;
  priceMin: string;
  priceMax: string;
  peMin: string;
  peMax: string;
  pbMin: string;
  pbMax: string;
  mktCapMin: string;
  mktCapMax: string;
  turnoverMin: string;
  changeMin: string;
  changeMax: string;
  excludeSt: boolean;
  sortBy: string;
  sortOrder: string;
  scoreSort: boolean;
  techSignal: string;
  maFilter: string;
  bollFilter: string;
  cciFilter: string;
  obvFilter: string;
  adxFilter: string;
  sentimentFilter: string;
  ratingFilter: string;
}

export interface FactorConfig {
  selectedFactors: string[];
  factorPeriod: string;
}

// ==================== 本地存储键 ====================
const FACTOR_CONFIG_KEY = 'quant_factor_config';

// ==================== 服务 ====================

class ScreenerPersistenceService {
  /**
   * 保存一次选股记录
   */
  async saveHistory(
    userId: string,
    filters: ScreenerFilters,
    totalCount: number,
    topStocks: string[],
    duration: number
  ): Promise<void> {
    const d = db.screenerHistory;
    if (!d) return;
    const id = crypto.randomUUID();
    const record: DbScreenerHistory = {
      id,
      userId,
      timestamp: Date.now(),
      filters,
      totalCount,
      topStocks,
      duration,
    };
    await d.add(record);
  }

  /**
   * 获取当前用户最近 N 条选股历史（默认10条）
   */
  async getHistory(userId: string, limit = 10): Promise<DbScreenerHistory[]> {
    const d = db.screenerHistory;
    if (!d) return [];
    return d
      .where('userId')
      .equals(userId)
      .reverse()
      .limit(limit)
      .toArray();
  }

  /**
   * 获取最近一次选股记录（用于页面恢复筛选条件）
   */
  async getLastHistory(userId: string): Promise<DbScreenerHistory | undefined> {
    const records = await this.getHistory(userId, 1);
    return records[0];
  }

  /**
   * 清除当前用户全部历史
   */
  async clearHistory(userId: string): Promise<void> {
    const d = db.screenerHistory;
    if (!d) return;
    await d.where('userId').equals(userId).delete();
  }

  /**
   * 保存因子配置到本地存储
   */
  saveFactorConfig(config: FactorConfig): void {
    try {
      localStorage.setItem(FACTOR_CONFIG_KEY, JSON.stringify(config));
    } catch (e) {
      console.error('[ScreenerPersistence] saveFactorConfig error:', e);
    }
  }

  /**
   * 加载因子配置
   */
  getFactorConfig(): FactorConfig | null {
    try {
      const raw = localStorage.getItem(FACTOR_CONFIG_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as FactorConfig;
    } catch (e) {
      console.error('[ScreenerPersistence] getFactorConfig error:', e);
      return null;
    }
  }
}

export const screenerPersistence = new ScreenerPersistenceService();
