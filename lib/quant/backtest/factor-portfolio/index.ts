/**
 * 多因子组合回测模块
 *
 * 导出：
 * - FactorPortfolioEngine       核心引擎
 * - CrossSectionalScorer        截面评分器
 * - CrossSectionalDataLoader     数据加载器
 * - RebalanceScheduler           调仓调度器
 * - PortfolioConstructor          组合构建器
 * - runFactorBacktest()          便捷入口函数
 */

export { FactorPortfolioEngine } from './factor-portfolio-engine';
export { CrossSectionalScorer } from './cross-sectional-scorer';
export { CrossSectionalDataLoader } from './cross-sectional-loader';
export { RebalanceScheduler } from './rebalance-scheduler';
export { PortfolioConstructor } from './portfolio-constructor';
export { PortfolioAttributor, attributePortfolio } from './portfolio-attributor';

// 类型重导出（从主 types/index.ts）
export type {
  PortfolioBacktestResult,
  FactorBacktestConfig,
  StockScore,
  StockFactorSnapshot,
  PortfolioTarget,
  PortfolioHolding,
  RebalanceRecord,
  RebalanceMode,
  WeightMethod,
  FactorContribution,
} from '../../types';

import { FactorPortfolioEngine } from './factor-portfolio-engine';
import { FactorBacktestConfig, PortfolioBacktestResult } from '../../types';

/**
 * 便捷回测入口函数
 *
 * 用法：
 * ```ts
 * import { runFactorBacktest } from '@/lib/quant/backtest/factor-portfolio';
 *
 * const result = await runFactorBacktest({
 *   startDate: '2024-01-01',
 *   endDate: '2024-12-31',
 *   initialCash: 1000000,
 *   stockPool: ['000001.SZ', '600000.SH', ...],
 *   rebalanceMode: { type: 'weekly', dayOfWeek: 1 },
 *   topN: 10,
 *   weightMethod: { type: 'equal' },
 * });
 * console.log(result.annualReturn, result.sharpeRatio);
 * ```
 */
export async function runFactorBacktest(
  config: FactorBacktestConfig
): Promise<PortfolioBacktestResult> {
  const engine = new FactorPortfolioEngine(config);
  return engine.run();
}
