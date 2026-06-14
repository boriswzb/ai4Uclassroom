/**
 * 风控引擎
 * 基于 VeighNa 的风控设计
 * 支持止损、止盈、仓位限制、单笔订单限制、日亏损限制
 */

import { Position, Order, RiskRule, RiskEvent, Account } from '../types';

// ==================== 风控规则实现 ====================

/** 止损规则 */
export class StopLossRule implements RiskRule {
  id = 'stop_loss';
  name = '止损规则';
  enabled = true;
  type: RiskRule['type'] = 'stop_loss';
  threshold: number; // 止损比例，如 0.07 表示亏损7%时止损
  action: RiskRule['action'] = 'close';

  constructor(threshold: number = 0.07) {
    this.threshold = threshold;
  }
}

/** 止盈规则 */
export class StopProfitRule implements RiskRule {
  id = 'stop_profit';
  name = '止盈规则';
  enabled = true;
  type: RiskRule['type'] = 'stop_profit';
  threshold: number; // 止盈比例，如 0.15 表示盈利15%时止盈
  action: RiskRule['action'] = 'close';

  constructor(threshold: number = 0.15) {
    this.threshold = threshold;
  }
}

/** 仓位限制规则（threshold 单位为"手"，1手=100股） */
export class PositionLimitRule implements RiskRule {
  id = 'position_limit';
  name = '仓位限制规则';
  enabled = true;
  type: RiskRule['type'] = 'position_limit';
  threshold: number; // 最大持仓手数（1手=100股）
  action: RiskRule['action'] = 'reject';

  constructor(threshold: number = 100) { // 默认100手=10,000股
    this.threshold = threshold;
  }
}

/** 单笔订单限制规则 */
export class SingleOrderLimitRule implements RiskRule {
  id = 'single_order_limit';
  name = '单笔订单限制';
  enabled = true;
  type: RiskRule['type'] = 'single_order_limit';
  threshold: number; // 单笔最大金额
  action: RiskRule['action'] = 'reject';

  constructor(threshold: number = 100000) {
    this.threshold = threshold;
  }
}

/** 日亏损限制规则 */
export class DailyLossLimitRule implements RiskRule {
  id = 'daily_loss_limit';
  name = '日亏损限制';
  enabled = true;
  type: RiskRule['type'] = 'daily_loss_limit';
  threshold: number; // 日最大亏损比例
  action: RiskRule['action'] = 'close';
  private dailyStartEquity: number = 0;
  private triggered: boolean = false;

  constructor(threshold: number = 0.05) {
    this.threshold = threshold;
  }

  reset(equity: number): void {
    this.dailyStartEquity = equity;
    this.triggered = false;
  }

  check(equity: number): boolean {
    if (this.triggered) return true;
    if (this.dailyStartEquity === 0) {
      this.dailyStartEquity = equity;
      return false;
    }
    const loss = (this.dailyStartEquity - equity) / this.dailyStartEquity;
    if (loss > this.threshold) {
      this.triggered = true;
      return true;
    }
    return false;
  }
}

// ==================== 风控引擎 ====================

export class RiskEngine {
  private rules: Map<string, RiskRule> = new Map();
  private events: RiskEvent[] = [];
  private account: Account;

  constructor(initialCash: number = 1000000) {
    this.account = {
      cash: initialCash,
      frozen: 0,
      totalAssets: initialCash,
      totalPnL: 0,
      positions: []
    };

    // 默认规则
    this.addRule(new StopLossRule(0.07));    // 7%止损
    this.addRule(new StopProfitRule(0.15));  // 15%止盈
    this.addRule(new PositionLimitRule(100)); // 最大100手=10,000股
    this.addRule(new SingleOrderLimitRule(100000)); // 单笔最大10万
    this.addRule(new DailyLossLimitRule(0.05)); // 日亏5%停止交易
  }

  /** 添加风控规则 */
  addRule(rule: RiskRule): void {
    this.rules.set(rule.id, rule);
  }

