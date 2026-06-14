'use client';

/**
 * 回测面板 — 验证策略在历史数据上的有效性
 *
 * 【作用】：用"选股器"选出股票后，用策略在历史K线上模拟买卖，
 *         检验"在过去的行情里，这个策略 + 这只股票"是否能赚钱。
 *
 * 【局限性】：
 *   - 只验证了历史，不代表未来有效
 *   - 单股票回测无法验证选股逻辑本身（选股是选股器的职责）
 *   - 参数调优可能导致过拟合
 *
 * 【正确的使用方式】：
 *   Step 1: 用选股器（因子分析）筛选出候选股票
 *   Step 2: 在回测里对候选股跑策略 → 排除明显亏损的策略
 *   Step 3: 留下来的策略 + 股票 → 放入模拟交易验证实时信号
 *
 * 【Pipeline 整合 — 输入端】：
 *   从 PipelineStore 读取「多因子组合」保存的持仓结果，
 *   选择某期调仓持仓后，对每只持仓股批量运行单股票策略回测。
 *   汇总显示：平均年化收益、盈利股数占比、平均胜率。
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import StockCodeInput from './stock-code-input';
import type { BacktestResultV2, TradeDetail } from '@/lib/quant/types';
import { getQuantUserIdQuick } from '@/lib/quant/db/quant-user-identity';
import { useWatchlistStore, usePipelineStore } from '@/lib/quant/store';

// ECharts 动态导入（避免 SSR 问题）
const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

// ─────────────────────────────────────────
// 类型
// ─────────────────────────────────────────

type BacktestTab = 'overview' | 'trades' | 'analysis';
type StrategyType = 'macd' | 'bollinger' | 'rsi' | 'kdj' | 'ma' | 'cci' | 'obv' | 'adx' | 'voting' | 'filter' | 'dynamic' | 'weighted';

// ─────────────────────────────────────────
// 主面板
// ─────────────────────────────────────────

export default function BacktestPanel() {
  const RESULT_CACHE_KEY = 'backtest_result_cache';
  const TAB_CACHE_KEY = 'backtest_tab_cache';

  const [tab, setTab] = useState<BacktestTab>(() => {
    if (typeof window === 'undefined') return 'overview';
    try { return (localStorage.getItem(TAB_CACHE_KEY) as BacktestTab) || 'overview'; } catch { return 'overview'; }
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResultV2 | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const cached = localStorage.getItem(RESULT_CACHE_KEY);
      return cached ? JSON.parse(cached) : null;
    } catch { return null; }
  });

  // 配置
  const [stockCode, setStockCode] = useState('000001.SZ');
  const [strategyType, setStrategyType] = useState<StrategyType>('macd');
  const [startDate, setStartDate] = useState('2025-01-01');
  const [endDate, setEndDate] = useState('2025-12-31');
  const [initialCash, setInitialCash] = useState(1000000);
  const [benchmark, setBenchmark] = useState('000001.SH');
  const [stopLoss, setStopLoss] = useState(7);
  const [takeProfit, setTakeProfit] = useState(15);

  // ==================== 持久化：恢复上次回测参数 ====================
  useEffect(() => {
    const userId = getQuantUserIdQuick();
    if (!userId) return;
    try {
      const saved = localStorage.getItem(`backtest_last_${userId}`);
      if (!saved) return;
      const p = JSON.parse(saved);
      if (p.stockCode) setStockCode(p.stockCode);
      if (p.strategyType) setStrategyType(p.strategyType);
      if (p.startDate) setStartDate(p.startDate);
      if (p.endDate) setEndDate(p.endDate);
      if (p.initialCash) setInitialCash(p.initialCash);
      if (p.benchmark) setBenchmark(p.benchmark);
      if (p.stopLoss != null) setStopLoss(p.stopLoss);
      if (p.takeProfit != null) setTakeProfit(p.takeProfit);
    } catch { /* ignore */ }
  }, []);

  const handleRun = useCallback(async () => {
    setLoading(true);
    setResult(null);
    try {
      const { runEnhancedBacktest } = await import('@/lib/quant');
      const res = await runEnhancedBacktest(
        stockCode, strategyType, startDate, endDate, initialCash, benchmark
      );
      setResult(res);
      try { localStorage.setItem(RESULT_CACHE_KEY, JSON.stringify(res)); } catch { /* ignore */ }

      // 持久化回测参数
      const userId = getQuantUserIdQuick();
      if (userId) {
        try {
          localStorage.setItem(`backtest_last_${userId}`, JSON.stringify({
            stockCode, strategyType, startDate, endDate,
            initialCash, benchmark, stopLoss, takeProfit,
          }));
        } catch { /* ignore */ }
      }

      // 通知策略管理面板：回测结果已就绪
      try {
        localStorage.setItem('pendingBacktestResult', JSON.stringify({
          strategyType,
          stockCode,
          result: {
            totalReturn: res.totalReturn,
            winRate: res.winRate,
            totalTrades: res.totalTrades,
            annualReturn: res.annualReturn,
            maxDrawdown: res.maxDrawdown,
            sharpeRatio: res.sharpeRatio,
          }
        }));
      } catch { /* storage full or unavailable */ }
    } catch (e) {
      console.error('[BacktestPanel]', e);
    } finally {
      setLoading(false);
    }
  }, [stockCode, strategyType, startDate, endDate, initialCash, benchmark, stopLoss, takeProfit]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
      <h2 className="text-xl font-bold text-white mb-4">回测系统</h2>

      {/* 配置区 */}
      <ConfigPanel
        stockCode={stockCode} setStockCode={setStockCode}
        strategyType={strategyType} setStrategyType={setStrategyType}
        startDate={startDate} setStartDate={setStartDate}
        endDate={endDate} setEndDate={setEndDate}
        initialCash={initialCash} setInitialCash={setInitialCash}
        benchmark={benchmark} setBenchmark={setBenchmark}
        stopLoss={stopLoss} setStopLoss={setStopLoss}
        takeProfit={takeProfit} setTakeProfit={setTakeProfit}
        onRun={handleRun} loading={loading}
      />

      {result && (
        <>
          {/* 子Tab */}
          <div className="flex gap-1 bg-slate-700 rounded-lg p-1 mt-6 mb-4 w-fit">
            {([
              { id: 'overview' as BacktestTab, label: '📊 指标概览' },
              { id: 'trades' as BacktestTab, label: '📋 交易记录' },
              { id: 'analysis' as BacktestTab, label: '📈 绩效分析' },
            ]).map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); try { localStorage.setItem(TAB_CACHE_KEY, t.id); } catch { /* ignore */ } }}
                className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                  tab === t.id ? 'bg-blue-600 text-white shadow' : 'text-slate-300 hover:text-white'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && <OverviewTab result={result} />}
          {tab === 'trades' && <TradesTab trades={result.tradeDetails} />}
          {tab === 'analysis' && <AnalysisTab result={result} />}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// 配置区
