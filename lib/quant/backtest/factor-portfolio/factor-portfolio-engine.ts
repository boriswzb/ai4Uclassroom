/**
 * 因子组合回测引擎 — FactorPortfolioEngine
 *
 * 基于截面多因子评分的组合回测引擎。
 *
 * 流程：
 * 1. 初始化：预加载所有股票历史K线
 * 2. 按日循环：
 *    a. 更新持仓价格 → 计算 equity
 *    b. 检查是否调仓日
 *       → CrossSectionalScorer 对截面打分
 *       → PortfolioConstructor 构建目标组合
 *       → 计算需要买卖的股票
 *    c. 执行调仓（T+1，佣金，滑点）
 *    d. 记录 equity curve
 * 3. 计算绩效指标
 */

import {
  KBar,
  Account,
  Position,
  BacktestEvent,
  BacktestEventHandler,
  BacktestEventType,
  FactorBacktestConfig,
  PortfolioBacktestResult,
  StockScore,
  PortfolioTarget,
  RebalanceRecord,
  DrawdownPoint,
  MonthlyReturn,
  TradeDetail,
} from '../../types';
import { EventBus } from '../enhanced-engine'; // 复用事件总线
import { CrossSectionalDataLoader } from './cross-sectional-loader';
import { CrossSectionalScorer } from './cross-sectional-scorer';
import { RebalanceScheduler } from './rebalance-scheduler';
import { PortfolioConstructor } from './portfolio-constructor';

// ==================== 持仓记录 ====================

interface PositionDetail {
  code: string;
  volume: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  realizedPnL: number;
  buyTimestamp: number;
  buyPrice: number;
  weight: number;        // 当前持仓权重
}

// ==================== 引擎 ====================

export class FactorPortfolioEngine {
  private config: Required<FactorBacktestConfig>;
  private eventBus: EventBus;
  private account: Account;
  private positions: Map<string, PositionDetail> = new Map();
  private equityCurve: { date: string; equity: number; benchmark?: number }[] = [];
  private drawdownCurve: DrawdownPoint[] = [];
  private dailyReturns: number[] = [];
  private tradeDetails: TradeDetail[] = [];
  private rebalanceLog: RebalanceRecord[] = [];
  private tradingDays: { timestamp: number; date: string }[] = [];

  // 数据层
  private loader: CrossSectionalDataLoader;
  private scorer: CrossSectionalScorer;
  private scheduler: RebalanceScheduler;
  private constructor_: PortfolioConstructor;

  // 状态
  private cumulativePnL = 0;
  private totalCommission = 0;
  private peakEquity = 0;
  private prevScores: Map<string, StockScore> = new Map();
  private lastRebalanceTs = 0;
  private pendingBuys: Map<string, { volume: number; price: number; weight: number; scoreDate: string; execDate: string }> = new Map();
  private pendingSells: Map<string, { volume: number; price: number; execDate: string }> = new Map();
  private holdingPeriods: number[] = []; // 持仓天数记录

  constructor(config: FactorBacktestConfig) {
    this.config = {
      startDate: config.startDate,
      endDate: config.endDate,
      initialCash: config.initialCash,
      commission: config.commission,
      slippage: config.slippage,
      stockPool: config.stockPool,
      benchmarkCode: config.benchmarkCode ?? '000001.SH',
      factorWeights: config.factorWeights ?? null,
      rebalanceMode: config.rebalanceMode,
      topN: config.topN,
      weightMethod: config.weightMethod,
      maxSinglePosition: config.maxSinglePosition ?? 0.2,
      stopLossPct: config.stopLossPct ?? 0.07,
      takeProfitPct: config.takeProfitPct ?? 0.15,
    };

    this.eventBus = new EventBus();
    this.loader = new CrossSectionalDataLoader();
    this.scorer = new CrossSectionalScorer({ factorWeights: this.config.factorWeights });
    this.scheduler = new RebalanceScheduler(this.config.rebalanceMode);
    this.constructor_ = new PortfolioConstructor(
      this.config.topN,
      this.config.weightMethod,
      this.config.maxSinglePosition
    );

    this.account = {
      cash: this.config.initialCash,
      frozen: 0,
      totalAssets: this.config.initialCash,
      totalPnL: 0,
      positions: [],
    };
  }

