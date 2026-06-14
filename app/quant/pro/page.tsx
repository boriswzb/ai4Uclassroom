'use client';

/**
 * 量化交易系统 - 主页面
 *
 * 【模块全景图】：
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  因子分析          │  选股：回答"买什么"的问题               │
 *   │  /factor-analysis  │  多因子评分，从全市场筛选候选股         │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  回测              │  验证：回答"买了能否赚钱"的问题          │
 *   │  backtest          │  历史K线模拟买卖，检验策略有效性         │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  盯盘              │  监控：回答"什么时候买卖"的问题         │
 *   │  monitor           │  自选股实时信号推送，行情异动提醒        │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  模拟交易          │  执行：用真实行情验证策略的实战效果       │
 *   │  simulator         │  自动驾驶模式，策略实时运行并成交        │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  策略管理           │  配置：管理策略参数，一键启动模拟交易     │
 *   │  strategies         │  止止损设置，仓位配置                    │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * 【标准工作流】：
 *   因子分析 → 选出候选股票 → 加入自选
 *     ↓
 *   回测：验证策略在候选股上是否有效
 *     ↓
 *   盯盘：监控自选股实时信号
 *     ↓
 *   模拟交易：自动驾驶运行策略
 *     ↓
 *   观察结果 → 调整策略参数 → 重新回测验证
 *
 * AI for 大A量化交易模拟平台
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import BacktestPanel from '@/components/quant/backtest-panel';
import FactorPortfolioPanel from '@/components/quant/factor-portfolio-panel';
import AIStrategyAssistant from '@/components/quant/ai-strategy-assistant';
import SignalMonitor from '@/components/quant/signal-monitor';
import AIReportViewer from '@/components/quant/ai-report-viewer';
import SimulatorPanel from '@/components/quant/simulator-panel';
import StrategiesPanel from '@/components/quant/strategies-panel';
import ScreenerPanel from '@/components/quant/screener-panel';
import { dataSourceManager } from '@/lib/quant';
import type { RealtimeQuote } from '@/lib/quant/types';
import type { ChatMessage, ChatMode } from '@/lib/types/quant-chat';
import StockChart from '@/components/quant/stock-chart';

import { QuantCacheProvider, useQuantCache } from '@/lib/quant/data/quant-cache-context';
import { QuantDataProvider } from '@/lib/quant/data/quant-data-provider';
import { isMarketClosedToday, isMarketOpen } from '@/lib/quant/data/data-cache';
import QuantNavbar from '@/components/quant/quant-navbar';

type TabType = 'backtest' | 'factor-portfolio' | 'simulator' | 'monitor' | 'strategies' | 'data' | 'ai' | 'downloads' | 'factor-analysis' | 'screener' | 'home';

// ─────────────────────────────────────────
// 今日指数 & 账户概览
// ─────────────────────────────────────────
function useAccountSummary() {
  const [summary, setSummary] = useState({
    balance: 100000, positions: 0 as number,
    todayPnL: 0, totalPnL: 0,
    marketOpen: false, indices: [] as { name: string; change: number; changePercent: number }[],
  });

  useEffect(() => {
    // 拉账户
    fetch('/api/simulator')
      .then(r => r.json())
      .then(json => {
        if (json.success) {
          const acc = json.data?.account;
          const positions = json.data?.positions ?? [];
          if (acc) {
            setSummary(s => ({
              ...s,
              balance: acc.balance ?? 100000,
              positions: positions.length,
              todayPnL: acc.todayPnL ?? 0,
              totalPnL: acc.totalPnL ?? 0,
            }));
          }
        }
      })
      .catch(() => {});

    // 拉今日指数
    fetch('/api/stock/realtime?codes=sh000001,sh000300,sz399001')
      .then(r => r.json())
      .then(json => {
        if (Array.isArray(json.data)) {
          const indices = json.data.map((q: any) => ({
            name: q.name ?? q.code,
            change: q.change ?? 0,
            changePercent: q.changePercent ?? 0,
          })).filter((i: any) => i.name);
          setSummary(s => ({ ...s, indices }));
        }
      })
      .catch(() => {});
  }, []);

  return summary;
}

function IndexTicker({ indices }: { indices: { name: string; change: number; changePercent: number }[] }) {
  if (!indices.length) return <span className="text-slate-500 text-xs">加载中...</span>;
  return (
    <div className="flex gap-4">
      {indices.map((idx, i) => {
        const up = idx.changePercent >= 0;
        return (
          <span key={i} className="text-xs">
            <span className="text-slate-400">{idx.name}</span>{' '}
            <span className={up ? 'text-red-400' : 'text-green-400'}>
              {up ? '+' : ''}{idx.changePercent.toFixed(2)}%
            </span>
          </span>
        );
      })}
    </div>
  );
}

function PnLBadge({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span className={`text-sm font-bold ${up ? 'text-red-400' : 'text-green-400'}`}>
      {up ? '+' : ''}{value.toLocaleString('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2 })}
    </span>
  );
}

// ─────────────────────────────────────────
// 流程状态类型
// ─────────────────────────────────────────
type FlowStep = 'analyze' | 'monitor' | 'trade';

// 步骤配置（固定顺序）
const FLOW_STEPS: { id: FlowStep; num: number; label: string; shortLabel: string }[] = [
  { id: 'analyze', num: 1, label: '因子分析选股', shortLabel: '选股分析' },
  { id: 'monitor', num: 2, label: '信号监控盯盘', shortLabel: '实时盯盘' },
  { id: 'trade',   num: 3, label: '模拟交易成交', shortLabel: '模拟成交' },
];

// 仓位建议颜色映射
function getPositionColor(score: number): { bg: string; text: string; label: string } {
  if (score >= 70) return { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: '20%' };
  if (score >= 55) return { bg: 'bg-blue-500/20',    text: 'text-blue-400',    label: '12%' };
  if (score >= 40) return { bg: 'bg-yellow-500/20',  text: 'text-yellow-400',  label: '8%' };
  return { bg: 'bg-slate-500/20',   text: 'text-slate-400', label: '0%' };
}

// ─────────────────────────────────────────
// 流程导向首页（核心）
// 流程：因子分析选股 → 实时盯盘 → 模拟交易成交
// ─────────────────────────────────────────
function FlowCard({
  step,
  active,
  onJump,
  children,
}: {
  step: (typeof FLOW_STEPS)[number];
  active: boolean;
  onJump: () => void;
  children: React.ReactNode;
}) {
  const iconBg = active ? 'bg-blue-600' : 'bg-slate-800';
  const border = active ? 'border-blue-500' : 'border-slate-700';
  return (
    <div
      className={`relative bg-slate-900 border ${border} rounded-2xl p-5 flex-1 min-w-0 transition-all ${active ? 'shadow-lg shadow-blue-900/20' : 'opacity-70 hover:opacity-100'}`}
    >
      {/* 步骤编号 */}
      <div className={`absolute -top-3 left-4 w-7 h-7 ${iconBg} rounded-full flex items-center justify-center text-sm font-black text-white shadow`}>
        {step.num}
      </div>
      <div className="pt-1">
        {children}
      </div>
      {/* 点击跳转到该步骤 */}
      {!active && (
        <button
          onClick={onJump}
          className="mt-3 text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          跳转到 →
        </button>
      )}
    </div>
  );
}

