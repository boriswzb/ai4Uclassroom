/**
 * 模拟交易引擎 v2
 * 实时模拟交易，支持：
 *   - 自动驾驶：量化策略自动生成信号并执行买卖
 *   - 历史K线预加载（策略需要足够历史数据才能计算指标）
 *   - 修正A股交易时段（9:30-11:30 / 13:00-15:00）
 *   - T+1 模拟（当日买入不能卖出）
 */

import { KBar, Order, OrderStatus, Account, Position, Direction, Signal } from '../types';
import { Strategy, MACDStrategy, KDJStrategy, MAStrategy, BollingerStrategy, RSIStrategy } from '../strategies/strategy-engine';
import { StrategyEnsemble, EnsembleMode, createVotingEnsemble, createFilterEnsemble, createWeightedEnsemble, createDynamicEnsemble } from '../strategies/strategy-ensemble';
import { RiskEngine, PositionManager } from '../risk/risk-engine';
import { AdvancedPositionManager, StopConfig } from '../risk/position-manager';
import { PositionSizer, PositionSizingConfig } from '../risk/position-sizer';
import { MarketRegimeClassifier, MarketBreadthData } from '../market/market-regime';
import { dataSourceManager } from '../data/data-source';

// ==================== 策略工厂 ====================

function makeSingleStrategy(type: string): Strategy {
  // Phase 2 新策略
  if (type === 'williams') {
    const { WilliamsRStrategy } = require('../strategies/new-strategies');
    return new WilliamsRStrategy();
  }
  if (type === 'bias') {
    const { BiasStrategy } = require('../strategies/new-strategies');
    return new BiasStrategy();
  }
  if (type === 'mfi') {
    const { MFIStrategy } = require('../strategies/new-strategies');
    return new MFIStrategy();
  }
  if (type === 'stochastic') {
    const { StochasticStrategy } = require('../strategies/new-strategies');
    return new StochasticStrategy();
  }
  if (type === 'volume') {
    const { VolumeBreakoutStrategy } = require('../strategies/new-strategies');
    return new VolumeBreakoutStrategy();
  }
  if (type === 'composite') {
    const { CompositeStrategy } = require('../strategies/new-strategies');
    return new CompositeStrategy();
  }
  // 基础策略
  switch (type) {
    case 'kdj':       return new KDJStrategy();
    case 'ma':        return new MAStrategy();
    case 'bollinger': return new BollingerStrategy();
    case 'rsi':       return new RSIStrategy();
    default:          return new MACDStrategy();
  }
}

function makePresetEnsemble(type: EnsembleMode): StrategyEnsemble {
  switch (type) {
    case 'voting':   return createVotingEnsemble();
    case 'filter':   return createFilterEnsemble();
    case 'weighted': return createWeightedEnsemble();
    case 'dynamic':  return createDynamicEnsemble();
    default:          return createVotingEnsemble();
  }
}

// ==================== 订单簿 ====================

export interface OrderBookEntry {
  order: Order;
  resolve: (order: Order) => void;
  reject: (error: Error) => void;
}

// ==================== 持仓记录（用于T+1判断）====================

interface BuyRecord {
  code: string;
  date: string; // YYYYMMDD
  volume: number;
}

// ==================== 模拟交易引擎 ====================

export class LiveSimulator {
  private strategies: Map<string, Strategy> = new Map();
  private ensembles: Map<string, StrategyEnsemble> = new Map();
  private riskEngine: RiskEngine;
  private positionManager: PositionManager;
  private account: Account;
  private orders: Map<string, Order> = new Map();
  private orderBook: OrderBookEntry[] = [];
  private isRunning: boolean = false;
  private isAutoPilot: boolean = false;
  private tradingCodes: string[] = [];
  private updateInterval: NodeJS.Timeout | null = null;
  private onTradeCallback: ((trade: any) => void) | null = null;
  private onSignalCallback: ((signal: Signal) => void) | null = null;
  private onAccountCallback: ((account: Account) => void) | null = null;
  private onLogCallback: ((log: { time: number; type: string; msg: string }) => void) | null = null;
  // Bug2 fix: 持仓变更回调，外部（如API route）注册后可用于持久化 buyDate 到 db.positions
  private onPositionUpdateCallback: ((data: { accountId: string; code: string; name?: string; volume: number; avgCost: number; currentPrice: number; marketValue: number; unrealizedPnL: number; realizedPnL: number; buyDate: string }) => void) | null = null;
  // T+1 持仓记录
  private buyRecords: BuyRecord[] = [];
  // Bug2 fix: 关联的账户ID（restore 时注入，用于成交时持久化 buyDate）
  private accountId: string | null = null;