  getEventBus(): EventBus { return this.eventBus; }

  // ── 主运行入口 ──────────────────────────────────────────────

  async run(): Promise<PortfolioBacktestResult> {
    console.log('[FactorPortfolio] 开始多因子组合回测...');
    console.log(`[FactorPortfolio] 股票池: ${this.config.stockPool.length} 只`);
    console.log(`[FactorPortfolio] 周期: ${this.config.startDate} ~ ${this.config.endDate}`);
    console.log(`[FactorPortfolio] 初始资金: ${this.config.initialCash.toLocaleString()}`);
    console.log(`[FactorPortfolio] 持仓: top ${this.config.topN}`);
    console.log(`[FactorPortfolio] 调仓模式: ${JSON.stringify(this.config.rebalanceMode)}`);

    const start = new Date(this.config.startDate).getTime();
    const end = new Date(this.config.endDate).getTime();

    // 1. 预加载数据
    await this.loader.preload(this.config.stockPool, start, end);
    if (this.config.benchmarkCode) {
      await this.loader.preloadBenchmark(this.config.benchmarkCode, start, end);
    }

    // 2. 构建交易日列表
    this.tradingDays = this.loader.buildTradingDays(start, end);
    console.log(`[FactorPortfolio] 共 ${this.tradingDays.length} 个交易日`);

    // 3. 主循环
    for (let di = 0; di < this.tradingDays.length; di++) {
      const { timestamp: dayTs, date } = this.tradingDays[di];

      // 获取下个交易日（用于 T+1 执行）
      const nextDay = di < this.tradingDays.length - 1 ? this.tradingDays[di + 1] : null;
      const nextDayTs = nextDay?.timestamp ?? dayTs + 86400000;

      // a. 更新持仓价格
      this.updatePositions(dayTs);

      // b. 处理 T+1 待执行订单
      this.processPendingOrders(dayTs, date);

      // c. 检查是否调仓日
      const scores = this.scoreAndCheckRebalance(dayTs, date);

      // d. 执行调仓
      if (scores.length > 0 && this.shouldRebalanceToday(dayTs, scores)) {
        await this.executeRebalance(dayTs, date, nextDayTs, scores);
      }

      // e. 风控检查（止损/止盈）
      this.runRiskChecks(dayTs, date, nextDayTs);

      // f. 记录权益曲线
      this.recordEquity(dayTs, date);

      // 发送每日事件
      this.eventBus.emit({ type: 'daily', timestamp: dayTs, data: { date, equity: this.account.totalAssets } });
    }

    // 4. 计算绩效指标
    return this.calculateResult();
  }

  // ── 持仓价格更新 ──────────────────────────────────────────────

  private updatePositions(dayTs: number): void {
    let totalValue = this.account.cash;

    for (const [code, pos] of this.positions) {
      const kbars = this.loader.getKBar(code);
      // 找当日或之前最近的收盘价
      let price = pos.currentPrice;
      for (const b of kbars) {
        if (b.timestamp <= dayTs) price = b.close;
        else break;
      }
      pos.currentPrice = price;
      pos.marketValue = price * pos.volume;
      pos.unrealizedPnL = (price - pos.avgCost) * pos.volume;
      totalValue += pos.marketValue;
    }

    this.account.totalAssets = totalValue;
    this.account.totalPnL = this.account.totalAssets - this.config.initialCash;
    this.account.positions = this.positionsToArray();

    // 更新 peak equity
    if (totalValue > this.peakEquity) this.peakEquity = totalValue;
  }

  // ── T+1 订单处理 ──────────────────────────────────────────────

  private processPendingOrders(dayTs: number, date: string): void {
    // 处理待执行买入
    for (const [code, order] of this.pendingBuys) {
      if (order.execDate === date) {
        this.executeBuy(code, order.volume, order.price, date);
        this.pendingBuys.delete(code);
      }
    }

    // 处理待执行卖出
    for (const [code, order] of this.pendingSells) {
      if (order.execDate === date) {
        this.executeSell(code, order.volume, order.price, date);
        this.pendingSells.delete(code);
      }
    }
  }

