'use client';

/**
 * 智能选股器面板 - Professional Tabbed UI
 * Features: Market Status Banner, Categorized Templates, Grouped Filters,
 *           Expanded Result Columns with Score Bars, Factor Analysis & IC Deep Dive Tabs
 */
import { useState, useEffect, useCallback, useMemo } from 'react';

// 选股器→数据中心跳转的 sessionStorage key
const STOCK_DETAIL_KEY = 'screener_to_quote';
// 自定义事件（同一Tab内通信，无需刷新页面）
const STOCK_CLICK_EVENT = 'screener:stock-click';
import { getDataCache, genScreenerCacheKey, isMarketOpen } from '@/lib/quant/data/data-cache';
import { screenerPersistence } from '@/lib/quant/store/screener-persistence';
import { getQuantUserIdQuick } from '@/lib/quant/db/quant-user-identity';
import { getAllIndustries } from '@/lib/quant/industry-map';

interface ScreenerStock {
  code: string; name: string; price: number; changePercent: number;
  volume: number; amount: number; pe: number; pb: number;
  marketCap: number; floatCap: number; turnoverRate: number;
  industry: string; mainNetInflow: number;
  macdSignal?: string; kdjSignal?: string; maSignal?: string; bollSignal?: string;
  cciSignal?: string; obvSignal?: string; adxSignal?: string;
  score?: number;
  // Expanded fields
  revenueGrowth?: number; profitGrowth?: number; grossMargin?: number;
  roe?: number; debtRatio?: number; currentRatio?: number;
  forwardPe?: number; dividendYield?: number;
  // 多因子评分（来自 /api/stock/screener 的 scoreSort=true 模式）
  compositeScore?: number;
  moneyFlowScore?: number;
  mainNetInflowRatio?: number;
  volumeRatio?: number;
  momentumScore?: number;
  momentum5?: number;
  momentum20?: number;
  icScore?: number;
  irScore?: number;
  // 评分分解（8维度细分分）
  scoreBreakdown?: {
    valuation: number;      // 0-25
    momentum: number;        // 0-25
    moneyFlow: number;       // 0-20
    icIr: number;           // 0-15
    technical: number;      // 0-15
    changePercent: number;  // -5 ~ +5
    turnover: number;       // 0-5
    riskLevel: '低' | '中' | '高';
  };
}

interface FilterSummary {
  priceRange: [number, number]; peRange: [number, number];
  pbRange: [number, number]; mktCapRange: [number, number];
  turnoverRange: [number, number]; changeRange: [number, number];
  industryCounts: { industry: string; count: number }[];
  totalStocks: number;
}

interface ScreenerResult {
  stocks: ScreenerStock[];
  total: number; template: string; filters: FilterSummary;
  page: number; pageSize: number; hasTechFilter: boolean; success: boolean;
}

interface FactorICData {
  factor: string;
  ic: number;
  icir: number;
  rankIC: number;
  rankICIR: number;
  returns: { period: string; value: number }[];
  description: string;
  icValues?: number[];  // raw IC values for time series chart
}

// Template Categories
const TEMPLATE_CATEGORIES = [
  {
    id: 'technical',
    label: '技术策略',
    icon: '📊',
    templates: [
      { id: 'macdGolden', label: 'MACD金叉', icon: '✦', color: 'blue' },
      { id: 'kdjOversold', label: 'KDJ超卖', icon: '◈', color: 'purple' },
      { id: 'ma20Above', label: '站上MA20', icon: '↗', color: 'green' },
      { id: 'bollBreak', label: '布林突破', icon: '◉', color: 'orange' },
    ]
  },
  {
    id: 'value',
    label: '价值投资',
    icon: '💎',
    templates: [
      { id: 'lowPe', label: '低估值', icon: '▽', color: 'teal' },
      { id: 'value', label: '价值精选', icon: '◆', color: 'indigo' },
      { id: 'highDividend', label: '高股息', icon: '♢', color: 'cyan' },
      { id: 'blueChip', label: '蓝筹龙头', icon: '★', color: 'amber' },
    ]
  },
  {
    id: 'flow',
    label: '资金流向',
    icon: '💰',
    templates: [
      { id: 'hotMoney', label: '热门资金', icon: '▣', color: 'rose' },
      { id: 'mainInflow', label: '主力净流入', icon: '⬆', color: 'red' },
      { id: 'retailExit', label: '散户离场', icon: '⬇', color: 'emerald' },
      { id: 'marginFinancing', label: '融资买入', icon: '◐', color: 'violet' },
    ]
  },
  {
    id: 'combo',
    label: '综合优选',
    icon: '🎯',
    templates: [
      { id: 'combo', label: '综合选股', icon: '★', color: 'red' },
      { id: 'turnaround', label: '困境反转', icon: '↻', color: 'orange' },
      { id: 'growth', label: '成长精选', icon: '↗', color: 'pink' },
      { id: 'quality', label: '质量优先', icon: '✓', color: 'sky' },
    ]
  },
];

const SIGNAL_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  golden_cross: { label: 'MACD金叉', color: 'text-red-400', bg: 'bg-red-900/50' },
  dead_cross: { label: 'MACD死叉', color: 'text-green-400', bg: 'bg-green-900/50' },
  above_zero: { label: 'MACD零轴上', color: 'text-orange-400', bg: 'bg-orange-900/50' },
  below_zero: { label: 'MACD零轴下', color: 'text-blue-400', bg: 'bg-blue-900/50' },
  oversold: { label: 'KDJ超卖', color: 'text-purple-400', bg: 'bg-purple-900/50' },
  overbought: { label: 'KDJ超买', color: 'text-pink-400', bg: 'bg-pink-900/50' },
  above_ma20: { label: '站上MA20', color: 'text-green-400', bg: 'bg-green-900/50' },
  below_ma20: { label: '跌破MA20', color: 'text-red-400', bg: 'bg-red-900/50' },
  above_ma60: { label: '站上MA60', color: 'text-emerald-400', bg: 'bg-emerald-900/50' },
  below_ma60: { label: '跌破MA60', color: 'text-rose-400', bg: 'bg-rose-900/50' },
  above_upper: { label: '突破布林上轨', color: 'text-amber-400', bg: 'bg-amber-900/50' },
  below_lower: { label: '跌破布林下轨', color: 'text-cyan-400', bg: 'bg-cyan-900/50' },
  near_upper: { label: '贴近上轨', color: 'text-yellow-400', bg: 'bg-yellow-900/50' },
  near_lower: { label: '贴近下轨', color: 'text-lime-400', bg: 'bg-lime-900/50' },
  cci_oversold: { label: 'CCI超卖', color: 'text-violet-400', bg: 'bg-violet-900/50' },
  cci_overbought: { label: 'CCI超买', color: 'text-fuchsia-400', bg: 'bg-fuchsia-900/50' },
  cci_neutral: { label: 'CCI中性', color: 'text-slate-400', bg: 'bg-slate-800/50' },
  obv_rise: { label: 'OBV上升', color: 'text-emerald-400', bg: 'bg-emerald-900/50' },
  obv_fall: { label: 'OBV下降', color: 'text-rose-400', bg: 'bg-rose-900/50' },
  obv_neutral: { label: 'OBV中性', color: 'text-slate-400', bg: 'bg-slate-800/50' },
  strong_up: { label: '强势上涨', color: 'text-green-400', bg: 'bg-green-900/50' },
  strong_down: { label: '强势下跌', color: 'text-red-400', bg: 'bg-red-900/50' },
  weak: { label: '趋势不明', color: 'text-slate-400', bg: 'bg-slate-800/50' },
};

function SignalBadge({ signal }: { signal?: string }) {
  if (!signal) return null;
  const info = SIGNAL_LABELS[signal];
  if (!info) return null;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${info.color} ${info.bg}`}>
      {info.label}
    </span>
  );
}

// Score Bar Component
// compositeScore 范围约 0-80，归一化显示为 0-100%
// 颜色阈值与 FactorScoreStrategy 的买卖阈值保持一致（70买入/40卖出）
function ScoreBar({ score, maxScore = 100, onClick }: { score: number; maxScore?: number; onClick?: () => void }) {
  const percentage = Math.min(100, Math.max(0, (score / maxScore) * 100));
  const color = score >= 70 ? 'bg-green-500' : score >= 40 ? 'bg-blue-500' : 'bg-slate-500';
  return (
    <div
      className={`flex items-center gap-2 ${onClick ? 'cursor-pointer hover:opacity-80 active:scale-95 transition-all' : ''}`}
      onClick={onClick}
      title={onClick ? '点击查看评分详情' : undefined}
    >
      <div className="w-16 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${percentage}%` }} />
      </div>
      <span className={`text-xs font-bold ${score >= 70 ? 'text-green-400' : score >= 40 ? 'text-blue-400' : 'text-slate-400'}`}>
        {score.toFixed(1)}
      </span>
    </div>
  );
}

// ── 评分详情弹窗 ─────────────────────────────────────────────────────────────
interface ScoreDetailModalProps {
  stock: ScreenerStock;
  onClose: () => void;
}

