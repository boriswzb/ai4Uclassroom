'use client';

/**
 * 多因子组合回测面板
 * 使用 FactorPortfolioEngine 进行基于 IC/IR 权重的多因子组合回测
 * 支持因子归因分析（Brinson + Barra 因子暴露）
 *
 * 【Pipeline 整合 — 输出端】
 * 运行完成后，结果自动保存到 PipelineStore：
 *   - 保存 rebalanceLog（每期调仓日期 + 持仓明细）
 *   - 保存绩效摘要（年化/夏普/最大回撤/胜率）
 *   下游模块（回测面板 / 模拟交易）可读取并使用
 */
import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import type { PortfolioHolding, RebalanceEntry } from '@/lib/quant/store';
import dynamic from 'next/dynamic';
import { useWatchlistStore, usePipelineStore } from '@/lib/quant/store';
import type { PipelineResult } from '@/lib/quant/store/pipeline-store';
import type {
  PortfolioBacktestResult,
  RebalanceMode,
  WeightMethod,
  PortfolioBacktestResult as BTR,
  RebalanceRecord,
} from '@/lib/quant';

// 格式化函数（模块级别，供各 Tab 共享）
const fmt = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
const fmt2 = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

// ==================== 子组件：权益曲线 ====================

function EquityCurveChart({ result }: { result: PortfolioBacktestResult }) {
  const option = {
    backgroundColor: '#0f172a',
    tooltip: { trigger: 'axis', formatter: (params: any[]) => {
      const p = params[0];
      return `${p.name}<br/>组合: ${(p.value[1] as number).toLocaleString('zh-CN', { style: 'currency', currency: 'CNY' })}`;
    }},
    legend: { top: 10, textStyle: { color: '#94a3b8' }, data: ['组合', '基准'] },
    grid: { left: 60, right: 20, top: 50, bottom: 40 },
    xAxis: {
      type: 'category',
      data: result.equityCurveWithDate.map(d => d.date),
      axisLine: { lineStyle: { color: '#334155' } },
      axisLabel: { color: '#64748b', fontSize: 10 },
      boundaryGap: false,
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      splitLine: { lineStyle: { color: '#1e293b' } },
      axisLabel: { color: '#64748b', fontSize: 10, formatter: (v: number) => `${(v / 1e6).toFixed(1)}M` },
    },
    series: [
      {
        name: '组合',
        type: 'line',
        data: result.equityCurveWithDate.map((d, i) => [i, d.equity]),
        smooth: true,
        lineStyle: { color: '#3b82f6', width: 2 },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(59,130,246,0.3)' }, { offset: 1, color: 'rgba(59,130,246,0)' }] } },
        showSymbol: false,
      },
      ...(result.equityCurveWithDate.some(d => d.benchmark != null) ? [{
        name: '基准',
        type: 'line' as const,
        data: result.equityCurveWithDate.map((d, i) => d.benchmark != null ? [i, d.benchmark] : [i, null]),
        smooth: true,
        lineStyle: { color: '#f59e0b', width: 1.5, type: 'dashed' as const },
        showSymbol: false,
      }] : []),
    ],
  };
  return <ReactECharts option={option} style={{ height: 300 }} />;
}

// ==================== 子组件：月度收益热力图 ====================