  private shouldRebalanceToday(dayTs: number, scores: StockScore[]): boolean {
    if (this.scheduler.shouldRebalance(dayTs)) return true;

    // 阈值触发逻辑
    if (this.config.rebalanceMode.type === 'threshold') {
      const threshold = (this.config.rebalanceMode as any).scoreChangePct ?? 0.1;
      // 检查持仓股评分变化
      for (const pos of this.positions.values()) {
        const prevScore = this.prevScores.get(pos.code);
        const currScore = scores.find(s => s.code === pos.code);
        if (prevScore && currScore) {
          const change = Math.abs(currScore.scoreChange ?? 0);
          if (change / (prevScore.compositeScore || 1) > threshold) {
            return true;
          }
        }
      }
    }

    return false;
  }

  // ── 截面评分 + 调仓判断 ────────────────────────────────────────

  private scoreAndCheckRebalance(dayTs: number, date: string): StockScore[] {
    const scores = this.scorer.score(this.loader, dayTs, this.prevScores);

    // 保存本期评分供下期对比
    for (const s of scores) {
      this.prevScores.set(s.code, s);
    }

    this.eventBus.emit({ type: 'bar', timestamp: dayTs, data: { date, scores } });
    return scores;
  }

  // ── 执行调仓 ──────────────────────────────────────────────────

  private async executeRebalance(
    dayTs: number,
    date: string,
    nextDayTs: number,
    scores: StockScore[]
  ): Promise<void> {
    // 构建目标组合
    const target = this.constructor_.build(scores);
    target.date = date;

    // 计算当前持仓权重
    const totalValue = this.account.totalAssets;
    const currentWeights = new Map<string, number>();
    for (const [code, pos] of this.positions) {
      currentWeights.set(code, pos.marketValue / totalValue);
    }

    // 目标权重
    const targetWeights = new Map<string, number>();
    for (const h of target.holdings) {
      targetWeights.set(h.code, h.weight);
    }

    const trades: RebalanceRecord['trades'] = [];
    const nextDate = this.tradingDays.find(d => d.timestamp >= nextDayTs)?.date
      ?? new Date(nextDayTs).toISOString().slice(0, 10);

    // 1. 先处理卖出（持仓在目标组合中但权重下降或被剔除）
    for (const [code, pos] of this.positions) {
      const targetW = targetWeights.get(code) ?? 0;
      const currentW = currentWeights.get(code) ?? 0;
      const diff = currentW - targetW;

      if (diff > 0.01) { // 权重下降超过1%
        const sellValue = totalValue * diff;
        // 以下个交易日开盘价执行（look-ahead bias 防护）
        const nextBar = this.getNextBar(code, nextDayTs);
        const execPrice = nextBar?.open ?? pos.currentPrice;
        const slippagePrice = execPrice * (1 - this.config.slippage);
        const volume = Math.floor(sellValue / slippagePrice / 100) * 100; // 取整百股

        if (volume > 0) {
          // 记录待执行卖出（T+1）
          this.pendingSells.set(code, {
            volume,
            price: slippagePrice,
            execDate: nextDate,
          });
          this.eventBus.emit({
            type: 'order',
            timestamp: dayTs,
            data: { code, direction: 'sell', volume, price: slippagePrice, date: nextDate },
          });
        }
      }
    }

    // 2. 再处理买入（目标组合中新增或权重上升）
    // 卖出冻结资金（简化处理：实际成交后更新）
    for (const h of target.holdings) {
      const targetW = h.weight;
      const currentW = currentWeights.get(h.code) ?? 0;
      const diff = targetW - currentW;

      if (diff > 0.01) { // 权重上升超过1%
        const buyValue = totalValue * diff;
        const pos = this.positions.get(h.code);
        const execPrice = pos
          ? pos.currentPrice * (1 + this.config.slippage)
          : this.getNextBar(h.code, nextDayTs)?.open
          ?? this.loader.getKBar(h.code).at(-1)?.close
          ?? 10;
        const cost = buyValue; // 含佣金和滑点（估算）
        const volume = Math.floor(buyValue / execPrice / 100) * 100;

        if (volume > 0) {
          // 记录待执行买入（T+1）
          this.pendingBuys.set(h.code, {
            volume,
            price: execPrice,
            weight: targetW,
            scoreDate: date,
            execDate: nextDate,
          });
          this.eventBus.emit({
            type: 'order',
            timestamp: dayTs,
            data: { code: h.code, direction: 'buy', volume, price: execPrice, date: nextDate },
          });
        }
      }
    }

    // 记录调仓日志
    this.rebalanceLog.push({
      date,
      scoreDate: date,
      target,
      trades,
      portfolioFactorExposure: {},
    });

    this.lastRebalanceTs = dayTs;
    this.scheduler.recordRebalance(dayTs);

    console.log(`[FactorPortfolio] 调仓 ${date}: 目标 ${target.holdings.length} 只`);
  }

