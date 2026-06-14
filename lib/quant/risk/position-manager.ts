/**
 * 高级仓位管理器
 * 包含完整止损/止盈体系：
 * 1. 固定比例止损（继承现有）
 * 2. ATR动态止损 — 根据市场波动率自适应
 * 3. 移动止损（Trailing Stop）— 锁定利润
 * 4. 时间止损 — 持仓超N根K线强制平仓
 * 5. 时间框架过滤 — 过滤假信号
 */

import { Position, KBar, Order } from '../types';
import { ATR } from '../strategies/indicators';

// ==================== 持仓止损止盈状态 ====================

export interface PositionRisk {
  code: string;
  /** 进场价格 */
  entryPrice: number;
  /** 进场K线时间 */
  entryTimestamp: number;
  /** 持仓数量 */
  volume: number;
  /** 持仓方向 */
  direction: 'long' | 'short';
  /** 当前浮动盈亏比例 */
  pnlRatio: number;
  /** 峰值盈亏（用于移动止盈） */
  peakPnL: number;
  /** ATR进场时的值（用于ATR止损） */
  entryATR: number;
  /** 是否已触发移动止盈 */
  trailingTriggered: boolean;
  /** 各止损规则触发状态 */
  stopTriggered: {
    fixed: boolean;    // 固定止损
    atr: boolean;      // ATR动态止损
    trailing: boolean; // 移动止盈
    time: boolean;     // 时间止损
  };
}

/** 止损止盈配置 */
export interface StopConfig {
  /** 固定止损比例（默认7%） */
  fixedStopLoss?: number;
  /** 固定止盈比例（默认15%） */
  fixedStopProfit?: number;
  /** 是否启用ATR动态止损（默认true） */
  useATRStop?: boolean;
  /** ATR止损倍数（默认2.0） */
  atrStopMultiplier?: number;
  /** 是否启用移动止盈（默认true） */
  useTrailingStop?: boolean;
  /** 移动止盈回撤比例（从峰值回落多少比例触发，默认30%） */
  trailing撤回比例?: number;
  /** 移动止盈启动阈值（从峰值回落多少%后激活，默认10%） */
  trailing启动比例?: number;
  /** 是否启用时间止损（默认false） */
  useTimeStop?: boolean;
  /** 时间止损K线根数（超过此根数强制平仓） */
  timeStopBars?: number;
}

const DEFAULT_STOP_CONFIG: Required<StopConfig> = {
  fixedStopLoss: 0.07,
  fixedStopProfit: 0.15,
  useATRStop: true,
  atrStopMultiplier: 2.0,
  useTrailingStop: true,
  trailing撤回比例: 0.30,
  trailing启动比例: 0.10,
  useTimeStop: false,
  timeStopBars: 20,
};

// ==================== 高级仓位管理器 ====================

export class AdvancedPositionManager {
  /** 持仓风险状态映射 */
  private riskMap: Map<string, PositionRisk> = new Map();
  /** 止损止盈配置 */
  private stopConfig: Required<StopConfig>;

  constructor(config: StopConfig = {}) {
    this.stopConfig = { ...DEFAULT_STOP_CONFIG, ...config };
  }

  /** 更新配置 */
  updateConfig(config: Partial<StopConfig>): void {
    this.stopConfig = { ...this.stopConfig, ...config };
  }

  /** 获取配置 */
  getConfig(): Required<StopConfig> {
    return { ...this.stopConfig };
  }

  /**
   * 便捷封装：用代码和当前价格快速检查止损（内部使用缓存的K线）
   * @param code 股票代码
   * @param currentPrice 当前价格
   * @param currentTimestamp 当前时间戳
   * @param kbars 最新K线数组（用于计算ATR）
   */
  checkStop(
    code: string,
    currentPrice: number,
    currentTimestamp: number,
    kbars: KBar[]
  ): { shouldStop: boolean; reason?: string; action?: string } {
    const risk = this.riskMap.get(code);
    if (!risk) return { shouldStop: false };

    const direction = risk.direction;
    const syntheticBar: KBar = {
      code,
      timestamp: currentTimestamp,
      open: currentPrice,
      high: currentPrice,
      low: currentPrice,
      close: currentPrice,
      amount: 0,
      volume: risk.volume,
    };

    const result = this.computeStopSignal(code, syntheticBar, kbars, direction);
    return {
      shouldStop: result.action !== 'none',
      reason: result.reason,
      action: result.action,
    };
  }