// ─────────────────────────────────────────

function ConfigPanel({
  stockCode, setStockCode, strategyType, setStrategyType,
  startDate, setStartDate, endDate, setEndDate,
  initialCash, setInitialCash, benchmark, setBenchmark,
  stopLoss, setStopLoss, takeProfit, setTakeProfit,
  onRun, loading,
}: {
  stockCode: string; setStockCode: (v: string) => void;
  strategyType: StrategyType; setStrategyType: (v: StrategyType) => void;
  startDate: string; setStartDate: (v: string) => void;
  endDate: string; setEndDate: (v: string) => void;
  initialCash: number; setInitialCash: (v: number) => void;
  benchmark: string; setBenchmark: (v: string) => void;
  stopLoss: number; setStopLoss: (v: number) => void;
  takeProfit: number; setTakeProfit: (v: number) => void;
  onRun: () => void; loading: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Field label="股票代码">
          <StockCodeInput
            value={stockCode}
            onChange={setStockCode}
            placeholder="000001.SZ"
            inputClassName="w-full"
          />
          <ImportFromWatchlist onImport={code => setStockCode(code)} />
        </Field>
        <Field label="策略">
          <select value={strategyType} onChange={e => setStrategyType(e.target.value as StrategyType)}
            className="w-full bg-slate-800 border border-slate-600 text-white rounded px-3 py-2 text-sm">
            <optgroup label="单策略">
              <option value="macd">MACD策略</option>
              <option value="bollinger">布林带策略</option>
              <option value="rsi">RSI策略</option>
              <option value="kdj">KDJ策略</option>
              <option value="ma">均线策略</option>
              <option value="cci">CCI策略</option>
              <option value="obv">OBV策略</option>
              <option value="adx">ADX策略</option>
            </optgroup>
            <optgroup label="组合策略">
              <option value="voting">并联投票组合</option>
              <option value="filter">串联过滤组合</option>
              <option value="weighted">加权融合组合</option>
              <option value="dynamic">动态切换组合</option>
            </optgroup>
          </select>
        </Field>
        <Field label="开始日期">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 text-white rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="结束日期">
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 text-white rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="初始资金">
          <input type="number" value={initialCash} onChange={e => setInitialCash(Number(e.target.value))}
            className="w-full bg-slate-800 border border-slate-600 text-white rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="基准">
          <select value={benchmark} onChange={e => setBenchmark(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 text-white rounded px-3 py-2 text-sm">
            <option value="000001.SH">上证指数</option>
            <option value="399001.SZ">深证成指</option>
            <option value="399006.SZ">创业板指</option>
            <option value="000688.SH">科创50</option>
            <option value="000300.SH">沪深300</option>
            <option value="000016.SH">上证50</option>
          </select>
        </Field>
        <Field label="止损(%)">
          <input type="number" value={stopLoss} onChange={e => setStopLoss(Number(e.target.value))}
            className="w-full bg-slate-800 border border-slate-600 text-white rounded px-3 py-2 text-sm" step="0.5" />
        </Field>
        <Field label="止盈(%)">
          <input type="number" value={takeProfit} onChange={e => setTakeProfit(Number(e.target.value))}
            className="w-full bg-slate-800 border border-slate-600 text-white rounded px-3 py-2 text-sm" step="0.5" />
        </Field>
      </div>

      <button onClick={onRun} disabled={loading}
        className="bg-blue-600 text-white px-8 py-2.5 rounded font-medium hover:bg-blue-700 disabled:opacity-50">
        {loading ? '回测中...' : '运行回测'}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────
// P3: Pipeline 批量回测
// ─────────────────────────────────────────

function PipelineBatchRunner({
  strategyType, startDate, endDate, initialCash, benchmark, stopLoss, takeProfit,
}: {
  strategyType: StrategyType; startDate: string; endDate: string;
  initialCash: number; benchmark: string; stopLoss: number; takeProfit: number;
}) {
  const [open, setOpen] = useState(false);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [selectedRebalanceIdx, setSelectedRebalanceIdx] = useState<number | null>(null);
  const [batchResults, setBatchResults] = useState<{ code: string; totalReturn: number; annualReturn: number; winRate: number }[] | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const results = usePipelineStore(s => s.results);

  const selectedResult = results.find(r => r.id === selectedResultId) ?? null;
  const selectedRebalance = selectedResult && selectedRebalanceIdx !== null
    ? selectedResult.rebalanceLog[selectedRebalanceIdx] ?? null
    : null;

  const handleRunBatch = async () => {
    if (!selectedResult || selectedRebalanceIdx === null) return;
    const holdings = selectedResult.rebalanceLog[selectedRebalanceIdx]?.holdings ?? [];
    if (holdings.length === 0) return;

    setBatchLoading(true);
    setBatchResults(null);
    try {
      const { runEnhancedBacktest } = await import('@/lib/quant');
      const runs = await Promise.all(
        holdings.map(h =>
          runEnhancedBacktest(h.code, strategyType, startDate, endDate, initialCash, benchmark)
            .then(r => ({ code: h.code, totalReturn: r.totalReturn, annualReturn: r.annualReturn, winRate: r.winRate }))
            .catch(() => null)
        )
      );
      setBatchResults(runs.filter(Boolean) as { code: string; totalReturn: number; annualReturn: number; winRate: number }[]);
    } finally {
      setBatchLoading(false);
    }
  };

  return (
    <div className="mt-4 border border-slate-600 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-slate-300">
          <span className="text-yellow-400 font-medium">📦 Pipeline 批量回测</span>
          <span className="text-slate-500 ml-2">— 对组合某期持仓批量跑策略回测</span>
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded"
        >
          {open ? '收起' : '展开'}
        </button>
      </div>

      {open && (
        <div className="space-y-3">
          {/* 组合选择 */}
          {results.length === 0 ? (
            <div className="text-xs text-slate-500 py-2">暂无 Pipeline 组合，请先在「多因子组合」中运行回测</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {results.map(r => (
                <button
                  key={r.id}
                  onClick={() => { setSelectedResultId(r.id); setSelectedRebalanceIdx(null); setBatchResults(null); }}
                  className={`text-left px-3 py-2 rounded border text-xs ${
                    selectedResultId === r.id
                      ? 'bg-blue-900 border-blue-500 text-blue-200'
                      : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <div className="font-medium truncate">{r.name}</div>
                  <div className="text-slate-500 mt-0.5">
                    {r.startDate}~{r.endDate} · 年化{(r.annualReturn * 100).toFixed(1)}%
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* 调仓期选择 */}
          {selectedResult && (
            <div>
              <div className="text-xs text-slate-400 mb-1">选择调仓期：</div>
              <div className="flex flex-wrap gap-1">
                {selectedResult.rebalanceLog.map((rb, idx) => (
                  <button
                    key={idx}
                    onClick={() => { setSelectedRebalanceIdx(idx); setBatchResults(null); }}
                    className={`text-xs px-2 py-1 rounded ${
                      selectedRebalanceIdx === idx
                        ? 'bg-green-700 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    {rb.date} ({rb.holdings.length}股)
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 持仓预览 */}
          {selectedRebalance && (
            <div>
              <div className="text-xs text-slate-400 mb-1">持仓明细：</div>
              <div className="bg-slate-800 rounded border border-slate-700 p-2">
                <div className="grid grid-cols-4 gap-1 text-xs text-slate-400 mb-1">
                  <span>代码</span><span>权重</span><span>区间收益</span><span>年化</span>
                </div>
                {selectedRebalance.holdings.map(h => {
                  const br = batchResults?.find(b => b.code === h.code);
                  return (
                    <div key={h.code} className="grid grid-cols-4 gap-1 text-xs py-0.5">
                      <span className="font-mono text-blue-400">{h.code}</span>
                      <span className="text-slate-300">{(h.weight * 100).toFixed(1)}%</span>
                      <span className={br ? (br.totalReturn >= 0 ? 'text-green-400' : 'text-red-400') : 'text-slate-500'}>
                        {br ? `${br.totalReturn >= 0 ? '+' : ''}${(br.totalReturn * 100).toFixed(1)}%` : '—'}
                      </span>
                      <span className={br ? (br.annualReturn >= 0 ? 'text-green-400' : 'text-red-400') : 'text-slate-500'}>
                        {br ? `${br.annualReturn >= 0 ? '+' : ''}${(br.annualReturn * 100).toFixed(1)}%` : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 汇总 */}
          {batchResults && batchResults.length > 0 && (
            <div className="bg-slate-800 rounded border border-slate-700 p-3">
              <div className="text-xs text-slate-400 mb-2">批量回测汇总</div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="bg-slate-900 rounded p-2 text-center">
                  <div className="text-slate-400">平均年化</div>
                  <div className={`font-bold text-lg ${batchResults.reduce((s, r) => s + r.annualReturn, 0) / batchResults.length >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {((batchResults.reduce((s, r) => s + r.annualReturn, 0) / batchResults.length) * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="bg-slate-900 rounded p-2 text-center">
                  <div className="text-slate-400">盈利股数</div>
                  <div className="font-bold text-lg text-green-400">
                    {batchResults.filter(r => r.totalReturn > 0).length}/{batchResults.length}
                  </div>
                </div>
                <div className="bg-slate-900 rounded p-2 text-center">
                  <div className="text-slate-400">平均胜率</div>
                  <div className="font-bold text-lg text-blue-400">
                    {((batchResults.reduce((s, r) => s + r.winRate, 0) / batchResults.length) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 运行按钮 */}
          {selectedRebalance && (
            <button
              onClick={handleRunBatch}
              disabled={batchLoading}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded"
            >
              {batchLoading ? '回测中...' : `批量回测 ${selectedRebalance.holdings.length} 只持仓股`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Tab 1: 指标概览
// ─────────────────────────────────────────

function OverviewTab({ result }: { result: BacktestResultV2 }) {
  const equityOption = useMemo(() => buildEquityOption(result), [result]);
  const drawdownOption = useMemo(() => buildDrawdownOption(result), [result]);

  const metrics = [
    { label: '总收益率', value: fmtPct(result.totalReturn), positive: result.totalReturn >= 0, large: true },
    { label: '年化收益率', value: fmtPct(result.annualReturn), positive: result.annualReturn >= 0, large: true },
    { label: '最大回撤', value: fmtPct(-result.maxDrawdown), positive: false, large: false },
    { label: '夏普比率', value: result.sharpeRatio.toFixed(2), positive: result.sharpeRatio >= 1, large: false },
    { label: 'Sortino比率', value: result.sortinoRatio.toFixed(2), positive: result.sortinoRatio >= 1, large: false },
    { label: 'Calmar比率', value: result.calmarRatio.toFixed(2), positive: result.calmarRatio >= 1, large: false },
    { label: 'Alpha', value: fmtPct(result.alpha), positive: result.alpha >= 0, large: false },
    { label: 'Beta', value: result.beta.toFixed(2), positive: result.beta <= 1 && result.beta >= 0, large: false },
    { label: '年化波动率', value: fmtPct(result.annualVolatility), positive: false, large: false },
    { label: '胜率', value: fmtPct(result.winRate), positive: result.winRate >= 0.5, large: false },
    { label: '盈亏比', value: result.profitLossRatio.toFixed(2), positive: result.profitLossRatio >= 1, large: false },
    { label: '累计手续费', value: `¥${result.totalCommission.toFixed(0)}`, positive: false, large: false },
    { label: '总交易次数', value: result.totalTrades.toString(), positive: true, large: false },
    { label: '平均持仓天数', value: `${result.avgHoldingDays.toFixed(1)}天`, positive: true, large: false },
    { label: '最大连续盈利', value: `${result.maxConsecutiveWin}次`, positive: true, large: false },
    { label: '最大连续亏损', value: `${result.maxConsecutiveLoss}次`, positive: false, large: false },
  ];

  return (
    <div>
      {/* 指标网格 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mb-6">
        {metrics.map((m, i) => (
          <div key={i} className={`bg-slate-800 border border-slate-700 rounded-xl p-3 ${m.large ? 'ring-2 ring-blue-500' : ''}`}>
            <div className="text-xs text-slate-400 mb-1">{m.label}</div>
            <div className={`font-bold ${m.large ? 'text-xl' : 'text-base'} ${m.positive ? 'text-green-400' : 'text-red-400'}`}>
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {/* 权益曲线 */}
      <div className="mb-6">
        <h3 className="font-semibold text-white mb-2">权益曲线</h3>
        <div className="bg-slate-800 border border-slate-700 rounded p-2" style={{ height: 300 }}>
          <ReactECharts option={equityOption} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} />
        </div>
      </div>

      {/* 回撤图 */}
      <div>
        <h3 className="font-semibold text-white mb-2">回撤曲线</h3>
        <div className="bg-slate-800 border border-slate-700 rounded p-2" style={{ height: 220 }}>
          <ReactECharts option={drawdownOption} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Tab 2: 交易记录
// ─────────────────────────────────────────

function TradesTab({ trades }: { trades: TradeDetail[] }) {
  const [page, setPage] = useState(1);
  const [filterCode, setFilterCode] = useState('');
  const [filterDir, setFilterDir] = useState<'all' | 'long' | 'short'>('all');
  const [sortField, setSortField] = useState<'date' | 'pnl' | 'holdingDays'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const pageSize = 20;

  const filtered = useMemo(() => {
    let r = [...trades];
    if (filterCode) r = r.filter(t => t.code.toLowerCase().includes(filterCode.toLowerCase()));
    if (filterDir !== 'all') r = r.filter(t => t.direction === filterDir);
    r.sort((a, b) => {
      let av = 0, bv = 0;
      if (sortField === 'date') { av = a.timestamp; bv = b.timestamp; }
      else if (sortField === 'pnl') { av = a.pnl; bv = b.pnl; }
      else if (sortField === 'holdingDays') { av = a.holdingDays; bv = b.holdingDays; }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return r;
  }, [trades, filterCode, filterDir, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const sortIcon = (f: typeof sortField) =>
    sortField !== f ? '⇅' : sortDir === 'asc' ? '↑' : '↓';

  return (
    <div>
      {/* 过滤栏 */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input type="text" value={filterCode} onChange={e => { setFilterCode(e.target.value); setPage(1); }}
          placeholder="过滤代码..." className="bg-slate-800 border border-slate-600 text-white rounded px-3 py-1.5 text-sm w-36" />
        <select value={filterDir} onChange={e => { setFilterDir(e.target.value as typeof filterDir); setPage(1); }}
          className="bg-slate-800 border border-slate-600 text-white rounded px-3 py-1.5 text-sm">
          <option value="all">全部方向</option>
          <option value="long">买入</option>
          <option value="short">卖出</option>
        </select>
        <span className="text-sm text-slate-300 self-center ml-auto">
          共 <span className="font-semibold text-white">{filtered.length}</span> 条
        </span>
      </div>

      {/* 表格 */}
      <div className="bg-slate-800 border border-slate-700 rounded overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-slate-700">
            <tr>
              <th className="px-3 py-2 text-left text-slate-200 font-semibold whitespace-nowrap cursor-pointer select-none hover:bg-slate-600"
                onClick={() => handleSort('date')}>日期 {sortIcon('date')}</th>
              <th className="px-3 py-2 text-left text-slate-200 font-semibold whitespace-nowrap">代码</th>
              <th className="px-3 py-2 text-left text-slate-200 font-semibold whitespace-nowrap">方向</th>
              <th className="px-3 py-2 text-right text-slate-200 font-semibold whitespace-nowrap">价格</th>
              <th className="px-3 py-2 text-right text-slate-200 font-semibold whitespace-nowrap">数量</th>
              <th className="px-3 py-2 text-right text-slate-200 font-semibold whitespace-nowrap">金额</th>
              <th className="px-3 py-2 text-right text-slate-200 font-semibold whitespace-nowrap">手续费</th>
              <th className="px-3 py-2 text-right text-slate-200 font-semibold whitespace-nowrap cursor-pointer select-none hover:bg-slate-600"
                onClick={() => handleSort('pnl')}>盈亏 {sortIcon('pnl')}</th>
              <th className="px-3 py-2 text-right text-slate-200 font-semibold whitespace-nowrap">累计盈亏</th>
              <th className="px-3 py-2 text-right text-slate-200 font-semibold whitespace-nowrap cursor-pointer select-none hover:bg-slate-600"
                onClick={() => handleSort('holdingDays')}>持仓天数 {sortIcon('holdingDays')}</th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr><td className="px-3 py-8 text-center text-slate-400" colSpan={10}>暂无交易记录</td></tr>
            ) : paginated.map((t, i) => (
              <tr key={i} className="border-t border-slate-700 hover:bg-slate-700/50">
                <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{t.date}</td>
                <td className="px-3 py-2 text-white font-medium whitespace-nowrap">{t.code}</td>
                <td className={`px-3 py-2 font-semibold whitespace-nowrap ${t.direction === 'long' ? 'text-red-400' : 'text-green-400'}`}>
                  {t.direction === 'long' ? '买入' : '卖出'}
                </td>
                <td className="px-3 py-2 text-right text-slate-300 whitespace-nowrap">{t.price.toFixed(2)}</td>
                <td className="px-3 py-2 text-right text-slate-300 whitespace-nowrap">{t.volume}</td>
                <td className="px-3 py-2 text-right text-slate-300 whitespace-nowrap">¥{(t.price * t.volume).toFixed(0)}</td>
                <td className="px-3 py-2 text-right text-slate-300 whitespace-nowrap">¥{t.commission.toFixed(2)}</td>
                <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${t.pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}
                </td>
                <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${t.cumulativePnL >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {t.cumulativePnL >= 0 ? '+' : ''}{t.cumulativePnL.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right text-slate-300 whitespace-nowrap">{t.holdingDays}天</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => setPage(1)} disabled={page === 1}
            className="px-3 py-1 border border-slate-600 bg-slate-800 text-slate-300 rounded text-sm hover:bg-slate-700 disabled:opacity-40">首页</button>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1 border border-slate-600 bg-slate-800 text-slate-300 rounded text-sm hover:bg-slate-700 disabled:opacity-40">上一页</button>
          <span className="px-3 py-1 text-sm text-slate-300">第 {page} / {totalPages} 页</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1 border border-slate-600 bg-slate-800 text-slate-300 rounded text-sm hover:bg-slate-700 disabled:opacity-40">下一页</button>
          <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
            className="px-3 py-1 border border-slate-600 bg-slate-800 text-slate-300 rounded text-sm hover:bg-slate-700 disabled:opacity-40">末页</button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Tab 3: 绩效分析
// ─────────────────────────────────────────

function AnalysisTab({ result }: { result: BacktestResultV2 }) {
  const heatmapOption = useMemo(() => buildHeatmapOption(result), [result]);
  const scatterOption = useMemo(() => buildScatterOption(result), [result]);

  return (
    <div>
      {/* 月度收益热力图 */}
      <div className="mb-6">
        <h3 className="font-semibold text-white mb-2">月度收益热力图</h3>
        <div className="bg-slate-800 border border-slate-700 rounded p-2" style={{ height: 260 }}>
          <ReactECharts option={heatmapOption} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} />
        </div>
      </div>

      {/* 交易分布散点图 */}
      <div className="mb-6">
        <h3 className="font-semibold text-white mb-2">交易盈亏分布</h3>
        <div className="bg-slate-800 border border-slate-700 rounded p-2" style={{ height: 260 }}>
          <ReactECharts option={scatterOption} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} />
        </div>
      </div>

      {/* 相对收益曲线 */}
      {result.benchmarkReturn !== 0 && (
        <div className="mb-6">
          <h3 className="font-semibold text-white mb-2">策略 vs 基准 累计收益对比</h3>
          <div className="bg-slate-800 border border-slate-700 rounded p-2" style={{ height: 260 }}>
            <ReactECharts option={buildCompareOption(result)} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} />
          </div>
        </div>
      )}

      {/* 月度收益明细表 */}
      <div className="bg-slate-800 border border-slate-700 rounded overflow-x-auto">
        <div className="px-4 py-2 border-b border-slate-700 bg-slate-700/50">
          <h3 className="font-semibold text-white">月度收益明细</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-700">
            <tr>
              <th className="px-4 py-2 text-left text-slate-200 font-semibold">月份</th>
              <th className="px-4 py-2 text-right text-slate-200 font-semibold">月收益率</th>
              <th className="px-4 py-2 text-right text-slate-200 font-semibold">累计收益率</th>
              <th className="px-4 py-2 text-right text-slate-200 font-semibold">交易日数</th>
              <th className="px-4 py-2 text-right text-slate-200 font-semibold">交易次数</th>
            </tr>
          </thead>
          <tbody>
            {result.monthlyReturns.length === 0 ? (
              <tr><td className="px-4 py-6 text-center text-slate-400" colSpan={5}>暂无数据</td></tr>
            ) : result.monthlyReturns.map((m, i) => (
              <tr key={i} className="border-t border-slate-700 hover:bg-slate-700/50">
                <td className="px-4 py-2 text-white font-medium">{m.year}-{String(m.month).padStart(2, '0')}</td>
                <td className={`px-4 py-2 text-right font-semibold ${m.return >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {m.return >= 0 ? '+' : ''}{(m.return * 100).toFixed(2)}%
                </td>
                <td className={`px-4 py-2 text-right ${m.cumulativeReturn >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {m.cumulativeReturn >= 0 ? '+' : ''}{(m.cumulativeReturn * 100).toFixed(2)}%
                </td>
                <td className="px-4 py-2 text-right text-slate-300">{m.tradingDays}</td>
                <td className="px-4 py-2 text-right text-slate-300">{m.trades}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// ECharts 图表构建函数
// ─────────────────────────────────────────

function buildEquityOption(result: BacktestResultV2) {
  const dates = result.equityCurveWithDate.map(p => p.date);
  const equity = result.equityCurveWithDate.map(p => p.equity);
  // 基准归一化到初始资金
  const benchmark = result.benchmarkReturn !== undefined && result.benchmarkReturn !== 0
    ? (() => {
        const initEquity = result.config.initialCash;
        const benchPct = result.benchmarkReturn;
        return result.equityCurveWithDate.map((_, i) => {
          const t = i / (dates.length - 1 || 1);
          return initEquity * (1 + benchPct * t);
        });
      })()
    : null;

  const series = [
    {
      name: '策略权益',
      type: 'line' as const,
      data: equity,
      smooth: true,
      lineStyle: { color: '#3b82f6', width: 2 },
      itemStyle: { color: '#3b82f6' },
      areaStyle: {
        color: {
          type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(59,130,246,0.25)' },
            { offset: 1, color: 'rgba(59,130,246,0.02)' },
          ],
        },
      },
      tooltip: { formatter: (p: any) => `${p.name}<br/>策略: ¥${p.value.toFixed(0)}` },
    },
  ];

  if (benchmark) {
    series.push({
      name: '基准',
      type: 'line' as const,
      data: benchmark,
      smooth: true,
      lineStyle: { color: '#f59e0b', width: 1.5, type: 'dashed' as const },
      itemStyle: { color: '#f59e0b' },
      tooltip: { formatter: (p: any) => `基准: ¥${p.value.toFixed(0)}` },
    } as any);
  }

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'cross' as const, crossStyle: { color: '#999' } },
      formatter: (params: any[]) => {
        const date = params[0]?.name || '';
        let html = `<b>${date}</b><br/>`;
        for (const p of params) {
          html += `${p.marker} ${p.seriesName}: <b>¥${(p.value as number).toFixed(0)}</b><br/>`;
        }
        return html;
      },
    },
    legend: { data: ['策略权益', ...(benchmark ? ['基准'] : [])], top: 4, textStyle: { fontSize: 11 } },
    grid: { top: 32, bottom: 32, left: 64, right: 32 },
    xAxis: {
      type: 'category' as const, data: dates,
      boundaryGap: false, axisLabel: { fontSize: 10, rotate: 30 },
      axisLine: { lineStyle: { color: '#ddd' } },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { fontSize: 10, formatter: (v: number) => `¥${(v / 10000).toFixed(0)}万` },
      splitLine: { lineStyle: { color: '#f0f0f0' } },
    },
    dataZoom: [
      { type: 'inside' as const, start: 0, end: 100 },
      { type: 'slider' as const, start: 0, end: 100, height: 18, bottom: 0 },
    ],
    series,
  };
}

function buildDrawdownOption(result: BacktestResultV2) {
  const dates = result.drawdownCurve.map(p => {
    const d = new Date(p.timestamp);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
  const ddPct = result.drawdownCurve.map(p => (p.drawdown * 100));
  const ddAmt = result.drawdownCurve.map(p => -p.drawdownAmount);

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'line' as const },
      formatter: (params: any[]) => {
        const p = params[0];
        return `<b>${p.name}</b><br/>回撤: <b style="color:#ef4444">${(p.value as number).toFixed(2)}%</b><br/>金额: <b style="color:#ef4444">¥${ddAmt[p.dataIndex]?.toFixed(0)}</b>`;
      },
    },
    grid: { top: 16, bottom: 40, left: 56, right: 24 },
    xAxis: {
      type: 'category' as const, data: dates,
      boundaryGap: false, axisLabel: { fontSize: 10, rotate: 30 },
      axisLine: { lineStyle: { color: '#ddd' } },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { fontSize: 10, formatter: (v: number) => `${v.toFixed(1)}%` },
      splitLine: { lineStyle: { color: '#f0f0f0' } },
    },
    dataZoom: [
      { type: 'inside' as const, start: 0, end: 100 },
      { type: 'slider' as const, start: 0, end: 100, height: 18, bottom: 0 },
    ],
    series: [{
      name: '回撤',
      type: 'line' as const,
      data: ddPct,
      smooth: true,
      lineStyle: { color: '#ef4444', width: 1.5 },
      itemStyle: { color: '#ef4444' },
      areaStyle: {
        color: {
          type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(239,68,68,0.2)' },
            { offset: 1, color: 'rgba(239,68,68,0)' },
          ],
        },
      },
      markLine: {
        silent: true,
        symbol: 'none',
        data: [{ type: 'max' as const, name: '最大回撤' }],
        label: { formatter: `最大回撤: ${(result.maxDrawdown * 100).toFixed(1)}%`, position: 'end' as const, fontSize: 11 },
        lineStyle: { color: '#ef4444', type: 'dashed' as const },
      },
    }],
  };
}

function buildHeatmapOption(result: BacktestResultV2) {
  // 按年份 x=月份(1-12), y=年份 排列
  const years = [...new Set(result.monthlyReturns.map(m => m.year))].sort();
  const data: [number, number, number][] = []; // [month-1, yearIndex, return*100]

  const maxAbs = Math.max(...result.monthlyReturns.map(m => Math.abs(m.return))) * 100 || 5;

  for (const m of result.monthlyReturns) {
    const yi = years.indexOf(m.year);
    data.push([m.month - 1, yi, (m.return * 100)]);
  }

  return {
    backgroundColor: 'transparent',
    tooltip: {
      formatter: (p: any) => {
        const y = years[p.data[1]];
        const m = p.data[0] + 1;
        return `<b>${y}年${m}月</b><br/>收益率: <b style="color:${p.data[2] >= 0 ? '#ef4444' : '#22c55e'}">${p.data[2] >= 0 ? '+' : ''}${p.data[2].toFixed(2)}%</b>`;
      },
    },
    grid: { top: 16, bottom: 48, left: 56, right: 24 },
    xAxis: {
      type: 'category' as const, data: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
      axisLabel: { fontSize: 10 }, axisLine: { lineStyle: { color: '#ddd' } },
      splitArea: { show: true, interval: 0 },
    },
    yAxis: {
      type: 'category' as const, data: years.map(String),
      axisLabel: { fontSize: 10 }, axisLine: { lineStyle: { color: '#ddd' } },
      splitArea: { show: true, interval: 0 },
    },
    visualMap: {
      min: -maxAbs, max: maxAbs,
      calculable: true, orient: 'horizontal' as const, left: 'center', bottom: 0,
      inRange: {
        color: ['#22c55e', '#86efac', '#fafafa', '#fca5a5', '#dc2626'],
      },
      formatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`,
      textStyle: { fontSize: 10 },
    },
    series: [{
      name: '月度收益',
      type: 'heatmap' as const,
      data,
      label: { show: true, fontSize: 9, formatter: (p: any) => `${(p.data[2] as number).toFixed(1)}%` },
      itemStyle: { borderWidth: 2, borderColor: '#fff', borderRadius: 2 },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' } },
    }],
  };
}

function buildScatterOption(result: BacktestResultV2) {
  // 仅卖出交易有盈亏
  const sells = result.tradeDetails.filter(t => t.direction === 'short');
  const buyData = result.tradeDetails.filter(t => t.direction === 'long').map((t, i) => [i, 0, t]);
  const sellData = sells.map((t, i) => [i, t.pnl, t]);

  const maxAbs = Math.max(...sells.map(t => Math.abs(t.pnl)), 1);

  return {
    backgroundColor: 'transparent',
    tooltip: {
      formatter: (p: any) => {
        const t: TradeDetail = p.data[2];
        return `<b>${t.date} ${t.code}</b><br/>方向: ${t.direction === 'long' ? '买入' : '卖出'}<br/>价格: ¥${t.price.toFixed(2)}<br/>盈亏: <b style="color:${t.pnl >= 0 ? '#ef4444' : '#22c55e'}">${t.pnl >= 0 ? '+' : ''}¥${t.pnl.toFixed(0)}</b><br/>持仓: ${t.holdingDays}天`;
      },
    },
    grid: { top: 16, bottom: 32, left: 64, right: 24 },
    xAxis: { type: 'value' as const, axisLabel: { fontSize: 10 }, axisLine: { lineStyle: { color: '#ddd' } }, splitLine: { lineStyle: { color: '#f0f0f0' } } },
    yAxis: { type: 'value' as const, axisLabel: { fontSize: 10, formatter: (v: number) => `¥${(v/1000).toFixed(0)}k` }, axisLine: { lineStyle: { color: '#ddd' } }, splitLine: { lineStyle: { color: '#f0f0f0' } } },
    series: [
      {
        name: '买入', type: 'scatter' as const, symbolSize: 8,
        data: buyData, itemStyle: { color: '#f87171', opacity: 0.6 },
      },
      {
        name: '卖出', type: 'scatter' as const, symbolSize: (v: number[]) => Math.max(6, Math.min(24, Math.abs(v[1]) / maxAbs * 16)),
        data: sellData,
        itemStyle: { color: (p: any) => p.data[1] >= 0 ? '#ef4444' : '#22c55e', opacity: 0.8 },
        markLine: { silent: true, symbol: 'none', data: [{ type: 'average' as const, name: '平均' }], label: { fontSize: 10 }, lineStyle: { color: '#888', type: 'dashed' as const } },
      },
    ],
  };
}

function buildCompareOption(result: BacktestResultV2) {
  const init = result.config.initialCash;
  const strategyPct = result.equityCurveWithDate.map((p, i) => {
    const prevEquity = i === 0 ? init : result.equityCurveWithDate[i - 1].equity;
    return ((p.equity - prevEquity) / prevEquity) * 100;
  });
  const benchPct: number[] = [];
  for (let i = 1; i < result.equityCurveWithDate.length; i++) {
    const pct = result.benchmarkReturn / (result.equityCurveWithDate.length - 1 || 1);
    benchPct.push(pct * 100);
  }
  benchPct.unshift(0);
  const dates = result.equityCurveWithDate.map(p => p.date);

  let strategyCum = 0, benchCum = 0;
  const strategyCumPct: number[] = [];
  const benchCumPct: number[] = [];
  for (let i = 0; i < strategyPct.length; i++) {
    strategyCum += strategyPct[i] || 0;
    benchCum += benchPct[i] || 0;
    strategyCumPct.push(strategyCum);
    benchCumPct.push(benchCum);
  }

  return {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' as const, formatter: (params: any[]) => { const d = params[0]?.name; let html = `<b>${d}</b>`; for (const p of params) html += `<br/>${p.marker} ${p.seriesName}: <b>${(p.value as number) >= 0 ? '+' : ''}${(p.value as number).toFixed(2)}%</b>`; return html; } },
    legend: { data: ['策略累计收益', '基准累计收益'], top: 4, textStyle: { fontSize: 11 } },
    grid: { top: 32, bottom: 32, left: 56, right: 24 },
    xAxis: { type: 'category' as const, data: dates, boundaryGap: false, axisLabel: { fontSize: 10, rotate: 30 }, axisLine: { lineStyle: { color: '#ddd' } } },
    yAxis: { type: 'value' as const, axisLabel: { fontSize: 10, formatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` }, splitLine: { lineStyle: { color: '#f0f0f0' } } },
    dataZoom: [{ type: 'inside' as const, start: 0, end: 100 }, { type: 'slider' as const, start: 0, end: 100, height: 18, bottom: 0 }],
    series: [
      { name: '策略累计收益', type: 'line' as const, data: strategyCumPct, smooth: true, lineStyle: { color: '#3b82f6', width: 2 }, itemStyle: { color: '#3b82f6' } },
      { name: '基准累计收益', type: 'line' as const, data: benchCumPct, smooth: true, lineStyle: { color: '#f59e0b', width: 1.5, type: 'dashed' as const }, itemStyle: { color: '#f59e0b' } },
    ],
  };
}

// ─────────────────────────────────────────
// 从自选导入组件
// ─────────────────────────────────────────

function ImportFromWatchlist({ onImport }: { onImport: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [stockNames, setStockNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const watchlists = useWatchlistStore(s => s.watchlists);
  const isLoaded = useWatchlistStore(s => s.isLoaded);
  const activeId = useWatchlistStore(s => s.activeWatchlistId);
  const activeList = watchlists.find(w => w.id === activeId);
  const codes = activeList?.codes ?? [];

  // 下拉打开时，批量获取股票名称
  useEffect(() => {
    if (!open || codes.length === 0) return;
    // 已有缓存则跳过
    if (codes.every(c => stockNames[c])) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/stock/realtime?codes=${codes.join(',')}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const map: Record<string, string> = { ...stockNames };
        (data.data || []).forEach((item: { code: string; name: string }) => {
          if (item.code && item.name) map[item.code] = item.name;
        });
        setStockNames(map);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  if (!isLoaded) return null;

  return (
    <div className="relative mt-1">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
      >
        ⭐ 从自选导入
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50 w-64 max-h-48 overflow-y-auto">
          {loading ? (
            <div className="px-3 py-2 text-xs text-slate-500">加载中...</div>
          ) : codes.length > 0 ? (
            codes.map(code => (
              <button
                key={code}
                onClick={() => { onImport(code); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
              >
                <span className="font-mono text-xs text-blue-400 w-28 shrink-0">{code}</span>
                <span className="text-slate-300 truncate">{stockNames[code] || '...'}</span>
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-xs text-slate-500">自选股为空</div>
          )}
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
}