function ScoreDetailModal({ stock, onClose }: ScoreDetailModalProps) {
  const bd = stock.scoreBreakdown;
  const total = stock.compositeScore ?? 0;

  const dimensions = bd ? [
    { label: '估值', score: bd.valuation, max: 25, detail: stock.pe > 0 ? `PE=${stock.pe.toFixed(1)}, PB=${stock.pb.toFixed(2)}` : '无数据' },
    { label: '动量', score: bd.momentum, max: 25, detail: stock.momentumScore ? `动量评分=${stock.momentumScore.toFixed(0)}` : '' },
    { label: '资金流', score: bd.moneyFlow, max: 20, detail: stock.mainNetInflowRatio ? `主力净流入占比=${stock.mainNetInflowRatio.toFixed(1)}%` : '' },
    { label: 'IC/IR', score: bd.icIr, max: 15, detail: stock.icScore ? `IC=${stock.icScore.toFixed(0)}, IR=${stock.irScore?.toFixed(1) ?? '—'}` : '无数据' },
    { label: '技术信号', score: bd.technical, max: 15, detail: [stock.macdSignal, stock.kdjSignal, stock.maSignal, stock.bollSignal].filter(Boolean).join(' · ') || '无' },
    { label: '涨跌幅', score: bd.changePercent, max: 5, detail: `${stock.changePercent > 0 ? '+' : ''}${stock.changePercent.toFixed(2)}%`, inverted: true },
    { label: '换手率', score: bd.turnover, max: 5, detail: stock.turnoverRate ? `换手率=${stock.turnoverRate.toFixed(2)}%` : '' },
  ] : [];

  const riskColor = bd?.riskLevel === '低' ? 'text-green-400' : bd?.riskLevel === '高' ? 'text-red-400' : 'text-yellow-400';
  const riskBg = bd?.riskLevel === '低' ? 'bg-green-900/50' : bd?.riskLevel === '高' ? 'bg-red-900/50' : 'bg-yellow-900/50';
  const scoreColor = total >= 70 ? 'text-green-400' : total >= 55 ? 'text-blue-400' : total >= 40 ? 'text-yellow-400' : 'text-slate-400';
  const level = total >= 70 ? '强烈推荐' : total >= 55 ? '推荐买入' : total >= 40 ? '谨慎关注' : '暂不推荐';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-[480px] max-h-[80vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <span className="text-white font-bold text-lg">{stock.name}</span>
            <span className="text-slate-400 text-sm">{stock.code}</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>
        {/* Score Overview */}
        <div className="px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-4 mb-3">
            <div className="text-4xl font-bold font-mono text-white">{total.toFixed(1)}</div>
            <div>
              <div className={`text-sm font-bold ${scoreColor}`}>{level}</div>
              <div className="text-xs text-slate-400 mt-0.5">综合评分（满分100）</div>
            </div>
            {bd && (
              <span className={`ml-auto px-2 py-1 rounded text-xs font-bold ${riskBg} ${riskColor}`}>
                风险等级：{bd.riskLevel}
              </span>
            )}
          </div>
          {/* Score Bar */}
          <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${total >= 70 ? 'bg-green-500' : total >= 40 ? 'bg-blue-500' : 'bg-slate-500'}`}
              style={{ width: `${Math.min(100, total)}%` }} />
          </div>
        </div>
        {/* Score Breakdown */}
        <div className="px-5 py-4">
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-3">评分构成</div>
          <div className="flex flex-col gap-3">
            {dimensions.map((dim) => {
              const pct = dim.max > 0 ? Math.min(100, Math.abs(dim.score) / dim.max * 100) : 0;
              const barColor = dim.score >= dim.max * 0.7 ? 'bg-green-500' : dim.score >= dim.max * 0.4 ? 'bg-blue-500' : 'bg-slate-600';
              return (
                <div key={dim.label} className="flex items-center gap-3">
                  <div className="w-16 text-xs text-slate-300 text-right shrink-0">{dim.label}</div>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div className={`h-full ${barColor} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-10 text-xs font-mono text-right shrink-0" style={{ color: dim.score < 0 ? '#f87171' : undefined }}>
                    {dim.score >= 0 ? '+' : ''}{dim.score.toFixed(1)}
                  </div>
                  <div className="w-24 text-xs text-slate-500 truncate shrink-0">{dim.detail}</div>
                </div>
              );
            })}
          </div>
        </div>
        {/* 风险提示 */}
        {bd?.riskLevel === '高' && (
          <div className="mx-5 mb-4 px-3 py-2 bg-red-900/40 border border-red-800 rounded-lg text-xs text-red-300">
            ⚠ 注意：该股估值偏高或财务风险较大，建议谨慎操作
          </div>
        )}
        {bd?.riskLevel === '中' && (
          <div className="mx-5 mb-4 px-3 py-2 bg-yellow-900/40 border border-yellow-800 rounded-lg text-xs text-yellow-300">
            ⚠ 注意：该股存在一定风险，建议结合其他指标综合判断
          </div>
        )}
        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 flex justify-between gap-2">
          <button
            onClick={() => {
              sessionStorage.setItem('screener_to_quote', JSON.stringify({ code: stock.code, name: stock.name }));
              window.dispatchEvent(new CustomEvent('screener:stock-click', { detail: { code: stock.code, name: stock.name } }));
              onClose();
            }}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg flex items-center gap-1.5"
          >
            📈 查看K线
          </button>
          <button onClick={onClose} className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg">关闭</button>
        </div>
      </div>
    </div>
  );
}

// ── 智能推荐组件（面向普通用户）───────────────────────────────────────────────
interface RecommendationProps {
  stock: ScreenerStock;
  onScoreClick?: (stock: ScreenerStock) => void;
}

function StarRating({ score }: { score: number }) {
  if (score >= 70) return <span className="text-yellow-400 text-sm">⭐⭐⭐⭐⭐</span>;
  if (score >= 55) return <span className="text-yellow-400 text-sm">⭐⭐⭐⭐</span>;
  if (score >= 40) return <span className="text-yellow-400 text-sm">⭐⭐⭐</span>;
  return <span className="text-slate-500 text-sm">⭐⭐</span>;
}

