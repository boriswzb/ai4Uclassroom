/**
 * v3.0.2（2026-06-15）— 风控总览面板
 *
 * 把业界 4 个风控工具集中到 1 个面板：
 *   1. Barra 风险归因（MCR Top 5 + 因子贡献）
 *   2. WF 验证（最近 5 次评级 + 趋势）
 *   3. 压力测试（5 场景结果）
 *   4. 集中度（HHI + 行业偏离）
 *
 * 业界标准（Barra / Axioma 客户仪表盘）：
 *   - 多维度卡片网格（每张卡片 1 个工具）
 *   - 颜色编码（红/黄/绿）
 *   - 关键指标 1 眼可见
 *   - 详情可下钻（点击卡片展开更多）
 */

'use client';

import React, { useState, useEffect } from 'react';
import { WalkforwardSparkline, type SparklinePoint } from './WalkforwardSparkline';

interface RiskOverviewPanelProps {
  barraWeights: Array<{ code: string; industry: string; weight: number; alpha: number; risk: number; alphaZ: number }> | null;
  barraDiag: {
    informationRatio: number;
    portfolioAlpha: number;
    portfolioRisk: number;
    diversificationRatio: number;
    converged: boolean;
    iterations: number;
    alphaNormalization?: { rawMean: number; rawStd: number };
    riskAttribution?: {
      marginalContribRisk: Array<{ code: string; industry: string; mcr: number; weightPct: number }>;
      factorContrib: Record<string, number>;
      totalFactorRisk: number;
      specificRisk: number;
    };
  } | null;
  concentration: any | null;
  wfTrend: { recentSeries: SparklinePoint[]; avgScore: number; trend: string; consecutiveBad: number; alert?: string } | null;
  forwardPeriod: 5 | 20;
  onLoadFactorRisk: () => void;  // 触发后端算因子风险
}

