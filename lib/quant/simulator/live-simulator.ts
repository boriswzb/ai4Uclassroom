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

  /** 当日是否已写入净值（YYYYMMDD 字符串），避免重复 */
  private lastEquityRecordedDay: string | null = null;

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
        // P1-Fix：用直接拉 /api/stock/realtime 的 helper 替代 dataSourceManager.getRealtimeQuote，
        // 因为后者在 Node 后端调相对 URL 会失败（被 catch 静默吞掉 → 实时价永远进不来）。
        const directPrice = await this.fetchRealtimeQuoteDirect(code);
        if (directPrice !== null) {
          this.realtimeCache.set(code, { price: directPrice, timestamp: Date.now() });
        }

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
    // 每日净值记录：每个交易日收盘后写一次（15:00 后）—— 用于 IDB equityPoints
    // 引擎只写一次/天（按 todayStr 去重），前端 sparkline 才有数据
    if (hour === 15 && minute === 0 && todayStr !== this.lastEquityRecordedDay) {
      this.recordEquityPointIfReady(todayStr).catch(e => {
        console.warn('[LiveSimulator] recordEquityPoint failed:', e);
      });
    }
  }

  // ==================== 信号执行 ====================

  /**
   * 信号执行（按强度分级）
   * ──────────────────────────────────────────────────────────────────
   * 决策表（基于 signal.strength 0-1）：
   *
   *   无持仓 + long            → 开仓（按 7 步 positionSizer 计算）
   *   无持仓 + short           → 不操作（A股不能裸卖空）
   *   有持仓 + long (≥0.6)     → 加仓（按剩余 maxRatio 算可加量）
   *   有持仓 + long (<0.6)     → 不操作（已持仓，信号不强）
   *   有持仓 + short (≥0.8)    → 全平清仓
   *   有持仓 + short (0.5-0.8) → 减仓 50%
   *   有持仓 + short (0.3-0.5) → 减仓 33%
   *   有持仓 + short (<0.3)    → 不操作（信号太弱，保留观察）
   *
   * 升级点（vs 旧版二元决策）：
   *   ① 加仓：已持仓+强 long 信号可以加仓（复用 positionSizer 加仓量计算）
   *   ② 分级卖出：信号强度决定减仓比例，避免轻微看空就吓跑
   *   ③ 硬上限 1000 股 → 按 maxOrderAmount 计算（避免高价股完全无法下单）
   *   ④ T+1 检查统一前置，避免重复逻辑
   */
  private async executeSignal(signal: Signal, bar: KBar, todayStr: string): Promise<void> {
    if (!this.isAutoPilot) return;

    const code = signal.code;
    const position = this.positionManager.getPosition(code);
    const strength = signal.strength ?? 1.0;

    // ── T+1 通用前置：今日已买则不操作（买/卖/加仓都受 T+1 约束）──
    //   注：A股 T+1 规则——当日买入次日才能卖出，但对加仓/减仓也适用
    //   （已持仓 + 加仓 = 又一笔买入，仍受 T+1 约束）
    const todayBought =
      this.buyRecords.some(r => r.code === code && r.date === todayStr) ||
      (this.positionManager.getBuyDate(code) === todayStr);
    if (todayBought) {
      this.log('warn', `${code} 今日已交易（T+1限制），跳过信号 [${signal.direction} @ ${strength.toFixed(2)}]`);
      return;
    }

    // ── 1) 无持仓 + long → 开仓 ──
    if (signal.direction === 'long' && (!position || position.volume === 0)) {
      await this.openPositionBySignal(code, bar, todayStr, strength, /*isAdd=*/false);
      return;
    }

    // ── 2) 有持仓 + long (≥0.6) → 加仓 ──
    if (signal.direction === 'long' && position && position.volume > 0 && strength >= 0.6) {
      // 检查是否已加仓过（防止同日反复加仓）
      const lastAddDate = (position as any).lastAddDate;
      if (lastAddDate === todayStr) {
        this.log('warn', `${code} 今日已加仓，跳过本次加仓信号`);
        return;
      }
      await this.openPositionBySignal(code, bar, todayStr, strength, /*isAdd=*/true);
      return;
    }

    // ── 3) 有持仓 + long (<0.6) → 不操作（已持仓，信号不强就不加仓）──
    if (signal.direction === 'long' && position && position.volume > 0) {
      this.log('info', `${code} 已有持仓 ${position.volume}股，信号强度 ${strength.toFixed(2)} < 0.6，跳过加仓`);
      return;
    }

    // ── 4) 有持仓 + short → 分级卖出 ──
    if (signal.direction === 'short' && position && position.volume > 0) {
      let sellRatio: number;
      if (strength >= 0.8) {
        sellRatio = 1.0;  // 全平清仓（强转弱）
      } else if (strength >= 0.5) {
        sellRatio = 0.5;  // 减仓 50%
      } else if (strength >= 0.3) {
        sellRatio = 1 / 3; // 减仓 33%
      } else {
        this.log('info', `${code} 信号强度 ${strength.toFixed(2)} < 0.3，太弱，保留持仓观察`);
        return;
      }

      const sellVolume = Math.floor((position.volume * sellRatio) / 100) * 100; // 取整到 100 股
      if (sellVolume < 100) {
        this.log('warn', `${code} 减仓计算不足1手（${sellVolume}股），改为全平`);
        // 兜底：减仓后不足 1 手时直接全平
        const fullOrder = await this.submitOrder(code, 'short', 'market', position.volume);
        if (fullOrder.status === 'filled') {
          this.buyRecords = this.buyRecords.filter(r => r.code !== code);
          this.advancedStopManager.closePosition(code);
          this.positionSizer.updateBalance(this.account.cash);
          this.log('trade', `全平 ${code} × ${position.volume}股（减仓 ${(sellRatio * 100).toFixed(0)}% 计算不足1手兜底）`);
        }
        return;
      }

      const order = await this.submitOrder(code, 'short', 'market', sellVolume);
      if (order.status === 'filled' && order.filledVolume >= order.volume) {
        // 只有全部成交才清 T+1 记录（Bug3 fix）
        if (sellRatio >= 1.0) {
          this.buyRecords = this.buyRecords.filter(r => r.code !== code);
          this.advancedStopManager.closePosition(code);
        }
        this.positionSizer.updateBalance(this.account.cash);
        const action = sellRatio >= 1.0 ? '清仓' : sellRatio >= 0.5 ? '减仓50%' : '减仓33%';
        this.log('trade', `${action} ${code} × ${sellVolume}股（信号强度 ${strength.toFixed(2)}，比例 ${(sellRatio * 100).toFixed(0)}%）`);
      }
      return;
    }

    // ── 5) 无持仓 + short → 不操作（A股不能裸卖空）──
    if (signal.direction === 'short') {
      this.log('info', `${code} 无持仓，short 信号不操作（A 股不允许裸卖空）`);
      return;
    }
  }

  /**
   * 开仓 / 加仓（共用方法，按 7 步 positionSizer 计算仓位）
   * @param isAdd true=加仓（已持仓），false=开仓
   */
  private async openPositionBySignal(
    code: string,
    bar: KBar,
    todayStr: string,
    strength: number,
    isAdd: boolean,
  ): Promise<void> {
    // 1. 市场状态分类
    if (this.kbarsCache?.has(code)) {
      this.marketClassifier.updateBars(this.kbarsCache.get(code)!);
      const regimeResult = this.marketClassifier.analyze();
      this.currentRegime = regimeResult.regime;
    }

    // 2. ATR 计算
    let atr = bar.close * 0.02; // 默认代理值
    if (this.kbarsCache?.has(code) && this.kbarsCache.get(code)!.length >= 15) {
      atr = PositionSizer.computeATR(this.kbarsCache.get(code)!);
    }

    // 3. 7 步仓位计算（positionSizer.calculate）
    const sizeResult = this.positionSizer.calculate(bar.close, atr, strength);

    // 4. 市场状态倍数
    const regimeMultipliers: Record<string, number> = {
      strong_uptrend: 1.2, weak_uptrend: 1.0,
      strong_downtrend: 0.8, weak_downtrend: 0.7,
      high_volatility: 0.6, low_volatility: 1.0,
      uncertain: 0.5,
    };
    const regimeMultiplier = regimeMultipliers[this.currentRegime] ?? 1.0;
    let targetShares = Math.floor(sizeResult.shares * regimeMultiplier / 100) * 100;

    // ── P2: 加仓时检查剩余可加量（maxRatio - 当前持仓占比）──
    if (isAdd) {
      const position = this.positionManager.getPosition(code)!;
      const currentValue = position.volume * bar.close;
      const accountBalance = this.account.cash + this.account.totalAssets - this.account.cash + currentValue; // 简化：用 totalAssets
      const maxTotalValue = this.account.totalAssets * ((this.positionSizer as any).config?.maxPositionRatio ?? 0.3);
      const remainingRoom = Math.max(0, maxTotalValue - currentValue);
      const remainingShares = Math.floor(remainingRoom / bar.close / 100) * 100;
      if (remainingShares < 100) {
        this.log('warn', `${code} 已达 maxPositionRatio 上限，无法加仓`);
        return;
      }
      targetShares = Math.min(targetShares, remainingShares);
      this.log('info', `${code} 加仓空间：剩余 ${remainingShares}股，本次计算 ${targetShares}股`);
    }

    // ── P3: 硬上限改为按金额（maxOrderAmount）──
    //   旧版固定 1000 股，对高价股（>500元）根本下不了单
    //   新版：maxOrderAmount = max(1000股当前金额, maxOrderAmount)
    //   其中 maxOrderAmount 来自 RiskEngine.SingleOrderLimitRule.threshold（默认 10万）
    const singleOrderLimit = (this.riskEngine.getRule('single_order_limit') as any)?.threshold ?? 100000;
    const maxOrderShares = Math.floor(singleOrderLimit / bar.close / 100) * 100;
    const volume = Math.max(0, Math.min(targetShares, maxOrderShares));

    if (volume < 100) {
      this.log('warn', `${code} 计算仓位不足1手（${volume}股），跳过${isAdd ? '加仓' : '开仓'}`);
      return;
    }

    const order = await this.submitOrder(code, 'long', 'market', volume);
    if (order.status === 'filled') {
      if (!isAdd) {
        // 开仓：记录首次买入日（T+1）
        this.buyRecords.push({ code, date: todayStr, volume });
        this.advancedStopManager.openPosition(code, bar.close, volume, 'long', bar.timestamp, atr);
      } else {
        // 加仓：记录加仓日（防同日多次加仓）+ 更新 advancedStopManager
        (this.positionManager as any).positions.get(code) &&
          ((this.positionManager as any).positions.get(code).lastAddDate = todayStr);
        this.advancedStopManager.openPosition(code, bar.close, volume, 'long', bar.timestamp, atr);
      }
      this.positionSizer.updateBalance(this.account.cash);
      this.log('trade', `${isAdd ? '加仓' : '开仓'} ${code} × ${volume}股 @ ¥${bar.close.toFixed(2)}（信号强度 ${strength.toFixed(2)}，市场状态 ${this.currentRegime}，倍数 ${regimeMultiplier.toFixed(1)}×）`);
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
      // 广播风控触发事件 → 前端弹通知 + 写事件流水
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('quant:risk-triggered', {
          detail: {
            code,
            name: (position as any).name || code,
            type: 'risk_rule',
            reason: result.reason || '风控规则触发',
            price: priceForRisk,
            pnl: (priceForRisk - position.avgCost) * position.volume,
            timestamp: Date.now(),
          },
        }));
      }
      this.submitOrder(code, 'short', 'market', position.volume);
    }

    const dailyResult = this.riskEngine.checkDailyLoss();
    if (dailyResult.triggered) {
      this.log('error', '触发日亏损限制，停止交易');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('quant:risk-triggered', {
          detail: {
            code: 'ALL',
            name: '账户',
            type: 'daily_loss_limit',
            reason: dailyResult.reason || '日亏损限制',
            price: 0,
            pnl: 0,
            timestamp: Date.now(),
          },
        }));
      }
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
        // 广播风控触发事件
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('quant:risk-triggered', {
            detail: {
              code,
              name: (position as any).name || code,
              type: stopResult.action || 'stop_loss',
              reason: stopResult.reason || '止损/止盈触发',
              price: priceForRisk,
              pnl,
              timestamp: Date.now(),
            },
          }));
        }
        this.submitOrder(code, 'short', 'market', position.volume);
        this.advancedStopManager.closePosition(code);
      }
    }
  }

  // ==================== 账户 ====================

  /**
   * P0 Bug 修复：非交易时段持仓 currentPrice 未刷新
   * ──────────────────────────────────────────────────────────────────
   * 原问题：update() 循环只在交易时段跑（9:30-11:30, 13:00-15:00），
   *         positionManager 内部持仓的 currentPrice 停留在成本价，
   *         导致 PnL/marketValue 显示失真（用户在休市时看到 unrealizedPnL=0）。
   *
   * 修复：直接用 dataSourceManager.getRealtimeQuote 拉所有持仓的实时报价，
   *       写入 positionManager。简单直接 —— 既然有现成的实时数据接口，
   *       就不用走 K 线缓存兜底那条更绕的路。
   *
   * 数据源优先级：realtimeCache（5min 内）> dataSourceManager.getRealtimeQuote 实时拉取。
   */
  public async refreshHoldingPrices(): Promise<number> {
    const positions = this.positionManager.getAllPositions();
    if (positions.length === 0) return 0;
    let updated = 0;
    for (const pos of positions) {
      const code = pos.code;
      // 1. 优先：5 分钟内的实时报价缓存（交易时段已被 update() 填好）
      const cached = this.realtimeCache.get(code);
      if (cached && Date.now() - cached.timestamp < 5 * 60_000 && cached.price > 0) {
        if (Math.abs(pos.currentPrice - cached.price) > 0.001) {
          this.positionManager.updatePrice(code, cached.price);
          updated++;
        }
        continue;
      }
      // 2. Fallback：直接拉实时报价。
      //   P1-Fix：dataSourceManager.getRealtimeQuote 内部走的是相对 URL fetch，
      //   在 Node.js 后端调用时会抛 "Failed to parse URL" 被 catch 静默吞掉，
      //   导致开盘后引擎 tick 永远拿不到新价、realtimeCache 卡在集合竞价快照。
      //   改用绝对 URL helper（fetchRealtimeQuoteDirect）。
      const directPrice = await this.fetchRealtimeQuoteDirect(code);
      if (directPrice !== null) {
        this.realtimeCache.set(code, { price: directPrice, timestamp: Date.now() });
        const diff = Math.abs((pos.currentPrice || 0) - directPrice);
        console.log(`[refreshHoldingPrices] ${code}: pos.currentPrice=${pos.currentPrice}, directPrice=${directPrice}, diff=${diff.toFixed(3)}, willUpdate=${diff > 0.001}`);
        if (diff > 0.001) {
          this.positionManager.updatePrice(code, directPrice);
          updated++;
        }
      }
    }
    return updated;
  }

  /**
   * P1-Fix：Node.js 后端 fetch 必须用绝对 URL（dataSourceManager 内部走相对 URL 会抛
   * "Failed to parse URL" 然后被 catch 静默吞掉）。直接拉 /api/stock/realtime 这个服务端 route，
   * 避免依赖 dataSourceManager 在 Node 环境的兼容性。
   */
  private async fetchRealtimeQuoteDirect(code: string): Promise<number | null> {
    try {
      const port = process.env.PORT || '3000';
      const host = process.env.QUANT_API_HOST || `http://127.0.0.1:${port}`;
      const url = `${host}/api/stock/realtime?codes=${encodeURIComponent(code)}`;
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
      const json: any = await res.json();
      if (json?.success && Array.isArray(json.data) && json.data.length > 0) {
        const q = json.data[0];
        if (q?.price && q.price > 0) return q.price;
      }
    } catch { /* 静默失败 — 主流程不依赖实时价也能跑（fallback 到 bar.close） */ }
    return null;
  }

  /**
   * 写入每日净值（用于 IDB equityPoints，供前端 sparkline/净值曲线渲染）
   * ──────────────────────────────────────────────────────────────────
   * 时机：交易日 15:00 后引擎每 30s 检测一次，每天只写一次。
   * 通过 simulatorPersistence 写入 IDB（避免在 Node 端 import db）。
   */
  private async recordEquityPointIfReady(todayStr: string): Promise<void> {
    if (this.lastEquityRecordedDay === todayStr) return;
    if (!this.accountId) return;
    // 浏览器端才写
    if (typeof window === 'undefined') return;
    this.lastEquityRecordedDay = todayStr;
    try {
      const { simulatorPersistence } = await import('../store/simulator-persistence');
      await simulatorPersistence.recordEquityPoint(this.accountId);
      this.log('info', `📊 已记录 ${todayStr} 净值快照`);
    } catch (e) {
      console.warn('[LiveSimulator] recordEquityPoint error:', e);
    }
  }

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
    this.lastEquityRecordedDay = null;

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
   * 实时更新风控设置（速览模式 ⏰ 风险设置面板调用，UI 改动即时生效）
   *
   * 应用到三处内置风控：
   *   1. RiskEngine.StopLossRule（基础止损）
   *   2. RiskEngine.StopProfitRule（基础止盈）
   *   3. RiskEngine.PositionLimitRule（按总资产比例 → 手数）
   *   4. AdvancedPositionManager.stopConfig（高级止损/止盈，含 ATR、移动止盈）
   *   5. RiskEngine.setRuleEnabled（启用/禁用全部风控）
   *
   * @param settings 风险设置（与 app/quant/page.tsx RiskSettings 同步）
   */
  updateRiskSettings(settings: {
    stopLossPct: number;        // 个股止损 %（负数，如 -8 表示跌 8% 触发）
    takeProfitPct: number;      // 个股止盈 %（如 20）
    maxPositionPct: number;     // 单只最大持仓占总资产 %（如 20）
    maxTotalPositions: number;  // 策略池最多 N 只（如 10）
    enabled: boolean;           // 是否启用风控（启用 = 应用全部；禁用 = 关掉所有规则）
  }): { applied: boolean; changes: string[] } {
    const changes: string[] = [];

    // 1) RiskEngine 基础止损规则（绝对值）
    const stopLossRule = this.riskEngine.getRule('stop_loss') as any;
    if (stopLossRule && typeof stopLossRule.threshold === 'number') {
      const newThreshold = Math.abs(settings.stopLossPct) / 100; // -8 → 0.08
      if (Math.abs(stopLossRule.threshold - newThreshold) > 0.0001) {
        stopLossRule.threshold = newThreshold;
        changes.push(`止损阈值 ${(newThreshold * 100).toFixed(1)}%`);
      }
    }

    // 2) RiskEngine 基础止盈规则
    const stopProfitRule = this.riskEngine.getRule('stop_profit') as any;
    if (stopProfitRule && typeof stopProfitRule.threshold === 'number') {
      const newThreshold = settings.takeProfitPct / 100; // 20 → 0.20
      if (Math.abs(stopProfitRule.threshold - newThreshold) > 0.0001) {
        stopProfitRule.threshold = newThreshold;
        changes.push(`止盈阈值 ${(newThreshold * 100).toFixed(1)}%`);
      }
    }

    // 3) PositionLimitRule 改为「策略池最多 N 只」语义（注意：原阈值是手数，这里直接用只数）
    //    原代码 PositionLimitRule(100) = 最大 100 手；改为只数更直观
    const positionLimitRule = this.riskEngine.getRule('position_limit') as any;
    if (positionLimitRule && typeof positionLimitRule.threshold === 'number') {
      if (positionLimitRule.threshold !== settings.maxTotalPositions) {
        positionLimitRule.threshold = settings.maxTotalPositions;
        changes.push(`策略池上限 ${settings.maxTotalPositions} 只`);
      }
    }

    // 4) AdvancedPositionManager.stopConfig（高级止损/止盈，与基础规则保持同步）
    //    fixedStopLoss/fixedStopProfit 是绝对值
    this.advancedStopManager.updateConfig({
      fixedStopLoss: Math.abs(settings.stopLossPct) / 100,
      fixedStopProfit: settings.takeProfitPct / 100,
    });

    // 4b) PositionSizer.config.maxPositionRatio（单只最大占比 = 占总资产%）
    //    这是真正影响"下单时算多少股"的计算（line 185 in position-sizer.ts）
    if (this.positionSizer) {
      const newRatio = settings.maxPositionPct / 100;
      const currentRatio = (this.positionSizer as any).config?.maxPositionRatio;
      if (typeof currentRatio === 'number' && Math.abs(currentRatio - newRatio) > 0.0001) {
        (this.positionSizer as any).config.maxPositionRatio = newRatio;
        changes.push(`单只占比上限 ${(newRatio * 100).toFixed(1)}%`);
      }
    }

    // 5) 全局启用/禁用风控（一次切所有规则）
    const enabled = settings.enabled;
    for (const rule of this.riskEngine.getAllRules()) {
      if (rule.enabled !== enabled) {
        this.riskEngine.setRuleEnabled(rule.id, enabled);
      }
    }
    if (changes.length > 0) {
      changes.unshift(enabled ? '✅ 风控已启用' : '⏸ 风控已禁用');
    } else {
      changes.push(enabled ? '✅ 风控已启用（无阈值变化）' : '⏸ 风控已禁用（无阈值变化）');
    }

    this.log('info', `[风控更新] ${changes.join(' · ')}`);
    return { applied: true, changes };
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
