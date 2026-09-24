/**
 * 增强回测引擎 — 事件驱动架构
 * 基于 VeighNa 事件总线设计
 * 支持：多股票组合、基准对比、完整绩效分析、ECharts 可视化
 */

import {
  KBar,
  BacktestConfig,
  BacktestResultV2,
  TradeRecord,
  Account,
  Position,
  Direction,
  Signal,
  DrawdownPoint,
  MonthlyReturn,
  TradeDetail,
  BacktestEvent,
  BacktestEventHandler,
  BacktestEventType,
  SubSignalInfo,
} from '../types';
import { Strategy } from '../strategies/strategy-engine';
import { dataSourceManager } from '../data/data-source';

// ==================== 事件总线 ====================

export class EventBus {
  private handlers: Map<BacktestEventType, Set<BacktestEventHandler>> = new Map();

  on(event: BacktestEventType, handler: BacktestEventHandler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  emit(event: BacktestEvent): void {
    this.handlers.get(event.type)?.forEach(h => {
      try { h(event); } catch (e) { console.error('[EventBus] handler error:', e); }
    });
  }

  emitMultiple(events: BacktestEvent[]): void {
    events.forEach(e => this.emit(e));
  }
}

// ==================== 持仓记录（带买入信息）====================

interface PositionDetail {
  code: string;
  volume: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  realizedPnL: number;
  buyTimestamp: number;   // 买入时间（计算持仓天数）
  buyPrice: number;       // 买入价格
}

// ==================== 增强回测引擎 ====================

export class EnhancedBacktestEngine {
  private config: Required<BacktestConfig>;
  private strategy: Strategy;
  private eventBus: EventBus;
  private account: Account;
  private positions: Map<string, PositionDetail> = new Map(); // code -> 持仓明细
  private trades: TradeRecord[] = [];
  private tradesDetail: TradeDetail[] = [];
  private equityCurve: { date: string; equity: number; benchmark?: number }[] = [];
  private dailyReturns: number[] = [];
  private kbarsCache: Map<string, KBar[]> = new Map();
  private benchmarkCache: KBar[] = [];
  private canTrade: Map<string, number> = new Map(); // code -> 最早可交易日 timestamp
  private tradingDays: { timestamp: number; date: string }[] = [];
  private totalCommission = 0;

  // 累计盈亏（卖出时累加）
  private cumulativePnL = 0;

  // 策略当前信号
  private currentSignals: Map<string, Signal> = new Map();

  constructor(config: BacktestConfig, strategy: Strategy, eventBus?: EventBus) {
    this.config = {
      startDate: config.startDate,
      endDate: config.endDate,
      initialCash: config.initialCash,
      commission: config.commission,
      slippage: config.slippage,
      strategy: config.strategy,
      stockCodes: config.stockCodes,
      benchmarkCode: config.benchmarkCode ?? '000001.SH',
      positionSize: config.positionSize ?? 0.1,
      maxPosition: config.maxPosition ?? 1,
      stopLossPct: config.stopLossPct ?? 0.07,
      takeProfitPct: config.takeProfitPct ?? 0.15,
    };
    this.strategy = strategy;
    this.eventBus = eventBus ?? new EventBus();

    this.account = {
      cash: this.config.initialCash,
      frozen: 0,
      totalAssets: this.config.initialCash,
      totalPnL: 0,
      initialCash: this.config.initialCash,
      positions: [],
    };
  }

  getEventBus(): EventBus { return this.eventBus; }

  // ── 主运行入口 ──
  async run(): Promise<BacktestResultV2> {
    console.log('[EnhancedBacktest] 开始回测...');
    console.log(`[EnhancedBacktest] 策略: ${this.strategy.name}`);
    console.log(`[EnhancedBacktest] 周期: ${this.config.startDate} ~ ${this.config.endDate}`);
    console.log(`[EnhancedBacktest] 初始资金: ${this.config.initialCash.toLocaleString()}`);
    console.log(`[EnhancedBacktest] 基准: ${this.config.benchmarkCode}`);

    await this.loadData();
    this.buildTradingDays();
    await this.runBacktest();
    return this.calculateResult();
  }