  // Phase 1: 历史K线缓存（用于高级止损和市场状态分析）
  private kbarsCache: Map<string, KBar[]> = new Map();
  // P1-1 修复：实时报价缓存（用于 fillOrder/processOrderBook/止损检查，不再用 random）
  private realtimeCache: Map<string, { price: number; timestamp: number }> = new Map();

  // ==================== Phase 1 新增：高级风控 ====================
  /** 高级止损止盈管理器（ATR动态止损 + 移动止盈 + 时间止损） */
  private advancedStopManager: AdvancedPositionManager;
  /** 动态仓位管理器（ATR + Kelly） */
  private positionSizer: PositionSizer;
  /** 市场状态分类器 */
  private marketClassifier: MarketRegimeClassifier;
  /** 当前市场状态（用于仓位调整） */
  private currentRegime: import('../market/market-regime').MarketRegime = 'uncertain';
  /** 高级止损止盈配置 */
  private stopConfig: StopConfig;

  constructor(initialCash: number = 1000000) {
    this.riskEngine = new RiskEngine(initialCash);
    this.positionManager = new PositionManager();
    this.account = {
      cash: initialCash,
      frozen: 0,
      totalAssets: initialCash,
      totalPnL: 0,
      positions: []
    };

    // 初始化高级风控模块
    this.stopConfig = {
      fixedStopLoss: 0.07,     // 7%固定止损
      fixedStopProfit: 0.15,   // 15%固定止盈
      useATRStop: true,         // 启用ATR动态止损
      atrStopMultiplier: 2.0,   // 2倍ATR
      useTrailingStop: true,    // 启用移动止盈
      trailing启动比例: 0.10,   // 盈利10%后激活
      trailing撤回比例: 0.30,   // 从峰值回落30%触发
      useTimeStop: false,      // 暂不启用时间止损
      timeStopBars: 20,
    };
    this.advancedStopManager = new AdvancedPositionManager(this.stopConfig);
    this.positionSizer = new PositionSizer({
      accountBalance: initialCash,
      riskPerTrade: 0.02,       // 单笔最大风险2%
      maxPositionRatio: 0.30,  // 最大30%仓位
      useKelly: false,          // 保守起见默认关闭Kelly
      useVolatilityAdjust: true, // 波动率调整
    });
    this.marketClassifier = new MarketRegimeClassifier();
  }

  // ==================== 策略管理 ====================

  addStrategy(code: string, strategy: Strategy): void {
    this.strategies.set(code, strategy);
    if (!this.tradingCodes.includes(code)) {
      this.tradingCodes.push(code);
    }
    this.log('info', `策略 [${strategy.name}] 已绑定 ${code}`);
  }

  removeStrategy(code: string): void {
    this.strategies.delete(code);
    this.ensembles.delete(code);
    this.tradingCodes = this.tradingCodes.filter(c => c !== code);
  }

  getStrategy(code: string): Strategy | undefined {
    return this.strategies.get(code);
  }

  addEnsemble(code: string, ensemble: StrategyEnsemble): void {
    this.ensembles.set(code, ensemble);
    if (!this.tradingCodes.includes(code)) {
      this.tradingCodes.push(code);
    }
    this.log('info', `策略组合 [${ensemble.name}] 已绑定 ${code}`);
  }

  // ==================== 交易控制 ====================

