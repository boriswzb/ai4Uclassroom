/**
 * 量化交易模块导出
 */

// ==================== 类型 ====================
export * from './types';

// ==================== 指标计算 ====================
export {
  computeIndicators,
  SMA, EMA, MACD, RSI, BollingerBands, KDJ, ATR, VWAP,
  OBV, CCI, ADX, WilliamsR, Bias, MFI, Stochastic, VolumeBreakout,
} from './strategies/indicators';

// ==================== 基础策略 ====================
export {
  Strategy,
  MACDStrategy, BollingerStrategy, RSIStrategy, KDJStrategy,
  MAStrategy, CCIStrategy, OBVStrategy, ADXStrategy,
  StrategyFactory,
} from './strategies/strategy-engine';
export type { StrategyType } from './strategies/strategy-engine';

// ==================== Phase 2 新策略 ====================
export {
  WilliamsRStrategy, BiasStrategy, MFIStrategy,
  StochasticStrategy, VolumeBreakoutStrategy, CompositeStrategy,
  NewStrategyFactory,
} from './strategies/new-strategies';
export type { NewStrategyType } from './strategies/new-strategies';

// ==================== 策略组合 ====================
export {
  StrategyEnsemble,
  createVotingEnsemble, createFilterEnsemble,
  createWeightedEnsemble, createDynamicEnsemble,
} from './strategies/strategy-ensemble';
export type { EnsembleMode, EnsembleConfig, EnsembleSignal } from './strategies/strategy-ensemble';

// ==================== 自适应组合（Phase 5） ====================
export {
  AdaptiveEnsembleEngine,
  createAdaptiveEnsemble,
} from './strategies/adaptive-ensemble';

// ==================== 风控引擎 ====================
export {
  RiskEngine,
  PositionManager,
  StopLossRule, StopProfitRule,
  PositionLimitRule, SingleOrderLimitRule, DailyLossLimitRule,
} from './risk/risk-engine';

// ==================== Phase 1 新增风控模块 ====================
export { AdvancedPositionManager } from './risk/position-manager';
export type { StopConfig, PositionRisk } from './risk/position-manager';
export { PositionSizer } from './risk/position-sizer';
export type { PositionSizingConfig, SizeResult, HistoricalStats } from './risk/position-sizer';

// ==================== 市场状态（Phase 5） ====================
export {
  MarketRegimeClassifier,
} from './market/market-regime';
export type {
  MarketRegime, MarketRegimeResult, MarketBreadthData,
} from './market/market-regime';

// ==================== 回测引擎 ====================
// ⚠️ BacktestEngine 类未实现（只存在于 quant-v2-design.md 设计稿），仅 EnhancedBacktestEngine 可用
// export { BacktestEngine, quickBacktest } from './backtest/backtest-engine';
export { EnhancedBacktestEngine, EventBus, runEnhancedBacktest } from './backtest/enhanced-engine';

// ==================== Walk-Forward 分析（Phase 3） ====================
export { WalkForwardEngine } from './backtest/walkforward-engine';
export type { WalkForwardConfig, WalkForwardWindow, WalkForwardReport } from './backtest/walkforward-engine';

// ==================== 多因子组合回测 ====================
export {
  FactorPortfolioEngine,
  CrossSectionalScorer,
  CrossSectionalDataLoader,
  RebalanceScheduler,
  PortfolioConstructor,
  runFactorBacktest,
} from './backtest/factor-portfolio';

// ==================== 实时模拟器 ====================
// 注（2026-06-15）：LiveSimulator 不再从 @/lib/quant 导出。
//   原因：LiveSimulator 通过 simulator-persistence 间接依赖 simulator-state-store，
//   而 simulator-state-store 顶层 import 'fs'，被 client bundle 拉入会触发
//   "Module not found: Can't resolve 'fs'"（浏览器没有 Node 内置 fs）。
//
//   使用方式：
//     - server 端（API route）：直接 import 路径
//         import { liveSimulator } from '@/lib/quant/simulator/live-simulator'
//     - client 端：不要使用 LiveSimulator（它需要 Node fs；client 侧用 liveSimulator
//       实例在浏览器内存中单例运行，但其代码依赖 server-only 文件，会污染 client bundle）
//
//   历次失败的尝试（保留供未来回溯）：
//     - turbopack.resolveAlias + require.resolve('./lib/empty-module.cjs')  → "server relative imports are not implemented yet"
//     - turbopack.resolveAlias 设为 false                                  → "boolean values are invalid in exports field entries"
//     - turbopack.resolveAlias 用 file:// URL                              → 编译过、client OK，但 server bundle 真的去 require
//                                                                            file:// URL 失败（Node require 不支持 file:// scheme）
//     - simulator-state-store 顶层用 (0, eval)('require')('node:fs')       → 编译过，但 server ESM scope 没有 require 全局
//                                                                            （tsconfig module=esnext），报 "require is not defined"
//   教训：turbopack.resolveAlias 在 Next 16 同时影响 client + server，不能用于此场景
// export { LiveSimulator, liveSimulator } from './simulator/live-simulator';

// ==================== 数据源 ====================
export { DataSourceManager, dataSourceManager } from './data/data-source';

// ==================== 类型导出 ====================
export type {
  BacktestResultV2, DrawdownPoint, MonthlyReturn,
  TradeDetail, BacktestEvent, BacktestEventType,
} from './types';
