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
import { RiskOverviewPanel } from '../components/RiskOverviewPanel';
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
  // v2.1（2026-06-15）：数据缺失率字段（P0 修复时加在 server 端，UI 端类型补齐）
  dataLossRate?: Record<string, number>;
  dataLossWarnings?: string[];
  // v2.1（2026-06-15）：IC 权重明细
  icStats?: Record<string, { ic: number; ir: number; n: number }>;
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
  // v2.1.1（2026-06-15）：长动量开关（与速览模式同步语义）
  const [longMomentum, setLongMomentum] = useState<boolean>(false);
  // 持久化
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem('factor_long_momentum', longMomentum ? '1' : '0'); } catch { /* ignore */ }
  }, [longMomentum]);
  // v2.1.1（2026-06-15）：WF 验证面板 + 集中度
  const [concentration, setConcentration] = useState<any>(null);
  const [concentrationPanelOpen, setConcentrationPanelOpen] = useState(false);
  const [wfPanelOpen, setWfPanelOpen] = useState(false);
  const [wfReport, setWfReport] = useState<any>(null);
  const [wfLoading, setWfLoading] = useState(false);
  const [wfTrend, setWfTrend] = useState<any>(null);
  // v3.0（2026-06-15）：Snapshot 统计（同步速览模式）
  const [snapshotStats, setSnapshotStats] = useState<any>(null);
  // v3.0.1（2026-06-15）：Barra 状态
  const [barraWeights, setBarraWeights] = useState<any[] | null>(null);
  const [barraDiag, setBarraDiag] = useState<any | null>(null);
  const [barraPanelOpen, setBarraPanelOpen] = useState(false);
  const [barraLoading, setBarraLoading] = useState(false);
  const [barraLambda, setBarraLambda] = useState(1.0);
  // v3.0.2（2026-06-15）：风控总览面板
  const [riskPanelOpen, setRiskPanelOpen] = useState(false);
  // v2.1.1：Sparkline 组件（动态 import）
  const [SparklineComp, setSparklineComp] = useState<any>(null);
  useEffect(() => {
    import('@/app/quant/components/WalkforwardSparkline').then(m => setSparklineComp(() => m.WalkforwardSparkline));
  }, []);
  const [forwardPeriod, setForwardPeriod] = useState<5 | 20>(5);
  const [limit, setLimit] = useState(50);

  // 初始化时从 localStorage 读 longMomentum
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem('factor_long_momentum');
      if (saved === '1') setLongMomentum(true);
    } catch { /* ignore */ }
  }, []);

  // ── 跑 v2 评分 ──────────────────────────────────
  const handleRunV2 = useCallback(async () => {
    setLoading(true);
    setError('');
    setProgress('正在拉取全市场数据...');
    try {
      const url = `/api/stock/factor-analysis-v2?action=scores&limit=${limit}&forwardPeriod=${forwardPeriod}&filterFlags=${filterFlags}&neutralize=${neutralize ? 'auto' : 'manual'}&weightMode=${weightMode}&longMomentum=${longMomentum ? '1' : '0'}`;
      setProgress('正在计算 11 类因子（含 WQ 10 alpha + 真实资金流）...');
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '分析失败');
      setResults(json.results || []);
      setDiagnostics(json.diagnostics || null);
      // v2.1.1（2026-06-15）：保存集中度评估
      setConcentration(json.concentration || null);
      // v3.0（2026-06-15）：保存 raw 因子快照 + 更新统计
      if (json.results && json.results.length > 0) {
        try {
          const { saveSnapshots, getSnapshotStats } = await import('@/lib/quant/db/factor-snapshots');
          const raws = json.results.map((r: any) => ({
            code: r.code, name: r.name, price: r.price, changePercent: r.changePercent,
            pe: r.pe, pb: r.pb, ps: r.ps, roe: r.roe, grossMargin: r.grossMargin,
            debtRatio: r.debtRatio, eps: r.eps, accrualsRatio: r.accrualsRatio,
            momentum5: r.momentum5, momentum10: r.momentum10, momentum20: r.momentum20,
            momentum60: r.momentum60, momentum120: r.momentum120,
            rsi14: r.rsi14, cci14: r.cci14, bias20: r.bias20,
            mainNetInflow5d: r.mainNetInflow5d, mainNetInflow20d: r.mainNetInflow20d,
            mainNetInflowRatio: r.mainNetInflowRatio,
            macdHist: r.macdHist, kdjK: r.kdjK, kdjD: r.kdjD,
            bollPosition: r.bollPosition, adx: r.adx, lowVolatility: r.lowVolatility,
            turnoverRate: r.turnoverRate, volumeRatio: r.volumeRatio,
            marketCap: r.marketCap, floatMarketCap: r.floatMarketCap, avgAmount20d: r.avgAmount20d,
            industry: r.industry, wqAlphaScore: r.wqAlphaScore,
          }));
          const saved = await saveSnapshots(raws);
          if (saved > 0) console.log(`[snapshot] saved ${saved} raw factor snapshots`);
          const stats = await getSnapshotStats();
          setSnapshotStats(stats);
        } catch (e) {
          console.warn('[snapshot] save failed:', e);
        }
      }
      setProgress(`✅ 完成（${json.count} 只票，耗时 ${json._ms || '?'}ms）`);
      setTimeout(() => setProgress(''), 3000);
    } catch (e: any) {
      setError(e.message || '失败');
      setProgress('');
    } finally {
      setLoading(false);
    }
  }, [limit, forwardPeriod, filterFlags, neutralize, weightMode, longMomentum]);

  // v2.1.1（2026-06-15）：跑 WF 验证（与速览模式同一接口 + IDB 持久化）
  const handleRunWF = useCallback(async () => {
    if (wfLoading) return;
    setWfLoading(true);
    setWfReport(null);
    try {
      const url = `/api/stock/factor-analysis-v2?action=walkforward&forwardPeriod=${forwardPeriod}&weightMode=${weightMode}&longMomentum=${longMomentum ? '1' : '0'}&nocache=1`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success || !json.walkforward) {
        throw new Error(json.error || 'WF 验证失败');
      }
      setWfReport(json.walkforward);

      // 保存到 IDB + 加载历史趋势
      try {
        const { saveWalkforwardReport, loadWalkforwardHistory, analyzeWalkforwardTrend, pruneWalkforwardHistory } =
          await import('@/lib/quant/db/walkforward-persistence');
        const config = {
          period: forwardPeriod === 5 ? '5d' as const : '20d' as const,
          weightMode: weightMode,
          longMomentum,
        };
        await saveWalkforwardReport(json.walkforward, config);
        const history = await loadWalkforwardHistory(config);
        setWfTrend(analyzeWalkforwardTrend(history));
        await pruneWalkforwardHistory();
      } catch (e) {
        console.warn('[WF] persistence failed:', (e as Error).message);
      }
    } catch (e: any) {
      console.error('[WF] error:', e);
      setWfReport({
        rating: 'D',
        diagnosis: `⚠️ WF 验证失败：${e.message}`,
        robustnessScore: 0, annualizedSharpe: 0, winRate: 0, excessWinRate: 0,
        maxDrawdown: 0, totalReturn: 0, avgExcessReturn: 0,
        windowCount: 0, windows: [], warnings: [e.message],
      });
      setWfTrend(null);
    } finally {
      setWfLoading(false);
    }
  }, [forwardPeriod, weightMode, longMomentum, wfLoading]);

  // v3.0.1（2026-06-15）：跑 Barra 优化
  const handleRunBarra = useCallback(async () => {
    if (barraLoading) return;
    setBarraLoading(true);
    try {
      const url = `/api/stock/factor-analysis-v2?action=barra&forwardPeriod=${forwardPeriod}&weightMode=${weightMode}&longMomentum=${longMomentum ? '1' : '0'}&lambda=${barraLambda}&maxSingle=0.15&maxIndustryDev=0.05&limit=80&nocache=1`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success || !json.weights) throw new Error(json.error || 'Barra 优化失败');
      setBarraWeights(json.weights);
      setBarraDiag(json.diagnostics);
    } catch (e: any) {
      console.error('[Barra] error:', e);
      alert('Barra 优化失败：' + e.message);
    } finally {
      setBarraLoading(false);
    }
  }, [forwardPeriod, weightMode, longMomentum, barraLambda, barraLoading]);

  // v3.0.2（2026-06-15）：跑反事实对比（用历史 raw 因子快照 + 真实后续收益）
  const [counterfactual, setCounterfactual] = useState<any>(null);
  const [counterfactualLoading, setCounterfactualLoading] = useState(false);
  const [counterfactualPanelOpen, setCounterfactualPanelOpen] = useState(false);
  const handleRunCounterfactual = useCallback(async () => {
    if (counterfactualLoading) return;
    setCounterfactualLoading(true);
    try {
      // 拉已填未来收益的 snapshots
      const { getFilledSnapshots } = await import('@/lib/quant/db/factor-snapshots');
      const filled = await getFilledSnapshots(forwardPeriod === 20 ? 20 : 5, 120);
      if (filled.length < 5) {
        setCounterfactual({
          success: false,
          message: `需要至少 5 条已填未来收益的快照（当前 ${filled.length} 条）`,
          hint: '多运行几次 ⚡ 一键分析 让 snapshot 积累；5/20 个交易日后会自动回填未来收益',
        });
        return;
      }
      // 按 date 分组，跑 scoreV2
      const { scoreV2 } = await import('@/lib/quant/factor/v2/scorer');
      const dates = Array.from(new Set(filled.map(s => s.date))).sort();
      const dataByDate = new Map<string, any[]>();
      for (const s of filled) {
        if (!dataByDate.has(s.date)) dataByDate.set(s.date, []);
        dataByDate.get(s.date)!.push(s);
      }
      const windows: any[] = [];
      for (const date of dates) {
        const cands = dataByDate.get(date);
        if (!cands || cands.length < 5) continue;
        try {
          // 注意：candidates 是 FactorRawValues，需要 v2 字段（这里 snapshots 是 raw 字段）
          const v2Result = scoreV2({
            candidates: cands,
            options: {
              forwardPeriod,
              neutralize: { industry: true, marketCap: true },
              weightMode: 'default',
              filterFlags: true,
            },
          });
          // Top 10 的实际收益
          const field = forwardPeriod === 20 ? 'return20d' : 'return5d';
          const top10 = v2Result.results.slice(0, 10);
          const top10Codes = new Set(top10.map(r => r.code));
          // 用 raw 字段里的 return5d/return20d 算
          const top10Returns = cands
            .filter(c => top10Codes.has(c.code))
            .map(c => c[field] || 0);
          const avgReturn = top10Returns.length > 0
            ? top10Returns.reduce((s, r) => s + r, 0) / top10Returns.length
            : 0;
          // 基准：所有 cands 均值
          const allReturns = cands.map(c => c[field] || 0);
          const benchReturn = allReturns.length > 0
            ? allReturns.reduce((s, r) => s + r, 0) / allReturns.length
            : 0;
          windows.push({
            date,
            pickCount: top10.length,
            actualReturn: Math.round(avgReturn * 100) / 100,
            benchmark: Math.round(benchReturn * 100) / 100,
            excess: Math.round((avgReturn - benchReturn) * 100) / 100,
          });
        } catch { /* skip this date */ }
      }
      if (windows.length === 0) {
        setCounterfactual({
          success: false,
          message: '所有快照日期的 scoreV2 都失败',
        });
        return;
      }
      const totalExcess = windows.reduce((s, w) => s + w.excess, 0);
      const winRate = windows.filter(w => w.excess > 0).length / windows.length;
      const avgExcess = totalExcess / windows.length;
      setCounterfactual({
        success: true,
        windowCount: windows.length,
        dateRange: { from: dates[0], to: dates[dates.length - 1] },
        totalExcess: Math.round(totalExcess * 100) / 100,
        avgExcess: Math.round(avgExcess * 100) / 100,
        winRate: Math.round(winRate * 1000) / 10,  // %
        windows,
      });
    } catch (e: any) {
      console.error('[counterfactual]', e);
      setCounterfactual({ success: false, message: e.message });
    } finally {
      setCounterfactualLoading(false);
    }
  }, [forwardPeriod]);

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
                <option value="ic">IC 动态 (v2.1)</option>
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
            {/* v2.1.1（2026-06-15）：长动量开关 */}
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-1.5 text-slate-300" title="开启后 momentum = 60d×0.3 + 120d×0.5 + 20d×0.2（Jegadeesh-Titman 1993）">
                <input type="checkbox" checked={longMomentum} onChange={e => setLongMomentum(e.target.checked)} className="accent-indigo-500" />
                📊 长动量
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
            {/* v2.1.1（2026-06-15）：集中度 + WF 按钮 */}
            {tab === 'v2' && concentration && (
              <button
                onClick={() => setConcentrationPanelOpen(p => !p)}
                className={`px-3 py-1.5 rounded text-xs font-medium ${
                  concentration.rating === 'A+' || concentration.rating === 'A'
                    ? 'bg-emerald-700/40 text-emerald-200 border border-emerald-500/40'
                    : concentration.rating === 'D'
                      ? 'bg-red-700/40 text-red-200 border border-red-500/40'
                      : 'bg-amber-700/40 text-amber-200 border border-amber-500/40'
                }`}
                title={`集中度评级 ${concentration.rating} / HHI=${concentration.hhi.toFixed(3)}`}
              >
                🛡️ 集中度 {concentration.rating}
              </button>
            )}
            {tab === 'v2' && (
              <button
                onClick={() => setWfPanelOpen(p => !p)}
                disabled={loading}
                className={`px-3 py-1.5 rounded text-xs font-medium ${
                  wfPanelOpen
                    ? 'bg-gradient-to-r from-fuchsia-700 to-pink-700 text-white'
                    : 'bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 text-white'
                }`}
                title="📈 Walk-Forward 验证：用过去 120 日历史数据，按当前权重生成 Top N 推荐"
              >
                {wfPanelOpen ? '📈 收起 WF' : '📈 WF 验证'}
              </button>
            )}
            {tab === 'v2' && (
              <button
                onClick={() => setBarraPanelOpen(p => !p)}
                className={`px-3 py-1.5 rounded text-xs font-medium ${
                  barraPanelOpen
                    ? 'bg-gradient-to-r from-amber-700 to-orange-700 text-white'
                    : 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white'
                }`}
                title="🎯 Barra 优化：Barra 风险模型 + 均值-方差优化器，给出每只票的目标权重"
              >
                {barraPanelOpen ? '🎯 收起 Barra' : '🎯 Barra 优化'}
              </button>
            )}
            {tab === 'v2' && (
              <button
                onClick={() => setCounterfactualPanelOpen(p => !p)}
                className={`px-3 py-1.5 rounded text-xs font-medium ${
                  counterfactualPanelOpen
                    ? 'bg-gradient-to-r from-purple-700 to-pink-700 text-white'
                    : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white'
                }`}
                title="🔮 反事实对比：用历史 raw 因子快照 + 真实后续收益，验证「当时选 Top 10」实际能赚多少"
              >
                {counterfactualPanelOpen ? '🔮 收起反事实' : '🔮 反事实对比'}
              </button>
            )}
          </div>
          {progress && <div className="mt-3 text-sm text-emerald-400">{progress}</div>}
          {error && <div className="mt-3 text-sm text-red-400">{error}</div>}
        </div>

        {/* v2.1.1（2026-06-15）：集中度详情面板 */}
        {tab === 'v2' && concentrationPanelOpen && concentration && (
          <div className="bg-gradient-to-br from-violet-950/40 to-purple-950/30 border border-violet-700/40 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm text-violet-200 font-semibold">
                🛡️ 行业集中度评估（Top {Math.min(limit, results.length)} 组合风险）
                <span className="text-[10px] text-slate-400 font-normal ml-2">
                  · 评级 {concentration.rating} / 分数 {concentration.diversityScore} / HHI={concentration.hhi.toFixed(3)}
                </span>
              </h3>
              <button onClick={() => setConcentrationPanelOpen(false)} className="text-xs text-slate-400 hover:text-slate-200">收起 ✕</button>
            </div>
            <div className="space-y-1.5 mb-3">
              {Object.entries(concentration.industryDistribution as Record<string, number>)
                .sort((a, b) => b[1] - a[1])
                .map(([industry, weight]) => {
                  const dev = concentration.industryDeviation[industry] || 0;
                  const isOverLimit = Math.abs(dev) > 0.05;
                  return (
                    <div key={industry} className="flex items-center gap-2 text-xs">
                      <span className="w-16 text-slate-300 truncate" title={industry}>{industry}</span>
                      <div className="flex-1 h-4 bg-slate-800 rounded relative overflow-hidden">
                        <div className={`h-full ${isOverLimit ? 'bg-red-500/70' : 'bg-violet-500/70'}`} style={{ width: `${weight * 100}%` }} />
                      </div>
                      <span className={`w-20 text-right font-mono ${isOverLimit ? 'text-red-300' : 'text-slate-300'}`}>
                        {(weight * 100).toFixed(0)}%
                        {dev !== 0 && <span className="text-[10px] ml-1">({dev > 0 ? '+' : ''}{(dev * 100).toFixed(1)}%)</span>}
                      </span>
                    </div>
                  );
                })}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="bg-slate-800/60 rounded p-2">
                <div className="text-slate-400">HHI</div>
                <div className="text-violet-200 font-mono">{concentration.hhi.toFixed(3)}</div>
                <div className="text-[10px] text-slate-500">
                  {concentration.hhiRating === 'diversified' ? '✅ 高度分散' :
                   concentration.hhiRating === 'moderate' ? '⚠️ 适度集中' : '🔴 过度集中'}
                </div>
              </div>
              <div className="bg-slate-800/60 rounded p-2">
                <div className="text-slate-400">行业数</div>
                <div className="text-violet-200 font-mono">{Object.keys(concentration.industryDistribution).length}</div>
              </div>
              <div className="bg-slate-800/60 rounded p-2">
                <div className="text-slate-400">超限行业</div>
                <div className={`font-mono ${concentration.industriesOverLimit.length > 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                  {concentration.industriesOverLimit.length}
                </div>
              </div>
              <div className="bg-slate-800/60 rounded p-2">
                <div className="text-slate-400">单只权重</div>
                <div className="text-violet-200 font-mono">{(concentration.singleWeight * 100).toFixed(1)}%</div>
              </div>
            </div>
            {concentration.warnings && concentration.warnings.length > 0 && (
              <div className="mt-3 space-y-1 text-xs">
                {concentration.warnings.map((w: string, i: number) => (
                  <div key={i} className={`px-2 py-1 rounded ${w.includes('⚠️') ? 'bg-red-900/20 text-red-300' : 'bg-emerald-900/20 text-emerald-300'}`}>
                    {w}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* v3.0.2（2026-06-15）：反事实对比面板 — 用历史 raw 因子快照 + 真实后续收益 */}
        {tab === 'v2' && counterfactualPanelOpen && (
          <div className="bg-gradient-to-br from-purple-950/40 to-pink-950/30 border border-purple-700/40 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="text-sm text-purple-200 font-semibold">
                🔮 反事实对比：当时选 Top 10 真实能赚多少
                <span className="text-[10px] text-slate-400 font-normal ml-2">
                  · 用 IDB 因子快照 + 真实后续 {forwardPeriod} 日收益
                </span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRunCounterfactual}
                  disabled={counterfactualLoading}
                  className="text-xs px-3 py-1 bg-purple-700 hover:bg-purple-600 text-white rounded font-medium disabled:opacity-50"
                >
                  {counterfactualLoading ? '跑中…' : '🚀 开始反事实'}
                </button>
                <button onClick={() => setCounterfactualPanelOpen(false)} className="text-xs text-slate-400 hover:text-slate-200">收起 ✕</button>
              </div>
            </div>

            {!counterfactual && !counterfactualLoading && (
              <div className="text-xs text-slate-500 text-center py-4">
                点击「🚀 开始反事实」用 IDB 里的 raw 因子快照 + 真实后续收益，验证历史 Top 10 实际收益 vs 候选池均值
              </div>
            )}

            {counterfactual && !counterfactual.success && (
              <div className="text-xs text-amber-400 bg-amber-900/20 border border-amber-700/40 rounded p-3">
                ⚠️ {counterfactual.message}
                {counterfactual.hint && <div className="mt-1 text-slate-400">💡 {counterfactual.hint}</div>}
              </div>
            )}

            {counterfactual && counterfactual.success && (
              <div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-xs">
                  <div className="bg-slate-800/60 rounded p-2">
                    <div className="text-slate-400">反事实窗口数</div>
                    <div className="text-purple-200 font-mono text-lg">{counterfactual.windowCount}</div>
                  </div>
                  <div className="bg-slate-800/60 rounded p-2">
                    <div className="text-slate-400">累计超额</div>
                    <div className={`font-mono text-lg ${counterfactual.totalExcess > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {counterfactual.totalExcess > 0 ? '+' : ''}{counterfactual.totalExcess}%
                    </div>
                  </div>
                  <div className="bg-slate-800/60 rounded p-2">
                    <div className="text-slate-400">平均超额</div>
                    <div className={`font-mono ${counterfactual.avgExcess > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {counterfactual.avgExcess > 0 ? '+' : ''}{counterfactual.avgExcess}%
                    </div>
                  </div>
                  <div className="bg-slate-800/60 rounded p-2">
                    <div className="text-slate-400">胜率</div>
                    <div className={`font-mono text-lg ${counterfactual.winRate > 50 ? 'text-emerald-300' : counterfactual.winRate > 30 ? 'text-amber-300' : 'text-red-300'}`}>
                      {counterfactual.winRate}%
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 mb-2">
                  数据范围：{counterfactual.dateRange.from} ~ {counterfactual.dateRange.to}（{counterfactual.windowCount} 个 rebalance 日）
                </div>
                <div className="text-[10px] text-purple-300 mb-2">
                  💡 {counterfactual.avgExcess > 0.5 ? `✅ Top 10 平均跑赢候选池 ${counterfactual.avgExcess}%，v2 模型在历史上有效` :
                    counterfactual.avgExcess < -0.5 ? `⚠️ Top 10 平均跑输候选池 ${Math.abs(counterfactual.avgExcess)}%，v2 模型在历史上失效 — 建议调权重或换 rebalance 周期` :
                    `➖ Top 10 与候选池均值接近，v2 模型在历史上无明显优势`}
                </div>
                {counterfactual.windows && counterfactual.windows.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-slate-400 hover:text-slate-200 mb-2">
                      📊 反事实明细（{counterfactual.windows.length} 个 rebalance 日）
                    </summary>
                    <div className="bg-slate-900/60 rounded p-2 max-h-64 overflow-y-auto space-y-1">
                      {counterfactual.windows.map((w: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 font-mono text-[11px]">
                          <span className="w-20 text-slate-500">{w.date}</span>
                          <span className={`w-16 text-right ${w.actualReturn > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                            Top10 {w.actualReturn > 0 ? '+' : ''}{w.actualReturn}%
                          </span>
                          <span className="w-16 text-right text-slate-400">
                            基准 {w.benchmark > 0 ? '+' : ''}{w.benchmark}%
                          </span>
                          <span className={`w-16 text-right ${w.excess > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                            超额 {w.excess > 0 ? '+' : ''}{w.excess}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {/* v2.1.1（2026-06-15）：WF 验证面板（与速览模式共享 IDB 历史） */}
        {tab === 'v2' && wfPanelOpen && (
          <div className="bg-gradient-to-br from-fuchsia-950/40 to-pink-950/30 border border-fuchsia-700/40 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm text-fuchsia-200 font-semibold">
                📈 Walk-Forward 验证（当前权重是否可能有效）
                <span className="text-[10px] text-slate-400 font-normal ml-2">
                  · 过去 120 日代理收益 · 精度 ~70%
                </span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRunWF}
                  disabled={wfLoading}
                  className="text-xs px-3 py-1 bg-fuchsia-700 hover:bg-fuchsia-600 text-white rounded font-medium disabled:opacity-50"
                >
                  {wfLoading ? '验证中…' : '🚀 开始验证'}
                </button>
                {/* v2.1.1：导出历史 */}
                <button
                  onClick={async () => {
                    try {
                      const { loadWalkforwardHistory } = await import('@/lib/quant/db/walkforward-persistence');
                      const { exportReportsAll } = await import('@/lib/quant/db/walkforward-export');
                      const config = { period: forwardPeriod === 5 ? '5d' as const : '20d' as const, weightMode, longMomentum };
                      const history = await loadWalkforwardHistory(config);
                      if (history.length === 0) { alert('暂无历史报告可导出'); return; }
                      const { csv, json } = exportReportsAll(history);
                      console.log(`[export] 已导出 ${history.length} 条：${csv}, ${json}`);
                    } catch (e) {
                      console.error('[export] failed:', e);
                      alert('导出失败：' + (e as Error).message);
                    }
                  }}
                  disabled={wfLoading}
                  className="text-xs px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded font-medium disabled:opacity-50"
                  title="导出当前配置的全部历史报告（CSV + JSON）"
                >
                  📥 导出
                </button>
                <button onClick={() => setWfPanelOpen(false)} className="text-xs text-slate-400 hover:text-slate-200">收起 ✕</button>
              </div>
            </div>

            {!wfReport && !wfLoading && (
              <div className="text-xs text-slate-500 text-center py-4">
                点击「🚀 开始验证」用过去 120 日历史窗口，检验当前 8 大类权重生成的 Top N 是否能跑赢候选池均值
              </div>
            )}
            {wfLoading && <div className="text-xs text-fuchsia-300 text-center py-4 animate-pulse">📈 正在跑 WF 验证…</div>}

            {wfReport && !wfLoading && (
              <div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3 text-xs">
                  <div className={`rounded p-2 ${
                    wfReport.rating === 'A+' || wfReport.rating === 'A' ? 'bg-emerald-900/30 border border-emerald-700/40' :
                    wfReport.rating === 'D' ? 'bg-red-900/30 border border-red-700/40' : 'bg-slate-800/60'
                  }`}>
                    <div className="text-slate-400">评级</div>
                    <div className={`text-lg font-bold ${
                      wfReport.rating === 'A+' || wfReport.rating === 'A' ? 'text-emerald-300' :
                      wfReport.rating === 'D' ? 'text-red-300' : 'text-amber-300'
                    }`}>{wfReport.rating}</div>
                    <div className="text-[10px] text-slate-500">{wfReport.robustnessScore}/100</div>
                  </div>
                  <div className="bg-slate-800/60 rounded p-2">
                    <div className="text-slate-400">年化夏普</div>
                    <div className={`font-mono ${wfReport.annualizedSharpe > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {wfReport.annualizedSharpe.toFixed(2)}
                    </div>
                  </div>
                  <div className="bg-slate-800/60 rounded p-2">
                    <div className="text-slate-400">超额胜率</div>
                    <div className={`font-mono ${wfReport.excessWinRate > 0.5 ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {(wfReport.excessWinRate * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div className="bg-slate-800/60 rounded p-2">
                    <div className="text-slate-400">最大回撤</div>
                    <div className="text-red-300 font-mono">{wfReport.maxDrawdown.toFixed(1)}%</div>
                  </div>
                  <div className="bg-slate-800/60 rounded p-2">
                    <div className="text-slate-400">累计收益</div>
                    <div className={`font-mono ${wfReport.totalReturn > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {wfReport.totalReturn.toFixed(2)}%
                    </div>
                  </div>
                </div>
                <div className={`text-xs px-3 py-2 rounded mb-3 ${
                  wfReport.rating === 'A+' || wfReport.rating === 'A' ? 'bg-emerald-900/20 text-emerald-200' :
                  wfReport.rating === 'D' ? 'bg-red-900/20 text-red-200' : 'bg-slate-800/60 text-slate-300'
                }`}>
                  💡 {wfReport.diagnosis}
                </div>

                {/* 历史趋势 */}
                {wfTrend && wfTrend.recentSeries.length > 0 && (
                  <div className={`mb-3 px-3 py-2 rounded text-xs ${
                    wfTrend.alert ? 'bg-red-900/20 border border-red-700/40' : 'bg-slate-800/60'
                  }`}>
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className="text-slate-400">📈 历史趋势（最近 {wfTrend.recentSeries.length} 次）：</span>
                      <span className={`font-mono ${
                        wfTrend.trend === 'improving' ? 'text-emerald-300' :
                        wfTrend.trend === 'declining' ? 'text-red-300' :
                        wfTrend.trend === 'insufficient' ? 'text-slate-500' : 'text-slate-300'
                      }`}>
                        {wfTrend.trend === 'improving' ? '↗ 改善' :
                         wfTrend.trend === 'declining' ? '↘ 下滑' :
                         wfTrend.trend === 'insufficient' ? '— 数据不足' : '→ 稳定'}
                      </span>
                      <span className="text-slate-400">平均评分 <span className="text-fuchsia-200 font-mono">{wfTrend.avgScore}</span></span>
                      {wfTrend.consecutiveBad > 0 && (
                        <span className={`font-mono ${wfTrend.consecutiveBad >= 3 ? 'text-red-300' : 'text-amber-300'}`}>
                          连续 C/D × {wfTrend.consecutiveBad}
                        </span>
                      )}
                    </div>
                    <div className="flex items-end gap-1 h-12">
                      {SparklineComp ? (
                        <SparklineComp data={wfTrend.recentSeries} width={400} height={70} />
                      ) : (
                        wfTrend.recentSeries.map((pt: any, i: number) => (
                          <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`评分 ${pt.score} / 评级 ${pt.rating}`}>
                            <div className={`w-full rounded-t ${
                              pt.rating === 'A+' || pt.rating === 'A' ? 'bg-emerald-500/70' :
                              pt.rating === 'D' ? 'bg-red-500/70' : 'bg-amber-500/70'
                            }`} style={{ height: `${Math.max(4, pt.score)}%` }} />
                            <span className="text-[9px] text-slate-500 font-mono">{pt.score}</span>
                          </div>
                        ))
                      )}
                    </div>
                    {wfTrend.alert && <div className="mt-2 text-red-300">{wfTrend.alert}</div>}
                  </div>
                )}

                {/* 窗口明细 */}
                {wfReport.windows && wfReport.windows.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-slate-400 hover:text-slate-200 mb-2">
                      📊 窗口明细（{wfReport.windows.length} 个）
                    </summary>
                    <div className="bg-slate-800/60 rounded p-2 space-y-1 max-h-48 overflow-y-auto">
                      {wfReport.windows.map((w: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 font-mono text-[11px]">
                          <span className="w-12 text-slate-500">#{w.windowIndex + 1}</span>
                          <span className="w-16 text-slate-400">{w.rebalanceDate}</span>
                          <span className={`w-16 text-right ${w.excessReturn > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                            {w.excessReturn > 0 ? '+' : ''}{w.excessReturn.toFixed(2)}%
                          </span>
                          <span className="text-slate-500 truncate" title={w.picks.join(', ')}>
                            {w.picks.slice(0, 3).join(', ')}{w.picks.length > 3 ? '…' : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {/* v3.0.1（2026-06-15）：Barra 风险模型 + 组合优化面板（amber 配色）*/}
        {tab === 'v2' && barraPanelOpen && (
          <div className="bg-gradient-to-br from-amber-950/40 to-orange-950/30 border border-amber-700/40 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="text-sm text-amber-200 font-semibold">
                🎯 Barra 风险模型 + 组合优化（从分数到权重）
                <span className="text-[10px] text-slate-400 font-normal ml-2">
                  · 8 风格因子 · {barraDiag ? `${barraWeights?.length || 0} 只票` : '点开始算权重'}
                </span>
              </h3>
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-slate-400 flex items-center gap-1">
                  λ:
                  <input
                    type="number" step={0.1} min={0.1} max={5}
                    value={barraLambda}
                    onChange={(e) => setBarraLambda(parseFloat(e.target.value) || 1.0)}
                    className="w-12 bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-xs"
                    title="风险厌恶系数（越大越保守）"
                  />
                </label>
                <button
                  onClick={handleRunBarra}
                  disabled={barraLoading}
                  className="text-xs px-3 py-1 bg-amber-700 hover:bg-amber-600 text-white rounded font-medium disabled:opacity-50"
                >
                  {barraLoading ? '优化中…' : '🚀 开始优化'}
                </button>
              </div>
            </div>

            {!barraWeights && !barraLoading && (
              <div className="text-xs text-slate-500 text-center py-4">
                点击「🚀 开始优化」用 Barra 风险模型（8 风格因子 + 行业约束）给每只票计算目标权重
              </div>
            )}
            {barraLoading && <div className="text-xs text-amber-300 text-center py-4 animate-pulse">🎯 正在算权重…</div>}

            {barraWeights && !barraLoading && barraDiag && (
              <div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-xs">
                  <div className={`rounded p-2 ${
                    barraDiag.informationRatio > 1.5 ? 'bg-emerald-900/30 border border-emerald-700/40' :
                    barraDiag.informationRatio < 0.5 ? 'bg-red-900/30 border border-red-700/40' : 'bg-slate-800/60'
                  }`}>
                    <div className="text-slate-400">信息比率 IR</div>
                    <div className={`text-lg font-bold ${
                      barraDiag.informationRatio > 1.5 ? 'text-emerald-300' :
                      barraDiag.informationRatio < 0.5 ? 'text-red-300' : 'text-amber-300'
                    }`}>{barraDiag.informationRatio.toFixed(2)}</div>
                    <div className="text-[10px] text-slate-500">
                      {barraDiag.informationRatio > 1.5 ? '✅ A 级' : barraDiag.informationRatio < 0.5 ? '⚠️ 需调权重' : '— 行业标准'}
                    </div>
                  </div>
                  <div className="bg-slate-800/60 rounded p-2">
                    <div className="text-slate-400">组合 α</div>
                    <div className="text-amber-200 font-mono">{barraDiag.portfolioAlpha.toFixed(3)}</div>
                    <div className="text-[10px] text-slate-500">Z-score 标准化</div>
                  </div>
                  <div className="bg-slate-800/60 rounded p-2">
                    <div className="text-slate-400">组合 σ</div>
                    <div className="text-amber-200 font-mono">{(barraDiag.portfolioRisk * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-slate-800/60 rounded p-2">
                    <div className="text-slate-400">多样性比率</div>
                    <div className="text-amber-200 font-mono">{barraDiag.diversificationRatio.toFixed(2)}</div>
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 mb-2">
                  α Z-score: mean={barraDiag.alphaNormalization?.rawMean.toFixed(1)}, std={barraDiag.alphaNormalization?.rawStd.toFixed(1)} · 收敛 {barraDiag.converged ? '✅' : '⚠️'}（{barraDiag.iterations} 轮）· 单只 ≤ 15% · 行业偏离 ≤ 5%
                </div>
                <div className="text-[10px] text-amber-300 mb-2">
                  💡 {barraDiag.informationRatio > 1.5 ? '组合 IR 超过 1.5，达到 A 级策略标准' : barraDiag.informationRatio < 0.5 ? '组合 IR 偏低，建议调整 λ 或权重' : '组合 IR 在合理范围（业界标准 0.5-1.5）'}
                </div>

                {/* 权重表（前 15 只）*/}
                <div className="bg-slate-900/60 rounded p-2 max-h-72 overflow-y-auto">
                  <div className="grid grid-cols-12 text-[10px] text-slate-500 px-2 py-1 border-b border-slate-700/40">
                    <span className="col-span-2">代码</span>
                    <span className="col-span-2">行业</span>
                    <span className="col-span-3 text-right">权重</span>
                    <span className="col-span-2 text-right">α (Z)</span>
                    <span className="col-span-1 text-right">σ</span>
                    <span className="col-span-2 text-center">条形图</span>
                  </div>
                  {barraWeights.slice(0, 15).map((w: any, i: number) => (
                    <div key={i} className="grid grid-cols-12 items-center text-xs px-2 py-1 hover:bg-slate-800/40">
                      <span className="col-span-2 font-mono text-slate-300">{w.code}</span>
                      <span className="col-span-2 text-slate-400 truncate" title={w.industry}>{w.industry || '—'}</span>
                      <span className={`col-span-3 text-right font-mono ${w.weight > 0.05 ? 'text-amber-200' : 'text-slate-300'}`}>
                        {(w.weight * 100).toFixed(2)}%
                      </span>
                      <span className={`col-span-2 text-right font-mono ${(w.alphaZ || 0) > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                        {(w.alphaZ || 0) >= 0 ? '+' : ''}{(w.alphaZ || 0).toFixed(2)}
                      </span>
                      <span className="col-span-1 text-right text-slate-400 font-mono">{(w.risk * 100).toFixed(0)}%</span>
                      <span className="col-span-2 flex items-center justify-center">
                        <div className="w-full h-2 bg-slate-800 rounded">
                          <div
                            className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded"
                            style={{ width: `${Math.min(100, w.weight * 100 / 0.15 * 100)}%` }}
                          />
                        </div>
                      </span>
                    </div>
                  ))}
                </div>

                {barraDiag.warnings && barraDiag.warnings.length > 0 && (
                  <div className="mt-2 text-xs text-amber-400">
                    {barraDiag.warnings.map((w: string, i: number) => (
                      <div key={i}>⚠️ {w}</div>
                    ))}
                  </div>
                )}

                {/* v3.0.2（2026-06-15）：按 Barra 权重批量下单（业界标准） */}
                <div className="mt-3 pt-3 border-t border-amber-800/40 flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[10px] text-slate-500">
                    💡 按 Barra 优化后的目标权重，自动拆分订单并下单（按账号可用资金 × 比例）
                  </div>
                  <button
                    onClick={async () => {
                      // 弹 confirm 显示详情
                      const totalWeight = barraWeights.slice(0, 15).reduce((s: number, w: any) => s + w.weight, 0);
                      const orderCount = barraWeights.slice(0, 15).filter((w: any) => w.weight > 0.001).length;
                      const ok = confirm(
                        `📥 按 Barra 权重批量下单\n\n` +
                        `将下单 ${orderCount} 笔（占比 > 0.1% 的票）\n` +
                        `权重合计：${(totalWeight * 100).toFixed(1)}%\n\n` +
                        `⚠️ 实际交易（模拟盘）会按账号可用资金 × 权重 自动拆分金额\n` +
                        `建议先用「🔬 模拟盘」→ 确认无风控告警后再点确认\n\n` +
                        `确认下单？`
                      );
                      if (!ok) return;
                      // 调 live-simulator API
                      try {
                        const res = await fetch('/api/simulator', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: 'batchOrder',
                            orders: barraWeights.slice(0, 15)
                              .filter((w: any) => w.weight > 0.001)
                              .map((w: any) => ({
                                code: w.code,
                                side: 'buy',
                                weight: w.weight,
                              })),
                          }),
                        });
                        const json = await res.json();
                        if (json.success) {
                          alert(`✅ 批量下单成功！\n${json.message || `${orderCount} 笔订单已提交`}`);
                        } else {
                          alert('❌ 下单失败：' + (json.error || '未知错误'));
                        }
                      } catch (e: any) {
                        alert('❌ 网络错误：' + e.message);
                      }
                    }}
                    className="text-xs px-3 py-1.5 bg-amber-700 hover:bg-amber-600 text-white rounded font-medium"
                    title="按 Barra 目标权重批量下单（业界标准：权重 → 拆单 → 调模拟盘）"
                  >
                    📥 按权重批量下单
                  </button>
                  <button
                    onClick={async () => {
                      const stockCount = barraWeights.slice(0, 15).filter((w: any) => w.weight > 0.001).length;
                      const ok = confirm(
                        `🤖 同步到自动驾驶策略池\n\n` +
                        `将把当前 Barra 优化后的 Top ${stockCount} 只票\n` +
                        `设为自动驾驶策略池（替换现有策略池）\n\n` +
                        `⚠️ 自动驾驶会按 Barra 权重自动开仓 / 调仓\n` +
                        `建议先用「📥 按权重批量下单」→ 确认无风控告警后再点确认\n\n` +
                        `确认同步？`
                      );
                      if (!ok) return;
                      try {
                        const res = await fetch('/api/simulator', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: 'syncAutoPilot',
                            codes: barraWeights.slice(0, 15)
                              .filter((w: any) => w.weight > 0.001)
                              .map((w: any) => w.code),
                            weights: barraWeights.slice(0, 15)
                              .filter((w: any) => w.weight > 0.001)
                              .map((w: any) => w.weight),
                          }),
                        });
                        const json = await res.json();
                        if (json.success) {
                          alert(`✅ 策略池已同步！\n${stockCount} 只票已加入自动驾驶策略池`);
                        } else {
                          alert('❌ 同步失败：' + (json.error || '未知错误'));
                        }
                      } catch (e: any) {
                        alert('❌ 网络错误：' + e.message);
                      }
                    }}
                    className="text-xs px-3 py-1.5 bg-violet-700 hover:bg-violet-600 text-white rounded font-medium"
                    title="把 Barra 权重设为自动驾驶策略池（业界标准：选股 → 优化 → 自动驾驶）"
                  >
                    🤖 同步到自动驾驶
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* v3.0.2（2026-06-15）：风控总览按钮 */}
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={() => setRiskPanelOpen(p => !p)}
            className={`text-xs px-3 py-1.5 rounded font-medium ${
              riskPanelOpen
                ? 'bg-gradient-to-r from-cyan-700 to-blue-700 text-white'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
            }`}
            title="🛡️ 风控总览：把 Barra 风险归因 + WF 验证 + 压力测试 + 集中度集成到 1 个面板"
          >
            {riskPanelOpen ? '🛡️ 收起风控总览' : '🛡️ 风控总览'}
          </button>
        </div>

        {riskPanelOpen && (
          <RiskOverviewPanel
            barraWeights={barraWeights}
            barraDiag={barraDiag}
            concentration={concentration}
            wfTrend={wfTrend}
            forwardPeriod={forwardPeriod}
            onLoadFactorRisk={() => {/* 触发后端算（暂用前端本地） */}}
          />
        )}

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
            {/* v2.1（2026-06-15）：IC 权重明细面板 — 当 weightSource='ic' 时显示 IC 派生权重 vs Barra 默认 */}
            {diagnostics.weightSource === 'ic' && diagnostics.weightsUsed && (
              <details className="mt-3 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg" open>
                <summary className="text-xs text-emerald-300 cursor-pointer font-medium">📊 IC 派生权重明细（v2.1）</summary>
                <div className="mt-2 grid grid-cols-4 gap-1.5 text-xs">
                  {Object.entries(diagnostics.weightsUsed)
                    .sort((a, b) => b[1] - a[1])
                    .map(([factor, w]) => {
                      const ic = diagnostics.icStats?.[factor];
                      const pct = (w as number).toFixed(1);
                      const sign = ic && ic.ic < 0 ? '⚠️' : '✓';
                      return (
                        <div key={factor} className="flex items-center justify-between bg-slate-900/60 rounded px-2 py-1">
                          <span className="text-slate-400">
                            {sign} {factor === 'wqAlpha' ? 'WQ' : factor.slice(0, 3)}
                          </span>
                          <span className="font-mono text-emerald-300 font-bold">{pct}%</span>
                        </div>
                      );
                    })}
                </div>
                <div className="mt-2 text-[10px] text-slate-400 leading-tight">
                  ⚠️ 标记 IC&lt;0 的因子（权重 = |IC| × tanh(IR) 仍可能高，但方向需要看 reverse 标记）。
                  看因子 vs 下期收益的 Pearson：{Object.entries(diagnostics.icStats || {}).map(([k, v]) => `${k}=${(v as any).ic.toFixed(2)}`).join(', ')}
                </div>
              </details>
            )}
            {/* P0 修复（2026-06-15）：数据缺失率面板 — 让用户看到原始数据是否到位 */}
            {diagnostics.dataLossRate && Object.keys(diagnostics.dataLossRate).length > 0 && (
              <div className="mt-3 p-2 bg-slate-800/40 rounded-lg">
                <div className="text-xs text-slate-300 mb-1.5">📉 原始数据缺失率（P0 修复）</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {Object.entries(diagnostics.dataLossRate).map(([factor, rate]) => {
                    const pct = (rate as number) * 100;
                    const isHigh = pct > 50;
                    const isMid = pct > 20;
                    return (
                      <div key={factor} className="flex items-center justify-between bg-slate-900/60 rounded px-2 py-1">
                        <span className="text-slate-400">{factor === 'quality' ? '质量 (ROE/毛利/负债)' : '估值 (PE/PB/PS)'}</span>
                        <span className={`font-mono font-bold ${isHigh ? 'text-red-400' : isMid ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {pct.toFixed(0)}% 缺失
                        </span>
                      </div>
                    );
                  })}
                </div>
                {diagnostics.dataLossWarnings && diagnostics.dataLossWarnings.length > 0 && (
                  <div className="mt-2 text-xs space-y-0.5">
                    {diagnostics.dataLossWarnings.map((w: string, i: number) => (
                      <div key={i} className={w.startsWith('⚠️') ? 'text-amber-400' : 'text-slate-400'}>• {w}</div>
                    ))}
                  </div>
                )}
              </div>
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