  /** 移除风控规则 */
  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  /** 获取规则 */
  getRule(ruleId: string): RiskRule | undefined {
    return this.rules.get(ruleId);
  }

  /** 启用/禁用规则 */
  setRuleEnabled(ruleId: string, enabled: boolean): void {
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.enabled = enabled;
    }
  }

  /** 获取所有规则 */
  getAllRules(): RiskRule[] {
    return Array.from(this.rules.values());
  }

  /** 获取风控事件日志 */
  getEvents(): RiskEvent[] {
    return [...this.events];
  }

  /** 清空事件日志 */
  clearEvents(): void {
    this.events = [];
  }

  /** 检查订单是否允许执行 */
  checkOrder(order: Order, currentPrice: number): { allowed: boolean; reason?: string } {
    // 检查各项规则
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      const result = this.checkRule(rule, order, currentPrice);
      if (!result.allowed) {
        this.addEvent({
          ruleId: rule.id,
          ruleName: rule.name,
          timestamp: Date.now(),
          message: result.reason || 'Order rejected by risk rule',
          action: rule.action
        });
        return result;
      }
    }

    return { allowed: true };
  }

  /** 检查持仓是否触发风控 */
  checkPosition(position: Position): { triggered: boolean; ruleId?: string; action?: RiskRule['action'] } {
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      if (rule.type === 'stop_loss' || rule.type === 'stop_profit') {
        const pnlRatio = position.unrealizedPnL / (position.avgCost * position.volume);

        if (rule.type === 'stop_loss' && pnlRatio < -rule.threshold) {
          this.addEvent({
            ruleId: rule.id,
            ruleName: rule.name,
            timestamp: Date.now(),
            message: `触发止损: 亏损${(pnlRatio * 100).toFixed(2)}%, 阈值${(rule.threshold * 100).toFixed(0)}%`,
            action: rule.action
          });
          return { triggered: true, ruleId: rule.id, action: rule.action };
        }

        if (rule.type === 'stop_profit' && pnlRatio > rule.threshold) {
          this.addEvent({
            ruleId: rule.id,
            ruleName: rule.name,
            timestamp: Date.now(),
            message: `触发止盈: 盈利${(pnlRatio * 100).toFixed(2)}%, 阈值${(rule.threshold * 100).toFixed(0)}%`,
            action: rule.action
          });
          return { triggered: true, ruleId: rule.id, action: rule.action };
        }
      }
    }

    return { triggered: false };
  }

  /** 检查账户日亏损 */
  checkDailyLoss(): { triggered: boolean; reason?: string } {
    const dailyRule = this.rules.get('daily_loss_limit') as DailyLossLimitRule | undefined;
    if (dailyRule && dailyRule.enabled) {
      if (dailyRule.check(this.account.totalAssets)) {
        return {
          triggered: true,
          reason: `触发日亏损限制: 当日亏损超过${(dailyRule.threshold * 100).toFixed(0)}%`
        };
      }
    }
    return { triggered: false };
  }

  /** 更新账户信息 */
  updateAccount(account: Partial<Account>): void {
    this.account = { ...this.account, ...account };
  }

  /** 获取账户信息 */
  getAccount(): Account {
    return { ...this.account };
  }

  /** 重置日数据 */
  resetDaily(): void {
    const dailyRule = this.rules.get('daily_loss_limit') as DailyLossLimitRule | undefined;
    if (dailyRule) {
      dailyRule.reset(this.account.totalAssets);
    }
  }

  private checkRule(
    rule: RiskRule,
    order: Order,
    currentPrice: number
  ): { allowed: boolean; reason?: string } {
    switch (rule.type) {
      case 'position_limit': {
        const currentPosition = this.account.positions.find(p => p.code === order.code);
        // threshold 单位为"手"（1手=100股），比较时需换算
        const maxShares = rule.threshold * 100;
        const totalVolume = (currentPosition?.volume || 0) + order.volume;
        if (totalVolume > maxShares) {
          return { allowed: false, reason: `超过仓位限制: ${totalVolume}股 > ${rule.threshold}手（${maxShares}股）` };
        }
        break;
      }

      case 'single_order_limit': {
        const orderValue = order.price * order.volume;
        if (orderValue > rule.threshold) {
          return { allowed: false, reason: `超过单笔订单限制: ${orderValue} > ${rule.threshold}` };
        }
        break;
      }
    }

    return { allowed: true };
  }

  private addEvent(event: RiskEvent): void {
    this.events.push(event);
    console.log(`[RiskEngine] ${event.ruleName}: ${event.message}`);
  }
}