function StockRecommendation({ stock, onScoreClick }: RecommendationProps) {
  const bd = stock.scoreBreakdown;
  const reasons: { icon: string; text: string; color: string }[] = [];
  const score = stock.compositeScore ?? 0;

  // 基于 scoreBreakdown 的多维度推荐理由
  if (bd) {
    if (bd.valuation >= 18) reasons.push({ icon: '💎', text: `估值优势突出 (${bd.valuation}/25)`, color: 'text-green-400' });
    else if (bd.valuation >= 12) reasons.push({ icon: '📊', text: `估值合理 (${bd.valuation}/25)`, color: 'text-blue-400' });

    if (bd.momentum >= 18) reasons.push({ icon: '🚀', text: `动量强劲 (${bd.momentum}/25)`, color: 'text-green-400' });
    else if (bd.momentum >= 12) reasons.push({ icon: '↗', text: `动量尚可 (${bd.momentum}/25)`, color: 'text-blue-400' });

    if (bd.moneyFlow >= 15) reasons.push({ icon: '💰', text: `主力资金大幅流入 (${bd.moneyFlow}/20)`, color: 'text-green-400' });
    else if (bd.moneyFlow >= 10) reasons.push({ icon: '💵', text: `资金面改善 (${bd.moneyFlow}/20)`, color: 'text-blue-400' });

    if (bd.icIr >= 10) reasons.push({ icon: '🎯', text: `因子有效性高 (${bd.icIr}/15)`, color: 'text-green-400' });

    if (bd.technical >= 10) reasons.push({ icon: '📈', text: `技术信号强势 (${bd.technical}/15)`, color: 'text-green-400' });

    if (bd.riskLevel === '低') reasons.push({ icon: '🛡', text: '风险等级：低（财务稳健）', color: 'text-green-400' });
    else if (bd.riskLevel === '高') reasons.push({ icon: '⚠', text: '风险等级：高（注意风险）', color: 'text-red-400' });
  }

  // 兜底：无 scoreBreakdown 时用原有逻辑
  if (!bd || reasons.length === 0) {
    if (stock.pe > 0 && stock.pe < 15) reasons.push({ icon: '💎', text: `PE仅${stock.pe.toFixed(1)}，估值偏低`, color: 'text-green-400' });
    else if (stock.pe > 0 && stock.pe < 25) reasons.push({ icon: '📊', text: `PE适中(${stock.pe.toFixed(1)})，估值合理`, color: 'text-blue-400' });
    if (stock.mainNetInflowRatio && stock.mainNetInflowRatio > 5) reasons.push({ icon: '💰', text: `主力净流入占比${stock.mainNetInflowRatio.toFixed(1)}%`, color: 'text-green-400' });
    else if (stock.mainNetInflow > 0) reasons.push({ icon: '💵', text: `主力净流入${stock.mainNetInflow.toFixed(0)}万`, color: 'text-blue-400' });
    if (stock.macdSignal === 'golden_cross') reasons.push({ icon: '📈', text: 'MACD金叉，技术看涨', color: 'text-green-400' });
    if (stock.volumeRatio && stock.volumeRatio > 2) reasons.push({ icon: '📊', text: `量比${stock.volumeRatio.toFixed(1)}，成交量大幅放大`, color: 'text-green-400' });
  }

  // 限制显示2条
  const topReasons = reasons.slice(0, 2);
  const level = score >= 70 ? '强烈推荐' : score >= 55 ? '推荐买入' : score >= 40 ? '谨慎关注' : '暂不推荐';
  const scoreColor = score >= 70 ? 'text-green-400' : score >= 55 ? 'text-blue-400' : score >= 40 ? 'text-yellow-400' : 'text-slate-400';

  return (
    <div className="flex flex-col gap-0.5 py-0.5">
      {/* 星级 + 推荐等级 + 分数 一行 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <StarRating score={score} />
        <span className={`text-xs font-bold ${scoreColor}`}>{level}</span>
        {/* 点击分数可查看详情 */}
        <button
          className={`text-xs font-mono font-bold ml-auto ${scoreColor} hover:underline cursor-pointer`}
          onClick={() => onScoreClick?.(stock)}
          title="点击查看评分详情"
        >
          {score.toFixed(1)}
        </button>
      </div>
      {/* 推荐理由 */}
      {topReasons.length > 0 ? (
        <div className="text-xs text-slate-400 leading-relaxed">
          {topReasons.map((r, i) => (
            <div key={i} className="flex items-start gap-1">
              <span className="shrink-0">{r.icon}</span>
              <span className={`truncate ${r.color}`}>{r.text}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-slate-600">综合评分 {score.toFixed(1)}</div>
      )}
    </div>
  );
}

// Market Status Banner
function MarketStatusBanner() {
  const [time, setTime] = useState(new Date());
  const marketOpen = isMarketOpen();
  
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (d: Date) => d.toLocaleTimeString('zh-CN', { hour12: false });
  const formatDate = (d: Date) => d.toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className={`flex items-center justify-between px-4 py-2 rounded-lg mb-4 ${
      marketOpen ? 'bg-green-900/30 border border-green-700/50' : 'bg-slate-800/50 border border-slate-700'
    }`}>
      <div className="flex items-center gap-3">
        <div className={`w-2.5 h-2.5 rounded-full ${marketOpen ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
        <span className={`text-sm font-medium ${marketOpen ? 'text-green-400' : 'text-slate-400'}`}>
          {marketOpen ? '● 实时行情' : '○ 休市'}
        </span>
        <span className="text-xs text-slate-500">|</span>
        <span className="text-sm text-slate-300">{formatDate(time)}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-xs text-slate-400">交易日</span>
        <span className="text-sm font-mono text-slate-200">{formatTime(time)}</span>
      </div>
    </div>
  );
}

// Filter Group Component
function FilterGroup({ title, icon, children, defaultOpen = false }: {
  title: string; icon: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-800/80 hover:bg-slate-800 text-sm font-medium text-slate-200 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span>{icon}</span> {title}
        </span>
        <span className={`transform transition-transform ${isOpen ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {isOpen && <div className="p-3 bg-slate-800/40">{children}</div>}
    </div>
  );
}

interface ScreenerPanelProps {
  onLaunchSimulator?: (config: {
    strategyType: string;
    codes: string[];
    strategyParams?: Record<string, unknown>;  // 因子配置等参数
  }) => void;
  /** 点击股票名称 → 跳转 DataPanel 打开行情弹窗 */
  onStockClick?: (code: string, name: string) => void;
}

type TabType = 'screener' | 'factor' | 'ic' | 'portfolio';

// Factor display name mapping
const factorDisplayName = (key: string): string => ({
  momentum5: '动量5日', momentum20: '动量20日', momentum60: '动量60日',
  momentum: '综合动量', rsi: 'RSI', mfi: 'MFI', williamsR: '威廉R',
  adx: 'ADX', volatility: '波动率', macd: 'MACD', kdj: 'KDJ',
  bollPosition: '布林位置', bias: '乖离率',
}[key] || key);

// Factor description mapping
const factorDescriptions: Record<string, string> = {
  momentum5: '5日收益率因子，短线动量',
  momentum20: '20日收益率因子，中线动量',
  momentum60: '60日收益率因子，长线动量',
  momentum: '综合动量因子，多周期加权',
  rsi: '相对强弱指数，超买超卖信号',
  mfi: '资金流量指标，量价结合',
  williamsR: '威廉指标，趋势强度',
  adx: '平均趋向指数，趋势确认',
  volatility: '波动率因子，ATR标准化',
  macd: 'MACD信号，趋势方向',
  kdj: 'KDJ指标，随机指标',
  bollPosition: '布林带位置，中轨相对位置',
  bias: '乖离率，价格偏离均线程度',
};

// Pearson correlation coefficient
function pearsonCorr(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const dx_i = x[i] - mx, dy_i = y[i] - my;
    num += dx_i * dy_i;
    dx += dx_i * dx_i;
    dy += dy_i * dy_i;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : Math.max(-1, Math.min(1, num / den));
}

// Mock Factor IC Data (in production, this would come from API)
const MOCK_FACTOR_IC: FactorICData[] = [
  { factor: 'PE', ic: 0.08, icir: 0.65, rankIC: 0.11, rankICIR: 0.72, returns: [{ period: '5日', value: 2.3 }, { period: '20日', value: 5.1 }], description: '市盈率倒数，估值修复逻辑' },
  { factor: 'PB', ic: 0.06, icir: 0.58, rankIC: 0.09, rankICIR: 0.61, returns: [{ period: '5日', value: 1.8 }, { period: '20日', value: 4.2 }], description: '市净率，破产清算价值' },
  { factor: 'ROE', ic: 0.12, icir: 0.81, rankIC: 0.15, rankICIR: 0.88, returns: [{ period: '5日', value: 3.1 }, { period: '20日', value: 8.5 }], description: '净资产收益率，盈利能力' },
  { factor: 'RevenueGrowth', ic: 0.09, icir: 0.71, rankIC: 0.13, rankICIR: 0.79, returns: [{ period: '5日', value: 2.5 }, { period: '20日', value: 6.2 }], description: '营收增长率，成长性' },
  { factor: 'ProfitGrowth', ic: 0.11, icir: 0.76, rankIC: 0.14, rankICIR: 0.82, returns: [{ period: '5日', value: 2.9 }, { period: '20日', value: 7.8 }], description: '净利润增长率，业绩弹性' },
  { factor: 'TurnoverRate', ic: 0.07, icir: 0.62, rankIC: 0.10, rankICIR: 0.68, returns: [{ period: '5日', value: 1.9 }, { period: '20日', value: 4.8 }], description: '换手率，资金活跃度' },
  { factor: 'MainNetInflow', ic: 0.14, icir: 0.85, rankIC: 0.18, rankICIR: 0.91, returns: [{ period: '5日', value: 3.8 }, { period: '20日', value: 9.2 }], description: '主力净流入，资金推动' },
  { factor: 'MACD_Signal', ic: 0.05, icir: 0.48, rankIC: 0.08, rankICIR: 0.55, returns: [{ period: '5日', value: 1.2 }, { period: '20日', value: 3.1 }], description: 'MACD技术信号' },
];

// IC Card Component
function ICCard({ data }: { data: FactorICData }) {
  const icColor = data.ic > 0.1 ? 'text-green-400' : data.ic > 0.05 ? 'text-blue-400' : 'text-slate-400';
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 hover:border-slate-600 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="text-white font-semibold">{data.factor}</h4>
          <p className="text-xs text-slate-500 mt-0.5">{data.description}</p>
        </div>
        <div className={`text-2xl font-bold ${icColor}`}>
          IC {data.ic.toFixed(2)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-slate-900/50 rounded p-2">
          <div className="text-xs text-slate-500">IC_IR</div>
          <div className="text-sm font-medium text-slate-300">{data.icir.toFixed(2)}</div>
        </div>
        <div className="bg-slate-900/50 rounded p-2">
          <div className="text-xs text-slate-500">Rank IC</div>
          <div className="text-sm font-medium text-slate-300">{data.rankIC.toFixed(2)}</div>
        </div>
        <div className="bg-slate-900/50 rounded p-2">
          <div className="text-xs text-slate-500">Rank ICIR</div>
          <div className="text-sm font-medium text-slate-300">{data.rankICIR.toFixed(2)}</div>
        </div>
        <div className="bg-slate-900/50 rounded p-2">
          <div className="text-xs text-slate-500">5日收益</div>
          <div className={`text-sm font-medium ${data.returns[0].value >= 0 ? 'text-red-400' : 'text-green-400'}`}>
            {data.returns[0].value >= 0 ? '+' : ''}{data.returns[0].value.toFixed(1)}%
          </div>
        </div>
      </div>
      <div className="flex gap-1">
        {data.returns.map(r => (
          <div key={r.period} className={`flex-1 text-center py-1 rounded text-xs font-medium ${
            r.value >= 0 ? 'bg-red-900/30 text-red-400' : 'bg-green-900/30 text-green-400'
          }`}>
            {r.period}: {r.value >= 0 ? '+' : ''}{r.value.toFixed(1)}%
          </div>
        ))}
      </div>
    </div>
  );
}

// Main Component
export default function ScreenerPanel({ onLaunchSimulator, onStockClick }: ScreenerPanelProps) {
  const RESULT_CACHE_PREFIX = 'screener_result_page_';
  const PAGE_CACHE_KEY = 'screener_page_cache';

  const [activeTab, setActiveTab] = useState<TabType>('screener');
  const [result, setResult] = useState<ScreenerResult | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const cachedPage = localStorage.getItem(PAGE_CACHE_KEY);
      const page = cachedPage ? parseInt(cachedPage, 10) : 1;
      const cached = localStorage.getItem(RESULT_CACHE_PREFIX + page);
      return cached ? JSON.parse(cached) : null;
    } catch { return null; }
  });
  const [loading, setLoading] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<string>('');
  const [page, setPage] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    try {
      const cached = localStorage.getItem(PAGE_CACHE_KEY);
      return cached ? parseInt(cached, 10) : 1;
    } catch { return 1; }
  });
  const pageSize = 30;

  // 评分详情弹窗 state
  const [scoreModalStock, setScoreModalStock] = useState<ScreenerStock | null>(null);

  // Filter states
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [industry, setIndustry] = useState('不限');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [peMin, setPeMin] = useState('');
  const [peMax, setPeMax] = useState('');
  const [pbMin, setPbMin] = useState('');
  const [pbMax, setPbMax] = useState('');
  const [mktCapMin, setMktCapMin] = useState('');
  const [mktCapMax, setMktCapMax] = useState('');
  const [turnoverMin, setTurnoverMin] = useState('');
  const [changeMin, setChangeMin] = useState('');
  const [changeMax, setChangeMax] = useState('');
  const [excludeSt, setExcludeSt] = useState(true);
  const [sortBy, setSortBy] = useState('changePercent');
  const [sortOrder, setSortOrder] = useState('desc');
  const [scoreSort, setScoreSort] = useState(true); // 默认开启因子综合评分排序
  const [filtersRestored, setFiltersRestored] = useState(false); // 等 restoreFilters 完成后再 fetch，避免竞态
  const [selectedForTrade, setSelectedForTrade] = useState<Set<string>>(new Set());

  // Technical filters
  const [techSignal, setTechSignal] = useState('不限');
  const [maFilter, setMaFilter] = useState('不限');
  const [bollFilter, setBollFilter] = useState('不限');
  const [cciFilter, setCciFilter] = useState('不限');
  const [obvFilter, setObvFilter] = useState('不限');
  const [adxFilter, setAdxFilter] = useState('不限');

  // Portfolio state
  const [portfolioTab, setPortfolioTab] = useState<'list' | 'history'>('list');
  const [portfolioStocks, setPortfolioStocks] = useState<{
    code: string; name: string; price: number; changePercent: number;
    holdShares: number; avgCost: number; currentValue: number; pnl: number; pnlPercent: number;
    factorScore?: number;  // 因子综合评分（从选股结果直接引用，无需重fetch）
  }[]>([]);
  const [portfolioLoading, setPortfolioLoading] = useState(false);

  // Restore portfolio from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('quant_portfolio_stocks');
      if (saved) setPortfolioStocks(JSON.parse(saved));
    } catch (e) { /* ignore */ }
  }, []);

  // Persist portfolio to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('quant_portfolio_stocks', JSON.stringify(portfolioStocks));
    } catch (e) { /* ignore */ }
  }, [portfolioStocks]);

  // Sentiment filters
  const [sentimentFilter, setSentimentFilter] = useState('不限');
  const [ratingFilter, setRatingFilter] = useState('不限');

  // Factor Analysis state
  const [selectedFactors, setSelectedFactors] = useState<string[]>(['ROE', 'MainNetInflow', 'ProfitGrowth']);
  const [factorPeriod, setFactorPeriod] = useState('20日');
  const [selectedIcFactor, setSelectedIcFactor] = useState<string>('');
  const [factorAnalysisData, setFactorAnalysisData] = useState<{
    icAnalysis: FactorICData[];
    correlationMatrix: number[][];
    factorNames: string[];
    loading: boolean;
  }>({ icAnalysis: [], correlationMatrix: [], factorNames: [], loading: false });

  // Restore factor config from localStorage
  useEffect(() => {
    const saved = screenerPersistence.getFactorConfig();
    if (saved) {
      if (saved.selectedFactors.length > 0) setSelectedFactors(saved.selectedFactors);
      if (saved.factorPeriod) setFactorPeriod(saved.factorPeriod);
    }
  }, []);

  // Save factor config when it changes
  useEffect(() => {
    screenerPersistence.saveFactorConfig({ selectedFactors, factorPeriod });
  }, [selectedFactors, factorPeriod]);

  // Build params
  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    p.set('limit', String(pageSize));
    p.set('offset', String((page - 1) * pageSize));
    if (activeTemplate) p.set('template', activeTemplate);
    if (industry !== '不限') p.set('industry', industry);
    if (priceMin) p.set('priceMin', priceMin);
    if (priceMax) p.set('priceMax', priceMax);
    if (peMin) p.set('peMin', peMin);
    if (peMax) p.set('peMax', peMax);
    if (pbMin) p.set('pbMin', pbMin);
    if (pbMax) p.set('pbMax', pbMax);
    if (mktCapMin) p.set('mktCapMin', mktCapMin);
    if (mktCapMax) p.set('mktCapMax', mktCapMax);
    if (turnoverMin) p.set('turnoverMin', turnoverMin);
    if (changeMin) p.set('changeMin', changeMin);
    if (changeMax) p.set('changeMax', changeMax);
    if (!excludeSt) p.set('excludeSt', 'false');
    if (techSignal !== '不限') p.set('techSignal', techSignal);
    if (maFilter !== '不限') p.set('maFilter', maFilter);
    if (bollFilter !== '不限') p.set('bollFilter', bollFilter);
    if (cciFilter !== '不限') p.set('cciFilter', cciFilter);
    if (obvFilter !== '不限') p.set('obvFilter', obvFilter);
    if (adxFilter !== '不限') p.set('adxFilter', adxFilter);
    if (sentimentFilter !== '不限') p.set('sentiment', sentimentFilter);
    if (ratingFilter !== '不限') p.set('rating', ratingFilter);
    // scoreSort 参数始终传递（后端根据此参数决定是否计算综合评分）
    p.set('scoreSort', scoreSort ? 'true' : 'false');
    if (!scoreSort) { p.set('sortBy', sortBy); p.set('sortOrder', sortOrder); }
    return p.toString();
  }, [activeTemplate, industry, priceMin, priceMax, peMin, peMax, pbMin, pbMax,
      mktCapMin, mktCapMax, turnoverMin, changeMin, changeMax, excludeSt,
      techSignal, maFilter, bollFilter, cciFilter, obvFilter, adxFilter, sentimentFilter, ratingFilter,
      scoreSort, sortBy, sortOrder, page]);

  // Restore filters
  const restoreFilters = useCallback(async () => {
    const userId = getQuantUserIdQuick();
    if (!userId) { setFiltersRestored(true); return; }
    const last = await screenerPersistence.getLastHistory(userId);
    if (!last) { setFiltersRestored(true); return; }
    const f = last.filters;
    setIndustry(f.industry); setPriceMin(f.priceMin); setPriceMax(f.priceMax);
    setPeMin(f.peMin); setPeMax(f.peMax); setPbMin(f.pbMin); setPbMax(f.pbMax);
    setMktCapMin(f.mktCapMin); setMktCapMax(f.mktCapMax); setTurnoverMin(f.turnoverMin);
    setChangeMin(f.changeMin); setChangeMax(f.changeMax); setExcludeSt(f.excludeSt);
    setSortBy(f.sortBy ?? 'changePercent'); setSortOrder(f.sortOrder ?? 'desc');
    setScoreSort(f.scoreSort ?? true);
    setTechSignal(f.techSignal); setMaFilter(f.maFilter); setBollFilter(f.bollFilter);
    setCciFilter(f.cciFilter); setObvFilter(f.obvFilter); setAdxFilter(f.adxFilter);
    setSentimentFilter(f.sentimentFilter); setRatingFilter(f.ratingFilter);
    setFiltersRestored(true);
  }, []);

  useEffect(() => { restoreFilters(); }, [restoreFilters]);

  // Fetch screener
  const fetchScreener = useCallback(async () => {
      if (!filtersRestored) return;
      setLoading(true);
      const startTime = Date.now();
      const userId = getQuantUserIdQuick();
      try {
        const params = buildParams();
        const res = await fetch(`/api/stock/screener?${params}`);
        const json = await res.json();
        let finalData = json;
        if (json.success) {
          setResult(json);
          localStorage.setItem(RESULT_CACHE_PREFIX + json.page, JSON.stringify(json));
          setPage(json.page);
          localStorage.setItem(PAGE_CACHE_KEY, String(json.page));
          setFromCache(false);
        }
        if (userId && finalData?.stocks) {
          const filters = {
            industry, priceMin, priceMax, peMin, peMax, pbMin, pbMax,
            mktCapMin, mktCapMax, turnoverMin, changeMin, changeMax, excludeSt,
            sortBy, sortOrder, scoreSort, techSignal, maFilter, bollFilter,
            cciFilter, obvFilter, adxFilter, sentimentFilter, ratingFilter,
          };
          const topCodes = finalData.stocks.slice(0, 10).map((s: ScreenerStock) => s.code);
          screenerPersistence.saveHistory(userId, filters, finalData.total, topCodes, Date.now() - startTime);
        }
    } catch (e) { console.error('[Screener]', e); }
    finally { setLoading(false); }
  }, [buildParams, page, industry, priceMin, priceMax, peMin, peMax, pbMin, pbMax,
      mktCapMin, mktCapMax, turnoverMin, changeMin, changeMax, excludeSt,
      sortBy, sortOrder, scoreSort, techSignal, maFilter, bollFilter,
      cciFilter, obvFilter, adxFilter, sentimentFilter, ratingFilter, filtersRestored]);

  useEffect(() => { fetchScreener(); }, [fetchScreener]);

  // Fetch real factor analysis when switching to factor/ic tabs
  // v2 API 只返回 diagnostics.icStats（一次性快照），不再返回 cumulativeIC 时序；
  // 此 tab 暂时仅展示"当前 IC 柱状图"，时序 IC 走 localStorage 增量
  useEffect(() => {
    if (activeTab !== 'factor' && activeTab !== 'ic') return;
    if (factorAnalysisData.icAnalysis.length > 0) return; // already loaded

    setFactorAnalysisData(prev => ({ ...prev, loading: true }));
    fetch('/api/stock/factor-analysis-v2?action=scores&limit=50&forwardPeriod=20&filterFlags=true&weightMode=default&icHistory=0')
      .then(r => r.json())
      .then(data => {
        if (!data.success) throw new Error(data.error || 'API error');
        // v2: 从 diagnostics.icStats 提取每维度的当前 IC（结构与 v1 不同）
        const icStats = data.diagnostics?.icStats || {};
        const icList: FactorICData[] = Object.entries(icStats as Record<string, { ic: number; ir: number; n: number }>).map(
          ([dim, stat]) => ({
            factor: factorDisplayName(dim),
            ic: stat.ic ?? 0,
            icir: stat.ir ?? 0,
            rankIC: stat.ic ?? 0,
            rankICIR: stat.ir ?? 0,
            returns: [
              { period: '当前', value: +((stat.ic ?? 0) * 100).toFixed(2) },
            ],
            description: factorDescriptions[dim] || dim,
            icValues: [],
          })
        );

        // Compute Pearson correlation matrix from v2 rawFactors
        type FactorScoreEntry = { rawFactors?: Record<string, number> };
        const results: FactorScoreEntry[] = data.results || [];
        const factorKeys = ['momentum5', 'momentum20', 'rsi', 'mfi', 'williamsR', 'adx', 'bias', 'macd'];
        const validFactors = factorKeys.filter(f => results[0]?.rawFactors?.[f] !== undefined);
        const corrMatrix: number[][] = [];
        for (let i = 0; i < validFactors.length; i++) {
          corrMatrix[i] = [];
          for (let j = 0; j < validFactors.length; j++) {
            if (i === j) { corrMatrix[i][j] = 1; continue; }
            const fi = validFactors[i];
            const fj = validFactors[j];
            const x = results.map(r => r.rawFactors?.[fi] ?? 0);
            const y = results.map(r => r.rawFactors?.[fj] ?? 0);
            corrMatrix[i][j] = pearsonCorr(x, y);
          }
        }

        setFactorAnalysisData({
          icAnalysis: icList,
          correlationMatrix: corrMatrix,
          factorNames: validFactors.map(factorDisplayName),
          loading: false,
        });
      })
      .catch(err => {
        console.error('[FactorAnalysis] fetch error:', err);
        setFactorAnalysisData(prev => ({ ...prev, loading: false }));
      });
  }, [activeTab]);

  const handleTemplate = (id: string) => {
    setActiveTemplate(id);
    setPage(1);
    setIndustry('不限'); setPriceMin(''); setPriceMax('');
    setPeMin(''); setPeMax(''); setPbMin(''); setPbMax('');
    setMktCapMin(''); setMktCapMax(''); setTurnoverMin('');
    setChangeMin(''); setChangeMax('');
    setTechSignal('不限'); setMaFilter('不限'); setBollFilter('不限');
    setSentimentFilter('不限'); setRatingFilter('不限');
    // 快捷模板默认开启综合评分排序
  };

  const handleSearch = () => { setActiveTemplate(''); setPage(1); fetchScreener(); };

  const exportCSV = (stocks: ScreenerStock[]) => {
    const headers = ['代码', '名称', '现价', '涨跌幅%', '成交量', '成交额', 'PE', 'PB', '市值(亿)', '流通市值(亿)', '换手率%', '行业', 'MACD信号', 'KDJ信号', '均线信号', '布林带信号', 'CCI信号', 'OBV信号', 'ADX信号', '综合评分'];
    const rows = stocks.map(s => [
      s.code, s.name, s.price?.toFixed(2) ?? '', s.changePercent?.toFixed(2) ?? '',
      s.volume ?? '', s.amount ?? '', s.pe ?? '', s.pb ?? '',
      s.marketCap ? (s.marketCap / 1e8).toFixed(2) : '', s.floatCap ? (s.floatCap / 1e8).toFixed(2) : '',
      s.turnoverRate?.toFixed(2) ?? '', s.industry || '',
      s.macdSignal || '', s.kdjSignal || '', s.maSignal || '', s.bollSignal || '',
      s.cciSignal || '', s.obvSignal || '', s.adxSignal || '',
      s.compositeScore?.toFixed(2) ?? ''
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `screener_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    setActiveTemplate(''); setIndustry('不限'); setPriceMin(''); setPriceMax('');
    setPeMin(''); setPeMax(''); setPbMin(''); setPbMax('');
    setMktCapMin(''); setMktCapMax(''); setTurnoverMin('');
    setChangeMin(''); setChangeMax(''); setTechSignal('不限');
    setMaFilter('不限'); setBollFilter('不限'); setScoreSort(false);
    setSortBy('changePercent'); setSortOrder('desc');
  };

  const totalPages = result ? Math.ceil(result.total / pageSize) : 1;
  // 行业列表优先用完整行业体系（industry-map），同时叠加API返回的实际分布计数
  const allIndustryOptions = useMemo(() => {
    const staticIndustries = getAllIndustries(); // 证监会完整行业列表
    const apiIndustries = result?.filters?.industryCounts || [];
    const apiMap = new Map(apiIndustries.map(i => [i.industry, i.count]));
    // 合并：静态行业 + API中有但静态没有的行业（如ST等特殊标签）
    const merged = new Map<string, number>();
    for (const ind of staticIndustries) merged.set(ind, apiMap.get(ind) || 0);
    for (const { industry, count } of apiIndustries) {
      if (!merged.has(industry)) merged.set(industry, count);
    }
    return [...merged.entries()]
      .filter(([, count]) => count > 0) // 只保留有股票的
      .sort((a, b) => b[1] - a[1]) // 按数量降序
      .map(([industry, count]) => ({ industry, count }));
  }, [result]);

  // Tabs
  const tabs: { id: TabType; label: string; icon: string }[] = [
    { id: 'screener', label: '选股', icon: '🔍' },
    { id: 'factor', label: '因子分析', icon: '📈' },
    { id: 'ic', label: 'IC透视', icon: '🎯' },
    { id: 'portfolio', label: '持仓管理', icon: '💼' },
  ];

  // Render Tab Content
  const renderTabContent = () => {
    switch (activeTab) {
      case 'factor':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">因子分析</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">周期:</span>
                {['5日', '20日', '60日'].map(p => (
                  <button key={p} onClick={() => setFactorPeriod(p)}
                    className={`px-3 py-1 text-xs rounded-full ${factorPeriod === p ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            {factorAnalysisData.loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
                <span className="ml-3 text-slate-400">正在计算因子IC，请稍候...</span>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {(factorAnalysisData.icAnalysis.length > 0 ? factorAnalysisData.icAnalysis : MOCK_FACTOR_IC).map(f => (
                    <ICCard key={f.factor} data={f} />
                  ))}
                </div>
                <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
                  <h4 className="text-white font-medium mb-3">因子相关性矩阵</h4>
                  {factorAnalysisData.correlationMatrix.length > 0 ? (
                    <div className={`grid gap-1 text-xs`} style={{ gridTemplateColumns: `auto repeat(${factorAnalysisData.factorNames.length}, 1fr)` }}>
                      <div className="text-slate-500 p-1"></div>
                      {factorAnalysisData.factorNames.map(f => (
                        <div key={f} className="text-slate-400 p-1 text-center truncate" title={f}>{f}</div>
                      ))}
                      {factorAnalysisData.correlationMatrix.map((row, i) => (
                        <div key={`row-${i}`} className="contents">
                          <div className="text-slate-400 p-1 truncate" title={factorAnalysisData.factorNames[i]}>{factorAnalysisData.factorNames[i]}</div>
                          {row.map((val, j) => {
                            const isHigh = Math.abs(val) > 0.5;
                            return (
                              <div key={`${i}-${j}`}
                                className={`p-1 text-center rounded ${isHigh ? 'bg-red-900/50 text-red-400' : 'bg-slate-900/50 text-slate-300'}`}>
                                {val.toFixed(2)}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-9 gap-1 text-xs">
                      <div className="text-slate-500 p-1"></div>
                      {MOCK_FACTOR_IC.slice(0, 8).map(f => (
                        <div key={f.factor} className="text-slate-400 p-1 text-center truncate" title={f.factor}>{f.factor}</div>
                      ))}
                      {MOCK_FACTOR_IC.slice(0, 8).map(row => (
                        <div key={`row-${row.factor}`} className="contents">
                          <div className="text-slate-400 p-1 truncate" title={row.factor}>{row.factor}</div>
                          {MOCK_FACTOR_IC.slice(0, 8).map(col => {
                            const val = row.factor === col.factor ? 1 : (Math.random() * 0.6 - 0.3);
                            const isHigh = Math.abs(val) > 0.5;
                            return (
                              <div key={`${row.factor}-${col.factor}`}
                                className={`p-1 text-center rounded ${isHigh ? 'bg-red-900/50 text-red-400' : 'bg-slate-900/50 text-slate-300'}`}>
                                {val.toFixed(2)}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        );

      case 'ic':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">IC透视</h3>
              <div className="flex items-center gap-2 text-xs">
                <span className="px-2 py-1 bg-green-900/50 text-green-400 rounded">IC &gt; 0.1 强</span>
                <span className="px-2 py-1 bg-blue-900/50 text-blue-400 rounded">0.05 &lt; IC &lt; 0.1 中</span>
                <span className="px-2 py-1 bg-slate-700 text-slate-400 rounded">IC &lt; 0.05 弱</span>
              </div>
            </div>
            {factorAnalysisData.loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
                <span className="ml-3 text-slate-400">正在计算IC，请稍候...</span>
              </div>
            ) : (
              <>
                <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-900 border-b border-slate-700">
                      <tr>
                        <th className="px-4 py-3 text-left text-slate-300 font-semibold">因子</th>
                        <th className="px-4 py-3 text-right text-slate-300 font-semibold">IC</th>
                        <th className="px-4 py-3 text-right text-slate-300 font-semibold">IC_IR</th>
                        <th className="px-4 py-3 text-right text-slate-300 font-semibold">Rank IC</th>
                        <th className="px-4 py-3 text-right text-slate-300 font-semibold">Rank ICIR</th>
                        <th className="px-4 py-3 text-right text-slate-300 font-semibold">5日收益</th>
                        <th className="px-4 py-3 text-right text-slate-300 font-semibold">20日收益</th>
                        <th className="px-4 py-3 text-left text-slate-300 font-semibold">说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(factorAnalysisData.icAnalysis.length > 0 ? factorAnalysisData.icAnalysis : MOCK_FACTOR_IC).map((f, idx) => {
                        const icLevel = f.ic > 0.1 ? 'text-green-400' : f.ic > 0.05 ? 'text-blue-400' : 'text-slate-400';
                        return (
                          <tr key={f.factor} className={`border-t border-slate-700 ${idx % 2 === 0 ? 'bg-slate-800/50' : ''}`}>
                            <td className="px-4 py-3 text-white font-medium">{f.factor}</td>
                            <td className={`px-4 py-3 text-right font-bold ${icLevel}`}>{f.ic >= 0 ? '+' : ''}{f.ic.toFixed(4)}</td>
                            <td className="px-4 py-3 text-right text-slate-300">{f.icir >= 0 ? '+' : ''}{f.icir.toFixed(4)}</td>
                            <td className="px-4 py-3 text-right text-slate-300">{f.rankIC >= 0 ? '+' : ''}{f.rankIC.toFixed(4)}</td>
                            <td className="px-4 py-3 text-right text-slate-300">{f.rankICIR >= 0 ? '+' : ''}{f.rankICIR.toFixed(4)}</td>
                            <td className={`px-4 py-3 text-right font-medium ${f.returns[0].value >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                              {f.returns[0].value >= 0 ? '+' : ''}{f.returns[0].value.toFixed(2)}%
                            </td>
                            <td className={`px-4 py-3 text-right font-medium ${f.returns[1].value >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                              {f.returns[1].value >= 0 ? '+' : ''}{f.returns[1].value.toFixed(2)}%
                            </td>
                            <td className="px-4 py-3 text-slate-400 text-xs">{f.description}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* IC Time Series with Factor Selector */}
                <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-white font-medium">IC 时间序列 (最近20天)</h4>
                    <select
                      value={selectedIcFactor}
                      onChange={e => setSelectedIcFactor(e.target.value)}
                      className="border border-slate-600 rounded px-2 py-1 text-sm bg-slate-700 text-white"
                    >
                      <option value="">选择因子...</option>
                      {(factorAnalysisData.icAnalysis.length > 0 ? factorAnalysisData.icAnalysis : MOCK_FACTOR_IC).map(f => (
                        <option key={f.factor} value={f.factor}>{f.factor}</option>
                      ))}
                    </select>
                  </div>
                  {(() => {
                    const icData = factorAnalysisData.icAnalysis.length > 0 ? factorAnalysisData.icAnalysis : MOCK_FACTOR_IC;
                    const targetFactor = selectedIcFactor ? icData.find(f => f.factor === selectedIcFactor) : icData[0];
                    const icValues = targetFactor?.icValues;
                    if (icValues && icValues.length > 0) {
                      return (
                        <div className="flex items-end gap-1 h-32">
                          {(icValues as unknown as number[]).slice(-20).map((val: number, i: number) => {
                            const height = Math.abs(val) * 400;
                            return (
                              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                <div className={`w-full rounded-t ${val >= 0 ? 'bg-red-500/70' : 'bg-green-500/70'}`} style={{ height: `${Math.max(2, height)}px` }} />
                                <span className="text-xs text-slate-500">{i + 1}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }
                    return (
                      <div className="flex items-end gap-1 h-32">
                        {Array.from({ length: 20 }).map((_, i) => {
                          const val = Math.random() * 0.2 - 0.1;
                          const height = Math.abs(val) * 400;
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center gap-1">
                              <div className={`w-full rounded-t ${val >= 0 ? 'bg-red-500/70' : 'bg-green-500/70'}`} style={{ height: `${Math.max(2, height)}px` }} />
                              <span className="text-xs text-slate-500">{i + 1}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </>
            )}
          </div>
        );

      case 'portfolio':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">持仓管理</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPortfolioTab('list')}
                  className={`px-3 py-1 text-sm rounded ${portfolioTab === 'list' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}
                >
                  当前持仓
                </button>
                <button
                  onClick={() => setPortfolioTab('history')}
                  className={`px-3 py-1 text-sm rounded ${portfolioTab === 'history' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}
                >
                  历史记录
                </button>
              </div>
            </div>
            {portfolioTab === 'list' ? (
              portfolioStocks.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <div className="text-4xl mb-4">💼</div>
                  <p>暂无持仓</p>
                  <p className="text-xs mt-2">可将从选股结果中选择的股票添加到持仓</p>
                  <div className="mt-4">
                    <button
                      onClick={() => {
                        const codes = Array.from(selectedForTrade);
                        if (codes.length === 0) {
                          alert('请先在选股标签页选择要添加的股票（点击行首复选框）');
                          return;
                        }
                        // Import selected stocks from screener results
                        const newStocks = result?.stocks
                          .filter(s => selectedForTrade.has(s.code))
                          .map(s => ({
                            code: s.code,
                            name: s.name,
                            price: s.price,
                            changePercent: s.changePercent,
                            holdShares: 100,
                            avgCost: s.price,
                            currentValue: s.price * 100,
                            pnl: 0,
                            pnlPercent: 0,
                            factorScore: s.compositeScore ?? (s as any).factorScore,
                          })) || [];
                        setPortfolioStocks(prev => {
                          const existing = new Set(prev.map(s => s.code));
                          const unique = newStocks.filter(s => !existing.has(s.code));
                          return [...prev, ...unique];
                        });
                        setActiveTab('screener');
                        setSelectedForTrade(new Set());
                      }}
                      className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                    >
                      + 从选股结果添加 ({selectedForTrade.size})
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-900 border-b border-slate-700">
                        <tr>
                          <th className="px-3 py-2 text-left text-slate-300 font-semibold">代码</th>
                          <th className="px-3 py-2 text-left text-slate-300 font-semibold">名称</th>
                          <th className="px-3 py-2 text-right text-slate-300 font-semibold">现价</th>
                          <th className="px-3 py-2 text-right text-slate-300 font-semibold">持仓</th>
                          <th className="px-3 py-2 text-right text-slate-300 font-semibold">成本</th>
                          <th className="px-3 py-2 text-right text-slate-300 font-semibold">市值</th>
                          <th className="px-3 py-2 text-right text-slate-300 font-semibold">盈亏</th>
                          <th className="px-3 py-2 text-right text-slate-300 font-semibold">盈亏%</th>
                          <th className="px-3 py-2 text-center text-slate-300 font-semibold">因子评分</th>
                          <th className="px-3 py-2 text-center text-slate-300 font-semibold">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {portfolioStocks.map((stock, idx) => (
                          <tr key={stock.code} className={`border-t border-slate-700 ${idx % 2 === 0 ? '' : 'bg-slate-800/30'}`}>
                            <td className="px-3 py-2 text-slate-200 font-mono text-xs">{stock.code}</td>
                            <td className="px-3 py-2 font-medium text-white">{stock.name}</td>
                            <td className={`px-3 py-2 text-right font-semibold ${stock.changePercent >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                              {stock.price.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-200">{stock.holdShares}</td>
                            <td className="px-3 py-2 text-right text-slate-200">{stock.avgCost.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right text-slate-200">{stock.currentValue.toFixed(2)}</td>
                            <td className={`px-3 py-2 text-right font-semibold ${stock.pnl >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                              {stock.pnl >= 0 ? '+' : ''}{stock.pnl.toFixed(2)}
                            </td>
                            <td className={`px-3 py-2 text-right font-semibold ${stock.pnlPercent >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                              {stock.pnlPercent >= 0 ? '+' : ''}{stock.pnlPercent.toFixed(2)}%
                            </td>
                            <td className="px-3 py-2 text-center">
                              {stock.factorScore !== undefined ? (
                                <ScoreBar score={stock.factorScore} />
                              ) : (
                                <span className="text-slate-600 text-xs">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={() => setPortfolioStocks(prev => prev.filter(s => s.code !== stock.code))}
                                className="text-xs text-red-400 hover:text-red-300 px-2 py-1"
                              >
                                删除
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-slate-300">
                      共 <span className="font-bold text-blue-400">{portfolioStocks.length}</span> 只股票
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const codes = Array.from(selectedForTrade);
                          if (codes.length === 0) {
                            alert('请先在选股标签页选择要添加的股票');
                            return;
                          }
                          const newStocks = result?.stocks
                            .filter(s => selectedForTrade.has(s.code))
                            .map(s => ({
                              code: s.code,
                              name: s.name,
                              price: s.price,
                              changePercent: s.changePercent,
                              holdShares: 100,
                              avgCost: s.price,
                              currentValue: s.price * 100,
                              pnl: 0,
                              pnlPercent: 0,
                              factorScore: s.compositeScore ?? (s as any).factorScore,
                            })) || [];
                          setPortfolioStocks(prev => {
                            const existing = new Set(prev.map(s => s.code));
                            const unique = newStocks.filter(s => !existing.has(s.code));
                            return [...prev, ...unique];
                          });
                        }}
                        className="px-3 py-1 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700"
                      >
                        + 追加持仓 ({selectedForTrade.size})
                      </button>
                      <button
                        onClick={() => {
                          if (portfolioStocks.length === 0) return;
                          if (!confirm(`确定要清空全部 ${portfolioStocks.length} 只持仓吗？`)) return;
                          setPortfolioStocks([]);
                        }}
                        className="px-3 py-1 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
                      >
                        清空持仓
                      </button>
                    </div>
                  </div>
                </>
              )
            ) : (
              <div className="text-center py-12 text-slate-400">
                <div className="text-4xl mb-4">📋</div>
                <p>历史交易记录</p>
                <p className="text-xs mt-2">交易历史功能开发中...</p>
              </div>
            )}
          </div>
        );

      default: // screener
        return (
          <>
            {/* Templates by Category */}
            <div className="mb-4 space-y-3">
              {TEMPLATE_CATEGORIES.map(cat => (
                <div key={cat.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-slate-300">{cat.icon} {cat.label}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {cat.templates.map(t => (
                      <button key={t.id} onClick={() => handleTemplate(t.id)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                          activeTemplate === t.id
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-slate-800 text-slate-200 border-slate-700 hover:border-slate-600 hover:bg-slate-700'
                        }`}>
                        <span className="mr-1">{t.icon}</span>{t.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <button onClick={() => setShowAdvanced(!showAdvanced)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                  showAdvanced ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`}>
                {showAdvanced ? '▲ 收起高级' : '▼ 高级筛选'}
              </button>
            </div>

            {/* Advanced Filters - Grouped */}
            {showAdvanced && (
              <div className="mb-4 space-y-3">
                <FilterGroup title="基本面筛选" icon="📊" defaultOpen={true}>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">行业</label>
                      <select value={industry} onChange={e => setIndustry(e.target.value)}
                        className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white">
                        <option value="不限">不限</option>
                        {allIndustryOptions.map(ind => (
                          <option key={ind.industry} value={ind.industry}>{ind.industry} ({ind.count})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">最低价 (元)</label>
                      <input type="number" value={priceMin} onChange={e => setPriceMin(e.target.value)}
                        placeholder="0" className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">最高价 (元)</label>
                      <input type="number" value={priceMax} onChange={e => setPriceMax(e.target.value)}
                        placeholder="9999" className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">最低PE</label>
                      <input type="number" value={peMin} onChange={e => setPeMin(e.target.value)}
                        placeholder="0" className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">最高PE</label>
                      <input type="number" value={peMax} onChange={e => setPeMax(e.target.value)}
                        placeholder="100" className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">最低PB</label>
                      <input type="number" value={pbMin} onChange={e => setPbMin(e.target.value)}
                        placeholder="0" step="0.1" className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">最高PB</label>
                      <input type="number" value={pbMax} onChange={e => setPbMax(e.target.value)}
                        placeholder="20" step="0.1" className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">最小市值 (亿)</label>
                      <input type="number" value={mktCapMin} onChange={e => setMktCapMin(e.target.value)}
                        placeholder="0" className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">最大市值 (亿)</label>
                      <input type="number" value={mktCapMax} onChange={e => setMktCapMax(e.target.value)}
                        placeholder="10000" className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">最低换手率 (%)</label>
                      <input type="number" value={turnoverMin} onChange={e => setTurnoverMin(e.target.value)}
                        placeholder="0" step="0.1" className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">最小涨幅 (%)</label>
                      <input type="number" value={changeMin} onChange={e => setChangeMin(e.target.value)}
                        placeholder="-10" step="0.1" className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">最大涨幅 (%)</label>
                      <input type="number" value={changeMax} onChange={e => setChangeMax(e.target.value)}
                        placeholder="10" step="0.1" className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white" />
                    </div>
                  </div>
                </FilterGroup>

                <FilterGroup title="技术指标筛选" icon="📈">
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">技术信号</label>
                      <select value={techSignal} onChange={e => setTechSignal(e.target.value)}
                        className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white">
                        <option value="不限">不限</option>
                        <option value="macd_golden_cross">MACD 金叉</option>
                        <option value="macd_dead_cross">MACD 死叉</option>
                        <option value="kdj_oversold">KDJ 超卖</option>
                        <option value="kdj_overbought">KDJ 超买</option>
                        <option value="boll_above_upper">突破布林上轨</option>
                        <option value="boll_below_lower">跌破布林下轨</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">均线筛选</label>
                      <select value={maFilter} onChange={e => setMaFilter(e.target.value)}
                        className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white">
                        <option value="不限">不限</option>
                        <option value="above_ma20">站上MA20</option>
                        <option value="below_ma20">跌破MA20</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">布林筛选</label>
                      <select value={bollFilter} onChange={e => setBollFilter(e.target.value)}
                        className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white">
                        <option value="不限">不限</option>
                        <option value="above_upper">突破上轨</option>
                        <option value="below_lower">跌破下轨</option>
                        <option value="near_upper">贴近上轨</option>
                        <option value="near_lower">贴近下轨</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">CCI 筛选</label>
                      <select value={cciFilter} onChange={e => setCciFilter(e.target.value)}
                        className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white">
                        <option value="不限">不限</option>
                        <option value="cci_oversold">超卖区（CCI &lt; -100）</option>
                        <option value="cci_overbought">超买区（CCI &gt; +100）</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">OBV 筛选</label>
                      <select value={obvFilter} onChange={e => setObvFilter(e.target.value)}
                        className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white">
                        <option value="不限">不限</option>
                        <option value="obv_rise">OBV 上升</option>
                        <option value="obv_fall">OBV 下降</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">ADX 筛选</label>
                      <select value={adxFilter} onChange={e => setAdxFilter(e.target.value)}
                        className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white">
                        <option value="不限">不限</option>
                        <option value="strong_up">强势上涨</option>
                        <option value="strong_down">强势下跌</option>
                        <option value="weak">趋势不明</option>
                      </select>
                    </div>
                  </div>
                </FilterGroup>

                <FilterGroup title="资金流与舆情" icon="💰">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">舆情筛选</label>
                      <select value={sentimentFilter} onChange={e => setSentimentFilter(e.target.value)}
                        className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white">
                        <option value="不限">不限</option>
                        <option value="positive">利好</option>
                        <option value="negative">利空</option>
                        <option value="important">重大消息</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">机构评级</label>
                      <select value={ratingFilter} onChange={e => setRatingFilter(e.target.value)}
                        className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white">
                        <option value="不限">不限</option>
                        <option value="买入">买入</option>
                        <option value="增持">增持</option>
                        <option value="中性">中性</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">排序字段</label>
                      <select
                        value={sortBy}
                        onChange={e => {
                          const val = e.target.value;
                          setSortBy(val);
                          if (val === 'factorScore') {
                            setScoreSort(true);
                          } else {
                            setScoreSort(false);
                          }
                        }}
                        className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white">
                        <option value="changePercent">涨跌幅</option>
                        <option value="price">最新价</option>
                        <option value="pe">市盈率</option>
                        <option value="pb">市净率</option>
                        <option value="marketCap">总市值</option>
                        <option value="turnover">换手率</option>
                        <option value="volume">成交量</option>
                        <option value="mainNetInflow">主力净流入</option>
                        <option value="factorScore" className="text-blue-300 font-medium">📊 因子综合评分</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">排序方向</label>
                      <select value={sortOrder} onChange={e => setSortOrder(e.target.value)}
                        disabled={sortBy === 'factorScore'}
                        className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white disabled:opacity-40">
                        <option value="desc">降序 ↓</option>
                        <option value="asc">升序 ↑</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 mt-3">
                    <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                      <input type="checkbox" checked={excludeSt} onChange={e => setExcludeSt(e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded" />
                      排除 ST / 退市
                    </label>

                  </div>
                </FilterGroup>

                <div className="flex gap-2">
                  <button onClick={handleSearch}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                    disabled={loading}>
                    {loading ? '筛选中...' : '开始筛选'}
                  </button>
                  <button onClick={handleClear}
                    className="px-4 py-2 bg-slate-800 border border-slate-600 text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-700">
                    清空条件
                  </button>
                </div>
              </div>
            )}

            {/* Results Table - Expanded */}
            <div className="bg-slate-800 border border-slate-700 rounded-lg">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-800 border-b border-slate-700">
                    <tr>
                      <th className="px-2 py-2 text-left w-10">
                        {result && result.stocks.length > 0 && (
                          <input
                            type="checkbox"
                            onChange={(e) => {
                              if (e.target.checked) setSelectedForTrade(new Set(result.stocks.map(s => s.code)));
                              else setSelectedForTrade(new Set());
                            }}
                            className="w-4 h-4 rounded"
                          />
                        )}
                      </th>
                      <th className="px-3 py-2 text-left text-slate-300 font-semibold whitespace-nowrap">代码</th>
                      <th className="px-3 py-2.5 text-left text-slate-300 font-semibold whitespace-nowrap">名称</th>
                      <th className="px-3 py-2.5 text-right text-slate-300 font-semibold whitespace-nowrap">最新价</th>
                      <th className="px-3 py-2.5 text-right text-slate-300 font-semibold whitespace-nowrap">涨跌幅</th>
                      <th className="px-3 py-2.5 text-right text-slate-300 font-semibold whitespace-nowrap">PE</th>
                      <th className="px-3 py-2.5 text-right text-slate-300 font-semibold whitespace-nowrap">PB</th>
                      <th className="px-3 py-2.5 text-right text-slate-300 font-semibold whitespace-nowrap">市值(亿)</th>
                      <th className="px-3 py-2.5 text-right text-slate-300 font-semibold whitespace-nowrap">换手率</th>
                      <th className="px-3 py-2.5 text-center text-slate-300 font-semibold whitespace-nowrap">综合评分</th>
                      <th className="px-3 py-2.5 text-left text-slate-300 font-semibold whitespace-nowrap min-w-[200px]">推荐理由</th>
                      <th className="px-3 py-2.5 text-center text-slate-300 font-semibold whitespace-nowrap">技术信号</th>
                      <th className="px-3 py-2.5 text-right text-slate-300 font-semibold whitespace-nowrap">行业</th>
                      <th className="px-3 py-2.5 text-right text-slate-300 font-semibold whitespace-nowrap">主力净流入</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && result === null ? (
                      Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i} className="border-t border-slate-700">
                          <td className="px-2 py-2"><div className="w-4 h-4 bg-slate-700 rounded animate-pulse" /></td>
                          <td className="px-3 py-2"><div className="h-4 bg-slate-700 rounded w-16 animate-pulse" /></td>
                          <td className="px-3 py-2"><div className="h-4 bg-slate-700 rounded w-20 animate-pulse" /></td>
                          <td className="px-3 py-2"><div className="h-4 bg-slate-700 rounded w-14 ml-auto animate-pulse" /></td>
                          <td className="px-3 py-2"><div className="h-4 bg-slate-700 rounded w-16 ml-auto animate-pulse" /></td>
                          <td className="px-3 py-2"><div className="h-4 bg-slate-700 rounded w-10 ml-auto animate-pulse" /></td>
                          <td className="px-3 py-2"><div className="h-4 bg-slate-700 rounded w-10 ml-auto animate-pulse" /></td>
                          <td className="px-3 py-2"><div className="h-4 bg-slate-700 rounded w-14 ml-auto animate-pulse" /></td>
                          <td className="px-3 py-2"><div className="h-4 bg-slate-700 rounded w-12 ml-auto animate-pulse" /></td>
                        </tr>
                      ))
                    ) : result && result.stocks.length > 0 ? (
                      result.stocks.map((stock, idx) => (
                        <tr key={stock.code} className={`border-t border-slate-700 hover:bg-slate-700/50 ${idx % 2 === 0 ? '' : 'bg-slate-800/30'}`}>
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={selectedForTrade.has(stock.code)}
                              onChange={() => {
                                setSelectedForTrade(prev => {
                                  const n = new Set(prev);
                                  if (n.has(stock.code)) n.delete(stock.code);
                                  else n.add(stock.code);
                                  return n;
                                });
                              }}
                              className="w-4 h-4 rounded"
                            />
                          </td>
                          <td className="px-3 py-2 text-slate-200 font-mono text-xs whitespace-nowrap">{stock.code}</td>
                          <td className="px-3 py-2 font-medium text-white whitespace-nowrap max-w-[100px] truncate">
                            <button
                              className="hover:text-blue-400 hover:underline cursor-pointer transition-colors"
                              onClick={() => onStockClick?.(stock.code, stock.name)}
                              title={`查看 ${stock.name}(${stock.code}) 行情`}
                            >
                              {stock.name}
                            </button>
                          </td>
                          <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${stock.changePercent >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                            {stock.price > 0 ? stock.price.toFixed(2) : '-'}
                          </td>
                          <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${stock.changePercent >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                            {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
                          </td>
                          <td className="px-3 py-2 text-right text-slate-200 whitespace-nowrap">
                            {stock.pe > 0 ? stock.pe.toFixed(1) : '-'}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-200 whitespace-nowrap">
                            {stock.pb > 0 ? stock.pb.toFixed(2) : '-'}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-200 whitespace-nowrap">
                            {stock.marketCap > 0 ? stock.marketCap.toFixed(0) : '-'}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-200 whitespace-nowrap">
                            {stock.turnoverRate > 0 ? `${stock.turnoverRate.toFixed(2)}%` : '-'}
                          </td>
                          <td className="px-3 py-2 text-center">
                              <ScoreBar
                                score={stock.compositeScore || 0}
                                onClick={() => setScoreModalStock(stock)}
                              />
                            </td>
                          <td className="px-3 py-2 text-left">
                            <StockRecommendation stock={stock} onScoreClick={setScoreModalStock} />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex flex-wrap gap-1 justify-center">
                              {stock.macdSignal && <SignalBadge signal={stock.macdSignal} />}
                              {stock.kdjSignal && <SignalBadge signal={stock.kdjSignal} />}
                              {stock.maSignal && <SignalBadge signal={stock.maSignal} />}
                              {stock.bollSignal && <SignalBadge signal={stock.bollSignal} />}
                              {stock.bollSignal === undefined && stock.macdSignal === undefined && stock.kdjSignal === undefined && stock.maSignal === undefined && (
                                <span className="text-xs text-slate-600">暂无</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-200 text-xs whitespace-nowrap">{stock.industry}</td>
                          <td className={`px-3 py-2 text-right whitespace-nowrap font-medium ${stock.mainNetInflow >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                            {stock.mainNetInflow >= 0 ? '+' : ''}{(stock.mainNetInflow).toFixed(0)}万
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={12} className="text-center text-slate-400 py-8">
                          未找到符合条件的股票
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        );
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
      {/* Header with Tabs */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-xl font-bold text-white">智能选股器</h2>
            <p className="text-sm text-slate-500 mt-0.5">基本面 + 技术面多条件筛选</p>
          </div>
          {/* Tabs */}
          <div className="flex items-center gap-1 ml-6">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                }`}
              >
                <span className="mr-1">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {fromCache && (
            <span className="text-xs bg-yellow-900/50 text-yellow-300 px-2 py-1 rounded border border-yellow-700/50">
              📦 缓存数据
            </span>
          )}
        </div>
      </div>

      {/* Market Status Banner */}
      <MarketStatusBanner />

      {/* Result Summary (only on screener tab) */}
      {activeTab === 'screener' && result && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="text-sm text-slate-300">
              共筛选出 <span className="font-bold text-blue-400">{result.total}</span> 只股票
              {result.hasTechFilter && <span className="ml-2 text-xs bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded">含技术指标</span>}
            </div>
            {result.stocks.length > 0 && (
              <button
                onClick={() => exportCSV(result.stocks)}
                className="px-3 py-1 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 flex items-center gap-1"
              >
                <span>⬇</span> 导出CSV
              </button>
            )}
          </div>
          {result.stocks.length > 0 && (
            <button
              onClick={() => {
                const codes = Array.from(selectedForTrade);
                if (codes.length === 0) { alert('请先选择要交易的股票（点击行首复选框）'); return; }
                // 收集所选股票的因子评分
                const factorScores: Record<string, number> = {};
                result.stocks
                  .filter(s => selectedForTrade.has(s.code))
                  .forEach(s => { factorScores[s.code] = s.compositeScore ?? 0; });
                // 判断是否用了因子排序
                const useFactorSort = sortBy === 'factorScore' || scoreSort;
                const config = {
                  strategyType: useFactorSort ? 'factor' : 'macd',
                  codes,
                  strategyParams: useFactorSort ? {
                    selectedFactors,    // 用户配置的因子列表
                    factorPeriod,       // 因子计算周期
                    factorScores,       // 各股票因子评分
                  } : undefined,
                };
                if (onLaunchSimulator) onLaunchSimulator(config);
                else localStorage.setItem('pendingSimulatorConfig', JSON.stringify(config));
              }}
              className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg flex items-center gap-1"
            >
              <span>🚀</span> 发送到模拟交易 ({selectedForTrade.size})
            </button>
          )}
        </div>
      )}

      {/* Tab Content */}
      {renderTabContent()}

      {/* Pagination */}
      {activeTab === 'screener' && result && result.total > pageSize && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-3 py-1 bg-slate-800 text-slate-300 rounded disabled:opacity-50 hover:bg-slate-700"
          >
            上一页
          </button>
          <span className="text-sm text-slate-400">
            第 {page} / {totalPages} 页
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 bg-slate-800 text-slate-300 rounded disabled:opacity-50 hover:bg-slate-700"
          >
            下一页
          </button>
        </div>
      )}
      {/* 评分详情弹窗 */}
      {scoreModalStock && (
        <ScoreDetailModal stock={scoreModalStock} onClose={() => setScoreModalStock(null)} />
      )}
    </div>
  );
}