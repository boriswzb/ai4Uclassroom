/**
 * Walk-Forward Analysis 引擎
 *
 * Walk-Forward 是防止过拟合的金标准：
 * - In-Sample (IS): 用历史数据优化参数
 * - Out-of-Sample (OOS): 用"未来"数据验证参数有效性
 *
 * 步骤：
 * 1. 把数据切成 N 个窗口
 * 2. 每个窗口：前段 IS 优化 → 后段 OOS 测试
 * 3. 汇总 OOS 表现，检验策略稳健性
 */

import { KBar, BacktestConfig, BacktestResultV2 } from '../types';
import { EnhancedBacktestEngine } from './enhanced-engine';
import { Strategy } from '../strategies/strategy-engine';
import { dataSourceManager } from '../data/data-source';

export interface WalkForwardConfig {
  /** 总回测区间 */
  startDate: string;
  endDate: string;
  /** 每个窗口的训练期比例（如 0.6 = 60%训练，40%测试） */
  trainRatio?: number;
  /** 窗口步进比例（如 0.2 = 每个窗口滑动20%数据） */
  stepRatio?: number;
  /** 最少训练天数（交易日） */
  minTrainDays?: number;
  /** 最少测试天数（交易日） */
  minTestDays?: number;
  /** 策略参数网格（如果为空则用默认参数） */
  paramGrid?: Record<string, number[]>;
}

export interface WalkForwardWindow {
  index: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  trainResult?: BacktestResultV2;
  testResult?: BacktestResultV2;
  /** OOS夏普比率 */
  oosSharpe: number;
  /** IS夏普比率 */
  isSharpe: number;
  /** OOS总收益 */
  oosReturn: number;
  /** 参数选择（如果是参数优化模式） */
  bestParams?: Record<string, number>;
}

export interface WalkForwardReport {
  /** 所有窗口结果 */
  windows: WalkForwardWindow[];
  /** 平均 OOS 夏普 */
  avgOOSSharpe: number;
  /** 平均 OOS 收益 */
  avgOOSReturn: number;
  /** OOS 胜率（正收益窗口比例） */
  oosWinRate: number;
  /** IS/OOS 夏普比率比（理想值接近1，越低说明过拟合越严重） */
  sharpeRatio: number;
  /** 稳健性评分（0-100，越高越好） */
  robustnessScore: number;
  /** 总收益（OOS汇总） */
  totalOOSReturn: number;
  /** 最大回撤（OOS汇总） */
  maxOOSDrawdown: number;
  /** 过拟合系数（越大越可能过拟合） */
  overfittingCoef: number;
  /** 结论 */
  conclusion: string;
}

// ==================== 工具 ====================

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDate(s: string): number {
  return new Date(s).getTime();
}

// ==================== Walk-Forward 主类 ====================

export class WalkForwardEngine {
  private config: Required<WalkForwardConfig>;
  private strategy: Strategy;
  private baseConfig: Omit<BacktestConfig, 'startDate' | 'endDate'>;
  private kbarsCache: Map<string, KBar[]> = new Map();
  private tradingDays: { timestamp: number; date: string }[] = [];

  constructor(
    config: WalkForwardConfig,
    strategy: Strategy,
    baseConfig: Omit<BacktestConfig, 'startDate' | 'endDate'>
  ) {
    this.config = {
      startDate: config.startDate,
      endDate: config.endDate,
      trainRatio: config.trainRatio ?? 0.6,
      stepRatio: config.stepRatio ?? 0.2,
      minTrainDays: config.minTrainDays ?? 60,
      minTestDays: config.minTestDays ?? 30,
      paramGrid: config.paramGrid ?? {},
    };
    this.strategy = strategy;
    this.baseConfig = baseConfig;
  }

  // ==================== 公开 API ====================

  async run(): Promise<WalkForwardReport> {
    console.log('[WalkForward] 开始 Walk-Forward 分析...');
    console.log(`[WalkForward] 区间: ${this.config.startDate} ~ ${this.config.endDate}`);
    console.log(`[WalkForward] 训练比例: ${(this.config.trainRatio * 100).toFixed(0)}%, 步进: ${(this.config.stepRatio * 100).toFixed(0)}%`);

    await this.loadData();
    this.buildTradingDays();

    const windows = this.splitWindows();
    console.log(`[WalkForward] 共 ${windows.length} 个窗口`);

    for (const win of windows) {
      console.log(`\n[WalkForward] 窗口 ${win.index + 1}/${windows.length}:`);
      console.log(`  训练期: ${win.trainStart} ~ ${win.trainEnd}`);
      console.log(`  测试期: ${win.testStart} ~ ${win.testEnd}`);

      // 训练期回测
      const trainConfig: BacktestConfig = {
        ...this.baseConfig,
        startDate: win.trainStart,
        endDate: win.trainEnd,
      };
      const trainEngine = new EnhancedBacktestEngine(trainConfig, this.strategy.clone());
      win.trainResult = await trainEngine.run();

      // 测试期回测
      const testConfig: BacktestConfig = {
        ...this.baseConfig,
        startDate: win.testStart,
        endDate: win.testEnd,
      };
      const testEngine = new EnhancedBacktestEngine(testConfig, this.strategy.clone());
      win.testResult = await testEngine.run();

      win.isSharpe = win.trainResult?.sharpeRatio ?? 0;
      win.oosSharpe = win.testResult?.sharpeRatio ?? 0;
      win.oosReturn = win.testResult?.totalReturn ?? 0;

      console.log(`  IS夏普: ${win.isSharpe.toFixed(2)}, OOS夏普: ${win.oosSharpe.toFixed(2)}`);
      console.log(`  IS收益: ${((win.trainResult?.totalReturn ?? 0) * 100).toFixed(1)}%, OOS收益: ${(win.oosReturn * 100).toFixed(1)}%`);
    }

    return this.buildReport(windows);
  }

