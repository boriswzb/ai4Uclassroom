/**
 * v2.1.1（2026-06-15）— Walk-Forward 历史趋势 Sparkline 折线图
 *
 * 用途：在 WF 面板展示"过去 30 次验证的评分变化趋势"
 *
 * 业界标准：sparkline 是 Edward Tufte 1983 年提出的概念
 *   - 信息密度高（无坐标轴标签，只显示形状）
 *   - 适合"看趋势但不需精确读数"的场景
 *   - 用颜色编码评级（A+ 绿 / A 绿 / B 黄 / C 橙 / D 红）
 *
 * 限制：
 *   - 只显示最近 30 条（更多会糊在一起）
 *   - 数据 < 2 条时不画线
 */

import React from 'react';

export interface SparklinePoint {
  timestamp: number;
  score: number;            // 0-100
  rating: string;           // 'A+' | 'A' | 'B' | 'C' | 'D'
  totalReturn: number;      // 累计收益（%）
  annualizedSharpe?: number;
  excessWinRate?: number;
}

interface SparklineProps {
  data: SparklinePoint[];
  width?: number;            // SVG 宽度
  height?: number;           // SVG 高度
  showLabels?: boolean;      // 是否显示首尾值标签
}

const RATING_COLOR: Record<string, string> = {
  'A+': '#10b981',  // emerald-500
  'A': '#34d399',   // emerald-400
  'B': '#f59e0b',   // amber-500
  'C': '#f97316',   // orange-500
  'D': '#ef4444',   // red-500
};

export function WalkforwardSparkline({
  data,
  width = 280,
  height = 60,
  showLabels = true,
}: SparklineProps) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-[10px]">
        {data.length === 0 ? '— 无历史数据' : '— 仅 1 条记录，待积累'}
      </div>
    );
  }

  // ── 坐标映射 ──
  const padding = 4;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const xs = data.map((_, i) => padding + (i / (data.length - 1)) * innerW);
  const ys = data.map(p => padding + (1 - p.score / 100) * innerH);

  // ── 折线路径 ──
  const pathD = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${ys[i].toFixed(2)}`).join(' ');

  // ── 面积填充（半透明渐变）──
  const areaD = `${pathD} L ${xs[xs.length - 1].toFixed(2)},${height - padding} L ${xs[0].toFixed(2)},${height - padding} Z`;

  // ── 首尾值（min/max 标记）──
  const scores = data.map(d => d.score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const lastScore = data[data.length - 1].score;
  const lastRating = data[data.length - 1].rating;
  const lastDate = new Date(data[data.length - 1].timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  const firstDate = new Date(data[0].timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

  return (
    <div className="relative">
      <svg width={width} height={height} className="block">
        {/* 渐变定义 */}
        <defs>
          <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={RATING_COLOR[lastRating] || '#94a3b8'} stopOpacity="0.4" />
            <stop offset="100%" stopColor={RATING_COLOR[lastRating] || '#94a3b8'} stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {/* 网格横线（25/50/75） */}
        <line x1={padding} y1={padding + innerH * 0.25} x2={width - padding} y2={padding + innerH * 0.25}
              stroke="#334155" strokeWidth="0.5" strokeDasharray="2 2" />
        <line x1={padding} y1={padding + innerH * 0.5} x2={width - padding} y2={padding + innerH * 0.5}
              stroke="#334155" strokeWidth="0.5" strokeDasharray="2 2" />
        <line x1={padding} y1={padding + innerH * 0.75} x2={width - padding} y2={padding + innerH * 0.75}
              stroke="#334155" strokeWidth="0.5" strokeDasharray="2 2" />

        {/* 面积 */}
        <path d={areaD} fill="url(#sparkfill)" />

        {/* 折线 */}
        <path d={pathD} fill="none" stroke={RATING_COLOR[lastRating] || '#94a3b8'} strokeWidth="1.5" strokeLinejoin="round" />

        {/* 节点圆点（按 rating 配色） */}
        {data.map((pt, i) => (
          <circle
            key={i}
            cx={xs[i]}
            cy={ys[i]}
            r={i === data.length - 1 ? 3 : 1.5}
            fill={RATING_COLOR[pt.rating] || '#94a3b8'}
            stroke={i === data.length - 1 ? '#fff' : 'none'}
            strokeWidth="1"
          >
            <title>
              {new Date(pt.timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {'\n'}评分 {pt.score} / {pt.rating}
              {'\n'}累计 {pt.totalReturn.toFixed(2)}%
              {pt.annualizedSharpe !== undefined && `\n夏普 ${pt.annualizedSharpe.toFixed(2)}`}
              {pt.excessWinRate !== undefined && `\n超额胜率 ${(pt.excessWinRate * 100).toFixed(0)}%`}
            </title>
          </circle>
        ))}

        {/* 首尾日期标签 */}
        {showLabels && (
          <>
            <text x={padding} y={height - 1} fill="#64748b" fontSize="8" textAnchor="start">
              {firstDate}
            </text>
            <text x={width - padding} y={height - 1} fill="#64748b" fontSize="8" textAnchor="end">
              {lastDate}
            </text>
          </>
        )}

        {/* 最大/最小标记 */}
        {showLabels && (
          <>
            <text x={padding + 2} y={padding + 8} fill="#10b981" fontSize="8" fontWeight="bold">
              ↑ {maxScore}
            </text>
            <text x={width - padding - 2} y={height - padding - 4} fill="#ef4444" fontSize="8" textAnchor="end">
              ↓ {minScore}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}