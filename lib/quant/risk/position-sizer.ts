/**
 * 高级仓位管理器
 * 包含多种仓位计算算法：
 * 1. 固定比例 — 账户的固定百分比
 * 2. ATR动态 — 根据市场波动率调整仓位
 * 3. Kelly Criterion — 依据历史胜率/盈亏比最优仓位
 * 4. 波动率调整 — 根据近期波动率反向调整仓位
 */

import { KBar } from '../types';
import { ATR, SMA } from '../strategies/indicators';

// ==================== 仓位计算配置 ====================

export interface PositionSizingConfig {
  /** 账户总资金 */
  accountBalance: number;
  /** 单笔最大风险比例（默认2%，单次交易最多亏这么多） */
  riskPerTrade?: number;
  /** 账户最大持仓比例（默认30%） */
  maxPositionRatio?: number;
  /** 最大持仓股票数 */
  maxPositions?: number;
  /** 是否启用Kelly公式（默认false，保守起见） */
  useKelly?: boolean;
  /** Kelly上限（默认0.25，即实际用Kelly的1/4，保守化处理） */
  kellyCeiling?: number;
  /** 是否启用波动率调整（默认true） */
  useVolatilityAdjust?: boolean;
  /** 目标波动率（年化%，默认15%） */
  targetVolatility?: number;
  /** 波动率调整计算周期（默认20） */
  volLookback?: number;
  /** ATR计算周期 */
  atrPeriod?: number;
  /** ATR止损倍数 */
  atrStopMultiplier?: number;
}

export interface SizeResult {
  /** 建议买入股数（整手） */
  shares: number;
  /** 买入金额 */
  amount: number;
  /** 风险金额（本次交易最大亏损） */
  riskAmount: number;
  /** 仓位比例（占总资金%） */
  positionRatio: number;
  /** 使用的方法 */
  method: 'fixed' | 'atr' | 'kelly' | 'volatility';
  /** 信号强度调整后的仓位比例 */
  strengthAdjustedShares: number;
  /** 备注/警告信息 */
  warning?: string;
}

export interface HistoricalStats {
  /** 历史交易次数 */
  totalTrades: number;
  /** 胜率 */
  winRate: number;
  /** 平均盈利 */
  avgWin: number;
  /** 平均亏损 */
  avgLoss: number;
  /** 盈亏比 */
  profitLossRatio: number;
  /** 最大连续亏损次数 */
  maxConsecutiveLoss: number;
}

// ==================== 核心仓位管理器 ====================

export class PositionSizer {
  private config: Required<PositionSizingConfig>;
  /** 历史统计数据（用于Kelly计算） */
  private historicalStats: HistoricalStats = {
    totalTrades: 0,
    winRate: 0.5,
    avgWin: 0,
    avgLoss: 0,
    profitLossRatio: 1,
    maxConsecutiveLoss: 0
  };

  constructor(config: PositionSizingConfig) {
    const defaults: Required<PositionSizingConfig> = {
      accountBalance: config.accountBalance,
      riskPerTrade: 0.02,
      maxPositionRatio: 0.30,
      maxPositions: 5,
      useKelly: false,
      kellyCeiling: 0.25,
      useVolatilityAdjust: true,
      targetVolatility: 0.15,
      volLookback: 20,
      atrPeriod: 14,
      atrStopMultiplier: 2.0,
    };
    this.config = { ...defaults, ...config };
  }

  // ==================== 公开 API ====================

  /** 更新配置 */
  updateBalance(balance: number): void {
    this.config.accountBalance = balance;
  }

  /** 更新历史统计（用于Kelly计算） */
  updateHistoricalStats(stats: Partial<HistoricalStats>): void {
    this.historicalStats = { ...this.historicalStats, ...stats };
    // 自动推导盈亏比
    if (this.historicalStats.avgWin > 0 && this.historicalStats.avgLoss > 0) {
      this.historicalStats.profitLossRatio = this.historicalStats.avgWin / this.historicalStats.avgLoss;
    }
  }