function MonthlyHeatmap({ result }: { result: PortfolioBacktestResult }) {
  const months = result.monthlyReturns;
  if (!months || months.length === 0) return <div className="text-slate-500 text-xs">无月度数据</div>;

  const data: [number, number, number][] = [];
  const years = [...new Set(months.map(m => m.year))].sort();

  for (const m of months) {
    const yearIdx = years.indexOf(m.year);
    const monthIdx = m.month - 1;
    const ret = Math.round(m.return * 10000) / 100;
    data.push([monthIdx, yearIdx, ret]);
  }

  const option = {
    backgroundColor: '#0f172a',
    tooltip: { formatter: (p: any) => `${years[p.data[1]]}年${p.data[0] + 1}月<br/>收益: ${p.data[2] >= 0 ? '+' : ''}${p.data[2].toFixed(2)}%` },
    grid: { left: 50, right: 20, top: 20, bottom: 50 },
    xAxis: { type: 'category', data: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'], axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#64748b', fontSize: 10 } },
    yAxis: { type: 'category', data: years.map(String), axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#64748b', fontSize: 10 } },
    visualMap: {
      min: -15, max: 15,
      calculable: true,
      orient: 'horizontal',
      left: 60, bottom: 10,
      inRange: { color: ['#ef4444', '#f97316', '#fbbf24', '#f8fafc', '#86efac', '#22c55e', '#15803d'] },
      textStyle: { color: '#94a3b8' },
    },
    series: [{ type: 'heatmap', data, label: { show: true, formatter: (p: any) => `${p.data[2].toFixed(1)}%`, fontSize: 8, color: '#000' }, emphasis: { itemStyle: { shadowBlur: 10 } } }],
  };
  return <ReactECharts option={option} style={{ height: Math.max(120, years.length * 30 + 40) }} />;
}

// ==================== 子组件：调仓日志 ====================

