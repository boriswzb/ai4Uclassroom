/**
 * Pipeline 状态管理 — 串联多因子组合 ↔ 回测面板 ↔ 模拟交易
 *
 * 【Pipeline 数据流】：
 *
 *   多因子组合回测（FactorPortfolioEngine）
 *         ↓ 运行完成
 *   记录每期调仓的持仓股（date + holdings）
 *         ↓ 保存到 pipelineStore
 *   回测面板读取 → 选择某期持仓股 → 对每只股跑单股票策略回测
 *         ↓
 *   模拟交易读取 → 使用 pipeline 持仓作为预选池
 *
 * 【核心概念】：
 *   - PipelineResult：一次完整的多因子组合回测结果（包含所有调仓记录）
 *   - RebalanceEntry：单次调仓，包含调仓日期和当次持仓明细
 *   - PortfolioHolding：单只持仓（code, weight, score）
 */

import { create } from 'zustand';

// ─────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────

export interface PortfolioHolding {
  code: string;
  weight: number;       // 目标权重（0-1）
  score?: number;       // 因子综合评分
}

export interface RebalanceEntry {
  date: string;                        // 调仓日期
  holdings: PortfolioHolding[];          // 当次持仓列表
  equity: number;                       // 当次组合权益
  benchmarkReturn?: number;             // 当次基准收益
  portfolioReturn?: number;             // 当次组合收益
}

export interface PipelineResult {
  id: string;
  name: string;                         // 用户自定义名称，如"低估值+动量组合"
  createdAt: number;                    // 创建时间戳
  // 组合配置
  startDate: string;
  endDate: string;
  rebalanceMode: string;
  topN: number;
  weightMethod: string;
  // 回测绩效（摘要）
  totalReturn: number;
  annualReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  alpha: number;
  beta: number;
  winRate: number;
  // 调仓日志（核心：每期持仓明细）
  rebalanceLog: RebalanceEntry[];
  // 权益曲线（每日）
  equityCurve: { date: string; equity: number; benchmark?: number }[];
}

interface PipelineState {
  // 所有 pipeline 结果（按创建时间倒序）
  results: PipelineResult[];

  // 当前选中的 pipeline result id
  activeResultId: string | null;

  // 当前选中的调仓期索引（用于回测面板）
  activeRebalanceIdx: number | null;

  // 动作
  addResult: (result: PipelineResult) => void;
  removeResult: (id: string) => void;
  setActive: (id: string | null, rebalanceIdx?: number | null) => void;
  clearAll: () => void;

  // 快捷访问
  getActiveResult: () => PipelineResult | null;
  getActiveRebalance: () => RebalanceEntry | null;
}

// ─────────────────────────────────────────
// Store
// ─────────────────────────────────────────

export const usePipelineStore = create<PipelineState>((set, get) => ({
  results: [],
  activeResultId: null,
  activeRebalanceIdx: null,

  addResult: (result) => {
    set((s) => ({
      results: [result, ...s.results].slice(0, 20), // 最多保留20条
    }));
  },

  removeResult: (id) => {
    set((s) => {
      const results = s.results.filter((r) => r.id !== id);
      return {
        results,
        activeResultId: s.activeResultId === id ? null : s.activeResultId,
        activeRebalanceIdx: s.activeResultId === id ? null : s.activeRebalanceIdx,
      };
    });
  },

  setActive: (id, rebalanceIdx = null) => {
    set({ activeResultId: id, activeRebalanceIdx: rebalanceIdx });
  },

  clearAll: () => {
    set({ results: [], activeResultId: null, activeRebalanceIdx: null });
  },

  getActiveResult: () => {
    const { results, activeResultId } = get();
    return results.find((r) => r.id === activeResultId) ?? null;
  },

  getActiveRebalance: () => {
    const result = get().getActiveResult();
    const idx = get().activeRebalanceIdx;
    if (!result || idx === null) return null;
    return result.rebalanceLog[idx] ?? null;
  },
}));