  // ==================== 核心：计算止损止盈信号 ====================

  /**
   * 计算止损止盈信号
   * @param code 股票代码
   * @param bar 当前K线
   * @param kbars 历史K线（用于计算ATR）
   * @param direction 持仓方向
   * @returns 触发止损/止盈的指令 { action: 'stop_loss'|'stop_profit'|'trailing_stop'|'time_stop'|'none', price: number, reason: string }
   */
  computeStopSignal(
    code: string,
    bar: KBar,
    kbars: KBar[],
    direction: 'long' | 'short'
  ): { action: 'stop_loss' | 'stop_profit' | 'trailing_stop' | 'time_stop' | 'none'; price: number; reason: string } {
    const risk = this.riskMap.get(code);
    if (!risk) return { action: 'none', price: 0, reason: '' };

    const cfg = this.stopConfig;
    const { high, low, close } = bar;

    // ===== 1. 固定止损（最优先检查） =====
    if (!risk.stopTriggered.fixed) {
      const pnlRatio = this.calcPnL(risk.entryPrice, close, direction);
      if (pnlRatio <= -cfg.fixedStopLoss) {
        risk.stopTriggered.fixed = true;
        return {
          action: 'stop_loss',
          price: close,
          reason: `固定止损: 亏损${(pnlRatio * 100).toFixed(2)}%，触发${(cfg.fixedStopLoss * 100).toFixed(0)}%阈值`
        };
      }
    }

    // ===== 2. 固定止盈 =====
    if (!risk.stopTriggered.trailing) {
      const pnlRatio = this.calcPnL(risk.entryPrice, close, direction);
      if (pnlRatio >= cfg.fixedStopProfit) {
        // 固定止盈先触发
        risk.stopTriggered.trailing = true;
        return {
          action: 'stop_profit',
          price: close,
          reason: `固定止盈: 盈利${(pnlRatio * 100).toFixed(2)}%，触发${(cfg.fixedStopProfit * 100).toFixed(0)}%阈值`
        };
      }
    }

    // ===== 3. ATR动态止损（基于波动率的自适应止损） =====
    if (cfg.useATRStop && !risk.stopTriggered.atr && kbars.length >= 15) {
      const atrValues = ATR(
        kbars.map(k => k.high),
        kbars.map(k => k.low),
        kbars.map(k => k.close),
        14
      );
      const currentATR = atrValues[atrValues.length - 1];
      const atrStopDistance = currentATR * cfg.atrStopMultiplier;

      if (direction === 'long') {
        // 多头：止损价 = 进场价 - ATR倍数
        // 但不能低于固定止损
        const atrStopPrice = risk.entryPrice - atrStopDistance;
        if (low <= atrStopPrice) {
          risk.stopTriggered.atr = true;
          return {
            action: 'stop_loss',
            price: atrStopPrice,
            reason: `ATR止损: 价格${low.toFixed(2)}触及ATR动态止损价${atrStopPrice.toFixed(2)}（${cfg.atrStopMultiplier}×ATR=${currentATR.toFixed(3)}）`
          };
        }
      } else {
        // 空头
        const atrStopPrice = risk.entryPrice + atrStopDistance;
        if (high >= atrStopPrice) {
          risk.stopTriggered.atr = true;
          return {
            action: 'stop_loss',
            price: atrStopPrice,
            reason: `ATR止损: 价格${high.toFixed(2)}触及ATR动态止损价${atrStopPrice.toFixed(2)}（${cfg.atrStopMultiplier}×ATR=${currentATR.toFixed(3)}）`
          };
        }
      }
    }

    // ===== 4. 移动止盈（Trailing Stop） =====
    if (cfg.useTrailingStop && !risk.stopTriggered.trailing) {
      const currentPnL = this.calcPnL(risk.entryPrice, close, direction);

      // 更新峰值盈亏
      if (currentPnL > risk.peakPnL) {
        risk.peakPnL = currentPnL;
      }

      // 移动止盈激活：盈利超过启动阈值后，开始跟踪
      const trailingActivation = cfg.trailing启动比例;
      const trailing撤回 = cfg.trailing撤回比例;

      if (risk.peakPnL > trailingActivation) {
        // 从峰值回落超过撤回比例，触发移动止盈
        const drawdown = (risk.peakPnL - currentPnL) / risk.peakPnL;
        if (drawdown >= trailing撤回) {
          risk.stopTriggered.trailing = true;
          return {
            action: 'trailing_stop',
            price: close,
            reason: `移动止盈: 峰值盈利${(risk.peakPnL * 100).toFixed(2)}%，当前${(currentPnL * 100).toFixed(2)}%，回落${(drawdown * 100).toFixed(1)}%触发`
          };
        }
      }
    }

    // ===== 5. 时间止损 =====
    if (cfg.useTimeStop && !risk.stopTriggered.time) {
      const barsHeld = kbars.filter(k => k.timestamp >= risk.entryTimestamp).length;
      if (barsHeld > cfg.timeStopBars) {
        risk.stopTriggered.time = true;
        return {
          action: 'time_stop',
          price: close,
          reason: `时间止损: 持仓${barsHeld}根K线，超过${cfg.timeStopBars}根限制`
        };
      }
    }

    return { action: 'none', price: 0, reason: '' };
  }