// ==================== 持仓管理器 ====================

export class PositionManager {
  private positions: Map<string, Position> = new Map();
  // Bug2 fix: 记录每只股票的首次买入日期（YYYYMMDD），用于 T+1 跨日判断
  private buyDates: Map<string, string> = new Map();

  constructor() {}

  /** 获取持仓 */
  getPosition(code: string): Position | undefined {
    return this.positions.get(code);
  }

  /** 获取所有持仓 */
  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /** 更新持仓价格 */
  updatePrice(code: string, currentPrice: number): void {
    const position = this.positions.get(code);
    if (position) {
      position.currentPrice = currentPrice;
      position.marketValue = position.volume * currentPrice;
      position.unrealizedPnL = (currentPrice - position.avgCost) * position.volume;
    }
  }

  /** 开仓（buyDate: 首次买入日期 YYYYMMDD，Bug2 fix） */
  openPosition(code: string, volume: number, price: number, direction: 'long' | 'short', buyDate?: string): void {
    const existing = this.positions.get(code);

    if (existing) {
      // 加仓（Bug: marketValue 和 currentPrice 未更新，导致市值不变但持仓量增加）
      const totalVolume = existing.volume + volume;
      existing.avgCost = (existing.avgCost * existing.volume + price * volume) / totalVolume;
      existing.volume = totalVolume;
      existing.currentPrice = price;
      existing.marketValue = totalVolume * price;
      existing.unrealizedPnL = (price - existing.avgCost) * totalVolume;
    } else {
      // Bug2 fix: 新仓时记录买入日期，用于 T+1 跨日判断
      if (buyDate) {
        this.buyDates.set(code, buyDate);
      }
      // 新仓
      this.positions.set(code, {
        code,
        volume,
        avgCost: price,
        currentPrice: price,
        marketValue: volume * price,
        unrealizedPnL: 0,
        realizedPnL: 0
      });
    }
  }

  /** Bug2 fix: 获取持仓的买入日期 */
  getBuyDate(code: string): string | undefined {
    return this.buyDates.get(code);
  }

  /** Bug2 fix: 恢复持仓时批量注入买入日期（SimulatorPersistence 调用） */
  restoreBuyDates(buyDates: Map<string, string>): void {
    this.buyDates = new Map(buyDates);
  }

  /** 平仓（全平或部分平） */
  closePosition(code: string, volume: number, price: number): number {
    const position = this.positions.get(code);
    if (!position) return 0;

    const pnl = (price - position.avgCost) * volume;
    position.realizedPnL += pnl;
    position.volume -= volume;

    if (position.volume <= 0) {
      this.positions.delete(code);
      this.buyDates.delete(code); // Bug2 fix: 清仓时同步清除买入日期
    } else {
      position.marketValue = position.volume * price;
    }

    return pnl;
  }

  /** 清空所有持仓（仅清除 positions，保留 buyDates，用于 restore 时） */
  clearPositionsOnly(): void {
    this.positions.clear();
  }

  /** 清空所有持仓（reset 时调用，清除两个 Map） */
  clear(): void {
    this.positions.clear();
    this.buyDates.clear();
  }

  /** 从持久化恢复持仓（外部调用，不经过 openPosition 计算均价） */
  restorePosition(position: Position): void {
    this.positions.set(position.code, { ...position });
  }
}