  /** 启动模拟交易 */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.log('warn', '引擎已在运行中');
      return;
    }

    this.log('info', '=== 启动模拟交易引擎 ===');
    this.isRunning = true;

    // P0 配套修复：start() 启动时如果 tradingCodes 已有股票但 strategies/ensembles 都空，
    // 自动用 MACD 默认策略注册（覆盖"先调 autopilot=true 再调 start"的场景）
    if (this.tradingCodes.length > 0 && this.strategies.size === 0 && this.ensembles.size === 0) {
      this.log('warn', `⚠️ 检测到交易池 ${this.tradingCodes.length} 只股票但未注册策略，自动用默认 MACD 策略回退注册`);
      for (const code of this.tradingCodes) {
        this.addStrategy(code, new MACDStrategy());
      }
    }

    // 设置数据源
    try {
      await dataSourceManager.setActiveSource('akshare');
      this.log('info', '数据源：东方财富（akshare）');
    } catch (e) {
      this.log('warn', '数据源初始化失败，使用模拟数据');
    }

    // 预加载历史K线（每个策略需要至少60天数据计算指标）
    await this.preloadHistory();

    // 启动更新循环：交易时段内每30秒更新一次
    this.updateInterval = setInterval(() => {
      this.update();
    }, 30000);

    this.updateAccount();
    this.notifyAccount();
  }

  /** 停止模拟交易 */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.log('info', '=== 停止模拟交易引擎 ===');
    this.isRunning = false;
    this.isAutoPilot = false;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    try {
      await dataSourceManager.disconnect();
    } catch (e) { /* ignore */ }
  }

  isActive(): boolean {
    return this.isRunning;
  }

  isAutoPilotActive(): boolean {
    return this.isAutoPilot;
  }

  /** P1-B：返回已注册策略数量，前端用来判断是否显示"策略未注册"警告 */
  getStrategiesCount(): { strategies: number; ensembles: number } {
    return { strategies: this.strategies.size, ensembles: this.ensembles.size };
  }

  getTradingCodes(): string[] {
    return [...this.tradingCodes];
  }

  /**
   * 开启/关闭自动驾驶
   * P0-A 修复：开启时如果 strategies/ensembles 都没注册，自动用 MACD 默认策略给所有 tradingCodes 注册
   * 根因：之前用户可能直接调 autopilot=true 跳过 start/startEnsemble，导致 isAutoPilot=true 但策略 Map 空，
   *       update 循环中 ensemble/strategy 都拿不到，信号永远 = null，自动驾驶形同虚设。
   */
  setAutoPilot(enabled: boolean): void {
    this.isAutoPilot = enabled;
    this.log('info', `自动驾驶已${enabled ? '开启' : '关闭'}`);

    if (enabled && this.strategies.size === 0 && this.ensembles.size === 0) {
      if (this.tradingCodes.length === 0) {
        this.log('warn', '⚠️ 开启自动驾驶失败：交易池为空（tradingCodes=0），请先添加股票');
        return;
      }
      this.log('warn', `⚠️ 检测到策略未注册，自动用默认 MACD 策略为 ${this.tradingCodes.length} 只股票注册`);
      for (const code of this.tradingCodes) {
        this.addStrategy(code, new MACDStrategy());
      }
      // 异步预加载历史（不阻塞当前调用）
      this.reloadAllHistory().catch(e =>
        this.log('warn', `自动回退注册后预加载历史失败: ${e}`)
      );
    }
  }

  // ==================== 历史K线预加载 ====================

  /**
   * 重新预加载所有交易代码的历史K线。
   * 用于：增量加股后让新股票也有 90 天历史；或策略状态异常时强制刷新。
   * 修复：P0-3 金股池一键推送时，新加入的股票需立即有历史数据
   */
  async reloadAllHistory(): Promise<void> {
    this.log('info', `重新预加载 ${this.tradingCodes.length} 支股票历史K线...`);
    await this.preloadHistory();
  }

  private async preloadHistory(): Promise<void> {
    this.log('info', `开始预加载 ${this.tradingCodes.length} 支股票历史K线...`);
    const end = Date.now();
    const start = end - 90 * 24 * 60 * 60 * 1000; // 90天

    for (const code of this.tradingCodes) {
      try {
        const kbars = await dataSourceManager.getKBar(code, start, end);
        kbars.sort((a, b) => a.timestamp - b.timestamp);
        const strategy = this.strategies.get(code);
        const ensemble = this.ensembles.get(code);
        if (strategy && kbars.length > 0) {
          strategy.updateBars(kbars);
          this.log('info', `  ${code}: 加载 ${kbars.length} 根K线 → ${strategy.name}`);
        }
        if (ensemble && kbars.length > 0) {
          ensemble.updateBars(kbars);
          this.log('info', `  ${code}: 加载 ${kbars.length} 根K线 → ${ensemble.name}`);
        }
        // 缓存K线用于高级止损计算和市场状态分析
        if (kbars.length > 0) {
          this.kbarsCache.set(code, kbars);
          // 同时更新市场分类器
          this.marketClassifier.updateBars(kbars);
        }
      } catch (e) {
        this.log('warn', `  ${code}: 历史K线加载失败`);
      }
    }
  }

  // ==================== 更新循环 ====================

  private async update(): Promise<void> {
    if (!this.isRunning) return;

    // 修正A股交易时段判断（用北京时间，避免服务器在 UTC 时区导致时段判断错误）
    // A股：9:30-11:30 上午，13:00-15:00 下午（北京时间 UTC+8）
    const utcMs = Date.now() + new Date().getTimezoneOffset() * 60000;
    const beijing = new Date(utcMs + 8 * 60 * 60 * 1000);
    const hour = beijing.getHours();
    const minute = beijing.getMinutes();
    const isWeekday = beijing.getDay() >= 1 && beijing.getDay() <= 5;

    const isTradingTime =
      isWeekday && (
        (hour === 9 && minute >= 30) || // 9:30开盘
        (hour >= 10 && hour < 11) ||     // 10:00-11:00
        (hour === 11 && minute <= 30) || // 11:00-11:30 午市上午
        (hour >= 13 && hour < 15)        // 13:00-14:59 下午
      );

    if (!isTradingTime) {
      return; // 非交易时段不更新
    }

    // 用北京时间生成 YYYYMMDD（之前用 now.toISOString() 拿到的是 UTC 日期，跨时区时晚一天）
    const todayStr = `${beijing.getFullYear()}${String(beijing.getMonth() + 1).padStart(2, '0')}${String(beijing.getDate()).padStart(2, '0')}`;

    // 北京时间今天的 0 点（毫秒时间戳）
    const startOfDay = beijing.getTime() - (hour * 60 + minute) * 60 * 1000;
    const endOfDay = beijing.getTime();

    for (const code of this.tradingCodes) {
      try {
        // 获取最新K线（当日）
        const kbars = await dataSourceManager.getKBar(code, startOfDay, endOfDay);

        let latestBar: KBar;
        if (kbars.length > 0) {
          latestBar = kbars[kbars.length - 1];
        } else {
          // 如果当日没有数据，用前一日收盘模拟当日价格
          const prevKbars = await dataSourceManager.getKBar(code, endOfDay - 2 * 24 * 60 * 60 * 1000, endOfDay);
          if (prevKbars.length > 0) {
            latestBar = { ...prevKbars[prevKbars.length - 1], timestamp: beijing.getTime() };
          } else {
            continue;
          }
        }

        // P1-1 修复：拉取实时报价并写入缓存
        // 优先用实时价更新 positionManager；缓存缺失时 fallback 到 bar.close
        try {
          const quotes = await dataSourceManager.getRealtimeQuote([code]);
          if (quotes && quotes.length > 0 && quotes[0].price > 0) {
            this.realtimeCache.set(code, { price: quotes[0].price, timestamp: Date.now() });
          }
        } catch { /* realtime 拉取失败不影响主流程 */ }

        const cachedRealtime = this.realtimeCache.get(code);
        // 修复 P1-B：实时报价缓存 5 分钟内才用，否则 fallback 到 bar.close
        // 之前：缓存永不过期，导致昨天收盘的实时价覆盖今天的 K 线收盘价
        const livePrice = (cachedRealtime && Date.now() - cachedRealtime.timestamp < 5 * 60_000)
          ? cachedRealtime.price
          : latestBar.close;

        // 更新策略（包括单策略和组合策略）
        const strategy = this.strategies.get(code);
        const ensemble = this.ensembles.get(code);

        // 追加K线到缓存
        const cached = this.kbarsCache.get(code) || [];
        cached.push(latestBar);
        if (cached.length > 120) cached.shift(); // 保留最多120天
        this.kbarsCache.set(code, cached);
        // 更新市场分类器
        this.marketClassifier.updateBars(cached);

        if (this.isAutoPilot) {
          let signal: Signal | null = null;

          if (ensemble) {
            // 组合策略驱动
            ensemble.onBar(latestBar);
            const es = ensemble.getSignal();
            if (es && es.direction !== 'neutral') {
              signal = es as Signal;
              // 组合信号详细日志
              const subInfo = es.subSignals.map(s => `${s.strategyName}:${s.direction}`).join(' | ');
              this.log('signal', `[${es.mode}] ${code} → ${es.direction} (${es.reason}) | 子信号: ${subInfo}`);
            }
          } else if (strategy) {
            // 单策略驱动
            strategy.onBar(latestBar);
            signal = strategy.getSignal();
            if (signal) {
              this.log('signal', `信号 [${signal.direction}] ${code} ${signal.reason}`);
            }
          }

          if (signal && signal.direction !== 'neutral') {
            this.notifySignal(signal);
            await this.executeSignal(signal, latestBar, todayStr);
          }
        }

        // P1-1 修复：使用实时价（缓存缺失时 fallback 到 bar.close，不再用 random）
        this.positionManager.updatePrice(code, livePrice);

        // 检查风控（实时价驱动的止损止盈）
        this.checkRiskControl(code, latestBar, livePrice);

      } catch (error) {
        console.error(`[LiveSimulator] 更新 ${code} 失败:`, error);
      }
    }

    this.updateAccount();
    this.notifyAccount();
    this.processOrderBook();
  }

  // ==================== 信号执行 ====================

  private async executeSignal(signal: Signal, bar: KBar, todayStr: string): Promise<void> {
    if (!this.isAutoPilot) return;

    const code = signal.code;
    const position = this.positionManager.getPosition(code);

    // 多头信号 → 买入
    if (signal.direction === 'long') {
      if (!position || position.volume === 0) {
        // 检查是否今日已买（t+1）
        // Bug2 fix: 同时检查 buyRecords 和 positionManager 中的 buyDate，避免 buyRecords 重启后丢失导致 T+1 失效
        const todayBought = this.buyRecords.some(r => r.code === code && r.date === todayStr)
          || (this.positionManager.getBuyDate(code) === todayStr);
        if (todayBought) {
          this.log('warn', `${code} 今日已买入（T+1限制），跳过`);
          return;
        }

        // Phase 1 增强：动态仓位计算
        // 1. 先更新市场状态（用于调整仓位倍数）
        if (this.kbarsCache?.has(code)) {
          this.marketClassifier.updateBars(this.kbarsCache.get(code)!);
          const regimeResult = this.marketClassifier.analyze();
          this.currentRegime = regimeResult.regime;
        }

        // 2. 获取ATR用于计算仓位
        let atr = bar.close * 0.02; // 默认代理值
        if (this.kbarsCache?.has(code) && this.kbarsCache.get(code)!.length >= 15) {
          const cached = this.kbarsCache.get(code)!;
          atr = PositionSizer.computeATR(cached);
        }

        // 3. 用 PositionSizer 计算建议仓位
        const sizeResult = this.positionSizer.calculate(
          bar.close,
          atr,
          signal.strength,
        );

        // 根据市场状态调整仓位倍数
        const regimeMultipliers: Record<string, number> = {
          strong_uptrend: 1.2, weak_uptrend: 1.0,
          strong_downtrend: 0.8, weak_downtrend: 0.7,
          high_volatility: 0.6, low_volatility: 1.0,
          uncertain: 0.5,
        };
        const regimeMultiplier = regimeMultipliers[this.currentRegime] ?? 1.0;
        const adjustedShares = Math.floor(sizeResult.shares * regimeMultiplier / 100) * 100;

        if (adjustedShares < 100) {
          this.log('warn', `${code} 计算仓位不足1手（${adjustedShares}股），跳过`);
          return;
        }

        const volume = Math.min(adjustedShares, 1000); // 上限1000股
        const order = await this.submitOrder(code, 'long', 'market', volume);
        if (order.status === 'filled') {
          // 记录买入（t+1）
          this.buyRecords.push({ code, date: todayStr, volume });
          // 记录高级止损入场价
          this.advancedStopManager.openPosition(code, bar.close, volume, 'long', bar.timestamp, atr);
          // 更新仓位管理器余额
          this.positionSizer.updateBalance(this.account.cash);
          this.log('trade', `买入 ${code} × ${volume}股（市场状态:${this.currentRegime}，仓位调整:${regimeMultiplier.toFixed(1)}×）`);
        }
      }
    }
    // 空头信号 → 卖出
    else if (signal.direction === 'short') {
      if (position && position.volume > 0) {
        // 实际检查t+1：今日买的不能卖
        // Bug2 fix: 同时检查 buyRecords 和 positionManager 中的 buyDate
        const todayBought = this.buyRecords.some(r => r.code === code && r.date === todayStr)
          || (this.positionManager.getBuyDate(code) === todayStr);
        if (todayBought) {
          this.log('warn', `${code} 今日买入不能卖出（T+1），跳过`);
          return;
        }

        const order = await this.submitOrder(code, 'short', 'market', position.volume);
        if (order.status === 'filled' && order.filledVolume >= order.volume) {
          // Bug3 fix: 只有全部成交时才清除 T+1 记录
          this.buyRecords = this.buyRecords.filter(r => r.code !== code);
          // 清除高级止损记录
          this.advancedStopManager.closePosition(code);
        }
      }
    }
  }

  // ==================== 订单管理 ====================

  async submitOrder(
    code: string,
    direction: Direction,
    type: 'market' | 'limit',
    volume: number,
    limitPrice?: number
  ): Promise<Order> {
    const order: Order = {
      id: this.generateOrderId(),
      code,
      direction,
      type,
      price: limitPrice || 0,
      volume,
      filledVolume: 0,
      status: 'pending',
      timestamp: Date.now()
    };

    // 风控检查
    const riskResult = this.riskEngine.checkOrder(order, limitPrice || 0);
    if (!riskResult.allowed) {
      order.status = 'rejected';
      this.log('warn', `订单被风控拒绝: ${riskResult.reason}`);
      return order;
    }

    this.orders.set(order.id, order);

    if (type === 'market') {
      return this.fillOrder(order);
    } else {
      return new Promise((resolve, reject) => {
        this.orderBook.push({ order, resolve, reject });
      });
    }
  }

  private async fillOrder(order: Order): Promise<Order> {
    let currentPrice = this.getCurrentPrice(order.code);

    // P1-A+ 修复：如果缓存和 K 线都没有（如手动下单时引擎刚启动），直接拉一次实时报价
    // 根因：getCurrentPrice 终极 fallback 返回 0，导致 order.price=0，position.avgCost=0
    if (currentPrice <= 0) {
      try {
        const quotes = await dataSourceManager.getRealtimeQuote([order.code]);
        if (quotes && quotes.length > 0 && quotes[0].price > 0) {
          currentPrice = quotes[0].price;
          this.realtimeCache.set(order.code, { price: currentPrice, timestamp: Date.now() });
        }
      } catch { /* realtime 拉取失败不影响成交 */ }
    }

    order.filledVolume = order.volume;
    order.status = 'filled';
    // P1-A 修复：写回成交价到 order 对象，让 API 响应/前端能拿到真实价格
    order.price = currentPrice;
    (order as any).filledPrice = currentPrice;

    if (order.direction === 'long') {
      // Bug2 fix: 传递今日日期（YYYYMMDD）给 positionManager，用于追踪 T+1
      const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      this.positionManager.openPosition(order.code, order.volume, currentPrice, 'long', todayStr);
      const cost = order.volume * currentPrice;
      this.account.cash -= cost;
      this.log('trade', `买入 ${order.code} × ${order.volume}股 @ ¥${currentPrice.toFixed(2)}`);
    } else {
      const pnl = this.positionManager.closePosition(order.code, order.volume, currentPrice);
      this.account.totalPnL += pnl;
      const profit = pnl >= 0 ? `+¥${pnl.toFixed(2)}` : `-¥${Math.abs(pnl).toFixed(2)}`;
      this.log('trade', `卖出 ${order.code} × ${order.volume}股 @ ¥${currentPrice.toFixed(2)} → ${profit}`);
    }

    // Bug1 fix: fillOrder 调用 updateAccount() 即可自动同步到 RiskEngine（updateAccount 内部已同步）
    this.updateAccount();
    this.notifyTrade(order, currentPrice);
    return order;
  }

  private processOrderBook(): void {
    const toRemove: number[] = [];

    for (let i = 0; i < this.orderBook.length; i++) {
      const entry = this.orderBook[i];
      // P1-1 修复：getCurrentPrice 优先取实时报价（不再 random）
      const currentPrice = this.getCurrentPrice(entry.order.code);

      let triggered = false;
      if (entry.order.direction === 'long' && currentPrice <= entry.order.price) {
        triggered = true;
      } else if (entry.order.direction === 'short' && currentPrice >= entry.order.price) {
        triggered = true;
      }

      if (triggered) {
        entry.order.price = currentPrice;
        (entry.order as any).filledPrice = currentPrice;
        // Bug4 fix: 限价单触发后先走风控检查（因为成交后账户状态已变，可能影响其他规则）
        const riskResult = this.riskEngine.checkOrder(entry.order, currentPrice);
        if (!riskResult.allowed) {
          entry.order.status = 'rejected';
          entry.reject(new Error(`Risk check failed after trigger: ${riskResult.reason}`));
          this.log('warn', `限价单触发后被风控拦截: ${entry.order.code} ${riskResult.reason}`);
        } else {
          this.fillOrder(entry.order).then(entry.resolve);
        }
        toRemove.push(i);
      }
    }

    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.orderBook.splice(toRemove[i], 1);
    }
  }

  cancelOrder(orderId: string): boolean {
    const index = this.orderBook.findIndex(e => e.order.id === orderId);
    if (index >= 0) {
      const entry = this.orderBook[index];
      entry.order.status = 'cancelled';
      entry.reject(new Error('Order cancelled'));
      this.orderBook.splice(index, 1);
      return true;
    }
    return false;
  }

  // ==================== 风控 ====================

  private checkRiskControl(code: string, bar: KBar, livePrice?: number): void {
    // P1-1 修复：优先用实时价做风控检查（bar.close 是分钟级 K 线收盘，存在滞后）
    const priceForRisk = livePrice ?? bar.close;
    const position = this.positionManager.getPosition(code);
    if (!position) return;

    const result = this.riskEngine.checkPosition(position);
    if (result.triggered) {
      this.log('warn', `触发风控 ${code}，强制平仓`);
      this.submitOrder(code, 'short', 'market', position.volume);
    }

    const dailyResult = this.riskEngine.checkDailyLoss();
    if (dailyResult.triggered) {
      this.log('error', '触发日亏损限制，停止交易');
      this.stop();
    }

    // Phase 1 增强：高级止损检查（ATR动态止损 + 移动止盈）
    const cached = this.kbarsCache.get(code);
    if (cached && cached.length >= 15) {
      // P1-1 修复：用实时价驱动高级止损（bar.close 是分钟级 K 线收盘，存在滞后）
      const stopResult = this.advancedStopManager.checkStop(code, priceForRisk, bar.timestamp, cached);
      if (stopResult.shouldStop) {
        const pnl = position.volume > 0
          ? (priceForRisk - position.avgCost) * position.volume
          : 0;
        this.log('warn', `高级止损触发 ${code}: ${stopResult.reason} → 强制平仓（浮盈${pnl.toFixed(0)}元）`);
        this.submitOrder(code, 'short', 'market', position.volume);
        this.advancedStopManager.closePosition(code);
      }
    }
  }

  // ==================== 账户 ====================

  public updateAccount(): void {
    const positions = this.positionManager.getAllPositions();
    let totalPositionValue = 0;

    for (const pos of positions) {
      totalPositionValue += pos.marketValue;
    }

    this.account.totalAssets = this.account.cash + totalPositionValue;
    // Bug1 fix part 2: this.account.positions 是 positionManager 的引用，始终是最新的
    this.account.positions = positions;
    // Bug5 fix: 同步到 RiskEngine，使风控规则（止损/止盈/日亏损/仓位限制）使用真实数据
    this.riskEngine.updateAccount(this.account);
  }

  getAccount(): Account {
    return { ...this.account };
  }

  getOrders(): Order[] {
    return Array.from(this.orders.values());
  }

  // ==================== 事件回调 ====================

  onTrade(callback: (trade: any) => void): void {
    this.onTradeCallback = callback;
  }

  onSignal(callback: (signal: Signal) => void): void {
    this.onSignalCallback = callback;
  }

  onAccountUpdate(callback: (account: Account) => void): void {
    this.onAccountCallback = callback;
  }

  onLog(callback: (log: { time: number; type: string; msg: string }) => void): void {
    this.onLogCallback = callback;
  }

  /** Bug2 fix: 注册持仓变更回调，外部可借此持久化 buyDate 到 db.positions */
  onPositionUpdate(callback: (data: { accountId: string; code: string; name?: string; volume: number; avgCost: number; currentPrice: number; marketValue: number; unrealizedPnL: number; realizedPnL: number; buyDate: string }) => void): void {
    this.onPositionUpdateCallback = callback;
  }

  private notifyTrade(order: Order, price: number): void {
    if (this.onTradeCallback) {
      this.onTradeCallback({ order, price, timestamp: Date.now() });
    }
  }

  private notifySignal(signal: Signal): void {
    if (this.onSignalCallback) {
      this.onSignalCallback(signal);
    }
  }

  private notifyAccount(): void {
    if (this.onAccountCallback) {
      this.onAccountCallback(this.getAccount());
    }
  }

  private log(type: string, msg: string): void {
    const entry = { time: Date.now(), type, msg };
    if (this.onLogCallback) {
      this.onLogCallback(entry);
    }
  }

  // ==================== 工具方法 ====================

  private generateOrderId(): string {
    return `ORD_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  private getCurrentPrice(code: string): number {
    // P1-1 修复：优先从实时报价缓存取真实成交价
    const cached = this.realtimeCache.get(code);
    if (cached && Date.now() - cached.timestamp < 5 * 60_000) {
      return cached.price;
    }
    // 其次用持仓 currentPrice（每次 update() 已用实时价更新）
    const position = this.positionManager.getPosition(code);
    if (position && position.currentPrice > 0) {
      return position.currentPrice;
    }
    // 都没有：fallback 到 K 线最后收盘（引擎每 30s 会拉取，正常不会走到这里）
    const bars = this.kbarsCache.get(code);
    if (bars && bars.length > 0) {
      return bars[bars.length - 1].close;
    }
    // 终极 fallback：返回 0（让上层报错，比 random 更安全）
    return 0;
  }

  // ==================== 重置 ====================

  reset(initialCash?: number): void {
    this.stop();
    this.strategies.clear();
    this.ensembles.clear();
    this.orders.clear();
    this.orderBook = [];
    this.positionManager.clear();
    this.buyRecords = [];
    this.accountId = null;
    this.kbarsCache.clear();
    this.currentRegime = 'uncertain';
    this.advancedStopManager.clearAll();

    const cash = initialCash || 1000000;
    this.account = {
      cash,
      frozen: 0,
      totalAssets: cash,
      totalPnL: 0,
      positions: []
    };

    this.riskEngine = new RiskEngine(cash);
    this.riskEngine.resetDaily();
    this.positionSizer.updateBalance(cash);
  }

  /** Bug2 fix: 注入 accountId（restore 时调用），使成交时能将 buyDate 写入 db.positions */
  setAccountId(accountId: string): void {
    this.accountId = accountId;
  }

  /**
   * 从持久化数据重建引擎运行状态（页面刷新后调用）
   * @param codes 交易的股票代码列表
   * @param strategyType 单策略类型: macd|kdj|ma|bollinger|rsi
   * @param ensembleType 组合策略类型: voting|filter|weighted|dynamic
   * @param autoPilot 是否开启自动驾驶
   */
  async ensureRunning(params: {
    codes: string[];
    strategyType?: string;
    ensembleType?: string;
    autoPilot: boolean;
  }): Promise<void> {
    const { codes, strategyType, ensembleType, autoPilot } = params;

    // 如果引擎已经初始化（有策略），跳过
    if (this.strategies.size > 0 || this.ensembles.size > 0) {
      this.log('info', '引擎已初始化，跳过 ensureRunning');
      return;
    }

    // 恢复自动驾驶状态（必须先于 addStrategy 调用）
    this.isAutoPilot = autoPilot;

    // 添加策略
    // P0 配套修复：持久化数据中 strategyType/ensembleType 可能都是 undefined（之前手动下单没经过 start），
    // 这种情况自动用 MACD 默认策略回退注册，避免刷新后 isAutoPilot=true 但策略 Map 空
    if (codes.length > 0 && !strategyType && !ensembleType) {
      this.log('warn', `⚠️ ensureRunning: 持久化数据无 strategyType/ensembleType，自动用 MACD 默认策略回退注册 ${codes.length} 只股票`);
      for (const code of codes) {
        this.addStrategy(code, new MACDStrategy());
      }
    } else {
      for (const code of codes) {
        if (strategyType) {
          const strategy = makeSingleStrategy(strategyType);
          this.addStrategy(code, strategy);
        } else if (ensembleType) {
          const ensemble = makePresetEnsemble(ensembleType as EnsembleMode);
          this.addEnsemble(code, ensemble);
        }
      }
    }

    // 设置数据源
    try {
      await dataSourceManager.setActiveSource('akshare');
    } catch (e) { /* ignore */ }

    // 预加载历史K线
    await this.preloadHistory();

    // 启动更新循环
    this.isRunning = true;
    if (this.updateInterval) clearInterval(this.updateInterval);
    this.updateInterval = setInterval(() => {
      this.update();
    }, 30000);

    // 初始化账户
    this.updateAccount();
    this.notifyAccount();

    const modeStr = strategyType ? `单策略[${strategyType}]` : `组合[${ensembleType}]`;
    this.log('info', `✅ 引擎已重建: ${modeStr} × ${codes.length}支 ${autoPilot ? '（自动驾驶）' : ''}`);
    // P1-3：刷新恢复后，realtimeCache 是空的（正常），首次 update() 会在 30s 内填上
    // 用户感知：刷新后可能 0-30s 内限价单按 bar.close 触发，30s 后完全用实时价
  }

  /** Bug2 fix: 获取持仓的买入日期 */
  getBuyDate(code: string): string | undefined {
    return this.positionManager.getBuyDate(code);
  }

  /** Bug2 fix: 获取所有持仓（含 buyDate），供外部持久化到 db.positions */
  getPositionsForPersist(): Array<{
    code: string; volume: number; avgCost: number; currentPrice: number;
    marketValue: number; unrealizedPnL: number; realizedPnL: number; buyDate: string;
  }> {
    const positions = this.positionManager.getAllPositions();
    return positions.map(p => ({
      code: p.code,
      volume: p.volume,
      avgCost: p.avgCost,
      currentPrice: p.currentPrice,
      marketValue: p.marketValue,
      unrealizedPnL: p.unrealizedPnL,
      realizedPnL: p.realizedPnL,
      buyDate: this.positionManager.getBuyDate(p.code) || '',
    }));
  }

  getAccountId(): string | null {
    return this.accountId;
  }
}

// 导出单例
export const liveSimulator = new LiveSimulator();