// Step 1: 因子分析（跳转到独立页面）
function AnalyzeStep() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-bold text-white text-base">因子分析选股</h3>
        <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">第①步</span>
      </div>
      <p className="text-slate-400 text-xs leading-relaxed mb-4">
        IC/IR 因子检验，验证有效性，量化综合评分。<br />
        评分 ≥70 推荐 20% 仓位，≥55 推荐 12%，≥40 推荐 8%
      </p>
      <div className="bg-slate-800/60 rounded-xl p-3 mb-4 space-y-1.5">
        {[
          { label: 'MACD金叉 + 布林收口', score: 72, color: 'emerald' },
          { label: 'RSI超卖 + MFI放量', score: 65, color: 'blue' },
          { label: 'ADX趋势加强', score: 41, color: 'yellow' },
        ].map((item) => {
          const pct = getPositionColor(item.score);
          return (
            <div key={item.label} className="flex items-center justify-between text-xs">
              <span className="text-slate-400 truncate mr-2">{item.label}</span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="w-20 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${item.color === 'emerald' ? 'bg-emerald-500' : item.color === 'blue' ? 'bg-blue-500' : 'bg-yellow-500'}`}
                    style={{ width: `${item.score}%` }}
                  />
                </div>
                <span className={`${pct.text} font-medium w-8 text-right`}>{pct.label}</span>
              </div>
            </div>
          );
        })}
      </div>
      <a
        href="/quant/factor-analysis"
        className="block w-full py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-center text-sm font-medium text-white transition-colors"
      >
        打开因子分析 →
      </a>
    </div>
  );
}