  // ── 加载K线数据 ──
  private async loadData(): Promise<void> {
    console.log('[EnhancedBacktest] 加载数据...');
    const start = new Date(this.config.startDate).getTime();
    const end = new Date(this.config.endDate).getTime();

    for (const code of this.config.stockCodes) {
      // 请求约500条（≈2年交易日），足够覆盖回测区间前后缓冲
      const kbars = await dataSourceManager.getKBar(code, start, end);
      // 按时间排序并截取区间
      kbars.sort((a, b) => a.timestamp - b.timestamp);
      const filtered = kbars.filter(b => b.timestamp >= start - 90 * 86400000 && b.timestamp <= end + 86400000);
      this.kbarsCache.set(code, filtered);
      console.log(`[EnhancedBacktest] ${code}: ${filtered.length} 条K线`);
    }

    if (this.config.benchmarkCode) {
      const benchKb = await dataSourceManager.getKBar(this.config.benchmarkCode, start, end);
      benchKb.sort((a, b) => a.timestamp - b.timestamp);
      const filteredBench = benchKb.filter(b => b.timestamp >= start - 90 * 86400000 && b.timestamp <= end + 86400000);
      this.benchmarkCache = filteredBench;
      console.log(`[EnhancedBacktest] 基准 ${this.config.benchmarkCode}: ${filteredBench.length} 条K线`);
    }
  }