  private getNextBar(code: string, afterTs: number): KBar | null {
    const kbars = this.loader.getKBar(code);
    for (const b of kbars) {
      if (b.timestamp > afterTs) return b;
    }
    return null;
  }

  private getBarOnOrBefore(code: string, ts: number): KBar | null {
    const kbars = this.loader.getKBar(code);
    let closest: KBar | null = null;
    for (const b of kbars) {
      if (b.timestamp <= ts) closest = b;
      else break;
    }
    return closest;
  }

  // ── 实际买卖执行 ──────────────────────────────────────────────

  private executeBuy(code: string, volume: number, price: number, date: string): void {
    const cost = volume * price;
    const commission = cost * this.config.commission;
    const totalCost = cost + commission;

    if (this.account.cash < totalCost) {
      // 资金不足，缩减买入量
      const affordableVol = Math.floor((this.account.cash * 0.95) / price / 100) * 100;
      if (affordableVol < 100) return;
      this.executeBuy(code, affordableVol, price, date);
      return;
    }

    this.account.cash -= totalCost;
    this.totalCommission += commission;

    const existing = this.positions.get(code);
    if (existing) {
      const totalVol = existing.volume + volume;
      existing.avgCost = (existing.avgCost * existing.volume + price * volume) / totalVol;
      existing.volume = totalVol;
      existing.buyTimestamp = Date.now();
      existing.buyPrice = price;
    } else {
      this.positions.set(code, {
        code,
        volume,
        avgCost: price,
        currentPrice: price,
        marketValue: price * volume,
        unrealizedPnL: 0,
        realizedPnL: 0,
        buyTimestamp: Date.now(),
        buyPrice: price,
        weight: 0,
      });
    }

    this.eventBus.emit({
      type: 'trade',
      timestamp: new Date(date).getTime(),
      data: { code, direction: 'buy', volume, price, commission, date },
    });
  }

  private executeSell(code: string, volume: number, price: number, date: string): void {
    const pos = this.positions.get(code);
    if (!pos) return;

    const sellVolume = Math.min(volume, pos.volume);
    const revenue = sellVolume * price;
    const commission = revenue * this.config.commission;
    const netRevenue = revenue - commission;
    const pnl = (price - pos.avgCost) * sellVolume - commission;

    this.account.cash += netRevenue;
    this.totalCommission += commission;
    this.cumulativePnL += pnl;

    const tradeDetail: TradeDetail = {
      timestamp: new Date(date).getTime(),
      code,
      direction: 'long',
      price,
      volume: sellVolume,
      commission,
      pnl,
      date,
      turnoverRate: sellVolume / (pos.volume + sellVolume),
      profitOrLoss: pnl,
      cumulativePnL: this.cumulativePnL,
      holdingDays: Math.round((Date.now() - pos.buyTimestamp) / 86400000),
      profitOrLossPct: pnl / (pos.avgCost * sellVolume),
      relativeReturn: 0,
    };
    this.tradeDetails.push(tradeDetail);
    this.holdingPeriods.push(tradeDetail.holdingDays);

    // 更新持仓
    pos.volume -= sellVolume;
    pos.marketValue = pos.volume * price;
    if (pos.volume === 0) {
      pos.realizedPnL += pnl;
      this.positions.delete(code);
    }

    this.eventBus.emit({
      type: 'trade',
      timestamp: new Date(date).getTime(),
      data: { code, direction: 'sell', volume: sellVolume, price, commission, pnl, date },
    });
  }

