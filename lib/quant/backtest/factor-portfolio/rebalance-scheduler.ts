/**
 * 调仓调度器 — RebalanceScheduler
 *
 * 职责：根据配置的模式决定是否在当前交易日触发调仓
 */

import { RebalanceMode } from '../../types';

export class RebalanceScheduler {
  private mode: RebalanceMode;
  private lastRebalanceTs: number = 0;
  private lastRebalanceWeek: number = -1;
  private biweeklyCounter: number = 0; // 双周计数器

  constructor(mode: RebalanceMode) {
    this.mode = mode;
  }

  /**
   * 判断是否应该调仓
   * @param dateTs 当前交易日时间戳
   * @returns true = 触发调仓
   */
  shouldRebalance(dateTs: number): boolean {
    const d = new Date(dateTs);
    const dayOfWeek = d.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const ts = d.getTime();

    switch (this.mode.type) {
      case 'daily':
        // 每日调仓
        return true;

      case 'weekly':
        // 每周固定星期几调仓
        return dayOfWeek === this.mode.dayOfWeek;

      case 'biweekly':
        // 每两周调仓一次（在固定星期几）
        if (dayOfWeek !== this.mode.dayOfWeek) return false;
        const weekNum = Math.floor(ts / (7 * 86400000));
        if (weekNum !== this.lastRebalanceWeek) {
          this.lastRebalanceWeek = weekNum;
          this.biweeklyCounter++;
        }
        return this.biweeklyCounter % 2 === 1;

      case 'threshold':
        // 阈值触发模式由 engine 判断，这里返回 false
        // engine 会传入 scoreChange 信息单独判断
        return false;

      case 'ic-signal':
        // IC 信号模式由 engine 判断
        return false;

      default:
        return false;
    }
  }

  /**
   * 记录已执行调仓的日期（阈值/IC 模式会用）
   */
  recordRebalance(dateTs: number): void {
    this.lastRebalanceTs = dateTs;
  }

  /** 获取上次调仓时间戳 */
  getLastRebalanceTs(): number {
    return this.lastRebalanceTs;
  }

  reset(): void {
    this.lastRebalanceTs = 0;
    this.lastRebalanceWeek = -1;
    this.biweeklyCounter = 0;
  }
}
