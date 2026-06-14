'use client';

/**
 * Factor Analysis v2 Page
 *
 * 新一代多因子评分面板 — 与 v1 (factor-analysis) 并存
 *
 * 特性：
 * 1. 8 大类因子加权（估值/质量/动量/反转/资金流/技术/换手/WQ alpha）
 * 2. 截面百分位归一化 + MAD 去极值
 * 3. 行业 + 市值 OLS 中性化
 * 4. 共线性检测 + 报警
 * 5. IC 动态定权 + 失效检测
 * 6. v1 vs v2 对比视图
 * 7. ST/涨跌停/停牌/低流动性 过滤
 */

import { useState, useCallback, useEffect } from 'react';
import QuantNavbar from '@/components/quant/quant-navbar';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';

type V2Result = {
  code: string; name: string; price: number; changePercent: number; industry?: string;
  valuation: number; quality: number; momentum: number; reversal: number;
  moneyFlow: number; technical: number; turnover: number; wqAlpha: number;
  composite: number; rank: number;
  contributions: Record<string, number>;
  weights: Record<string, number>;
  flags: { isST: boolean; isLimitUp: boolean; isLimitDown: boolean; isSuspended: boolean; isNewShare: boolean; isLowLiquidity: boolean };
};

type CompareResult = {
  v1: { code: string; name: string; compositeScore: number; rank: number; isLimitUp: boolean }[];
  v2: V2Result[];
  overlap: { top10: number; top10Rate: number; top20: number; top20Rate: number };
  v1Bias: { avgChangePct: number; limitUpCount: number; stCount: number };
  v2Bias: { avgChangePct: number; limitUpCount: number; stCount: number };
  improvements: string[];
};

type Diagnostics = {
  percentileWarnings: string[];
  neutralizeWarnings: string[];
  collinearityWarnings: string[];
  collinearityPairs: { a: string; b: string; corr: number }[];
  filteredCount: number;
  originalCount: number;
  weightsUsed: Record<string, number>;
  weightSource: string;
};

const PILLAR_LABELS: Record<string, string> = {
  valuation: '估值',
  quality: '质量',
  momentum: '动量',
  reversal: '反转',
  moneyFlow: '资金流',
  technical: '技术面',
  turnover: '换手',
  wqAlpha: 'WQ Alpha',
};

const PILLAR_COLORS: Record<string, string> = {
  valuation: '#3b82f6', quality: '#10b981', momentum: '#f59e0b',
  reversal: '#ef4444', moneyFlow: '#8b5cf6', technical: '#06b6d4',
  turnover: '#84cc16', wqAlpha: '#ec4899',
};