  // ── 风控 ──────────────────────────────────────────────────────

  private runRiskChecks(dayTs: number, date: string, nextDayTs: number): void {
    const totalValue = this.account.totalAssets;

    for (const [code, pos] of this.positions) {
      const pnlPct = (pos.currentPrice - pos.avgCost) / pos.avgCost;

      // 止损
      if (pnlPct <= -this.config.stopLossPct) {
        console.log(`[FactorPortfolio] 止损 ${code}: ${(pnlPct * 100).toFixed(1)}%`);
        const nextBar = this.getNextBar(code, nextDayTs);
        const execPrice = (nextBar?.open ?? pos.currentPrice) * (1 - this.config.slippage);
        const nextDate = this.tradingDays.find(d => d.timestamp >= nextDayTs)?.date ?? date;
        this.pendingSells.set(code, { volume: pos.volume, price: execPrice, execDate: nextDate });
        this.eventBus.emit({ type: 'risk', timestamp: dayTs, data: { code, rule: 'stop_loss', pnlPct } });
      }

      // 止盈
      if (pnlPct >= this.config.takeProfitPct) {
        console.log(`[FactorPortfolio] 止盈 ${code}: ${(pnlPct * 100).toFixed(1)}%`);
        const nextBar = this.getNextBar(code, nextDayTs);
        const execPrice = (nextBar?.open ?? pos.currentPrice) * (1 - this.config.slippage);
        const nextDate = this.tradingDays.find(d => d.timestamp >= nextDayTs)?.date ?? date;
        this.pendingSells.set(code, { volume: pos.volume, price: execPrice, execDate: nextDate });
        this.eventBus.emit({ type: 'risk', timestamp: dayTs, data: { code, rule: 'take_profit', pnlPct } });
      }
    }
  }

  // ── 权益曲线记录 ──────────────────────────────────────────────

  private recordEquity(dayTs: number, date: string): void {
    const equity = this.account.totalAssets;
    const benchmark = this.config.benchmarkCode
      ? this.loader.getBenchmarkPrice(dayTs) ?? undefined
      : undefined;

    this.equityCurve.push({ date, equity, benchmark });

    // 回撤
    const drawdown = (equity - this.peakEquity) / this.peakEquity;
    this.drawdownCurve.push({
      timestamp: dayTs,
      equity,
      peak: this.peakEquity,
      drawdown,
      drawdownAmount: this.peakEquity - equity,
    });

    // 日收益率
    if (this.equityCurve.length > 1) {
      const prevEquity = this.equityCurve[this.equityCurve.length - 2].equity;
      this.dailyReturns.push((equity - prevEquity) / prevEquity);
    }
  }

  // ── 绩效计算 ──────────────────────────────────────────────────