  // ── 构建交易日列表 ──
  private buildTradingDays(): void {
    const start = new Date(this.config.startDate).getTime();
    const end = new Date(this.config.endDate).getTime();
    const days = new Map<number, string>();

    for (const [, kbars] of this.kbarsCache) {
      for (const bar of kbars) {
        if (bar.timestamp >= start && bar.timestamp <= end) {
          const d = new Date(bar.timestamp);
          const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          days.set(dayStart, dateStr);
        }
      }
    }

    this.tradingDays = Array.from(days.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ts, date]) => ({ timestamp: ts, date }));
    console.log(`[EnhancedBacktest] 共 ${this.tradingDays.length} 个交易日`);
  }

  // ── 核心回测循环 ──
  private async runBacktest(): Promise<void> {
    for (let di = 0; di < this.tradingDays.length; di++) {
      const { timestamp: dayTs, date } = this.tradingDays[di];

      // 收集当日所有标的 bar
      const dayBars: Map<string, KBar> = new Map();
      for (const [code, kbars] of this.kbarsCache) {
        const bar = kbars.find(b => {
          const bDate = new Date(b.timestamp);
          const bDay = new Date(bDate.getFullYear(), bDate.getMonth(), bDate.getDate()).getTime();
          return bDay === dayTs;
        });
        if (bar) dayBars.set(code, bar);
      }

      if (dayBars.size === 0) continue;

      // 1) 更新持仓价格
      this.updatePositions(dayBars);

      // 2) 更新策略 + 生成信号
      for (const [code, bar] of dayBars) {
        this.strategy.onBar(bar);
        const rawSignal = this.strategy.getSignal();
        if (rawSignal && rawSignal.code === code) {
          // EnsembleSignal → 提取子信号到 Signal 中（保持接口兼容）
          const signal: Signal = rawSignal as Signal;
          if ('subSignals' in rawSignal && rawSignal.subSignals) {
            signal.subSignals = rawSignal.subSignals as SubSignalInfo[];
          }
          this.currentSignals.set(code, signal);
          this.eventBus.emit({ type: 'signal', timestamp: dayTs, data: { code, signal } });
        }
        this.eventBus.emit({ type: 'bar', timestamp: dayTs, data: { code, bar } });
      }

      // 3) 执行交易
      for (const [code, signal] of this.currentSignals) {
        const bar = dayBars.get(code);
        if (!bar) continue;
        // 获取下一根K线用于执行（避免使用当前K线的close造成look-ahead bias）
        const nextBar = this.getNextBar(code, bar);
        await this.executeSignal(code, signal, bar, nextBar);
      }

      // 4) 检查止损/止盈（已持仓标的，需要获取下一bar用于执行）
      await this.checkStopLoss(dayBars);

      // 5) 检查风控
      this.checkRisk(dayBars);

      // 6) 记录当日权益
      this.recordEquity(dayTs, date);
    }
  }

  // ── 更新持仓价格 ──
  private updatePositions(dayBars: Map<string, KBar>): void {
    for (const [code, bar] of dayBars) {
      const pos = this.positions.get(code);
      if (pos) {
        pos.currentPrice = bar.close;
        pos.marketValue = pos.volume * bar.close;
        pos.unrealizedPnL = (bar.close - pos.avgCost) * pos.volume;
      }
    }
    const posValue = [...this.positions.values()].reduce((s, p) => s + p.marketValue, 0);
    this.account.totalAssets = this.account.cash + posValue;
    this.account.positions = [...this.positions.values()].map(p => ({
      code: p.code,
      volume: p.volume,
      avgCost: p.avgCost,
      currentPrice: p.currentPrice,
      marketValue: p.marketValue,
      unrealizedPnL: p.unrealizedPnL,
      realizedPnL: p.realizedPnL,
    }));
  }

  // ── 执行信号 ──
  private async executeSignal(code: string, signal: Signal, bar: KBar, nextBar: KBar | undefined): Promise<void> {
    // T+1 检查
    const canTradeTime = this.canTrade.get(code);
    if (canTradeTime !== undefined && bar.timestamp < canTradeTime) return;

    // 使用下一bar的开盘价作为执行价，若无则跳过（边界情况）
    const execPrice = nextBar ? nextBar.open : bar.close;
    if (!nextBar) return; // 边界情况无法执行

    const pos = this.positions.get(code);

    if (signal.direction === 'long' || signal.direction === 'neutral') {
      if (!pos || pos.volume === 0) {
        // 买入（使用下一bar开盘价执行，避免look-ahead bias）
        const maxVol = Math.floor(
          (this.account.cash * this.config.positionSize) / execPrice / 100
        ) * 100;
        if (maxVol < 100) return; // 资金不足1手

        const volume = Math.min(maxVol, Math.floor(this.account.cash / execPrice / 100) * 100);
        const commission = volume * execPrice * this.config.commission;
        const slippage = volume * execPrice * this.config.slippage;
        const cost = volume * execPrice + commission + slippage;

        if (cost > this.account.cash) return;

        this.account.cash -= cost;
        this.totalCommission += commission;

        const newPos: PositionDetail = {
          code,
          volume,
          avgCost: execPrice,
          currentPrice: execPrice,
          marketValue: volume * execPrice,
          unrealizedPnL: 0,
          realizedPnL: 0,
          buyTimestamp: bar.timestamp,
          buyPrice: execPrice,
        };
        this.positions.set(code, newPos);

        // T+1：下一个交易日才可卖出
        const nextDi = this.tradingDays.findIndex(d => d.timestamp > bar.timestamp);
        if (nextDi >= 0) {
          this.canTrade.set(code, this.tradingDays[nextDi].timestamp);
        }

        const trade: TradeRecord = {
          timestamp: bar.timestamp,
          code,
          direction: 'long',
          price: execPrice,
          volume,
          commission,
          pnl: 0,
        };
        this.trades.push(trade);
        this.eventBus.emit({ type: 'trade', timestamp: bar.timestamp, data: { code, trade } });
        console.log(`[EnhancedBacktest] 买入 ${code}: ${volume}手 @ ${execPrice.toFixed(2)}`);
      }
    } else if (signal.direction === 'short') {
      if (pos && pos.volume > 0) {
        // 卖出（平仓，使用下一bar开盘价执行）
        const volume = pos.volume;
        const commission = volume * execPrice * this.config.commission;
        const slippage = volume * execPrice * this.config.slippage;
        const netRevenue = volume * execPrice * (1 - this.config.commission) - slippage;
        const actualPnl = (execPrice - pos.avgCost) * volume - commission - slippage;

        this.account.cash += netRevenue;
        this.totalCommission += commission;
        this.cumulativePnL += actualPnl;
        this.account.totalPnL += actualPnl;

        const holdingDays = Math.max(1,
          Math.round((bar.timestamp - pos.buyTimestamp) / (24 * 60 * 60 * 1000))
        );

        const tradeDetail: TradeDetail = {
          timestamp: bar.timestamp,
          code,
          direction: 'short',
          price: execPrice,
          volume,
          commission,
          pnl: actualPnl,
          date: new Date(bar.timestamp).toISOString().slice(0, 10),
          turnoverRate: 0, // 流通股本未知，设为0
          profitOrLoss: actualPnl,
          cumulativePnL: this.cumulativePnL,
          holdingDays,
          profitOrLossPct: actualPnl / (pos.avgCost * volume),
          relativeReturn: 0,
        };

        // 基准收益
        if (this.benchmarkCache.length > 0) {
          const benchBar = this.benchmarkCache.find(b => {
            const bD = new Date(b.timestamp);
            const bDay = new Date(bD.getFullYear(), bD.getMonth(), bD.getDate()).getTime();
            const tDay = new Date(bar.timestamp);
            const tDayStart = new Date(tDay.getFullYear(), tDay.getMonth(), tDay.getDate()).getTime();
            return bDay === tDayStart;
          });
          if (benchBar) {
            const benchPrev = this.benchmarkCache.find(b => {
              const bD = new Date(b.timestamp);
              const bDay = new Date(bD.getFullYear(), bD.getMonth(), bD.getDate()).getTime();
              const prevDayStart = new Date(bar.timestamp - 24 * 60 * 60 * 1000).setHours(0, 0, 0, 0);
              return bDay === prevDayStart;
            });
            if (benchBar && benchPrev) {
              tradeDetail.benchmarkPrice = benchBar.close;
              tradeDetail.relativeReturn = (execPrice - pos.buyPrice) / pos.buyPrice
                - (benchBar.close - benchPrev.close) / benchPrev.close;
            }
          }
        }

        this.tradesDetail.push(tradeDetail);
        this.trades.push({
          timestamp: bar.timestamp,
          code,
          direction: 'short',
          price: execPrice,
          volume,
          commission,
          pnl: actualPnl,
        });

        this.positions.delete(code);
        this.canTrade.delete(code);

        this.eventBus.emit({ type: 'trade', timestamp: bar.timestamp, data: { code, trade: this.trades[this.trades.length - 1] } });
        console.log(`[EnhancedBacktest] 卖出 ${code}: ${volume}手 @ ${execPrice.toFixed(2)}, 盈亏: ${actualPnl.toFixed(2)}`);
      }
    }
  }

  // ── 止损/止盈 ──
  private async checkStopLoss(dayBars: Map<string, KBar>): Promise<void> {
    for (const [code, pos] of this.positions) {
      const bar = dayBars.get(code);
      if (!bar) continue;

      const pnlPct = (bar.close - pos.avgCost) / pos.avgCost;

      if (pnlPct <= -this.config.stopLossPct || pnlPct >= this.config.takeProfitPct) {
        // 获取下一根K线用于执行（避免look-ahead bias）
        const nextBar = this.getNextBar(code, bar);
        const execPrice = nextBar ? nextBar.open : bar.close;
        if (!nextBar) continue; // 边界情况无法执行

        const volume = pos.volume;
        const commission = volume * execPrice * this.config.commission;
        const slippage = volume * execPrice * this.config.slippage;
        const actualPnl = (execPrice - pos.avgCost) * volume - commission - slippage;
        const holdingDays = Math.max(1, Math.round((bar.timestamp - pos.buyTimestamp) / (24 * 60 * 60 * 1000)));

        this.account.cash += volume * execPrice - commission - slippage;
        this.totalCommission += commission;
        this.cumulativePnL += actualPnl;
        this.account.totalPnL += actualPnl;

        this.tradesDetail.push({
          timestamp: bar.timestamp,
          code,
          direction: 'short',
          price: execPrice,
          volume,
          commission,
          pnl: actualPnl,
          date: new Date(bar.timestamp).toISOString().slice(0, 10),
          turnoverRate: 0,
          profitOrLoss: actualPnl,
          cumulativePnL: this.cumulativePnL,
          holdingDays,
          profitOrLossPct: actualPnl / (pos.avgCost * volume),
          relativeReturn: 0,
        });

        this.trades.push({
          timestamp: bar.timestamp,
          code,
          direction: 'short',
          price: execPrice,
          volume,
          commission,
          pnl: actualPnl,
        });

        const reason = pnlPct <= -this.config.stopLossPct ? '止损' : '止盈';
        this.eventBus.emit({ type: 'risk', timestamp: bar.timestamp, data: { code, reason, pnlPct } });
        console.log(`[EnhancedBacktest] ${reason} ${code}: ${volume}手 @ ${execPrice.toFixed(2)}, ${(pnlPct * 100).toFixed(1)}%`);
        this.positions.delete(code);
        this.canTrade.delete(code);
      }
    }
  }

  /**
   * 获取下一根K线（用于look-ahead bias修正：信号在当前bar产生，以下一bar开盘价执行）
   */
  private getNextBar(code: string, currentBar: KBar): KBar | undefined {
    const kbars = this.kbarsCache.get(code);
    if (!kbars) return undefined;
    const idx = kbars.findIndex(b => b.timestamp === currentBar.timestamp);
    if (idx >= 0 && idx < kbars.length - 1) {
      return kbars[idx + 1];
    }
    return undefined;
  }

  // ── 检查风控 ──
  private checkRisk(dayBars: Map<string, KBar>): void {
    // 日亏损限制：单日亏损超过5%则强平所有持仓
    if (this.equityCurve.length < 2) return;
    const prevEquity = this.equityCurve[this.equityCurve.length - 1].equity;
    const currEquity = this.account.cash + [...this.positions.values()].reduce((s, p) => s + p.marketValue, 0);
    const dailyLoss = (currEquity - prevEquity) / prevEquity;
    if (dailyLoss <= -0.05 && this.positions.size > 0) {
      console.log(`[EnhancedBacktest] 触发日亏损限制 ${(dailyLoss * 100).toFixed(1)}%，强平所有持仓`);
      for (const [code, pos] of this.positions) {
        const bar = dayBars.get(code);
        if (!bar) continue;
        // 获取下一根K线用于执行（避免look-ahead bias）
        const nextBar = this.getNextBar(code, bar);
        const execPrice = nextBar ? nextBar.open : bar.close;
        if (!nextBar) continue; // 边界情况无法执行

        const revenue = pos.volume * execPrice * (1 - this.config.commission);
        const actualPnl = (execPrice - pos.avgCost) * pos.volume - pos.volume * execPrice * this.config.commission;
        this.account.cash += revenue;
        this.cumulativePnL += actualPnl;
        this.trades.push({
          timestamp: bar.timestamp,
          code,
          direction: 'short',
          price: execPrice,
          volume: pos.volume,
          commission: pos.volume * execPrice * this.config.commission,
          pnl: actualPnl,
        });
      }
      this.positions.clear();
      this.eventBus.emit({ type: 'risk', timestamp: dayBars.values().next().value?.timestamp ?? Date.now(), data: { reason: '日亏损限制' } });
    }
  }

  // ── 记录权益 ──
  private recordEquity(dayTimestamp: number, date: string): void {
    const posValue = [...this.positions.values()].reduce((s, p) => s + p.marketValue, 0);
    const totalAssets = this.account.cash + posValue;
    this.equityCurve.push({ date, equity: totalAssets });

    if (this.equityCurve.length > 1) {
      const prev = this.equityCurve[this.equityCurve.length - 2].equity;
      this.dailyReturns.push((totalAssets - prev) / prev);
    }

    this.eventBus.emit({ type: 'equity', timestamp: dayTimestamp, data: { date, equity: totalAssets } });
  }

  // ── 计算完整结果 ──
  private calculateResult(): BacktestResultV2 {
    const RISK_FREE_RATE = 0.03; // 年化无风险利率 3%
    const TRADING_DAYS = 252;

    const totalReturn = (this.account.totalAssets - this.config.initialCash) / this.config.initialCash;
    const tradingDays = this.equityCurve.length;
    const years = tradingDays / TRADING_DAYS;
    const annualReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;

    // ── 最大回撤 + 回撤曲线 ──
    let peak = this.equityCurve[0]?.equity ?? this.config.initialCash;
    const drawdownCurve: DrawdownPoint[] = [];
    let maxDrawdown = 0;

    for (const pt of this.equityCurve) {
      if (pt.equity > peak) peak = pt.equity;
      const dd = (peak - pt.equity) / peak;
      const ddAmt = peak - pt.equity;
      drawdownCurve.push({ timestamp: 0, equity: pt.equity, peak, drawdown: -dd, drawdownAmount: ddAmt });
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    // ── 年化波动率 ──
    const avgDailyReturn = this.dailyReturns.reduce((a, b) => a + b, 0) / (this.dailyReturns.length || 1);
    const variance = this.dailyReturns.reduce((s, r) => s + Math.pow(r - avgDailyReturn, 2), 0) / (this.dailyReturns.length || 1);
    const dailyVol = Math.sqrt(variance);
    const annualVolatility = dailyVol * Math.sqrt(TRADING_DAYS);

    // ── 夏普比率 ──
    const dailyRf = RISK_FREE_RATE / TRADING_DAYS;
    const excessReturns = this.dailyReturns.map(r => r - dailyRf);
    const avgExcess = excessReturns.reduce((a, b) => a + b, 0) / (excessReturns.length || 1);
    const excessStd = Math.sqrt(excessReturns.reduce((s, r) => s + Math.pow(r - avgExcess, 2), 0) / (excessReturns.length || 1));
    const sharpeRatio = excessStd > 0 ? (avgExcess / excessStd) * Math.sqrt(TRADING_DAYS) : 0;

    // ── Sortino 比率 ──
    const negativeReturns = this.dailyReturns.filter(r => r < 0);
    const downStd = Math.sqrt(negativeReturns.reduce((s, r) => s + Math.pow(r - avgDailyReturn, 2), 0) / (negativeReturns.length || 1));
    const sortinoRatio = downStd > 0 ? (avgDailyReturn / downStd) * Math.sqrt(TRADING_DAYS) : 0;

    // ── Calmar 比率 ──
    const calmarRatio = maxDrawdown > 0 ? annualReturn / maxDrawdown : 0;

    // ── 胜率 / 盈亏比 ──
    const closedTrades = this.trades.filter(t => t.direction === 'short');
    const profitableTrades = closedTrades.filter(t => t.pnl > 0).length;
    const winRate = closedTrades.length > 0 ? profitableTrades / closedTrades.length : 0;
    const avgProfit = closedTrades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) / (profitableTrades || 1);
    const avgLoss = closedTrades.filter(t => t.pnl < 0).reduce((s, t) => s + Math.abs(t.pnl), 0) / ((closedTrades.length - profitableTrades) || 1);
    const profitLossRatio = avgLoss > 0 ? avgProfit / avgLoss : 0;

    // ── 最大连续盈亏次数 ──
    let maxConsecutiveWin = 0, maxConsecutiveLoss = 0;
    let curWin = 0, curLoss = 0;
    for (const t of closedTrades) {
      if (t.pnl > 0) { curWin++; curLoss = 0; maxConsecutiveWin = Math.max(maxConsecutiveWin, curWin); }
      else { curLoss++; curWin = 0; maxConsecutiveLoss = Math.max(maxConsecutiveLoss, curLoss); }
    }

    // ── 平均持仓天数 ──
    const avgHoldingDays = this.tradesDetail.length > 0
      ? this.tradesDetail.reduce((s, t) => s + t.holdingDays, 0) / this.tradesDetail.length
      : 0;

    // ── Alpha / Beta ──
    let alpha = 0, beta = 0, benchmarkReturn = 0;
    if (this.benchmarkCache.length > 0 && this.dailyReturns.length > 0) {
      // 构建基准日收益率
      const benchReturns: number[] = [];
      for (let i = 1; i < this.equityCurve.length; i++) {
        const currDate = this.equityCurve[i].date;
        const prevDate = this.equityCurve[i - 1].date;
        const currBar = this.benchmarkCache.find(b => {
          const d = new Date(b.timestamp);
          return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` === currDate;
        });
        const prevBar = this.benchmarkCache.find(b => {
          const d = new Date(b.timestamp);
          return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` === prevDate;
        });
        if (currBar && prevBar && prevBar.close > 0) {
          benchReturns.push((currBar.close - prevBar.close) / prevBar.close);
        } else {
          benchReturns.push(0);
        }
      }

      // 对齐长度
      const len = Math.min(this.dailyReturns.length, benchReturns.length);
      const excess = this.dailyReturns.slice(0, len).map((r, i) => r - dailyRf);
      const benchExcess = benchReturns.slice(0, len).map(r => r - dailyRf);

      const avgEx = excess.reduce((a, b) => a + b, 0) / (len || 1);
      const avgBx = benchExcess.reduce((a, b) => a + b, 0) / (len || 1);
      const varEx = excess.reduce((s, r) => s + Math.pow(r - avgEx, 2), 0) / (len || 1);
      const covar = excess.reduce((s, r, i) => s + (r - avgEx) * (benchExcess[i] - avgBx), 0) / (len || 1);
      beta = varEx > 0 ? covar / varEx : 1;
      alpha = avgEx - beta * avgBx;

      // 基准总收益率
      if (this.benchmarkCache.length >= 2) {
        const firstBench = this.benchmarkCache[0].close;
        const lastBench = this.benchmarkCache[this.benchmarkCache.length - 1].close;
        benchmarkReturn = (lastBench - firstBench) / firstBench;
      }
    }

    // ── 月度收益 ──
    const monthlyReturns: MonthlyReturn[] = [];
    const monthMap = new Map<string, { ret: number; trades: number; days: Set<string> }>();

    for (let i = 1; i < this.equityCurve.length; i++) {
      const date = this.equityCurve[i].date;
      const [year, month] = date.slice(0, 7).split('-').map(Number);
      const key = `${year}-${month}`;
      const prevEquity = this.equityCurve[i - 1].equity;
      const dailyRet = (this.equityCurve[i].equity - prevEquity) / prevEquity;

      if (!monthMap.has(key)) monthMap.set(key, { ret: 0, trades: 0, days: new Set() });
      const m = monthMap.get(key)!;
      m.ret = (1 + m.ret) * (1 + dailyRet) - 1;
      m.days.add(date.slice(0, 10));
    }

    // 统计每月交易次数
    for (const td of this.tradesDetail) {
      const [year, month] = td.date.slice(0, 7).split('-').map(Number);
      const key = `${year}-${month}`;
      if (monthMap.has(key)) monthMap.get(key)!.trades++;
    }

    let cumRet = 0;
    const sortedKeys = [...monthMap.keys()].sort();
    for (const key of sortedKeys) {
      const [year, month] = key.split('-').map(Number);
      const m = monthMap.get(key)!;
      cumRet = (1 + cumRet) * (1 + m.ret) - 1;
      monthlyReturns.push({
        year, month,
        return: m.ret,
        cumulativeReturn: cumRet,
        trades: m.trades,
        tradingDays: m.days.size,
      });
    }

    // ── 填充日期标注 ──
    // equityCurve[0] 没有基准，需要补全
    const equityCurveWithDate = this.equityCurve.map((pt, i) => {
      let bench: number | undefined;
      if (this.benchmarkCache.length > 0 && i > 0) {
        const currDate = pt.date;
        const currBar = this.benchmarkCache.find(b => {
          const d = new Date(b.timestamp);
          return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` === currDate;
        });
        if (currBar) bench = currBar.close;
      }
      return { date: pt.date, equity: pt.equity, benchmark: bench };
    });

    // 补充回撤曲线的 timestamp
    for (let i = 0; i < drawdownCurve.length; i++) {
      const dateStr = this.equityCurve[i]?.date;
      if (dateStr) {
        const [y, m, d] = dateStr.split('-').map(Number);
        drawdownCurve[i].timestamp = new Date(y, m - 1, d).getTime();
      }
    }

    const result: BacktestResultV2 = {
      config: this.config,
      totalReturn,
      annualReturn,
      maxDrawdown,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      winRate,
      profitLossRatio,
      totalTrades: this.trades.length,
      benchmarkReturn,
      alpha,
      beta,
      annualVolatility,
      maxConsecutiveWin,
      maxConsecutiveLoss,
      avgHoldingDays,
      totalCommission: this.totalCommission,
      equityCurveWithDate,
      drawdownCurve,
      dailyReturns: this.dailyReturns,
      monthlyReturns,
      tradeDetails: this.tradesDetail,
      riskFreeRate: RISK_FREE_RATE,
    };

    console.log('\n========== 增强回测结果 ==========');
    console.log(`总收益率:     ${(totalReturn * 100).toFixed(2)}%`);
    console.log(`年化收益率:   ${(annualReturn * 100).toFixed(2)}%`);
    console.log(`最大回撤:     ${(maxDrawdown * 100).toFixed(2)}%`);
    console.log(`夏普比率:     ${sharpeRatio.toFixed(2)}`);
    console.log(`Sortino比率:  ${sortinoRatio.toFixed(2)}`);
    console.log(`Calmar比率:   ${calmarRatio.toFixed(2)}`);
    console.log(`Alpha:        ${alpha.toFixed(4)}`);
    console.log(`Beta:         ${beta.toFixed(2)}`);
    console.log(`年化波动率:   ${(annualVolatility * 100).toFixed(2)}%`);
    console.log(`胜率:         ${(winRate * 100).toFixed(2)}%`);
    console.log(`盈亏比:       ${profitLossRatio.toFixed(2)}`);
    console.log(`总交易次数:   ${this.trades.length}`);
    console.log(`累计手续费:   ¥${this.totalCommission.toFixed(2)}`);
    console.log(`平均持仓天数: ${avgHoldingDays.toFixed(1)}天`);
    console.log('====================================\n');

    return result;
  }
}

// ==================== 便捷函数 ====================

export async function runEnhancedBacktest(
  code: string,
  strategyType: 'macd' | 'bollinger' | 'rsi' | 'kdj' | 'ma' | 'voting' | 'filter' | 'dynamic' | 'weighted' | 'cci' | 'obv' | 'adx',
  startDate: string,
  endDate: string,
  initialCash: number = 1000000,
  benchmarkCode: string = '000001.SH',
): Promise<BacktestResultV2> {
  const { StrategyFactory } = await import('../strategies/strategy-engine');
  const { StrategyEnsemble } = await import('../strategies/strategy-ensemble');

  let strategy: Strategy;

  // 判断是单策略还是组合策略
  const ensembleModes = ['voting', 'filter', 'dynamic', 'weighted'];
  if (ensembleModes.includes(strategyType)) {
    // 构建组合策略（固定使用5个基础策略）
    const baseStrategies = (
      ['macd', 'kdj', 'ma', 'bollinger', 'rsi'] as const
    ).map(t => StrategyFactory.create(t));

    const ensembleMode = strategyType as 'voting' | 'filter' | 'dynamic' | 'weighted';
    const ensemble = new StrategyEnsemble(
      `组合策略(${ensembleMode})`,
      { mode: ensembleMode, strategies: baseStrategies }
    );
    strategy = ensemble as unknown as Strategy;
  } else {
    strategy = StrategyFactory.create(strategyType as 'macd' | 'bollinger' | 'rsi' | 'kdj' | 'ma');
  }

  const config: BacktestConfig = {
    startDate,
    endDate,
    initialCash,
    commission: 0.0003,
    slippage: 0.0001,
    strategy: strategy.config,
    stockCodes: [code],
    benchmarkCode,
    stopLossPct: 0.07,
    takeProfitPct: 0.25,
  };

  const engine = new EnhancedBacktestEngine(config, strategy);
  return engine.run();
}