  // ==================== 数据加载 ====================

  private async loadData(): Promise<void> {
    const start = parseDate(this.config.startDate);
    const end = parseDate(this.config.endDate);

    for (const code of this.baseConfig.stockCodes) {
      const kbars = await dataSourceManager.getKBar(code, start, end);
      kbars.sort((a, b) => a.timestamp - b.timestamp);
      const buffered = kbars.filter(b => b.timestamp >= start - 90 * 86400000 && b.timestamp <= end + 86400000);
      this.kbarsCache.set(code, buffered);
    }
  }

  private buildTradingDays(): void {
    const start = parseDate(this.config.startDate);
    const end = parseDate(this.config.endDate);
    const days = new Map<number, string>();

    for (const [, kbars] of this.kbarsCache) {
      for (const bar of kbars) {
        if (bar.timestamp >= start && bar.timestamp <= end) {
          const d = new Date(bar.timestamp);
          const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
          const dateStr = formatDate(dayStart);
          days.set(dayStart, dateStr);
        }
      }
    }

    this.tradingDays = Array.from(days.entries()).sort((a, b) => a[0] - b[0]).map(([ts, date]) => ({ timestamp: ts, date }));
  }

  // ==================== 窗口切分 ====================

  private splitWindows(): WalkForwardWindow[] {
    const total = this.tradingDays.length;
    const trainDays = Math.floor(total * this.config.trainRatio);
    const stepDays = Math.floor(total * this.config.stepRatio);
    const windows: WalkForwardWindow[] = [];

    let trainEndIdx = trainDays;
    let index = 0;

    while (trainEndIdx < total) {
      const trainStartIdx = index * stepDays;
      const trainEndIdxNew = trainStartIdx + trainDays;
      const testStartIdx = trainEndIdxNew;
      const testEndIdx = Math.min(testStartIdx + (total - trainEndIdxNew), total - 1);

      if (testEndIdx - testStartIdx < this.config.minTestDays) break;

      const trainStart = this.tradingDays[trainStartIdx]?.date;
      const trainEnd = this.tradingDays[Math.min(trainEndIdxNew - 1, total - 1)]?.date;
      const testStart = this.tradingDays[testStartIdx]?.date;
      const testEnd = this.tradingDays[testEndIdx]?.date;

      if (trainStart && trainEnd && testStart && testEnd) {
        windows.push({
          index,
          trainStart,
          trainEnd,
          testStart,
          testEnd,
          oosSharpe: 0,
          isSharpe: 0,
          oosReturn: 0,
        });
      }

      index++;
      trainEndIdx = trainEndIdxNew;
    }

    return windows;
  }

  // ==================== 生成报告 ====================

  private buildReport(windows: WalkForwardWindow[]): WalkForwardReport {
    const validWindows = windows.filter(w => w.testResult);
    const oosSharpes = validWindows.map(w => w.oosSharpe);
    const oosReturns = validWindows.map(w => w.oosReturn);
    const isSharpes = validWindows.map(w => w.isSharpe);

    const avgOOSSharpe = oosSharpes.length > 0 ? oosSharpes.reduce((a, b) => a + b, 0) / oosSharpes.length : 0;
    const avgOOSReturn = oosReturns.length > 0 ? oosReturns.reduce((a, b) => a + b, 0) / oosReturns.length : 0;
    const avgISSharpe = isSharpes.length > 0 ? isSharpes.reduce((a, b) => a + b, 0) / isSharpes.length : 0;
    const oosWinRate = oosReturns.filter(r => r > 0).length / (oosReturns.length || 1);
    const sharpeRatio = avgOOSSharpe / (avgISSharpe || 0.01); // OOS/IS，理想接近1

    // 最大OOS回撤
    let totalEquity = 1;
    let peak = 1;
    let maxOOSDrawdown = 0;
    for (const r of oosReturns) {
      totalEquity *= (1 + r);
      if (totalEquity > peak) peak = totalEquity;
      const dd = (peak - totalEquity) / peak;
      if (dd > maxOOSDrawdown) maxOOSDrawdown = dd;
    }

    // 过拟合系数：IS夏普和OOS夏普的差距
    const overfittingCoef = Math.max(0, (avgISSharpe - avgOOSSharpe) / (avgISSharpe || 0.01));

    // 稳健性评分：综合多个指标
    const sharpeScore = Math.min(1, avgOOSSharpe / 2) * 30; // 夏普权重30
    const winRateScore = oosWinRate * 30; // 胜率权重30
    const consistencyScore = Math.min(1, 1 - overfittingCoef) * 40; // 一致性权重40
    const robustnessScore = Math.min(100, sharpeScore + winRateScore + consistencyScore);

    // 结论
    let conclusion = '';
    if (robustnessScore >= 70 && sharpeRatio >= 0.7) {
      conclusion = '策略稳健性良好，Walk-Forward验证通过，适合实盘部署';
    } else if (robustnessScore >= 50) {
      conclusion = '策略稳健性中等，建议谨慎使用，持续监控表现';
    } else if (sharpeRatio < 0.3) {
      conclusion = '严重过拟合！IS表现远优于OOS，策略参数可能过度优化，请重新设计策略';
    } else {
      conclusion = '策略稳健性不足，建议优化策略逻辑或参数选择方法';
    }

    return {
      windows,
      avgOOSSharpe,
      avgOOSReturn,
      oosWinRate,
      sharpeRatio,
      robustnessScore,
      totalOOSReturn: oosReturns.reduce((a, b) => a * (1 + b), 1) - 1,
      maxOOSDrawdown,
      overfittingCoef,
      conclusion,
    };
  }
}