  private calculateResult(): PortfolioBacktestResult {
    const n = this.equityCurve.length;
    const totalReturn = (this.account.totalAssets - this.config.initialCash) / this.config.initialCash;

    // 年化
    const years = n / 252;
    const annualReturn = Math.pow(1 + totalReturn, 1 / years) - 1;

    // 最大回撤
    let maxDrawdown = 0;
    for (const dp of this.drawdownCurve) {
      if (dp.drawdown < maxDrawdown) maxDrawdown = dp.drawdown;
    }

    // 夏普
    const dailyRf = 0.03 / 252;
    const excessReturns = this.dailyReturns.map(r => r - dailyRf);
    const avgExcess = excessReturns.reduce((a, b) => a + b, 0) / (excessReturns.length || 1);
    const stdExcess = Math.sqrt(
      excessReturns.reduce((s, r) => s + (r - avgExcess) ** 2, 0) / (excessReturns.length - 1 || 1)
    );
    const sharpeRatio = stdExcess > 0 ? avgExcess / stdExcess * Math.sqrt(252) : 0;

    // Sortino
    const negativeReturns = this.dailyReturns.filter(r => r < 0);
    const stdNeg = Math.sqrt(
      negativeReturns.reduce((s, r) => s + r * r, 0) / (negativeReturns.length || 1)
    );
    const sortinoRatio = stdNeg > 0 ? avgExcess / stdNeg * Math.sqrt(252) : 0;

    // Calmar
    const calmarRatio = maxDrawdown !== 0 ? annualReturn / Math.abs(maxDrawdown) : 0;

    // Beta/Alpha（相对基准）
    let alpha = 0, beta = 1;
    if (this.config.benchmarkCode) {
      const benchReturns: number[] = [];
      for (let i = 1; i < this.equityCurve.length; i++) {
        const prev = this.equityCurve[i - 1].benchmark;
        const curr = this.equityCurve[i].benchmark;
        if (prev && curr) benchReturns.push((curr - prev) / prev);
      }
      if (benchReturns.length > 10) {
        // 简化：假设 beta=1，直接计算 alpha
        const avgBench = benchReturns.reduce((a, b) => a + b, 0) / benchReturns.length;
        const avgRet = this.dailyReturns.reduce((a, b) => a + b, 0) / (this.dailyReturns.length || 1);
        beta = 1; // 简化处理
        alpha = avgRet - beta * avgBench;
      }
    }

    // 年化波动率
    const annualVolatility = stdExcess * Math.sqrt(252);

    // 交易统计
    const wins = this.tradeDetails.filter(t => t.pnl > 0);
    const losses = this.tradeDetails.filter(t => t.pnl <= 0);
    const winRate = this.tradeDetails.length > 0 ? wins.length / this.tradeDetails.length : 0;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 1;
    const profitLossRatio = avgLoss > 0 ? avgWin / avgLoss : 0;

    // 月度收益
    const monthlyReturns = this.computeMonthlyReturns();

    // 组合特有指标
    const avgHoldingPeriod = this.holdingPeriods.length > 0
      ? this.holdingPeriods.reduce((a, b) => a + b, 0) / this.holdingPeriods.length
      : 0;

    // 平均换手率（从 rebalanceLog 估算）
    const turnover = this.rebalanceLog.length > 0
      ? 0.1 // 简化：每次调仓假设换手10%
      : 0;

    return {
      totalReturn,
      annualReturn,
      maxDrawdown,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      winRate,
      alpha,
      beta,
      annualVolatility,
      turnover,
      avgHoldingPeriod,
      rebalanceCount: this.rebalanceLog.length,
      totalCommission: this.totalCommission,
      equityCurveWithDate: this.equityCurve,
      drawdownCurve: this.drawdownCurve,
      monthlyReturns,
      rebalanceLog: this.rebalanceLog,
    };
  }

  private computeMonthlyReturns(): MonthlyReturn[] {
    const monthlyMap = new Map<string, { ret: number; trades: number; days: number }>();

    for (let i = 1; i < this.equityCurve.length; i++) {
      const prev = this.equityCurve[i - 1];
      const curr = this.equityCurve[i];
      const d = new Date(curr.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      const ret = (curr.equity - prev.equity) / prev.equity;
      const entry = monthlyMap.get(key) ?? { ret: 0, trades: 0, days: 0 };
      entry.ret = (1 + entry.ret) * (1 + ret) - 1;
      entry.days++;
      monthlyMap.set(key, entry);
    }

    let cumulative = 0;
    const result: MonthlyReturn[] = [];
    const sorted = Array.from(monthlyMap.entries()).sort();

    for (const [key, v] of sorted) {
      const [year, month] = key.split('-').map(Number);
      cumulative = (1 + cumulative) * (1 + v.ret) - 1;
      result.push({ year, month, return: v.ret, cumulativeReturn: cumulative, trades: v.trades, tradingDays: v.days });
    }

    return result;
  }

  private positionsToArray(): Position[] {
    return Array.from(this.positions.values()).map(p => ({
      code: p.code,
      volume: p.volume,
      avgCost: p.avgCost,
      currentPrice: p.currentPrice,
      marketValue: p.marketValue,
      unrealizedPnL: p.unrealizedPnL,
      realizedPnL: p.realizedPnL,
    }));
  }
}