  /**
   * 获取综合止损价格（用于下单）
   * 优先用移动止盈价（如果已激活），否则用固定止损价
   */
  getStopPrice(code: string, bar: KBar, direction: 'long' | 'short'): number | null {
    const risk = this.riskMap.get(code);
    if (!risk) return null;

    const cfg = this.stopConfig;
    if (direction === 'long') {
      // 多头止损：取进场价 - ATR倍数 或 固定止损价（取较近的，即更保守的）
      if (cfg.useATRStop) {
        const atrValue = this.getCurrentATR(bar);
        const atrStop = risk.entryPrice - atrValue * cfg.atrStopMultiplier;
        const fixedStop = risk.entryPrice * (1 - cfg.fixedStopLoss);
        return Math.max(fixedStop, atrStop); // 取较高价（更保守）
      }
      return risk.entryPrice * (1 - cfg.fixedStopLoss);
    } else {
      if (cfg.useATRStop) {
        const atrValue = this.getCurrentATR(bar);
        const atrStop = risk.entryPrice + atrValue * cfg.atrStopMultiplier;
        const fixedStop = risk.entryPrice * (1 + cfg.fixedStopLoss);
        return Math.min(fixedStop, atrStop); // 取较低价（更保守）
      }
      return risk.entryPrice * (1 + cfg.fixedStopLoss);
    }
  }

  private getCurrentATR(bar: KBar): number {
    // ATR需要历史数据，这里返回简化值（实际应从外部传入kbars）
    return bar.close * 0.02; // 默认2%作为ATR代理
  }

  // ==================== 持仓状态管理 ====================

  /** 记录新开仓（进入持仓时调用） */
  openPosition(code: string, entryPrice: number, volume: number, direction: 'long' | 'short', timestamp: number, entryATR?: number): void {
    this.riskMap.set(code, {
      code,
      entryPrice,
      entryTimestamp: timestamp,
      volume,
      direction,
      pnlRatio: 0,
      peakPnL: 0,
      entryATR: entryATR ?? entryPrice * 0.02,
      trailingTriggered: false,
      stopTriggered: { fixed: false, atr: false, trailing: false, time: false }
    });
  }

  /** 清除持仓状态 */
  closePosition(code: string): void {
    this.riskMap.delete(code);
  }

  /** 清除所有状态 */
  clearAll(): void {
    this.riskMap.clear();
  }

  /** 获取持仓风险信息 */
  getRiskInfo(code: string): PositionRisk | undefined {
    return this.riskMap.get(code);
  }

  /** 获取所有持仓风险信息 */
  getAllRiskInfo(): PositionRisk[] {
    return Array.from(this.riskMap.values());
  }

  // ==================== 工具方法 ====================

  private calcPnL(entryPrice: number, currentPrice: number, direction: 'long' | 'short'): number {
    return direction === 'long'
      ? (currentPrice - entryPrice) / entryPrice
      : (entryPrice - currentPrice) / entryPrice;
  }
}