export default function FactorAnalysisV2Page() {
  const [tab, setTab] = useState<'v2' | 'compare'>('v2');
  const [results, setResults] = useState<V2Result[]>([]);
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [filterFlags, setFilterFlags] = useState(true);
  const [neutralize, setNeutralize] = useState(true);
  const [weightMode, setWeightMode] = useState<'default' | 'ic' | 'manual'>('default');
  const [forwardPeriod, setForwardPeriod] = useState<5 | 20>(5);
  const [limit, setLimit] = useState(50);

  // ── 跑 v2 评分 ──────────────────────────────────
  const handleRunV2 = useCallback(async () => {
    setLoading(true);
    setError('');
    setProgress('正在拉取全市场数据...');
    try {
      const url = `/api/stock/factor-analysis-v2?action=scores&limit=${limit}&forwardPeriod=${forwardPeriod}&filterFlags=${filterFlags}&neutralize=${neutralize ? 'auto' : 'manual'}&weightMode=${weightMode}`;
      setProgress('正在计算 11 类因子（含 WQ 10 alpha + 真实资金流）...');
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '分析失败');
      setResults(json.results || []);
      setDiagnostics(json.diagnostics || null);
      setProgress(`✅ 完成（${json.count} 只票，耗时 ${json._ms || '?'}ms）`);
      setTimeout(() => setProgress(''), 3000);
    } catch (e: any) {
      setError(e.message || '失败');
      setProgress('');
    } finally {
      setLoading(false);
    }
  }, [limit, forwardPeriod, filterFlags, neutralize, weightMode]);

  // ── 跑 v1 vs v2 对比 ──────────────────────────────
  const handleRunCompare = useCallback(async () => {
    setLoading(true);
    setError('');
    setProgress('正在跑 v1 vs v2 全流程对比...');
    try {
      const url = `/api/stock/factor-analysis-v2?action=compare&limit=${limit}&forwardPeriod=${forwardPeriod}&filterFlags=${filterFlags}&neutralize=${neutralize ? 'auto' : 'manual'}&weightMode=${weightMode}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '对比失败');
      setCompare(json.compare || null);
      setProgress(`✅ 对比完成（${json.count} 只票，耗时 ${json._ms || '?'}ms）`);
      setTimeout(() => setProgress(''), 3000);
    } catch (e: any) {
      setError(e.message || '失败');
      setProgress('');
    } finally {
      setLoading(false);
    }
  }, [limit, forwardPeriod, filterFlags, neutralize, weightMode]);

  // 自动跑一次
  useEffect(() => { handleRunV2(); }, []);  // eslint-disable-line

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <QuantNavbar />
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <span className="text-3xl">🎯</span>
              <span>多因子分析 v2</span>
              <span className="text-xs px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded">新一代</span>
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              8 大类因子（估值/质量/动量/反转/资金流/技术/换手/WQ Alpha） + 截面百分位 + 行业/市值中性化 + IC 动态定权
            </p>
          </div>
          <a
            href="/quant/factor-analysis"
            className="text-sm text-slate-400 hover:text-slate-200 px-3 py-1.5 border border-slate-700 rounded-lg"
          >
            ← 旧版 v1
          </a>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setTab('v2')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'v2' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}`}
          >
            🎯 v2 评分
          </button>
          <button
            onClick={() => setTab('compare')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'compare' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}`}
          >
            ⚖️ v1 vs v2 对比
          </button>
        </div>

        {/* Controls */}
        <div className="bg-slate-900/60 rounded-xl p-4 mb-4 border border-slate-800">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
            <div>
              <label className="text-slate-400 block mb-1">数量</label>
              <select value={limit} onChange={e => setLimit(parseInt(e.target.value))} className="w-full bg-slate-800 px-2 py-1.5 rounded text-slate-100">
                <option value={30}>Top 30</option>
                <option value={50}>Top 50</option>
                <option value={100}>Top 100</option>
              </select>
            </div>
            <div>
              <label className="text-slate-400 block mb-1">调仓周期</label>
              <select value={forwardPeriod} onChange={e => setForwardPeriod(parseInt(e.target.value) as 5 | 20)} className="w-full bg-slate-800 px-2 py-1.5 rounded text-slate-100">
                <option value={5}>5 日</option>
                <option value={20}>20 日</option>
              </select>
            </div>
            <div>
              <label className="text-slate-400 block mb-1">权重模式</label>
              <select value={weightMode} onChange={e => setWeightMode(e.target.value as any)} className="w-full bg-slate-800 px-2 py-1.5 rounded text-slate-100">
                <option value="default">Barra 默认</option>
                <option value="ic">IC 动态</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-1.5 text-slate-300">
                <input type="checkbox" checked={neutralize} onChange={e => setNeutralize(e.target.checked)} className="accent-emerald-500" />
                中性化
              </label>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-1.5 text-slate-300">
                <input type="checkbox" checked={filterFlags} onChange={e => setFilterFlags(e.target.checked)} className="accent-emerald-500" />
                过滤异常
              </label>
            </div>
            <div className="flex items-end gap-2">
              {tab === 'v2' ? (
                <button onClick={handleRunV2} disabled={loading} className="w-full px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 rounded font-medium">
                  {loading ? '跑中...' : '⚡ 跑 v2'}
                </button>
              ) : (
                <button onClick={handleRunCompare} disabled={loading} className="w-full px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 rounded font-medium">
                  {loading ? '对比中...' : '⚖️ 跑对比'}
                </button>
              )}
            </div>
          </div>
          {progress && <div className="mt-3 text-sm text-emerald-400">{progress}</div>}
          {error && <div className="mt-3 text-sm text-red-400">{error}</div>}
        </div>

        {/* Diagnostics */}
        {diagnostics && (
          <div className="bg-slate-900/60 rounded-xl p-4 mb-4 border border-slate-800">
            <h3 className="text-sm font-medium text-slate-300 mb-2">📊 诊断信息</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="bg-slate-800/60 rounded p-2">
                <div className="text-slate-400">原始候选</div>
                <div className="text-lg font-bold text-slate-100">{diagnostics.originalCount}</div>
              </div>
              <div className="bg-slate-800/60 rounded p-2">
                <div className="text-slate-400">过滤掉</div>
                <div className="text-lg font-bold text-amber-400">{diagnostics.filteredCount}</div>
              </div>
              <div className="bg-slate-800/60 rounded p-2">
                <div className="text-slate-400">权重源</div>
                <div className="text-lg font-bold text-emerald-400">{diagnostics.weightSource}</div>
              </div>
              <div className="bg-slate-800/60 rounded p-2">
                <div className="text-slate-400">共线性对</div>
                <div className={`text-lg font-bold ${diagnostics.collinearityPairs.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {diagnostics.collinearityPairs.length}
                </div>
              </div>
            </div>
            {diagnostics.percentileWarnings.length > 0 && (
              <div className="mt-2 text-xs text-amber-400">
                {diagnostics.percentileWarnings.map((w, i) => <div key={i}>• {w}</div>)}
              </div>
            )}
            {diagnostics.collinearityWarnings.length > 0 && (
              <details className="mt-2 text-xs">
                <summary className="text-amber-400 cursor-pointer">⚠️ 共线性警告（{diagnostics.collinearityWarnings.length} 条）</summary>
                <div className="mt-1 text-slate-400 space-y-1">
                  {diagnostics.collinearityWarnings.map((w, i) => <div key={i}>• {w}</div>)}
                </div>
              </details>
            )}
          </div>
        )}

        {/* v2 评分 Tab */}
        {tab === 'v2' && results.length > 0 && (
          <V2Table results={results} />
        )}

        {/* 对比 Tab */}
        {tab === 'compare' && compare && (
          <CompareView compare={compare} />
        )}

        {/* Empty State */}
        {tab === 'v2' && results.length === 0 && !loading && (
          <div className="text-center text-slate-500 py-20">
            <div className="text-6xl mb-4">🎯</div>
            <div>点击「⚡ 跑 v2」开始分析</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── v2 结果表格 ─────────────────────────────────────
function V2Table({ results }: { results: V2Result[] }) {
  return (
    <div className="bg-slate-900/60 rounded-xl border border-slate-800 overflow-hidden">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <h3 className="font-medium text-slate-200">Top {results.length} 候选股票</h3>
        <span className="text-xs text-slate-400">8 大类加权综合分</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/40 text-xs text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">代码</th>
              <th className="px-3 py-2 text-left">名称</th>
              <th className="px-3 py-2 text-right">最新价</th>
              <th className="px-3 py-2 text-right">涨跌幅</th>
              <th className="px-3 py-2 text-right" title="估值 (PE/PB/PS 反向)">估值</th>
              <th className="px-3 py-2 text-right" title="质量 (ROE/毛利/负债)">质量</th>
              <th className="px-3 py-2 text-right" title="动量 (20日)">动量</th>
              <th className="px-3 py-2 text-right" title="反转 (RSI)">反转</th>
              <th className="px-3 py-2 text-right" title="资金流 (主力净流入)">资金流</th>
              <th className="px-3 py-2 text-right" title="技术 (MACD/KDJ/BOLL/ADX)">技术</th>
              <th className="px-3 py-2 text-right" title="换手 (适度区间)">换手</th>
              <th className="px-3 py-2 text-right" title="WQ 10 alpha">WQ</th>
              <th className="px-3 py-2 text-right">综合</th>
              <th className="px-3 py-2 text-center">标记</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={r.code} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                <td className="px-3 py-2 font-mono text-slate-300">{r.code.replace(/\D/g, '')}</td>
                <td className="px-3 py-2 text-slate-100">{r.name}</td>
                <td className="px-3 py-2 text-right text-slate-300 font-mono">{r.price.toFixed(2)}</td>
                <td className={`px-3 py-2 text-right font-mono ${r.changePercent >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {r.changePercent >= 0 ? '+' : ''}{r.changePercent.toFixed(2)}%
                </td>
                <td className="px-3 py-2 text-right font-mono text-blue-400">{r.valuation.toFixed(0)}</td>
                <td className="px-3 py-2 text-right font-mono text-emerald-400">{r.quality.toFixed(0)}</td>
                <td className="px-3 py-2 text-right font-mono text-amber-400">{r.momentum.toFixed(0)}</td>
                <td className="px-3 py-2 text-right font-mono text-red-400">{r.reversal.toFixed(0)}</td>
                <td className="px-3 py-2 text-right font-mono text-purple-400">{r.moneyFlow.toFixed(0)}</td>
                <td className="px-3 py-2 text-right font-mono text-cyan-400">{r.technical.toFixed(0)}</td>
                <td className="px-3 py-2 text-right font-mono text-lime-400">{r.turnover.toFixed(0)}</td>
                <td className="px-3 py-2 text-right font-mono text-pink-400">{r.wqAlpha.toFixed(0)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-white">{r.composite.toFixed(1)}</td>
                <td className="px-3 py-2 text-center text-xs">
                  {r.flags.isST && <span className="px-1 bg-red-500/20 text-red-400 rounded">ST</span>}
                  {r.flags.isLimitUp && <span className="px-1 bg-orange-500/20 text-orange-400 rounded">涨停</span>}
                  {r.flags.isLimitDown && <span className="px-1 bg-green-500/20 text-green-400 rounded">跌停</span>}
                  {r.flags.isNewShare && <span className="px-1 bg-blue-500/20 text-blue-400 rounded">次新</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 对比视图 ────────────────────────────────────────
function CompareView({ compare }: { compare: CompareResult }) {
  return (
    <div className="space-y-4">
      {/* 顶部统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CompareCard title="Top10 重合度" value={`${compare.overlap.top10}/10`} subtitle={`${(compare.overlap.top10Rate * 100).toFixed(0)}%`} highlight={compare.overlap.top10Rate < 0.6} />
        <CompareCard title="Top20 重合度" value={`${compare.overlap.top20}/20`} subtitle={`${(compare.overlap.top20Rate * 100).toFixed(0)}%`} />
        <CompareCard title="v1 偏差" value={`+${compare.v1Bias.avgChangePct.toFixed(1)}%`} subtitle="top10 平均涨幅" highlight={Math.abs(compare.v1Bias.avgChangePct) > 2} />
        <CompareCard title="v2 偏差" value={`${compare.v2Bias.avgChangePct >= 0 ? '+' : ''}${compare.v2Bias.avgChangePct.toFixed(1)}%`} subtitle="top10 平均涨幅" highlight={false} />
      </div>

      {/* 改进点 */}
      {compare.improvements.length > 0 && (
        <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-xl p-4">
          <h3 className="text-sm font-medium text-emerald-300 mb-2">🎉 v2 改进点</h3>
          <div className="space-y-1 text-sm text-emerald-200">
            {compare.improvements.map((s, i) => <div key={i}>• {s}</div>)}
          </div>
        </div>
      )}

      {/* Top10 对比 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-900/60 rounded-xl border border-slate-800 overflow-hidden">
          <div className="p-3 bg-red-500/10 border-b border-slate-800">
            <h3 className="font-medium text-red-300">v1 旧版 Top 10 <span className="text-xs text-slate-400 ml-2">3-pillar</span></h3>
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-400">
              <tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">代码</th><th className="px-3 py-2 text-left">名称</th><th className="px-3 py-2 text-right">综合分</th><th className="px-3 py-2 text-center">涨停</th></tr>
            </thead>
            <tbody>
              {compare.v1.map(r => (
                <tr key={r.code} className="border-t border-slate-800/60">
                  <td className="px-3 py-2 text-slate-400">{r.rank}</td>
                  <td className="px-3 py-2 font-mono text-slate-300">{r.code.replace(/\D/g, '')}</td>
                  <td className="px-3 py-2 text-slate-100">{r.name}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-300">{r.compositeScore.toFixed(1)}</td>
                  <td className="px-3 py-2 text-center">{r.isLimitUp ? '🚫' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-slate-900/60 rounded-xl border border-slate-800 overflow-hidden">
          <div className="p-3 bg-emerald-500/10 border-b border-slate-800">
            <h3 className="font-medium text-emerald-300">v2 新版 Top 10 <span className="text-xs text-slate-400 ml-2">8-pillar</span></h3>
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-400">
              <tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">代码</th><th className="px-3 py-2 text-left">名称</th><th className="px-3 py-2 text-right">综合分</th><th className="px-3 py-2 text-center">标记</th></tr>
            </thead>
            <tbody>
              {compare.v2.map((r, i) => (
                <tr key={r.code} className="border-t border-slate-800/60">
                  <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2 font-mono text-slate-300">{r.code.replace(/\D/g, '')}</td>
                  <td className="px-3 py-2 text-slate-100">{r.name}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-300 font-bold">{r.composite.toFixed(1)}</td>
                  <td className="px-3 py-2 text-center text-xs">
                    {r.flags.isST && <span className="px-1 bg-red-500/20 text-red-400 rounded">ST</span>}
                    {r.flags.isLimitUp && <span className="px-1 bg-orange-500/20 text-orange-400 rounded">涨停</span>}
                    {!r.flags.isST && !r.flags.isLimitUp && <span className="text-slate-500">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CompareCard({ title, value, subtitle, highlight }: { title: string; value: string; subtitle: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl p-3 border ${highlight ? 'bg-amber-500/10 border-amber-500/40' : 'bg-slate-900/60 border-slate-800'}`}>
      <div className="text-xs text-slate-400">{title}</div>
      <div className={`text-2xl font-bold mt-1 ${highlight ? 'text-amber-400' : 'text-slate-100'}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>
    </div>
  );
}