export function RiskOverviewPanel({
  barraWeights,
  barraDiag,
  concentration,
  wfTrend,
  forwardPeriod,
  onLoadFactorRisk,
}: RiskOverviewPanelProps) {
  // 压力测试结果（如已有）
  const [stress, setStress] = useState<any>(null);
  const [stressLoading, setStressLoading] = useState(false);
  const [stressLoaded, setStressLoaded] = useState(false);

  const runStress = async () => {
    if (stressLoading) return;
    setStressLoading(true);
    try {
      // 用当前 Barra 权重 + 调后端
      const res = await fetch('/api/stock/factor-analysis-v2?action=barra&forwardPeriod=' + forwardPeriod + '&limit=80&nocache=1');
      const json = await res.json();
      if (json.success && json.weights) {
        // 简化：直接复用 barraDiag 的 results 算 stress（前端不调独立 API）
        // 业界：通常 stress 由后端算（含完整 Barra 输入）
        // 这里：先用一个本地估算
        const sum = json.weights.reduce((s: number, w: any) => s + w.weight, 0);
        const baseVol = json.diagnostics.portfolioRisk * 100;
        const baseline = {
          expectedReturn: json.diagnostics.portfolioAlpha * 100,
          expectedVol: baseVol,
          var95: baseVol * 1.645,
          var99: baseVol * 2.326,
        };
        const SCENARIOS = [
          { id: '2008', name: '2008 金融海啸', baseReturn: -30, volMult: 3, corrBoost: 0.5, industryShocks: {} as Record<string, number> },
          { id: '2015', name: '2015 股灾', baseReturn: -20, volMult: 2, corrBoost: 0.3, industryShocks: { 银行: -10, 地产: -25, 计算机: -30, 传媒: -35, 电子: -28 } },
          { id: '2020', name: '2020 疫情', baseReturn: -15, volMult: 1.5, corrBoost: 0.2, industryShocks: { 医药: -5, 计算机: -10, 电子: -12, 银行: -18, 旅游: -35, 航空: -40 } },
          { id: '2017', name: '2017 慢牛', baseReturn: 10, volMult: 0.8, corrBoost: -0.1, industryShocks: {} },
          { id: '2019', name: '2019 贸易战', baseReturn: -5, volMult: 1.2, corrBoost: 0.1, industryShocks: { 电子: -20, 计算机: -15, 通信: -12, 农林牧渔: 5, 医药: -3 } },
        ];
        const results = SCENARIOS.map((sc) => {
          const adjustedVol = baseVol * sc.volMult * Math.sqrt(1 + sc.corrBoost * 5);
          let expectedReturn = sc.baseReturn;
          let industryContrib = 0;
          for (const w of json.weights) {
            const indShock = sc.industryShocks[w.industry || ''];
            if (indShock !== undefined) industryContrib += w.weight * indShock;
          }
          expectedReturn = sc.baseReturn + industryContrib;
          const passed = Math.abs(expectedReturn) <= baseline.var95 * 2;
          return {
            scenario: sc.id, name: sc.name, expectedReturn: Math.round(expectedReturn * 100) / 100,
            expectedVol: Math.round(adjustedVol), var95: Math.round(adjustedVol * 1.645),
            var99: Math.round(adjustedVol * 2.326), maxDD: Math.round(Math.max(adjustedVol * 2.5, Math.abs(expectedReturn) * 1.2)),
            passed,
          };
        });
        setStress({ results, baseline, passedCount: results.filter((r: any) => r.passed).length });
        setStressLoaded(true);
      }
    } catch (e) {
      console.error('[stress]', e);
    } finally {
      setStressLoading(false);
    }
  };

  // 自动加载 stress（第一次有 Barra 数据时）
  useEffect(() => {
    if (barraDiag && !stressLoaded && !stressLoading) {
      runStress();
    }
  }, [barraDiag]);

  return (
    <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-700/60 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm text-slate-200 font-semibold">
          🛡️ 风控总览 · 4 维度实时监控
        </h3>
        <div className="text-[10px] text-slate-500">
          业界标准（Barra / Axioma 客户仪表盘）
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 1. Barra 风险归因 */}
        <div className="bg-slate-800/60 border border-amber-700/30 rounded-lg p-3">
          <div className="text-xs text-amber-300 font-semibold mb-2 flex items-center justify-between">
            <span>🎯 Barra 风险归因</span>
            {barraDiag?.riskAttribution && (
              <span className="text-[10px] text-slate-400 font-normal">
                MCR 边际贡献
              </span>
            )}
          </div>
          {barraDiag?.riskAttribution ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-slate-400">组合 IR</span>
                <span className={`font-mono ${
                  barraDiag.informationRatio > 1.5 ? 'text-emerald-300' :
                  barraDiag.informationRatio < 0.5 ? 'text-red-300' : 'text-amber-300'
                }`}>{barraDiag.informationRatio.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-slate-400">因子风险占比</span>
                <span className="text-amber-200 font-mono">{(barraDiag.riskAttribution.totalFactorRisk * 100).toFixed(1)}%</span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-slate-400">特质风险占比</span>
                <span className="text-amber-200 font-mono">{(barraDiag.riskAttribution.specificRisk * 100).toFixed(1)}%</span>
              </div>
              <div className="border-t border-slate-700/50 pt-1.5 mt-1.5">
                <div className="text-[10px] text-slate-500 mb-1">Top 5 MCR 贡献：</div>
                {barraDiag.riskAttribution.marginalContribRisk.slice(0, 5).map((m, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px]">
                    <span className="text-slate-300 font-mono truncate max-w-[120px]" title={m.code}>{m.code}</span>
                    <div className="flex items-center gap-1">
                      <div className="w-16 h-1.5 bg-slate-900 rounded">
                        <div className="h-full bg-amber-500/80 rounded" style={{ width: `${Math.min(100, m.mcr * 100 / 30)}%` }} />
                      </div>
                      <span className="text-amber-200 font-mono w-10 text-right">{(m.mcr * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : barraDiag ? (
            <div className="text-[10px] text-slate-500 text-center py-2">
              Barra 数据已就绪（IR={barraDiag.informationRatio.toFixed(2)}），详细归因需后台算
            </div>
          ) : (
            <div className="text-[10px] text-slate-500 text-center py-2">未运行 Barra 优化</div>
          )}
        </div>

        {/* 2. WF 验证历史 */}
        <div className="bg-slate-800/60 border border-fuchsia-700/30 rounded-lg p-3">
          <div className="text-xs text-fuchsia-300 font-semibold mb-2 flex items-center justify-between">
            <span>📈 WF 验证历史</span>
            {wfTrend && (
              <span className="text-[10px] text-slate-400 font-normal">最近 {wfTrend.recentSeries.length} 次</span>
            )}
          </div>
          {wfTrend && wfTrend.recentSeries.length > 0 ? (
            <div>
              <div className="flex items-center justify-between text-[10px] mb-1">
                <span className="text-slate-400">平均评分</span>
                <span className="text-fuchsia-200 font-mono">{wfTrend.avgScore.toFixed(1)}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] mb-1">
                <span className="text-slate-400">趋势</span>
                <span className={`font-mono ${
                  wfTrend.trend === 'improving' ? 'text-emerald-300' :
                  wfTrend.trend === 'declining' ? 'text-red-300' :
                  wfTrend.trend === 'insufficient' ? 'text-slate-500' : 'text-slate-300'
                }`}>
                  {wfTrend.trend === 'improving' ? '↗ 改善' :
                   wfTrend.trend === 'declining' ? '↘ 下滑' :
                   wfTrend.trend === 'insufficient' ? '— 数据不足' : '→ 稳定'}
                </span>
              </div>
              {wfTrend.consecutiveBad > 0 && (
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span className="text-slate-400">连续 C/D</span>
                  <span className={`font-mono ${wfTrend.consecutiveBad >= 3 ? 'text-red-300' : 'text-amber-300'}`}>
                    × {wfTrend.consecutiveBad}
                  </span>
                </div>
              )}
              <WalkforwardSparkline data={wfTrend.recentSeries} width={280} height={50} />
              {wfTrend.alert && <div className="text-[10px] text-red-300 mt-1">{wfTrend.alert}</div>}
            </div>
          ) : (
            <div className="text-[10px] text-slate-500 text-center py-2">暂无 WF 历史</div>
          )}
        </div>

        {/* 3. 压力测试 */}
        <div className="bg-slate-800/60 border border-cyan-700/30 rounded-lg p-3">
          <div className="text-xs text-cyan-300 font-semibold mb-2 flex items-center justify-between">
            <span>📉 压力测试</span>
            {stress && (
              <span className="text-[10px] text-slate-400 font-normal">
                {stress.passedCount}/5 通过
              </span>
            )}
          </div>
          {stress ? (
            <div className="space-y-1">
              {stress.results.slice(0, 5).map((r: any) => (
                <div key={r.scenario} className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-300 truncate max-w-[100px]" title={r.name}>{r.name}</span>
                  <span className={`font-mono ${
                    r.expectedReturn < -20 ? 'text-red-300' :
                    r.expectedReturn < -10 ? 'text-amber-300' : 'text-emerald-300'
                  }`}>
                    {r.expectedReturn > 0 ? '+' : ''}{r.expectedReturn.toFixed(0)}%
                  </span>
                  <span className={r.passed ? 'text-emerald-400' : 'text-red-400'}>
                    {r.passed ? '✅' : '❌'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <button
              onClick={runStress}
              disabled={stressLoading}
              className="text-[10px] text-cyan-300 hover:text-cyan-200 underline"
            >
              {stressLoading ? '跑中…' : '→ 点击计算 5 场景压力测试'}
            </button>
          )}
        </div>

        {/* 4. 集中度 */}
        <div className="bg-slate-800/60 border border-violet-700/30 rounded-lg p-3">
          <div className="text-xs text-violet-300 font-semibold mb-2 flex items-center justify-between">
            <span>🛡️ 行业集中度</span>
            {concentration && (
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                concentration.rating === 'A+' || concentration.rating === 'A' ? 'text-emerald-300' :
                concentration.rating === 'D' ? 'text-red-300' : 'text-amber-300'
              }`}>{concentration.rating}</span>
            )}
          </div>
          {concentration ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-slate-400">HHI</span>
                <span className="text-violet-200 font-mono">{concentration.hhi.toFixed(3)}</span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-slate-400">多样性评分</span>
                <span className="text-violet-200 font-mono">{concentration.diversityScore}/100</span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-slate-400">超限行业</span>
                <span className={`font-mono ${concentration.industriesOverLimit.length > 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                  {concentration.industriesOverLimit.length}
                </span>
              </div>
              <div className="border-t border-slate-700/50 pt-1.5 mt-1.5">
                <div className="text-[10px] text-slate-500 mb-1">Top 3 行业：</div>
                {Object.entries(concentration.industryDistribution as Record<string, number>)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(([ind, w]) => (
                    <div key={ind} className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-300 truncate max-w-[120px]">{ind}</span>
                      <span className="text-violet-200 font-mono">{(w * 100).toFixed(1)}%</span>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div className="text-[10px] text-slate-500 text-center py-2">未跑 v2 评分</div>
          )}
        </div>
      </div>

      {/* 总评 */}
      <div className="mt-3 pt-3 border-t border-slate-700/40 text-[10px] text-slate-400">
        💡 <span className="text-slate-300">总评：</span>
        {barraDiag && concentration && wfTrend && stress ? (
          (() => {
            const issues: string[] = [];
            if (barraDiag.informationRatio < 0.5) issues.push('Barra IR 偏低（< 0.5）');
            if (concentration.industriesOverLimit.length > 0) issues.push(`集中度：${concentration.industriesOverLimit.length} 个行业超限`);
            if (wfTrend.consecutiveBad >= 3) issues.push(`WF 连续 C/D × ${wfTrend.consecutiveBad}`);
            if (stress.passedCount < 3) issues.push(`压力测试仅 ${stress.passedCount}/5 通过`);
            if (issues.length === 0) return <span className="text-emerald-300">✅ 4 维度全部健康 — 策略可正常运行</span>;
            return <span className="text-amber-300">⚠️ {issues.length} 项需关注：{issues.join(' / ')}</span>;
          })()
        ) : (
          <span>运行 Barra + v2 评分 + WF + 压力测试后给出总评</span>
        )}
      </div>
    </div>
  );
}