function RebalanceLog({ result }: { result: PortfolioBacktestResult }) {
  const log = result.rebalanceLog;
  if (!log || log.length === 0) return <div className="text-slate-500 text-xs">暂无调仓记录</div>;

  return (
    <div className="space-y-2 max-h-96 overflow-y-auto">
      {log.map((r, i) => (
        <div key={i} className="bg-slate-800/60 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-blue-400 text-xs font-medium">{r.date}</span>
            <span className="text-slate-500 text-xs">{r.target.holdings.length} 只持仓</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {r.target.holdings.slice(0, 8).map(h => (
              <div key={h.code} className="flex items-center justify-between text-xs">
                <span className="text-slate-400 truncate mr-1">{h.code}</span>
                <span className="text-slate-300 flex-shrink-0">{(h.weight * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ==================== 子组件：归因 waterfall ====================

function AttributionWaterfall({ brinson }: { brinson: any }) {
  if (!brinson) return null;

  const items = [
    { name: '配置效应', value: brinson.allocationEffect, color: '#3b82f6' },
    { name: '选股效应', value: brinson.selectionEffect, color: '#22c55e' },
    { name: '交互效应', value: brinson.interactionEffect, color: '#f59e0b' },
    { name: '超额收益', value: brinson.totalExcessReturn, color: '#a855f7' },
  ];

  const option = {
    backgroundColor: '#0f172a',
    tooltip: { trigger: 'axis', formatter: (p: any[]) => {
      const v = p[0].value;
      return `${p[0].name}<br/>${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
    }},
    grid: { left: 70, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: items.map(i => i.name), axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#94a3b8', fontSize: 11 } },
    yAxis: { type: 'value', axisLine: { show: false }, splitLine: { lineStyle: { color: '#1e293b' } }, axisLabel: { color: '#64748b', fontSize: 10, formatter: (v: number) => `${(v * 100).toFixed(1)}%` } },
    series: [{
      type: 'bar',
      data: items.map(i => ({ value: i.value, itemStyle: { color: i.color } })),
      label: { show: true, formatter: (p: any) => `${(p.value >= 0 ? '+' : '')}${(p.value * 100).toFixed(1)}%`, position: 'top', color: '#94a3b8', fontSize: 10 },
    }],
  };
  return <ReactECharts option={option} style={{ height: 220 }} />;
}

// ==================== 子组件：因子贡献条形图 ====================

function FactorContributionChart({ factorContributions }: { factorContributions: any[] }) {
  if (!factorContributions || factorContributions.length === 0) {
    return <div className="text-slate-500 text-xs text-center py-4">暂无归因数据</div>;
  }

  const sorted = [...factorContributions].sort((a, b) => b.contribution - a.contribution);
  const option = {
    backgroundColor: '#0f172a',
    tooltip: { trigger: 'axis', formatter: (p: any[]) => {
      const v = p[0].value;
      return `${p[0].name}<br/>贡献: ${v >= 0 ? '+' : ''}${v.toFixed(2)} bp`;
    }},
    grid: { left: 100, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'value', axisLine: { show: false }, splitLine: { lineStyle: { color: '#1e293b' } }, axisLabel: { color: '#64748b', fontSize: 10, formatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}` } },
    yAxis: { type: 'category', data: sorted.map(s => s.factorName), axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#94a3b8', fontSize: 10 } },
    series: [{
      type: 'bar',
      data: sorted.map(s => ({ value: s.contribution, itemStyle: { color: s.contribution >= 0 ? '#22c55e' : '#ef4444' } })),
      label: { show: true, formatter: (p: any) => `${p.value >= 0 ? '+' : ''}${p.value.toFixed(0)}`, position: 'right', color: '#94a3b8', fontSize: 9 },
    }],
  };
  return <ReactECharts option={option} style={{ height: Math.max(200, sorted.length * 36 + 20) }} />;
}

// ==================== 归因面板 ====================

function AttributionTab({ result }: { result: PortfolioBacktestResult }) {
  const [attribution, setAttribution] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleRun = useCallback(async () => {
    setLoading(true);
    setAttribution(null);
    try {
      const { attributePortfolio } = await import('@/lib/quant/backtest/factor-portfolio');
      const attr = await attributePortfolio(result.rebalanceLog, result);
      setAttribution(attr);
    } catch (e) {
      console.error('[Attribution]', e);
      toast.error('归因分析失败: ' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [result]);

  const { summary } = attribution ?? {};

  return (
    <div className="space-y-4">
      {/* 运行按钮 */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleRun}
          disabled={loading}
          className="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-xl text-sm font-medium text-white transition-colors"
        >
          {loading ? '分析中...' : '运行因子归因分析'}
        </button>
        {summary && (
          <span className="text-xs text-slate-400">
            IC准确率 {((summary.icAccuracy ?? 0) * 100).toFixed(0)}% |
            可解释收益 {(summary.explainedByFactors * 100).toFixed(2)}% |
            特异性 {(summary.idiosyncraticReturn * 100).toFixed(2)}%
          </span>
        )}
      </div>

      {attribution && (
        <>
          {/* 归因摘要 */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: '总收益', v: fmt(summary.totalReturn), c: summary.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400' } as const,
                { label: 'Alpha', v: fmt(summary.alpha), c: summary.alpha >= 0 ? 'text-emerald-400' : 'text-red-400' } as const,
                { label: '可解释收益', v: fmt(summary.explainedByFactors), c: summary.explainedByFactors >= 0 ? 'text-emerald-400' : 'text-red-400' } as const,
                { label: '特异性收益', v: fmt(summary.idiosyncraticReturn), c: 'text-slate-400' } as const,
              ].map(m => (
                <div key={m.label} className="bg-slate-800/60 rounded-lg p-2 text-center">
                  <div className="text-xs text-slate-500 mb-0.5">{m.label}</div>
                  <div className={`text-sm font-bold ${m.c}`}>{m.v}</div>
                </div>
              ))}
            </div>
          )}

          {/* Brinson 归因 */}
          {attribution.brinson && (
            <div className="bg-slate-800/30 rounded-xl p-3">
              <h4 className="text-sm font-medium text-white mb-3">Brinson 归因</h4>
              <AttributionWaterfall brinson={attribution.brinson} />
              {attribution.brinson.periodBreakdown?.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-700">
                        {['日期', '配置效应', '选股效应', '交互效应', '超额收益'].map(h => (
                          <th key={h} className="text-left px-2 py-1 font-normal">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {attribution.brinson.periodBreakdown.slice(-6).reverse().map((row: any, i: number) => (
                        <tr key={i} className="border-b border-slate-800 text-slate-400">
                          <td className="px-2 py-1">{row.date}</td>
                          <td className={`px-2 py-1 ${row.allocation >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(row.allocation)}</td>
                          <td className={`px-2 py-1 ${row.selection >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(row.selection)}</td>
                          <td className={`px-2 py-1 ${row.interaction >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(row.interaction)}</td>
                          <td className={`px-2 py-1 ${row.excess >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(row.excess)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 因子暴露归因 */}
          {attribution.factorAttribution && (
            <div className="bg-slate-800/30 rounded-xl p-3">
              <h4 className="text-sm font-medium text-white mb-3">因子暴露归因（Barra 风格）</h4>
              <FactorContributionChart factorContributions={attribution.factorAttribution.factorContributions} />

              {/* 归因明细表 */}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-700">
                      {['因子', 'IC均值', 'IC方向', '组合暴露', '贡献(bp)'].map(h => (
                        <th key={h} className="text-left px-2 py-1 font-normal">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...attribution.factorAttribution.factorContributions]
                      .sort((a: any, b: any) => b.contribution - a.contribution)
                      .map((f: any, i: number) => (
                        <tr key={i} className="border-b border-slate-800 text-slate-400">
                          <td className="px-2 py-1 text-slate-300">{f.factorName}</td>
                          <td className="px-2 py-1">{f.icMean?.toFixed(4) ?? '—'}</td>
                          <td className="px-2 py-1">{f.icMean >= 0 ? '正向' : '负向'}</td>
                          <td className="px-2 py-1">{f.portfolioExposure?.toFixed(3) ?? '—'}</td>
                          <td className={`px-2 py-1 ${f.contribution >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {f.contribution >= 0 ? '+' : ''}{f.contribution?.toFixed(2) ?? '—'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {!attribution && !loading && (
        <div className="text-xs text-slate-500 text-center py-12 border border-dashed border-slate-700 rounded-xl">
          点击上方「运行因子归因分析」按钮开始归因
        </div>
      )}
    </div>
  );
}

// ==================== 主面板 ====================

type BacktestTab = 'overview' | 'rebalance' | 'attribution';

export default function FactorPortfolioPanel() {
  const [tab, setTab] = useState<BacktestTab>('overview');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PortfolioBacktestResult | null>(null);

  const [stockPoolInput, setStockPoolInput] = useState('000001.SZ,600000.SH,600519.SH,601318.SH,000002.SZ');
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState('2024-12-31');
  const [initialCash, setInitialCash] = useState(1000000);
  const [topN, setTopN] = useState(10);
  const [benchmark, setBenchmark] = useState('000001.SH');
  const [stopLoss, setStopLoss] = useState(7);
  const [takeProfit, setTakeProfit] = useState(15);
  const [rebalanceType, setRebalanceType] = useState<'daily' | 'weekly' | 'biweekly' | 'threshold'>('weekly');
  const [weightMethod, setWeightMethod] = useState<'equal' | 'score-proportional' | 'risk-parity'>('equal');

  const loadWatchlist = useCallback(() => {
    try {
      const store = useWatchlistStore.getState();
      const list = store.getDefaultWatchlist();
      if (list?.codes?.length) setStockPoolInput(list.codes.slice(0, 30).join(','));
    } catch {}
  }, []);

  const handleRun = useCallback(async () => {
    setLoading(true);
    setResult(null);
    try {
      const { runFactorBacktest } = await import('@/lib/quant/backtest/factor-portfolio');

      const pool = stockPoolInput.split(',').map(s => s.trim()).filter(Boolean);
      if (pool.length < 2) { toast.warning('股票池至少需要2只股票'); setLoading(false); return; }

      let rebalanceMode: RebalanceMode;
      switch (rebalanceType) {
        case 'weekly': rebalanceMode = { type: 'weekly', dayOfWeek: 1 }; break;
        case 'biweekly': rebalanceMode = { type: 'biweekly', dayOfWeek: 1 }; break;
        case 'threshold': rebalanceMode = { type: 'threshold', scoreChangePct: 0.1 }; break;
        default: rebalanceMode = { type: 'daily' };
      }

      let wm: WeightMethod;
      switch (weightMethod) {
        case 'score-proportional': wm = { type: 'score-proportional', normalize: true }; break;
        case 'risk-parity': wm = { type: 'risk-parity' }; break;
        default: wm = { type: 'equal' };
      }

      const res = await runFactorBacktest({
        startDate, endDate, initialCash,
        commission: 0.0003, slippage: 0.001,
        stockPool: pool, benchmarkCode: benchmark,
        factorWeights: null,
        rebalanceMode, topN, weightMethod: wm,
        maxSinglePosition: 0.2,
        stopLossPct: stopLoss / 100,
        takeProfitPct: takeProfit / 100,
      });

      setResult(res);

      // ── P2: 自动保存到 Pipeline Store ──────────────────────
      // 把 PortfolioBacktestResult 映射成 PipelineResult
      const pipelineResult: PipelineResult = {
        id: `fp-${Date.now()}`,
        name: `组合_${startDate}_${endDate}`,
        createdAt: Date.now(),
        startDate,
        endDate,
        rebalanceMode: rebalanceType,
        topN,
        weightMethod,
        // 绩效摘要
        totalReturn: res.totalReturn,
        annualReturn: res.annualReturn,
        sharpeRatio: res.sharpeRatio,
        maxDrawdown: res.maxDrawdown,
        alpha: res.alpha,
        beta: res.beta,
        winRate: res.winRate,
        // 调仓日志（核心：每期持仓明细）
        rebalanceLog: res.rebalanceLog.map((r: RebalanceRecord) => ({
          date: r.date,
          holdings: r.target.holdings.map(h => ({
            code: h.code,
            weight: h.weight,
            score: undefined,
          })),
          equity: 0, // 组合引擎不逐期记录equity，用0占位
          benchmarkReturn: undefined,
          portfolioReturn: undefined,
        })),
        // 权益曲线
        equityCurve: res.equityCurveWithDate,
      };
      usePipelineStore.getState().addResult(pipelineResult);
      // ───────────────────────────────────────────────────────
    } catch (e) {
      console.error('[FactorPortfolio]', e);
      toast.error('回测失败: ' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [stockPoolInput, startDate, endDate, initialCash, topN, benchmark, rebalanceType, weightMethod, stopLoss, takeProfit]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
      <h2 className="text-xl font-bold text-white mb-4">多因子组合回测</h2>

      {/* ── 配置区 ─────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div>
          <label className="block text-xs text-slate-400 mb-1">股票池（逗号分隔）</label>
          <textarea
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white resize-none h-20"
            value={stockPoolInput}
            onChange={e => setStockPoolInput(e.target.value)}
            placeholder="000001.SZ,600000.SH,..."
          />
          <button onClick={loadWatchlist} className="mt-1 text-xs text-blue-400 hover:text-blue-300">从自选股加载</button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-slate-400 mb-1">开始日期</label>
              <input type="date" className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">结束日期</label>
              <input type="date" className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-slate-400 mb-1">初始资金</label>
              <input type="number" className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white" value={initialCash} onChange={e => setInitialCash(Number(e.target.value))} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">基准指数</label>
              <input type="text" className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white" value={benchmark} onChange={e => setBenchmark(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-slate-400 mb-1">持仓 N</label>
              <input type="number" className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white" value={topN} min={1} max={100} onChange={e => setTopN(Number(e.target.value))} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">止损 %</label>
              <input type="number" className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white" value={stopLoss} min={1} max={50} onChange={e => setStopLoss(Number(e.target.value))} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">止盈 %</label>
              <input type="number" className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white" value={takeProfit} min={1} max={100} onChange={e => setTakeProfit(Number(e.target.value))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-slate-400 mb-1">调仓频率</label>
              <select className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white" value={rebalanceType} onChange={e => setRebalanceType(e.target.value as any)}>
                <option value="daily">每日</option>
                <option value="weekly">每周一</option>
                <option value="biweekly">每两周</option>
                <option value="threshold">阈值触发</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">权重方式</label>
              <select className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white" value={weightMethod} onChange={e => setWeightMethod(e.target.value as any)}>
                <option value="equal">等权</option>
                <option value="score-proportional">评分比例</option>
                <option value="risk-parity">风险平价</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ── 运行按钮 ───────────────────────────── */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={handleRun}
          disabled={loading}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-xl text-sm font-medium text-white transition-colors"
        >
          {loading ? '回测中...' : '运行多因子组合回测'}
        </button>
        {result && (
          <span className="text-xs text-slate-400">
            {result.rebalanceCount} 次调仓 | {(result.turnover * 100).toFixed(0)}% 平均换手 | {result.avgHoldingPeriod.toFixed(1)} 天平均持仓
          </span>
        )}
      </div>

      {/* ── 结果区 ─────────────────────────────── */}
      {result && (
        <>
          {/* 标签页 */}
          <div className="flex gap-1 mb-4 bg-slate-800 rounded-lg p-1 w-fit">
            {([['overview', '总览'], ['rebalance', '调仓记录'], ['attribution', '归因分析']] as [BacktestTab, string][]).map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded text-xs font-medium transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>{label}</button>
            ))}
          </div>

          {/* Tab: 总览 */}
          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                {[
                  { label: '总收益', v: fmt(result.totalReturn), c: result.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400' } as const,
                  { label: '年化收益', v: fmt(result.annualReturn), c: result.annualReturn >= 0 ? 'text-emerald-400' : 'text-red-400' } as const,
                  { label: '夏普比率', v: result.sharpeRatio.toFixed(2), c: result.sharpeRatio >= 1 ? 'text-emerald-400' : result.sharpeRatio >= 0 ? 'text-yellow-400' : 'text-red-400' } as const,
                  { label: '最大回撤', v: fmt(result.maxDrawdown), c: 'text-red-400' } as const,
                  { label: 'Alpha', v: fmt2(result.alpha), c: result.alpha >= 0 ? 'text-emerald-400' : 'text-red-400' } as const,
                  { label: 'Beta', v: result.beta.toFixed(2), c: 'text-blue-400' } as const,
                  { label: '年化波动', v: fmt(result.annualVolatility), c: 'text-slate-400' } as const,
                  { label: '胜率', v: fmt(result.winRate), c: result.winRate >= 0.5 ? 'text-emerald-400' : 'text-red-400' } as const,
                ].map(m => (
                  <div key={m.label} className="bg-slate-800/60 rounded-lg p-2 text-center">
                    <div className="text-xs text-slate-500 mb-0.5">{m.label}</div>
                    <div className={`text-sm font-bold ${m.c}`}>{m.v}</div>
                  </div>
                ))}
              </div>

              <div className="bg-slate-800/30 rounded-xl p-3">
                <h3 className="text-sm font-medium text-white mb-3">权益曲线</h3>
                <EquityCurveChart result={result} />
              </div>

              <div className="bg-slate-800/30 rounded-xl p-3">
                <h3 className="text-sm font-medium text-white mb-3">回撤曲线</h3>
                <ReactECharts
                  option={{
                    backgroundColor: '#0f172a',
                    tooltip: { trigger: 'axis' },
                    grid: { left: 60, right: 20, top: 20, bottom: 40 },
                    xAxis: { type: 'category', data: result.equityCurveWithDate.map(e => e.date), axisLine: { lineStyle: { color: '#334155' } }, axisLabel: { color: '#64748b', fontSize: 10 }, boundaryGap: false },
                    yAxis: { type: 'value', axisLine: { show: false }, splitLine: { lineStyle: { color: '#1e293b' } }, axisLabel: { color: '#64748b', fontSize: 10, formatter: (v: number) => `${v.toFixed(0)}%` } },
                    series: [{ type: 'line', data: result.drawdownCurve.map(d => d.drawdown * 100), smooth: true, lineStyle: { color: '#ef4444', width: 1.5 }, areaStyle: { color: 'rgba(239,68,68,0.1)' }, showSymbol: false }],
                  }}
                  style={{ height: 200 }}
                />
              </div>

              <div className="bg-slate-800/30 rounded-xl p-3">
                <h3 className="text-sm font-medium text-white mb-3">月度收益热力图</h3>
                <MonthlyHeatmap result={result} />
              </div>
            </div>
          )}

          {/* Tab: 调仓记录 */}
          {tab === 'rebalance' && (
            <div>
              <h3 className="text-sm font-medium text-white mb-3">调仓日志</h3>
              <RebalanceLog result={result} />
            </div>
          )}

          {/* Tab: 归因分析 */}
          {tab === 'attribution' && <AttributionTab result={result} />}
        </>
      )}
    </div>
  );
}