// Step 2: 信号监控（自选股列表 + 异动标记）
function MonitorStep({ onNavigate }: { onNavigate: (tab: TabType) => void }) {
  const [watchlist, setWatchlist] = useState<{ code: string; name: string }[]>([]);
  const [quotes, setQuotes] = useState<Record<string, any>>({});

  useEffect(() => {
    import('@/lib/quant/store').then(({ useWatchlistStore }) => {
      const store = useWatchlistStore.getState();
      const defaultList = store.getDefaultWatchlist();
      const codes = defaultList?.codes ?? [];
      // codes 只存字符串数组，取前6个
      setWatchlist(codes.slice(0, 6).map(code => ({ code, name: code })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (watchlist.length === 0) return;
    const codes = watchlist.map(s => s.code).join(',');
    fetch(`/api/stock/realtime?codes=${codes}`)
      .then(r => r.json())
      .then(json => {
        if (Array.isArray(json.data)) {
          // 用 API 返回的真实 name 更新 watchlist，同时更新行情 map
          setWatchlist(prev => prev.map(s => {
            const q = json.data.find((d: any) => d.code === s.code);
            return q ? { ...s, name: q.name || s.name } : s;
          }));
          const map: Record<string, any> = {};
          json.data.forEach((q: any) => { map[q.code] = q; });
          setQuotes(map);
        }
      })
      .catch(() => {});
  }, [watchlist]);

  const upColor = (code: string) => {
    const q = quotes[code];
    if (!q) return 'text-slate-400';
    return (q.change ?? 0) >= 0 ? 'text-red-400' : 'text-green-400';
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-bold text-white text-base">信号监控盯盘</h3>
        <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">第②步</span>
      </div>
      <p className="text-slate-400 text-xs leading-relaxed mb-4">
        自选股实时行情，MACD/KDJ/布林综合信号。<br />
        点击股票可查看详情 → 仓位建议 → 一键买入
      </p>

      {watchlist.length === 0 ? (
        <div className="bg-slate-800/60 rounded-xl p-4 mb-4 text-center">
          <p className="text-slate-500 text-xs mb-3">暂无自选股</p>
          <a href="/quant/factor-analysis" className="text-blue-400 text-xs hover:text-blue-300">
            去因子分析添加 →
          </a>
        </div>
      ) : (
        <div className="space-y-1.5 mb-4 max-h-40 overflow-y-auto">
          {watchlist.map((stock) => (
            <div
              key={stock.code}
              className="flex items-center justify-between bg-slate-800/60 rounded-lg px-3 py-2 cursor-pointer hover:bg-slate-800 transition-colors"
              onClick={() => {
                sessionStorage.setItem('home_to_monitor', stock.code);
                onNavigate('monitor');
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-white text-xs font-medium truncate max-w-16">{stock.name}</span>
                <span className="text-slate-500 text-xs">{stock.code}</span>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {quotes[stock.code] ? (
                  <>
                    <span className="text-white text-xs font-medium">{quotes[stock.code].price ?? '--'}</span>
                    <span className={`text-xs font-medium ${upColor(stock.code)}`}>
                      {(quotes[stock.code].changePercent ?? 0) >= 0 ? '+' : ''}{(quotes[stock.code].changePercent ?? 0).toFixed(2)}%
                    </span>
                  </>
                ) : (
                  <span className="text-slate-600 text-xs">加载中...</span>
                )}
                <span className="text-xs text-slate-500">--</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => onNavigate('monitor')}
        className="block w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-center text-sm font-medium text-white transition-colors"
      >
        进入信号监控 →
      </button>
    </div>
  );
}

// Step 3: 模拟交易（账户状态 + 快速操作）
function TradeStep({ onNavigate }: { onNavigate: (tab: TabType) => void }) {
  const [positions, setPositions] = useState<any[]>([]);
  const [balance, setBalance] = useState(100000);

  useEffect(() => {
    fetch('/api/simulator')
      .then(r => r.json())
      .then(json => {
        if (json.success) {
          setBalance(json.data?.account?.balance ?? 100000);
          setPositions(json.data?.positions ?? []);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-bold text-white text-base">模拟交易成交</h3>
        <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">第③步</span>
      </div>
      <p className="text-slate-400 text-xs leading-relaxed mb-4">
        仓位建议 + 快速买卖，T+1 规则校验。<br />
        买入后当日不可卖出，确认成交后下一交易日可平仓
      </p>

      {/* 账户状态 */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="bg-slate-800/60 rounded-xl p-3 text-center">
          <div className="text-slate-400 text-xs mb-1">可用余额</div>
          <div className="text-white font-bold text-sm">
            ¥{balance.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
          </div>
        </div>
        <div className="bg-slate-800/60 rounded-xl p-3 text-center">
          <div className="text-slate-400 text-xs mb-1">持仓</div>
          <div className="text-white font-bold text-sm">{positions.length} 只</div>
        </div>
      </div>

      {/* 近期持仓 */}
      {positions.length > 0 && (
        <div className="space-y-1 mb-4">
          {positions.slice(0, 3).map((p: any) => (
            <div key={p.code} className="flex items-center justify-between bg-slate-800/60 rounded-lg px-3 py-2">
              <div>
                <span className="text-white text-xs font-medium">{p.name ?? p.code}</span>
                <span className="text-slate-500 text-xs ml-2">x{p.volume}</span>
              </div>
              <div className="text-right">
                <div className="text-orange-400 text-xs">
                  {(p.unrealizedPnL ?? 0) >= 0 ? '+' : ''}¥{(p.unrealizedPnL ?? 0).toFixed(0)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => onNavigate('simulator')}
        className="block w-full py-2.5 bg-orange-600 hover:bg-orange-500 rounded-xl text-center text-sm font-medium text-white transition-colors"
      >
        进入模拟交易 →
      </button>
    </div>
  );
}

function WorkflowSection({ onNavigate }: { onNavigate: (tab: TabType) => void }) {
  const [currentStep, setCurrentStep] = useState<FlowStep>('analyze');

  return (
    <div className="mb-8">
      {/* 标题行 */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white">量化交易流程</h2>
          <p className="text-slate-400 text-sm">因子分析选股 &rarr; 实时盯盘 &rarr; 模拟成交</p>
        </div>
        {/* 步骤切换器 */}
        <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
          {FLOW_STEPS.map((s) => (
            <button
              key={s.id}
              onClick={() => setCurrentStep(s.id)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                currentStep === s.id
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {s.num} {s.shortLabel}
            </button>
          ))}
        </div>
      </div>

      {/* 横向三列流程 */}
      <div className="flex gap-3 items-stretch">
        {/* Step 1: 因子分析 */}
        <FlowCard
          step={FLOW_STEPS[0]}
          active={currentStep === 'analyze'}
          onJump={() => { window.location.href = '/quant/factor-analysis'; }}
        >
          <AnalyzeStep />
        </FlowCard>

        {/* 连接箭头 */}
        <div className="flex items-center flex-shrink-0">
          <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>

        {/* Step 2: 盯盘 */}
        <FlowCard
          step={FLOW_STEPS[1]}
          active={currentStep === 'monitor'}
          onJump={() => onNavigate('monitor')}
        >
          <MonitorStep onNavigate={onNavigate} />
        </FlowCard>

        {/* 连接箭头 */}
        <div className="flex items-center flex-shrink-0">
          <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>

        {/* Step 3: 交易 */}
        <FlowCard
          step={FLOW_STEPS[2]}
          active={currentStep === 'trade'}
          onJump={() => onNavigate('simulator')}
        >
          <TradeStep onNavigate={onNavigate} />
        </FlowCard>
      </div>

      {/* 底部进度指示 */}
      <div className="flex items-center gap-2 mt-4">
        {FLOW_STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2 flex-1">
            <div className={`flex-1 h-1 rounded-full ${
              currentStep === s.id ? 'bg-blue-500' :
              (i < FLOW_STEPS.findIndex(f => f.id === currentStep) ? 'bg-emerald-500' : 'bg-slate-800')
            }`} />
            <span className={`text-xs ${currentStep === s.id ? 'text-blue-400' : 'text-slate-500'}`}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// 快速入口（其他模块）
// ─────────────────────────────────────────
const QUICK_MODULES = [
  { title: '智能选股', icon: '🎯', tab: 'screener' as TabType, desc: '多因子筛选' },
  { title: '回测系统', icon: '📈', tab: 'backtest' as TabType, desc: '绩效回测' },
  { title: '行情数据', icon: '📁', tab: 'data' as TabType, desc: '实时行情' },
  { title: '策略管理', icon: '⚙️', tab: 'strategies' as TabType, desc: '策略配置' },
  { title: 'AI助手', icon: '🤖', tab: 'ai' as TabType, desc: '自然语言' },
  { title: '下载中心', icon: '📦', tab: 'downloads' as TabType, desc: 'APK/PPTX/PDF/数据' },
];

function QuickAccessRow({ onNavigate }: { onNavigate: (tab: TabType) => void }) {
  return (
    <div className="mb-8">
      <h2 className="text-sm font-semibold text-slate-400 mb-3">其他模块</h2>
      <div className="grid grid-cols-5 gap-3">
        {QUICK_MODULES.map((m) => (
          <button
            key={m.tab}
            onClick={() => onNavigate(m.tab)}
            className="bg-slate-900 border border-slate-800 hover:border-slate-600 rounded-xl p-3 text-center group transition-all"
          >
            <div className="text-2xl mb-1">{m.icon}</div>
            <div className="text-white text-xs font-medium group-hover:text-blue-400 transition-colors">{m.title}</div>
            <div className="text-slate-500 text-xs">{m.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────
// 首页组件
// ─────────────────────────────────────────
function HomePage({ onNavigate }: { onNavigate: (tab: TabType) => void }) {
  const summary = useAccountSummary();

  return (
    <div className="max-w-7xl mx-auto">
      {/* ── 顶部：市场动态 + 账户概览 ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        {/* 市场动态 */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-300">今日市场</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${summary.marketOpen ? 'bg-emerald-900/50 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
              {summary.marketOpen ? '● 盘中' : '○ 休市'}
            </span>
          </div>
          <IndexTicker indices={summary.indices} />
        </div>

        {/* 账户概览 */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">账户概览</h3>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-xs">账户余额</span>
              <span className="text-white font-bold">
                {summary.balance.toLocaleString('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-xs">持仓股票</span>
              <span className="text-white font-bold">{summary.positions} 只</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-xs">今日盈亏</span>
              <PnLBadge value={summary.todayPnL} />
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-xs">累计盈亏</span>
              <PnLBadge value={summary.totalPnL} />
            </div>
          </div>
        </div>
      </div>

      {/* ── 工作流三步 ─────────────────────────── */}
      <WorkflowSection onNavigate={onNavigate} />

      {/* ── 快速入口 ─────────────────────────── */}
      <QuickAccessRow onNavigate={onNavigate} />
    </div>
  );
}

// ─────────────────────────────────────────
// 主页面
// ─────────────────────────────────────────
export default function QuantPage() {
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatMode, setChatMode] = useState<ChatMode>('strategy');

  // Hash路由支持（初始化 + hashchange事件）
  useEffect(() => {
    const validTabs: TabType[] = ['backtest', 'factor-portfolio', 'simulator', 'monitor', 'strategies', 'data', 'ai', 'downloads', 'factor-analysis', 'screener', 'home'];
    const applyHash = () => {
      const hash = window.location.hash.replace('#', '') as TabType;
      if (hash && validTabs.includes(hash)) setActiveTab(hash);
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  const handleNavigate = (tab: TabType) => {
    setActiveTab(tab);
    window.location.hash = tab;
  };

  return (
    <QuantCacheProvider>
    <QuantDataProvider>
    <div className="min-h-screen bg-slate-950 text-slate-100">

      {/* ── 统一导航栏 ─────────────────────────── */}
      <QuantNavbar activeTab={activeTab as any} />

      {/* ── 内容区 ───────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'home' && <HomePage onNavigate={handleNavigate} />}
        {activeTab === 'backtest' && <BacktestPanel />}
        {activeTab === 'factor-portfolio' && <FactorPortfolioPanel />}
        {activeTab === 'simulator' && <SimulatorPanel />}
        {activeTab === 'monitor' && <SignalMonitor />}
        {activeTab === 'strategies' && <StrategiesPanel onLaunchSimulator={(config) => {
          setActiveTab('simulator');
          localStorage.setItem('pendingSimulatorConfig', JSON.stringify(config));
        }} />}
        {activeTab === 'data' && <DataPanel />}
        {activeTab === 'downloads' && <AIReportViewer />}
        {activeTab === 'screener' && (
          <ScreenerPanel
            onLaunchSimulator={(config) => {
              setActiveTab('simulator');
              localStorage.setItem('pendingSimulatorConfig', JSON.stringify(config));
            }}
          />
        )}
        {activeTab === 'ai' && (
          <AIStrategyAssistant
            messages={chatMessages}
            onMessagesChange={setChatMessages}
            mode={chatMode}
            onModeChange={setChatMode}
          />
        )}
      </main>

      {/* ── 底部 ─────────────────────────────── */}
      <footer className="bg-slate-900 border-t border-slate-800 mt-8">
        <div className="max-w-7xl mx-auto px-4 py-4 text-sm text-slate-500">
          <p>AI4U 量化交易系统 v2.0 · 模拟盘仅供学习研究，不构成投资建议 · A股 T+1 规则</p>
        </div>
      </footer>

    </div>
    </QuantDataProvider>
    </QuantCacheProvider>
  );
}
// ─────────────────────────────────────────
// 数据中心
// ─────────────────────────────────────────
type DataTab = 'quotes' | 'board' | 'flow';

function DataPanel() {
  const [dataTab, setDataTab] = useState<DataTab>('quotes');

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white">数据中心</h2>
        {/* 数据子Tab */}
        <div className="flex gap-1 bg-slate-800 rounded-lg p-1 border border-slate-700">
          {[
            { id: 'quotes' as DataTab, label: '实时行情' },
            { id: 'board' as DataTab, label: '行业板块' },
            { id: 'flow' as DataTab, label: '资金流向' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setDataTab(t.id)}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                dataTab === t.id
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 指数行情条（始终显示） */}
      <IndexStrip />

      {/* 子Tab内容 */}
      {dataTab === 'quotes' && <QuotesTab />}
      {dataTab === 'board' && <BoardTab />}
      {dataTab === 'flow' && <FlowTab />}
    </div>
  );
}

// ── 指数行情条 ──
function IndexStrip() {
  const { indexData, refreshIndex } = useQuantCache();
  interface IndexData { code: string; name: string; price: number; change: number; changePercent: number; }
  const [localIndices, setLocalIndices] = useState<IndexData[]>([]);
  // 非交易时段且有缓存则直接用缓存数据
  const [fromCache, setFromCache] = useState(false);

  const fetchIndices = useCallback(async () => {
    try {
      const res = await fetch('/api/stock/index');
      const json = await res.json();
      if (json.success && json.data) {
        setLocalIndices(json.data);
        setFromCache(false);
      }
    } catch (e) { /* silent */ }
  }, []);

  useEffect(() => {
    if (indexData && indexData.length > 0) {
      setLocalIndices(indexData as any);
      setFromCache(true);
    }
  }, [indexData]);

  useEffect(() => {
    if (localIndices.length === 0) fetchIndices();
  }, []);

  useEffect(() => {
    // 非交易时段用更长间隔
    const t = setInterval(fetchIndices, !isMarketOpen() ? 300000 : 30000);
    return () => clearInterval(t);
  }, [fetchIndices]);

  if (localIndices.length === 0) return null;

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-9 gap-2 mb-4">
      {localIndices.slice(0, 9).map(idx => (
        <div key={idx.code} className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-center">
          <div className="text-xs text-slate-300 font-medium truncate">{idx.name}</div>
          <div className={`text-sm font-bold ${idx.change >= 0 ? 'text-red-400' : 'text-green-400'}`}>
            {idx.price.toFixed(2)}
          </div>
          <div className={`text-xs ${idx.change >= 0 ? 'text-red-500' : 'text-green-500'}`}>
            {idx.change >= 0 ? '+' : ''}{idx.changePercent.toFixed(2)}%
            {fromCache && <span className="ml-1 text-slate-500">缓存</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 行情Tab ──
const QUOTES_CACHE_KEY = 'quant_data_center_quotes';
const QUOTES_CACHE_TTL = 5 * 60 * 1000; // 5分钟

function QuotesTab() {
  const [dataSource, setDataSource] = useState<'akshare' | 'tushare' | 'csv'>('akshare');
  // 非交易时段第二次打开，直接从 localStorage 恢复缓存（避免无谓请求）
  // 注意：用 !isMarketOpen() 而不是 isMarketClosedToday()，因为后者只覆盖 15:00 后
  const [quotes, setQuotes] = useState<RealtimeQuote[]>(() => {
    if (!isMarketOpen()) {
      try {
        const cached = localStorage.getItem(QUOTES_CACHE_KEY);
        if (cached) {
          const { data, ts } = JSON.parse(cached);
          if (Date.now() - ts < QUOTES_CACHE_TTL) return data;
        }
      } catch { /* ignore */ }
    }
    return [];
  });
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [fromCache, setFromCache] = useState<boolean>(() => {
    if (!isMarketOpen()) {
      try {
        const cached = localStorage.getItem(QUOTES_CACHE_KEY);
        if (cached) {
          const { ts } = JSON.parse(cached);
          if (Date.now() - ts < QUOTES_CACHE_TTL) return true;
        }
      } catch { /* ignore */ }
    }
    return false;
  });
  const [selectedQuote, setSelectedQuote] = useState<RealtimeQuote | null>(null);
  const [allStocks, setAllStocks] = useState<{ code: string; name: string }[]>([]);

  // 基本面数据（当前页股票）
  interface Fundamental { code: string; pe: number; pb: number; marketCap: number; turnover: number; }
  const [fundamentals, setFundamentals] = useState<Record<string, Fundamental>>({});

  const allStockCodes = useMemo(() => allStocks.map(s => s.code), [allStocks]);

  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [jumpPage, setJumpPage] = useState<number>(1);

  const [searchQuery, setSearchQuery] = useState('');
  const [marketFilter, setMarketFilter] = useState<'all' | 'sh' | 'sz' | 'bj' | 'cyb' | 'kcb'>('all');
  const [priceFilter, setPriceFilter] = useState<'all' | 'up' | 'down' | 'rise5' | 'fall5'>('all');
  const [sortField, setSortField] = useState<'code' | 'name' | 'price' | 'change' | 'changePercent'>('code');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const filteredQuotes = useMemo(() => {
    let result = [...quotes];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (r) => r.code.toLowerCase().includes(q) || (r.name && r.name.toLowerCase().includes(q))
      );
    }
    if (marketFilter !== 'all') {
      result = result.filter((r) => {
        if (marketFilter === 'sh') return r.code.endsWith('.SH');
        if (marketFilter === 'sz') return r.code.endsWith('.SZ') && !r.code.startsWith('000') && !r.code.startsWith('001');
        if (marketFilter === 'cyb') return r.code.startsWith('300');
        if (marketFilter === 'kcb') return r.code.startsWith('688');
        if (marketFilter === 'bj') return r.code.endsWith('.BJ');
        return true;
      });
    }
    if (priceFilter !== 'all') {
      result = result.filter((r) => {
        if (priceFilter === 'up') return r.change > 0;
        if (priceFilter === 'down') return r.change < 0;
        if (priceFilter === 'rise5') return r.changePercent > 5;
        if (priceFilter === 'fall5') return r.changePercent < -5;
        return true;
      });
    }
    result.sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0;
      if (sortField === 'code') { av = a.code; bv = b.code; }
      else if (sortField === 'name') { av = a.name || ''; bv = b.name || ''; }
      else if (sortField === 'price') { av = a.price; bv = b.price; }
      else if (sortField === 'change') { av = a.change; bv = b.change; }
      else if (sortField === 'changePercent') { av = a.changePercent; bv = b.changePercent; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [quotes, searchQuery, marketFilter, priceFilter, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredQuotes.length / pageSize));
  const paginatedQuotes = filteredQuotes.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // 当页码变化时，获取当前页股票的基本面
  const prevPageRef = useRef(currentPage);
  useEffect(() => {
    if (currentPage === prevPageRef.current) return;
    prevPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    if (paginatedQuotes.length === 0) return;
    const codes = paginatedQuotes.map(q => q.code).join(',');
    fetch(`/api/stock/fundamentals?codes=${codes}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data) {
          const map: Record<string, Fundamental> = {};
          for (const f of json.data) {
            map[f.code] = f;
          }
          setFundamentals(map);
        }
      })
      .catch(() => {});
  }, [paginatedQuotes]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
    setCurrentPage(1);
  };

  const sortIcon = (field: typeof sortField) => {
    if (sortField !== field) return <span className="text-gray-400 ml-1">⇅</span>;
    return sortDir === 'asc'
      ? <span className="text-blue-600 ml-1 font-bold">↑</span>
      : <span className="text-blue-600 ml-1 font-bold">↓</span>;
  };

  const getPageNumbers = (): (number | -1)[] => {
    const pages: (number | -1)[] = [];
    const maxVisible = 7;
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 4) {
        for (let i = 1; i <= 5; i++) pages.push(i);
        pages.push(-1); pages.push(totalPages);
      } else if (currentPage >= totalPages - 3) {
        pages.push(1); pages.push(-1);
        for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1); pages.push(-1);
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
        pages.push(-1); pages.push(totalPages);
      }
    }
    return pages;
  };

  const isFetchingRef = useRef(false);

  const fetchQuotes = useCallback(async (source: 'akshare' | 'tushare' | 'csv') => {
    if (allStockCodes.length === 0) return;
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setLoading(true);
    try {
      await dataSourceManager.setActiveSource(source);
      const BATCH = 50, CONCURRENCY = 10;
      const batches: string[][] = [];
      for (let i = 0; i < allStockCodes.length; i += BATCH) batches.push(allStockCodes.slice(i, i + BATCH));
      const allQuotes: RealtimeQuote[] = [];
      for (let i = 0; i < batches.length; i += CONCURRENCY) {
        const chunk = batches.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          chunk.map((batch, idx) =>
            dataSourceManager.getRealtimeQuote(batch).catch(err => {
              console.error(`[DataPanel] 第${i + idx + 1}批行情获取失败:`, err);
              return [];
            })
          )
        );
        for (const r of results) allQuotes.push(...r);
      }
      setQuotes(allQuotes);
      setLastUpdate(new Date());
      setFromCache(false);
      // 存入 localStorage，非交易时段后续打开可直接用
      try {
        localStorage.setItem(QUOTES_CACHE_KEY, JSON.stringify({ data: allQuotes, ts: Date.now() }));
      } catch { /* ignore */ }
    } catch (err) {
      console.error('[DataPanel] 获取行情失败:', err);
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, [allStockCodes]);

  useEffect(() => {
    fetch('/api/stock/list')
      .then(r => r.json())
      .then(data => { if (data.data && Array.isArray(data.data)) setAllStocks(data.data); })
      .catch(err => console.error('[DataPanel] 获取股票列表失败:', err));
  }, []);

  useEffect(() => {
    // 非交易时段且已有缓存则跳过首次请求
    if (fromCache && quotes.length > 0) return;
    if (allStocks.length > 0) fetchQuotes(dataSource);
  }, [allStocks]);

  // 非交易时段（收盘后/周末）轮询间隔延长到 5 分钟，交易时段保持 30 秒
  useEffect(() => {
    const interval = setInterval(
      () => fetchQuotes(dataSource),
      isMarketClosedToday() ? 300000 : 30000
    );
    return () => clearInterval(interval);
  }, [dataSource, fetchQuotes]);

  return (
    <>
      {/* 过滤栏 */}
      <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-slate-800 rounded-lg border border-slate-700">
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400 whitespace-nowrap">关键字:</label>
          <input
            type="text" value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            placeholder="代码或名称..." className="bg-slate-700 border border-slate-600 text-white rounded px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400 whitespace-nowrap">市场:</label>
          <select value={marketFilter}
            onChange={(e) => { setMarketFilter(e.target.value as typeof marketFilter); setCurrentPage(1); }}
            className="bg-slate-700 border border-slate-600 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">全部</option>
            <option value="sh">沪市主板</option>
            <option value="sz">深市主板</option>
            <option value="cyb">创业板</option>
            <option value="kcb">科创板</option>
            <option value="bj">北交所</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400 whitespace-nowrap">涨跌:</label>
          <select value={priceFilter}
            onChange={(e) => { setPriceFilter(e.target.value as typeof priceFilter); setCurrentPage(1); }}
            className="bg-slate-700 border border-slate-600 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">全部</option>
            <option value="up">上涨</option>
            <option value="down">下跌</option>
            <option value="rise5">涨幅 &gt;5%</option>
            <option value="fall5">跌幅 &gt;5%</option>
          </select>
        </div>
        <div className="ml-auto text-sm text-slate-300 font-medium">
          {quotes.length > 0 && (
            filteredQuotes.length !== quotes.length
              ? <span>筛选 <span className="text-blue-600">{filteredQuotes.length}</span> / {quotes.length} 条</span>
              : <span>{quotes.length} 条</span>
          )}
        </div>
      </div>

      {/* 工具栏 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-300 font-medium">每页:</label>
          <select value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
            className="bg-slate-700 border border-slate-600 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value={20}>20 条</option>
            <option value={50}>50 条</option>
            <option value={100}>100 条</option>
            <option value={200}>200 条</option>
          </select>
          {quotes.length > 0 && (
            <span className="text-sm text-slate-300">共 <span className="font-semibold text-white">{quotes.length}</span> 只</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => fetchQuotes(dataSource)} disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm">
            {loading ? '刷新中...' : '刷新数据'}
          </button>
          {lastUpdate && (
            <span className="text-sm text-slate-400">更新: {lastUpdate.toLocaleTimeString()}{fromCache ? '（缓存）' : ''}</span>
          )}
        </div>
      </div>

      {/* 股票表格（+基本面列） */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800">
              <tr>
                <th className="px-3 py-2 text-left text-slate-300 font-semibold whitespace-nowrap cursor-pointer select-none hover:bg-slate-700" onClick={() => handleSort('code')}>代码 {sortIcon('code')}</th>
                <th className="px-3 py-2 text-left text-slate-300 font-semibold whitespace-nowrap cursor-pointer select-none hover:bg-slate-700" onClick={() => handleSort('name')}>名称 {sortIcon('name')}</th>
                <th className="px-3 py-2 text-right text-slate-300 font-semibold whitespace-nowrap cursor-pointer select-none hover:bg-slate-700" onClick={() => handleSort('price')}>最新价 {sortIcon('price')}</th>
                <th className="px-3 py-2 text-right text-slate-300 font-semibold whitespace-nowrap cursor-pointer select-none hover:bg-slate-700" onClick={() => handleSort('change')}>涨跌额 {sortIcon('change')}</th>
                <th className="px-3 py-2 text-right text-slate-300 font-semibold whitespace-nowrap cursor-pointer select-none hover:bg-slate-700" onClick={() => handleSort('changePercent')}>涨跌幅 {sortIcon('changePercent')}</th>
                <th className="px-3 py-2 text-right text-slate-300 font-semibold whitespace-nowrap">今开</th>
                <th className="px-3 py-2 text-right text-slate-300 font-semibold whitespace-nowrap">最高</th>
                <th className="px-3 py-2 text-right text-slate-300 font-semibold whitespace-nowrap">最低</th>
                <th className="px-3 py-2 text-right text-slate-300 font-semibold whitespace-nowrap">换手率</th>
                <th className="px-3 py-2 text-right text-slate-300 font-semibold whitespace-nowrap">PE</th>
                <th className="px-3 py-2 text-right text-slate-300 font-semibold whitespace-nowrap">PB</th>
                <th className="px-3 py-2 text-right text-slate-300 font-semibold whitespace-nowrap">市值(亿)</th>
              </tr>
            </thead>
            <tbody>
              {loading && quotes.length === 0 ? (
                <tr><td className="px-3 py-8 text-center text-slate-500" colSpan={12}>加载中...</td></tr>
              ) : paginatedQuotes.length > 0 ? (
                paginatedQuotes.map((quote) => {
                  const f = fundamentals[quote.code];
                  return (
                    <tr key={quote.code} className="border-t border-slate-800 hover:bg-slate-800/50 cursor-pointer"
                      onClick={() => setSelectedQuote(quote)}>
                      <td className="px-3 py-2 text-slate-200 whitespace-nowrap">{quote.code}</td>
                      <td className="px-3 py-2 text-slate-200 font-medium whitespace-nowrap">{quote.name || quote.code}</td>
                      <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${quote.change >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {quote.price > 0 ? quote.price.toFixed(2) : '-'}
                      </td>
                      <td className={`px-3 py-2 text-right whitespace-nowrap ${quote.change >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {quote.change >= 0 ? '+' : ''}{quote.change.toFixed(2)}
                      </td>
                      <td className={`px-3 py-2 text-right whitespace-nowrap ${quote.changePercent >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {quote.changePercent >= 0 ? '+' : ''}{quote.changePercent.toFixed(2)}%
                      </td>
                      <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">{quote.open > 0 ? quote.open.toFixed(2) : '-'}</td>
                      <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">{quote.high > 0 ? quote.high.toFixed(2) : '-'}</td>
                      <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">{quote.low > 0 ? quote.low.toFixed(2) : '-'}</td>
                      <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">
                        {f && f.turnover > 0 ? `${f.turnover.toFixed(2)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">
                        {f && f.pe > 0 ? f.pe.toFixed(1) : '-'}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">
                        {f && f.pb > 0 ? f.pb.toFixed(2) : '-'}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">
                        {f && f.marketCap > 0 ? f.marketCap.toFixed(0) : '-'}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr><td className="px-3 py-8 text-center text-slate-500" colSpan={12}>暂无数据，请刷新重试</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700 bg-slate-800">
            <span className="text-sm text-slate-300">第 {currentPage} / {totalPages} 页</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1}
                className="px-3 py-1 border border-slate-600 rounded text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed">首页</button>
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                className="px-3 py-1 border border-slate-600 rounded text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed">上一页</button>
              {getPageNumbers().map((pageNum, idx) =>
                pageNum === -1 ? <span key={`e-${idx}`} className="px-1 text-slate-500">...</span> :
                  <button key={pageNum} onClick={() => setCurrentPage(pageNum as number)}
                    className={`px-3 py-1 border rounded text-sm ${currentPage === pageNum ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-600 text-slate-300 hover:bg-slate-700'}`}>{pageNum}</button>
              )}
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                className="px-3 py-1 border border-slate-600 rounded text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed">下一页</button>
              <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}
                className="px-3 py-1 border border-slate-600 rounded text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed">末页</button>
              <span className="text-sm text-slate-300 ml-2">跳转:</span>
              <input type="number" min={1} max={totalPages} value={jumpPage}
                onChange={e => setJumpPage(Number(e.target.value))}
                onKeyDown={e => { if (e.key === 'Enter') { const p = Math.max(1, Math.min(totalPages, jumpPage)); setCurrentPage(p); setJumpPage(p); } }}
                className="w-16 bg-slate-700 border border-slate-600 text-white rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        )}
      </div>

      {/* K线弹窗 */}
      {selectedQuote && (
        <StockChart code={selectedQuote.code} name={selectedQuote.name || selectedQuote.code} onClose={() => setSelectedQuote(null)} />
      )}
    </>
  );
}

// ── 行业板块Tab ──
function BoardTab() {
  interface BoardItem { name: string; count: number; upCount: number; avgChangePercent: number; leadStock: string; leadChangePercent: number; totalAmount: number; }
  const [boards, setBoards] = useState<BoardItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<'avgChangePercent' | 'count' | 'totalAmount'>('avgChangePercent');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const fetchBoards = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stock/board?sort=${sortBy}&order=${sortDir}&limit=60`);
      const json = await res.json();
      if (json.success && json.data) setBoards(json.data);
    } catch (e) { console.error('[BoardTab]', e); }
    finally { setLoading(false); }
  }, [sortBy, sortDir]);

  useEffect(() => { fetchBoards(); }, [fetchBoards]);

  const sorted = useMemo(() => {
    return [...boards].sort((a, b) => {
      let av = 0, bv = 0;
      if (sortBy === 'avgChangePercent') { av = a.avgChangePercent; bv = b.avgChangePercent; }
      else if (sortBy === 'count') { av = a.count; bv = b.count; }
      else if (sortBy === 'totalAmount') { av = a.totalAmount; bv = b.totalAmount; }
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [boards, sortBy, sortDir]);

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(field); setSortDir('desc'); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-slate-400">共 {boards.length} 个行业板块</span>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400">排序:</label>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="bg-slate-700 border border-slate-600 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="avgChangePercent">涨跌幅</option>
            <option value="count">股票数量</option>
            <option value="totalAmount">成交额</option>
          </select>
          <button onClick={fetchBoards} disabled={loading}
            className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">
            {loading ? '加载中...' : '刷新'}
          </button>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-700 rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800">
              <tr>
                <th className="px-4 py-2 text-left text-slate-300 font-semibold">行业板块</th>
                <th className="px-4 py-2 text-right text-slate-300 font-semibold cursor-pointer select-none hover:bg-slate-700"
                  onClick={() => handleSort('avgChangePercent')}>
                  平均涨跌幅 {sortBy === 'avgChangePercent' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                </th>
                <th className="px-4 py-2 text-right text-slate-300 font-semibold cursor-pointer select-none hover:bg-slate-700"
                  onClick={() => handleSort('count')}>
                  股票数 {sortBy === 'count' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                </th>
                <th className="px-4 py-2 text-right text-slate-300 font-semibold">上涨数</th>
                <th className="px-4 py-2 text-right text-slate-300 font-semibold">下跌数</th>
                <th className="px-4 py-2 text-right text-slate-300 font-semibold">领涨股</th>
                <th className="px-4 py-2 text-right text-slate-300 font-semibold cursor-pointer select-none hover:bg-slate-700"
                  onClick={() => handleSort('totalAmount')}>
                  成交额(万) {sortBy === 'totalAmount' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && boards.length === 0 ? (
                <tr><td className="px-4 py-8 text-center text-slate-500" colSpan={7}>加载中...</td></tr>
              ) : sorted.length > 0 ? (
                sorted.map((b, i) => (
                  <tr key={i} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="px-4 py-2 text-slate-200 font-medium">{b.name}</td>
                    <td className={`px-4 py-2 text-right font-semibold whitespace-nowrap ${b.avgChangePercent >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {b.avgChangePercent >= 0 ? '+' : ''}{b.avgChangePercent.toFixed(2)}%
                    </td>
                    <td className="px-4 py-2 text-right text-slate-400">{b.count}</td>
                    <td className="px-4 py-2 text-right text-red-400">{b.upCount}</td>
                    <td className="px-4 py-2 text-right text-green-400">{b.count - b.upCount}</td>
                    <td className="px-4 py-2 text-right text-slate-400">
                      <span className={b.leadChangePercent >= 0 ? 'text-red-400' : 'text-green-400'}>
                        {b.leadStock} {b.leadChangePercent >= 0 ? '+' : ''}{b.leadChangePercent.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-slate-400 whitespace-nowrap">
                      {b.totalAmount >= 100000000 ? `${(b.totalAmount / 100000000).toFixed(1)}亿` : b.totalAmount >= 10000 ? `${(b.totalAmount / 10000).toFixed(0)}万` : b.totalAmount.toFixed(0)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td className="px-4 py-8 text-center text-slate-500" colSpan={7}>暂无数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── 资金流向Tab ──
function FlowTab() {
  interface FlowItem { code: string; name: string; price: number; changePercent: number; mainNetInflow: number; mainNetInflowPct: number; turnover: number; amount: number; }
  const [items, setItems] = useState<FlowItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<'mainNetInflow' | 'changePercent' | 'turnover'>('mainNetInflow');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [stockCodes, setStockCodes] = useState<string[]>([]);

  // 获取全量股票代码用于资金流排行
  useEffect(() => {
    if (stockCodes.length > 0) return;
    fetch('/api/stock/list')
      .then(r => r.json())
      .then(data => {
        if (data.data && Array.isArray(data.data)) {
          // 取成交额最高的前200只（按代码前缀分批获取实时行情，靠前的主要是热门股）
          const codes = data.data.slice(0, 200).map((s: any) => s.code);
          setStockCodes(codes);
        }
      })
      .catch(() => {});
  }, []);

  const fetchFlow = useCallback(async (codes: string[]) => {
    if (codes.length === 0) return;
    setLoading(true);
    try {
      // 分批，每批50
      const BATCH = 50, CONCURRENCY = 4;
      const batches: string[][] = [];
      for (let i = 0; i < codes.length; i += BATCH) batches.push(codes.slice(i, i + BATCH));
      const allItems: FlowItem[] = [];
      for (let i = 0; i < batches.length; i += CONCURRENCY) {
        const chunk = batches.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          chunk.map(batch =>
            fetch(`/api/stock/flow?codes=${batch.join(',')}&sort=${sortBy}&order=${sortDir}&limit=50`)
              .then(r => r.json())
              .then(json => json.success ? json.data : [])
              .catch(() => [])
          )
        );
        for (const r of results) allItems.push(...r);
      }
      // 去重
      const seen = new Set<string>();
      const unique = allItems.filter(it => { if (seen.has(it.code)) return false; seen.add(it.code); return true; });
      unique.sort((a, b) => {
        let av = 0, bv = 0;
        if (sortBy === 'mainNetInflow') { av = a.mainNetInflow; bv = b.mainNetInflow; }
        else if (sortBy === 'changePercent') { av = a.changePercent; bv = b.changePercent; }
        else if (sortBy === 'turnover') { av = a.turnover; bv = b.turnover; }
        return sortDir === 'desc' ? bv - av : av - bv;
      });
      setItems(unique.slice(0, 100));
    } catch (e) { console.error('[FlowTab]', e); }
    finally { setLoading(false); }
  }, [sortBy, sortDir]);

  useEffect(() => { if (stockCodes.length > 0) fetchFlow(stockCodes); }, [stockCodes, fetchFlow]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-slate-400">资金流向 Top 100（按主力净流入排序）</span>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400">排序:</label>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="bg-slate-700 border border-slate-600 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="mainNetInflow">主力净流入</option>
            <option value="changePercent">涨跌幅</option>
            <option value="turnover">换手率</option>
          </select>
          <button onClick={() => fetchFlow(stockCodes)} disabled={loading}
            className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">
            {loading ? '加载中...' : '刷新'}
          </button>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-700 rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800">
              <tr>
                <th className="px-4 py-2 text-left text-slate-300 font-semibold">股票</th>
                <th className="px-4 py-2 text-right text-slate-300 font-semibold">最新价</th>
                <th className="px-4 py-2 text-right text-slate-300 font-semibold cursor-pointer select-none hover:bg-slate-700"
                  onClick={() => { if (sortBy === 'changePercent') setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortBy('changePercent'); setSortDir('desc'); } }}>
                  涨跌幅 {sortBy === 'changePercent' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                </th>
                <th className="px-4 py-2 text-right text-slate-300 font-semibold cursor-pointer select-none hover:bg-slate-700"
                  onClick={() => { if (sortBy === 'mainNetInflow') setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortBy('mainNetInflow'); setSortDir('desc'); } }}>
                  主力净流入(万) {sortBy === 'mainNetInflow' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                </th>
                <th className="px-4 py-2 text-right text-slate-300 font-semibold">净流入占比</th>
                <th className="px-4 py-2 text-right text-slate-300 font-semibold cursor-pointer select-none hover:bg-slate-700"
                  onClick={() => { if (sortBy === 'turnover') setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortBy('turnover'); setSortDir('desc'); } }}>
                  换手率 {sortBy === 'turnover' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                </th>
                <th className="px-4 py-2 text-right text-slate-300 font-semibold">成交额(万)</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr><td className="px-4 py-8 text-center text-slate-500" colSpan={7}>加载中...</td></tr>
              ) : items.length > 0 ? (
                items.map((it) => (
                  <tr key={it.code} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="px-4 py-2">
                      <div className="text-slate-200 font-medium">{it.name}</div>
                      <div className="text-xs text-slate-500">{it.code}</div>
                    </td>
                    <td className={`px-4 py-2 text-right font-semibold whitespace-nowrap ${it.changePercent >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {it.price > 0 ? it.price.toFixed(2) : '-'}
                    </td>
                    <td className={`px-4 py-2 text-right whitespace-nowrap ${it.changePercent >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {it.changePercent >= 0 ? '+' : ''}{it.changePercent.toFixed(2)}%
                    </td>
                    <td className={`px-4 py-2 text-right whitespace-nowrap font-semibold ${it.mainNetInflow >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {it.mainNetInflow >= 0 ? '+' : ''}{it.mainNetInflow.toFixed(0)}
                    </td>
                    <td className={`px-4 py-2 text-right whitespace-nowrap ${it.mainNetInflowPct >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {it.mainNetInflowPct >= 0 ? '+' : ''}{it.mainNetInflowPct.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2 text-right text-slate-400 whitespace-nowrap">{it.turnover.toFixed(2)}%</td>
                    <td className="px-4 py-2 text-right text-slate-400 whitespace-nowrap">{it.amount >= 100000000 ? `${(it.amount/100000000).toFixed(1)}亿` : it.amount >= 10000 ? `${(it.amount/10000).toFixed(0)}万` : it.amount.toFixed(0)}</td>
                  </tr>
                ))
              ) : (
                <tr><td className="px-4 py-8 text-center text-slate-500" colSpan={7}>暂无数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