  /**
   * 计算建议仓位
   * @param entryPrice 进场价格
   * @param atr ATR值（从外部传入可复用）
   * @param signalStrength 信号强度 0-1
   * @param stopLossPrice 止损价格（可选，不传则用ATR计算）
   */
  calculate(
    entryPrice: number,
    atr?: number,
    signalStrength: number = 1.0,
    stopLossPrice?: number
  ): SizeResult {
    const cfg = this.config;

    // 1. 计算风险金额（本次交易最大亏损）
    const riskAmount = cfg.accountBalance * cfg.riskPerTrade;

    // 2. 计算止损距离
    let stopDistance: number;
    let stopPrice: number;
    if (stopLossPrice) {
      stopDistance = Math.abs(entryPrice - stopLossPrice);
      stopPrice = stopLossPrice;
    } else if (atr) {
      stopDistance = atr * cfg.atrStopMultiplier;
      stopPrice = entryPrice - stopDistance;
    } else {
      // 没有ATR也没有止损价，默认用5%止损
      stopDistance = entryPrice * 0.05;
      stopPrice = entryPrice - stopDistance;
    }

    if (stopDistance <= 0) {
      return {
        shares: 0,
        amount: 0,
        riskAmount: 0,
        positionRatio: 0,
        method: 'fixed',
        strengthAdjustedShares: 0,
        warning: '止损距离为0，无法计算仓位'
      };
    }

    // 3. 基础仓位 = 风险金额 / 每股风险
    let rawShares = Math.floor(riskAmount / stopDistance);
    // 调整为整手（100股倍数）
    rawShares = Math.floor(rawShares / 100) * 100;

    // 4. Kelly公式修正（可选）
    let kellyShares = rawShares;
    if (cfg.useKelly && this.historicalStats.totalTrades > 10) {
      kellyShares = this.applyKelly(rawShares);
    }

    // 5. 波动率调整（高波动减仓）
    let volAdjustedShares = kellyShares;
    if (cfg.useVolatilityAdjust && atr) {
      volAdjustedShares = this.applyVolatilityAdjust(kellyShares, atr, entryPrice);
    }

    // 6. 信号强度调整
    const strengthAdjustedShares = Math.floor(volAdjustedShares * Math.min(1, Math.max(0.3, signalStrength)));

    // 7. 仓位上限检查
    const maxShares = Math.floor((cfg.accountBalance * cfg.maxPositionRatio) / entryPrice / 100) * 100;
    const shares = Math.min(strengthAdjustedShares, maxShares);

    // 8. 持仓数量上限
    const finalShares = this.applyMaxPositionsLimit(shares, entryPrice);

    const amount = finalShares * entryPrice;
    const positionRatio = amount / cfg.accountBalance;

    return {
      shares: finalShares,
      amount,
      riskAmount,
      positionRatio,
      method: cfg.useKelly ? 'kelly' : cfg.useVolatilityAdjust ? 'atr' : 'fixed',
      strengthAdjustedShares: finalShares,
      warning: positionRatio > 0.2 ? '警告：仓位超过20%' : undefined
    };
  }

  // ==================== Kelly Criterion ====================

  /**
   * Kelly公式：f = (P × B - Q) / B
   * f = 最优仓位比例
   * P = 胜率
   * B = 盈亏比（avgWin/avgLoss）
   * Q = 1 - P
   */
  private applyKelly(baseShares: number): number {
    const { winRate, profitLossRatio } = this.historicalStats;

    if (profitLossRatio <= 0 || winRate <= 0) {
      return baseShares; // 数据不足，用基础仓位
    }

    const Q = 1 - winRate;
    // Kelly值
    const kelly = (winRate * profitLossRatio - Q) / profitLossRatio;

    // 保守化处理：实际只用Kelly的一半（半Kelly）
    const safeKelty = Math.max(0, Math.min(kelly * 0.5, this.config.kellyCeiling));

    const kellyShares = Math.floor(baseShares * (safeKelty / this.config.riskPerTrade));

    return kellyShares;
  }

  // ==================== 波动率调整 ====================

  /**
   * 波动率调整：目标是将组合波动率维持在 targetVolatility
   * 高波动 → 减仓，低波动 → 可适当加仓
   */
  private applyVolatilityAdjust(shares: number, atr: number, price: number): number {
    const cfg = this.config;

    // 将ATR转换为年化波动率（简化：ATR/price * sqrt(252)）
    const currentVol = (atr / price) * Math.sqrt(252);

    // 波动率调整系数 = targetVol / currentVol（上限1.5，下限0.5）
    const volRatio = cfg.targetVolatility / currentVol;
    const volFactor = Math.min(1.5, Math.max(0.5, volRatio));

    return Math.floor(shares * volFactor / 100) * 100;
  }

  // ==================== 持仓数量上限 ====================

  private applyMaxPositionsLimit(shares: number, price: number): number {
    const cfg = this.config;
    // 当前已用仓位（估算：假设每只股票等权配置）
    // 实际应从外部传入当前持仓数，这里做简化处理
    const estimatedPositions = 1; // 默认1只
    if (estimatedPositions >= cfg.maxPositions) {
      return 0; // 已达上限，不再加仓
    }
    return shares;
  }

  // ==================== ATR计算（供外部使用） ====================

  /** 从K线计算ATR值 */
  static computeATR(kbars: KBar[], period: number = 14): number {
    if (kbars.length < period + 1) return 0;

    const highs = kbars.map(k => k.high);
    const lows = kbars.map(k => k.low);
    const closes = kbars.map(k => k.close);

    const atrValues = ATR(highs, lows, closes, period);
    return atrValues[atrValues.length - 1] ?? 0;
  }

  /** 计算历史波动率（用于波动率调整） */
  static computeHistoricalVolatility(kbars: KBar[], period: number = 20): number {
    if (kbars.length < period + 1) return 0.15; // 默认15%

    const closes = kbars.map(k => k.close);
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }

    const recent = returns.slice(-period);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / recent.length;
    const stdDev = Math.sqrt(variance);

    // 年化
    return stdDev * Math.sqrt(252);
  }
}
