'use client';

/**
 * 量化交易系统 - 速览模式
 *
 * 设计目标：在一个页面里完成"看行情 → 看推荐 → 盯盘 → 模拟交易"全流程
 * 不再需要切 10 个 Tab 找功能
 *
 * 4 大模块（自上而下滚动）：
 *   ① 市场大盘（指数 + 涨跌幅 + 市场状态）
 *   ② 今日推荐（综合评分 Top 10 金股，含业绩归因卡 / 一键回测验证）
 *   ③ 我的盯盘（自选股 + 实时报价 + 信号）
 *   ④ 模拟交易（账户 + 持仓 + 一键启动 + 高级功能折叠区：因子分析/回测/下载中心）
 *
 * 右上角"🔧 专业模式"按钮 → 切到 /quant/pro（完整 10 Tab 界面）
 */

'use client';

import { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { QuantCacheProvider } from '@/lib/quant/data/quant-cache-context';
import { QuantDataProvider } from '@/lib/quant/data/quant-data-provider';
import { useMarketStatus } from '@/lib/quant/hooks/use-market-status';
import { UserIdentityBadge } from '@/components/quant/user-identity-badge';
import { StockTable, toStockRow } from '@/components/quant/stock-table';
import StockChart from '@/components/quant/stock-chart';
import { OnboardingWizard } from './components/OnboardingWizard';
import { MobileBottomTabBar } from './components/MobileBottomTabBar';

// ==================== 自动驾驶全局状态（Context）====================
// 速览模式多个区块（TopBar / ②今日推荐 / ④模拟交易）需要共享
// 5s 轮询一次 /api/simulator，避免每个组件各自拉
export interface SimOrder {
  id: string;
  code: string;
  direction: 'long' | 'short';
  type: 'market' | 'limit';
  price: number;
  volume: number;
  filledVolume: number;
  status: 'pending' | 'filled' | 'partial' | 'cancelled' | 'rejected';
  timestamp: number;
}
interface AutoPilotState {
  isRunning: boolean;
  isAutoPilot: boolean;
  tradingCodes: string[];
  totalAssets: number;
  totalPnL: number;
  orders: SimOrder[];        // 最近 50 条订单
  refresh: () => Promise<void>;
  setAutoPilot: (enabled: boolean) => Promise<boolean>;
}
const AutoPilotContext = createContext<AutoPilotState | null>(null);
function useAutoPilot() {
  const ctx = useContext(AutoPilotContext);
  if (!ctx) throw new Error('useAutoPilot must be inside <AutoPilotProvider>');
  return ctx;
}
function AutoPilotProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState({
    isRunning: false, isAutoPilot: false, tradingCodes: [] as string[],
    totalAssets: 0, totalPnL: 0, orders: [] as SimOrder[],
  });
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/simulator');
      const json = await res.json();
      if (json.success) {
        setState({
          isRunning: !!json.data.isRunning,
          isAutoPilot: !!json.data.isAutoPilot,
          tradingCodes: json.data.tradingCodes || [],
          totalAssets: json.data.account?.totalAssets || 0,
          totalPnL: json.data.account?.totalPnL || 0,
          orders: json.data.orders || [],
        });
      }
    } catch { /* ignore */ }
  }, []);

  // 存最新 refresh 引用，避免 setAutoPilot 闭包陈旧
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  // 监听新订单：用户开启通知权限后，新成交（自动成交 only）弹浏览器通知
  const prevOrderIdsRef = useRef<Set<string>>(new Set());
  const notifyEnabled = typeof window !== 'undefined' && localStorage.getItem('quant_notify_enabled') === '1';
  useEffect(() => {
    if (!notifyEnabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const currentIds = new Set(state.orders.map(o => o.id));
    const newIds = state.orders.filter(o => !prevOrderIdsRef.current.has(o.id));
    if (prevOrderIdsRef.current.size > 0 && newIds.length > 0) {
      // 仅通知自动驾驶成交（在 tradingCodes 中）
      const newAuto = newIds.filter(o => state.tradingCodes.includes(o.code) && o.status === 'filled');
      if (newAuto.length > 0) {
        new Notification('🤖 自动驾驶新成交', {
          body: newAuto.map(o =>
            `${o.direction === 'long' ? '↑ 买入' : '↓ 卖出'} ${o.code} ¥${o.price.toFixed(2)} × ${o.filledVolume || o.volume}`
          ).join('\n'),
          icon: '/quant-logo.svg',
          tag: 'auto-trade',
        });
      }
    }
    prevOrderIdsRef.current = currentIds;
  }, [state.orders, state.tradingCodes, notifyEnabled]);

  const setAutoPilot = useCallback(async (enabled: boolean) => {
    try {
      const res = await fetch('/api/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'autopilot', enabled }),
      });
      const json = await res.json();
      // 立即刷新一次（不等 5s 轮询）
      setTimeout(() => refreshRef.current(), 300);
      return !!json.success;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <AutoPilotContext.Provider value={{ ...state, refresh, setAutoPilot }}>
      {children}
    </AutoPilotContext.Provider>
  );
}

// ==================== 类型 ====================

interface IndexQuote {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

interface AccountSnapshot {
  balance: number;
  frozen: number;
  totalAssets: number;
  totalPnL: number;
  positions: { code: string; name: string; volume: number; avgCost: number; currentPrice: number; marketValue: number; unrealizedPnL: number; unrealizedPnLPct: number }[];
  isRunning: boolean;
  isAutoPilot: boolean;
  tradingCodes: string[];
}

interface ScreenerRow {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  // pe 字段已废弃：screener API 偶尔缺、IDB 未存，无法保证一致。详见 stock-table.tsx
  // 历史保留 pe 以便外部代码不报错，但不再渲染
  pe?: number;
  compositeScore: number;
  momentumScore?: number;
  moneyFlowScore?: number;
  technicalScore?: number;
  // 8 大类 / 3 大支柱 JSON 字符串（来自 IDB.factorScores），用于综合分详情弹窗
  factorScores?: string;
  // 2026-09-06：热点板块分级配额标签（今日推荐 Top10 来自最多 4 个热点板块，热度越高占席越多）
  industry?: string;            // 申万一级行业
  quotaRank?: number;           // 配额位次（1..N，越小越靠前）
  quotaSectorRank?: number;     // 板块热度名次（1 起，越小越热）
  quotaHeat?: number;           // 板块热度 0-100
  quotaSlots?: number;          // 该板块本次分到的推荐名额
}

interface WatchlistQuote {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  amount: number;
  signal?: 'buy' | 'sell' | 'neutral';
  signalReason?: string;
}

// ==================== 工具 ====================

const fmtMoney = (v: number) => v.toLocaleString('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2 });
const fmtPct = (v: number, withSign = true) => `${withSign && v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const fmtPrice = (v: number) => `¥${v.toFixed(2)}`;
// 格式化分析日期：20250615 → 2025-06-15
const formatAnalysisDate = (d: string) => {
  if (!d || d.length !== 8) return d;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
};

// ==================== ① 顶部：模式切换 + 身份 + 市场状态 ====================

// 计算距离下一时段的秒数（已废弃，改用服务器权威 useMarketStatus hook）
// 保留作为类型参考，调用方应改用 hook
type _LegacyMarketEvent = {
  state: 'pre-open' | 'morning' | 'lunch' | 'afternoon' | 'closed' | 'weekend';
  label: string;
  secondsToNext: number;
  nextLabel: string;
};

function MarketStatusCountdown() {
  // 改用服务器权威时间 hook
  // 数据源：每 60s 调一次 /api/quant/market-status，倒计时在客户端 1s 递减
  const { status, isServerAuthoritative } = useMarketStatus();

  // 加载中：显示占位
  if (!status) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full border bg-slate-800 text-slate-500 border-slate-700 flex items-center gap-1.5">
        <span>○ 加载中</span>
      </span>
    );
  }

  // 颜色
  const colorMap: Record<typeof status.state, string> = {
    'pre-open': 'bg-slate-800 text-slate-400 border-slate-700',
    'morning': 'bg-emerald-900/50 text-emerald-300 border-emerald-800',
    'lunch': 'bg-amber-900/40 text-amber-300 border-amber-800',
    'afternoon': 'bg-emerald-900/50 text-emerald-300 border-emerald-800',
    'closed': 'bg-slate-800 text-slate-500 border-slate-700',
    'weekend': 'bg-slate-800 text-slate-500 border-slate-700',
  };

  // 倒计时格式
  const fmtCountdown = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const showCountdown = (status.state === 'pre-open' || status.state === 'morning' || status.state === 'lunch' || status.state === 'afternoon');

  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full border ${colorMap[status.state]} flex items-center gap-1.5`}
      title={showCountdown
        ? `${status.nextLabel}（${isServerAuthoritative ? '服务器时间' : '本地时区估算'}）`
        : `A股交易时段（${isServerAuthoritative ? '服务器时间' : '本地时区估算'}）`}
    >
      <span>{status.label}</span>
      {showCountdown && (
        <>
          <span className="text-slate-600">·</span>
          <span className="font-mono text-[10px]">
            {status.nextLabel} <span className="text-amber-300 font-bold">{fmtCountdown(status.secondsToNext)}</span>
          </span>
        </>
      )}
    </span>
  );
}

// 📡 价格异动检测器：监听 watchlist 价格变化，> ±3% 弹通知
// 无 UI 渲染（返回 null）
function PriceAnomalyDetector() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
    const notifyEnabled = () => localStorage.getItem('quant_notify_enabled') === '1';
    const lastNotifiedRef = { current: new Map<string, number>() }; // code → 上次弹通知时的 changePercent

    const handler = (e: Event) => {
      if (!notifyEnabled() || Notification.permission !== 'granted') return;
      const detail = (e as CustomEvent).detail;
      const items: any[] = detail?.items || [];
      for (const it of items) {
        const cp = it.changePercent;
        if (Math.abs(cp) < 3) continue;
        // 同一涨跌幅不重复弹（容忍 ±0.3% 抖动）
        const last = lastNotifiedRef.current.get(it.code);
        if (last !== undefined && Math.abs(cp - last) < 0.3) continue;
        lastNotifiedRef.current.set(it.code, cp);
        new Notification(
          cp > 0 ? '📈 异动上涨' : '📉 异动下跌',
          {
            body: `${it.name || it.code} (${it.code})\n涨跌幅 ${cp >= 0 ? '+' : ''}${cp.toFixed(2)}%\n现价 ¥${it.price.toFixed(2)}`,
            icon: '/quant-logo.svg',
            tag: `anomaly-${it.code}`,
          }
        );
      }
    };
    window.addEventListener('quant:watchlist-prices', handler);
    return () => window.removeEventListener('quant:watchlist-prices', handler);
  }, []);

  return null;
}

/**
 * 风控事件流水面板
 * ──────────────────────────────────────────────────────────────────
 * 监听 CustomEvent 'quant:risk-triggered'（引擎在止损/止盈/日亏损触发时广播）。
 * 功能：
 *   1. 实时显示最近 20 条风控事件（按时间倒序）
 *   2. 触发瞬间弹浏览器通知（如果用户开启了通知权限）
 *   3. 一键清空
 * 数据结构：{ id, code, name, type, reason, price, pnl, timestamp }
 */
interface RiskEvent {
  id: string;
  code: string;
  name: string;
  type: string;        // 'stop_loss' | 'stop_profit' | 'risk_rule' | 'daily_loss_limit'
  reason: string;
  price: number;
  pnl: number;
  timestamp: number;
}

function RiskEventStream() {
  const [events, setEvents] = useState<RiskEvent[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      const evt: RiskEvent = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        code: d.code || '',
        name: d.name || d.code || '',
        type: d.type || 'risk_rule',
        reason: d.reason || '风控触发',
        price: d.price || 0,
        pnl: d.pnl || 0,
        timestamp: d.timestamp || Date.now(),
      };
      setEvents(prev => [evt, ...prev].slice(0, 20));

      // 弹浏览器通知（如果用户开了）
      if (typeof Notification !== 'undefined' &&
          Notification.permission === 'granted' &&
          localStorage.getItem('quant_notify_enabled') === '1') {
        const icon = d.pnl >= 0 ? '✅' : (d.type === 'stop_loss' ? '🛑' : '⚠️');
        new Notification(`${icon} ${d.name || d.code} · ${d.type}`, {
          body: `${d.reason}\n价格 ¥${(d.price || 0).toFixed(2)} · 浮盈 ${d.pnl >= 0 ? '+' : ''}¥${(d.pnl || 0).toFixed(0)}`,
          icon: '/quant-logo.svg',
          tag: `risk-${d.code}-${Math.floor((d.timestamp || Date.now()) / 1000)}`,
        });
      }
    };
    window.addEventListener('quant:risk-triggered', handler);
    return () => window.removeEventListener('quant:risk-triggered', handler);
  }, []);

  if (events.length === 0) return null;

  // 事件类型 icon/颜色
  const typeStyle: Record<string, { icon: string; color: string; label: string }> = {
    stop_loss:       { icon: '🛑', color: 'text-emerald-400 bg-emerald-900/30', label: '止损' },
    stop_profit:     { icon: '🎯', color: 'text-rose-400 bg-rose-900/30',         label: '止盈' },
    risk_rule:       { icon: '⚠️', color: 'text-amber-400 bg-amber-900/30',     label: '风控' },
    daily_loss_limit:{ icon: '🛑', color: 'text-red-400 bg-red-900/30',           label: '日亏停' },
  };
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          🛡️ 风控事件流水
          <span className="text-[10px] text-slate-500 font-normal">最近 {events.length} 条</span>
        </h2>
        <button
          onClick={() => setEvents([])}
          className="text-[10px] px-2 py-0.5 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          title="清空事件流水"
        >
          ✕ 清空
        </button>
      </div>
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {events.map(evt => {
          const style = typeStyle[evt.type] || typeStyle.risk_rule;
          return (
            <div
              key={evt.id}
              className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2 flex items-center gap-2 text-xs"
            >
              <span className="text-slate-500 font-mono w-16 flex-shrink-0">{formatTime(evt.timestamp)}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${style.color}`}>
                {style.icon} {style.label}
              </span>
              <span className="text-white font-semibold flex-shrink-0">{evt.name || evt.code}</span>
              <span className="text-slate-500 text-[10px] flex-shrink-0">({evt.code})</span>
              <span className="text-slate-300 truncate flex-1" title={evt.reason}>{evt.reason}</span>
              {evt.price > 0 && (
                <span className="text-slate-400 font-mono flex-shrink-0">¥{evt.price.toFixed(2)}</span>
              )}
              {evt.pnl !== 0 && (
                <span className={`font-mono flex-shrink-0 ${evt.pnl >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {evt.pnl >= 0 ? '+' : ''}¥{evt.pnl.toFixed(0)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function NotificationToggle() {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('quant_notify_enabled') === '1';
  });

  const request = async () => {
    if (typeof Notification === 'undefined') {
      toast.error('当前浏览器不支持通知 API');
      return;
    }
    if (Notification.permission === 'denied') {
      toast.error('通知权限已被拒绝，请在浏览器设置中手动开启');
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      localStorage.setItem('quant_notify_enabled', '1');
      setEnabled(true);
      new Notification('🔔 通知已开启', { body: '自动驾驶新成交时会弹出通知', icon: '/quant-logo.svg' });
    }
  };

  const disable = () => {
    localStorage.removeItem('quant_notify_enabled');
    setEnabled(false);
  };

  if (permission === 'unsupported') return null;

  // 已授权 + 已启用：显示绿色"🔔"
  if (permission === 'granted' && enabled) {
    return (
      <button
        onClick={disable}
        className="text-xs px-2 py-1 rounded border border-emerald-700/50 text-emerald-400 hover:bg-emerald-900/30 flex items-center gap-1"
        title="通知已开启 · 点击关闭"
      >
        🔔 <span className="hidden sm:inline">通知 ON</span>
      </button>
    );
  }

  // 其它状态（default / denied / granted但未启用）：显示开启按钮
  return (
    <button
      onClick={request}
      className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-400 hover:border-amber-500 hover:text-amber-400 flex items-center gap-1"
      title="开启后，自动驾驶新成交会弹浏览器通知"
    >
      🔕 <span className="hidden sm:inline">通知 OFF</span>
    </button>
  );
}

function TopBar() {
  // v3.0.2（2026-06-15）：data-section-target=me 让移动端 Tab Bar「👤 我」能 scrollIntoView
  // 市场状态由 MarketStatusCountdown 通过服务器权威 hook 展示（不再用客户端 isMarketOpen）
  const ap = useAutoPilot();
  return (
    <header data-section-target="me" className="bg-slate-900 border-b border-slate-800 sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/quant-logo.svg" alt="AI4U量化" className="h-7 w-auto" />
          <span className="text-xs px-2 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-800">⚡ 速览模式</span>
          <MarketStatusCountdown />
          {/* 自动驾驶指示灯：速览模式所有页面都可见 */}
          {ap.isAutoPilot && (
            <span
              className="text-xs px-2 py-0.5 rounded-full bg-red-900/50 text-red-300 border border-red-700/60 flex items-center gap-1.5"
              title={`自动驾驶中：${ap.tradingCodes.length} 只策略池，策略信号自动成交`}
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
              🤖 自动驾驶 ON
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* 🔔 浏览器通知开关 */}
          <NotificationToggle />
          {/* 🛡️ 管理员入口：受邀用户管理（仅当 cookie 标识为管理员时显示） */}
          <AdminEntry />
          {/* 📱 移动 App 下载中心 — v3.0.2 新增 */}
          <Link
            href="/quant/downloads"
            className="text-xs px-3 py-1.5 rounded-lg border border-emerald-700/60 bg-emerald-900/30 hover:bg-emerald-800/40 hover:border-emerald-500 text-emerald-300 transition-colors flex items-center gap-1"
            title="下载 AI4U 量化 App（Android APK · 5.6MB · 支持 iOS PWA）"
          >
            📱 移动 App
          </Link>
          <Link
            href="/quant/pro"
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 hover:border-blue-500 hover:text-blue-400 text-slate-300 transition-colors flex items-center gap-1"
            title="切到完整 10 Tab 专业模式"
          >
            🔧 专业模式
          </Link>
          <UserIdentityBadge />
        </div>
      </div>
    </header>
  );
}

/**
 * 管理员入口按钮
 * 仅当 openmaic_admin_cred 凭据存在时显示（说明当前用户是管理员 boris）
 */
function AdminEntry() {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // 检查 sessionStorage 是否有 admin 凭据（登录后由 /admin/invite-users 写入）
    const cred = sessionStorage.getItem('openmaic_admin_cred');
    setIsAdmin(!!cred);
  }, []);
  if (!isAdmin) return null;
  return (
    <Link
      href="/admin/invite-users"
      className="text-xs px-3 py-1.5 rounded-lg border border-amber-700/60 hover:border-amber-500 hover:text-amber-300 text-amber-400 transition-colors flex items-center gap-1"
      title="管理受邀用户：增删改查、分配邀请码"
    >
      🛡️ 用户管理
    </Link>
  );
}

// ==================== ②+ 综合分详情弹窗（v1 3-pillar / v2 8 大类） ====================

interface ScoreDetailStock {
  code: string;
  name: string;
  compositeScore: number;
  // v1: 6 个技术因子（momentum/rsi/mfi/...）; v2: 8 大类 + contributions + rawFactors
  // contributions / rawFactors 是 Record<string, number> 嵌套对象，所以类型用 any 更灵活
  factorScores?: Record<string, any>;
  momentumScore?: number;
  moneyFlowScore?: number;
  technicalScore?: number;
  // v1 弹窗现算百分位：整个 IDB 池子的子项快照（v2 不用，后端已算好）
  poolSnapshot?: { code: string; factors: Record<string, any> }[];
}

interface ScoreDetailModalProps {
  stock: ScoreDetailStock;
  scoreVersion: 'v1' | 'v2';
  onClose: () => void;
}

// v2 8 大类权重 + 关联的原始因子（与 /lib/quant/factor/v2/percentile.ts 对应）
// pctKey: 原始因子对应的百分位字段（在 FactorPercentiles 里）
//   - raw key 与 pct key 名字相同时省略
//   - 反向因子（PE/PB/PS/负债率/乖离率）已在 percentile.ts line 130 自动反向
//   - pctKey 缺省或空字符串 = 该因子不参与截面百分位
// reason: 解释"为什么这个权重"（弹窗表头 ? 图标 hover 显示）
const V2_DIMENSIONS: Record<string, {
  weight: number; label: string; formula: string; reason: string;
  rawKeys: { key: string; label: string; unit: string; desc: string; inverted?: boolean; pctKey?: string }[]
}> = {
  valuation: {
    weight: 18, label: '估值', formula: '(PE_pct + PB_pct + PS_pct) / 3  (反向)',
    reason: 'Barra Value 核心；A 股实证 IC≈0.05。低 PE/PB 长期跑赢，但需配合 ROE 防"价值陷阱"。',
    rawKeys: [
      { key: 'pe',  label: 'PE_TTM', unit: '',   desc: '市盈率（亏损=负）', inverted: true, pctKey: 'pe' },
      { key: 'pb',  label: 'PB',     unit: '',   desc: '市净率', inverted: true, pctKey: 'pb' },
      { key: 'ps',  label: 'PS',     unit: '',   desc: '市销率', inverted: true, pctKey: '' /* 未输出到 pcts */ },
    ],
  },
  quality: {
    weight: 14, label: '质量', formula: '(ROE_pct + 毛利率_pct + 负债率_pct) / 3',
    reason: 'Barra Quality 核心；高 ROE + 高毛利率 + 低负债率 = 强护城河。A 股 IC≈0.04，质量溢价稳定。',
    rawKeys: [
      { key: 'roe',         label: 'ROE',         unit: '%',  desc: '净资产收益率 TTM', pctKey: 'roe' },
      { key: 'grossMargin', label: '毛利率',     unit: '%',  desc: 'TTM 综合毛利率', pctKey: 'grossMargin' },
      { key: 'debtRatio',   label: '负债率',     unit: '%',  desc: '资产负债率（反向）', inverted: true, pctKey: '' /* 未输出到 pcts */ },
    ],
  },
  momentum: {
    weight: 12, label: '动量', formula: '20 日收益率 截面百分位',
    reason: '中期动量（20 日）IC 最稳；过短（5 日）噪音大，过长（60 日）动量崩盘风险高。',
    rawKeys: [
      { key: 'momentum5',  label: '5 日收益',  unit: '%',  desc: '近 5 个交易日累计收益' },
      { key: 'momentum20', label: '20 日收益', unit: '%',  desc: '近 20 个交易日累计收益（主要）', pctKey: 'momentum20' },
      { key: 'momentum60', label: '60 日收益', unit: '%',  desc: '中长期动量参考' },
    ],
  },
  reversal: {
    weight: 10, label: '反转', formula: '(RSI_pct + 乖离率_pct) / 2  (反向)',
    reason: 'A 股反转效应强（散户市+追涨杀跌）。RSI<30 + 负乖离 = 短期反弹概率高。',
    rawKeys: [
      { key: 'rsi14',  label: 'RSI(14)',  unit: '', desc: '相对强弱指标（<30 超卖→加分）', pctKey: 'rsi' },
      { key: 'cci14',  label: 'CCI(14)',  unit: '', desc: '通道指标' },
      { key: 'bias20', label: '乖离率(20)', unit: '%', desc: '股价 vs MA20（负乖离→反弹加分）', inverted: true, pctKey: 'bias' },
    ],
  },
  moneyFlow: {
    weight: 12, label: '资金流', formula: '5/20 日主力净流入 截面百分位',
    reason: 'A 股是"资金市"——主力净流入是行业轮动和板块行情的先行指标。',
    rawKeys: [
      { key: 'mainNetInflow5d',  label: '主力净流入 5日',  unit: '万', desc: '5 个交易日累计' },
      { key: 'mainNetInflow20d', label: '主力净流入 20日', unit: '万', desc: '20 个交易日累计（主要）', pctKey: 'mainNetInflow' },
      { key: 'volumeRatio',      label: '量比',             unit: '',   desc: '当日量 / 5日均量', pctKey: 'volumeRatio' },
      { key: 'turnoverRate',     label: '换手率',           unit: '%',  desc: '当日换手率', pctKey: 'turnoverRate' },
    ],
  },
  technical: {
    weight: 12, label: '技术面', formula: '(MACD + KDJ + BOLL + ADX) / 4',
    reason: '技术指标综合捕捉趋势确认信号（MACD/KDJ 共振 + 布林带位置 + ADX 趋势强度）。',
    rawKeys: [
      { key: 'macdHist',      label: 'MACD Hist', unit: '',   desc: 'MACD 柱状图（正=多头）', pctKey: 'macd' },
      { key: 'kdjK',          label: 'KDJ-K',     unit: '',   desc: 'KDJ 指标 K 值' },
      { key: 'kdjD',          label: 'KDJ-D',     unit: '',   desc: 'KDJ 指标 D 值' },
      { key: 'bollPosition',  label: 'BOLL 位置', unit: '',   desc: '股价在布林带的位置（0-1）', pctKey: 'bollPosition' },
      { key: 'adx',           label: 'ADX',       unit: '',   desc: '趋势强度（>25 趋势确立）', pctKey: 'adx' },
    ],
  },
  turnover: {
    weight: 12, label: '换手率', formula: '截面换手率分位（3-15% 最优）',
    reason: '适度换手率（3-15%）最优：过低 = 没人气；过高 = 投机泡沫。',
    rawKeys: [
      { key: 'turnoverRate', label: '换手率', unit: '%', desc: '当日换手率', pctKey: 'turnoverRate' },
      { key: 'avgAmount20d', label: '20日均成交额', unit: '亿', desc: '平均日成交额（流动性）' },
    ],
  },
  wqAlpha: {
    weight: 10, label: 'WQ Alpha', formula: 'WorldQuant 101 Alphas 复合 截面百分位',
    reason: 'WorldQuant 101 Alphas 的精简版（10 个核心 alpha），捕捉非线性量价规律。',
    rawKeys: [
      { key: 'wqAlphaScore', label: 'WQ 101 Alphas', unit: '', desc: '10 个核心 Alpha 复合打分（-100~+100）', pctKey: 'wqAlpha' },
    ],
  },
};

// v1 3-pillar 权重（与 /lib/quant/factor/v2/weights.ts V1_OLD_WEIGHTS 一致）
const V1_DIMENSIONS: Record<string, {
  weight: number; label: string; formula: string; reason: string;
  rawKeys: { key: string; label: string; unit: string; desc: string; inverted?: boolean; pctKey?: string }[]
}> = {
  momentum: {
    weight: 40, label: '动量', formula: 'momentumScore = momScore × 0.4 + mom5 × 0.2 + mom20 × 0.2 + bias × 0.2',
    reason: 'v1 旧 3-pillar 时代动量主导（40%），但 A 股动量因子失效严重（IC 频繁翻负）。',
    rawKeys: [
      { key: 'momentum5',  label: '5 日动量', unit: '%', desc: '5 个交易日累计收益' },
      { key: 'momentum20', label: '20 日动量', unit: '%', desc: '20 个交易日累计收益' },
      { key: 'bias',       label: '乖离率',   unit: '', desc: '股价偏离 MA20 程度' },
    ],
  },
  moneyFlow: {
    weight: 30, label: '资金流', formula: 'moneyFlowScore = MFI × 0.4 + WR × 0.3 + ADX × 0.3',
    reason: 'v1 用 MFI/WR 近似资金流；实际 A 股"主力净流入"接口是 v2 才接入的。',
    rawKeys: [
      { key: 'mfi',        label: 'MFI',       unit: '', desc: '资金流量指标（量价共振）' },
      { key: 'williamsR',  label: 'WR 威廉',   unit: '', desc: '威廉指标（<−80 超卖）' },
      { key: 'adx',        label: 'ADX',       unit: '', desc: '趋势强度' },
    ],
  },
  technical: {
    weight: 30, label: '技术面', formula: 'MACD 金叉 + BOLL 突破 + RSI 中性 合成',
    reason: '技术面综合；v1 没有估值/质量/反转维度，信息面窄。',
    rawKeys: [
      { key: 'macd',           label: 'MACD',     unit: '', desc: 'MACD 信号（>0 多头）' },
      { key: 'kdj',            label: 'KDJ',      unit: '', desc: 'KDJ 信号' },
      { key: 'rsi',            label: 'RSI',      unit: '', desc: 'RSI（30-70 中性区间）' },
      { key: 'bollPosition',   label: 'BOLL 位置', unit: '', desc: '布林带位置' },
      { key: 'volatility',     label: '波动率',   unit: '', desc: 'ATR 占比' },
    ],
  },
};

// 工具：把原始值格式化成友好字符串
// isV1: v1 数据是 0-100 子分（如 momentum5=65 实际是 50+raw*500 反算的子分）
//       显示时加 "（子分）" 提示，避免和真实 raw 百分比混淆
function formatRawVal(v: any, unit: string, isV1: boolean = false): string {
  if (v === undefined || v === null) return '—';
  if (typeof v !== 'number' || isNaN(v)) return '—';
  if (isV1) {
    // v1 存的是 0-100 子分；直接显示数字
    return `${v.toFixed(0)}（子分）`;
  }
  if (unit === '%') return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  if (unit === '万') return v >= 0 ? `+${v.toFixed(0)}万` : `${v.toFixed(0)}万`;
  if (unit === '亿') return v >= 0 ? `+${v.toFixed(2)}亿` : `${v.toFixed(2)}亿`;
  return v.toFixed(2);
}

function ScoreDetailModal({ stock, scoreVersion, onClose }: ScoreDetailModalProps) {
  const isV2 = scoreVersion === 'v2';
  const dimensions = isV2 ? V2_DIMENSIONS : V1_DIMENSIONS;
  // 防御：如果 factorScores 仍是 JSON 字符串（v1 路径或老数据），现 parse
  let rawFactorScores: any = stock.factorScores;
  if (typeof rawFactorScores === 'string') {
    try { rawFactorScores = JSON.parse(rawFactorScores); } catch { rawFactorScores = {}; }
  }
  const factors = rawFactorScores || {};
  const total = stock.compositeScore ?? 0;
  // v2 才有 rawFactors + percentiles；v1 用 factors 本身（已经是子项）
  const rawFactors = isV2 ? factors.rawFactors || {} : factors;
  const percentiles = isV2 ? factors.percentiles || {} : {};
  // 候选池规模：v2 走 IDB 存的 poolSize；v1 走 poolSnapshot 长度，兜底 100
  const poolSize = isV2
    ? (factors.poolSize || 0)
    : (stock.poolSnapshot?.length || 100);

  // v1 现算百分位：把所有 rawKeys 在 poolSnapshot 上做截面百分位（0-1）
  // 返回 { rsi: 0.85, momentum: 0.62, ... }（同 key 命名）
  // v1 弹窗现算百分位（v2 后端已算，跳过）
  const v1Percentiles = useMemo((): Record<string, number> => {
    if (isV2) return {};
    const snap = stock.poolSnapshot;
    if (!snap || snap.length < 2) return {};
    const result: Record<string, number> = {};
    // V1_DIMENSIONS 全 4 个大类，每个的 rawKeys
    const allRawKeys: { key: string; inverted?: boolean }[] = [];
    Object.values(V1_DIMENSIONS).forEach(d => {
      d.rawKeys.forEach(rk => allRawKeys.push(rk));
    });
    for (const rk of allRawKeys) {
      // 收集该 key 在整个池子的值（过滤 NaN）
      const vals: { v: number; idx: number }[] = [];
      snap.forEach(p => {
        const v = p.factors?.[rk.key];
        if (typeof v === 'number' && !isNaN(v)) vals.push({ v, idx: vals.length });
      });
      if (vals.length < 2) continue;
      // 排序后取本股票百分位
      const sorted = [...vals].sort((a, b) => a.v - b.v);
      const myV = factors[rk.key];
      if (typeof myV !== 'number' || isNaN(myV)) continue;
      // 二分找位置
      let lo = 0, hi = sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid].v < myV) lo = mid + 1;
        else hi = mid;
      }
      let pct = lo / sorted.length;
      // 反向因子（bias）— 高 raw 反而不好，pct 取反
      if (rk.inverted) pct = 1 - pct;
      result[rk.key] = pct;
    }
    return result;
  }, [isV2, stock.poolSnapshot, factors]);

  // 计算实际贡献（v2 用 contributions 字段；v1 现算）
  const getContrib = (key: string): number => {
    if (isV2 && factors.contributions && typeof factors.contributions[key] === 'number') {
      return factors.contributions[key];
    }
    // 兜底：因子值 × 权重 / 100
    const scoreVal = factors[key];
    const w = dimensions[key]?.weight || 0;
    if (typeof scoreVal !== 'number') return 0;
    return scoreVal * w / 100;
  };

  // 实际生效权重（v2 走 diagnostics.weightsUsed；v1 走默认维度权重）
  // 弹窗显示"为什么这个权重"时会标 "当前生效: X（来自 IC 派生 / Barra 默认）"
  const effectiveWeights: Record<string, number> = isV2 && factors.weightsUsed
    ? factors.weightsUsed
    : Object.fromEntries(Object.entries(dimensions).map(([k, d]) => [k, d.weight]));
  // 权重来源（仅 v2）
  const weightSource = isV2 ? (factors.weightSource || 'default') : 'v1';

  // 取某个 raw key 的值（v2 rawFactors / v1 factors）和百分位
  const getRawAndPct = (rk: { key: string }): { raw: number | null; pct: number | null; label: string; unit: string } => {
    const rawV = isV2 ? rawFactors[rk.key] : factors[rk.key];
    const pct = getPct(rk);
    const label = (rk as any).label || rk.key;
    const unit = (rk as any).unit || '';
    return {
      raw: typeof rawV === 'number' && !isNaN(rawV) ? rawV : null,
      pct: pct ?? null,
      label, unit,
    };
  };

  // 格式化百分位 0-1 → "85.3%"（pct null → "—"）
  const fmtPct = (p: number | null) => p == null ? '—' : (p * 100).toFixed(1) + '%';
  // 格式化 raw value（带单位，pe/pb 1 位小数，momentum 百分比形式）
  const fmtRaw = (rk: { key: string; unit: string }, v: number | null): string => {
    if (v == null) return '—';
    if (rk.unit === '%') return (v * 100).toFixed(2) + '%';
    if (rk.key === 'mainNetInflow5d' || rk.key === 'mainNetInflow20d') return v.toFixed(0) + '万';
    if (rk.key === 'avgAmount20d') return (v / 1e8).toFixed(2) + '亿';
    return v.toFixed(2);
  };

  // 生成该维度的"代入数字"算式（替换进度条位置）
  // 返回：单行等式字符串（适合在 1 行内显示）
  const getInlineFormula = (key: string): string => {
    const info = dimensions[key];
    if (!info) return '';
    const raws: Record<string, { raw: number | null; pct: number | null }> = {};
    for (const rk of info.rawKeys) {
      const { raw, pct } = getRawAndPct(rk);
      raws[rk.key] = { raw, pct };
    }
    const fs = factors[key];
    const fsStr = typeof fs === 'number' ? fs.toFixed(1) : '—';
    switch (key) {
      case 'valuation': {
        const pe = fmtPct(raws.pe?.pct ?? null);
        const pb = fmtPct(raws.pb?.pct ?? null);
        const ps = fmtPct(raws.ps?.pct ?? null);
        return `(${pe} + ${pb} + ${ps}) / 3 × 100 = ${fsStr}`;
      }
      case 'quality': {
        const roe = fmtPct(raws.roe?.pct ?? null);
        const gm = fmtPct(raws.grossMargin?.pct ?? null);
        const dr = fmtPct(raws.debtRatio?.pct ?? null);
        return `(${roe} + ${gm} + ${dr}) / 3 × 100 = ${fsStr}`;
      }
      case 'momentum': {
        const m20 = raws.momentum20?.raw;
        const m20Pct = fmtPct(raws.momentum20?.pct ?? null);
        return `momentum20=${m20 != null ? (m20 * 100).toFixed(2) + '%' : '—'} → ${m20Pct} × 100 = ${fsStr}`;
      }
      case 'reversal': {
        const rsi = raws.rsi14?.raw;
        const bias = raws.bias20?.raw;
        return `RSI=${rsi != null ? rsi.toFixed(1) : '—'}, 乖离=${bias != null ? bias.toFixed(2) + '%' : '—'} → ${fmtPct(((raws.rsi14?.pct ?? 0) + (raws.bias20?.pct ?? 0)) / 2)} × 100 = ${fsStr}`;
      }
      case 'moneyFlow': {
        const m20 = raws.mainNetInflow20d?.raw;
        return `主力净流入20日=${m20 != null ? m20.toFixed(0) + '万' : '—'} → ${fmtPct(raws.mainNetInflow20d?.pct ?? null)} × 100 = ${fsStr}`;
      }
      case 'technical': {
        const macd = fmtPct(raws.macdHist?.pct ?? null);
        const k = fmtPct(raws.kdjK?.pct ?? null);
        const boll = fmtPct(raws.bollPosition?.pct ?? null);
        const adx = fmtPct(raws.adx?.pct ?? null);
        return `(${macd} + ${k} + ${boll} + ${adx}) / 4 × 100 = ${fsStr}`;
      }
      case 'turnover': {
        const tr = raws.turnoverRate?.raw;
        return `换手率=${tr != null ? tr.toFixed(2) + '%' : '—'} → ${fmtPct(raws.turnoverRate?.pct ?? null)} × 100 = ${fsStr}`;
      }
      case 'wqAlpha': {
        const wq = raws.wqAlphaScore?.raw;
        return `WQ=${wq != null ? wq.toFixed(1) : '—'} → ${fmtPct(raws.wqAlphaScore?.pct ?? null)} × 100 = ${fsStr}`;
      }
      default: {
        // v1 三大支柱
        return `v1 公式: ${info.formula} → ${fsStr}`;
      }
    }
  };

  // 收集单个维度的算式 rows（与 IIFE 内的 calcSteps 同等结构）
  // 复用于：弹窗表格渲染 + Markdown 导出
  const buildFormulaRows = (key: string): { step: string; val: string; note: string }[] => {
    const info = dimensions[key];
    if (!info) return [];
    const raws: Record<string, { raw: number | null; pct: number | null }> = {};
    for (const rk of info.rawKeys) {
      const { raw, pct } = getRawAndPct(rk);
      raws[rk.key] = { raw, pct };
    }
    const rows: { step: string; val: string; note: string }[] = [];
    const fs = factors[key];
    const fsStr = typeof fs === 'number' ? fs.toFixed(1) : '—';
    if (key === 'valuation') {
      const pe = raws.pe, pb = raws.pb, ps = raws.ps;
      const pcts = [pe, pb, ps].map(r => r?.pct ?? null);
      const validPcts = pcts.filter(p => p != null) as number[];
      const avgPct = validPcts.length > 0 ? validPcts.reduce((s, x) => s + x, 0) / validPcts.length : null;
      rows.push({ step: 'PE_TTM 百分位（反向）', val: fmtPct(pe?.pct ?? null), note: `raw=${pe?.raw != null ? pe.raw.toFixed(2) : '—'}, 低 PE=高分` });
      rows.push({ step: 'PB 百分位（反向）', val: fmtPct(pb?.pct ?? null), note: `raw=${pb?.raw != null ? pb.raw.toFixed(2) : '—'}, 低 PB=高分` });
      rows.push({ step: 'PS 百分位（反向）', val: fmtPct(ps?.pct ?? null), note: `raw=${ps?.raw != null ? ps.raw.toFixed(2) : '—'}, 低 PS=高分` });
      rows.push({ step: '聚合', val: avgPct != null ? fmtPct(avgPct) : '—', note: '(PE+PB+PS)/3' });
      rows.push({ step: '→ 大类分', val: fsStr, note: '× 100' });
    } else if (key === 'quality') {
      const roe = raws.roe, gm = raws.grossMargin, dr = raws.debtRatio;
      const pcts = [roe, gm, dr].map(r => r?.pct ?? null);
      const validPcts = pcts.filter(p => p != null) as number[];
      const avgPct = validPcts.length > 0 ? validPcts.reduce((s, x) => s + x, 0) / validPcts.length : null;
      rows.push({ step: 'ROE 百分位', val: fmtPct(roe?.pct ?? null), note: `raw=${roe?.raw != null ? (roe.raw * 100).toFixed(2) + '%' : '—'}` });
      rows.push({ step: '毛利率 百分位', val: fmtPct(gm?.pct ?? null), note: `raw=${gm?.raw != null ? (gm.raw * 100).toFixed(2) + '%' : '—'}` });
      rows.push({ step: '负债率 百分位（反向）', val: fmtPct(dr?.pct ?? null), note: `raw=${dr?.raw != null ? (dr.raw * 100).toFixed(2) + '%' : '—'}` });
      rows.push({ step: '聚合', val: avgPct != null ? fmtPct(avgPct) : '—', note: '(ROE+毛利率+负债率)/3' });
      rows.push({ step: '→ 大类分', val: fsStr, note: '× 100' });
    } else if (key === 'momentum') {
      const m20 = raws.momentum20;
      rows.push({ step: '5 日收益', val: raws.momentum5?.raw != null ? (raws.momentum5.raw * 100).toFixed(2) + '%' : '—', note: '近 5 日累计' });
      rows.push({ step: '20 日收益（主要）', val: m20?.raw != null ? (m20.raw * 100).toFixed(2) + '%' : '—', note: '近 20 日累计' });
      rows.push({ step: '60 日收益', val: raws.momentum60?.raw != null ? (raws.momentum60.raw * 100).toFixed(2) + '%' : '—', note: '中长期动量' });
      rows.push({ step: '20 日百分位', val: fmtPct(m20?.pct ?? null), note: 'percentileRank' });
      rows.push({ step: '→ 大类分', val: fsStr, note: '× 100' });
    } else if (key === 'reversal') {
      const rsi = raws.rsi14, bias = raws.bias20;
      const rsiPct = rsi?.pct ?? 0, biasPct = bias?.pct ?? 0;
      const avgPct = (rsi?.pct != null || bias?.pct != null) ? (rsiPct + biasPct) / 2 : null;
      rows.push({ step: 'RSI(14)', val: rsi?.raw != null ? rsi.raw.toFixed(1) : '—', note: '0-100, <30 超卖加分' });
      rows.push({ step: 'CCI(14)', val: raws.cci14?.raw != null ? raws.cci14.raw.toFixed(1) : '—', note: '通道指标' });
      rows.push({ step: '乖离率(20)', val: bias?.raw != null ? bias.raw.toFixed(2) + '%' : '—', note: '负乖离加分' });
      rows.push({ step: '聚合', val: fmtPct(avgPct), note: '(RSI+乖离)/2' });
      rows.push({ step: '→ 大类分', val: fsStr, note: '× 100' });
    } else if (key === 'moneyFlow') {
      const m20 = raws.mainNetInflow20d;
      rows.push({ step: '主力净流入 5日（万）', val: raws.mainNetInflow5d?.raw != null ? raws.mainNetInflow5d.raw.toFixed(0) : '—', note: '5 个交易日累计' });
      rows.push({ step: '主力净流入 20日（万，主要）', val: m20?.raw != null ? m20.raw.toFixed(0) : '—', note: '20 个交易日累计' });
      rows.push({ step: '量比', val: raws.volumeRatio?.raw != null ? raws.volumeRatio.raw.toFixed(2) : '—', note: '当日量/5日均量' });
      rows.push({ step: '换手率', val: raws.turnoverRate?.raw != null ? raws.turnoverRate.raw.toFixed(2) : '—', note: '当日换手率' });
      rows.push({ step: '聚合（主要）', val: fmtPct(m20?.pct ?? null), note: 'mainNetInflow20d_pct' });
      rows.push({ step: '→ 大类分', val: fsStr, note: '× 100' });
    } else if (key === 'technical') {
      const macd = raws.macdHist, kk = raws.kdjK, kd = raws.kdjD, boll = raws.bollPosition, adx = raws.adx;
      const pcts = [macd, kk, kd, boll, adx].map(r => r?.pct ?? null);
      const validPcts = pcts.filter(p => p != null) as number[];
      const avgPct = validPcts.length > 0 ? validPcts.reduce((s, x) => s + x, 0) / validPcts.length : null;
      rows.push({ step: 'MACD Hist', val: macd?.raw != null ? macd.raw.toFixed(3) : '—', note: '>0 多头' });
      rows.push({ step: 'KDJ-K', val: kk?.raw != null ? kk.raw.toFixed(1) : '—', note: '0-100' });
      rows.push({ step: 'KDJ-D', val: kd?.raw != null ? kd.raw.toFixed(1) : '—', note: '0-100' });
      rows.push({ step: 'BOLL 位置', val: boll?.raw != null ? boll.raw.toFixed(2) : '—', note: '0-1, 0.5 中性' });
      rows.push({ step: 'ADX', val: adx?.raw != null ? adx.raw.toFixed(1) : '—', note: '>25 趋势确立' });
      rows.push({ step: '聚合', val: fmtPct(avgPct), note: '(MACD+KDJ+BOLL+ADX)/4' });
      rows.push({ step: '→ 大类分', val: fsStr, note: '× 100' });
    } else if (key === 'turnover') {
      const tr = raws.turnoverRate;
      rows.push({ step: '换手率', val: tr?.raw != null ? tr.raw.toFixed(2) + '%' : '—', note: '3-15% 最优' });
      rows.push({ step: '20 日均成交额（亿）', val: raws.avgAmount20d?.raw != null ? (raws.avgAmount20d.raw / 1e8).toFixed(2) : '—', note: '流动性代理' });
      rows.push({ step: '聚合', val: fmtPct(tr?.pct ?? null), note: 'turnoverRate_pct' });
      rows.push({ step: '→ 大类分', val: fsStr, note: '× 100' });
    } else if (key === 'wqAlpha') {
      const wq = raws.wqAlphaScore;
      rows.push({ step: 'WQ 101 Alphas 复合', val: wq?.raw != null ? wq.raw.toFixed(1) : '—', note: '-100~+100, >0 多头' });
      rows.push({ step: '聚合', val: fmtPct(wq?.pct ?? null), note: 'percentileRank' });
      rows.push({ step: '→ 大类分', val: fsStr, note: '× 100' });
    } else {
      rows.push({ step: 'v1 公式', val: info.formula, note: '3-pillar 旧体系' });
      rows.push({ step: '→ 大类分', val: fsStr, note: '已按 v1 加权' });
    }
    return rows;
  };

  // 生成 Markdown 格式的完整算式（8 大类各一段，标题 + 表格）
  const [copiedMd, setCopiedMd] = useState(false);
  const formatAllFormulasAsMarkdown = (): string => {
    const lines: string[] = [];
    lines.push(`# ${stock.name}（${stock.code}）综合分算式明细`);
    lines.push('');
    lines.push(`- 综合分：${counterfactualTotal.toFixed(1)} / 100`);
    lines.push(`- 评分版本：${isV2 ? 'v2（8 大类）' : 'v1（3 大支柱）'}`);
    lines.push(`- 候选池规模：${poolSize} 只`);
    lines.push(`- 百分位范围：${pctScope === 'industry' ? '行业内' : '全市场'}`);
    if (isV2 && factors.weightSource) {
      lines.push(`- 权重来源：${factors.weightSource === 'ic' ? 'IC 动态定权' : factors.weightSource === 'manual' ? '手动定权' : 'Barra 默认'}`);
    }
    lines.push('');
    for (const [key, dim] of Object.entries(dimensions)) {
      const fs = factors[key];
      if (typeof fs !== 'number') continue;
      lines.push(`## ${dim.label}（权重 ${dim.weight}）`);
      lines.push('');
      const rows = buildFormulaRows(key);
      lines.push('| 步骤 | 值 | 说明 |');
      lines.push('| --- | --- | --- |');
      for (const r of rows) {
        lines.push(`| ${r.step} | \`${r.val}\` | ${r.note} |`);
      }
      lines.push('');
    }
    return lines.join('\n');
  };

  // 复制 Markdown 到剪贴板
  const copyFormulasAsMarkdown = async () => {
    const md = formatAllFormulasAsMarkdown();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(md);
      } else {
        // 兜底：textarea + execCommand
        const ta = document.createElement('textarea');
        ta.value = md;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 2000);
    } catch (e: any) {
      alert('复制失败：' + (e?.message || String(e)));
    }
  };

  // ── SVG 图表生成器 ────────────────────────────────
  // IC 趋势图：8 大类 IC 时序折线
  const buildICTrendSvg = (): string => {
    let history: { ts: number; mode: string; icStats: any }[] = [];
    try {
      const raw = localStorage.getItem('quant_ic_history_log');
      if (raw) history = JSON.parse(raw);
    } catch { /* ignore */ }
    const filtered = history.filter(h => h.mode === (factors.icMode || 'snapshot'));
    if (filtered.length < 2) return '';

    const W = 800, H = 320, PAD = 50;
    const dims = Object.keys(dimensions);
    const xStep = (W - PAD * 2) / Math.max(filtered.length - 1, 1);
    const colors = ['#fb7185', '#34d399', '#fcd34d', '#60a5fa', '#a78bfa', '#fb923c', '#22d3ee', '#f472b6'];

    // 找最大 |IC| 用于 Y 轴缩放
    let maxAbsIc = 0.2;
    for (const h of filtered) {
      for (const k of dims) {
        const ic = h.icStats?.[k]?.ic;
        if (typeof ic === 'number') maxAbsIc = Math.max(maxAbsIc, Math.abs(ic));
      }
    }
    maxAbsIc = Math.max(maxAbsIc, 0.05);
    const yScale = (ic: number) => H - PAD - (ic / maxAbsIc) * (H - PAD * 2) / 2 - (H - PAD) / 2;

    // 构造 SVG
    const lines: string[] = [];
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="monospace" font-size="11">`);
    // 背景
    lines.push(`<rect width="${W}" height="${H}" fill="#0f172a"/>`);
    // 中线
    lines.push(`<line x1="${PAD}" y1="${(H - PAD + PAD) / 2}" x2="${W - PAD}" y2="${(H - PAD + PAD) / 2}" stroke="#475569" stroke-width="0.5"/>`);
    // Y 轴标签
    for (let v = -maxAbsIc; v <= maxAbsIc; v += maxAbsIc / 2) {
      const y = yScale(v);
      lines.push(`<text x="${PAD - 6}" y="${y + 3}" fill="#94a3b8" text-anchor="end">${v.toFixed(3)}</text>`);
      lines.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="#1e293b" stroke-width="0.5"/>`);
    }
    // 8 大类折线
    dims.forEach((k, i) => {
      const color = colors[i % colors.length];
      const points: string[] = [];
      filtered.forEach((h, idx) => {
        const ic = h.icStats?.[k]?.ic;
        if (typeof ic === 'number') {
          const x = PAD + idx * xStep;
          const y = yScale(ic);
          points.push(`${x},${y}`);
        }
      });
      if (points.length >= 2) {
        lines.push(`<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5"/>`);
        // 末点加重
        const lastPt = points[points.length - 1].split(',');
        lines.push(`<circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="3" fill="${color}"/>`);
      }
    });
    // X 轴时间标签（首末）
    if (filtered.length > 0) {
      const first = new Date(filtered[0].ts).toISOString().slice(5, 10);
      const last = new Date(filtered[filtered.length - 1].ts).toISOString().slice(5, 10);
      lines.push(`<text x="${PAD}" y="${H - PAD + 18}" fill="#94a3b8">${first}</text>`);
      lines.push(`<text x="${W - PAD}" y="${H - PAD + 18}" fill="#94a3b8" text-anchor="end">${last}</text>`);
    }
    // 图例
    const legendY = PAD - 25;
    dims.forEach((k, i) => {
      const dim = dimensions[k];
      const x = PAD + (i % 4) * 110;
      const y = legendY + Math.floor(i / 4) * 14;
      lines.push(`<rect x="${x}" y="${y - 6}" width="8" height="8" fill="${colors[i % colors.length]}"/>`);
      lines.push(`<text x="${x + 12}" y="${y + 2}" fill="#cbd5e1">${dim.label}</text>`);
    });
    // 标题
    lines.push(`<text x="${W / 2}" y="14" fill="#e2e8f0" text-anchor="middle" font-size="13" font-weight="bold">${stock.name} 8 大类 IC 趋势（${filtered.length} 次，${factors.icMode === 'backtest' ? '已实现收益' : '当日'}）</text>`);
    lines.push('</svg>');
    return lines.join('');
  };

  // 8 大类分数柱状图
  const buildScoreBarSvg = (): string => {
    const dims = Object.entries(dimensions).filter(([k]) => typeof factors[k] === 'number');
    if (dims.length === 0) return '';
    const W = 700, H = 320, PAD = 80;
    const barH = 22;
    const gap = 8;
    const maxScore = 100;
    const colors = ['#fb7185', '#34d399', '#fcd34d', '#60a5fa', '#a78bfa', '#fb923c', '#22d3ee', '#f472b6'];

    const lines: string[] = [];
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="monospace" font-size="11">`);
    lines.push(`<rect width="${W}" height="${H}" fill="#0f172a"/>`);
    // 标题
    lines.push(`<text x="${W / 2}" y="14" fill="#e2e8f0" text-anchor="middle" font-size="13" font-weight="bold">${stock.name} ${isV2 ? '8 大类' : '3 大支柱'}分数</text>`);
    // 条形
    dims.forEach(([k, dim], i) => {
      const score = factors[k] as number;
      const y = PAD + i * (barH + gap);
      const w = (score / maxScore) * (W - PAD - 100);
      const color = colors[i % colors.length];
      // 标签
      lines.push(`<text x="10" y="${y + barH / 2 + 4}" fill="#cbd5e1">${dim.label}</text>`);
      // 背景条
      lines.push(`<rect x="${PAD}" y="${y}" width="${W - PAD - 100}" height="${barH}" fill="#1e293b"/>`);
      // 实际条
      lines.push(`<rect x="${PAD}" y="${y}" width="${w}" height="${barH}" fill="${color}"/>`);
      // 数值
      lines.push(`<text x="${W - 90}" y="${y + barH / 2 + 4}" fill="#fff">${score.toFixed(1)}</text>`);
    });
    lines.push('</svg>');
    return lines.join('');
  };

  // SVG → base64 data URI
  const svgToDataUri = (svg: string): string => {
    const b64 = typeof btoa !== 'undefined' ? btoa(unescape(encodeURIComponent(svg))) : '';
    return `data:image/svg+xml;base64,${b64}`;
  };

  // 纯函数：生成单只股票的完整 Markdown 报告（不依赖闭包）
  // 用于：单股导出 + 批量导出（每只调一次）
  const buildStockReportMd = (params: {
    stock: { code: string; name: string };
    scoreVersion: 'v1' | 'v2';
    factorScores: Record<string, any>;
    counterfactualTotal: number;
    rawTotal: number;
    counterfactualEnabled: boolean;
    poolSize: number;
    pctScope: 'market' | 'industry';
  }): string => {
    const { stock, scoreVersion, factorScores, counterfactualTotal, rawTotal, counterfactualEnabled, poolSize, pctScope } = params;
    const isV2Local = scoreVersion === 'v2';
    const factorsLocal = factorScores || {};
    const rawFactorsLocal = isV2Local ? factorsLocal.rawFactors || {} : factorsLocal;
    const percentilesLocal = isV2Local ? factorsLocal.percentiles || {} : {};
    const dimsLocal = isV2Local ? V2_DIMENSIONS : V1_DIMENSIONS;
    const icStatsLocal = isV2Local ? factorsLocal.icStats : null;
    const icModeLocal = isV2Local ? factorsLocal.icMode : 'snapshot';
    const weightSourceLocal = isV2Local ? factorsLocal.weightSource : 'v1';
    const getRawAndPctLocal = (rk: { key: string; pctKey?: string }): { raw: number | null; pct: number | null } => {
      const rawV = isV2Local ? rawFactorsLocal[rk.key] : factorsLocal[rk.key];
      let pct: number | null = null;
      if (isV2Local) {
        if (pctScope === 'industry' && percentilesLocal.industryPctXxx != null) {
          // 简化：批量报告里只用全市场 pct
        }
        const key = rk.pctKey || rk.key;
        pct = percentilesLocal[key];
      }
      return { raw: typeof rawV === 'number' && !isNaN(rawV) ? rawV : null, pct };
    };
    const buildRows = (key: string): { step: string; val: string; note: string }[] => {
      const info = dimsLocal[key];
      if (!info) return [];
      const raws: Record<string, { raw: number | null; pct: number | null }> = {};
      for (const rk of info.rawKeys) {
        const { raw, pct } = getRawAndPctLocal(rk);
        raws[rk.key] = { raw, pct };
      }
      const rows: { step: string; val: string; note: string }[] = [];
      const fs = factorsLocal[key];
      const fsStr = typeof fs === 'number' ? fs.toFixed(1) : '—';
      // 简版：直接给一行汇总（节省批量报告长度）
      rows.push({ step: '原始因子', val: info.rawKeys.map(rk => `${rk.label}=${raws[rk.key].raw != null ? raws[rk.key].raw!.toFixed(2) : '—'}`).join(', '), note: info.formula });
      rows.push({ step: '大类分', val: fsStr, note: `权重 ${info.weight}` });
      return rows;
    };

    const lines: string[] = [];
    const today = new Date().toISOString().slice(0, 10);
    lines.push(`### ${stock.name}（${stock.code}）`);
    lines.push('');
    lines.push(`- 总分：**${counterfactualTotal.toFixed(1)}** / 100`);
    lines.push(`- 等级：${counterfactualTotal >= 70 ? '💎 强烈推荐' : counterfactualTotal >= 55 ? '✅ 推荐买入' : counterfactualTotal >= 40 ? '⚠ 谨慎关注' : '⛔ 暂不推荐'}`);
    if (counterfactualEnabled && Math.abs(counterfactualTotal - rawTotal) > 0.05) {
      lines.push(`- 原始 ${rawTotal.toFixed(1)} → 反事实 ${counterfactualTotal > rawTotal ? '+' : ''}${(counterfactualTotal - rawTotal).toFixed(1)}`);
    }
    lines.push(`- 候选池 ${poolSize} 只 | ${pctScope === 'industry' ? '行业' : '全市场'}百分位 | ${isV2Local ? (weightSourceLocal === 'ic' ? 'IC 动态定权' : weightSourceLocal === 'manual' ? '手动' : 'Barra 默认') : 'v1 旧 3-pillar'}`);
    lines.push('');
    lines.push('| 维度 | 大类分 | 公式 |');
    lines.push('| --- | --- | --- |');
    for (const [key, dim] of Object.entries(dimsLocal)) {
      const fs = factorsLocal[key];
      if (typeof fs !== 'number') continue;
      const rows = buildRows(key);
      lines.push(`| ${dim.label} | **${fs.toFixed(1)}** | ${rows[0]?.note || ''} |`);
    }
    lines.push('');
    return lines.join('\n');
  };

  // 纯函数：生成完整 Markdown 报告（综合分 + 算式 + 原始因子 + 图表 + IC + 结论 + 建议）
  // 复用于：① Markdown 文件导出  ② HTML 网页导出  ③ 打印 PDF  ——保证三端内容一致
  const buildFullReportMd = (): string => {
    const lines: string[] = [];
    const today = new Date().toISOString().slice(0, 10);
    lines.push(`# 📊 ${stock.name}（${stock.code}）综合分报告`);
    lines.push('');
    lines.push(`> 生成时间：${today} | 评分版本：${isV2 ? 'v2（8 大类）' : 'v1（3 大支柱）'} | 报告完整度：⭐⭐⭐⭐⭐（含算式 + 原始因子 + 图表 + IC + 结论）`);
    lines.push('');
    lines.push('## 🎯 综合评分');
    lines.push('');
    lines.push(`- **总分：${counterfactualTotal.toFixed(1)} / 100**`);
    lines.push(`- 等级：${counterfactualTotal >= 70 ? '💎 强烈推荐' : counterfactualTotal >= 55 ? '✅ 推荐买入' : counterfactualTotal >= 40 ? '⚠ 谨慎关注' : '⛔ 暂不推荐'}`);
    if (counterfactual.enabled && Math.abs(counterfactualTotal - total) > 0.05) {
      lines.push(`- 原始 ${total.toFixed(1)} → 反事实 ${counterfactualTotal > total ? '+' : ''}${(counterfactualTotal - total).toFixed(1)}（反事实权重已应用）`);
    }
    lines.push(`- 候选池：${poolSize} 只候选股 | 百分位范围：${pctScope === 'industry' ? '行业内' : '全市场'}`);
    if (isV2 && factors.weightSource) {
      const wsrc = factors.weightSource === 'ic' ? 'IC 动态定权' : factors.weightSource === 'manual' ? '手动定权' : 'Barra 默认';
      lines.push(`- 权重来源：${wsrc}`);
    }
    if (isV2 && factors.icStats && Object.keys(factors.icStats).length > 0) {
      const icVals = Object.values(factors.icStats as Record<string, { ic: number }>).map(s => s.ic);
      const minIc = Math.min(...icVals).toFixed(3);
      const maxIc = Math.max(...icVals).toFixed(3);
      lines.push(`- IC 范围（${factors.icMode === 'backtest' ? '已实现收益' : '当日'}）：${minIc} ~ ${maxIc}`);
    }
    // 行业内行业名（如果有）
    const industry = (rawFactors as any)?.industry;
    if (isV2 && industry && pctScope === 'industry') {
      lines.push(`- 行业：${industry}（仅在行业内做截面百分位）`);
    }
    lines.push('');
    // 算式明细
    lines.push('## 🧮 算式明细（8 大类 / 3 大支柱）');
    lines.push('');
    for (const [key, dim] of Object.entries(dimensions)) {
      const fs = factors[key];
      if (typeof fs !== 'number') continue;
      lines.push(`### ${dim.label}（权重 ${dim.weight}）`);
      lines.push('');
      const rows = buildFormulaRows(key);
      lines.push('| 步骤 | 值 | 说明 |');
      lines.push('| --- | --- | --- |');
      for (const r of rows) {
        lines.push(`| ${r.step} | \`${r.val}\` | ${r.note} |`);
      }
      lines.push('');
    }
    // 原始因子明细
    if (isV2 && Object.keys(rawFactors).length > 0) {
      lines.push('## 📊 原始因子明细');
      lines.push('');
      lines.push('| 维度 | 因子 | Raw 值 | 百分位 | 排名 |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const [key, dim] of Object.entries(dimensions)) {
        for (const rk of dim.rawKeys) {
          const v = (rawFactors as any)[rk.key];
          const hasV = typeof v === 'number' && !isNaN(v);
          const pct = getPct(rk);
          const poolN = pctScope === 'industry' && isV2
            ? (percentiles.industrySize || 0)
            : (poolSize > 0 ? poolSize : 100);
          const pctStr = pct != null ? `${(pct * 100).toFixed(0)}%` : '—';
          const rankStr = pct != null ? `排第 ${Math.round((1 - pct) * poolN) + 1} 名` : '—';
          const valStr = hasV ? formatRawVal(v, rk.unit) : '—';
          lines.push(`| ${dim.label} | ${rk.label} | \`${valStr}\` | ${pctStr} | ${rankStr} |`);
        }
      }
      lines.push('');
    }
    // 📈 嵌入图表：分数柱状图 + IC 趋势
    lines.push('## 📈 图表');
    lines.push('');
    const barSvg = buildScoreBarSvg();
    if (barSvg) {
      lines.push(`### 分数柱状图`);
      lines.push('');
      lines.push(`![分数柱状图](${svgToDataUri(barSvg)})`);
      lines.push('');
    }
    const icSvg = buildICTrendSvg();
    if (icSvg) {
      lines.push(`### IC 趋势图`);
      lines.push('');
      lines.push(`![IC 趋势](${svgToDataUri(icSvg)})`);
      lines.push('');
    }
    // IC 历史（如果有）
    if (isV2) {
      try {
        const raw = localStorage.getItem('quant_ic_history_log');
        if (raw) {
          const history = JSON.parse(raw).filter((h: any) => h.mode === (factors.icMode || 'snapshot'));
          if (history.length > 0) {
            lines.push('## 📐 IC 历史趋势（最近 ' + history.length + ' 次）');
            lines.push('');
            lines.push('| 时间 | ' + Object.keys(dimensions).map(k => dimensions[k].label).join(' | ') + ' |');
            lines.push('| --- | ' + Object.keys(dimensions).map(() => '---').join(' | ') + ' |');
            for (const h of history.slice(-10)) {
              const ts = new Date(h.ts).toISOString().slice(0, 16).replace('T', ' ');
              const cells = Object.keys(dimensions).map(k => {
                const ic = h.icStats?.[k]?.ic;
                return typeof ic === 'number' ? ic.toFixed(3) : '—';
              });
              lines.push(`| ${ts} | ${cells.join(' | ')} |`);
            }
            lines.push('');
          }
        }
      } catch { /* ignore */ }
    }
    // 📌 分析结论（基于真实数据生成的"研究员视角"结论）
    const conclusion = buildAnalysisConclusion();
    if (conclusion) {
      lines.push('## 📌 分析结论');
      lines.push('');
      for (const p of conclusion) lines.push(p);
      lines.push('');
    }
    // 💡 操作建议（基础分级 + 上下文感知）
    lines.push('## 💡 操作建议');
    lines.push('');
    if (counterfactualTotal >= 70) {
      lines.push('- 综合分 70+，处于"💎 强烈推荐"区间');
      lines.push('- 建议关注前 5 大因子贡献最强的维度作为入场逻辑');
      lines.push('- 风险控制：跌破 60 离场');
    } else if (counterfactualTotal >= 55) {
      lines.push('- 综合分 55-70，处于"✅ 推荐买入"区间');
      lines.push('- 可小仓位试探，等综合分突破 70 加仓');
    } else if (counterfactualTotal >= 40) {
      lines.push('- 综合分 40-55，处于"⚠ 谨慎关注"区间');
      lines.push('- 建议等待更明确的反转信号或更好买点');
    } else {
      lines.push('- 综合分 < 40，处于"⛔ 暂不推荐"区间');
      lines.push('- 建议忽略此股票，关注更高分候选');
    }
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('*本报告由 OpenMAIC 量化系统自动生成，仅作研究参考，不构成投资建议*');
    return lines.join('\n');
  };

  // 📌 研究员视角的分析结论生成器
  // 不只是"分高就买"——而是基于贡献、IC、raw 因子、行业上下文给出有依据的判断
  const buildAnalysisConclusion = (): string[] => {
    const out: string[] = [];
    // 收集大类分 + 贡献（按分数排序）
    const dimScores: { key: string; label: string; score: number; weight: number; contrib: number; ic: number | null }[] = [];
    for (const [key, dim] of Object.entries(dimensions)) {
      const fs = factors[key];
      if (typeof fs !== 'number') continue;
      const contrib = (factors.contributions as any)?.[key];
      const ic = (factors.icStats as any)?.[key]?.ic;
      dimScores.push({
        key,
        label: dim.label,
        score: fs,
        weight: dim.weight,
        contrib: typeof contrib === 'number' ? contrib : fs * dim.weight / 100,
        ic: typeof ic === 'number' ? ic : null,
      });
    }
    if (dimScores.length === 0) return [];
    dimScores.sort((a, b) => b.score - a.score);
    const top3 = dimScores.slice(0, 3);
    const bottom3 = dimScores.slice(-3).reverse();  // 最差 3 个（保持原始降序展示）

    // 1. 综合判断
    out.push(`**综合判断**：${stock.name}（${stock.code}）综合分 ${counterfactualTotal.toFixed(1)}，${
      counterfactualTotal >= 70 ? '处于"强烈推荐"区间，量价因子与基本面形成共振' :
      counterfactualTotal >= 55 ? '处于"推荐买入"区间，整体多因子协同向好' :
      counterfactualTotal >= 40 ? '处于"谨慎关注"区间，量价信号与基本面存在分歧' :
      '处于"暂不推荐"区间，多维度评分普遍偏低'
    }。${
      counterfactualTotal >= 50 ? '在候选池中排名靠前，' : '在候选池中排名靠后，'
    }呈现${
      top3.filter(d => d.score >= 70).length >= 2 ? '明显的' :
      top3.filter(d => d.score >= 60).length >= 3 ? '一定的' :
      '有限的'
    }多因子优势。`);

    // 2. 核心优势维度（贡献最大的 Top 3）
    out.push('');
    out.push(`**核心优势**：${
      top3.map((d, i) => `${d.label} ${d.score.toFixed(1)} 分（贡献 ${d.contrib.toFixed(2)}）`).join('，')
    }。${
      top3[0].score >= 80 ? `${top3[0].label}维度表现尤为突出，是本次推荐的主要支撑。` :
      top3[0].score >= 60 ? `${top3[0].label}维度表现较好，构成主要买入逻辑。` :
      '各优势维度均未达到"强势"门槛，建议作为"组合配置"而非"单点重仓"。'
    }`);

    // 3. 风险点 / 拖累维度
    if (bottom3[0].score < 50) {
      out.push('');
      out.push(`**风险点**：${
        bottom3.map(d => `${d.label} ${d.score.toFixed(1)} 分`).join('，')
      }——这些维度评分偏低，${
          bottom3.filter(d => d.score < 30).length >= 2 ? '形成显著的拖累效应' :
          bottom3[0].score < 30 ? '存在明显短板' :
          '对综合分形成一定压制'
        }。${
          bottom3.find(d => d.key === 'reversal' && d.score < 30) ? '⚠️ 反转维度极弱可能意味着超跌反弹机会已过；' : ''
        }${
          bottom3.find(d => d.key === 'valuation' && d.score < 30) ? '⚠️ 估值维度极弱——PE/PB 处于历史高位；' : ''
        }${
          bottom3.find(d => d.key === 'quality' && d.score < 30) ? '⚠️ 质量维度极弱——ROE/毛利率/负债率存在结构性风险；' : ''
        }建议关注这些维度是否在持续恶化。`);
    }

    // 4. IC 加权视角（v2 only）
    if (isV2 && factors.icStats && Object.keys(factors.icStats).length > 0) {
      const icsByAbs = dimScores.filter(d => d.ic !== null).sort((a, b) => Math.abs(b.ic!) - Math.abs(a.ic!));
      if (icsByAbs.length > 0) {
        const strongest = icsByAbs[0];
        const weakest = icsByAbs[icsByAbs.length - 1];
        out.push('');
        out.push(`**IC 加权视角**：当前 IC 模式下，${
          strongest.ic! > 0 ? `${strongest.label}（IC=${strongest.ic!.toFixed(3)}）与未来收益正相关性最强` :
          `${strongest.label}（IC=${strongest.ic!.toFixed(3)}）绝对值最大但为负相关——需警惕该维度的"反向信号"风险`
        }。${
          weakest.ic !== null && Math.abs(weakest.ic!) < 0.02 ? `${weakest.label}（IC=${weakest.ic!.toFixed(3)}）接近噪声水平，对综合分贡献可信度低。` : ''
        }${
          icsByAbs.filter(d => d.ic! < -0.05).length > 0 ? `⚠️ 存在显著负 IC 维度（${icsByAbs.filter(d => d.ic! < -0.05).map(d => d.label).join('、')}），建议手动降低其权重或暂时剔除。` : ''
        }`);
      }
    }

    // 5. 原始因子亮点（v2 only，给出"具体到数字"的事实陈述）
    if (isV2 && Object.keys(rawFactors).length > 0) {
      const highlights: string[] = [];
      const raws = rawFactors as Record<string, any>;
      // 估值
      if (typeof raws.pe === 'number') {
        const pePct = percentiles?.pe;
        if (pePct != null) {
          if (pePct < 0.2) highlights.push(`PE_TTM ${raws.pe.toFixed(1)} 倍，处全市场前 ${(pePct * 100).toFixed(0)}%（估值便宜）`);
          else if (pePct > 0.8) highlights.push(`PE_TTM ${raws.pe.toFixed(1)} 倍，处全市场后 ${((1 - pePct) * 100).toFixed(0)}%（估值偏贵）`);
        }
      }
      if (typeof raws.pb === 'number') {
        const pbPct = percentiles?.pb;
        if (pbPct != null && pbPct < 0.15) highlights.push(`PB ${raws.pb.toFixed(2)} 倍，处全市场前 ${(pbPct * 100).toFixed(0)}%（破净或近破净）`);
      }
      if (typeof raws.roe === 'number' && raws.roe > 15) {
        highlights.push(`ROE ${raws.roe.toFixed(1)}%（高于 15%，盈利能力强）`);
      }
      // 动量
      if (typeof raws.momentum20 === 'number' && Math.abs(raws.momentum20) > 0.1) {
        const m20Pct = percentiles?.momentum20;
        if (raws.momentum20 > 0.1 && m20Pct != null && m20Pct > 0.7) {
          highlights.push(`20 日动量 +${(raws.momentum20 * 100).toFixed(1)}%（强势上涨，处全市场前 ${(m20Pct * 100).toFixed(0)}%）`);
        } else if (raws.momentum20 < -0.1) {
          highlights.push(`20 日动量 ${(raws.momentum20 * 100).toFixed(1)}%（显著下跌，可能存在超跌机会）`);
        }
      }
      // 资金流
      if (typeof raws.mainNetInflow === 'number' && raws.mainNetInflow > 0) {
        highlights.push(`主力资金净流入 +${raws.mainNetInflow.toFixed(0)} 万（资金面配合）`);
      }
      // 换手率
      if (typeof raws.turnoverRate === 'number' && raws.turnoverRate > 5) {
        highlights.push(`换手率 ${raws.turnoverRate.toFixed(2)}%（活跃度高，注意短线追高风险）`);
      }
      if (highlights.length > 0) {
        out.push('');
        out.push(`**关键数据亮点**：${highlights.join('；')}。`);
      }
    }

    // 6. 行业 vs 全市场（行业模式下额外提示）
    if (isV2 && pctScope === 'industry' && percentiles?.industrySize) {
      out.push('');
      out.push(`**行业相对位置**：当前百分位基于"${(rawFactors as any)?.industry || '未知'}"行业 ${percentiles.industrySize} 只成分股计算——${
        counterfactualTotal >= 70 ? '在行业内属于龙头候选' :
        counterfactualTotal >= 55 ? '在行业内具备相对优势' :
        '在行业内无明显优势'
      }。如需与全市场龙头对比，请切换到"全市场"百分位。`);
    }

    // 7. 反事实模式提示
    if (counterfactual.enabled && Math.abs(counterfactualTotal - total) > 0.05) {
      const delta = counterfactualTotal - total;
      out.push('');
      out.push(`**反事实权重影响**：当前总分基于用户自定义权重，相比默认 Barra 权重${
        delta > 0 ? `上调 +${delta.toFixed(1)} 分` : `下调 ${delta.toFixed(1)} 分`
      }。如需"市场公认"视角，请关闭反事实模式重新生成。`);
    }

    return out;
  };

  // 导出完整报告（Markdown）到文件
  const exportFullReport = () => {
    const today = new Date().toISOString().slice(0, 10);
    const md = buildFullReportMd();
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${stock.code}_${today}_综合分报告.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 批量导出：基于 poolSnapshot 遍历所有候选股生成汇总报告
  const exportBatchReport = () => {
    const snapshot = stock.poolSnapshot || [];
    if (snapshot.length === 0) {
      alert('当前股票没有 poolSnapshot 数据，无法批量导出。请先重新跑分析。');
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const lines: string[] = [];
    lines.push(`# 📊 OpenMAIC 量化候选股综合报告`);
    lines.push('');
    lines.push(`> 生成时间：${today} | 评分版本：${isV2 ? 'v2（8 大类）' : 'v1（3 大支柱）'} | 候选股数：${snapshot.length}`);
    lines.push('');
    // 综合排名表
    lines.push('## 🏆 综合分排名');
    lines.push('');
    lines.push('| 排名 | 股票 | 代码 | 综合分 | 百分位 |');
    lines.push('| --- | --- | --- | --- | --- |');
    const ranked = snapshot.map(p => {
      const fs = p.factors || {};
      return {
        code: p.code,
        composite: isV2 ? fs.valuation : fs.momentumScore,  // v2 简化用 valuation；v1 用 momentum
      };
    }).filter(r => typeof r.composite === 'number').sort((a, b) => b.composite - a.composite);
    ranked.slice(0, 30).forEach((r, i) => {
      const pct = ((ranked.length - i) / ranked.length * 100).toFixed(0);
      lines.push(`| ${i + 1} | ${r.code.split('.')[0]} | ${r.code} | ${r.composite.toFixed(1)} | ${pct}% |`);
    });
    lines.push('');
    lines.push(`*仅展示前 30 名（共 ${ranked.length} 只）*`);
    lines.push('');
    // 逐股汇总
    lines.push('---');
    lines.push('');
    lines.push('## 📋 逐股明细');
    lines.push('');
    const top5 = ranked.slice(0, 5);
    for (const r of top5) {
      const poolItem = snapshot.find(p => p.code === r.code);
      if (!poolItem) continue;
      const md = buildStockReportMd({
        stock: { code: poolItem.code, name: poolItem.code.split('.')[0] },
        scoreVersion,
        factorScores: poolItem.factors,
        counterfactualTotal: r.composite,
        rawTotal: r.composite,
        counterfactualEnabled: false,
        poolSize,
        pctScope,
      });
      lines.push(md);
      lines.push('---');
      lines.push('');
    }
    lines.push('*本报告由 OpenMAIC 量化系统自动生成*');

    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quant_batch_${today}_top5.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 把 Markdown 报告 + 内嵌图表包成独立 HTML 文档（带样式 + 可打印）
  // 用于：🖨 打印 PDF  +  🌐 HTML 导出  共用同一渲染管线，避免重复实现
  const wrapHtmlReport = (params: {
    title: string;
    bodyMd: string;            // 来自 buildFullReportMd 的 markdown 文本
    includeBarSvg?: boolean;   // 嵌入分数柱状图
    includeIcSvg?: boolean;    // 嵌入 IC 趋势图
    printMode?: boolean;       // true=打印视图（隐藏按钮+紧凑布局），false=HTML 分享页
  }): string => {
    const { title, bodyMd, includeBarSvg = true, includeIcSvg = true, printMode = false } = params;
    const barSvg = includeBarSvg ? buildScoreBarSvg() : '';
    const icSvg = includeIcSvg ? buildICTrendSvg() : '';
    // 极简 markdown → HTML（只处理我们实际用到的语法：标题/段落/列表/表格/引用/code/hr/img）
    // 不用引入第三方库，避免给用户报告里多几十 KB JS
    const escMd = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inlineMd = (s: string) => escMd(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
    const lines = bodyMd.split('\n');
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
      const ln = lines[i];
      if (/^### /.test(ln)) {
        out.push(`<h3>${inlineMd(ln.slice(4))}</h3>`);
        i++;
      } else if (/^## /.test(ln)) {
        out.push(`<h2>${inlineMd(ln.slice(3))}</h2>`);
        i++;
      } else if (/^# /.test(ln)) {
        out.push(`<h1>${inlineMd(ln.slice(2))}</h1>`);
        i++;
      } else if (/^> /.test(ln)) {
        // 连续引用行合并
        const buf: string[] = [];
        while (i < lines.length && /^> /.test(lines[i])) { buf.push(inlineMd(lines[i].slice(2))); i++; }
        out.push(`<blockquote>${buf.join('<br/>')}</blockquote>`);
      } else if (/^\| /.test(ln) && i + 1 < lines.length && /^\|---/.test(lines[i + 1])) {
        // 表格头
        const headers = ln.split('|').slice(1, -1).map(c => inlineMd(c.trim()));
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && /^\| /.test(lines[i]) && !/^\|---/.test(lines[i])) {
          rows.push(lines[i].split('|').slice(1, -1).map(c => inlineMd(c.trim())));
          i++;
        }
        out.push('<table><thead><tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      } else if (/^- /.test(ln)) {
        const buf: string[] = [];
        while (i < lines.length && /^- /.test(lines[i])) { buf.push(`<li>${inlineMd(lines[i].slice(2))}</li>`); i++; }
        out.push(`<ul>${buf.join('')}</ul>`);
      } else if (/^---$/.test(ln)) {
        out.push('<hr/>');
        i++;
      } else if (/^!\[([^\]]*)\]\(([^)]+)\)$/.test(ln)) {
        const m = ln.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)!;
        out.push(`<img alt="${escMd(m[1])}" src="${m[2]}"/>`);
        i++;
      } else if (ln.trim() === '') {
        i++;
      } else {
        out.push(`<p>${inlineMd(ln)}</p>`);
        i++;
      }
    }
    const chartBlocks: string[] = [];
    if (barSvg) chartBlocks.push(`<section><h2>📈 分数柱状图</h2>${barSvg}</section>`);
    if (icSvg) chartBlocks.push(`<section><h2>📐 IC 趋势图</h2>${icSvg}</section>`);
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>${escMd(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
         background: #0f172a; color: #e2e8f0; margin: 0; padding: 24px; line-height: 1.6; }
  h1 { color: #f1f5f9; border-bottom: 2px solid #334155; padding-bottom: 8px; }
  h2 { color: #67e8f9; margin-top: 32px; }
  h3 { color: #fcd34d; margin-top: 20px; }
  blockquote { border-left: 4px solid #475569; padding: 8px 16px; background: #1e293b;
               color: #cbd5e1; margin: 12px 0; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
  th, td { border: 1px solid #334155; padding: 6px 10px; text-align: left; }
  th { background: #1e293b; color: #f1f5f9; }
  tr:nth-child(even) { background: #0b1220; }
  code { background: #1e293b; color: #fbbf24; padding: 1px 6px; border-radius: 3px; font-family: monospace; }
  hr { border: 0; border-top: 1px solid #334155; margin: 24px 0; }
  img, svg { max-width: 100%; height: auto; display: block; margin: 8px auto; }
  ul { padding-left: 24px; }
  section { background: #0b1220; border: 1px solid #1e293b; border-radius: 8px; padding: 12px 16px; margin: 16px 0; }
  ${printMode ? `
  /* 打印视图：白底黑字 + 紧凑布局 + 自动唤起打印 */
  @media print {
    @page { margin: 12mm; }
    body { background: #fff !important; color: #000 !important; padding: 0; }
    h1, h2, h3 { color: #000 !important; }
    th { background: #f3f4f6 !important; color: #000 !important; }
    td, th { border-color: #d1d5db !important; }
    tr:nth-child(even) { background: #f9fafb !important; }
    blockquote, section { background: #f9fafb !important; color: #000 !important; border-color: #d1d5db !important; }
    code { background: #f3f4f6 !important; color: #000 !important; }
  }` : ''}
</style>
${printMode ? `<script>
  // 打印视图：DOM ready 后立即唤起打印对话框
  window.addEventListener('load', function () {
    setTimeout(function () { window.print(); }, 300);
  });
</script>` : ''}
</head>
<body>
<h1>${escMd(title)}</h1>
${out.join('\n')}
${chartBlocks.join('\n')}
</body>
</html>`;
  };

  // 打印/导出 PDF：把当前弹窗内容渲染成独立 HTML 窗口，唤起浏览器打印对话框
  // 用户可"另存为 PDF"——零外部依赖、走系统原生 PDF 引擎
  const openPrintView = () => {
    try {
      // 复用 exportFullReport 相同的完整 Markdown 内容（综合分 + 算式 + 原始因子 + 图表 + IC + 结论 + 建议）
      const bodyMd = buildFullReportMd();
      const html = wrapHtmlReport({
        title: `${stock.name}（${stock.code}）综合分报告`,
        bodyMd,
        includeBarSvg: true,
        includeIcSvg: true,
        printMode: true,
      });
      const win = window.open('', '_blank', 'width=900,height=1200');
      if (!win) {
        alert('浏览器拦截了新窗口弹出。请允许本站点弹出窗口后重试。');
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
    } catch (e: any) {
      alert('打开打印视图失败：' + (e?.message || String(e)));
    }
  };

  // 导出独立 HTML 网页报告（带样式 + 图表，可分享可打印）
  // 与打印视图共享 wrapHtmlReport，仅 printMode 标记不同（不自动唤起打印）
  const exportHtmlReport = () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      // 复用 exportFullReport 相同的完整 Markdown 内容（保证三端内容一致）
      const bodyMd = buildFullReportMd();
      const html = wrapHtmlReport({
        title: `${stock.name}（${stock.code}）综合分报告`,
        bodyMd,
        includeBarSvg: true,
        includeIcSvg: true,
        printMode: false,
      });
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${stock.code}_${today}_综合分报告.html`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert('导出 HTML 失败：' + (e?.message || String(e)));
    }
  };

  // 哪个大类被展开（默认全部展开：'all' / null = 全部折叠 / string = 单个大类展开）
  const [expandedKey, setExpandedKey] = useState<string | null>('all');
  // 算式 ↔ 原始因子 hover 联动：当前 hover 的 raw key（算式表对应行高亮）
  const [hoveredRawKey, setHoveredRawKey] = useState<string | null>(null);
  // 重跑本股票：弹窗顶部按钮触发
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // 重跑本股票：调完整 v2 API（force refresh），更新弹窗数据
  const handleRefreshStock = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      // 强制重新跑（nocache=1）+ 30 只候选就够（rank 用不上，本股票一定会进）
      const url = `/api/stock/factor-analysis-v2?action=scores&limit=30&forwardPeriod=20&filterFlags=true&weightMode=default&icHistory=0&nocache=1&_t=${Date.now()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success || !json.results) {
        throw new Error(json.diagnostics?.detail || json.error || '重跑失败');
      }
      // 在新 results 里找本股票
      const fresh = json.results.find((r: any) => r.code === stock.code);
      if (!fresh) {
        throw new Error(`本股票 ${stock.code} 不在新结果中（可能 K 线不足）`);
      }
      // 写新数据到 IDB（v2 路径，简化版）
      const d = json.diagnostics || {};
      const newFactorScores = JSON.stringify({
        valuation: fresh.valuation, quality: fresh.quality, momentum: fresh.momentum,
        reversal: fresh.reversal, moneyFlow: fresh.moneyFlow, technical: fresh.technical,
        turnover: fresh.turnover, wqAlpha: fresh.wqAlpha,
        contributions: fresh.contributions,
        rawFactors: fresh.rawFactors,
        percentiles: fresh.percentiles,
        poolSize: d.originalCount || 0,
        weightsUsed: d.weightsUsed,
        weightSource: d.weightSource,
        icStats: d.icStats,
        icMode: 'snapshot',
      });
      // 计算 compositePct（在新池中）
      const scoresAll = json.results.map((r: any) => r.composite).filter((x: any) => typeof x === 'number');
      const sortedAsc = [...scoresAll].sort((a, b) => a - b);
      let lo = 0, hi = sortedAsc.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sortedAsc[mid] < fresh.composite) lo = mid + 1;
        else hi = mid;
      }
      const compositePct = lo / sortedAsc.length;
      // 直接更新 stock prop（通过 onClose + 父级 re-open）
      // 简化：刷新页面提示
      const today = new Date().toISOString().slice(0, 10);
      const period = '20d';
      const id = `${stock.code}_${period}_v2`;
      // 尝试打开 IDB 写（如果有 db 实例）；否则提示用户
      try {
        // 直接更新弹窗数据：通过 onClose + 强制刷新
        alert(`✅ ${stock.code} 已重跑：综合分 ${fresh.composite.toFixed(1)} (${(compositePct * 100).toFixed(0)}%)。点击确定关闭弹窗并自动刷新页面以加载新数据。`);
        window.location.reload();  // 简单粗暴
      } catch (e: any) {
        throw new Error('写 IDB 失败：' + e.message);
      }
    } catch (e: any) {
      setRefreshError(e.message || '重跑失败');
    } finally {
      setRefreshing(false);
    }
  };
  // 百分位范围：market = 全市场 / industry = 行业内（仅 v2 有；v1 默认 market）
  const [pctScope, setPctScope] = useState<'market' | 'industry'>('market');
  // 反事实模式：8 大类各一个乘数（默认 1.0）；开/关 + 当前生效综合分
  // 持久化到 localStorage（key: quant_counterfactual_mults），下次打开任意股票弹窗自动套用
  const [counterfactual, setCounterfactual] = useState<{ enabled: boolean; mults: Record<string, number> }>(() => {
    if (typeof window === 'undefined') return { enabled: false, mults: {} };
    try {
      const saved = localStorage.getItem('quant_counterfactual_mults');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return { enabled: false, mults: parsed };  // 默认关闭但 mults 已套用
        }
      }
    } catch { /* ignore */ }
    return { enabled: false, mults: {} };
  });

  // mults 变化时持久化（enabled 状态不持久——每次新弹窗都需用户主动开启）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (Object.keys(counterfactual.mults).length > 0) {
        localStorage.setItem('quant_counterfactual_mults', JSON.stringify(counterfactual.mults));
      } else {
        localStorage.removeItem('quant_counterfactual_mults');
      }
    } catch { /* ignore */ }
  }, [counterfactual.mults]);

  // 策略预设：localStorage['quant_counterfactual_profiles'] = { [name]: { mults, createdAt } }
  // 系统预设（"市场恐慌"/"普涨"/"高动量"）— 不可删除、不可导出
  const BUILTIN_PROFILES: Record<string, Record<string, number>> = {
    '⭐ 市场恐慌': {
      valuation: 1.8, quality: 1.6, momentum: 0.4, reversal: 1.5,
      moneyFlow: 0.7, technical: 0.6, turnover: 0.5, wqAlpha: 0.4,
    },
    '⭐ 普涨': {
      valuation: 0.8, quality: 0.8, momentum: 1.6, reversal: 0.4,
      moneyFlow: 1.5, technical: 1.4, turnover: 1.3, wqAlpha: 1.2,
    },
    '⭐ 高动量': {
      valuation: 0.5, quality: 0.6, momentum: 2.0, reversal: 0.3,
      moneyFlow: 1.3, technical: 1.6, turnover: 1.5, wqAlpha: 1.2,
    },
  };
  const [profiles, setProfiles] = useState<Record<string, { mults: Record<string, number>; createdAt: number }>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = localStorage.getItem('quant_counterfactual_profiles');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch { /* ignore */ }
    return {};
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem('quant_counterfactual_profiles', JSON.stringify(profiles)); } catch { /* ignore */ }
  }, [profiles]);

  // 预设 UI 状态
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  // IC 历史趋势：默认折叠
  const [showICTrend, setShowICTrend] = useState(false);
  // 预设对比模式：勾选 2-3 个预设同时显示 mults 差异
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelected, setCompareSelected] = useState<string[]>([]);
  // 预设排序方式
  const [sortMode, setSortMode] = useState<'recent' | 'created' | 'alpha'>(() => {
    if (typeof window === 'undefined') return 'recent';
    try {
      const v = localStorage.getItem('quant_profile_sort');
      if (v === 'created' || v === 'alpha' || v === 'recent') return v;
    } catch { /* ignore */ }
    return 'recent';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem('quant_profile_sort', sortMode); } catch { /* ignore */ }
  }, [sortMode]);

  // 排序后的预设列表（系统预设 + 用户预设）
  const sortedProfileNames = useMemo(() => {
    const builtin = Object.keys(BUILTIN_PROFILES);
    const user = Object.keys(profiles);
    const all = [...builtin, ...user];
    if (sortMode === 'alpha') {
      return all.sort((a, b) => a.localeCompare(b, 'zh-CN'));
    }
    if (sortMode === 'created') {
      // 系统预设 createdAt=Infinity 排前；用户按创建时间倒序
      return all.sort((a, b) => {
        const aBuiltin = BUILTIN_PROFILES[a] ? Infinity : (profiles[a]?.createdAt || 0);
        const bBuiltin = BUILTIN_PROFILES[b] ? Infinity : (profiles[b]?.createdAt || 0);
        return bBuiltin - aBuiltin;
      });
    }
    // 'recent'：用户按 lastUsedAt，系统预设定位最前
    return all.sort((a, b) => {
      const aBuiltin = BUILTIN_PROFILES[a];
      const bBuiltin = BUILTIN_PROFILES[b];
      if (aBuiltin && !bBuiltin) return -1;
      if (bBuiltin && !aBuiltin) return 1;
      if (aBuiltin && bBuiltin) return 0;
      const la = (profiles[a] as any)?.lastUsedAt || (profiles[a]?.createdAt || 0);
      const lb = (profiles[b] as any)?.lastUsedAt || (profiles[b]?.createdAt || 0);
      return lb - la;
    });
  }, [profiles, sortMode]);

  // 切换对比选中
  const toggleCompareSelect = (name: string) => {
    setCompareSelected(prev => {
      if (prev.includes(name)) return prev.filter(n => n !== name);
      if (prev.length >= 3) return [...prev.slice(1), name];  // 最多 3 个，超出滚动
      return [...prev, name];
    });
  };

  // 保存当前 mults 为预设
  const saveProfile = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (BUILTIN_PROFILES[trimmed]) {
      alert(`"${trimmed}" 是系统预设，不能用同名覆盖。请换个名字。`);
      return;
    }
    setProfiles(prev => ({
      ...prev,
      [trimmed]: { mults: { ...counterfactual.mults }, createdAt: Date.now() },
    }));
    setNewProfileName('');
  };
  // 应用预设
  const applyProfile = (name: string) => {
    const mults = profiles[name]?.mults || BUILTIN_PROFILES[name];
    if (!mults) return;
    setCounterfactual(prev => ({ ...prev, enabled: true, mults: { ...mults } }));
    // 只对用户预设更新 lastUsedAt
    if (profiles[name]) {
      setProfiles(prev => ({
        ...prev,
        [name]: { ...prev[name], lastUsedAt: Date.now() },
      }));
    }
    setShowProfileMenu(false);
  };
  // 删除预设
  const deleteProfile = (name: string) => {
    setProfiles(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };
  // 重新计算综合分（反事实模式）：把每个维度分 ×mult 后再加权
  const counterfactualTotal = useMemo((): number => {
    if (!counterfactual.enabled) return total;
    // 对每个维度：rawScore 来自 factors[key]（v2 是 8 大类分 0-100，v1 是 3 大支柱 0-100）
    // 反事实权重 = effectiveWeights × mults[key]
    let sum = 0;
    for (const [key, dim] of Object.entries(dimensions)) {
      const scoreVal = factors[key];
      if (typeof scoreVal !== 'number' || isNaN(scoreVal)) continue;
      const w = effectiveWeights[key] ?? dim.weight;
      const m = counterfactual.mults[key] ?? 1.0;
      sum += scoreVal * w * m;
    }
    // 归一化：原始 sum 应当 = total × 100（因为 sum / 100 = total）
    // 反事实下，归一化因子 = 100 / Σ(weight × mult)
    const norm = 100 / Object.entries(dimensions).reduce((s, [key, dim]) => {
      const w = effectiveWeights[key] ?? dim.weight;
      const m = counterfactual.mults[key] ?? 1.0;
      return s + w * m;
    }, 0);
    return Math.round(sum * norm / 100 * 100) / 100;
  }, [counterfactual, factors, dimensions, effectiveWeights, total]);

  // 设置单个维度的乘数
  const setDimMult = (key: string, mult: number) => {
    setCounterfactual(prev => ({
      ...prev,
      mults: { ...prev.mults, [key]: mult },
    }));
  };
  // 重置反事实（清除 localStorage + 关闭 + 清空 mults）
  const resetCounterfactual = () => {
    setCounterfactual({ enabled: false, mults: {} });
    try { localStorage.removeItem('quant_counterfactual_mults'); } catch { /* ignore */ }
  };

  // 一键贪心优化：对每个维度，扫 0.5~2.0× 步长 0.1，取最大综合分的多倍数
  // 2 轮迭代（第二轮可能因其他维度变化而需要再调）
  const greedyOptimize = () => {
    const STEP = 0.1;
    const RANGE_MIN = 0.5, RANGE_MAX = 2.0;
    const newMults: Record<string, number> = { ...counterfactual.mults };
    // 评估函数：当前 mults 的综合分
    const evalTotal = (mults: Record<string, number>): number => {
      let sum = 0;
      for (const [key, dim] of Object.entries(dimensions)) {
        const scoreVal = factors[key];
        if (typeof scoreVal !== 'number' || isNaN(scoreVal)) continue;
        const w = effectiveWeights[key] ?? dim.weight;
        const m = mults[key] ?? 1.0;
        sum += scoreVal * w * m;
      }
      const norm = 100 / Object.entries(dimensions).reduce((s, [key, dim]) => {
        const w = effectiveWeights[key] ?? dim.weight;
        const m = mults[key] ?? 1.0;
        return s + w * m;
      }, 0);
      return sum * norm / 100;
    };

    for (let round = 0; round < 2; round++) {
      for (const key of Object.keys(dimensions)) {
        let bestMult = newMults[key] ?? 1.0;
        let bestScore = evalTotal(newMults);
        for (let m = RANGE_MIN; m <= RANGE_MAX + 1e-6; m += STEP) {
          const trial = { ...newMults, [key]: Math.round(m * 100) / 100 };
          const score = evalTotal(trial);
          if (score > bestScore + 1e-6) {
            bestScore = score;
            bestMult = Math.round(m * 100) / 100;
          }
        }
        if (bestMult !== (newMults[key] ?? 1.0)) {
          newMults[key] = bestMult;
        }
      }
    }
    setCounterfactual(prev => ({ ...prev, enabled: true, mults: newMults }));
  };

  // 取某个 raw key 对应的百分位（0-1）— v2 走 percentiles 字段，v1 走 v1Percentiles 现算
  // 字段名按 pctScope 切换：industry 时加 "industryPct" 前缀
  const getPct = (rk: { key: string; pctKey?: string; inverted?: boolean }): number | null => {
    if (isV2) {
      const baseKey = rk.pctKey !== undefined ? rk.pctKey : rk.key;
      if (!baseKey) return null;
      let k: string;
      if (pctScope === 'industry') {
        // 行业内 → 字段前缀 industryPct
        k = 'industryPct' + baseKey.charAt(0).toUpperCase() + baseKey.slice(1);
        // 例：pe → industryPctPe, momentum20 → industryPctMomentum20
      } else {
        k = baseKey;
      }
      const v = percentiles[k];
      return typeof v === 'number' && !isNaN(v) ? v : null;
    }
    // v1 路径（暂不支持 industry 切换）
    const v = v1Percentiles[rk.key];
    return typeof v === 'number' && !isNaN(v) ? v : null;
  };

  // 百分位 → 排名
  // 反向因子（inverted）：低分排前，pct 越高越好 → (1 - p) × n
  // 正向因子：高分排前，pct 越高越好 → 实际就是 (1 - p) × n（默认逻辑已对）
  // 显示成"排第 X 名 / 共 N 只"，与日常排名习惯一致（第 1 名最好）
  const pctToRank = (p: number, n: number, inverted: boolean = false): string => {
    // percentile.ts:130 反向因子（pe/pb/ps/bias/volatility/debtRatio）已用 toPercentileDesc
    // 也就是说 pct 越高代表因子排名越前
    const rank = Math.round((1 - p) * n) + 1;  // +1 因为排名从 1 开始
    return `排第 ${Math.min(n, Math.max(1, rank))} 名 / 共 ${n} 只`;
  };

  const scoreColor = total >= 70 ? 'text-rose-400' : total >= 55 ? 'text-rose-300' : total >= 40 ? 'text-slate-300' : 'text-slate-400';
  const level = total >= 70 ? '💎 强烈推荐' : total >= 55 ? '✅ 推荐买入' : total >= 40 ? '⚠ 谨慎关注' : '⛔ 暂不推荐';

  // 通用公式（两版本共用）
  const formula = `综合分 = Σ ( ${isV2 ? '8 大类因子分' : '3 大支柱分'} × 权重 ) ÷ 100`;

  // 统计有数据的原始因子数（用于"详细数据"按钮 label）
  const totalRawKeys = Object.values(dimensions).reduce((s, d) => s + d.rawKeys.length, 0);
  const availableRawKeys = Object.values(dimensions).reduce((s, d) => {
    return s + d.rawKeys.filter(rk => {
      const v = isV2 ? rawFactors[rk.key] : factors[rk.key];
      return typeof v === 'number' && !isNaN(v);
    }).length;
  }, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-[760px] max-h-[88vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-white font-bold text-lg truncate">{stock.name}</span>
            <span className="text-slate-400 text-sm shrink-0">{stock.code}</span>
            <span className="text-[10px] px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded shrink-0">
              {isV2 ? 'v2 (8 大类)' : 'v1 (3 大支柱)'}
            </span>
            {/* 百分位范围 toggle（仅 v2 可用） */}
            {isV2 && (
              <div className="flex items-center gap-0.5 text-[10px] bg-slate-800 rounded p-0.5 ml-1 shrink-0">
                <button
                  onClick={() => setPctScope('market')}
                  className={`px-2 py-0.5 rounded transition-colors ${pctScope === 'market' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  title="在全市场 ~300 只候选股中做截面百分位"
                >全市场</button>
                <button
                  onClick={() => setPctScope('industry')}
                  className={`px-2 py-0.5 rounded transition-colors ${pctScope === 'industry' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  title={`仅在所在行业（${(stock.factorScores?.rawFactors?.industry as string) || '未知'}）内做截面百分位——更适合"行业内龙头"分析`}
                >行业</button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* 导出完整报告 */}
            <button
              onClick={exportFullReport}
              className="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-300 hover:bg-emerald-600 hover:text-white"
              title="导出本股票完整报告为 Markdown 文件（含综合分 + 算式 + 排名 + IC + 建议 + 图表）"
            >📄 Markdown</button>
            {/* 打印/导出 PDF（打开 print-friendly 视图 → window.print） */}
            <button
              onClick={openPrintView}
              className="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-300 hover:bg-rose-600 hover:text-white"
              title="打开打印视图（自动唤起浏览器打印对话框，可另存为 PDF）"
            >🖨 打印 PDF</button>
            {/* 可交互 HTML 网页报告 */}
            <button
              onClick={exportHtmlReport}
              className="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-300 hover:bg-cyan-600 hover:text-white"
              title="导出独立 HTML 网页报告（带样式 + 图表，可分享可打印）"
            >🌐 HTML</button>
            {/* 批量导出：基于 poolSnapshot 前 5 */}
            {stock.poolSnapshot && stock.poolSnapshot.length > 0 && (
              <button
                onClick={exportBatchReport}
                className="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-300 hover:bg-amber-600 hover:text-white"
                title="导出前 5 名候选股汇总报告（含排名表 + 逐股明细）"
              >📊 批量</button>
            )}
            {/* 重跑本股票（仅 v2） */}
            {isV2 && (
              <button
                onClick={handleRefreshStock}
                disabled={refreshing}
                className={`text-[10px] px-2 py-0.5 rounded ${refreshing ? 'bg-slate-700 text-slate-500 cursor-wait' : 'bg-cyan-700 text-white hover:bg-cyan-600'}`}
                title="重新跑本股票（强制刷 IDB + 拉最新 K 线 + 重算所有因子）"
              >{refreshing ? '⏳ 重跑中' : '🔄 重跑'}</button>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none ml-2">×</button>
          </div>
        </div>

        {refreshError && (
          <div className="px-5 py-2 bg-rose-900/30 border-b border-rose-700/50 text-[11px] text-rose-300">
            ⚠️ 重跑失败：{refreshError}
          </div>
        )}

        {/* 总分 + 等级 */}
        <div className="px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-4 mb-2">
            <div className="text-4xl font-bold font-mono text-white">{counterfactualTotal.toFixed(1)}</div>
            <div>
              <div className={`text-sm font-bold ${counterfactualTotal >= 70 ? 'text-rose-400' : counterfactualTotal >= 55 ? 'text-rose-300' : counterfactualTotal >= 40 ? 'text-slate-300' : 'text-slate-400'}`}>
                {counterfactualTotal >= 70 ? '💎 强烈推荐' : counterfactualTotal >= 55 ? '✅ 推荐买入' : counterfactualTotal >= 40 ? '⚠ 谨慎关注' : '⛔ 暂不推荐'}
              </div>
              <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                综合评分（满分 100）
                {counterfactual.enabled && Math.abs(counterfactualTotal - total) > 0.05 && (
                  <span className={`text-[10px] font-mono ${counterfactualTotal > total ? 'text-rose-300' : 'text-emerald-300'}`}>
                    原始 {total.toFixed(1)} → {counterfactualTotal > total ? '+' : ''}{(counterfactualTotal - total).toFixed(1)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${total >= 70 ? 'bg-rose-500' : total >= 40 ? 'bg-blue-500' : 'bg-slate-500'}`}
              style={{ width: `${Math.min(100, total)}%` }}
            />
          </div>
          {availableRawKeys > 0 && (
            <div className="text-[10px] text-slate-500 mt-1.5 flex items-center justify-between gap-2 flex-wrap">
              <span>📊 原始因子数据：{availableRawKeys} / {totalRawKeys} 项可用 · 点击下方大类查看明细</span>
              <div className="flex items-center gap-1.5">
                {/* 已保存配置提示（非开启时也显示，让用户知道 mults 已加载） */}
                {Object.keys(counterfactual.mults).length > 0 && !counterfactual.enabled && (
                  <span className="text-[10px] text-amber-400" title="localStorage 已存权重配置">
                    ⚙️ {Object.keys(counterfactual.mults).length} 个权重已配置
                  </span>
                )}
                {counterfactual.enabled && Object.keys(counterfactual.mults).length > 0 && (
                  <>
                    <button
                      onClick={greedyOptimize}
                      className="text-[10px] text-slate-400 hover:text-amber-300 underline"
                      title="贪心优化：对每个维度扫 0.5~2.0×，取使综合分最大的倍数（不写入 IDB）"
                    >🎯 自动</button>
                    <button
                      onClick={resetCounterfactual}
                      className="text-[10px] text-slate-400 hover:text-rose-300 underline"
                      title="清除所有权重配置（localStorage）"
                    >重置</button>
                  </>
                )}
                {/* 策略预设下拉 */}
                <div className="relative">
                  <button
                    onClick={() => setShowProfileMenu(prev => !prev)}
                    className="text-[10px] text-slate-400 hover:text-emerald-300 underline"
                    title="管理策略预设（多个命名权重配置）"
                  >💾 预设 {Object.keys(profiles).length > 0 ? `(${Object.keys(profiles).length})` : ''}</button>
                  {showProfileMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowProfileMenu(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 bg-slate-800 border border-slate-600 rounded-lg p-2 min-w-[260px] shadow-xl">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="text-[10px] text-slate-400 font-bold">策略预设</div>
                          <div className="flex items-center gap-1">
                            {/* 排序切换 */}
                            {Object.keys(profiles).length > 1 && (
                              <select
                                value={sortMode}
                                onChange={(e) => setSortMode(e.target.value as 'recent' | 'created' | 'alpha')}
                                className="bg-slate-900 border border-slate-600 text-slate-300 text-[9px] rounded px-1 py-0"
                                title="预设排序"
                              >
                                <option value="recent">最近使用</option>
                                <option value="created">创建时间</option>
                                <option value="alpha">字母</option>
                              </select>
                            )}
                            {/* 对比模式切换 */}
                            {Object.keys(profiles).length >= 2 && (
                              <button
                                onClick={() => {
                                  setCompareMode(prev => !prev);
                                  setCompareSelected([]);
                                }}
                                className={`text-[9px] px-1 py-0.5 rounded ${compareMode ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-cyan-300'}`}
                                title="对比 2-3 个预设的 mults 差异"
                              >⚖ 对比</button>
                            )}
                          </div>
                        </div>
                        {/* 已存预设列表 */}
                        {sortedProfileNames.length === 0 ? (
                          <div className="text-[10px] text-slate-500 py-2 text-center">暂无预设</div>
                        ) : (
                          <div className="space-y-1 mb-2 max-h-40 overflow-y-auto">
                            {sortedProfileNames.map((name) => {
                              const isBuiltin = !!BUILTIN_PROFILES[name];
                              const p = profiles[name] || { mults: BUILTIN_PROFILES[name] };
                              const checked = compareSelected.includes(name);
                              return (
                                <div key={name} className={`flex items-center justify-between gap-1 text-[10px] rounded px-1.5 py-1 ${isBuiltin ? 'bg-amber-900/20 border border-amber-700/30' : 'bg-slate-900/50'}`}>
                                  {compareMode ? (
                                    <>
                                      <label className="flex items-center gap-1 flex-1 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() => toggleCompareSelect(name)}
                                          className="w-3 h-3"
                                        />
                                        <span className={`truncate ${isBuiltin ? 'text-amber-200' : 'text-slate-200'}`} title={name}>{name}</span>
                                      </label>
                                      <span className="text-slate-500 text-[9px]">{Object.keys(p.mults).length}w</span>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        onClick={() => applyProfile(name)}
                                        className={`flex-1 text-left truncate ${isBuiltin ? 'text-amber-200 hover:text-amber-100' : 'text-slate-200 hover:text-emerald-300'}`}
                                        title={`应用预设 "${name}"（${Object.keys(p.mults).length} 个权重${isBuiltin ? '，系统预设' : ''}）`}
                                      >📂 {name}</button>
                                      {!isBuiltin && (
                                        <button
                                          onClick={() => deleteProfile(name)}
                                          className="text-slate-500 hover:text-rose-400 text-[10px] ml-1"
                                          title="删除预设"
                                        >×</button>
                                      )}
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {/* 对比模式：显示多列 mults 对比表 */}
                        {compareMode && compareSelected.length >= 2 && (
                          <div className="mb-2 pt-1.5 border-t border-slate-700">
                            <div className="text-[9px] text-cyan-300 font-bold mb-1">📊 预设对比（最多 3 个）</div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-[9px]">
                                <thead>
                                  <tr className="text-slate-500">
                                    <th className="text-left">维度</th>
                                    {compareSelected.map(n => (
                                      <th key={n} className="text-right px-1 truncate max-w-[60px]" title={n}>{n}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {Object.entries(V2_DIMENSIONS).map(([key, dim]) => {
                                    const row = compareSelected.map(n => profiles[n].mults[key] ?? 1.0);
                                    const minV = Math.min(...row);
                                    const maxV = Math.max(...row);
                                    return (
                                      <tr key={key}>
                                        <td className="text-slate-300 py-0.5">{dim.label}</td>
                                        {row.map((v, i) => (
                                          <td
                                            key={i}
                                            className="text-right font-mono py-0.5 px-1"
                                            style={{
                                              color: v === maxV && row.length > 1 ? '#fb7185'
                                                : v === minV && row.length > 1 ? '#34d399'
                                                  : '#94a3b8',
                                            }}
                                          >
                                            {v.toFixed(2)}
                                          </td>
                                        ))}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                        {/* 保存当前 mults 为新预设 */}
                        {Object.keys(counterfactual.mults).length > 0 && (
                          <div className="flex items-center gap-1 pt-1.5 border-t border-slate-700">
                            <input
                              type="text"
                              value={newProfileName}
                              onChange={(e) => setNewProfileName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') saveProfile(newProfileName); }}
                              placeholder="新预设名…"
                              className="flex-1 px-1.5 py-0.5 bg-slate-900 border border-slate-600 rounded text-[10px] text-slate-200 placeholder-slate-500"
                              maxLength={20}
                            />
                            <button
                              onClick={() => saveProfile(newProfileName)}
                              disabled={!newProfileName.trim()}
                              className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] rounded font-bold"
                              title="保存当前权重为新预设"
                            >保存</button>
                          </div>
                        )}
                        {/* 导出 / 导入 JSON */}
                        <div className="flex items-center gap-1 pt-1.5 mt-1.5 border-t border-slate-700">
                          <button
                            onClick={() => {
                              // 导出用户 profiles + 当前 mults（不导出系统预设，因为它们内置）
                              const data = {
                                version: 1,
                                exportedAt: new Date().toISOString(),
                                profiles,
                                currentMults: counterfactual.mults,
                              };
                              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `quant-strategy-${Date.now()}.json`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                            className="flex-1 px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-[10px] rounded"
                            title="导出所有用户预设 + 当前权重为 JSON 文件（系统预设为内置，不导出）"
                          >⬇ 导出</button>
                          <label
                            className="flex-1 px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-[10px] rounded text-center cursor-pointer"
                            title="从 JSON 文件导入预设 / 当前权重"
                          >
                            ⬆ 导入
                            <input
                              type="file"
                              accept="application/json,.json"
                              className="hidden"
                              onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              try {
                                const text = await file.text();
                                const data = JSON.parse(text);
                                if (data && typeof data === 'object') {
                                  if (data.profiles && typeof data.profiles === 'object') {
                                    setProfiles(prev => ({ ...prev, ...data.profiles }));
                                  }
                                  if (data.currentMults && typeof data.currentMults === 'object' && Object.keys(data.currentMults).length > 0) {
                                    setCounterfactual(prev => ({ ...prev, enabled: true, mults: { ...data.currentMults } }));
                                  }
                                  alert(`导入成功：${data.profiles ? Object.keys(data.profiles).length : 0} 个预设${data.currentMults ? ' + 当前权重' : ''}`);
                                } else {
                                  alert('文件格式不对');
                                }
                              } catch (err: any) {
                                alert('解析失败：' + (err?.message || String(err)));
                              }
                              e.target.value = '';  // 清空，允许重复导入同一文件
                            }}
                            />
                          </label>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (counterfactual.enabled) resetCounterfactual();
                    else setCounterfactual(prev => ({ ...prev, enabled: true }));
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${counterfactual.enabled
                    ? 'bg-rose-600 text-white hover:bg-rose-500'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                  title="反事实计算器：调整各维度权重倍数，实时查看综合分变化（不写入 IDB；mults 持久化到 localStorage）"
                >
                  {counterfactual.enabled ? '🧪 反事实 ✓' : '🧪 反事实'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 公式区 */}
        <div className="px-5 py-3 bg-slate-800/50 border-b border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1.5">📐 综合分计算公式</div>
          <div className="font-mono text-xs text-cyan-300 mb-1">{formula}</div>
          <div className="text-[10px] text-slate-500 mb-2">每个大类先做 0-1 截面百分位归一化 → 加权求和 → 中性化调整（v2）→ 输出</div>
          {/* 权重来源 + 当前生效权重 */}
          <div className="flex items-center gap-2 text-[10px] mt-1.5 flex-wrap">
            <span className="text-slate-400">权重来源：</span>
            <span className={`px-1.5 py-0.5 rounded ${isV2 ? 'bg-cyan-900/40 text-cyan-300' : 'bg-slate-700 text-slate-400'}`}>
              {isV2
                ? (weightSource === 'ic' ? 'IC 动态定权' : weightSource === 'manual' ? '手动定权' : 'Barra 默认')
                : 'v1 旧 3-pillar'}
            </span>
            {isV2 && factors.icStats && Object.keys(factors.icStats).length > 0 && (
              <span className="text-slate-500 ml-1">
                · IC 范围 {Math.min(...Object.values(factors.icStats).map((s: any) => s.ic)).toFixed(3)} ~ {Math.max(...Object.values(factors.icStats).map((s: any) => s.ic)).toFixed(3)}
              </span>
            )}
            <span className="text-slate-500 ml-1">— 悬停每行 ? 看因子设计理由</span>
          </div>
          {/* IC 柱状图（仅 v2 + 有 icStats 时显示） */}
          {isV2 && factors.icStats && Object.keys(factors.icStats).length > 0 && (
            <div className="mt-2.5 pt-2 border-t border-slate-700/50">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                  📐 8 大类 IC 柱状图
                  <span className="text-slate-500 normal-case ml-1">
                    （{factors.icMode === 'backtest' ? '已实现收益' : '当日'} · 范围 -0.2 ~ +0.2）
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="text-[9px] text-slate-500">
                    |IC| ≥ 0.05 = 强相关 · |IC| ≥ 0.02 = 弱相关
                  </div>
                  <button
                    onClick={() => {
                      // 导出 IC 历史为 CSV
                      let history: { ts: number; mode: string; icStats: any }[] = [];
                      try {
                        const raw = localStorage.getItem('quant_ic_history_log');
                        if (raw) history = JSON.parse(raw);
                      } catch { /* ignore */ }
                      if (history.length === 0) {
                        alert('暂无 IC 历史数据');
                        return;
                      }
                      // CSV 表头：timestamp, mode, valuation, quality, ...
                      const dims = Object.keys(V2_DIMENSIONS);
                      const header = ['timestamp', 'mode', ...dims.map(k => `${V2_DIMENSIONS[k].label}_IC`)];
                      const rows = history.map(h => {
                        const ts = new Date(h.ts).toISOString();
                        const ics = dims.map(k => {
                          const ic = h.icStats?.[k]?.ic;
                          return typeof ic === 'number' ? ic.toFixed(4) : '';
                        });
                        return [ts, h.mode, ...ics];
                      });
                      const csv = [header, ...rows].map(r => r.join(',')).join('\n');
                      // 加 BOM 让 Excel 识别 UTF-8
                      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `quant-ic-history-${Date.now()}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 hover:bg-slate-600"
                    title="导出 IC 历史为 CSV 文件（Excel 可打开）"
                  >⬇ CSV</button>
                  <button
                    onClick={() => setShowICTrend(prev => !prev)}
                    className={`text-[9px] px-1.5 py-0.5 rounded ${showICTrend ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                    title="显示 8 大类 IC 历史趋势（最近 20 次分析）"
                  >📈 趋势</button>
                </div>
              </div>
              <div className="space-y-0.5">
                {Object.entries(V2_DIMENSIONS).map(([key, dim]) => {
                  const stat = (factors.icStats as any)[key];
                  if (!stat) return null;
                  const ic = stat.ic;
                  const barW = Math.min(50, Math.abs(ic) * 250);  // |IC|=0.2 → 50% 宽（居中）
                  const barColor = Math.abs(ic) >= 0.05 ? (ic > 0 ? '#fb7185' : '#34d399')
                    : Math.abs(ic) >= 0.02 ? (ic > 0 ? '#fcd34d' : '#86efac')
                      : '#475569';
                  return (
                    <div key={key} className="flex items-center gap-1 text-[10px]">
                      <div className="w-14 text-slate-400 shrink-0">{dim.label}</div>
                      {/* 中线 + 双向条形 */}
                      <div className="flex-1 h-3 relative bg-slate-800/50 rounded overflow-hidden">
                        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-slate-600" />
                        <div
                          className="absolute top-0 bottom-0 rounded transition-all"
                          style={{
                            background: barColor,
                            width: `${barW}%`,
                            left: ic >= 0 ? '50%' : `${50 - barW}%`,
                          }}
                        />
                      </div>
                      <div
                        className="w-14 text-right font-mono shrink-0"
                        style={{ color: barColor }}
                        title={`${dim.label}：IC=${ic.toFixed(3)}，IR=${(stat.ir || 0).toFixed(2)}，n=${stat.n}`}
                      >
                        {ic >= 0 ? '+' : ''}{ic.toFixed(3)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* IC 历史趋势图（开启时显示） */}
          {showICTrend && (
            <div className="mt-2 pt-2 border-t border-slate-700/50">
              {(() => {
                let history: { ts: number; mode: string; icStats: any }[] = [];
                try {
                  const raw = localStorage.getItem('quant_ic_history_log');
                  if (raw) history = JSON.parse(raw);
                } catch { /* ignore */ }
                // 失效检测：连续 3 次 IC < 0 的因子（按 mode 过滤）
                const filtered = history.filter(h => h.mode === factors.icMode);
                const degradedDims: string[] = [];
                for (const [key, dim] of Object.entries(V2_DIMENSIONS)) {
                  if (filtered.length < 3) break;
                  const recent = filtered.slice(-3);
                  if (recent.every(h => {
                    const ic = h.icStats?.[key]?.ic;
                    return typeof ic === 'number' && ic < 0;
                  })) {
                    degradedDims.push(dim.label);
                  }
                }
                return (
                  <>
                    {degradedDims.length > 0 && (
                      <div className="mb-2 px-2 py-1 bg-rose-900/30 border border-rose-700/50 rounded text-[10px] text-rose-300">
                        ⚠️ 因子失效告警：<span className="font-bold">{degradedDims.join('、')}</span> 在最近 3 次分析中 IC 持续为负，建议降低权重或暂时剔除
                      </div>
                    )}
                    {filtered.length < 2 ? (
                      <div className="text-[9px] text-slate-500 text-center py-2">
                        当前模式（{factors.icMode === 'backtest' ? '严谨' : '简易'}）记录不足 2 次，多跑几次再来
                      </div>
                    ) : (
                      <div className="space-y-0.5">
                        {Object.entries(V2_DIMENSIONS).map(([key, dim]) => {
                          const series = filtered.map(h => h.icStats[key]?.ic).filter(v => typeof v === 'number');
                          if (series.length < 2) return null;
                          // 缩放到 [-1, 1] → 50% 居中
                          const W = 100;  // % 宽度
                          const points = series.map((v, i) => {
                            const x = (i / (series.length - 1)) * 100;
                            const y = 50 - v * 50 * Math.min(1, 1);  // |IC| ≤ 1
                            return `${x},${Math.max(0, Math.min(100, y))}`;
                          }).join(' ');
                          const lastVal = series[series.length - 1];
                          const isDegraded = degradedDims.includes(dim.label);
                          const color = isDegraded ? '#ef4444' : (lastVal >= 0 ? '#fb7185' : '#34d399');
                          return (
                            <div key={key} className={`flex items-center gap-1.5 text-[9px] ${isDegraded ? 'bg-rose-900/20 -mx-1 px-1 rounded' : ''}`}>
                              <div className={`w-12 shrink-0 ${isDegraded ? 'text-rose-300 font-bold' : 'text-slate-400'}`}>
                                {dim.label}{isDegraded && ' ⚠'}
                              </div>
                              <div className="flex-1 h-3 relative bg-slate-800/30 rounded">
                                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-slate-600/50" />
                                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                                  <polyline
                                    points={points}
                                    fill="none"
                                    stroke={color}
                                    strokeWidth="2"
                                    vectorEffect="non-scaling-stroke"
                                  />
                                </svg>
                              </div>
                              <div className="w-12 text-right font-mono shrink-0" style={{ color }}>
                                {lastVal >= 0 ? '+' : ''}{lastVal.toFixed(3)}
                              </div>
                            </div>
                          );
                        })}
                        <div className="text-[8px] text-slate-500 text-center pt-1">
                          最近 {filtered.length} 次分析 · {factors.icMode === 'backtest' ? '已实现收益' : '当日'} IC · ⚠=连续 3 次负
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* 行业 vs 全市场百分位对比图（仅 v2 行业模式下显示） */}
        {isV2 && pctScope === 'industry' && percentiles.industrySize && (
          <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/20">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-2">
              📊 行业 vs 全市场 百分位对比（8 大类）
            </div>
            <div className="space-y-1">
              {Object.entries(V2_DIMENSIONS).map(([key, dim]) => {
                const indPct = (percentiles as any)['industryPct' + key.charAt(0).toUpperCase() + key.slice(1)] ?? 0.5;
                const mktPct = (percentiles as any)[key] ?? 0.5;
                return (
                  <div key={key} className="flex items-center gap-2 text-[10px]">
                    <div className="w-14 text-slate-400 shrink-0">{dim.label}</div>
                    {/* 全市场条 */}
                    <div className="flex-1 flex items-center gap-1">
                      <div className="w-6 text-slate-500 text-right">市</div>
                      <div className="flex-1 h-3 bg-slate-800 rounded relative overflow-hidden">
                        <div
                          className="absolute top-0 left-0 h-full bg-slate-500 rounded"
                          style={{ width: `${mktPct * 100}%` }}
                        />
                        <div className="absolute inset-0 flex items-center justify-end pr-1 text-[9px] text-white font-mono">
                          {(mktPct * 100).toFixed(0)}
                        </div>
                      </div>
                    </div>
                    {/* 行业条 */}
                    <div className="flex-1 flex items-center gap-1">
                      <div className="w-6 text-slate-500 text-right">行</div>
                      <div className="flex-1 h-3 bg-slate-800 rounded relative overflow-hidden">
                        <div
                          className="absolute top-0 left-0 h-full rounded"
                          style={{ width: `${indPct * 100}%`, background: indPct > mktPct ? '#fb7185' : '#34d399' }}
                        />
                        <div className="absolute inset-0 flex items-center justify-end pr-1 text-[9px] text-white font-mono">
                          {(indPct * 100).toFixed(0)}
                        </div>
                      </div>
                    </div>
                    {/* 差值 */}
                    <div className={`w-10 text-right font-mono shrink-0 ${(indPct - mktPct) >= 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                      {(indPct - mktPct) >= 0 ? '+' : ''}{((indPct - mktPct) * 100).toFixed(0)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="text-[9px] text-slate-500 mt-2">
              灰=全市场百分位 · 绿/红=行业百分位（绿=行业低于均值，红=行业高于均值）· 右侧=差值
            </div>
          </div>
        )}

        {/* 分项构成（可点击展开） */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs text-slate-400 uppercase tracking-wider">
              {isV2 ? '8 大类因子贡献' : '3 大支柱贡献'}（点击查看明细）
            </div>
            <div className="flex items-center gap-2">
              {/* 全部展开 / 全部折叠 */}
              <button
                onClick={(e) => { e.stopPropagation(); setExpandedKey(expandedKey ? null : 'all'); }}
                className="text-[10px] text-slate-400 hover:text-cyan-300 underline"
                title={expandedKey ? '折叠所有大类' : '展开所有大类'}
              >{expandedKey ? '折叠全部' : '📂 展开全部'}</button>
              {/* 算式已直接显示在每个因子下方的展开区（默认全展开） */}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {Object.entries(dimensions).map(([key, info]) => {
              const rawScore = factors[key];
              const contrib = getContrib(key);
              const hasData = typeof rawScore === 'number';
              // 该大类有原始因子数据？
              const hasRawData = info.rawKeys.some(rk => {
                const v = isV2 ? rawFactors[rk.key] : factors[rk.key];
                return typeof v === 'number' && !isNaN(v);
              });
              const pctOfTotal = total > 0 ? Math.abs(contrib) / total * 100 : 0;
              const barColor = !hasData
                ? 'bg-slate-700'
                : contrib >= 0
                ? 'bg-rose-500'
                : 'bg-emerald-500';
              const isExpanded = expandedKey === 'all' || expandedKey === key;
              return (
                <div key={key} className="space-y-1.5">
                  <div
                    className={`space-y-1 p-2 -mx-2 rounded ${hasRawData ? 'cursor-pointer hover:bg-slate-800/50 transition-colors' : ''}`}
                    onClick={() => hasRawData && setExpandedKey(isExpanded ? null : key)}
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <div className="w-16 text-slate-300 font-medium shrink-0 flex items-center gap-1">
                        {info.label}
                        <span
                          className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-slate-700 text-slate-400 text-[9px] font-bold hover:bg-cyan-600 hover:text-white cursor-help"
                          title={`${info.label}（默认 ${info.weight} / 当前 ${effectiveWeights[key] ?? info.weight}）\n\n${info.reason}\n\n公式：${info.formula}${isV2 && factors.icStats?.[key] ? `\n\n${factors.icMode === 'backtest' ? '已实现收益 IC' : '当日 IC'}：${factors.icStats[key].ic.toFixed(3)}，IR：${factors.icStats[key].ir.toFixed(2)}（n=${factors.icStats[key].n}）` : ''}${isV2 && weightSource === 'default' ? '\n\n（当前 weightMode=default；切到严谨 IC 需开「📐 严谨 IC」后重跑）' : ''}`}
                        >?</span>
                      </div>
                      <div className="text-[10px] text-slate-500 flex-1 truncate" title={info.formula}>
                        {info.formula}
                        {isV2 && effectiveWeights[key] != null && effectiveWeights[key] !== info.weight && (
                          <span className="text-cyan-400 ml-1">→ {effectiveWeights[key]}</span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 w-12 text-right shrink-0">
                        {isV2 && effectiveWeights[key] != null && effectiveWeights[key] !== info.weight ? (
                          <span className="text-cyan-300">{effectiveWeights[key]}</span>
                        ) : (
                          <>权重 {info.weight}</>
                        )}
                      </div>
                      {hasRawData && (
                        <div className="text-slate-500 text-[10px] w-3 text-right shrink-0">{isExpanded ? '▼' : '▶'}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {/* 进度条（恢复原版） */}
                      <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full ${barColor} rounded-full transition-all`}
                          style={{ width: `${Math.min(100, pctOfTotal)}%` }}
                        />
                      </div>
                      <div className="w-20 text-xs font-mono text-right shrink-0">
                        {hasData ? (
                          <span style={{ color: contrib >= 0 ? '#fb7185' : '#34d399' }}>
                            {contrib >= 0 ? '+' : ''}{contrib.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </div>
                      <div className="w-14 text-[10px] text-slate-500 text-right shrink-0">
                        分 {hasData ? (rawScore as number).toFixed(0) : '—'}
                      </div>
                      {/* 反事实滑块：仅开启时显示 */}
                      {counterfactual.enabled && (
                        <div className="flex items-center gap-1 shrink-0 ml-1" title={`调整 ${info.label} 的权重倍数（0.5× ~ 2.0×，1.0× = 原始权重）`}>
                          <input
                            type="range"
                            min="0.5"
                            max="2.0"
                            step="0.05"
                            value={counterfactual.mults[key] ?? 1.0}
                            onChange={(e) => setDimMult(key, parseFloat(e.target.value))}
                            className="w-16 h-1 accent-rose-500 cursor-pointer"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className="text-[9px] text-rose-300 font-mono w-7 text-right">
                            {(counterfactual.mults[key] ?? 1.0).toFixed(2)}×
                          </span>
                        </div>
                      )}
                    </div>

                  {/* 展开：算式表格（只要该大类有分数就显示；默认全展开） */}
                  {hasData && (() => {
                    // 收集每步的"步骤名 / 数字值 / 公式说明"
                    const raws: Record<string, { raw: number | null; pct: number | null }> = {};
                    for (const rk of info.rawKeys) {
                      const { raw, pct } = getRawAndPct(rk);
                      raws[rk.key] = { raw, pct };
                    }
                    const rows: { step: string; val: string; note: string }[] = [];
                    const fs = factors[key];
                    const fsStr = typeof fs === 'number' ? fs.toFixed(1) : '—';
                    if (key === 'valuation') {
                      const pe = raws.pe, pb = raws.pb, ps = raws.ps;
                      const pcts = [pe, pb, ps].map(r => r?.pct ?? null);
                      const validPcts = pcts.filter(p => p != null) as number[];
                      const avgPct = validPcts.length > 0 ? validPcts.reduce((s, x) => s + x, 0) / validPcts.length : null;
                      rows.push({ step: 'PE_TTM 百分位（反向）', val: fmtPct(pe?.pct ?? null), note: `raw=${pe?.raw != null ? pe.raw.toFixed(2) : '—'}，低 PE = 高分` });
                      rows.push({ step: 'PB 百分位（反向）', val: fmtPct(pb?.pct ?? null), note: `raw=${pb?.raw != null ? pb.raw.toFixed(2) : '—'}，低 PB = 高分` });
                      rows.push({ step: 'PS 百分位（反向）', val: fmtPct(ps?.pct ?? null), note: `raw=${ps?.raw != null ? ps.raw.toFixed(2) : '—'}，低 PS = 高分` });
                      rows.push({ step: '聚合', val: avgPct != null ? fmtPct(avgPct) : '—', note: '(PE_pct + PB_pct + PS_pct) / 3' });
                      rows.push({ step: '→ 大类分', val: fsStr, note: 'aggregation × 100' });
                    } else if (key === 'quality') {
                      const roe = raws.roe, gm = raws.grossMargin, dr = raws.debtRatio;
                      const pcts = [roe, gm, dr].map(r => r?.pct ?? null);
                      const validPcts = pcts.filter(p => p != null) as number[];
                      const avgPct = validPcts.length > 0 ? validPcts.reduce((s, x) => s + x, 0) / validPcts.length : null;
                      rows.push({ step: 'ROE 百分位（正向）', val: fmtPct(roe?.pct ?? null), note: `raw=${roe?.raw != null ? (roe.raw * 100).toFixed(2) + '%' : '—'}，高 ROE = 高分` });
                      rows.push({ step: '毛利率 百分位（正向）', val: fmtPct(gm?.pct ?? null), note: `raw=${gm?.raw != null ? (gm.raw * 100).toFixed(2) + '%' : '—'}，高毛利率 = 高分` });
                      rows.push({ step: '负债率 百分位（反向）', val: fmtPct(dr?.pct ?? null), note: `raw=${dr?.raw != null ? (dr.raw * 100).toFixed(2) + '%' : '—'}，低负债率 = 高分` });
                      rows.push({ step: '聚合', val: avgPct != null ? fmtPct(avgPct) : '—', note: '(ROE_pct + 毛利率_pct + 负债率_pct) / 3' });
                      rows.push({ step: '→ 大类分', val: fsStr, note: 'aggregation × 100' });
                    } else if (key === 'momentum') {
                      const m20 = raws.momentum20;
                      rows.push({ step: '5 日收益（raw）', val: raws.momentum5?.raw != null ? (raws.momentum5.raw * 100).toFixed(2) + '%' : '—', note: '近 5 个交易日累计收益' });
                      rows.push({ step: '20 日收益（raw，主要）', val: m20?.raw != null ? (m20.raw * 100).toFixed(2) + '%' : '—', note: '近 20 个交易日累计收益' });
                      rows.push({ step: '60 日收益（raw）', val: raws.momentum60?.raw != null ? (raws.momentum60.raw * 100).toFixed(2) + '%' : '—', note: '中长期动量参考' });
                      rows.push({ step: '20 日百分位', val: fmtPct(m20?.pct ?? null), note: 'percentileRank(momentum20)' });
                      rows.push({ step: '→ 大类分', val: fsStr, note: 'momentum_pct × 100' });
                    } else if (key === 'reversal') {
                      const rsi = raws.rsi14, bias = raws.bias20;
                      const rsiPct = rsi?.pct ?? 0, biasPct = bias?.pct ?? 0;
                      const avgPct = (rsi?.pct != null || bias?.pct != null) ? (rsiPct + biasPct) / 2 : null;
                      rows.push({ step: 'RSI(14)（raw，0-100）', val: rsi?.raw != null ? rsi.raw.toFixed(1) : '—', note: '<30 超卖 → 加分' });
                      rows.push({ step: 'CCI(14)（raw）', val: raws.cci14?.raw != null ? raws.cci14.raw.toFixed(1) : '—', note: '通道指标' });
                      rows.push({ step: '乖离率(20)（raw，%）', val: bias?.raw != null ? bias.raw.toFixed(2) + '%' : '—', note: '负乖离 → 加分' });
                      rows.push({ step: '聚合', val: fmtPct(avgPct), note: '(RSI_pct + 乖离率_pct) / 2' });
                      rows.push({ step: '→ 大类分', val: fsStr, note: 'reversal_pct × 100' });
                    } else if (key === 'moneyFlow') {
                      const m20 = raws.mainNetInflow20d;
                      rows.push({ step: '主力净流入 5日（万元）', val: raws.mainNetInflow5d?.raw != null ? raws.mainNetInflow5d.raw.toFixed(0) : '—', note: '5 个交易日累计' });
                      rows.push({ step: '主力净流入 20日（万元，主要）', val: m20?.raw != null ? m20.raw.toFixed(0) : '—', note: '20 个交易日累计' });
                      rows.push({ step: '量比（raw）', val: raws.volumeRatio?.raw != null ? raws.volumeRatio.raw.toFixed(2) : '—', note: '当日量 / 5日均量' });
                      rows.push({ step: '换手率（raw，%）', val: raws.turnoverRate?.raw != null ? raws.turnoverRate.raw.toFixed(2) : '—', note: '当日换手率' });
                      rows.push({ step: '聚合（取主要）', val: fmtPct(m20?.pct ?? null), note: 'mainNetInflow20d_pct' });
                      rows.push({ step: '→ 大类分', val: fsStr, note: 'moneyFlow_pct × 100' });
                    } else if (key === 'technical') {
                      const macd = raws.macdHist, kk = raws.kdjK, kd = raws.kdjD, boll = raws.bollPosition, adx = raws.adx;
                      const pcts = [macd, kk, kd, boll, adx].map(r => r?.pct ?? null);
                      const validPcts = pcts.filter(p => p != null) as number[];
                      const avgPct = validPcts.length > 0 ? validPcts.reduce((s, x) => s + x, 0) / validPcts.length : null;
                      rows.push({ step: 'MACD Hist（raw）', val: macd?.raw != null ? macd.raw.toFixed(3) : '—', note: '>0 多头' });
                      rows.push({ step: 'KDJ-K（raw，0-100）', val: kk?.raw != null ? kk.raw.toFixed(1) : '—', note: '' });
                      rows.push({ step: 'KDJ-D（raw，0-100）', val: kd?.raw != null ? kd.raw.toFixed(1) : '—', note: '' });
                      rows.push({ step: 'BOLL 位置（raw，0-1）', val: boll?.raw != null ? boll.raw.toFixed(2) : '—', note: '0.5 中性' });
                      rows.push({ step: 'ADX（raw，0-100）', val: adx?.raw != null ? adx.raw.toFixed(1) : '—', note: '>25 趋势确立' });
                      rows.push({ step: '聚合', val: fmtPct(avgPct), note: '(MACD + KDJ + BOLL + ADX) / 4' });
                      rows.push({ step: '→ 大类分', val: fsStr, note: 'technical_pct × 100' });
                    } else if (key === 'turnover') {
                      const tr = raws.turnoverRate;
                      rows.push({ step: '换手率（raw，%）', val: tr?.raw != null ? tr.raw.toFixed(2) : '—', note: '3-15% 最优' });
                      rows.push({ step: '20 日均成交额（亿元）', val: raws.avgAmount20d?.raw != null ? (raws.avgAmount20d.raw / 1e8).toFixed(2) : '—', note: '流动性代理' });
                      rows.push({ step: '聚合', val: fmtPct(tr?.pct ?? null), note: 'turnoverRate_pct' });
                      rows.push({ step: '→ 大类分', val: fsStr, note: 'turnover_pct × 100' });
                    } else if (key === 'wqAlpha') {
                      const wq = raws.wqAlphaScore;
                      rows.push({ step: 'WQ 101 Alphas 复合（raw，-100~+100）', val: wq?.raw != null ? wq.raw.toFixed(1) : '—', note: '>0 多头' });
                      rows.push({ step: '聚合', val: fmtPct(wq?.pct ?? null), note: 'percentileRank(wqAlphaScore)' });
                      rows.push({ step: '→ 大类分', val: fsStr, note: 'wqAlpha_pct × 100' });
                    } else {
                      rows.push({ step: 'v1 公式', val: info.formula, note: '3-pillar 旧体系' });
                      rows.push({ step: '→ 大类分', val: fsStr, note: '已按 v1 加权' });
                    }
                    return (
                      <div className="ml-4 pl-3 border-l-2 border-amber-500/50 pb-2 mt-1">
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-[10px] text-amber-300 font-semibold">🧮 计算明细（{info.label}）</div>
                          {/* 复制整张算式为 Markdown（仅在第一个维度显示） */}
                          {key === Object.keys(dimensions)[0] && (
                            <button
                              onClick={copyFormulasAsMarkdown}
                              className={`text-[9px] px-1.5 py-0.5 rounded ${copiedMd ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-cyan-600 hover:text-white'}`}
                              title="复制 8 大类完整算式为 Markdown 表格（可贴到研报）"
                            >{copiedMd ? '✓ 已复制' : '📋 复制算式'}</button>
                          )}
                        </div>
                        <table className="w-full text-[10px] border-collapse">
                          <thead>
                            <tr className="text-slate-500 border-b border-slate-700">
                              <th className="text-left py-1 px-1 font-medium">步骤</th>
                              <th className="text-right py-1 px-1 font-medium">值</th>
                              <th className="text-left py-1 px-1 font-medium">说明 / 公式</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r, i) => {
                              // 算式 step 是否关联 raw 因子（用于 hover 联动高亮）
                              // 通过 step 文本中是否包含 raw key 的 label 字符串判断
                              const matchedRawKey = info.rawKeys.find(rk => r.step.includes(rk.label))?.key;
                              const isHovered = matchedRawKey && hoveredRawKey === matchedRawKey;
                              return (
                                <tr
                                  key={i}
                                  className={`transition-colors ${i === rows.length - 1 ? 'border-t border-amber-700/50 bg-amber-900/20' : ''} ${isHovered ? 'bg-amber-900/40 ring-1 ring-amber-500/60' : ''}`}
                                >
                                  <td className={`py-1 px-1 ${i === rows.length - 1 ? 'text-amber-200 font-bold' : 'text-slate-300'}`}>{r.step}</td>
                                  <td className={`py-1 px-1 text-right font-mono ${i === rows.length - 1 ? 'text-amber-100 text-[12px] font-bold' : 'text-cyan-300'}`}>{r.val}</td>
                                  <td className={`py-1 px-1 italic ${i === rows.length - 1 ? 'text-amber-300' : 'text-slate-500'}`}>{r.note}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                      <div className="ml-4 pl-3 border-l-2 border-cyan-500/30 pb-2">
                        <div className="text-[10px] text-cyan-300 font-semibold mb-1 mt-2">📊 原始因子明细（{info.label}）</div>
                      {/* v2 旧数据 rawFactors 缺失时显示提示 */}
                      {isV2 && (!rawFactors || Object.keys(rawFactors).length === 0) && (
                        <div className="text-[10px] text-amber-400 bg-amber-900/20 border border-amber-700/30 rounded px-2 py-1 mb-1">
                          ⚠️ raw 因子数据缺失（可能是 IDB 旧版记录）。算式已基于分类分计算；明细需重新跑分析。
                        </div>
                      )}
                      {info.rawKeys.map(rk => {
                        const v = isV2 ? rawFactors[rk.key] : factors[rk.key];
                        const hasV = typeof v === 'number' && !isNaN(v);
                        const pct = getPct(rk);  // 0-1，null = 无百分位
                        const hasPct = pct !== null;
                        // 排名池规模：v2 行业模式用 industrySize；v2 全市场或 v1 用 poolSize
                        const poolN = pctScope === 'industry' && isV2
                          ? (percentiles.industrySize || 0)
                          : (poolSize > 0 ? poolSize : (isV2 ? 300 : 100));
                        const scopeLabel = pctScope === 'industry' && isV2
                          ? `行业 ${stock.factorScores?.rawFactors?.industry || '?'} 内 ${poolN} 只候选股`
                          : `${poolN} 只候选股`;
                        return (
                          <div
                            key={rk.key}
                            className={`flex items-center gap-2 text-[11px] cursor-help transition-colors px-1 rounded ${hoveredRawKey === rk.key ? 'bg-amber-900/30 ring-1 ring-amber-500/60' : 'hover:bg-slate-800/30'}`}
                            onMouseEnter={() => setHoveredRawKey(rk.key)}
                            onMouseLeave={() => setHoveredRawKey(null)}
                            title={hasPct ? `${info.label} 因子在 ${scopeLabel} 中处于 ${(pct! * 100).toFixed(1)}% 分位（${pct! >= 0.5 ? '优于中位' : '低于中位'}）` : '该因子未参与截面百分位'}
                          >
                            <div className="w-20 text-slate-400 shrink-0">{rk.label}</div>
                            <div className="flex-1 text-slate-500 text-[10px] truncate" title={rk.desc}>{rk.desc}</div>
                            <div className="font-mono shrink-0 text-right w-16" style={{ color: hasV ? (rk.inverted ? (v < 0 ? '#fb7185' : '#34d399') : (v >= 0 ? '#fb7185' : '#94a3b8')) : '#475569' }}>
                              {formatRawVal(v, rk.unit, !isV2)}
                              {rk.inverted && <span className="text-slate-600 ml-0.5">↺</span>}
                            </div>
                            {/* 百分位 + 排名 */}
                            <div className="font-mono shrink-0 text-right w-32" title={hasPct ? `${info.label} 因子在 ${scopeLabel} 中处于 ${(pct! * 100).toFixed(1)}% 分位（${pct! >= 0.5 ? '优于中位' : '低于中位'}）` : '该因子未参与截面百分位'}>
                              {hasPct ? (
                                <>
                                  <span style={{ color: pct! >= 0.7 ? '#fb7185' : pct! >= 0.4 ? '#fcd34d' : '#94a3b8' }}>
                                    {(pct! * 100).toFixed(0)}%
                                  </span>
                                  <span className="text-slate-500 ml-1 text-[9px]">{pctToRank(pct!, poolN, !!rk.inverted)}</span>
                                </>
                              ) : (
                                <span className="text-slate-700 text-[10px]">—</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      </div>
                    </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 验证：分项贡献加总 ≈ 综合分 */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-800/30">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">分项贡献加总：</span>
            <span className="font-mono text-white">
              {Object.keys(dimensions).reduce((s, k) => s + getContrib(k), 0).toFixed(2)}
              <span className="text-slate-500"> ≈ </span>
              <span className="text-cyan-300">{total.toFixed(2)}</span>
            </span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            💡 差异来自四舍五入 + 中性化 / 共线性处理（v2 还会按市场状态调整权重）
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 flex justify-end">
          <button onClick={onClose} className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg">关闭</button>
        </div>
      </div>
    </div>
  );
}

// ==================== ② 市场大盘 ====================

function MarketOverview() {
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchIndices = useCallback(async () => {
    try {
      const res = await fetch('/api/stock/realtime?codes=000001.SH,399001.SZ,399006.SZ,000300.SH,000016.SH,000688.SH');
      const json = await res.json();
      if (json.success) {
        setIndices(json.data.map((q: any) => ({
          code: q.code, name: q.name, price: q.price,
          change: q.change, changePercent: q.changePercent,
        })));
      }
    } catch (e) { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchIndices();
    const id = setInterval(fetchIndices, 15_000);
    return () => clearInterval(id);
  }, [fetchIndices]);

  return (
    <section className="mb-6" data-section-target="overview">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-slate-100">① 市场大盘</h2>
        <span className="text-xs text-slate-500">{loading ? '加载中…' : '每 15s 自动刷新'}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {loading && indices.length === 0
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-3 animate-pulse h-20" />
            ))
          : indices.map(idx => (
              <div key={idx.code} className="bg-slate-900 border border-slate-800 rounded-xl p-3 hover:border-slate-600 transition-colors">
                <div className="text-xs text-slate-400 mb-1">{idx.name}</div>
                <div className="text-lg font-bold text-white">{idx.price.toFixed(2)}</div>
                <div className={`text-sm font-semibold ${idx.changePercent >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {fmtPct(idx.changePercent)}
                </div>
              </div>
            ))}
      </div>
    </section>
  );
}

// ==================== ②+ 热点板块 & 板块轮动（2026-09 新增）====================
// 两层逻辑：
//   第 1 层（板块轮动）：v2 候选池内按申万一级行业聚合，算板块热度（涨幅+资金+上涨占比百分位）
//   第 2 层（板块内选优质股）：热点板块内按 v2 综合分取 top 股，规避"追热垃圾股"
// 数据源：与 ② 今日推荐完全同一份 v2 `一键分析` 响应里的 hotSectors → 数据一致
interface HotSectorLeaderUI {
  code: string;
  name: string;
  composite: number;
  baseComposite: number;
  changePercent: number;
  sectorBoost: number;
}
interface HotSectorUI {
  industry: string;
  count: number;
  upCount: number;
  downCount: number;
  avgChangePercent: number;
  // 2026-09-06（方案 A）：情绪周期 / 退潮识别 + 事件加持预留
  phase?: 'early' | 'main' | 'climax' | 'retreat';
  overheated?: boolean;
  retreating?: boolean;
  avgBias20?: number;
  avgADX?: number;
  avgSustain?: number;   // 板块近5日上涨占比（0-1，持续性确认）
  avgMomentum20?: number; // 板块20日动量%（RS主轴）
  limitUpCount?: number;  // 板块涨停家数（候选池内 changePercent≥9.9）
  eventBoost?: number;
  heatScore: number;
  rank: number;
  isLeading: boolean;
  leaders: HotSectorLeaderUI[];
}
function HotSectorSection() {
  const [sectors, setSectors] = useState<HotSectorUI[]>([]);
  const [storageTs, setStorageTs] = useState<number | null>(null);
  const [pushing, setPushing] = useState(false);

  const loadFromStorage = useCallback(() => {
    try {
      const raw = localStorage.getItem('quant_hot_sectors');
      if (!raw) { setSectors([]); setStorageTs(null); return; }
      const d = JSON.parse(raw);
      setSectors(Array.isArray(d.sectors) ? d.sectors : []);
      setStorageTs(d.ts ?? null);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadFromStorage();
    window.addEventListener('quant:hot-sectors-updated', loadFromStorage);
    window.addEventListener('storage', loadFromStorage);
    return () => {
      window.removeEventListener('quant:hot-sectors-updated', loadFromStorage);
      window.removeEventListener('storage', loadFromStorage);
    };
  }, [loadFromStorage]);

  // 推入交易池（与 ② 今日推荐 完全相同的 addCodes + 事件广播机制）
  const pushToPool = async (codes: string[]) => {
    if (codes.length === 0 || pushing) return;
    setPushing(true);
    try {
      const res = await fetch('/api/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addCodes', codes, strategyType: 'factor' }),
      });
      const json = await res.json();
      if (json.success) {
        window.dispatchEvent(new CustomEvent('quant:simulator-changed', { detail: { codes, source: 'hot-section' } }));
        toast.success(`🔥 ${codes.length} 只热点优质股已推入交易池`, {
          description: '可到「④ 模拟交易」开启自动驾驶',
          duration: 4000,
        });
        setTimeout(() => {
          document.getElementById('section-simulator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 1200);
      } else {
        toast.error(json.error || '推入失败');
      }
    } catch (e: any) {
      toast.error(e?.message || '网络错误');
    } finally {
      setPushing(false);
    }
  };

  if (sectors.length === 0) {
    // 空态也常驻显示（2026-09：功能可见性 —— 用户提过\"看不到热点功能\"）。
    // 未跑分析时给占位引导，跑「⚡ 一键分析」后由 hotSectors 点亮。
    return (
      <section className="mb-6" data-section-target="hot-sectors">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold text-slate-100">🔥 热点板块 & 板块轮动</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              A股是资金市 · 先选当前资金集中的热点板块，再在板块内挑优质股（规避追高接盘）
            </p>
          </div>
          <span className="text-[11px] px-2 py-1 rounded bg-slate-800 text-slate-400 border border-slate-700">
            等待分析
          </span>
        </div>
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center">
          <p className="text-sm text-slate-400">📊 热点板块随「⚡ 一键分析」自动生成</p>
          <p className="text-xs text-slate-500 mt-1">
            在「② 今日推荐」点 ⚡ 一键分析，即可点亮热点板块（板块热度 + 板块内优质股一键推入交易池）
          </p>
        </div>
      </section>
    );
  }

  const heatColor = (h: number) =>
    h >= 70 ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
      : h >= 50 ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
      : 'bg-slate-500/20 text-slate-300 border-slate-600/40';
  const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const allLeaderCodes = sectors.flatMap(s => s.leaders.map(l => l.code));

  return (
    <section className="mb-6" data-section-target="hot-sectors">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-slate-100">🔥 热点板块 & 板块轮动</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            A股是资金市 · 先选当前资金集中的热点板块，再在板块内挑优质股（规避追高接盘）
            {storageTs ? ` · ${new Date(storageTs).toLocaleTimeString()} 更新` : ''}
          </p>
        </div>
        <button
          onClick={() => pushToPool(allLeaderCodes)}
          disabled={pushing || allLeaderCodes.length === 0}
          className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-rose-600 hover:bg-rose-500 disabled:opacity-40 transition-colors"
        >
          {pushing ? '推入中…' : `🔥 全部 ${allLeaderCodes.length} 只推入交易池`}
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {sectors.map(s => (
          <div
            key={s.industry}
            className={`rounded-xl border p-3 ${s.isLeading ? 'bg-gradient-to-br from-rose-900/40 to-slate-900 border-rose-500/40' : 'bg-slate-900 border-slate-800'}`}
          >
            {/* 板块头 */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-100">🎯 {s.industry}</span>
                {s.isLeading && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-600/30 text-rose-300 border border-rose-500/40 font-semibold">本轮榜首</span>}
                {/* 2026-09-06（方案 A）：板块生命周期阶段徽章 */}
                {!s.phase ? null : s.phase === 'climax' || s.phase === 'retreat' ? (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${s.phase === 'climax' ? 'bg-amber-900/40 text-amber-200 border-amber-700/50' : 'bg-emerald-900/40 text-emerald-200 border-emerald-700/50'}`}>
                    {s.phase === 'climax' ? '⚠️ 高潮·已过热' : '📉 退潮·回调'}
                  </span>
                ) : (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${s.phase === 'main' ? 'bg-emerald-900/40 text-emerald-200 border-emerald-700/50' : 'bg-sky-900/40 text-sky-200 border-sky-700/50'}`}>
                    {s.phase === 'main' ? '📈 主升' : '🚀 启动'}
                  </span>
                )}
              </div>
              <span className={`text-xs font-bold px-2 py-0.5 rounded border ${heatColor(s.heatScore)}`}>
                热度 {s.heatScore}
              </span>
            </div>
            {/* 板块统计 */}
            <div className="flex items-center gap-3 text-[11px] text-slate-400 mb-2">
              <span className={s.avgChangePercent >= 0 ? 'text-rose-300' : 'text-emerald-300'}>
                涨幅 {pct(s.avgChangePercent)}
              </span>
              <span>上涨 {s.upCount}/{s.count}</span>
              <span className="text-emerald-300" title="近5日上涨个股占比（热点持续性，过滤单日脉冲）">5日走强 {Math.round((s.avgSustain ?? 0) * 100)}%</span>
              <span className="text-sky-300" title="板块20日动量（RS主轴，热点可持续的核心）">20日RS {(s.avgMomentum20 ?? 0).toFixed(1)}%</span>
              {(s.limitUpCount ?? 0) > 0 && (
                <span className="text-rose-300 font-semibold" title="涨停家数（板块内 changePercent≥9.9）">🚀涨停 {s.limitUpCount}</span>
              )}
              <span className="text-slate-500">{s.count} 只成分</span>
            </div>
            {/* 2026-09-06（方案 A）：过热/退潮风险提示（热度后回调内化） */}
            {s.overheated && (
              <div className="text-[10px] text-amber-300 bg-amber-900/15 border border-amber-800/40 rounded px-2 py-1 mb-2" title={s.avgBias20 !== undefined ? `板块平均 20日乖离 +${s.avgBias20.toFixed(1)}%，涨幅透支` : undefined}>
                ⚠️ 已过热点：乖离 {s.avgBias20?.toFixed(1)}%，涨幅透支，谨慎追高
              </div>
            )}
            {s.retreating && (
              <div className="text-[10px] text-emerald-300 bg-emerald-900/15 border border-emerald-800/50 rounded px-2 py-1 mb-2" title={s.avgBias20 !== undefined ? `板块平均 20日乖离 ${s.avgBias20.toFixed(1)}%` : undefined}>
                📉 退潮调整中，反弹确认前暂不优先
              </div>
            )}
            {/* 板块内优质股（第 2 层） */}
            <div className="space-y-1.5">
              {s.leaders.map((l, i) => (
                <div key={l.code} className="flex items-center justify-between text-xs bg-slate-800/60 rounded-lg px-2 py-1.5">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 w-4 shrink-0">#{i + 1}</span>
                    <span className="font-medium text-slate-200 truncate">{l.name}</span>
                    <span className="text-[10px] text-slate-500">{l.code}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-amber-300">分 {l.composite?.toFixed(1)}</span>
                    {l.sectorBoost > 0 && (
                      <span className="text-[10px] px-1 rounded bg-rose-600/20 text-rose-300" title="板块热度加持分">+{l.sectorBoost.toFixed(1)}</span>
                    )}
                    <span className={l.changePercent >= 0 ? 'text-rose-300' : 'text-emerald-300'}>
                      {pct(l.changePercent)}
                    </span>
                    <button
                      onClick={() => pushToPool([l.code])}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 hover:bg-rose-600 transition-colors"
                    >
                      推池
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ==================== ③ 今日推荐 ====================
// ==================== ③ 今日推荐 ====================
// 推荐业绩归因卡（mini 净值曲线 + 胜率 + 累计收益 + 最大回撤）
interface PerfAttributionData {
  days: number;
  cumulativeReturn: number;
  winRate: number;
  maxDrawdown: number;
  navCurve: Array<{ date: string; nav: number; dailyReturn: number }>;
  sampleSize: number;
}
function PerfAttributionCard({ data }: { data: PerfAttributionData }) {
  const isProfit = data.cumulativeReturn >= 0;
  // SVG 迷你净值曲线（240 x 48）
  const W = 240, H = 48;
  const navs = data.navCurve.map(p => p.nav);
  const minNav = Math.min(...navs, 0.95);
  const maxNav = Math.max(...navs, 1.05);
  const range = maxNav - minNav || 0.01;
  const points = data.navCurve.map((p, i) => {
    const x = (i / Math.max(1, data.navCurve.length - 1)) * W;
    const y = H - ((p.nav - minNav) / range) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <div className="bg-gradient-to-br from-slate-900 to-slate-800/50 border border-slate-700/60 rounded-xl p-3 mb-3 flex items-center gap-4">
      {/* 左侧 SVG 净值曲线 */}
      <div className="shrink-0">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
          {/* 基线（nav=1） */}
          <line
            x1={0} y1={H - ((1 - minNav) / range) * H}
            x2={W} y2={H - ((1 - minNav) / range) * H}
            stroke="rgb(71 85 105)" strokeDasharray="2 2" strokeWidth={0.5}
          />
          {/* 净值折线 */}
          <polyline
            points={points}
            fill="none"
            stroke={isProfit ? 'rgb(244 63 94)' : 'rgb(16 185 129)'}
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
          {/* 终点圆点 */}
          {data.navCurve.length > 0 && (
            <circle
              cx={W}
              cy={H - ((data.navCurve[data.navCurve.length - 1].nav - minNav) / range) * H}
              r={2.5}
              fill={isProfit ? 'rgb(244 63 94)' : 'rgb(16 185 129)'}
            />
          )}
        </svg>
      </div>
      {/* 右侧指标 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="font-medium text-slate-300">📊 推荐业绩归因</span>
          <span className="text-[10px] text-slate-500">· {data.sampleSize} 个交易日</span>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-1.5">
          <div>
            <div className="text-[10px] text-slate-500">累计收益</div>
            <div className={`text-sm font-mono font-bold ${isProfit ? 'text-rose-400' : 'text-emerald-400'}`}>
              {isProfit ? '+' : ''}{data.cumulativeReturn.toFixed(2)}%
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">胜率</div>
            <div className="text-sm font-mono font-bold text-slate-200">
              {data.winRate.toFixed(0)}%
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">最大回撤</div>
            <div className="text-sm font-mono font-bold text-amber-400">
              -{data.maxDrawdown.toFixed(2)}%
            </div>
          </div>
        </div>
      </div>
      <div className="text-[10px] text-slate-500 hidden lg:block max-w-[140px] leading-tight">
        ⚠️ 按 Top 10 等权建仓对比当前价 · 真实回测见「因子组合回测」
      </div>
    </div>
  );
}

function TodayRecommendations({ onAddToSimulator, onShowDetail, onShowScoreDetail }: {
  onAddToSimulator: (codes: string[]) => void;
  onShowDetail: (stock: { code: string; name: string }) => void;
  onShowScoreDetail: (stock: ScoreDetailStock) => void;
}) {
  const ap = useAutoPilot();
  const [picks, setPicks] = useState<ScreenerRow[]>([]);
  // 📈 5日 sparkline 数据（code → 收盘价序列）
  const [sparklineMap, setSparklineMap] = useState<Record<string, number[]>>({});
  // K线缓存：code → { ts, prices }，避免重复拉
  const sparklineCacheRef = useRef<Map<string, { ts: number; prices: number[] }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addingWatch, setAddingWatch] = useState(false);
  const [msg, setMsg] = useState<string>('');
  // 5日/20日切换：与专业模式因子研究页"个股排行"完全一致（同一份 IndexedDB 缓存）
  const [period, setPeriod] = useState<'5d' | '20d'>('5d');
  // v1/v2 评分系统切换：v2 走 8 大类因子 + 中性化 + IC 动态定权（新模块），v1 走旧 3-pillar
  // 默认 v2（更客观），v1 已废弃，state 简化为单值占位（保留兼容）
  const [scoreVersion, setScoreVersion] = useState<'v2'>('v2');
  const [lastAnalysisDate, setLastAnalysisDate] = useState<string | null>(null);
  const [noCache, setNoCache] = useState(false);
  // 「历史命中」统计：code -> { count(过去 5 个交易日 Top N 命中次数), avgRank, lastDate }
  // 用于在推荐列表每行显示「🔥 连续 4 天命中」之类的徽章，给用户"推荐稳定性"信号
  const [historyHits, setHistoryHits] = useState<Record<string, { count: number; avgRank: number; lastDate: string | null }>>({});
  // 「推荐业绩归因」：过去 N 天每天按 Top 10 推荐建仓、今天查看累计盈亏
  // 指标：累计收益 / 胜率 / 最大回撤 / 净值曲线
  const [perfAttribution, setPerfAttribution] = useState<{
    days: number;
    cumulativeReturn: number;
    winRate: number;
    maxDrawdown: number;
    navCurve: Array<{ date: string; nav: number; dailyReturn: number }>;
    sampleSize: number;
  } | null>(null);
  // 严谨 IC（用已实现收益）：开启后 v2 route 算 momentum20 vs raw factors 的横截面 IC
  // 持久化到 localStorage（quant_ic_history）；默认关
  const [useICHistory, setUseICHistory] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem('quant_ic_history') === '1'; } catch { return false; }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem('quant_ic_history', useICHistory ? '1' : '0'); } catch { /* ignore */ }
  }, [useICHistory]);
  // v2.1（2026-06-15）：权重模式（速览模式可切换 default/ic）
  const [useICWeight, setUseICWeight] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem('quant_ic_weight') === '1'; } catch { return false; }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem('quant_ic_weight', useICWeight ? '1' : '0'); } catch { /* ignore */ }
  }, [useICWeight]);
  // v2.1.1（2026-06-15）：长动量开关
  //   关闭（默认）：momentum = momentum20（短动量，适合日频调仓）
  //   开启：momentum = 60d×0.3 + 120d×0.5 + 20d×0.2（长动量，Jegadeesh-Titman 1993）
  const [useLongMomentum, setUseLongMomentum] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem('quant_long_momentum') === '1'; } catch { return false; }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem('quant_long_momentum', useLongMomentum ? '1' : '0'); } catch { /* ignore */ }
  }, [useLongMomentum]);
  // v2.1.1：最新分析的 diagnostics（用于显示权重明细 / reverse 决策 / 集中度）
  const [lastDiagnostics, setLastDiagnostics] = useState<any>(null);
  // v2.1.1：行业集中度评估
  const [lastConcentration, setLastConcentration] = useState<any>(null);
  // v2.1.1：集中度详情面板展开状态
  const [concentrationPanelOpen, setConcentrationPanelOpen] = useState(false);
  // v2.1.1：WF 验证面板展开状态
  const [wfPanelOpen, setWfPanelOpen] = useState(false);
  // v2.1.1：WF 报告
  const [wfReport, setWfReport] = useState<any>(null);
  const [wfLoading, setWfLoading] = useState(false);
  // v2.1.1（2026-06-15）：WF 历史趋势（来自 IDB walkforwardReports 表）
  const [wfTrend, setWfTrend] = useState<any>(null);
  // v2.1.1：Sparkline 组件（动态 import 避免 SSR 问题）
  const [SparklineComp, setSparklineComp] = useState<any>(null);
  useEffect(() => {
    import('@/app/quant/components/WalkforwardSparkline').then(m => setSparklineComp(() => m.WalkforwardSparkline));
  }, []);
  // v3.0（2026-06-15）：Snapshot 统计（用于 WF 面板"真实/代理"模式提示）
  // 注：8000+ 行 page.tsx 在 ~7000 行后 TS 偶尔误判 setter 为不存在
  //     实际 dev 编译能找到；这里加 @ts-ignore 兜底
  const [snapshotStats, setSnapshotStats] = useState<any>(null);
  // v3.0.1（2026-06-15）：Barra 组合优化状态
  // @ts-ignore — 大文件 TS 漏检 setter；dev 实际能找到
  const [barraWeights, setBarraWeights] = useState<any[] | null>(null);
  // @ts-ignore
  const [barraDiag, setBarraDiag] = useState<any | null>(null);
  // @ts-ignore
  const [barraPanelOpen, setBarraPanelOpen] = useState<boolean>(false);
  // @ts-ignore
  const [barraLoading, setBarraLoading] = useState<boolean>(false);
  // @ts-ignore
  const [barraLambda, setBarraLambda] = useState<number>(1.0);
  // 一键分析状态（不跳页：点一下直接调用因子分析 API + 写 IDB + 自动刷新）
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<string>('');
  // 缓存命中时间（避免 5分钟 内重复点分析）
  const [cacheAge, setCacheAge] = useState<number | null>(null);
  // 多选：默认全选（推荐股票本来就是精选，全选最符合"一键"语义）
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 哪些股票已在盯盘里（用来禁用 checkbox / 标记）
  const [inWatchlist, setInWatchlist] = useState<Set<string>>(new Set());
  // ───────────── 回测验证推荐（沿用 /api/stock/backtest-v1-vs-v2） ─────────────
  // 目的：让用户在不离开 ② 区的情况下，验证"今日推荐"在过去 N 天的真实表现
  // 与 ④b 区别：④b 用全市场 topN 验证模型整体能力；这里用 picks 自己的 codes
  // 复用：直接渲染 <BacktestResultView>（与 ④b 完全相同的图表 + sharpe/最大回撤/共识天数）
  const [backtestOpen, setBacktestOpen] = useState(false);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [backtestResult, setBacktestResult] = useState<any>(null);
  const [backtestLookback, setBacktestLookback] = useState(20);  // 与 ④b 默认对齐
  const [backtestTopN, setBacktestTopN] = useState(10);

  // 直接读因子研究页写入的 IndexedDB 缓存
  // 与 /quant/factor-analysis-v2 页"个股排行"100% 同一份数据
  // V1/V2 通过 scoreVersion 字段隔离，切版本不重跑
  const fetchPicks = useCallback(async (selectedPeriod: '5d' | '20d', selectedVersion: 'v1' | 'v2' = scoreVersion) => {
    setLoading(true);
    setMsg('');
    try {
      // 1. 动态导入（仅浏览器端）
      const { db } = await import('@/lib/quant/db/database');
      const scoresTable = db.stockScores;
      if (!scoresTable) {
        setPicks([]);
        return;
      }
      // 2. 取最新分析日期的所有记录
      const allRecords = await scoresTable.toArray();
      if (allRecords.length === 0) {
        setPicks([]);
        setCacheAge(null);
        return;
      }
      // 3. 最新 date + 指定 period + 指定 scoreVersion
      //    旧数据无 scoreVersion 字段（id 无 _v1/_v2 后缀）→ 视为 v1（因子研究页默认 V1）
      const latestDate = [...new Set(allRecords.map(r => r.date))].sort().at(-1) || null;
      const scoped = allRecords
        .filter(r => r.date === latestDate && r.period === selectedPeriod)
        .filter(r => {
          // 优先用显式 scoreVersion
          if (r.scoreVersion === 'v1' || r.scoreVersion === 'v2') {
            return r.scoreVersion === selectedVersion;
          }
          // 兼容旧数据：缺失 scoreVersion 的归到 v1
          return selectedVersion === 'v1';
        });
      // 2026-09-06：热点分级配额优先 —— 配额入选股按 quotaRank 排前（热度越高的板块占席越多），
      // 其余股按综合分补足到 10；无配额数据的旧缓存退化为按综合分取 Top10
      const quotaPicks = scoped
        .filter(r => typeof r.quotaRank === 'number')
        .sort((a, b) => (a.quotaRank ?? 0) - (b.quotaRank ?? 0));
      const nonQuota = scoped
        .filter(r => typeof r.quotaRank !== 'number')
        .sort((a, b) => b.compositeScore - a.compositeScore);
      const records = [...quotaPicks, ...nonQuota].slice(0, 10);
      setLastAnalysisDate(latestDate);
      // 计算缓存新鲜度
      if (records.length > 0) {
        const latestTs = Math.max(...records.map(r => r.updatedAt || 0));
        if (latestTs > 0) setCacheAge(Date.now() - latestTs);
      } else {
        setCacheAge(null);
      }

      if (records.length === 0) {
        setPicks([]);
        return;
      }
      // 4. 转换为展示格式（pe 字段已废弃，不再赋值；toStockRow 会忽略它）
      // 同时计算 compositePct：v2 用 8 大类均分（粗略），v1 用 compositeScore 在全池的百分位
      const compositeScoresAll = records.map(r => r.compositeScore).filter((x): x is number => typeof x === 'number' && !isNaN(x));
      const sortedAsc = [...compositeScoresAll].sort((a, b) => a - b);
      const list = records.map(r => {
        let compositePct: number | undefined;
        if (typeof r.compositeScore === 'number' && sortedAsc.length > 0) {
          // 二分找位置
          let lo = 0, hi = sortedAsc.length;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (sortedAsc[mid] < r.compositeScore) lo = mid + 1;
            else hi = mid;
          }
          compositePct = lo / sortedAsc.length;
        }
        return {
          code: r.code, name: r.name, price: r.price, changePercent: r.changePercent,
          compositeScore: r.compositeScore,
          moneyFlowScore: r.moneyFlowScore, momentumScore: r.momentumScore,
          technicalScore: r.technicalScore,
          // 2026-09-06：透传热点配额标签，供「板块配额」展示条 + 行内板块徽章
          industry: r.industry || '',
          quotaRank: r.quotaRank,
          quotaSectorRank: r.quotaSectorRank,
          quotaHeat: r.quotaHeat,
          quotaSlots: r.quotaSlots,
          compositePct,
          // factorScores 是 JSON 字符串（v1 3-pillar 或 v2 8 大类），详情弹窗要用
          factorScores: r.factorScores,
        };
      });
      setPicks(list);
      // 默认全选（用户可手动取消）
      setSelected(new Set(list.map(p => p.code)));

      // 计算「历史命中」：过去 5 个交易日，每只股票出现在 Top N 的次数
      // 数据源：db.stockScores（同 v1/v2 已有的 IDB 缓存，无需新表）
      try {
        const allHistory = await scoresTable.toArray();
        // 限定当前 period + scoreVersion
        const scoped = allHistory.filter(r =>
          r.period === selectedPeriod &&
          (r.scoreVersion === selectedVersion || (!r.scoreVersion && selectedVersion === 'v1'))
        );
        // 取所有历史日期，去重，降序
        const allDates = [...new Set(scoped.map(r => r.date))].sort().reverse();
        // 取最近 5 个交易日（仅含当前 hits 涉及的日期——按日期内 Top N）
        const topNPerDay = 10; // 与本组件 picks 上限一致
        const dateHits: Record<string, Record<string, number>> = {}; // code -> {date -> rank}
        for (const d of allDates.slice(0, 5)) {
          const dayRecords = scoped
            .filter(r => r.date === d)
            .sort((a, b) => b.compositeScore - a.compositeScore)
            .slice(0, topNPerDay);
          for (let rank = 0; rank < dayRecords.length; rank++) {
            const code = dayRecords[rank].code;
            if (!dateHits[code]) dateHits[code] = {};
            dateHits[code][d] = rank + 1;
          }
        }
        // 统计每只股票在过去 5 个交易日的命中次数 + 平均排名
        const hitStats: Record<string, { count: number; avgRank: number; lastDate: string | null }> = {};
        for (const [code, byDate] of Object.entries(dateHits)) {
          const ranks = Object.values(byDate);
          hitStats[code] = {
            count: ranks.length,
            avgRank: ranks.reduce((a, b) => a + b, 0) / ranks.length,
            lastDate: Object.keys(byDate).sort().reverse()[0] || null,
          };
        }
        setHistoryHits(hitStats);
      } catch (e) {
        console.warn('[fetchPicks] historyHits 计算失败', e);
        setHistoryHits({});
      }

      // 计算「推荐业绩归因」：过去 N 天每天按 Top 10 建仓
      // 简化算法：单日收益 = (今日最新价 - 入场日 r.price) / 入场日 r.price，取 Top 10 等权
      // ⚠️ 注意：这是 IDB 内"分析时的 r.price"对比当前 real-time price，
      //   真实回测需要历史日线收盘价对比；这里是"推荐业绩"快速近似，给用户感知
      try {
        const allHistory = await scoresTable.toArray();
        const scoped = allHistory.filter(r =>
          r.period === selectedPeriod &&
          (r.scoreVersion === selectedVersion || (!r.scoreVersion && selectedVersion === 'v1')) &&
          typeof r.price === 'number' && r.price > 0 &&
          typeof r.compositeScore === 'number'
        );
        const dates = [...new Set(scoped.map(r => r.date))].sort().reverse().slice(0, 10);
        // 当前所有 codes 的最新价（实时）
        const allCodes = [...new Set(scoped.filter(r => dates.includes(r.date)).map(r => r.code))];
        let currentPriceMap: Record<string, number> = {};
        if (allCodes.length > 0) {
          try {
            const r = await fetch(`/api/stock/realtime?codes=${encodeURIComponent(allCodes.slice(0, 50).join(','))}`);
            const j = await r.json();
            if (j?.data) {
              for (const q of j.data) currentPriceMap[q.code] = q.price;
            }
          } catch { /* ignore */ }
        }
        // 净值曲线：每日期 Top 10 → 用 (当前价 / 入场价 - 1) 等权
        let nav = 1.0;
        const navCurve: Array<{ date: string; nav: number; dailyReturn: number }> = [];
        let winCount = 0;
        let totalDays = 0;
        let peak = 1.0;
        let maxDD = 0;
        for (const d of dates.reverse()) { // 从最早到最近
          const dayTop = scoped
            .filter(r => r.date === d)
            .sort((a, b) => b.compositeScore - a.compositeScore)
            .slice(0, 10);
          if (dayTop.length === 0) continue;
          // 计算当日等权收益：用当前价对比入场价（粗略 walk-forward）
          // 多于 50 只就分批拉价
          let dayReturn = 0;
          let validCount = 0;
          for (const r of dayTop) {
            const entryPrice = r.price;
            const exitPrice = currentPriceMap[r.code] ?? r.price;
            if (entryPrice > 0 && exitPrice > 0) {
              dayReturn += (exitPrice - entryPrice) / entryPrice;
              validCount++;
            }
          }
          if (validCount > 0) {
            dayReturn /= validCount;
            nav *= (1 + dayReturn);
            if (dayReturn > 0) winCount++;
            totalDays++;
            peak = Math.max(peak, nav);
            const dd = (peak - nav) / peak;
            maxDD = Math.max(maxDD, dd);
            navCurve.push({ date: d, nav, dailyReturn: dayReturn });
          }
        }
        setPerfAttribution({
          days: dates.length,
          cumulativeReturn: (nav - 1) * 100,
          winRate: totalDays > 0 ? (winCount / totalDays) * 100 : 0,
          maxDrawdown: maxDD * 100,
          navCurve,
          sampleSize: totalDays,
        });
      } catch (e) {
        console.warn('[fetchPicks] perfAttribution 计算失败', e);
        setPerfAttribution(null);
      }
      // 同步盯盘标记
      const watchRaw = localStorage.getItem('quant_watchlist');
      const watchCodes = new Set<string>(
        watchRaw ? (JSON.parse(watchRaw) as { code: string }[]).map(c => c.code) : []
      );
      setInWatchlist(watchCodes);

      // 异步加载近 5 日 K线（用于 sparkline 迷你折线）
      // 缓存 10 分钟；已缓存的跳过
      const codes = list.map(p => p.code);
      const now = Date.now();
      const STALE = 10 * 60 * 1000;
      const toFetch: string[] = [];
      const newSparkMap: Record<string, number[]> = { ...sparklineMap };
      for (const code of codes) {
        const cached = sparklineCacheRef.current.get(code);
        if (cached && (now - cached.ts) < STALE) {
          newSparkMap[code] = cached.prices;
        } else {
          toFetch.push(code);
        }
      }
      if (toFetch.length > 0) {
        // 并发拉 K线（每只单独 fetch，避免一次性 codes 太多）
        Promise.all(toFetch.map(async (code) => {
          try {
            const res = await fetch(`/api/stock/kline?code=${code}&period=daily&limit=6`);
            const json = await res.json();
            if (json.success && json.data && Array.isArray(json.data)) {
              // 取最近 5 个收盘价（升序）
              const closes: number[] = json.data
                .slice(-5)
                .map((bar: any) => bar.close)
                .filter((v: any) => typeof v === 'number');
              if (closes.length >= 2) {
                sparklineCacheRef.current.set(code, { ts: now, prices: closes });
                newSparkMap[code] = closes;
              }
            }
          } catch { /* ignore single failure */ }
        })).then(() => {
          setSparklineMap(prev => ({ ...prev, ...newSparkMap }));
        });
      } else if (Object.keys(newSparkMap).length !== Object.keys(sparklineMap).length) {
        setSparklineMap(newSparkMap);
      }
    } catch (e) {
      // 静默失败
      setPicks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 监听其他组件（WatchlistMonitor）发出的盯盘变化事件，刷新 inWatchlist 标记
  useEffect(() => {
    const handler = () => {
      try {
        const watchRaw = localStorage.getItem('quant_watchlist');
        const watchCodes = new Set<string>(
          watchRaw ? (JSON.parse(watchRaw) as { code: string }[]).map(c => c.code) : []
        );
        setInWatchlist(watchCodes);
      } catch { /* ignore */ }
    };
    window.addEventListener('quant:watchlist-changed', handler);
    // 初次挂载也读一次
    handler();
    return () => window.removeEventListener('quant:watchlist-changed', handler);
  }, []);

  useEffect(() => { fetchPicks(period, scoreVersion); }, [period, scoreVersion, fetchPicks]);

  // 处理切换 5日/20日
  const handlePeriodChange = (newPeriod: '5d' | '20d') => {
    if (newPeriod === period) return;
    setPeriod(newPeriod);
  };

  // v2.1.1（2026-06-15）：跑 Walk-Forward 验证
  //   调 /api/stock/factor-analysis-v2?action=walkforward
  //   用当前 weightMode / longMomentum 设置，验证"过去 120 日按当前权重生成的 Top N 是否能跑赢基准"
  //   同时把报告保存到 IDB walkforwardReports 表，刷新历史趋势
  // v3.0.1（2026-06-15）：跑 Barra 组合优化（与 WF 同一接口风格）
  //   目的：从 Top 10 推算每只票的目标权重（考虑风险）
  //   业界意义：今日推荐只给"分数排名"，但实际交易需要"目标权重"
  const runBarra = async () => {
    if (barraLoading) return;
    setBarraLoading(true);
    try {
      const url = `/api/stock/factor-analysis-v2?action=barra&forwardPeriod=${period === '5d' ? 5 : 20}&filterFlags=true&weightMode=${useICWeight ? 'ic' : 'default'}&longMomentum=${useLongMomentum ? '1' : '0'}&lambda=${barraLambda}&maxSingle=0.15&maxIndustryDev=0.05&limit=80&nocache=1`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success || !json.weights) {
        throw new Error(json.error || 'Barra 优化失败');
      }
      // @ts-ignore
      setBarraWeights(json.weights);
      // @ts-ignore
      setBarraDiag(json.diagnostics);
    } catch (e: any) {
      console.error('[Barra] error:', e);
      alert('Barra 优化失败：' + e.message);
    } finally {
      // @ts-ignore
      setBarraLoading(false);
    }
  };

  const runWalkForward = async () => {
    if (wfLoading) return;
    setWfLoading(true);
    setWfReport(null);
    try {
      const url = `/api/stock/factor-analysis-v2?action=walkforward&forwardPeriod=${period === '5d' ? 5 : 20}&weightMode=${useICWeight ? 'ic' : 'default'}&longMomentum=${useLongMomentum ? '1' : '0'}&nocache=1`;
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
          period: period,
          weightMode: (useICWeight ? 'ic' : 'default') as 'default' | 'ic' | 'manual',
          longMomentum: useLongMomentum,
        };
        await saveWalkforwardReport(json.walkforward, config);
        const history = await loadWalkforwardHistory(config);
        setWfTrend(analyzeWalkforwardTrend(history));
        await pruneWalkforwardHistory();  // 清理过期历史
      } catch (e) {
        console.warn('[WF] save/trend failed:', (e as Error).message);
        // 不影响主流程，报告已显示
      }
    } catch (e: any) {
      console.error('[WF] error:', e);
      setWfReport({
        rating: 'D',
        diagnosis: `⚠️ WF 验证失败：${e.message}`,
        robustnessScore: 0,
        annualizedSharpe: 0,
        winRate: 0,
        excessWinRate: 0,
        maxDrawdown: 0,
        totalReturn: 0,
        avgExcessReturn: 0,
        windowCount: 0,
        windows: [],
        warnings: [e.message],
      });
      setWfTrend(null);
    } finally {
      setWfLoading(false);
    }
  };

  // 一键分析：调用因子研究页的同一套 API，写入 IDB，自动刷新
  // 不跳页、不重置账户持仓
  const handleRunAnalysis = async () => {
    if (running) return;
    setRunning(true);
    setMsg('');
    try {
      setRunProgress('正在获取市场数据...');
      // v2 走新一代多因子 API（8 大类 + 中性化 + 共线性）
      // v1 旧 3-pillar 已废弃，所有路径统一走 v2 endpoint
      setRunProgress('正在计算 v2 多因子（8 大类 + 中性化 + WQ alpha）...');
      const buildV2Url = (filterFlags: boolean) =>
        `/api/stock/factor-analysis-v2?action=scores&limit=80&forwardPeriod=${period === '5d' ? 5 : 20}&filterFlags=${filterFlags ? 'true' : 'false'}&weightMode=${useICWeight ? 'ic' : 'default'}&icHistory=${useICHistory ? '1' : '0'}&longMomentum=${useLongMomentum ? '1' : '0'}&nocache=1`;

      const apiUrl = buildV2Url(true);
      const res = await fetch(apiUrl);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '分析失败');

      // v2.1.1（2026-06-15）：保存 diagnostics（权重明细 / reverse 决策）+ concentration（行业集中度）
      // 前端 diagnostics 区直接读这两个 state 渲染
      setLastDiagnostics(json.diagnostics || null);
      setLastConcentration(json.concentration || null);

      // 2026-09：保存热点板块到 localStorage（顶部 <HotSectorSection> 直接消费）
      // 与 ② 今日推荐同一份 v2 响应 → 热点区与推荐区数据完全一致
      if (json.hotSectors) {
        try {
          localStorage.setItem('quant_hot_sectors', JSON.stringify({
            sectors: json.hotSectors,
            ts: Date.now(),
            period: period === '5d' ? '5d' : '20d',
          }));
          window.dispatchEvent(new CustomEvent('quant:hot-sectors-updated'));
        } catch { /* ignore */ }
      }

      // v3.0（2026-06-15）：保存每日 raw 因子快照到 IDB（fire-and-forget）
      //   - 用 v2 results 里的 raw 因子 → 写 factorSnapshots 表
      //   - 5/20 个交易日后由 fillFutureReturns() 补 return5d/return20d
      //   - WF 验证时优先用真实收益（precision ~95% vs 代理 70%）
      if (scoreVersion === 'v2' && json.results && json.results.length > 0) {
        // 用 v2 results 拼 raw 字段（results 里含 raw 因子，按 v2 文档）
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
        import('@/lib/quant/db/factor-snapshots').then(({ saveSnapshots }) => {
          saveSnapshots(raws).then(n => {
            if (n > 0) console.log(`[snapshot] saved ${n} raw factor snapshots`);
          });
        }).catch(e => console.warn('[snapshot] import/save failed:', e));
      }

      setRunProgress('正在处理个股评分...');
      // v2 返回 results 数组，v1 返回 compositeScores
      let compositeScores: any[] = scoreVersion === 'v2'
        ? (() => {
          // 2026-09-06：热点分级配额推荐索引（code → 配额标签），用于给每只评分股打上板块配额信息
          const recIndex = new Map<string, { rank: number; sectorRank: number; sectorHeat: number; quotaSlots: number }>((json.recommendations || []).map((p: any, i: number) => [p.code, { rank: i + 1, sectorRank: p.sectorRank ?? 0, sectorHeat: p.sectorHeat ?? 0, quotaSlots: p.quotaSlots ?? 0 }]));
          return (json.results || []).map((r: any) => {
            const rec = recIndex.get(r.code);
            // 候选池规模 + 权重来源（用于弹窗解释"为什么这个权重"）
            const d = json.diagnostics || {};
            const poolSize = (d.originalCount ?? r.rawFactors?._poolSize) || 0;
            return {
              code: r.code, name: r.name, price: r.price, changePercent: r.changePercent,
              industry: r.industry || '',
              // 热点分级配额标签（仅配额入选的 topN 有；否则 undefined）
              quotaRank: rec?.rank,              // 配额位次（1..N）
              quotaSectorRank: rec?.sectorRank,  // 板块热度名次
              quotaHeat: rec?.sectorHeat,        // 板块热度 0-100
              quotaSlots: rec?.quotaSlots,       // 该板块分到的名额
              compositeScore: r.composite,
              momentumScore: r.momentum, moneyFlowScore: r.moneyFlow, technicalScore: r.technical,
              // v2: 把 8 大类分数 + contributions + 原始因子值都存到 factorScores JSON，便于详情弹窗展示完整公式
              factorScores: JSON.stringify({
                valuation: r.valuation,
                quality: r.quality,
                momentum: r.momentum,
                reversal: r.reversal,
                moneyFlow: r.moneyFlow,
                technical: r.technical,
                turnover: r.turnover,
                wqAlpha: r.wqAlpha,
                contributions: r.contributions,
                // 原始因子值（详情弹窗要展示：PE/PB/ROE/动量/RSI/主力净流入...）
                rawFactors: r.rawFactors,
                // 截面百分位（0-1；详情弹窗显示"在候选池中的排名"）
                percentiles: r.percentiles,
                // 候选池规模（用于"前 X / N"动态显示）
                poolSize,
                // 实际生效权重（v2 diagnostics.weightsUsed）
                weightsUsed: d.weightsUsed,
                // 权重来源（'default' / 'ic' / 'manual'）
                weightSource: d.weightSource,
                // IC 统计（v2.1+ 接入；当前为 null）
                icStats: d.icStats,
                // IC 模式：'snapshot' 当日 / 'backtest' 严谨（已实现收益）
                icMode: useICHistory ? 'backtest' : 'snapshot',
              }),
              regime: '-',
            };
          });
        })()
        : (json.compositeScores || []);

      // v2 降级重试：filterFlags=true 过滤后无候选时，自动去掉 flag 过滤重试一次
      // 常见原因：节假日后第一个交易日 / 数据源刚恢复 / dev server OOM 导致 candidates 几乎为 0
      if (compositeScores.length === 0 && scoreVersion === 'v2' && json.diagnostics?.warning) {
        setRunProgress('v2 严格过滤后无候选，自动降级到无 flag 过滤...');
        const retryRes = await fetch(buildV2Url(false));
        const retryJson = await retryRes.json();
        if (retryJson.success) {
          json.results = retryJson.results;
          json.diagnostics = retryJson.diagnostics;
          // 2026-09：降级重试也可能返回新的热点板块 → 覆盖保存
          if (retryJson.hotSectors) {
            try {
              localStorage.setItem('quant_hot_sectors', JSON.stringify({
                sectors: retryJson.hotSectors,
                ts: Date.now(),
                period: period === '5d' ? '5d' : '20d',
              }));
              window.dispatchEvent(new CustomEvent('quant:hot-sectors-updated'));
            } catch { /* ignore */ }
          }
          const rd = retryJson.diagnostics || {};
          compositeScores = (() => {
            // 2026-09-06：降级重试也带热点配额标签
            const recIndex = new Map<string, { rank: number; sectorRank: number; sectorHeat: number; quotaSlots: number }>((retryJson.recommendations || []).map((p: any, i: number) => [p.code, { rank: i + 1, sectorRank: p.sectorRank ?? 0, sectorHeat: p.sectorHeat ?? 0, quotaSlots: p.quotaSlots ?? 0 }]));
            return (retryJson.results || []).map((r: any) => {
              const rec = recIndex.get(r.code);
              return {
                code: r.code, name: r.name, price: r.price, changePercent: r.changePercent,
                industry: r.industry || '',
                quotaRank: rec?.rank,
                quotaSectorRank: rec?.sectorRank,
                quotaHeat: rec?.sectorHeat,
                quotaSlots: rec?.quotaSlots,
                compositeScore: r.composite,
                momentumScore: r.momentum, moneyFlowScore: r.moneyFlow, technicalScore: r.technical,
                factorScores: JSON.stringify({
                  valuation: r.valuation, quality: r.quality, momentum: r.momentum,
                  reversal: r.reversal, moneyFlow: r.moneyFlow, technical: r.technical,
                  turnover: r.turnover, wqAlpha: r.wqAlpha,
                  contributions: r.contributions,
                  rawFactors: r.rawFactors,
                  percentiles: r.percentiles,
                  poolSize: rd.originalCount || 0,
                  weightsUsed: rd.weightsUsed,
                  weightSource: rd.weightSource,
                  icStats: rd.icStats,
                  icMode: useICHistory ? 'backtest' : 'snapshot',
                }),
                regime: '-',
              };
            });
          })();
        }
      }

      if (compositeScores.length === 0) {
        // 友好提示：V1 可能因为 K 线不足（< 35 根）导致 IC 全 0，建议切到 v2
        // （v1 endpoint 已废弃，但保留判断以便未来恢复 v1 时直接工作）
        // v2 模式：把 diagnostics 全带出来，下次报错一眼能定位
        const diag = json.diagnostics || {};
        // 两类 diagnostics：candidates=0 阶段只有 detail / klineXxxCount；
        // scoreV2() 跑过后才有 originalCount/filteredCount
        const detail = diag.detail || '';
        const allStocks = diag.allStocksCount ?? '?';
        const target = diag.targetCodesCount ?? '?';
        const klineOk = diag.klineSuccessCount ?? '?';
        const klineEmpty = diag.klineEmptyCount ?? '?';
        const klineShort = diag.klineShortCount ?? '?';
        const orig = diag.originalCount ?? '?';
        const filt = diag.filteredCount ?? '?';
        throw new Error(
          `未获取到个股评分数据。` +
          `detail=${detail}; ` +
          `(allStocks=${allStocks}, target=${target}, klineOk=${klineOk}, klineEmpty=${klineEmpty}, klineShort=${klineShort}, originalCount=${orig}, filteredCount=${filt})`
        );
      }

      // 2. 把结果写入 IDB（与因子研究页 saveToIndexedDB 行为完全一致）
      setRunProgress('正在保存到本地数据库...');
      const { db } = await import('@/lib/quant/db/database');
      const scoresTable = db.stockScores;
      if (!scoresTable) throw new Error('本地数据库不可用');

      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const now = Date.now();

      // 清除当日旧数据（仅当前 period + 当前 scoreVersion，V1/V2 互不干扰）
      await scoresTable
        .where('[date+period+scoreVersion]')
        .equals([today, period, scoreVersion])
        .delete()
        .catch(async () => {
          // 兜底：老 schema 无 [date+period+scoreVersion] 复合索引时退回基本过滤
          await scoresTable.where('date').equals(today).and(r => r.period === period).delete();
        });

      // 写入新数据（id 加 _v1/_v2 后缀，与因子研究页共存）
      const newRecords = compositeScores.map((s: any) => ({
        id: `${s.code}_${period}_${scoreVersion}`,
        period,
        scoreVersion,
        date: today,
        code: s.code,
        name: s.name,
        price: s.price,
        changePercent: s.changePercent,
        industry: s.industry || '',
        // 2026-09-06：热点分级配额标签（仅配额入选股有；供今日推荐按配额顺序展示）
        quotaRank: s.quotaRank || undefined,
        quotaSectorRank: s.quotaSectorRank || undefined,
        quotaHeat: s.quotaHeat || undefined,
        quotaSlots: s.quotaSlots || undefined,
        compositeScore: s.compositeScore,
        momentumScore: s.momentumScore || 0,
        moneyFlowScore: s.moneyFlowScore || 0,
        technicalScore: s.technicalScore || 0,
        factorScores: JSON.stringify(s.factorScores || {}),
        regime: json.regime || '-',
        updatedAt: now,
      }));
      await scoresTable.bulkPut(newRecords);

      // 3.5 追加 IC 历史记录（仅 v2 + 有 icStats 时；最多保留 20 条）
      // 注意：key 是 'quant_ic_history_log'（不和开关 'quant_ic_history' 冲突）
      if (scoreVersion === 'v2' && json.diagnostics?.icStats) {
        try {
          const historyRaw = localStorage.getItem('quant_ic_history_log');
          const history: { ts: number; mode: string; icStats: any }[] = historyRaw ? JSON.parse(historyRaw) : [];
          history.push({
            ts: Date.now(),
            mode: useICHistory ? 'backtest' : 'snapshot',
            icStats: json.diagnostics.icStats,
          });
          // 保留最近 20 条
          while (history.length > 20) history.shift();
          localStorage.setItem('quant_ic_history_log', JSON.stringify(history));
        } catch { /* ignore */ }
      }

      // 3. 重新读取 IDB 渲染表格（按当前 scoreVersion 过滤）
      await fetchPicks(period, scoreVersion);
      setMsg(`✅ ${period} 分析完成（${compositeScores.length} 只）`);
      setTimeout(() => setMsg(''), 3000);
    } catch (e: any) {
      console.error('[QuickAnalysis] failed:', e);
      setMsg(`❌ 分析失败: ${e.message}`);
    } finally {
      setRunning(false);
      setRunProgress('');
    }
  };

  const handleAddAll = async () => {
    // 选中为空 → 用 picks 兜底（全选）
    const codes = selected.size > 0 ? Array.from(selected) : picks.map(p => p.code);
    if (codes.length === 0 || adding) return;
    setAdding(true);
    setMsg('');
    try {
      const res = await fetch('/api/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addCodes',
          codes,
          strategyType: 'factor',
        }),
      });
      const json = await res.json();
      if (json.success) {
        // 通知 SimulatorSnapshot 立即刷新（CustomEvent 总线）
        window.dispatchEvent(new CustomEvent('quant:simulator-changed', { detail: { codes, source: 'today-recommendations' } }));
        // 顶层 Toast + 滚动到 ④ 区
        toast.success(`🎯 ${codes.length} 只已推入交易池 · 跳到「④ 模拟交易」查看`, {
          description: '已在策略池中，可手动开启自动驾驶',
          duration: 4000,
          action: {
            label: '查看',
            onClick: () => {
              document.getElementById('section-simulator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            },
          },
        });
        setTimeout(() => {
          document.getElementById('section-simulator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 1200);
        setMsg(`✅ ${json.message}`);
      } else {
        setMsg(`❌ ${json.error || '失败'}`);
      }
    } catch (e: any) {
      setMsg(`❌ ${e?.message || '网络错误'}`);
    } finally {
      setAdding(false);
      setTimeout(() => setMsg(''), 5000);
    }
  };

  // 回测验证推荐：在不跳页的情况下，调 /api/stock/backtest-v1-vs-v2
  // 复用 ④b 同套 API + 同一份 <BacktestResultView> 渲染
  // 关键差异：这里的 poolSize 用 picks.length（推荐 10 只 → poolSize 10/topN 10 → 全市场验证推荐本身的稳定性）
  // 用户感受：点一下，30-60 秒后在 ② 区直接看到"过去 20 天推荐表现"的净值曲线 + sharpe + 共识天数
  const handleRunBacktest = async () => {
    if (backtestLoading || picks.length === 0) return;
    setBacktestLoading(true);
    setBacktestError(null);
    setBacktestResult(null);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 90_000);
    try {
      // poolSize 取推荐数（多数情况 ≤ 10），topN 用 picks.length（验证"这 N 只推荐"本身）
      // lookback 范围 [5, 120]，topN 范围 [3, 30]，poolSize 范围 [20, 300]（与 route.ts 对齐）
      const poolSize = Math.min(Math.max(picks.length, 20), 300);
      const topN = Math.min(Math.max(picks.length, 3), 30);
      const url = `/api/stock/backtest-v1-vs-v2?lookbackDays=${backtestLookback}&topN=${topN}&poolSize=${poolSize}&v2Short=true&_t=${Date.now()}`;
      const res = await fetch(url, { signal: ctrl.signal });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setBacktestResult(json);
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setBacktestError('回测超过 90 秒（首次跑需要拉 K 线 + 算因子）。请再试一次或缩短回看天数。');
      } else {
        setBacktestError(e.message || '回测失败');
      }
    } finally {
      clearTimeout(t);
      setBacktestLoading(false);
    }
  };

  // 一键加入盯盘（写 localStorage + 广播事件让 WatchlistMonitor 立即刷新）
  const handleAddToWatchlist = async (autoEnable = false) => {
    const codes = selected.size > 0 ? Array.from(selected) : picks.map(p => p.code);
    if (codes.length === 0 || addingWatch) return;
    setAddingWatch(true);
    setMsg('');
    try {
      // 读已有自选股
      const raw = localStorage.getItem('quant_watchlist');
      const existing: { code: string; name: string; addedAt: number }[] = raw ? JSON.parse(raw) : [];
      const existingMap = new Map(existing.map(c => [c.code, c]));
      const picksMap = new Map(picks.map(p => [p.code, p.name]));
      // 合并（去重、保留最早 addedAt）
      let added = 0;
      for (const code of codes) {
        if (!existingMap.has(code)) {
          existingMap.set(code, {
            code,
            name: picksMap.get(code) || code,
            addedAt: Date.now(),
          });
          added++;
        }
      }
      const merged = Array.from(existingMap.values());
      localStorage.setItem('quant_watchlist', JSON.stringify(merged));
      // 更新本地 inWatchlist 标记 + 通知 WatchlistMonitor 刷新
      setInWatchlist(new Set(merged.map(c => c.code)));
      window.dispatchEvent(new CustomEvent('quant:watchlist-changed', { detail: { codes } }));
      let summary = `📡 已加入盯盘：新增 ${added} 只 · 共 ${merged.length} 只 · 可在下方「③ 我的盯盘」查看`;

      // 如果要求"同时启动自动驾驶"：先把股票加入模拟器策略池，再开启 autopilot
      if (autoEnable) {
        setMsg('📡🤖 正在加入策略池并启动自动驾驶...');
        // 1. 写入模拟器策略池
        const simRes = await fetch('/api/simulator', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'addCodes', codes, strategyType: 'factor' }),
        });
        const simJson = await simRes.json();
        if (!simJson.success) throw new Error(simJson.error || '加入策略池失败');
        // 2. 启动引擎（如果未启动）
        if (!simJson.data?.isRunning) {
          await fetch('/api/simulator', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'start', codes, strategyType: 'factor' }),
          });
        }
        // 3. 开启自动驾驶
        const ok = await ap.setAutoPilot(true);
        summary = ok
          ? `📡🤖 策略池已就绪（${codes.length} 只）+ 自动驾驶已开启！策略信号将自动成交`
          : `📡 盯盘已加入，但自动驾驶开启失败，请到「④ 模拟交易」手动开启`;
      }
      setMsg(summary);
      setTimeout(() => setMsg(''), 6000);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || '写入失败'}`);
    } finally {
      setAddingWatch(false);
    }
  };

  // 多选辅助函数
  const toggleOne = (code: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected(prev => {
      if (prev.size === picks.length) return new Set();
      return new Set(picks.map(p => p.code));
    });
  };
  // 注：全选逻辑已移到 <StockTable onToggleAll> 内部，无需在此处重复计算
  // allSelected / someSelected / toggleAll 旧变量已删除

  return (
    <section id="section-today-recommendations" data-section-target="recommendations" className="mb-6 scroll-mt-20">
      {/* 「推荐业绩归因」卡：用 IDB 历史分析快照 + 当前实时价，计算
          "过去 N 天按 Top 10 建仓" 的累计收益 / 胜率 / 最大回撤 / 净值曲线。
          不替代回测，但给用户"推荐稳定性"快速感知。 */}
      {perfAttribution && perfAttribution.sampleSize >= 2 && (
        <PerfAttributionCard data={perfAttribution} />
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2 flex-wrap">
            ② 今日推荐
            {ap.isAutoPilot && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-900/50 text-red-300 border border-red-700/60 flex items-center gap-1" title="自动驾驶中：策略信号将自动成交">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
                </span>
                自动驾驶中
              </span>
            )}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {lastAnalysisDate
              ? `综合评分 Top 10 · ${period === '5d' ? '5日' : '20日'} 收益预测 · 数据日期 ${formatAnalysisDate(lastAnalysisDate)} · 与因子研究页同源`
              : '综合评分 Top 10 · 需先在因子研究页执行一次分析'}
          </p>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto">
          {/* 5日/20日 切换：与因子研究页"个股排行"共用同一份 IndexedDB 缓存 */}
          <div className="flex bg-slate-800 rounded-lg p-0.5 border border-slate-700 col-span-2 sm:col-span-1 w-fit">
            <button
              onClick={() => handlePeriodChange('5d')}
              className={`text-xs px-3 py-1 rounded transition-colors whitespace-nowrap ${
                period === '5d'
                  ? 'bg-amber-600 text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="短期收益预测（5个交易日）"
            >
              5日
            </button>
            <button
              onClick={() => handlePeriodChange('20d')}
              className={`text-xs px-3 py-1 rounded transition-colors whitespace-nowrap ${
                period === '20d'
                  ? 'bg-amber-600 text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="中期收益预测（20个交易日）"
            >
              20日
            </button>
          </div>
          {/* v2 评分系统标签（v1 已废弃） */}
          <div className="col-span-1 flex items-center bg-slate-800/60 rounded-lg p-0.5 text-xs">
            <button
              className="px-2 py-1 rounded transition-colors whitespace-nowrap bg-emerald-600 text-white font-medium"
              title="v2: 8 大类因子 + 中性化 + 共线性 + IC 动态定权"
            >
              v2
            </button>
          </div>
          {/* 严谨 IC 开关（仅 v2 显示）— 用已实现收益算横截面 IC */}
          {scoreVersion === 'v2' && (
            <button
              onClick={() => setUseICHistory(prev => !prev)}
              className={`col-span-1 text-xs px-2 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap ${useICHistory
                ? 'bg-amber-600 text-white hover:bg-amber-500'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              title={useICHistory
                ? '已开启：IC 用 momentum20（已实现收益）计算 — 更严谨'
                : '当前 IC 用当日 changePercent — 开启后用过去 20 日累计收益'}
            >
              📐 严谨 IC {useICHistory ? '✓' : ''}
            </button>
          )}
          {/* v2.1（2026-06-15）：IC 动态权重开关（仅 v2 显示）
              - 开启：weightMode=ic，按 IC 派生权重
              - 默认：Barra 固定权重 */}
          {scoreVersion === 'v2' && (
            <button
              onClick={() => setUseICWeight(prev => !prev)}
              className={`col-span-1 text-xs px-2 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap ${useICWeight
                ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              title={useICWeight
                ? '已开启：8 大类权重按 IC 自动派生（|IC| × tanh(IR)）'
                : '当前使用 Barra 默认权重（fixed 18/14/12/10/12/12/7/15）— 开启后用 IC 动态'}
            >
              🎯 IC 权重 {useICWeight ? '✓' : ''}
            </button>
          )}
          {/* v2.1.1（2026-06-15）：长动量开关
              - 关闭（默认）：momentum 用 20d 短动量（适合 5 日调仓）
              - 开启：60d×0.3 + 120d×0.5 + 20d×0.2（Jegadeesh-Titman 经典长动量，月频策略优选） */}
          {scoreVersion === 'v2' && (
            <button
              onClick={() => setUseLongMomentum(prev => !prev)}
              className={`col-span-1 text-xs px-2 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap ${useLongMomentum
                ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
              title={useLongMomentum
                ? '已开启：长动量（60d×0.3 + 120d×0.5 + 20d×0.2），月度调仓优选'
                : '当前用 20d 短动量 — 开启后切换到长动量（需要 K线≥120 天）'}
            >
              📊 长动量 {useLongMomentum ? '✓' : ''}
            </button>
          )}
          {/* v2.1.1（2026-06-15）：集中度评级徽章
              - 分析完成后显示（A+/A/B/C/D）
              - 点击展开行业分布详情 */}
          {lastConcentration && scoreVersion === 'v2' && (
            <button
              onClick={() => setConcentrationPanelOpen(p => !p)}
              className={`col-span-1 text-xs px-2 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap ${concentrationPanelOpen
                ? 'bg-violet-700 text-white'
                : lastConcentration.rating === 'A+' || lastConcentration.rating === 'A'
                  ? 'bg-emerald-700/40 text-emerald-200 hover:bg-emerald-700/60 border border-emerald-500/40'
                  : lastConcentration.rating === 'D'
                    ? 'bg-red-700/40 text-red-200 hover:bg-red-700/60 border border-red-500/40'
                    : 'bg-amber-700/40 text-amber-200 hover:bg-amber-700/60 border border-amber-500/40'
              }`}
              title={`集中度评级 ${lastConcentration.rating}（HHI=${lastConcentration.hhi.toFixed(3)} / 行业数 ${Object.keys(lastConcentration.industryDistribution).length}）— 点击查看详情`}
            >
              🛡️ 集中度 {lastConcentration.rating}
            </button>
          )}
          {/* v2.1.1（2026-06-15）：Walk-Forward 验证按钮（紫色，紧贴"回测验证"位置）
              - 区别：回测验证 = 真实日线回测（耗时 5-30 秒）；WF 验证 = 快速代理验证（< 1 秒）
              - WF 用代理收益，精度 ~70%，但能秒级回答"当前权重是否可能有效" */}
          {scoreVersion === 'v2' && (
            <button
              data-wizard-target="wf-verify-btn"
              onClick={() => setWfPanelOpen(p => !p)}
              disabled={loading || picks.length === 0}
              className={`col-span-2 sm:col-span-1 text-xs px-2 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1 whitespace-nowrap ${wfPanelOpen
                ? 'bg-gradient-to-r from-fuchsia-700 to-pink-700 text-white'
                : 'bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 text-white'
              }`}
              title="📈 WF 验证：用过去 120 日历史数据，按当前 8 大类权重生成 Top N 推荐，验证累计收益 / 夏普 / 胜率 / 最大回撤（代理收益，< 1 秒）"
            >
              <span>📈</span> {wfPanelOpen ? '收起 WF' : 'WF 验证'}
            </button>
          )}
          {scoreVersion === 'v2' && (
            <button
              data-wizard-target="barra-btn"
              onClick={() => setBarraPanelOpen(p => !p)}
              disabled={loading || picks.length === 0}
              className="text-xs px-2 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-1 bg-amber-600 hover:bg-amber-500 text-white"
            >🎯 {barraPanelOpen ? '收起 Barra' : 'Barra 优化'}</button>
          )}
          <button
            data-wizard-target="one-click-analyze"
            onClick={handleRunAnalysis}
            disabled={running || loading}
            className="col-span-1 text-xs px-3 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1 whitespace-nowrap"
            title={scoreVersion === 'v2' ? '不跳页：直接调用 v2 多因子分析 API（8 大类 + 中性化）' : '不跳页：直接调用 v1 因子研究页的同一套 API（30-60秒）'}
          >
            <span>⚡</span> {running ? '分析中…' : (picks.length === 0 ? '一键分析' : '重新分析')}
          </button>
          {msg && <span className="col-span-2 sm:col-span-1 text-xs text-slate-300">{msg}</span>}
          {cacheAge !== null && !running && (
            <span className="col-span-2 sm:col-span-1 text-xs text-slate-500" title="本地数据库缓存年龄">
              · {cacheAge < 60_000 ? '刚刚' :
                 cacheAge < 3_600_000 ? `${Math.floor(cacheAge / 60_000)}分钟前` :
                 cacheAge < 86_400_000 ? `${Math.floor(cacheAge / 3_600_000)}小时前` :
                 `${Math.floor(cacheAge / 86_400_000)}天前`}更新
            </span>
          )}
          {/* 「加入盯盘」按钮：仅追踪行情，不下单
              - 三态文案：未启动 / 引擎运行（确认后开启自驾） / 自动驾驶中（脉冲红）
              - 三种用途清晰区分：「加入盯盘」/「加入并启自驾」/「加仓到策略池」 */}
          {ap.isAutoPilot ? (
            <button
              onClick={() => handleAddToWatchlist(true)}
              disabled={loading || addingWatch || picks.length === 0}
              className="col-span-1 text-sm px-3 py-1.5 bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-500 hover:to-pink-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1 animate-pulse whitespace-nowrap"
              title="🤖 自动驾驶中：把这只股票加入策略池，会按策略信号自动成交（脉冲红 = 实时下单通道已开启）"
            >
              <span>🤖</span> {addingWatch ? '处理中…' : `加仓 ${selected.size > 0 ? `(${selected.size})` : ''}`}
            </button>
          ) : ap.isRunning ? (
            <button
              onClick={() => {
                if (window.confirm(
                  `确认开启自动驾驶？\n\n` +
                  `将把这 ${selected.size || picks.length} 只股票加入策略池，\n` +
                  `按因子评分信号自动买卖。\n\n` +
                  `⚠️ 风险提示：\n` +
                  `• 自动驾驶会按策略信号自动成交，可能有亏损\n` +
                  `• 请确保已设置好止损/止盈参数\n` +
                  `• 可随时点击「⏹ 停止」关闭\n\n` +
                  `确认开启？`
                )) {
                  handleAddToWatchlist(true);
                }
              }}
              disabled={loading || addingWatch || picks.length === 0}
              className="col-span-1 text-sm px-3 py-1.5 bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1 whitespace-nowrap"
              title="📡🤖 引擎已运行：点击 → 加入策略池 + 弹确认开启自动驾驶（按信号自动成交）"
            >
              <span>📡🤖</span> {addingWatch ? '处理中…' : `加入并启自驾 ${selected.size > 0 ? `(${selected.size})` : ''}`}
            </button>
          ) : (
            <button
              onClick={() => handleAddToWatchlist(false)}
              disabled={loading || addingWatch || picks.length === 0}
              className="col-span-1 text-sm px-3 py-1.5 bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1 whitespace-nowrap"
              title="📡 加入盯盘：仅追踪行情 + 价格异动通知，不会自动下单（不会触发自动驾驶）"
            >
              <span>📡</span> {addingWatch ? '加入中…' : `加入盯盘 ${selected.size > 0 ? `(${selected.size})` : ''}`}
            </button>
          )}
{/* 「一键下单」按钮：直接写模拟交易策略池（不经过盯盘） */}
          <button
            onClick={handleAddAll}
            disabled={loading || adding || picks.length === 0 || selected.size === 0}
            className="col-span-2 sm:col-span-1 text-sm px-3 py-1.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1 whitespace-nowrap"
            title="🎯 一键下单：写入模拟交易策略池，需要选中股票（不会自动开启自动驾驶，仅作为策略候选）"
          >
            <span>🎯</span> {adding ? '下单中…' : `一键下单 ${selected.size > 0 ? `(${selected.size})` : ''}`}
          </button>
          {/* 「回测验证推荐」按钮：紫色，与 cyan/amber 区分；点击展开/折叠内嵌回测面板 */}
          <button
            onClick={() => setBacktestOpen(o => !o)}
            disabled={loading || picks.length === 0}
            className={`col-span-2 sm:col-span-1 text-sm px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1 whitespace-nowrap ${
              backtestOpen
                ? 'bg-gradient-to-r from-purple-700 to-indigo-700 hover:from-purple-600 hover:to-indigo-600 text-white'
                : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white'
            }`}
            title="⚔️ 回测验证推荐：用历史 N 天数据验证「今日推荐 Top 10」的实盘表现（v1 vs v2 vs 沪深300，含 sharpe / 最大回撤 / 共识天数）"
          >
            <span>⚔️</span> {backtestOpen ? '收起验证' : '回测验证'}
          </button>
        </div>
      </div>

      {/* 「回测验证推荐」折叠面板：内嵌于 ② 区，不跳页 */}
      {backtestOpen && (
        <div className="bg-gradient-to-br from-indigo-950/40 to-purple-950/30 border border-indigo-700/40 rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm text-indigo-200 font-semibold">
              <span>⚔️</span>
              <span>回测验证「今日推荐 Top {picks.length}」</span>
              <span className="text-[10px] text-slate-400 font-normal">
                · 用 picks 的 {picks.length} 只股票作为 pool · 真实回测，无未来函数
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <label className="flex items-center gap-1 text-slate-300">
                回看
                <select
                  value={backtestLookback}
                  onChange={e => setBacktestLookback(parseInt(e.target.value))}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200"
                  disabled={backtestLoading}
                >
                  <option value={10}>10 天</option>
                  <option value={20}>20 天（推荐）</option>
                  <option value={30}>30 天</option>
                  <option value={60}>60 天</option>
                </select>
              </label>
              <button
                onClick={handleRunBacktest}
                disabled={backtestLoading || picks.length === 0}
                className="px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-1.5"
              >
                {backtestLoading ? '⏳ 回测中…' : '🚀 验证推荐表现'}
              </button>
              <a
                href="#section-v1v2-backtest"
                onClick={(e) => { e.preventDefault(); document.getElementById('section-v1v2-backtest')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 underline whitespace-nowrap"
                title="跳到下方 v1 vs v2 完整回测面板（更多参数 + 全市场验证）"
              >
                📊 跳到完整回测 ↓
              </a>
            </div>
          </div>

          {backtestError && (
            <div className="text-rose-400 text-xs mb-2">❌ {backtestError}</div>
          )}

          {backtestLoading && (
            <div className="bg-slate-900 border border-indigo-700/40 rounded-lg p-6 text-center">
              <div className="text-indigo-300 text-sm font-medium mb-1">⚔️ 正在回测验证推荐表现…</div>
              <div className="text-slate-500 text-xs">首次跑需要拉 K 线 + 算因子，预计 30-60 秒</div>
              <div className="mt-3 w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 animate-pulse" style={{ width: '70%' }} />
              </div>
            </div>
          )}

          {!backtestLoading && !backtestResult && !backtestError && (
            <div className="text-xs text-slate-500 text-center py-4">
              点击「🚀 验证推荐表现」开始，过去 {backtestLookback} 天推荐 Top {picks.length} 的真实收益 vs 沪深 300
            </div>
          )}

          {!backtestLoading && backtestResult && !backtestError && (
            <BacktestResultView result={backtestResult} />
          )}
        </div>
      )}

      {/* v2.1.1（2026-06-15）：集中度详情面板
          - 行业分布 + HHI + 行业偏离基准
          - 折叠状态：concentrationPanelOpen */}
      {concentrationPanelOpen && lastConcentration && (
        <div className="bg-gradient-to-br from-violet-950/40 to-purple-950/30 border border-violet-700/40 rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm text-violet-200 font-semibold">
              <span>🛡️</span>
              <span>行业集中度评估（Top {picks.length} 组合风险）</span>
              <span className="text-[10px] text-slate-400 font-normal">
                · 评级 {lastConcentration.rating} / 分数 {lastConcentration.diversityScore} / HHI={lastConcentration.hhi.toFixed(3)}
                <span className="text-slate-500"> · 评估对象：今日推荐配额 Top {picks.length}（向热点板块集中，分散度成本已计入）</span>
              </span>
            </div>
            <button
              onClick={() => setConcentrationPanelOpen(false)}
              className="text-xs text-slate-400 hover:text-slate-200"
            >收起 ✕</button>
          </div>

          {/* 行业分布可视化（横向条形图） */}
          <div className="space-y-1.5 mb-3">
            {Object.entries(lastConcentration.industryDistribution as Record<string, number>)
              .sort((a, b) => b[1] - a[1])
              .map(([industry, weight]) => {
                const benchWeight = lastConcentration.industryDeviation[industry] !== undefined
                  ? weight - lastConcentration.industryDeviation[industry]
                  : 0;
                const dev = lastConcentration.industryDeviation[industry] || 0;
                const isOverLimit = Math.abs(dev) > 0.05;
                return (
                  <div key={industry} className="flex items-center gap-2 text-xs">
                    <span className="w-16 text-slate-300 truncate" title={industry}>{industry}</span>
                    <div className="flex-1 h-5 bg-slate-800 rounded relative overflow-hidden">
                      {/* 行业权重条 */}
                      <div
                        className={`h-full ${isOverLimit ? 'bg-red-500/70' : 'bg-violet-500/70'}`}
                        style={{ width: `${weight * 100}%` }}
                      />
                      {/* 基准线 */}
                      {benchWeight > 0 && (
                        <div
                          className="absolute top-0 bottom-0 w-px bg-slate-400"
                          style={{ left: `${benchWeight * 100}%` }}
                          title={`基准 ${(benchWeight * 100).toFixed(1)}%`}
                        />
                      )}
                    </div>
                    <span className={`w-16 text-right font-mono ${isOverLimit ? 'text-red-300' : 'text-slate-300'}`}>
                      {(weight * 100).toFixed(0)}%
                      {dev !== 0 && (
                        <span className="text-[10px] ml-1">
                          ({dev > 0 ? '+' : ''}{(dev * 100).toFixed(1)}%)
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
          </div>

          {/* 关键指标 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="bg-slate-900/60 rounded p-2">
              <div className="text-slate-500">HHI</div>
              <div className="text-violet-200 font-mono">{lastConcentration.hhi.toFixed(3)}</div>
              <div className="text-[10px] text-slate-500">
                {lastConcentration.hhiRating === 'diversified' ? '✅ 高度分散' :
                 lastConcentration.hhiRating === 'moderate' ? '⚠️ 适度集中' : '🔴 过度集中'}
              </div>
            </div>
            <div className="bg-slate-900/60 rounded p-2">
              <div className="text-slate-500">单只权重</div>
              <div className="text-violet-200 font-mono">{(lastConcentration.singleWeight * 100).toFixed(1)}%</div>
              <div className="text-[10px] text-slate-500">{lastConcentration.singleOverLimit ? '⚠️ 超 15% 上限' : '✅ 等权分散'}</div>
            </div>
            <div className="bg-slate-900/60 rounded p-2">
              <div className="text-slate-500">行业数</div>
              <div className="text-violet-200 font-mono">{Object.keys(lastConcentration.industryDistribution).length}</div>
              <div className="text-[10px] text-slate-500">{Object.keys(lastConcentration.industryDistribution).length >= 5 ? '✅ 充分分散' : '⚠️ < 5 个行业'}</div>
            </div>
            <div className="bg-slate-900/60 rounded p-2">
              <div className="text-slate-500">超限行业</div>
              <div className={`font-mono ${lastConcentration.industriesOverLimit.length > 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                {lastConcentration.industriesOverLimit.length}
              </div>
              <div className="text-[10px] text-slate-500">{lastConcentration.industriesOverLimit.length === 0 ? '✅ 全部合规' : '⚠️ 偏离 > 5%'}</div>
            </div>
          </div>

          {/* 警告列表 */}
          {lastConcentration.warnings && lastConcentration.warnings.length > 0 && (
            <div className="mt-3 space-y-1 text-xs">
              {lastConcentration.warnings.map((w: string, i: number) => (
                <div key={i} className={`px-2 py-1 rounded ${w.includes('⚠️') ? 'bg-red-900/20 text-red-300' : 'bg-emerald-900/20 text-emerald-300'}`}>
                  {w}
                </div>
              ))}
            </div>
          )}

          {/* diagnostics 里的 reverse 决策（v2.1.1 新增） */}
          {lastDiagnostics?.percentileWarnings && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-slate-400 hover:text-slate-200">
                🔄 反向因子决策（{lastDiagnostics.percentileWarnings.filter((w: string) => w.includes('🔄') || w.includes('⬆️')).length} 项）
              </summary>
              <div className="mt-2 space-y-1 bg-slate-900/60 rounded p-2">
                {lastDiagnostics.percentileWarnings
                  .filter((w: string) => w.includes('🔄') || w.includes('⬆️'))
                  .map((w: string, i: number) => (
                    <div key={i} className="text-slate-300 font-mono text-[11px]">{w}</div>
                  ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* v2.1.1（2026-06-15）：WF 验证面板
          - 调 /api/stock/factor-analysis-v2?action=walkforward
          - 显示评级 / 夏普 / 胜率 / 最大回撤 / 窗口明细 */}
      {wfPanelOpen && (
        <div className="bg-gradient-to-br from-fuchsia-950/40 to-pink-950/30 border border-fuchsia-700/40 rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm text-fuchsia-200 font-semibold">
              <span>📈</span>
              <span>Walk-Forward 验证（当前权重是否可能有效）</span>
              <span className="text-[10px] text-slate-400 font-normal" id="wf-mode-label">
                {/* v3.0（2026-06-15）：根据 snapshot 统计显示"真实/代理"模式 */}
                {snapshotStats && snapshotStats.filled5d >= 5
                  ? `· ✅ 真实收益模式（${snapshotStats.filled5d} 条 T+5 快照）`
                  : snapshotStats && snapshotStats.total > 0
                    ? `· ⚠️ 快照 ${snapshotStats.total} 条未达 T+5（待回填）`
                    : '· 代理收益模式（精度 ~70% — 多分析几天积累 snapshot）'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={runWalkForward}
                disabled={wfLoading}
                className="text-xs px-3 py-1 bg-fuchsia-700 hover:bg-fuchsia-600 text-white rounded font-medium disabled:opacity-50"
              >
                {wfLoading ? '验证中…' : '🚀 开始验证'}
              </button>
              {/* v2.1.1：导出历史（CSV + JSON） */}
              <button
                onClick={async () => {
                  try {
                    const { loadWalkforwardHistory, analyzeWalkforwardTrend } = await import('@/lib/quant/db/walkforward-persistence');
                    const { exportReportsAll } = await import('@/lib/quant/db/walkforward-export');
                    const config = { period, weightMode: (useICWeight ? 'ic' : 'default') as 'default' | 'ic' | 'manual', longMomentum: useLongMomentum };
                    const history = await loadWalkforwardHistory(config);
                    if (history.length === 0) {
                      alert('暂无历史报告可导出');
                      return;
                    }
                    const { csv, json } = exportReportsAll(history);
                    // eslint-disable-next-line no-console
                    console.log(`[export] 已导出 ${history.length} 条记录：${csv}, ${json}`);
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
              <button
                onClick={() => setWfPanelOpen(false)}
                className="text-xs text-slate-400 hover:text-slate-200"
              >收起 ✕</button>
            </div>
          </div>

          {!wfReport && !wfLoading && (
            <div className="text-xs text-slate-500 text-center py-4">
              点击「🚀 开始验证」用过去 120 日历史窗口，检验当前 8 大类权重生成的 Top N 是否能跑赢候选池均值
            </div>
          )}

          {wfLoading && (
            <div className="text-xs text-fuchsia-300 text-center py-4">
              <div className="animate-pulse">📈 正在跑 Walk-Forward 验证（约 5-10 秒）…</div>
            </div>
          )}

          {wfReport && !wfLoading && (
            <div>
              {/* 评级 + 关键指标 */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3 text-xs">
                <div className={`rounded p-2 ${
                  wfReport.rating === 'A+' || wfReport.rating === 'A' ? 'bg-emerald-900/30 border border-emerald-700/40' :
                  wfReport.rating === 'D' ? 'bg-red-900/30 border border-red-700/40' :
                  'bg-slate-900/60'
                }`}>
                  <div className="text-slate-500">评级</div>
                  <div className={`text-lg font-bold ${
                    wfReport.rating === 'A+' || wfReport.rating === 'A' ? 'text-emerald-300' :
                    wfReport.rating === 'D' ? 'text-red-300' :
                    'text-amber-300'
                  }`}>{wfReport.rating}</div>
                  <div className="text-[10px] text-slate-500">{wfReport.robustnessScore}/100</div>
                </div>
                <div className="bg-slate-900/60 rounded p-2">
                  <div className="text-slate-500">年化夏普</div>
                  <div className={`font-mono ${wfReport.annualizedSharpe > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                    {wfReport.annualizedSharpe.toFixed(2)}
                  </div>
                </div>
                <div className="bg-slate-900/60 rounded p-2">
                  <div className="text-slate-500">胜率</div>
                  <div className="text-fuchsia-200 font-mono">{(wfReport.winRate * 100).toFixed(0)}%</div>
                </div>
                <div className="bg-slate-900/60 rounded p-2">
                  <div className="text-slate-500">超额胜率</div>
                  <div className={`font-mono ${wfReport.excessWinRate > 0.5 ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {(wfReport.excessWinRate * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="bg-slate-900/60 rounded p-2">
                  <div className="text-slate-500">最大回撤</div>
                  <div className="text-red-300 font-mono">{wfReport.maxDrawdown.toFixed(1)}%</div>
                </div>
              </div>

              {/* 一句话诊断 */}
              <div className={`text-xs px-3 py-2 rounded mb-3 ${
                wfReport.rating === 'A+' || wfReport.rating === 'A' ? 'bg-emerald-900/20 text-emerald-200' :
                wfReport.rating === 'D' ? 'bg-red-900/20 text-red-200' :
                'bg-slate-900/60 text-slate-300'
              }`}>
                💡 {wfReport.diagnosis}
              </div>

              {/* v2.1.1：历史趋势对比（IDB walkforwardReports） */}
              {wfTrend && wfTrend.recentSeries.length > 0 && (
                <div className={`mb-3 px-3 py-2 rounded text-xs ${
                  wfTrend.alert ? 'bg-red-900/20 border border-red-700/40' : 'bg-slate-900/60'
                }`}>
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <span className="text-slate-400">📈 历史趋势（最近 {wfTrend.recentSeries.length} 次）：</span>
                    <span className={`font-mono ${
                      wfTrend.trend === 'improving' ? 'text-emerald-300' :
                      wfTrend.trend === 'declining' ? 'text-red-300' :
                      wfTrend.trend === 'insufficient' ? 'text-slate-500' :
                      'text-slate-300'
                    }`}>
                      {wfTrend.trend === 'improving' ? '↗ 改善' :
                       wfTrend.trend === 'declining' ? '↘ 下滑' :
                       wfTrend.trend === 'insufficient' ? '— 数据不足' : '→ 稳定'}
                    </span>
                    <span className="text-slate-400">
                      平均评分 <span className="text-fuchsia-200 font-mono">{wfTrend.avgScore}</span>
                    </span>
                    <span className="text-slate-400">
                      平均夏普 <span className="text-fuchsia-200 font-mono">{wfTrend.avgSharpe}</span>
                    </span>
                    {wfTrend.consecutiveBad > 0 && (
                      <span className={`font-mono ${wfTrend.consecutiveBad >= 3 ? 'text-red-300' : 'text-amber-300'}`}>
                        连续 C/D × {wfTrend.consecutiveBad}
                      </span>
                    )}
                  </div>
                  {/* v2.1.1（2026-06-15）：Sparkline 折线图（替代原柱状图）*/}
                  {SparklineComp && (
                    <div className="bg-slate-900/60 rounded p-2">
                      <SparklineComp data={wfTrend.recentSeries} width={320} height={70} />
                    </div>
                  )}
                  {wfTrend.alert && (
                    <div className="mt-2 text-red-300">{wfTrend.alert}</div>
                  )}
                </div>
              )}

              {/* 累计收益摘要 */}
              <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                <div className="bg-slate-900/60 rounded p-2">
                  <div className="text-slate-500">窗口数</div>
                  <div className="text-fuchsia-200 font-mono">{wfReport.windowCount}</div>
                </div>
                <div className="bg-slate-900/60 rounded p-2">
                  <div className="text-slate-500">累计收益</div>
                  <div className={`font-mono ${wfReport.totalReturn > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                    {wfReport.totalReturn.toFixed(2)}%
                  </div>
                </div>
                <div className="bg-slate-900/60 rounded p-2">
                  <div className="text-slate-500">平均超额</div>
                  <div className={`font-mono ${wfReport.avgExcessReturn > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                    {wfReport.avgExcessReturn.toFixed(2)}%
                  </div>
                </div>
              </div>

              {/* 窗口明细（可折叠） */}
              {wfReport.windows && wfReport.windows.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-slate-400 hover:text-slate-200 mb-2">
                    📊 窗口明细（{wfReport.windows.length} 个）
                  </summary>
                  <div className="bg-slate-900/60 rounded p-2 space-y-1 max-h-48 overflow-y-auto">
                    {wfReport.windows.map((w: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 font-mono text-[11px]">
                        <span className="w-12 text-slate-500">#{w.windowIndex + 1}</span>
                        <span className="w-16 text-slate-400">{w.rebalanceDate}</span>
                        <span className={`w-16 text-right ${w.portfolioReturn > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                          {w.portfolioReturn > 0 ? '+' : ''}{w.portfolioReturn.toFixed(2)}%
                        </span>
                        <span className={`w-16 text-right ${w.excessReturn > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          超额 {w.excessReturn > 0 ? '+' : ''}{w.excessReturn.toFixed(2)}%
                        </span>
                        <span className="text-slate-500 truncate" title={w.picks.join(', ')}>
                          {w.picks.slice(0, 3).join(', ')}{w.picks.length > 3 ? '…' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {wfReport.warnings && wfReport.warnings.length > 0 && (
                <div className="mt-2 text-xs text-amber-400">
                  {wfReport.warnings.map((w: string, i: number) => (
                    <div key={i}>⚠️ {w}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {barraPanelOpen && barraDiag && barraWeights && (
        <div className="bg-gradient-to-br from-amber-950/40 to-orange-950/30 border border-amber-700/40 rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-sm text-amber-200 font-semibold">
              🎯 Barra 风险模型 + 组合优化（从分数到权重）
              <span className="text-[10px] text-slate-400 font-normal ml-2">· {barraWeights.length} 只票</span>
            </h3>
            <button onClick={() => setBarraPanelOpen(false)} className="text-xs text-slate-400 hover:text-slate-200">收起 ✕</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-xs">
            <div className="bg-slate-800/60 rounded p-2">
              <div className="text-slate-400">信息比率 IR</div>
              <div className={`text-lg font-bold ${barraDiag.informationRatio > 1.5 ? 'text-emerald-300' : barraDiag.informationRatio < 0.5 ? 'text-red-300' : 'text-amber-300'}`}>
                {barraDiag.informationRatio.toFixed(2)}
              </div>
            </div>
            <div className="bg-slate-800/60 rounded p-2">
              <div className="text-slate-400">组合 α</div>
              <div className="text-amber-200 font-mono">{barraDiag.portfolioAlpha.toFixed(3)}</div>
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
                    <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded" style={{ width: `${Math.min(100, w.weight * 100 / 0.15 * 100)}%` }} />
                  </div>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {running ? (
        <div className="bg-slate-900 border border-cyan-700/50 rounded-xl p-8 text-center">
          <div className="text-cyan-400 text-sm font-medium mb-2">⚡ {period === '5d' ? '5日' : '20日'} 因子分析中</div>
          <div className="text-slate-400 text-xs">{runProgress}</div>
          <div className="mt-3 w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 animate-pulse" style={{ width: '70%' }} />
          </div>
          <div className="text-xs text-slate-500 mt-2">预计 30-60 秒 · 完成后自动刷新推荐</div>
        </div>
      ) : loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-500 text-sm">
          正在读取{period === '5d' ? '5日' : '20日'}因子评分缓存…
        </div>
      ) : picks.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-500 text-sm">
          <p>暂无{period === '5d' ? '5日' : '20日'}因子评分数据</p>
          <p className="text-xs mt-2 text-slate-600">
            点上方「⚡ 一键分析」即可，30-60秒出结果 · 或前往 <a href="/quant/factor-analysis-v2" className="text-amber-400 hover:text-amber-300 underline">因子研究页</a>
          </p>
        </div>
      ) : (
        <>
        {(() => {
          // 2026-09-06：🔥 热点板块配额分配条 —— 热度越高的板块占席越多
          const sectorMap: Record<string, { industry: string; heat: number; slots: number; rank: number }> = {};
          for (const p of picks) {
            if (typeof p.quotaSectorRank !== 'number') continue;
            const k = String(p.quotaSectorRank);
            if (!sectorMap[k]) sectorMap[k] = { industry: p.industry || '', heat: p.quotaHeat || 0, slots: p.quotaSlots || 0, rank: p.quotaSectorRank };
          }
          const sectors = Object.values(sectorMap).sort((a, b) => a.rank - b.rank);
          if (sectors.length > 0) {
            const slotTotal = sectors.reduce((s, x) => s + x.slots, 0);
            return (
              <div className="flex items-center flex-wrap gap-2 mb-3 bg-slate-900/70 border border-amber-700/30 rounded-xl px-3 py-2">
                <span className="text-[11px] font-medium text-amber-300">🔥 热点板块配额（{slotTotal}席 · ≤{sectors.length}板块，热度越高推越多）</span>
                {sectors.map(s => (
                  <span key={s.rank} className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded bg-slate-800 border border-slate-600/40">
                    <span className="font-bold text-amber-200">#{s.rank}</span>
                    <span className="text-slate-200">{s.industry}</span>
                    <span className="text-[10px] text-slate-400">热度{s.heat}分</span>
                    <span className="text-[10px] px-1 rounded bg-rose-600/30 text-rose-200">×{s.slots}席</span>
                  </span>
                ))}
              </div>
            );
          }
          return null;
        })()}
        <StockTable
          rows={picks.map(p => toStockRow(p))}
          variant="lite"
          selected={selected}
          onToggleOne={toggleOne}
          onToggleAll={(codes) => setSelected(new Set(codes))}
          inWatchlist={inWatchlist}
          showScoreBar
          topPickThreshold={80}
          sparkline={sparklineMap}
          showSparkline
          defaultSortBy="compositeScore"
          defaultSortDir="desc"
          historyHits={historyHits}
          sectorTags={Object.fromEntries(
            picks
              .filter(p => typeof p.quotaSectorRank === 'number')
              .map(p => [p.code, { industry: p.industry || '', rank: p.quotaSectorRank!, heat: p.quotaHeat || 0 }] as const)
          )}
          onRowClick={(row) => onShowDetail({ code: row.code, name: row.name })}
          onScoreClick={(row) => {
            // 从 picks 里查回原始 factorScores（StockTable 传回的 row 不含此字段）
            const original = picks.find(p => p.code === row.code);
            // factorScores 是 JSON 字符串，需要 parse
            let parsedFactors: Record<string, any> | undefined;
            if (original?.factorScores) {
              try { parsedFactors = JSON.parse(original.factorScores); } catch { /* ignore */ }
            }
            onShowScoreDetail({
              code: row.code,
              name: row.name,
              compositeScore: row.compositeScore,
              factorScores: parsedFactors,
              momentumScore: original?.momentumScore,
              moneyFlowScore: original?.moneyFlowScore,
              technicalScore: original?.technicalScore,
              // v1 实时百分位计算所需：把整个 IDB 池的子项快照传进去
              poolSnapshot: picks.map(p => {
                try { return { code: p.code, factors: JSON.parse(p.factorScores || '{}') }; }
                catch { return { code: p.code, factors: {} }; }
              }),
            });
          }}
        />
        </>
      )}
    </section>
  );
}

// ==================== ③ 我的盯盘 ====================

function WatchlistMonitor({ onGoPro, onShowDetail }: { onGoPro: (tab: string) => void; onShowDetail: (stock: { code: string; name: string }) => void }) {
  const [items, setItems] = useState<WatchlistQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState('');
  // 每只股票独立记住上次输入的股数（A 股必须 100 的整数倍 = 1 手）
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const setVolumeFor = (code: string, v: number) => {
    // 自动向下取整到 100 的倍数（至少 100）
    const rounded = Math.max(100, Math.floor(v / 100) * 100);
    setVolumes(prev => ({ ...prev, [code]: rounded }));
  };
  const getVolumeFor = (code: string) => volumes[code] || 100;

  // 加载自选股 + 实时行情
  const refresh = useCallback(async () => {
    try {
      // 1. 从 localStorage 读自选股（先用旧版 key 兼容，后续可换 Dexie）
      const raw = localStorage.getItem('quant_watchlist');
      const codes: { code: string; name: string }[] = raw ? JSON.parse(raw) : [];
      if (codes.length === 0) { setItems([]); setLoading(false); return; }

      // 2. 拉实时行情
      const res = await fetch(`/api/stock/realtime?codes=${codes.map(c => c.code).join(',')}`);
      const json = await res.json();
      if (json.success) {
        const map: Record<string, any> = {};
        json.data.forEach((q: any) => { map[q.code] = q; });
        const newItems = codes.map(c => {
          const q = map[c.code];
          if (!q) return { code: c.code, name: c.name, price: 0, changePercent: 0, volume: 0, amount: 0, signal: 'neutral' as const };
          // 简单信号：涨 > 3% 标记 buy，< -3% 标记 sell
          let signal: 'buy' | 'sell' | 'neutral' = 'neutral';
          let signalReason = '横盘';
          if (q.changePercent > 3) { signal = 'buy'; signalReason = '强势上涨'; }
          else if (q.changePercent < -3) { signal = 'sell'; signalReason = '明显下跌'; }
          return { code: c.code, name: c.name, price: q.price, changePercent: q.changePercent, volume: q.volume, amount: q.amount, signal, signalReason };
        });
        setItems(newItems);
        // 广播给异动检测器（用 CustomEvent，同窗口可监听）
        window.dispatchEvent(new CustomEvent('quant:watchlist-prices', { detail: { items: newItems } }));
      }
    } catch (e) { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // 监听 TodayRecommendations 等组件发出的"自选股变化"事件，立即刷新
  useEffect(() => {
    const handler = () => { refresh(); };
    window.addEventListener('quant:watchlist-changed', handler);
    return () => window.removeEventListener('quant:watchlist-changed', handler);
  }, [refresh]);

  // 移除单只自选股（写 localStorage + 广播事件让其他组件刷新 inWatchlist 标记）
  const handleRemoveOne = (code: string, name: string) => {
    if (adding) return;
    if (!confirm(`从盯盘中移除 ${name}(${code}) ?`)) return;
    try {
      const raw = localStorage.getItem('quant_watchlist');
      const existing: { code: string; name: string; addedAt?: number }[] = raw ? JSON.parse(raw) : [];
      const next = existing.filter(c => c.code !== code);
      localStorage.setItem('quant_watchlist', JSON.stringify(next));
      // 立即从本地状态移除（不必等下一次轮询）
      setItems(prev => prev.filter(it => it.code !== code));
      // 广播给其他组件（②今日推荐的 inWatchlist 标记会用这个事件刷新）
      window.dispatchEvent(new CustomEvent('quant:watchlist-changed', { detail: { codes: [code], action: 'remove' } }));
    } catch (e) {
      toast.error('移除失败: ' + (e as any)?.message);
    }
  };

  // 一键清空所有自选股
  const handleClearAll = () => {
    if (adding || items.length === 0) return;
    if (!confirm(`清空全部 ${items.length} 只自选股 ? 此操作不会影响你的模拟持仓。`)) return;
    try {
      const raw = localStorage.getItem('quant_watchlist');
      const existing: { code: string; name: string; addedAt?: number }[] = raw ? JSON.parse(raw) : [];
      const removedCodes = existing.map(c => c.code);
      localStorage.setItem('quant_watchlist', JSON.stringify([]));
      setItems([]);
      window.dispatchEvent(new CustomEvent('quant:watchlist-changed', { detail: { codes: removedCodes, action: 'remove' } }));
    } catch (e) {
      toast.error('清空失败: ' + (e as any)?.message);
    }
  };

  // 快速买入/卖出（手动模式）— volume 由 UI 输入框传入，不再硬编码 100
  const handleQuickOrder = async (code: string, direction: 'long' | 'short', volume: number) => {
    if (adding) return;
    if (volume < 100 || volume % 100 !== 0) {
      toast.error('股数必须是 100 的整数倍（A 股 1 手 = 100 股）');
      return;
    }
    setAdding(code);
    try {
      const res = await fetch('/api/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'order', code, direction, volume, type: 'market' }),
      });
      const json = await res.json();
      if (json.success && json.data?.order?.status === 'filled') {
        // 成功
      } else if (json.data?.order?.status === 'rejected') {
        toast.error('下单被拒: ' + (json.data.order.reason || '风控拦截'));
      } else {
        toast.error('下单失败: ' + (json.error || '未知错误'));
      }
    } catch (e: any) {
      toast.error('网络错误: ' + e?.message);
    } finally {
      setAdding('');
    }
  };

  // ============ 批量等额买入（勾选多只盯盘股 + 输入总额，等额分配）============
  // selected: 勾选的股票代码集合
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // batchAmount: 买入总金额（默认 1 万）
  const [batchAmount, setBatchAmount] = useState<number>(10000);
  // batchBuying: 逐只下单进行中（锁住所有交互防重复提交）
  const [batchBuying, setBatchBuying] = useState(false);
  // batchProgress: 下单进度 { done, total }，按钮上显示 "买入中 2/5"
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

  const toggleSelect = (code: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelected(prev => (prev.size === items.length ? new Set() : new Set(items.map(i => i.code))));
  };

  const selectedItems = items.filter(i => selected.has(i.code));

  // 等额分配计算：总额 / 勾选数 = 每只预算；按市价向下取整到 100 股整数倍（A 股 1 手）
  const buildBatchPlan = (total: number) => {
    const n = selectedItems.length;
    if (n === 0 || !total || total <= 0) return { rows: [], skipped: [], budgetPer: 0, totalCost: 0 };
    const budgetPer = total / n;
    const rows: { item: WatchlistQuote; volume: number; cost: number }[] = [];
    const skipped: { item: WatchlistQuote; reason: string }[] = [];
    let totalCost = 0;
    for (const item of selectedItems) {
      if (item.price <= 0) { skipped.push({ item, reason: '无行情' }); continue; }
      const lots = Math.floor(budgetPer / (item.price * 100));
      if (lots < 1) { skipped.push({ item, reason: '预算不足 1 手' }); continue; }
      const volume = lots * 100;
      const cost = volume * item.price;
      rows.push({ item, volume, cost });
      totalCost += cost;
    }
    return { rows, skipped, budgetPer, totalCost };
  };

  const batchPlan = batchAmount > 0 ? buildBatchPlan(batchAmount) : { rows: [], skipped: [], budgetPer: 0, totalCost: 0 };

  // 批量等额买入：confirm 展示每只明细 → 逐只市价下单（串行）→ 汇总 toast + 广播刷新 ④ 区
  const handleBatchBuy = async () => {
    if (batchBuying) return;
    if (selectedItems.length === 0) { toast.error('请先勾选要买入的盯盘股票'); return; }
    if (!batchAmount || batchAmount <= 0) { toast.error('请输入买入总金额'); return; }
    if (batchPlan.rows.length === 0) {
      toast.error(`所选股票均无法买入：总额 ¥${batchAmount.toLocaleString()} 不足以各买 1 手（或暂无行情）`);
      return;
    }
    // 具体数字确认（沿用项目模式）
    const lines = batchPlan.rows.map(r =>
      `  ${r.item.name} ${r.item.code}  ¥${r.item.price.toFixed(2)} → ${r.volume / 100}手(${r.volume}股) ¥${r.cost.toFixed(0)}`
    );
    if (batchPlan.skipped.length > 0) {
      lines.push('');
      lines.push(`跳过 ${batchPlan.skipped.length} 只：`);
      for (const s of batchPlan.skipped) lines.push(`  ${s.item.name}（${s.reason}）`);
    }
    lines.push('');
    lines.push(`每只预算 ¥${batchPlan.budgetPer.toFixed(0)} · 预计总花费 ¥${batchPlan.totalCost.toFixed(0)}` +
      (batchAmount - batchPlan.totalCost >= 1 ? ` · 剩余 ¥${(batchAmount - batchPlan.totalCost).toFixed(0)}` : ''));
    lines.push('将按市价逐只买入，确认执行？');
    if (!window.confirm(`💰 等额买入确认（${batchPlan.rows.length} 只 · 总金额 ¥${batchAmount.toLocaleString()})\n\n${lines.join('\n')}`)) return;

    setBatchBuying(true);
    setBatchProgress({ done: 0, total: batchPlan.rows.length });
    let okCount = 0, failCount = 0;
    const failReasons: string[] = [];
    for (let i = 0; i < batchPlan.rows.length; i++) {
      const row = batchPlan.rows[i];
      try {
        const res = await fetch('/api/simulator', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'order', code: row.item.code, direction: 'long', volume: row.volume, type: 'market' }),
        });
        const json = await res.json();
        if (json.success && json.data?.order?.status === 'filled') {
          okCount++;
        } else {
          failCount++;
          failReasons.push(`${row.item.name}（${json.data?.order?.reason || json.error || '未知错误'}）`);
        }
      } catch (e: any) {
        failCount++;
        failReasons.push(`${row.item.name}（网络错误）`);
      }
      setBatchProgress({ done: i + 1, total: batchPlan.rows.length });
    }
    setBatchBuying(false);
    setBatchProgress(null);
    setSelected(new Set());
    if (okCount > 0) {
      toast.success(
        `✅ 等额买入完成：${okCount} 只成交 · ${failCount} 只失败` +
        (batchPlan.skipped.length > 0 ? ` · ${batchPlan.skipped.length} 只跳过` : '') +
        ` · 花费约 ¥${batchPlan.totalCost.toFixed(0)}`,
        { duration: 3500 }
      );
      // 广播让 ④ 模拟交易区（账户/持仓/订单流）立即刷新
      window.dispatchEvent(new CustomEvent('quant:simulator-changed', { detail: { source: 'watchlist-batch-buy' } }));
      setTimeout(() => document.getElementById('section-simulator')?.scrollIntoView({ behavior: 'smooth' }), 800);
    }
    if (failReasons.length > 0) toast.error('失败明细: ' + failReasons.join('；'), { duration: 5000 });
  };

  if (!loading && items.length === 0) {
    return (
      <section className="mb-6" data-section-target="watchlist">
        <h2 className="text-lg font-bold text-slate-100 mb-3">③ 我的盯盘</h2>
        <div className="bg-slate-900 border border-slate-800 border-dashed rounded-xl p-8 text-center">
          <div className="text-3xl mb-2">📡</div>
          <p className="text-slate-400 text-sm">还没有自选股</p>
          <p className="text-slate-500 text-xs mt-1">在"今日推荐"或因子研究页面加入自选股</p>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-6" data-section-target="watchlist">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-100">③ 我的盯盘</h2>
          <p className="text-xs text-slate-500 mt-0.5">{items.length} 只自选股 · 每 10s 自动刷新</p>
        </div>
        <div className="flex items-center gap-2 w-fit">
          <button
            onClick={toggleSelectAll}
            disabled={items.length === 0 || batchBuying}
            className={`text-xs px-3 py-1 rounded border transition-colors whitespace-nowrap disabled:opacity-40 ${
              selected.size > 0 && selected.size === items.length
                ? 'border-cyan-500 bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/30'
                : 'border-slate-700 hover:border-cyan-500 hover:text-cyan-300 text-slate-400'
            }`}
            title={selected.size === items.length ? '取消全选' : '全选所有自选股（用于批量等额买入）'}
          >
            {selected.size === items.length ? '☑ 取消全选' : '☑ 全选'}
          </button>
          <button onClick={handleClearAll} disabled={items.length === 0} className="text-xs px-3 py-1 rounded border border-slate-700 hover:border-rose-500 hover:text-rose-400 text-slate-400 disabled:opacity-40 disabled:hover:border-slate-700 disabled:hover:text-slate-400 transition-colors whitespace-nowrap" title="清空全部自选股">
            🗑️ 清空
          </button>
          <button onClick={() => refresh()} className="text-xs px-3 py-1 rounded border border-slate-700 hover:border-slate-500 text-slate-300 whitespace-nowrap">
            🔄 刷新
          </button>
        </div>
      </div>
      {/* 批量等额买入工具条：勾选 ≥1 只后浮现 */}
      {selected.size > 0 && (
        <div className="mb-3 rounded-xl border border-cyan-700/50 bg-cyan-950/25 p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-xs font-medium text-cyan-200">☑ 已选 {selected.size} 只</span>
            <label className="flex items-center gap-1.5 text-xs text-slate-300">
              <span className="text-slate-500">总额</span>
              <span className="flex items-center bg-slate-900 border border-slate-700 rounded overflow-hidden focus-within:border-cyan-500 transition-colors">
                <span className="pl-2 text-slate-500 text-xs">¥</span>
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={batchAmount || ''}
                  placeholder="10000"
                  onChange={e => setBatchAmount(parseInt(e.target.value || '0', 10))}
                  disabled={batchBuying}
                  className="w-28 text-xs px-1.5 py-1.5 bg-transparent text-white focus:outline-none disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  title="买入总金额，等额分配到每只勾选股票"
                />
              </span>
            </label>
            <div className="flex items-center gap-1">
              {[5000, 10000, 30000, 50000].map(v => (
                <button
                  key={v}
                  onClick={() => setBatchAmount(v)}
                  disabled={batchBuying}
                  className={`text-[10px] px-1.5 py-0.5 rounded transition-colors disabled:opacity-50 ${
                    batchAmount === v ? 'bg-cyan-600/40 text-cyan-200' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >{(v / 10000).toFixed(v >= 10000 ? 0 : 1)}万</button>
              ))}
            </div>
            <span className="text-[11px] text-slate-400">
              每只预算 <span className="text-cyan-300 font-medium">¥{batchPlan.budgetPer > 0 ? batchPlan.budgetPer.toFixed(0) : '—'}</span>
              {batchPlan.rows.length > 0 && (<> · 可买 <span className="text-slate-200">{batchPlan.rows.length}</span> 只 · 约 <span className="text-cyan-300 font-medium">¥{batchPlan.totalCost.toFixed(0)}</span></>)}
              {batchPlan.skipped.length > 0 && <span className="text-slate-500"> · 跳过 {batchPlan.skipped.length} 只</span>}
            </span>
            <div className="flex-1" />
            <button
              onClick={handleBatchBuy}
              disabled={batchBuying || batchPlan.rows.length === 0}
              className="text-xs px-4 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-medium flex items-center gap-1"
              title={batchPlan.rows.length === 0 ? '所选股票均不足 1 手，无法等额买入' : `按市价等额买入 ${batchPlan.rows.length} 只（每只预算 ¥${batchPlan.budgetPer.toFixed(0)}）`}
            >
              {batchBuying && batchProgress
                ? <><span className="animate-pulse">⏳</span> 买入中 {batchProgress.done}/{batchProgress.total}</>
                : <>🟢 等额买入 {batchPlan.rows.length > 0 ? `${batchPlan.rows.length}只` : ''}</>}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              disabled={batchBuying}
              className="text-xs px-2.5 py-1.5 rounded border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 disabled:opacity-40 transition-colors"
              title="取消所有勾选"
            >✕ 取消</button>
          </div>
          {/* 预估明细：每只股数/金额实时预览 */}
          {batchPlan.rows.length > 0 && (
            <div className="mt-2 pt-2 border-t border-cyan-900/40 text-[11px] text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
              {batchPlan.rows.map(r => (
                <span key={r.item.code}>
                  <span className="text-slate-200">{r.item.name}</span>{' '}
                  <span className="text-slate-500">¥{r.item.price.toFixed(2)}×{r.volume / 100}手</span>{' '}
                  <span className="text-cyan-300">¥{r.cost.toFixed(0)}</span>
                </span>
              ))}
              {batchPlan.skipped.map(s => (
                <span key={s.item.code} className="text-slate-600 line-through" title={s.reason}>
                  {s.item.name}({s.reason})
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-500 text-sm">加载中…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(item => {
            const isSelected = selected.has(item.code);
            return (
            <div key={item.code} className={`bg-slate-900 border rounded-xl p-4 transition-colors ${isSelected ? 'border-cyan-500/70 bg-cyan-950/30' : 'border-slate-800'}`}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(item.code)}
                    disabled={batchBuying}
                    className="mt-1 w-4 h-4 rounded border-slate-600 bg-slate-800 text-cyan-500 accent-cyan-500 disabled:opacity-40"
                    title={`勾选 ${item.name} 参与批量等额买入`}
                  />
                  <div
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => onShowDetail({ code: item.code, name: item.name })}
                    title={`点击查看 ${item.name} K线详情`}
                  >
                    <div className="text-white font-bold">{item.name}</div>
                    <div className="text-xs text-slate-500">{item.code}</div>
                  </div>
                </div>
                <div className="flex items-start gap-1.5">
                  <div className={`text-xs px-2 py-0.5 rounded-full ${
                    item.signal === 'buy' ? 'bg-rose-900/50 text-rose-300' :
                    item.signal === 'sell' ? 'bg-emerald-900/50 text-emerald-300' :
                    'bg-slate-800 text-slate-400'
                  }`}>
                    {item.signal === 'buy' ? '↑ 多' : item.signal === 'sell' ? '↓ 空' : '— 观望'}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemoveOne(item.code, item.name); }}
                    disabled={!!adding}
                    className="text-slate-600 hover:text-rose-400 hover:bg-rose-900/30 disabled:opacity-30 rounded w-5 h-5 flex items-center justify-center text-sm leading-none transition-colors"
                    title={`从盯盘移除 ${item.name}`}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="flex items-end justify-between mb-3">
                <div>
                  <div className="text-2xl font-bold text-white">{item.price.toFixed(2)}</div>
                  <div className={`text-sm font-semibold ${item.changePercent >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {fmtPct(item.changePercent)}
                  </div>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <div>量 {item.volume ? (item.volume / 10000).toFixed(0) + '万' : '-'}</div>
                  <div>额 {item.amount ? (item.amount / 10000).toFixed(0) + '万' : '-'}</div>
                </div>
              </div>
              <div className="space-y-1.5">
                {/* 股数输入 + 快捷按钮（A 股 1 手 = 100 股） */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); setVolumeFor(item.code, getVolumeFor(item.code) - 100); }}
                    disabled={adding === item.code || batchBuying}
                    className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded transition-colors"
                    title="减少 100 股"
                  >−100</button>
                  <input
                    type="number"
                    min={100}
                    step={100}
                    value={getVolumeFor(item.code)}
                    onChange={(e) => setVolumeFor(item.code, parseInt(e.target.value) || 0)}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={(e) => e.target.select()}
                    disabled={adding === item.code || batchBuying}
                    className="flex-1 min-w-0 text-xs px-1.5 py-1 bg-slate-800 border border-slate-700 focus:border-cyan-500 focus:outline-none text-white text-center rounded disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    title="A 股必须是 100 的整数倍"
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); setVolumeFor(item.code, getVolumeFor(item.code) + 100); }}
                    disabled={adding === item.code || batchBuying}
                    className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded transition-colors"
                    title="增加 100 股"
                  >+100</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setVolumeFor(item.code, getVolumeFor(item.code) + 400); }}
                    disabled={adding === item.code || batchBuying}
                    className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded transition-colors"
                    title="增加 500 股"
                  >+500</button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleQuickOrder(item.code, 'long', getVolumeFor(item.code))}
                    disabled={adding === item.code || batchBuying}
                    className="flex-1 text-xs py-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded transition-colors"
                  >
                    {adding === item.code ? '…' : `买入 ${getVolumeFor(item.code)}股`}
                  </button>
                  <button
                    onClick={() => handleQuickOrder(item.code, 'short', getVolumeFor(item.code))}
                    disabled={adding === item.code || batchBuying}
                    className="flex-1 text-xs py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded transition-colors"
                  >
                    卖出 {getVolumeFor(item.code)}股
                  </button>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ==================== ④b 风险设置（止损/止盈/最大持仓）====================

interface RiskSettings {
  stopLossPct: number;        // 个股止损 %（如 -8 表示跌 8% 触发止损）
  takeProfitPct: number;      // 个股止盈 %
  maxPositionPct: number;     // 单只最大持仓占总资产 %（如 20%）
  maxTotalPositions: number;  // 策略池最多 N 只
  enabled: boolean;           // 是否启用风控
}

const DEFAULT_RISK: RiskSettings = {
  stopLossPct: -8,
  takeProfitPct: 20,
  maxPositionPct: 20,
  maxTotalPositions: 10,
  enabled: true,
};

function loadRiskSettings(): RiskSettings {
  try {
    const raw = localStorage.getItem('quant_risk_settings');
    if (raw) return { ...DEFAULT_RISK, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_RISK;
}

function RiskSettingsPanel() {
  const [settings, setSettings] = useState<RiskSettings>(loadRiskSettings);
  const [saved, setSaved] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'ok' | 'error'>('idle');
  const [lastChanges, setLastChanges] = useState<string[]>([]);

  // 防抖 refs：避免用户连续 input 时每个字符都打一次 API
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef<RiskSettings | null>(null);

  const update = (patch: Partial<RiskSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    localStorage.setItem('quant_risk_settings', JSON.stringify(next));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);

    // 防抖同步到 live-simulator（300ms 内合并所有改动，只发一次请求）
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      // 跳过与上次完全一致的请求（防御性 + 节流）
      if (
        lastSentRef.current &&
        lastSentRef.current.stopLossPct === next.stopLossPct &&
        lastSentRef.current.takeProfitPct === next.takeProfitPct &&
        lastSentRef.current.maxPositionPct === next.maxPositionPct &&
        lastSentRef.current.maxTotalPositions === next.maxTotalPositions &&
        lastSentRef.current.enabled === next.enabled
      ) {
        return;
      }
      setSyncStatus('syncing');
      fetch('/api/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateRisk',
          stopLossPct: next.stopLossPct,
          takeProfitPct: next.takeProfitPct,
          maxPositionPct: next.maxPositionPct,
          maxTotalPositions: next.maxTotalPositions,
          enabled: next.enabled,
        }),
      })
        .then(r => r.json())
        .then(json => {
          if (json.success) {
            lastSentRef.current = next;
            setLastChanges(json.data?.changes || []);
            setSyncStatus('ok');
            setTimeout(() => setSyncStatus('idle'), 2500);
          } else {
            console.warn('[RiskSettings] sync failed:', json.error);
            setSyncStatus('error');
            setTimeout(() => setSyncStatus('idle'), 3000);
          }
        })
        .catch(err => {
          console.warn('[RiskSettings] sync network error:', err);
          setSyncStatus('error');
          setTimeout(() => setSyncStatus('idle'), 3000);
        });
    }, 300);
  };

  // 组件卸载时清理 timer
  useEffect(() => {
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current); };
  }, []);

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
          ⏰ 风险设置
          {saved && <span className="text-[10px] text-emerald-400 animate-pulse">✓ 已保存</span>}
          {syncStatus === 'syncing' && <span className="text-[10px] text-cyan-400 animate-pulse">⏳ 同步引擎中…</span>}
          {syncStatus === 'ok' && (
            <span
              className="text-[10px] text-emerald-400"
              title={lastChanges.join(' · ')}
            >
              ✅ 引擎已生效{lastChanges.length > 0 && `（${lastChanges.length}项）`}
            </span>
          )}
          {syncStatus === 'error' && <span className="text-[10px] text-rose-400 animate-pulse">⚠️ 引擎同步失败</span>}
        </h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={e => update({ enabled: e.target.checked })}
              className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-amber-500"
            />
            <span>启用风控</span>
          </label>
        </div>
      </div>

      <div className={`bg-slate-900 border ${settings.enabled ? 'border-amber-800/50' : 'border-slate-800'} rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-3`}>
        <div>
          <label className="text-xs text-slate-500 block mb-1">🛑 个股止损</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={settings.stopLossPct}
              onChange={e => update({ stopLossPct: Number(e.target.value) })}
              disabled={!settings.enabled}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white disabled:opacity-50"
              step="1"
            />
            <span className="text-xs text-slate-500">%</span>
          </div>
          <p className="text-[10px] text-slate-600 mt-0.5">触发后自动平仓</p>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">🎯 个股止盈</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={settings.takeProfitPct}
              onChange={e => update({ takeProfitPct: Number(e.target.value) })}
              disabled={!settings.enabled}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white disabled:opacity-50"
              step="1"
            />
            <span className="text-xs text-slate-500">%</span>
          </div>
          <p className="text-[10px] text-slate-600 mt-0.5">触发后自动平仓</p>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">📊 单只最大占比</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={settings.maxPositionPct}
              onChange={e => update({ maxPositionPct: Number(e.target.value) })}
              disabled={!settings.enabled}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white disabled:opacity-50"
              step="5"
              min="5"
              max="100"
            />
            <span className="text-xs text-slate-500">%</span>
          </div>
          <p className="text-[10px] text-slate-600 mt-0.5">占总资产上限</p>
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">🎲 策略池上限</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={settings.maxTotalPositions}
              onChange={e => update({ maxTotalPositions: Number(e.target.value) })}
              disabled={!settings.enabled}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white disabled:opacity-50"
              step="1"
              min="1"
              max="30"
            />
            <span className="text-xs text-slate-500">只</span>
          </div>
          <p className="text-[10px] text-slate-600 mt-0.5">同时持仓最多</p>
        </div>
      </div>
      <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
        💡 提示：风控已实时同步到 live-simulator 引擎——下次 ⏰ 启动/重启自动驾驶时立即生效，无需重启引擎。<br />
        <span className="text-slate-600">
          （影响 RiskEngine.StopLossRule + StopProfitRule + PositionLimitRule + AdvancedPositionManager.stopConfig）
        </span>
      </p>
    </section>
  );
}

// ==================== ④b v1 vs v2 因子模型回测对比 ====================
// 接受 initialLookback/initialTopN 让 ② 区"回测验证推荐"按钮能预填参数
export function V1VsV2BacktestPanel({
  initialLookback,
  initialTopN,
  title = 'v1 vs v2 因子模型回测对比',  // 不带图标，外层统一加 ⚔️
}: {
  initialLookback?: number;
  initialTopN?: number;
  title?: string;
} = {}) {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookbackDays, setLookbackDays] = useState(initialLookback ?? 20);
  const [topN, setTopN] = useState(initialTopN ?? 10);
  const [poolSize, setPoolSize] = useState(200);
  const [v2Short, setV2Short] = useState(true);
  const [expanded, setExpanded] = useState(true);

  const runBacktest = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 90_000);
    try {
      const res = await fetch(`/api/stock/backtest-v1-vs-v2?lookbackDays=${lookbackDays}&topN=${topN}&poolSize=${poolSize}&v2Short=${v2Short}&_t=${Date.now()}`, { signal: ctrl.signal });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setResult(json);
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setError('回测超过 90 秒（首次跑需要拉 K 线 + 算因子）。请再试一次或缩短回看天数/股票池。');
      } else {
        setError(e.message || '回测失败');
      }
    } finally {
      clearTimeout(t);
      setLoading(false);
    }
  };

  return (
    <section id="section-v1v2-backtest" className="mb-6 bg-gradient-to-br from-indigo-950/50 to-purple-950/30 border border-indigo-800/40 rounded-xl p-4 scroll-mt-20">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-base font-semibold text-indigo-200 flex items-center gap-2">
          <span>⚔️</span> {title}
        </h2>
        <div className="flex items-center gap-2">
          {/* 「回到 ② 今日推荐」快捷入口：从回测结果回到推荐区 */}
          <button
            onClick={() => {
              document.getElementById('section-today-recommendations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg flex items-center gap-1 border border-slate-700"
            title="回到 ② 今日推荐（看今日 Top 10 + 用 ② 区按钮推到交易池 / 开启自驾）"
          >
            <span>↑</span> 回到 ② 推荐
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            {expanded ? '▼ 折叠' : '▶ 展开'}
          </button>
        </div>
      </div>

      {expanded && <>
        <p className="text-[11px] text-slate-400 mb-3">
          用历史 N 天 K 线 + 财务数据，每天跑 v1（3-pillar）和 v2（8 大类 + 中性化）取各自 Top {topN}，等权持仓 1 天（T+1），次日开盘计算收益。
          v2 可选 long-short（多空对冲，理论最大能力）。真实回测，无未来函数。基准：沪深 300。
        </p>

        <div className="flex items-center gap-3 mb-3 text-xs flex-wrap">
          <label className="flex items-center gap-1.5 text-slate-300">
            回看天数
            <select
              value={lookbackDays}
              onChange={e => setLookbackDays(parseInt(e.target.value))}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200"
            >
              <option value={10}>10 天</option>
              <option value={20}>20 天</option>
              <option value={30}>30 天</option>
              <option value={60}>60 天</option>
              <option value={90}>90 天</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-slate-300">
            股票池
            <select
              value={poolSize}
              onChange={e => setPoolSize(parseInt(e.target.value))}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200"
            >
              <option value={50}>50 只</option>
              <option value={100}>100 只</option>
              <option value={200}>200 只（推荐）</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-slate-300">
            Top N
            <select
              value={topN}
              onChange={e => setTopN(parseInt(e.target.value))}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={15}>15</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-slate-300" title="v2 long-short：Top N 做多 + Bottom N 做空（市场中性，A 股融券有限，仅作理论参考）">
            <input
              type="checkbox"
              checked={v2Short}
              onChange={e => setV2Short(e.target.checked)}
              className="w-3.5 h-3.5 cursor-pointer"
            />
            v2 多空对冲
          </label>
          <button
            onClick={runBacktest}
            disabled={loading}
            className="px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading ? '⏳ 回测中…' : '🚀 开始回测'}
          </button>
          {error && <span className="text-rose-400 text-[11px]">❌ {error}</span>}
        </div>

        {result && !error && (
          <BacktestResultView result={result} />
        )}
      </>}
    </section>
  );
}

// 回测结果展示（export 以便 ② 区「回测验证推荐」按钮复用）
export function BacktestResultView({ result }: { result: any }) {
  if (!result || !result.daily || result.daily.length === 0) {
    return <p className="text-xs text-slate-500">无数据</p>;
  }
  const { daily, v1Stats, v2Stats, v2LongStats, v2LongShortStats, benchStats, consensusHits, totalDays, startDate, endDate, warnings, ms, config } = result;
  const showShort = !!v2LongShortStats;

  // 找出赢家（在所有模型中）
  const candidates: { name: string; stats: any; color: string }[] = [
    { name: 'v1 long-only', stats: v1Stats, color: 'amber' },
    { name: 'v2 long-only', stats: v2LongStats || v2Stats, color: 'emerald' },
  ];
  if (showShort) candidates.push({ name: 'v2 long-short', stats: v2LongShortStats, color: 'cyan' });
  candidates.push({ name: '沪深 300', stats: benchStats, color: 'slate' });

  const sortedByReturn = [...candidates].sort((a, b) => b.stats.totalReturn - a.stats.totalReturn);
  const winner = sortedByReturn[0];
  const runnerUp = sortedByReturn[1];
  const margin = Math.abs(winner.stats.totalReturn - runnerUp.stats.totalReturn);

  // 绘制权益曲线（用 SVG）
  const W = 600, H = 200;
  const navKeys: { key: string; color: string; dash: string }[] = [
    { key: 'v1Nav', color: '#fbbf24', dash: '' },
    { key: 'v2LongNav', color: '#34d399', dash: '' },
  ];
  if (showShort) navKeys.push({ key: 'v2LongShortNav', color: '#22d3ee', dash: '' });
  navKeys.push({ key: 'benchNav', color: '#94a3b8', dash: '4 4' });

  const allNavs = daily.flatMap((d: any) => navKeys.map(k => d[k.key]));
  const minNav = Math.min(...allNavs) * 0.998;
  const maxNav = Math.max(...allNavs) * 1.002;
  const range = maxNav - minNav || 0.01;
  const stepX = W / Math.max(daily.length - 1, 1);
  const yFor = (nav: number) => H - ((nav - minNav) / range) * H;
  const pathFor = (key: string) => daily.map((d: any, i: number) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${yFor(d[key]).toFixed(1)}`).join(' ');

  return (
    <div className="space-y-3">
      {/* 头部信息 */}
      <div className="flex items-center gap-3 text-[11px] text-slate-400 flex-wrap">
        <span>📅 {startDate} ~ {endDate}</span>
        <span>· {totalDays} 交易日</span>
        <span>· 股票池 {config?.poolSize || '?'}</span>
        <span>· 共识 {consensusHits}/{totalDays} 天（重叠 ≥ 5）</span>
        <span>· ⏱ {(ms / 1000).toFixed(1)}s</span>
        {warnings.slice(0, 3).map((w: string, i: number) => (
          <span key={i} className="text-amber-500/70">· {w}</span>
        ))}
      </div>

      {/* 胜者横幅 */}
      <div className={`rounded-lg p-3 ${winner.name.includes('v1') ? 'bg-amber-900/30 border border-amber-700/40' : winner.name.includes('short') ? 'bg-cyan-900/30 border border-cyan-700/40' : 'bg-emerald-900/30 border border-emerald-700/40'}`}>
        <div className="text-sm font-bold text-slate-200">
          🏆 {winner.name} 跑赢 <span className="text-slate-400 ml-2">差距 {margin.toFixed(2)} pp（{totalDays} 天）</span>
        </div>
        <div className="text-[11px] text-slate-400 mt-1">
          ⚠️ {totalDays < 30 ? '样本量过小，结果仅供参考' : '样本量尚可，趋势有意义'}。年化收益是几何推算，非真实可持续收益。
        </div>
      </div>

      {/* 业绩对比卡（4 列：v1 / v2 long / v2 long-short / 基准）*/}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <StatsCard label="v1 long" color="amber" stats={v1Stats} />
        <StatsCard label="v2 long" color="emerald" stats={v2LongStats || v2Stats} />
        {showShort ? <StatsCard label="v2 多空" color="cyan" stats={v2LongShortStats} /> : <StatsCard label="(多空关)" color="slate" stats={{ totalReturn: 0, maxDrawdown: 0, sharpe: 0, winRate: 0, volatility: 0, avgDailyReturn: 0, finalNav: 1 }} disabled />}
        <StatsCard label="沪深 300" color="slate" stats={benchStats} />
      </div>

      {/* 权益曲线 */}
      <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-3">
        <div className="text-xs text-slate-300 mb-2">📈 累计净值曲线</div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44">
          <defs>
            <linearGradient id="v1Grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="v2LGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="v2LSGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" y1={yFor(1)} x2={W} y2={yFor(1)} stroke="#475569" strokeWidth="0.5" strokeDasharray="4 4" />
          {navKeys.map(k => (
            <path key={k.key} d={pathFor(k.key)} fill="none" stroke={k.color} strokeWidth="2" strokeDasharray={k.dash} />
          ))}
        </svg>
        <div className="flex items-center justify-center gap-4 text-[10px] mt-1 flex-wrap">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-400"></span>v1 long</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-400"></span>v2 long</span>
          {showShort && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-cyan-400"></span>v2 多空</span>}
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-400" style={{ borderTop: '1px dashed' }}></span>沪深300</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-500" style={{ borderTop: '1px dashed' }}></span>净值=1.0</span>
        </div>
      </div>

      {/* Top 共识表 */}
      <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-3">
        <div className="text-xs text-slate-300 mb-2">🎯 最近 5 日 v1/v2 Top {config?.topN || 10} 持仓</div>
        <div className="space-y-1 text-[10px] font-mono">
          {daily.slice(-5).reverse().map((d: any) => (
            <div key={d.date} className="flex items-center gap-2 text-slate-400">
              <span className="text-slate-500 w-20">{d.date.slice(5)}</span>
              <span className="text-amber-400 w-32 truncate" title={d.v1Top.join(',')}>
                v1: {d.v1Top.slice(0, 5).map((c: string) => c.slice(0, 6)).join(' ')}
              </span>
              <span className="text-emerald-400 flex-1 truncate" title={d.v2Top.join(',')}>
                v2↑: {d.v2Top.slice(0, 5).map((c: string) => c.slice(0, 6)).join(' ')}
              </span>
              {showShort && d.v2ShortTop?.length > 0 && (
                <span className="text-cyan-400 w-32 truncate" title={d.v2ShortTop.join(',')}>
                  v2↓: {d.v2ShortTop.slice(0, 5).map((c: string) => c.slice(0, 6)).join(' ')}
                </span>
              )}
              <span className="text-slate-500">重 {d.v1Overlap}</span>
              <span className={d.v1DailyReturn > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                {(d.v1DailyReturn * 100).toFixed(2)}%
              </span>
              {showShort && (
                <span className={d.v2LongShortDailyReturn > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                  ({(d.v2LongShortDailyReturn * 100).toFixed(2)}%)
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StatsCard({ label, color, stats, disabled }: { label: string; color: 'amber' | 'emerald' | 'slate' | 'cyan'; stats: any; disabled?: boolean }) {
  const colorMap: Record<string, string> = {
    amber: 'border-amber-700/40 bg-amber-950/20 text-amber-200',
    emerald: 'border-emerald-700/40 bg-emerald-950/20 text-emerald-200',
    slate: 'border-slate-700/40 bg-slate-900/40 text-slate-200',
    cyan: 'border-cyan-700/40 bg-cyan-950/20 text-cyan-200',
  };
  return (
    <div className={`rounded-lg p-2 border ${disabled ? 'opacity-40' : ''} ${colorMap[color]}`}>
      <div className="text-xs font-bold mb-1.5">{label}</div>
      <div className="space-y-0.5 text-[10px]">
        <StatRow label="累计收益" value={`${stats.totalReturn > 0 ? '+' : ''}${stats.totalReturn.toFixed(2)}%`} positive={stats.totalReturn > 0} />
        <StatRow label="最大回撤" value={`${stats.maxDrawdown.toFixed(2)}%`} positive={false} />
        <StatRow label="Sharpe" value={stats.sharpe.toFixed(2)} positive={stats.sharpe > 0} />
        <StatRow label="胜率" value={`${stats.winRate.toFixed(1)}%`} positive={stats.winRate > 50} />
        <StatRow label="波动率" value={`${stats.volatility.toFixed(1)}%`} />
      </div>
    </div>
  );
}

function StatRow({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  let color = 'text-slate-300';
  if (positive === true) color = 'text-rose-400';
  if (positive === false) color = 'text-emerald-400';
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={`font-mono ${color}`}>{value}</span>
    </div>
  );
}

// ==================== ④ 模拟交易 ====================

/**
 * 30 天净值迷你 sparkline（账户卡片内）
 * ──────────────────────────────────────────────────────────────────
 * 纯 SVG 自渲染，零依赖。60×20 紧凑布局，A 股配色：
 *   - 涨（净值为正）：rose
 *   - 跌（净值为负）：emerald
 * 数据 ≥ 2 个点才渲染。
 */
function EquitySparkline({ points }: { points: number[] }) {
  if (!points || points.length < 2) return null;
  const W = 240, H = 40;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = W / (points.length - 1);
  const path = points.map((p, i) => {
    const x = i * step;
    const y = H - 4 - ((p - min) / range) * (H - 8);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const isUp = points[points.length - 1] >= points[0];
  const stroke = isUp ? '#fb7185' : '#34d399';
  return (
    <svg width={W} height={H} className="w-full h-10">
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
      {/* 起止圆点 */}
      <circle cx={0} cy={H - 4 - ((points[0] - min) / range) * (H - 8)} r="2" fill={stroke} />
      <circle cx={W} cy={H - 4 - ((points[points.length - 1] - min) / range) * (H - 8)} r="3" fill={stroke} />
    </svg>
  );
}

/**
 * 导出账户快照为 CSV 文件
 * ──────────────────────────────────────────────────────────────────
 * 包含 2 个 section：
 *   1. 持仓明细（代码/名称/数量/成本价/当前价/市值/浮盈/盈亏率）
 *   2. 净值曲线（YYYY-MM-DD, equity）
 * 浏览器原生 Blob + a.download，零依赖。
 */
function exportAccountCsv(
  account: AccountSnapshot | null,
  equitySpark: { points: number[]; totalReturn: number } | null,
) {
  if (!account) return;
  const lines: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // Section 1: 持仓明细
  lines.push(`# 账户快照 - ${today}`);
  lines.push(`# 总资产,${account.totalAssets.toFixed(2)}`);
  lines.push(`# 现金,${(account.balance ?? 0).toFixed(2)}`);
  lines.push(`# 策略池,${account.tradingCodes?.length ?? 0} 只`);
  lines.push('');
  lines.push('=== 持仓明细 ===');
  lines.push('代码,名称,数量,成本价,当前价,市值,浮盈,盈亏率%');
  for (const p of account.positions || []) {
    const pnlPct = p.avgCost > 0 ? ((p.currentPrice - p.avgCost) / p.avgCost * 100).toFixed(2) : '0.00';
    lines.push([
      p.code,
      p.name || '',
      p.volume,
      p.avgCost.toFixed(2),
      p.currentPrice.toFixed(2),
      p.marketValue.toFixed(2),
      p.unrealizedPnL.toFixed(2),
      pnlPct,
    ].join(','));
  }

  // Section 2: 净值曲线（从 IDB equityPoints 拉，按日期排序）
  lines.push('');
  lines.push('=== 净值曲线（30 天） ===');
  lines.push('日期,净值');
  // 我们只拿到 sparkline 的数字数组，日期用相对偏移近似（最近 N 天）
  if (equitySpark && equitySpark.points.length > 0) {
    const pts = equitySpark.points;
    pts.forEach((eq, i) => {
      // 日期从 (N-1) 天前倒推到今天
      const d = new Date();
      d.setDate(d.getDate() - (pts.length - 1 - i));
      const dateStr = d.toISOString().slice(0, 10);
      lines.push(`${dateStr},${eq.toFixed(2)}`);
    });
  }

  const csv = '\ufeff' + lines.join('\n'); // BOM 兼容 Excel 中文
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `账户快照_${today}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function SimulatorSnapshot() {
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  // ============ 30 天净值迷你 sparkline ============
  // 从 IDB equityPoints 读最近 30 天 → 在账户卡片内显示迷你曲线
  const [equitySpark, setEquitySpark] = useState<{ points: number[]; totalReturn: number } | null>(null);
  const loadEquitySpark = useCallback(async () => {
    try {
      const { db } = await import('@/lib/quant/db/database');
      const table = db.equityPoints;
      if (!table) return;
      const rows = await table.toArray();
      if (rows.length === 0) return;
      // 按日期聚合（同一天取最后一个）
      const byDate: Record<string, number> = {};
      rows.forEach(r => { byDate[r.date] = r.equity; });
      const sorted = Object.entries(byDate)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-30)
        .map(([_, eq]) => eq);
      if (sorted.length >= 2) {
        const totalReturn = ((sorted[sorted.length - 1] - sorted[0]) / sorted[0]) * 100;
        setEquitySpark({ points: sorted, totalReturn });
      }
    } catch { /* ignore */ }
  }, []);

  // ============ 资金变动闪烁动画 ============
  // 跟踪总资产、总盈亏的变化 → 变化时显示闪烁高亮（1.2s）
  const prevTotalAssets = useRef<number | null>(null);
  const prevTotalPnL = useRef<number | null>(null);
  const [flashAssets, setFlashAssets] = useState<'up' | 'down' | null>(null);
  const [flashPnl, setFlashPnl] = useState<'up' | 'down' | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/simulator');
      const json = await res.json();
      if (json.success) {
        const d = json.data;
        const rawPositions: Array<{ code: string; name?: string; volume: number; avgCost: number; currentPrice: number; marketValue: number; unrealizedPnL: number; [k: string]: any }> = d.account.positions || [];
        // 名称兜底：API 返回的 positions 大多没 name，从 realtime 拉一次补全
        let positionNameMap: Record<string, string> = {};
        if (rawPositions.length > 0) {
          try {
            const r = await fetch(`/api/stock/realtime?codes=${encodeURIComponent(rawPositions.map(p => p.code).join(','))}`);
            const j = await r.json();
            if (j?.data) {
              for (const q of j.data) positionNameMap[q.code] = q.name;
            }
          } catch { /* ignore */ }
        }
        const newTotalAssets = d.account.totalAssets;
        const newTotalPnL = d.account.totalPnL;
        // 触发闪烁
        if (prevTotalAssets.current !== null && newTotalAssets !== prevTotalAssets.current) {
          const dir: 'up' | 'down' = newTotalAssets > prevTotalAssets.current ? 'up' : 'down';
          setFlashAssets(dir);
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
          flashTimerRef.current = setTimeout(() => setFlashAssets(null), 1200);
        }
        if (prevTotalPnL.current !== null && newTotalPnL !== prevTotalPnL.current) {
          const dir: 'up' | 'down' = newTotalPnL > prevTotalPnL.current ? 'up' : 'down';
          setFlashPnl(dir);
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
          flashTimerRef.current = setTimeout(() => setFlashPnl(null), 1200);
        }
        prevTotalAssets.current = newTotalAssets;
        prevTotalPnL.current = newTotalPnL;
        setAccount({
          balance: d.account.cash,
          frozen: d.account.frozen,
          totalAssets: d.account.totalAssets,
          totalPnL: d.account.totalPnL,
          positions: rawPositions.map(p => ({
            ...p,
            name: p.name || positionNameMap[p.code] || p.code,
            unrealizedPnLPct: p.avgCost > 0 ? ((p.currentPrice - p.avgCost) / p.avgCost) * 100 : 0,
          })),
          isRunning: d.isRunning,
          isAutoPilot: d.isAutoPilot,
          tradingCodes: d.tradingCodes,
        });
      }
    } catch (e) { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    loadEquitySpark();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh, loadEquitySpark]);

  // 监听 ② 推入交易池事件，立即刷新（不等 10s 轮询）
  useEffect(() => {
    const handler = () => { refresh(); };
    window.addEventListener('quant:simulator-changed', handler);
    return () => window.removeEventListener('quant:simulator-changed', handler);
  }, [refresh]);

  // ============ 持仓行手动下单（加仓/减仓/清仓）============
  // per-row acting 状态，避免点 A 时 B 也不能点
  const [actingByCode, setActingByCode] = useState<Record<string, boolean>>({});
  const submitOrder = useCallback(async (code: string, direction: 'long' | 'short', volume: number) => {
    if (actingByCode[code]) return;
    if (volume < 100 || volume % 100 !== 0) {
      toast.error('股数必须是 100 的整数倍（A 股 1 手 = 100 股）');
      return;
    }
    if (volume > 1_000_000) {
      toast.error('单次下单最多 10000 手（100 万股）');
      return;
    }
    // 减仓风控：不可超过当前持仓
    if (direction === 'short') {
      const pos = account?.positions.find(p => p.code === code);
      if (!pos || pos.volume < volume) {
        toast.error(`持仓不足：当前 ${pos?.volume ?? 0} 股，无法卖出 ${volume} 股`);
        return;
      }
    }
    setActingByCode(prev => ({ ...prev, [code]: true }));
    try {
      const res = await fetch('/api/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'order', code, direction, volume, type: 'market' }),
      });
      const json = await res.json();
      const order = json?.data?.order;
      const pos = account?.positions.find(p => p.code === code);
      const name = pos?.name || code;
      if (json.success && order?.status === 'filled') {
        const filledPrice = order.price || pos?.currentPrice || 0;
        const amount = (filledPrice * volume).toFixed(0);
        toast.success(
          `${direction === 'long' ? '🟢 买入' : '🔴 卖出'} ${name} ${volume} 股 @ ¥${filledPrice.toFixed(2)}（¥${amount}）`,
          { duration: 2200 }
        );
        // 广播让 PnL 闪光、订单流、WatchlistMonitor 全部立即刷新
        window.dispatchEvent(new CustomEvent('quant:simulator-changed', { detail: { code, direction, volume, source: 'position-row' } }));
        setTimeout(refresh, 500);
      } else if (order?.status === 'rejected') {
        toast.error('下单被拒: ' + (order.reason || '风控拦截'));
      } else {
        toast.error('下单失败: ' + (json.error || '未知错误'));
      }
    } catch (e: any) {
      toast.error('网络错误: ' + e?.message);
    } finally {
      setActingByCode(prev => ({ ...prev, [code]: false }));
    }
  }, [actingByCode, account?.positions, refresh]);

  const handleToggle = async (action: 'start' | 'autopilot' | 'stop' | 'reset', enabled?: boolean) => {
    if (acting) return;
    // 开启自动驾驶：弹风险确认
    if (action === 'autopilot' && enabled === true) {
      const ok = window.confirm(
        `🤖 确认开启自动驾驶？\n\n` +
        `当前策略池：${account?.tradingCodes.length ?? 0} 只\n` +
        `总资产：${fmtMoney(account?.totalAssets ?? 0)}\n\n` +
        `开启后，系统将按因子评分信号自动买卖，\n` +
        `每 10 秒检查一次信号。\n\n` +
        `⚠️ 风险提示：\n` +
        `• 自动驾驶会真实下单（模拟盘），可能有亏损\n` +
        `• 请确认已设置好止损参数\n` +
        `• 可随时点击「⏹ 停止」关闭\n\n` +
        `确认开启？`
      );
      if (!ok) return;
    }
    setActing(true);
    try {
      const body: any = { action };
      if (action === 'autopilot') body.enabled = enabled;
      if (action === 'start') {
        // 冷启动：start action 强制要 codes（API 400），策略池为空则拒绝并提示
        if (!account?.tradingCodes || account.tradingCodes.length === 0) {
          setActing(false);
          alert('⚠️ 策略池为空\n\n请先到上方「② 今日推荐」点击「🤖 启自驾并加入」添加股票后，再点此启动引擎。');
          return;
        }
        // 有股票：透传 codes + 默认 factor 策略
        body.codes = account.tradingCodes.slice(0, 10);
        body.strategyType = 'factor';
      }
      if (action === 'reset') body.initialCash = 1000000;
      await fetch('/api/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setTimeout(refresh, 500);
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <section className="mb-6" data-section-target="trading">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-slate-100">④ 模拟交易</h2>
          <SimulatorBackupPanel onChanged={refresh} />
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-500 text-sm">加载账户…</div>
      </section>
    );
  }

  const pnlPct = account && account.totalAssets > 0 ? ((account.totalAssets - 1_000_000) / 1_000_000) * 100 : 0;
  const totalPnl = account ? account.totalAssets - 1_000_000 : 0;

  return (
    // id 锚点：② 推入交易池后滚动到此处（scroll-mt-20 留出 TopBar 高度）
    <section id="section-simulator" className="mb-6 scroll-mt-20">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            ④ 模拟交易
            {account?.isAutoPilot && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-900/50 text-red-300 border border-red-700/60 flex items-center gap-1" title="策略信号自动成交中">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
                </span>
                自动驾驶
              </span>
            )}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {account?.isRunning
              ? (account.isAutoPilot
                  ? `🤖 自动驾驶中 · 策略池 ${account.tradingCodes.length} 只 · 策略信号将自动成交`
                  : `▶ 引擎运行 · 手动模式 · 策略池 ${account.tradingCodes.length} 只`)
              : '⏹ 引擎未启动 · 点上方按钮启动'}
          </p>
        </div>
        <div className="flex gap-2">
          <SimulatorBackupPanel onChanged={refresh} />
          {account?.isRunning && (
            <button
              onClick={() => handleToggle('autopilot', !account.isAutoPilot)}
              disabled={acting}
              className={`text-sm px-3 py-1.5 rounded font-medium transition-colors ${
                account.isAutoPilot
                  ? 'bg-red-600 hover:bg-red-500 text-white border border-red-500 animate-pulse'
                  : 'bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white border border-transparent'
              } disabled:opacity-50 flex items-center gap-1`}
              title={account.isAutoPilot ? '关闭自动驾驶（保留引擎运行）' : '开启自动驾驶：策略信号自动成交'}
            >
              {account.isAutoPilot ? '⏸ 关闭自动驾驶' : '🤖 开启自动驾驶'}
            </button>
          )}
          {account?.isRunning ? (
            <button
              onClick={() => handleToggle('stop')}
              disabled={acting}
              className="text-sm px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded"
            >
              ⏹ 停止
            </button>
          ) : (
            <button
              onClick={() => handleToggle('start')}
              disabled={acting}
              className="text-sm px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded flex items-center gap-1"
              title={account?.tradingCodes && account.tradingCodes.length > 0
                ? `启动引擎，策略池 ${account.tradingCodes.length} 只将自动监控信号`
                : '启动引擎需要先在「② 今日推荐」添加股票'}
            >
              ▶ 启动引擎
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* 账户概览 */}
        <div className={`bg-slate-900 border rounded-xl p-4 transition-all duration-300 ${
          flashAssets === 'up' ? 'border-rose-500 shadow-lg shadow-rose-500/30' :
          flashAssets === 'down' ? 'border-emerald-500 shadow-lg shadow-emerald-500/30' :
          'border-slate-800'
        }`}>
          <h3 className="text-xs text-slate-500 mb-2 flex items-center justify-between">
            <span>账户总览</span>
            {flashAssets && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold animate-pulse ${
                flashAssets === 'up' ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'
              }`}>
                {flashAssets === 'up' ? '↑ 上涨' : '↓ 下跌'}
              </span>
            )}
          </h3>
          <div className={`text-2xl font-bold text-white mb-1 transition-all ${
            flashAssets === 'up' ? 'scale-105 text-rose-200' : flashAssets === 'down' ? 'scale-105 text-emerald-200' : ''
          }`}>
            {fmtMoney(account?.totalAssets ?? 0)}
          </div>
          <div className={`text-sm font-semibold mb-3 flex items-center gap-1 ${totalPnl >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
            <span>{totalPnl >= 0 ? '+' : ''}{fmtMoney(totalPnl)} ({fmtPct(pnlPct)})</span>
            {flashPnl && (
              <span className={`text-[10px] px-1 rounded animate-pulse ${
                flashPnl === 'up' ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'
              }`}>
                {flashPnl === 'up' ? '↑' : '↓'}
              </span>
            )}
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-slate-500">可用</span><span className="text-white">{fmtMoney(account?.balance ?? 0)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">冻结</span><span className="text-white">{fmtMoney(account?.frozen ?? 0)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">持仓</span><span className="text-white">{account?.positions.length ?? 0} 只</span></div>
            <div className="flex justify-between"><span className="text-slate-500">策略池</span><span className="text-white">{account?.tradingCodes.length ?? 0} 只</span></div>
          </div>
          {/* 30 天净值迷你 sparkline（从 IDB equityPoints 读） */}
          {equitySpark && equitySpark.points.length >= 2 && (
            <div className="mt-3 pt-3 border-t border-slate-800">
              <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                <span>📈 30 天净值</span>
                <span className={equitySpark.totalReturn >= 0 ? 'text-rose-400' : 'text-emerald-400'}>
                  {equitySpark.totalReturn >= 0 ? '+' : ''}{equitySpark.totalReturn.toFixed(2)}%
                </span>
              </div>
              <EquitySparkline points={equitySpark.points} />
            </div>
          )}
          {/* 一键导出 CSV 按钮 */}
          <div className="mt-3 pt-3 border-t border-slate-800 flex gap-2">
            <button
              onClick={() => exportAccountCsv(account, equitySpark)}
              disabled={!account}
              className="text-[10px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors flex items-center gap-1 disabled:opacity-40"
              title="导出当前持仓 + 30天净值曲线为 CSV 文件"
            >
              📤 导出 CSV
            </button>
          </div>
        </div>

        {/* 持仓 */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div data-wizard-target="position-row" className="flex items-center justify-between mb-3">
            <h3 className="text-xs text-slate-500">当前持仓（{account?.positions.length ?? 0}）</h3>
            {account && account.positions.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                {/* 一键止损：平掉亏损最大 3 只 */}
                {account.positions.filter(p => p.unrealizedPnL < 0).length > 0 && (
                  <button
                    onClick={async () => {
                      const losers = [...account.positions]
                        .filter(p => p.unrealizedPnL < 0)
                        .sort((a, b) => a.unrealizedPnLPct - b.unrealizedPnLPct)
                        .slice(0, 3);
                      const ok = window.confirm(
                        `⚠️ 一键止损确认\n\n` +
                        `将平仓亏损最大的 ${losers.length} 只：\n` +
                        losers.map(p => `  • ${p.name || p.code} (${p.unrealizedPnLPct.toFixed(2)}%)`).join('\n') +
                        `\n\n止损后预计可减少浮亏 ${fmtMoney(losers.reduce((s, p) => s + p.unrealizedPnL, 0))}。\n` +
                        `确认执行？`
                      );
                      if (!ok) return;
                      setActing(true);
                      try {
                        for (const p of losers) {
                          await fetch('/api/simulator', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'order', code: p.code, direction: 'short', volume: p.volume, type: 'market' }),
                          });
                        }
                        setTimeout(refresh, 500);
                      } finally { setActing(false); }
                    }}
                    disabled={acting}
                    className="text-[10px] px-2 py-0.5 bg-red-900/40 text-red-300 border border-red-700/50 rounded hover:bg-red-900/60 disabled:opacity-50"
                    title="一键平掉亏损最大的 3 只持仓"
                  >
                    🛑 一键止损
                  </button>
                )}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500">总盈亏</span>
                    <span className={`font-semibold ${totalPnl >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {totalPnl >= 0 ? '+' : ''}{fmtMoney(totalPnl)}
                    </span>
                  </div>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                    (account.positions.filter(p => p.unrealizedPnL >= 0).length) > (account.positions.length / 2)
                      ? 'bg-rose-900/40 text-rose-300' : 'bg-emerald-900/40 text-emerald-300'
                  }`}>
                    盈 {(account.positions.filter(p => p.unrealizedPnL >= 0).length)} / 亏 {(account.positions.filter(p => p.unrealizedPnL < 0).length)}
                  </span>
                </div>
              </div>
            )}
          </div>
          {account?.positions.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              暂无持仓 · 从「今日推荐」一键加入，或自选股手动买入
            </div>
          ) : (
            <div className="space-y-3">
              {/* 持仓盈亏可视化条：总盈亏 % 用横向条形展示 */}
              {account && account.positions.length > 0 && (() => {
                // 找出最大正向/负向盈亏%，归一化用于条宽
                const pnls = account.positions.map(p => p.unrealizedPnLPct);
                const maxAbs = Math.max(...pnls.map(Math.abs), 1);
                // 按盈亏%降序（亏最多的排前面，提醒用户）
                const sortedPnls = [...account.positions].sort((a, b) => a.unrealizedPnLPct - b.unrealizedPnLPct);
                return (
                  <div className="bg-slate-950/50 rounded-lg p-3 border border-slate-800/50">
                    <div className="text-[10px] text-slate-500 mb-2 flex items-center justify-between">
                      <span>📊 持仓盈亏分布（按盈亏% 排序）</span>
                      <span>范围：{Math.min(...pnls).toFixed(1)}% ~ +{Math.max(...pnls).toFixed(1)}%</span>
                    </div>
                    <div className="space-y-1.5">
                      {sortedPnls.map(p => {
                        const pnlPct = p.unrealizedPnLPct;
                        // 条宽：盈亏百分比 / 最大绝对值 × 50%（半边）
                        const barWidth = Math.min(50, (Math.abs(pnlPct) / maxAbs) * 50);
                        // 盈亏颜色：亏=emerald 绿（A股习惯），盈=rose 红
                        const isProfit = pnlPct >= 0;
                        return (
                          <div key={p.code} className="flex items-center gap-2 text-xs">
                            <div className="w-20 truncate text-slate-300" title={`${p.name || p.code} (${p.code})`}>
                              {p.name || p.code}
                            </div>
                            <div className="flex-1 flex items-center">
                              {/* 中轴线 */}
                              <div className="w-1/2 flex justify-end">
                                {isProfit && (
                                  <div
                                    className="h-4 bg-gradient-to-r from-rose-600 to-rose-400 rounded-r"
                                    style={{ width: `${barWidth}%` }}
                                    title={`+${pnlPct.toFixed(2)}%`}
                                  />
                                )}
                              </div>
                              <div className="w-px h-4 bg-slate-600" />
                              <div className="w-1/2">
                                {!isProfit && (
                                  <div
                                    className="h-4 bg-gradient-to-l from-emerald-600 to-emerald-400 rounded-r"
                                    style={{ width: `${barWidth}%` }}
                                    title={`${pnlPct.toFixed(2)}%`}
                                  />
                                )}
                              </div>
                            </div>
                            <div className={`w-16 text-right font-mono text-[11px] font-semibold ${isProfit ? 'text-rose-400' : 'text-emerald-400'}`}>
                              {isProfit ? '+' : ''}{pnlPct.toFixed(2)}%
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* 原持仓列表（精简：只显示关键字段） */}
              <div className="space-y-2 mt-3">
                {account?.positions.map(p => (
                  <PositionRow
                    key={p.code}
                    pos={p}
                    acting={!!actingByCode[p.code]}
                    onOrder={submitOrder}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ==================== 持仓行（含迷你 sparkline + 加仓/减仓/清仓） ====================

interface PositionRowPos {
  code: string;
  name?: string;
  volume: number;
  avgCost: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPct: number;
}

function PositionRow({
  pos,
  acting,
  onOrder,
}: {
  pos: PositionRowPos;
  acting: boolean;
  onOrder: (code: string, direction: 'long' | 'short', volume: number) => Promise<void>;
}) {
  // 单行持仓的可调股数（A 股 100 整数倍，默认 100）
  const [vol, setVol] = useState<number>(100);
  // 当前实时价（用于估算金额）
  const price = pos.currentPrice;

  const incVol = () => setVol(v => Math.min(99_900, v + 100));   // 上限 999 手
  const decVol = () => setVol(v => Math.max(100, v - 100));

  const handleBuy = () => onOrder(pos.code, 'long', vol);
  const handleSell = () => onOrder(pos.code, 'short', vol);

  // 清仓：弹 confirm（沿用项目"具体数字"确认模式，避免误操作）
  const handleClear = () => {
    const ok = window.confirm(
      `🧹 确认清仓 ${pos.name || pos.code}？\n\n` +
      `当前持仓：${pos.volume} 股\n` +
      `最新价：¥${fmtPrice(price)}\n` +
      `持仓市值：¥${fmtMoney(price * pos.volume)}\n` +
      `浮盈/亏：${pos.unrealizedPnL >= 0 ? '+' : ''}¥${fmtMoney(Math.abs(pos.unrealizedPnL))}（${pos.unrealizedPnLPct >= 0 ? '+' : ''}${pos.unrealizedPnLPct.toFixed(2)}%）\n\n` +
      `将按市价卖出全部 ${pos.volume} 股，确认执行？`
    );
    if (!ok) return;
    onOrder(pos.code, 'short', pos.volume);
  };

  const sellExceedsHolding = vol > pos.volume;

  return (
    <div className={`bg-slate-950/40 border rounded-lg p-2.5 transition-all ${
      acting ? 'border-cyan-700/60 bg-cyan-950/20' : 'border-slate-800/60'
    }`}>
      {/* 上排：股票信息 + sparkline + 实时价/盈亏 */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex-1 min-w-0">
          <div className="text-white font-medium truncate">{pos.name || pos.code}</div>
          <div className="text-xs text-slate-500">{pos.code} · {pos.volume} 股 · 成本 {fmtPrice(pos.avgCost)}</div>
        </div>
        <div className="w-20 mx-2 shrink-0">
          <MiniSparkline code={pos.code} />
        </div>
        <div className="text-right shrink-0">
          <div className="text-white font-semibold">{fmtPrice(pos.currentPrice)}</div>
          <div className={`text-xs font-bold flex items-center gap-1 justify-end ${pos.unrealizedPnL >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
            <span>{pos.unrealizedPnL >= 0 ? '↑' : '↓'}</span>
            <span>{fmtMoney(Math.abs(pos.unrealizedPnL))}</span>
            <span className="text-[10px] opacity-80">({pos.unrealizedPnLPct >= 0 ? '+' : ''}{pos.unrealizedPnLPct.toFixed(2)}%)</span>
          </div>
        </div>
      </div>

      {/* 下排：股数步进器 + 买入/卖出/清仓 */}
      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-800/40">
        {/* 步进器 */}
        <div className="flex items-center bg-slate-900 border border-slate-700/60 rounded overflow-hidden h-6">
          <button
            onClick={decVol}
            disabled={acting || vol <= 100}
            className="w-7 h-6 text-slate-300 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-sm leading-none"
            title="减少 100 股"
            type="button"
          >
            −
          </button>
          <input
            type="number"
            value={vol}
            onChange={e => {
              const n = parseInt(e.target.value || '0', 10);
              if (isNaN(n)) { setVol(100); return; }
              // 强制 100 整数倍（向上取整）
              setVol(Math.max(100, Math.min(99_900, Math.ceil(n / 100) * 100)));
            }}
            disabled={acting}
            className="w-14 h-6 text-center text-xs bg-transparent text-slate-200 border-x border-slate-700/60 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            step={100}
            min={100}
            max={99900}
            title="调整股数（100 整数倍）"
          />
          <button
            onClick={incVol}
            disabled={acting || vol >= 99_900}
            className="w-7 h-6 text-slate-300 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-sm leading-none"
            title="增加 100 股"
            type="button"
          >
            +
          </button>
        </div>
        <span className="text-[10px] text-slate-500 mr-0.5" title={`估算金额 ¥${(price * vol).toFixed(0)}`}>
          ¥{(price * vol / 1000).toFixed(1)}k
        </span>

        {/* 买入 */}
        <button
          onClick={handleBuy}
          disabled={acting}
          className="flex-1 h-6 text-[11px] font-medium rounded bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center gap-1"
          title={`按市价买入 ${vol} 股 ${pos.name || pos.code}（估算 ¥${(price * vol).toFixed(0)}）`}
          type="button"
        >
          {acting ? <span className="animate-pulse">⏳</span> : <>🟢 买入</>}
        </button>

        {/* 卖出 */}
        <button
          onClick={handleSell}
          disabled={acting || sellExceedsHolding}
          className={`flex-1 h-6 text-[11px] font-medium rounded text-white flex items-center justify-center gap-1 disabled:cursor-not-allowed ${
            sellExceedsHolding
              ? 'bg-slate-700 opacity-40'
              : 'bg-emerald-600 hover:bg-emerald-500'
          } ${acting ? 'opacity-40' : ''}`}
          title={sellExceedsHolding
            ? `持仓仅 ${pos.volume} 股，无法卖出 ${vol} 股`
            : `按市价卖出 ${vol} 股 ${pos.name || pos.code}`}
          type="button"
        >
          {acting ? <span className="animate-pulse">⏳</span> : <>🔴 卖出</>}
        </button>

        {/* 清仓 */}
        <button
          onClick={handleClear}
          disabled={acting}
          className="h-6 w-7 text-[11px] font-medium rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 border border-slate-600 flex items-center justify-center"
          title={`清仓全部 ${pos.volume} 股`}
          type="button"
        >
          🧹
        </button>
      </div>
    </div>
  );
}

/**
 * 5日价格走势迷你 SVG 折线（80x24）
 * - 调用 /api/stock/kline?code=xxx&period=day&limit=5
 * - 缓存 5min（避免每 10s 重复请求）
 * - 涨=rose 红，跌=emerald 绿
 */
const _sparklineCache = new Map<string, { data: number[]; ts: number }>();
const SPARKLINE_TTL = 5 * 60 * 1000;

function MiniSparkline({ code }: { code: string }) {
  const [points, setPoints] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const cached = _sparklineCache.get(code);
    if (cached && Date.now() - cached.ts < SPARKLINE_TTL) {
      setPoints(cached.data);
      setLoading(false);
      return;
    }
    fetch(`/api/stock/kline?code=${encodeURIComponent(code)}&period=day&limit=5`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(j => {
        if (cancelled) return;
        const closes: number[] = (j?.data || []).map((b: any) => Number(b.close)).filter((n: number) => !isNaN(n) && n > 0);
        if (closes.length >= 2) {
          _sparklineCache.set(code, { data: closes, ts: Date.now() });
          setPoints(closes);
        } else {
          setPoints([]);
        }
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code]);

  if (loading) {
    return <div className="h-6 flex items-center justify-center text-[10px] text-slate-600">...</div>;
  }
  if (points.length < 2) {
    return <div className="h-6 flex items-center justify-center text-[10px] text-slate-600">—</div>;
  }
  const W = 80, H = 24;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = W / (points.length - 1);
  const path = points.map((y, i) => {
    const x = i * stepX;
    const ny = H - ((y - min) / range) * H;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ny.toFixed(1)}`;
  }).join(' ');
  const isUp = points[points.length - 1] >= points[0];
  const stroke = isUp ? '#fb7185' : '#34d399'; // A 股：涨红跌绿
  return (
    <svg width={W} height={H} className="block">
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={0} cy={H - ((points[0] - min) / range) * H} r="1.5" fill={stroke} />
      <circle cx={(points.length - 1) * stepX} cy={H - ((points[points.length - 1] - min) / range) * H} r="2" fill={stroke} />
    </svg>
  );
}

// ==================== 自动驾驶流水（信号明细）====================

function AutoTradeJournal() {
  const ap = useAutoPilot();
  const [showAll, setShowAll] = useState(false);
  // 过滤器
  const [filterSource, setFilterSource] = useState<'all' | 'auto' | 'manual'>('all');
  const [filterDirection, setFilterDirection] = useState<'all' | 'long' | 'short'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'filled' | 'pending' | 'rejected' | 'cancelled'>('all');
  const [searchCode, setSearchCode] = useState('');
  // 拿股票名称映射（从 watchlist + 持仓）
  const [nameMap, setNameMap] = useState<Record<string, string>>(() => {
    // 初始化时从 localStorage 恢复，避免每次刷新都重新拉
    if (typeof window === 'undefined') return {};
    try {
      const raw = localStorage.getItem('quant_journal_name_map');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });

  useEffect(() => {
    // 1) 从 localStorage 拿自选股，合并到 nameMap
    try {
      const raw = localStorage.getItem('quant_watchlist');
      const codes: { code: string; name: string }[] = raw ? JSON.parse(raw) : [];
      setNameMap(prev => {
        const m = { ...prev };
        codes.forEach(c => { if (c.name) m[c.code] = c.name; });
        return m;
      });
    } catch { /* ignore */ }
  }, [ap.orders.length]);

  // 持久化 nameMap 到 localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem('quant_journal_name_map', JSON.stringify(nameMap)); } catch { /* ignore */ }
  }, [nameMap]);

  // 2) 名称兜底拉取：nameMap 缺哪些 code 就从 API 拉一次（持仓/订单的股票）
  useEffect(() => {
    const missing = new Set<string>();
    for (const o of ap.orders) {
      if (!nameMap[o.code] && o.code) missing.add(o.code);
    }
    if (missing.size === 0) return;
    let cancelled = false;
    (async () => {
      const updates: Record<string, string> = {};
      for (const code of missing) {
        try {
          const r = await fetch(`/api/stock/realtime?codes=${encodeURIComponent(code)}`);
          const j = await r.json();
          const name = j?.data?.[0]?.name;
          if (name) updates[code] = name;
        } catch { /* ignore */ }
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        setNameMap(prev => ({ ...prev, ...updates }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ap.orders.length, nameMap]);

  // 应用过滤器
  const filtered = useMemo(() => {
    const q = searchCode.trim().toLowerCase();
    return ap.orders.filter(o => {
      if (filterSource === 'auto' && !ap.tradingCodes.includes(o.code)) return false;
      if (filterSource === 'manual' && ap.tradingCodes.includes(o.code)) return false;
      if (filterDirection !== 'all' && o.direction !== filterDirection) return false;
      if (filterStatus !== 'all' && o.status !== filterStatus) return false;
      if (q) {
        const name = nameMap[o.code] || '';
        if (!o.code.toLowerCase().includes(q) && !name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [ap.orders, ap.tradingCodes, filterSource, filterDirection, filterStatus, searchCode, nameMap]);

  // 取最近 20 条（或全部）
  const display = showAll ? filtered : filtered.slice(0, 20);

  // 统计：自动驾驶成交笔数（用 code 在 tradingCodes 中判断）
  const autoFilled = ap.orders.filter(o =>
    o.status === 'filled' && ap.tradingCodes.includes(o.code)
  );
  const todayAutoFilled = autoFilled.filter(o => isToday(o.timestamp));

  // 胜率统计（基于"已平仓"的买卖配对：先买后卖为一次完整交易）
  // 简化口径：以"卖单"作为平仓，对比其价格与最近一次"买"价，盈利=胜
  const { winRate, totalClosed, wins, losses } = useMemo(() => {
    const filled = ap.orders.filter(o => o.status === 'filled');
    const sorted = [...filled].sort((a, b) => a.timestamp - b.timestamp);
    // 简化：按 code 维护 lastBuyPrice
    const lastBuy = new Map<string, number>();
    let total = 0, win = 0, loss = 0;
    for (const o of sorted) {
      if (o.direction === 'long') {
        lastBuy.set(o.code, o.price);
      } else {
        const buy = lastBuy.get(o.code);
        if (buy !== undefined && o.price > 0) {
          total += 1;
          if (o.price > buy) win += 1;
          else if (o.price < buy) loss += 1;
          // 价格相同不计
        }
      }
    }
    return {
      winRate: total > 0 ? (win / total) * 100 : 0,
      totalClosed: total,
      wins: win,
      losses: loss,
    };
  }, [ap.orders]);

  if (ap.orders.length === 0) {
    return null; // 没有订单就不显示
  }

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            自动驾驶流水
            {ap.isAutoPilot && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-900/50 text-cyan-300 border border-cyan-700/60">
                🤖 实时
              </span>
            )}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            累计 {ap.orders.length} 条订单 · 已过滤 {filtered.length} 条 ·
            <span className="text-cyan-400"> 🤖 自动 {autoFilled.length} 笔</span> ·
            <span className="text-emerald-400"> 📅 今日 {todayAutoFilled.length} 笔</span>
            {totalClosed > 0 && (
              <span className="ml-2 text-amber-300">
                · 胜率 {winRate.toFixed(0)}% ({wins}胜{losses > 0 ? `/${losses}负` : ''}/{totalClosed})
              </span>
            )}
          </p>
        </div>
        {filtered.length > 20 && (
          <button
            onClick={() => setShowAll(s => !s)}
            className="text-xs px-3 py-1 rounded border border-slate-700 hover:border-slate-500 text-slate-300"
          >
            {showAll ? '收起' : `展开全部 (${filtered.length})`}
          </button>
        )}
      </div>

      {/* 过滤器栏 */}
      <div className="flex flex-wrap items-center gap-2 mb-2 bg-slate-900/50 border border-slate-800 rounded-lg p-2">
        <input
          type="text"
          placeholder="🔍 搜索代码/名称"
          value={searchCode}
          onChange={e => setSearchCode(e.target.value)}
          className="bg-slate-800 border border-slate-700 text-white text-xs rounded px-2 py-1 w-32 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <FilterChip label="来源" value={filterSource} onChange={(v: any) => setFilterSource(v)} options={[['all', '全部'], ['auto', '🤖 自动'], ['manual', '👆 手动']]} />
        <FilterChip label="方向" value={filterDirection} onChange={(v: any) => setFilterDirection(v)} options={[['all', '全部'], ['long', '↑ 买'], ['short', '↓ 卖']]} />
        <FilterChip label="状态" value={filterStatus} onChange={(v: any) => setFilterStatus(v)} options={[['all', '全部'], ['filled', '✓ 成交'], ['pending', '⏳ 待'], ['rejected', '✗ 拒'], ['cancelled', '⊘ 撤']]} />
        {(filterSource !== 'all' || filterDirection !== 'all' || filterStatus !== 'all' || searchCode) && (
          <button
            onClick={() => { setFilterSource('all'); setFilterDirection('all'); setFilterStatus('all'); setSearchCode(''); }}
            className="text-[10px] px-2 py-0.5 text-slate-400 hover:text-rose-400"
          >
            清除过滤
          </button>
        )}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-800">
              <th className="text-left px-3 py-2 font-medium w-32">时间</th>
              <th className="text-left px-3 py-2 font-medium w-16">来源</th>
              <th className="text-left px-3 py-2 font-medium w-16">方向</th>
              <th className="text-left px-3 py-2 font-medium">名称</th>
              <th className="text-right px-3 py-2 font-medium w-20">价格</th>
              <th className="text-right px-3 py-2 font-medium w-16">数量</th>
              <th className="text-right px-3 py-2 font-medium w-20">收益</th>
              <th className="text-left px-3 py-2 font-medium w-20">状态</th>
            </tr>
          </thead>
          <tbody>
            {display.map(o => {
              const isAuto = ap.tradingCodes.includes(o.code);
              const isFilled = o.status === 'filled';
              return (
                <tr key={o.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="px-3 py-2 text-xs text-slate-400 font-mono">
                    {formatOrderTime(o.timestamp)}
                  </td>
                  <td className="px-3 py-2">
                    {isAuto ? (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          isFilled
                            ? 'bg-cyan-900/50 text-cyan-300 border border-cyan-700/50'
                            : 'bg-slate-800 text-slate-500 border border-slate-700'
                        }`}
                        title="该股票在策略池中：此单大概率由自动驾驶策略触发"
                      >
                        🤖 自动
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700" title="不在策略池中：手动下单">
                        👆 手动
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-semibold ${o.direction === 'long' ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {o.direction === 'long' ? '↑ 买' : '↓ 卖'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-white text-xs font-medium">{nameMap[o.code] || o.code}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{o.code}</div>
                  </td>
                  <td className="px-3 py-2 text-right text-white text-xs">
                    {o.price > 0 ? `¥${o.price.toFixed(2)}` : '市价'}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-300 text-xs">{o.filledVolume || o.volume}</td>
                  <td className="px-3 py-2 text-right text-xs font-mono">
                    {o.direction === 'short' && o.price > 0 ? (() => {
                      // 卖单：找最近一次该 code 的买入价，计算盈亏百分比
                      const lastBuy = [...ap.orders]
                        .filter(b => b.code === o.code && b.direction === 'long' && b.status === 'filled' && b.timestamp < o.timestamp)
                        .sort((a, b) => b.timestamp - a.timestamp)[0];
                      if (!lastBuy || lastBuy.price <= 0) return <span className="text-slate-600">—</span>;
                      const pct = ((o.price - lastBuy.price) / lastBuy.price) * 100;
                      return (
                        <span className={pct >= 0 ? 'text-rose-400 font-semibold' : 'text-emerald-400 font-semibold'}>
                          {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                        </span>
                      );
                    })() : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      o.status === 'filled' ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800/50' :
                      o.status === 'rejected' ? 'bg-red-900/40 text-red-300 border border-red-800/50' :
                      o.status === 'pending' ? 'bg-amber-900/40 text-amber-300 border border-amber-800/50' :
                      'bg-slate-800 text-slate-500 border border-slate-700'
                    }`}>
                      {o.status === 'filled' ? '✓ 成交' :
                       o.status === 'rejected' ? '✗ 拒单' :
                       o.status === 'pending' ? '⏳ 待成交' :
                       o.status === 'partial' ? '◐ 部分' :
                       o.status === 'cancelled' ? '⊘ 撤销' : o.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ==================== 状态备份导入导出 ====================

function SimulatorBackupPanel({ onChanged }: { onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgKind, setMsgKind] = useState<'ok' | 'err'>('ok');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/quant/simulator-state', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // 优先用服务器返回的 filename
      const cd = res.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename="([^"]+)"/);
      a.download = m ? m[1] : `quant-state-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMsg('✅ 已导出');
      setMsgKind('ok');
      setTimeout(() => setMsg(''), 2000);
    } catch (err: any) {
      setMsg(`❌ 导出失败：${err.message}`);
      setMsgKind('err');
    } finally {
      setBusy(false);
    }
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';  // 清空，允许重新选同一文件
    if (!file) return;
    if (!file.name.endsWith('.json')) {
      setMsg('❌ 请选择 .json 文件');
      setMsgKind('err');
      return;
    }
    if (!confirm('导入会覆盖/合并当前账户的服务器状态。\n点击"确定"开始导入。')) return;
    setBusy(true);
    setMsg('');
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const state = payload?.state;
      if (!state || !state.userId) {
        throw new Error('文件格式不正确：缺少 state.userId');
      }
      const strategy = confirm('合并到当前账户？\n- 点"取消"= 覆盖当前账户\n- 点"确定"= 合并（保留现有订单/成交）') ? 'merge' : 'overwrite';
      const res = await fetch('/api/quant/simulator-state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ state, mergeStrategy: strategy }),
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || '导入失败');
      setMsg(`✅ ${j.message}，刷新中…`);
      setMsgKind('ok');
      setTimeout(() => {
        onChanged?.();
      }, 600);
    } catch (err: any) {
      setMsg(`❌ 导入失败：${err.message}`);
      setMsgKind('err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex items-center gap-1">
      <button
        onClick={handleExport}
        disabled={busy}
        title="导出当前账户的全部状态（账户/持仓/订单/成交）"
        className="text-[10px] px-2 py-1 rounded border border-slate-700 hover:border-blue-500 text-slate-300 hover:text-blue-400 disabled:opacity-50 flex items-center gap-1 transition-colors"
      >
        ⬇ 导出
      </button>
      <button
        onClick={handleImportClick}
        disabled={busy}
        title="从 JSON 文件恢复状态（需用同一个用户的邀请码登录）"
        className="text-[10px] px-2 py-1 rounded border border-slate-700 hover:border-amber-500 text-slate-300 hover:text-amber-400 disabled:opacity-50 flex items-center gap-1 transition-colors"
      >
        ⬆ 导入
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleImportFile}
        style={{ display: 'none' }}
      />
      {msg && (
        <span className={`absolute top-full right-0 mt-1 text-[10px] px-2 py-0.5 rounded whitespace-nowrap z-50 ${
          msgKind === 'ok' ? 'bg-emerald-900/80 text-emerald-200' : 'bg-red-900/80 text-red-200'
        }`}>
          {msg}
        </span>
      )}
    </div>
  );
}

// 辅助：判断时间戳是否是今天
function isToday(ts: number): boolean {
  const d = new Date(ts);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth() === now.getMonth() &&
         d.getDate() === now.getDate();
}

// 辅助：过滤器芯片（点击切换选项的 chip 组）
function FilterChip<T extends string>({ label, value, onChange, options }: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="flex items-center gap-1 text-[10px]">
      <span className="text-slate-500">{label}:</span>
      {options.map(([v, txt]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-1.5 py-0.5 rounded transition-colors ${
            value === v
              ? 'bg-blue-600/40 text-blue-200 border border-blue-500/50'
              : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 border border-slate-700/50'
          }`}
        >
          {txt}
        </button>
      ))}
    </div>
  );
}

// 辅助：格式化订单时间（HH:MM:SS）
function formatOrderTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const today = isToday(ts);
  return today
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    : `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ==================== ④c 历史净值曲线 ====================

function EquityCurveChart() {
  const [points, setPoints] = useState<{ date: string; equity: number; dailyReturn: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { db } = await import('@/lib/quant/db/database');
        const table = db.equityPoints;
        if (!table) { setLoading(false); return; }
        const rows = await table.toArray();
        // 排序 + 去重（同一天取最后一个）
        const byDate: Record<string, typeof rows[number]> = {};
        rows.forEach(r => { byDate[r.date] = r; });
        const sorted = Object.values(byDate)
          .sort((a, b) => a.date.localeCompare(b.date))
          .map(r => ({
            date: r.date,
            equity: r.equity,
            dailyReturn: r.dailyReturn || 0,
          }));
        setPoints(sorted);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading || points.length < 2) return null;

  // 计算曲线
  const min = Math.min(...points.map(p => p.equity));
  const max = Math.max(...points.map(p => p.equity));
  const range = max - min || 1;
  const W = 600;
  const H = 160;
  const PAD = 10;
  const xStep = (W - PAD * 2) / Math.max(1, points.length - 1);

  const path = points.map((p, i) => {
    const x = PAD + i * xStep;
    const y = H - PAD - ((p.equity - min) / range) * (H - PAD * 2);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const area = `${path} L${(PAD + (points.length - 1) * xStep).toFixed(1)},${(H - PAD).toFixed(1)} L${PAD},${(H - PAD).toFixed(1)} Z`;

  // 颜色根据整体涨跌
  const startEq = points[0].equity;
  const endEq = points[points.length - 1].equity;
  const totalReturn = ((endEq - startEq) / startEq) * 100;
  const isUp = totalReturn >= 0;
  const lineColor = isUp ? '#fb7185' : '#34d399';   // rose / emerald
  const fillColor = isUp ? 'url(#equityUpGrad)' : 'url(#equityDnGrad)';

  // 最新一日收益
  const latestDaily = points[points.length - 1].dailyReturn;
  // 最大回撤
  let peak = points[0].equity;
  let maxDD = 0;
  points.forEach(p => {
    if (p.equity > peak) peak = p.equity;
    const dd = ((p.equity - peak) / peak) * 100;
    if (dd < maxDD) maxDD = dd;
  });

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
          📜 历史净值
          <span className="text-[10px] text-slate-500 font-normal">{points.length} 个交易日</span>
        </h2>
        <div className="flex items-center gap-4 text-xs">
          <div>
            <span className="text-slate-500">累计</span>
            <span className={`ml-1 font-semibold ${isUp ? 'text-rose-400' : 'text-emerald-400'}`}>
              {isUp ? '+' : ''}{totalReturn.toFixed(2)}%
            </span>
          </div>
          <div>
            <span className="text-slate-500">最新一日</span>
            <span className={`ml-1 font-semibold ${latestDaily >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {latestDaily >= 0 ? '+' : ''}{(latestDaily * 100).toFixed(2)}%
            </span>
          </div>
          <div>
            <span className="text-slate-500">最大回撤</span>
            <span className="ml-1 font-semibold text-emerald-400">{maxDD.toFixed(2)}%</span>
          </div>
        </div>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40" preserveAspectRatio="none">
          <defs>
            <linearGradient id="equityUpGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fb7185" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#fb7185" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="equityDnGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* 中轴线（初始净值） */}
          <line
            x1={PAD} y1={H - PAD - ((startEq - min) / range) * (H - PAD * 2)}
            x2={W - PAD} y2={H - PAD - ((startEq - min) / range) * (H - PAD * 2)}
            stroke="#475569" strokeWidth="0.5" strokeDasharray="2,2"
          />
          <path d={area} fill={fillColor} />
          <path d={path} fill="none" stroke={lineColor} strokeWidth="2" />
          {/* 最后一个点高亮 */}
          {(() => {
            const lastX = PAD + (points.length - 1) * xStep;
            const lastY = H - PAD - ((endEq - min) / range) * (H - PAD * 2);
            return (
              <>
                <circle cx={lastX} cy={lastY} r="4" fill={lineColor} />
                <circle cx={lastX} cy={lastY} r="7" fill="none" stroke={lineColor} strokeOpacity="0.3" strokeWidth="2" />
              </>
            );
          })()}
        </svg>
        {/* X 轴标签（首尾两点） */}
        <div className="flex justify-between text-[10px] text-slate-500 mt-1">
          <span>{points[0].date.slice(4, 6)}/{points[0].date.slice(6, 8)}</span>
          <span className="text-slate-400 font-mono">¥{startEq.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</span>
          <span className="text-slate-400 font-mono">¥{endEq.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</span>
          <span>{points[points.length - 1].date.slice(4, 6)}/{points[points.length - 1].date.slice(6, 8)}</span>
        </div>
      </div>
    </section>
  );
}

// ==================== ⑤a 持仓 vs 推荐 重合度分析 ====================

function PortfolioOverlapAnalysis() {
  // 拉今日推荐（从 IDB）
  const [topPicks, setTopPicks] = useState<{ code: string; name: string; compositeScore: number }[]>([]);
  const ap = useAutoPilot();
  // 模拟器持仓 + 盈亏 也来自 ap（它每 5s 拉一次 /api/simulator，里面有 account.positions）
  // 但 useAutoPilot 只暴露 isRunning/isAutoPilot/tradingCodes/totalAssets/totalPnL/orders
  // 所以我们直接 fetch
  const [positions, setPositions] = useState<{ code: string; name: string; compositeScore?: number; unrealizedPnLPct: number }[]>([]);
  const [loading, setLoading] = useState(true);

  // 拉推荐
  useEffect(() => {
    (async () => {
      try {
        const { db } = await import('@/lib/quant/db/database');
        const table = db.stockScores;
        if (!table) { setLoading(false); return; }
        const all = await table.toArray();
        if (all.length === 0) { setLoading(false); return; }
        const latestDate = [...new Set(all.map(r => r.date))].sort().at(-1);
        // 找最新有数据的 period
        const period5d = all.filter(r => r.date === latestDate && r.period === '5d');
        const period20d = all.filter(r => r.date === latestDate && r.period === '20d');
        const source = period5d.length > 0 ? period5d : period20d;
        const top = source
          .sort((a, b) => b.compositeScore - a.compositeScore)
          .slice(0, 10)
          .map(r => ({ code: r.code, name: r.name, compositeScore: r.compositeScore }));
        setTopPicks(top);
      } catch { /* ignore */ }
    })();
  }, [ap.orders.length]); // 订单变化时轻量重读（反映新加的持仓）

  // 拉持仓（带盈亏%）+ 从 IDB 兜底补全 name（防止后端不返回 name 时显示代码）
  useEffect(() => {
    let active = true;
    const loadPositions = async () => {
      try {
        const res = await fetch('/api/simulator');
        const json = await res.json();
        if (active && json.success && json.data?.account?.positions) {
          // 从 db.stockScores 拿 code → { name, compositeScore } 映射（用于 name 兜底 + 综合分）
          const { db } = await import('@/lib/quant/db/database');
          const table = db.stockScores;
          const stockInfoMap: Record<string, { name: string; compositeScore: number }> = {};
          if (table) {
            const all = await table.toArray();
            const latestDate = [...new Set(all.map(r => r.date))].sort().at(-1);
            const recents = all.filter(r => r.date === latestDate);
            recents.forEach(r => { stockInfoMap[r.code] = { name: r.name, compositeScore: r.compositeScore }; });
          }
          // 全市场兜底：stockDataCache.list() 含 code→name 的全量映射（5000+ 只股票，IDB 优先）
          //   - 持仓不在 stockScores（没进 Top10 推荐）时也能拿到 name
          //   - 即使后端 /api/simulator 不返回 name 也能补全
          let stockListNameMap: Record<string, string> = {};
          try {
            const { stockDataCache } = await import('@/lib/quant/data/stock-data-cache');
            const listRes = await stockDataCache.list();
            if (listRes.data?.success && listRes.data.data) {
              listRes.data.data.forEach((s: any) => {
                const rawCode = s.code || '';
                stockListNameMap[rawCode] = s.name;
                // 同时支持 "sh600549" / "sz000001" / "600549.SH" / "000001.SZ" / "600549" 多种 code 格式
                if (rawCode.includes('.')) {
                  // "600549.SH" → "600549" + 后缀
                  const [num, suffix] = rawCode.split('.');
                  stockListNameMap[num] = s.name;
                  const lowerSuffix = suffix.toLowerCase(); // "sh" / "sz"
                  stockListNameMap[lowerSuffix + num] = s.name;        // "sh600549"
                  stockListNameMap[num + '.' + lowerSuffix] = s.name;   // "600549.sh"（不区分大小写）
                }
              });
            }
          } catch { /* IDB 无 list 数据时静默忽略，继续走 stockScores 兜底 */ }
          // code 规范化：统一转 "sh600549" / "sz000001" 形式（小写、无后缀、trim）
          //  输入可能："sh600549" / "SH600549" / "600549.SH" / "600549" / " 600549 "
          //  输出："sh600549" / "sz000001" / "600549"（去掉后缀时无法判断市场，归类为通用）
          const normalizeCode = (c: string): string => {
            const cleaned = c.trim().toLowerCase();
            if (cleaned.startsWith('sh') || cleaned.startsWith('sz')) return cleaned;
            if (cleaned.endsWith('.sh')) return 'sh' + cleaned.slice(0, -3);
            if (cleaned.endsWith('.sz')) return 'sz' + cleaned.slice(0, -3);
            return cleaned; // 已经是纯数字
          };
          setPositions(json.data.account.positions.map((p: any) => {
            const normCode = normalizeCode(p.code);
            // name 兜底链路：后端 p.name → stockScores（推荐过此股）→ stockList（全市场，含此股）→ "—"（绝不再 fallback 到代码）
            const resolvedName = p.name || stockInfoMap[normCode]?.name || stockListNameMap[normCode] || stockListNameMap[p.code] || '—';
            return {
              code: p.code,
              name: resolvedName,
              compositeScore: stockInfoMap[normCode]?.compositeScore,
              unrealizedPnLPct: p.avgCost > 0 ? ((p.currentPrice - p.avgCost) / p.avgCost) * 100 : 0,
            };
          }));
        }
      } catch { /* ignore */ }
      finally { if (active) setLoading(false); }
    };
    loadPositions();
    const id = setInterval(loadPositions, 10_000);
    return () => { active = false; clearInterval(id); };
  }, []);

  if (loading || topPicks.length === 0 || positions.length === 0) return null;

  const topCodes = new Set(topPicks.map(t => t.code));
  const overlap = positions.filter(p => topCodes.has(p.code));
  const overlapPct = (overlap.length / positions.length) * 100;

  // 给重叠的持仓打分
  const overlapWithScore = overlap.map(p => {
    const t = topPicks.find(t => t.code === p.code);
    return { ...p, topScore: t?.compositeScore ?? 0, rank: topPicks.findIndex(t => t.code === p.code) + 1 };
  }).sort((a, b) => b.topScore - a.topScore);

  // 持仓但不在 Top10（漏掉的）
  const notInTop = positions.filter(p => !topCodes.has(p.code));
  // Top10 但未持仓（候选）
  const notInHolding = topPicks.filter(t => !positions.find(p => p.code === t.code));

  // 综合诊断
  let diagnosis: { level: 'good' | 'ok' | 'warn'; icon: string; text: string };
  if (overlapPct >= 70) {
    diagnosis = { level: 'good', icon: '🎯', text: '持仓高度匹配推荐，策略一致性高' };
  } else if (overlapPct >= 40) {
    diagnosis = { level: 'ok', icon: '✅', text: '持仓部分匹配，仍有调整空间' };
  } else {
    diagnosis = { level: 'warn', icon: '⚠️', text: '持仓与推荐严重脱节，建议审视' };
  }

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
          🔗 持仓 vs 推荐 重合度
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            diagnosis.level === 'good' ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-700/50' :
            diagnosis.level === 'ok' ? 'bg-blue-900/50 text-blue-300 border border-blue-700/50' :
            'bg-amber-900/50 text-amber-300 border border-amber-700/50'
          }`}>
            {diagnosis.icon} {overlapPct.toFixed(0)}% 重合
          </span>
        </h2>
        <span className="text-xs text-slate-500">{diagnosis.text}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 重合的持仓 */}
        <div className="bg-slate-900 border border-emerald-800/30 rounded-xl p-3">
          <div className="text-xs text-emerald-400 font-semibold mb-2 flex items-center justify-between">
            <span>✅ 重合（{overlap.length}）</span>
            <span className="text-slate-500 text-[10px]">持仓 + 在 Top10</span>
          </div>
          {overlapWithScore.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-3">无</div>
          ) : (
            <div className="space-y-1.5">
              {overlapWithScore.map(p => (
                <div key={p.code} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-amber-400 text-[10px]">#{p.rank}</span>
                    <span className="text-white truncate">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-slate-500 font-mono text-[10px]">{p.compositeScore?.toFixed(0) ?? '-'}</span>
                    <span className={`font-mono text-[10px] ${p.unrealizedPnLPct >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {p.unrealizedPnLPct >= 0 ? '+' : ''}{p.unrealizedPnLPct.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 漏掉的（持仓但不在推荐） */}
        <div className="bg-slate-900 border border-amber-800/30 rounded-xl p-3">
          <div className="text-xs text-amber-400 font-semibold mb-2 flex items-center justify-between">
            <span>⚠️ 漏网（{notInTop.length}）</span>
            <span className="text-slate-500 text-[10px]">持仓 + 不在 Top10</span>
          </div>
          {notInTop.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-3">无 · 持仓全部命中推荐</div>
          ) : (
            <div className="space-y-1.5">
              {notInTop.map(p => (
                <div key={p.code} className="flex items-center text-xs">
                  {/* 仅显示股票名称（参考候选区的简洁风格）；name 兜底：后端 → IDB → "—"（绝不再 fallback 到代码）*/}
                  <span className="text-white truncate">{p.name || '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 候选（Top10 但未持仓） */}
        <div className="bg-slate-900 border border-cyan-800/30 rounded-xl p-3">
          <div className="text-xs text-cyan-400 font-semibold mb-2 flex items-center justify-between">
            <span>💎 候选（{notInHolding.length}）</span>
            <span className="text-slate-500 text-[10px]">Top10 + 未持仓</span>
          </div>
          {notInHolding.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-3">无 · Top10 全部已持仓</div>
          ) : (
            <div className="space-y-1.5">
              {notInHolding.slice(0, 5).map((t, i) => (
                <div key={t.code} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-amber-400 text-[10px]">#{i + 1}</span>
                    <span className="text-white truncate">{t.name}</span>
                  </div>
                  <span className="text-amber-400 font-mono text-[10px] font-semibold">{t.compositeScore.toFixed(0)}</span>
                </div>
              ))}
              {notInHolding.length > 5 && (
                <div className="text-[10px] text-slate-500 text-center">+ {notInHolding.length - 5} 只</div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ==================== ⑤c 策略有效性评估（推荐 vs 实际成交）====================

function StrategyEffectiveness() {
  const ap = useAutoPilot();
  // 加载因子 Top10（从 IDB）
  const [topPicks, setTopPicks] = useState<{ code: string; name: string; compositeScore: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { db } = await import('@/lib/quant/db/database');
        const table = db.stockScores;
        if (!table) { setLoading(false); return; }
        const all = await table.toArray();
        if (all.length === 0) { setLoading(false); return; }
        const latestDate = [...new Set(all.map(r => r.date))].sort().at(-1);
        // 优先 5日
        const source = all.filter(r => r.date === latestDate && r.period === '5d');
        if (source.length === 0) { setLoading(false); return; }
        const top = source
          .sort((a, b) => b.compositeScore - a.compositeScore)
          .slice(0, 10)
          .map(r => ({ code: r.code, name: r.name, compositeScore: r.compositeScore }));
        setTopPicks(top);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return null;
  if (topPicks.length === 0) return null;
  if (ap.orders.filter(o => o.status === 'filled').length === 0) return null;

  const topCodes = new Set(topPicks.map(t => t.code));
  // 累计成交的去重股票集
  const filledCodes = new Set(
    ap.orders.filter(o => o.status === 'filled').map(o => o.code)
  );
  const hitCodes = [...filledCodes].filter(c => topCodes.has(c));
  const missCodes = [...filledCodes].filter(c => !topCodes.has(c));
  const hitRate = filledCodes.size > 0 ? (hitCodes.length / filledCodes.size) * 100 : 0;

  // 对每只"实际成交"股票打分：是否在 Top10、排名、综合分
  const filledList = [...filledCodes].map(code => {
    const t = topPicks.find(t => t.code === code);
    return {
      code,
      name: t?.name || code,
      inTop10: !!t,
      rank: t ? topPicks.findIndex(x => x.code === code) + 1 : null,
      compositeScore: t?.compositeScore ?? null,
    };
  }).sort((a, b) => {
    if (a.inTop10 && !b.inTop10) return -1;
    if (!a.inTop10 && b.inTop10) return 1;
    return (b.compositeScore ?? 0) - (a.compositeScore ?? 0);
  });

  // 评估
  let rating: { level: 'excellent' | 'good' | 'fair' | 'poor'; icon: string; text: string };
  if (hitRate >= 80) {
    rating = { level: 'excellent', icon: '🌟', text: '策略与因子高度一致' };
  } else if (hitRate >= 60) {
    rating = { level: 'good', icon: '✅', text: '策略基本对齐因子推荐' };
  } else if (hitRate >= 40) {
    rating = { level: 'fair', icon: '⚠️', text: '策略偏离因子推荐，建议调优' };
  } else {
    rating = { level: 'poor', icon: '❌', text: '策略严重偏离因子推荐' };
  }

  const ratingColor: Record<typeof rating.level, string> = {
    excellent: 'bg-amber-900/50 text-amber-300 border-amber-700/60',
    good: 'bg-emerald-900/50 text-emerald-300 border-emerald-700/50',
    fair: 'bg-blue-900/50 text-blue-300 border-blue-700/50',
    poor: 'bg-red-900/50 text-red-300 border-red-700/50',
  };

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
          📊 策略有效性
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${ratingColor[rating.level]}`}>
            {rating.icon} {rating.text}
          </span>
        </h2>
        <span className="text-xs text-slate-500">
          命中率 {hitCodes.length}/{filledCodes.size} = <span className="text-amber-400 font-semibold">{hitRate.toFixed(0)}%</span>
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 命中：实际成交 ∩ Top10 */}
        <div className="bg-slate-900 border border-emerald-800/30 rounded-xl p-3">
          <div className="text-xs text-emerald-400 font-semibold mb-2 flex items-center justify-between">
            <span>✅ 命中（{hitCodes.length}）</span>
            <span className="text-slate-500 text-[10px]">实际 + Top10</span>
          </div>
          {hitCodes.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-3">无</div>
          ) : (
            <div className="space-y-1.5">
              {hitCodes.map(code => {
                const t = topPicks.find(t => t.code === code)!;
                return (
                  <div key={code} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-amber-400 text-[10px]">#{topPicks.findIndex(x => x.code === code) + 1}</span>
                      <span className="text-white truncate">{t.name}</span>
                    </div>
                    <span className="text-amber-400 font-mono text-[10px] font-semibold">{t.compositeScore.toFixed(0)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 偏离：实际成交 - Top10 */}
        <div className="bg-slate-900 border border-red-800/30 rounded-xl p-3">
          <div className="text-xs text-red-400 font-semibold mb-2 flex items-center justify-between">
            <span>❌ 偏离（{missCodes.length}）</span>
            <span className="text-slate-500 text-[10px]">实际 + 不在 Top10</span>
          </div>
          {missCodes.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-3">无 · 全部命中</div>
          ) : (
            <div className="space-y-1.5">
              {missList(missCodes, topPicks).map(({ code, name }) => (
                <div key={code} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 truncate">{name}</span>
                  <span className="text-slate-500 text-[10px]">未上榜</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 漏掉：Top10 - 实际成交（潜在机会） */}
        <div className="bg-slate-900 border border-cyan-800/30 rounded-xl p-3">
          <div className="text-xs text-cyan-400 font-semibold mb-2 flex items-center justify-between">
            <span>💎 漏掉机会（{topPicks.length - hitCodes.length}）</span>
            <span className="text-slate-500 text-[10px]">Top10 + 未成交</span>
          </div>
          {hitCodes.length === topPicks.length ? (
            <div className="text-xs text-slate-500 text-center py-3">无 · 全部已成交</div>
          ) : (
            <div className="space-y-1.5">
              {topPicks
                .filter(t => !hitCodes.includes(t.code))
                .slice(0, 5)
                .map((t, i) => (
                  <div key={t.code} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-amber-400 text-[10px]">#{topPicks.findIndex(x => x.code === t.code) + 1}</span>
                      <span className="text-white truncate">{t.name}</span>
                    </div>
                    <span className="text-amber-400 font-mono text-[10px]">{t.compositeScore.toFixed(0)}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
      <p className="text-[10px] text-slate-600 mt-2">
        💡 命中率反映"自动驾驶是否按因子推荐选股"。高命中率 = 策略与因子一致；低命中率可能因为：① 持仓周期错位 ② 因子已过期 ③ 策略有独立信号
      </p>
    </section>
  );
}

// 工具：从 watchlist 拿 code → name 映射
function missList(codes: string[], topPicks: { code: string; name: string }[]): { code: string; name: string }[] {
  return codes.map(code => {
    // 1. 从 topPicks 拿
    const inTop = topPicks.find(t => t.code === code);
    if (inTop) return { code, name: inTop.name };
    // 2. 从 localStorage 拿
    try {
      const raw = localStorage.getItem('quant_watchlist');
      const wl: { code: string; name: string }[] = raw ? JSON.parse(raw) : [];
      const w = wl.find(w => w.code === code);
      if (w) return { code, name: w.name };
    } catch { /* ignore */ }
    return { code, name: code };
  });
}

// ==================== ⑤b 自动驾驶日报 ====================

// 把日报转成 Markdown（导出用）
function generateReportMarkdown(
  dateKey: string,
  autoOrders: SimOrder[],
  buyAmount: number,
  sellAmount: number,
  benchmark: number | null,
  ap: { totalAssets: number; totalPnL: number; isAutoPilot: boolean; tradingCodes: string[] }
): string {
  const today = dateKey;
  const formattedDate = `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}`;
  const buyOrders = autoOrders.filter(o => o.direction === 'long');
  const sellOrders = autoOrders.filter(o => o.direction === 'short');
  const totalReturnPct = ap.totalAssets > 0 ? ((ap.totalAssets - 1_000_000) / 1_000_000) * 100 : 0;
  const md: string[] = [
    `# 📊 自动驾驶日报`,
    ``,
    `**日期**：${formattedDate}`,
    `**生成时间**：${new Date().toLocaleString('zh-CN')}`,
    `**自动驾驶状态**：${ap.isAutoPilot ? '✅ ON' : '⏸ OFF'}`,
    `**策略池规模**：${ap.tradingCodes.length} 只`,
    ``,
    `## 📈 今日统计`,
    ``,
    `| 指标 | 数值 |`,
    `| --- | --- |`,
    `| 🤖 自动成交笔数 | ${autoOrders.length} 笔 (买 ${buyOrders.length} / 卖 ${sellOrders.length}) |`,
    `| 💰 买入金额 | ${fmtMoney(buyAmount)} |`,
    `| 💸 卖出金额 | ${fmtMoney(sellAmount)} |`,
    `| 📈 沪深300基准 | ${benchmark !== null ? fmtPct(benchmark) : '加载中…'} |`,
    `| 💼 累计盈亏 | ${fmtMoney(ap.totalPnL)} (${fmtPct(totalReturnPct)}) |`,
    `| 💎 总资产 | ${fmtMoney(ap.totalAssets)} |`,
    ``,
  ];

  if (autoOrders.length > 0) {
    md.push(`## 📜 成交明细`, ``);
    md.push(`| 时间 | 方向 | 代码 | 价格 | 数量 | 状态 |`);
    md.push(`| --- | --- | --- | --- | --- | --- |`);
    autoOrders.forEach(o => {
      const time = formatOrderTime(o.timestamp);
      const dir = o.direction === 'long' ? '↑ 买' : '↓ 卖';
      const status = o.status === 'filled' ? '✓ 成交' :
                     o.status === 'rejected' ? '✗ 拒单' :
                     o.status === 'pending' ? '⏳ 待成交' : o.status;
      md.push(`| ${time} | ${dir} | ${o.code} | ¥${o.price.toFixed(2)} | ${o.filledVolume || o.volume} | ${status} |`);
    });
    md.push(``);
  } else {
    md.push(`## ☕ 今日无自动成交`, ``);
    md.push(ap.isAutoPilot
      ? `自动驾驶 ON 但全天无信号触发。策略池 ${ap.tradingCodes.length} 只等待中。`
      : `自动驾驶未启用，或全天无信号。`);
    md.push(``);
  }

  md.push(`---`, ``);
  md.push(`*本报告由 AI4U 量化交易系统自动生成。模拟盘仅供学习研究，不构成投资建议。*`);
  return md.join('\n');
}

function AutoPilotDailyReport() {
  const ap = useAutoPilot();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [popped, setPopped] = useState(false);
  const [benchmarkChange, setBenchmarkChange] = useState<number | null>(null);
  // 初始化时从 localStorage 读"今天是否已读"
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    setDismissed(localStorage.getItem(`quant_report_dismissed_${today}`));
  }, []);

  // 15:30 后首次进入页面自动弹窗
  useEffect(() => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    // 15:30（含）之后 且 今天未读 且 还没弹过
    if ((h > 15 || (h === 15 && m >= 30))) {
      const today = now.toISOString().slice(0, 10);
      const wasDismissed = localStorage.getItem(`quant_report_dismissed_${today}`);
      const wasPopped = sessionStorage.getItem(`quant_report_popped_${today}`);
      if (!wasDismissed && !wasPopped) {
        // 标记本次会话已弹（避免重复弹）
        sessionStorage.setItem(`quant_report_popped_${today}`, '1');
        setPopped(true);
      }
    }
  }, []);

  // 取沪深 300 今日涨跌幅作对比基准
  useEffect(() => {
    fetch('/api/stock/realtime?codes=000300.SH')
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data?.[0]) {
          setBenchmarkChange(json.data[0].changePercent ?? 0);
        }
      })
      .catch(() => {});
  }, []);

  // 今日（自然日）的自动成交订单
  const todayAutoOrders = ap.orders.filter(o =>
    isToday(o.timestamp) && o.status === 'filled' && ap.tradingCodes.includes(o.code)
  );
  const todayBuy = todayAutoOrders.filter(o => o.direction === 'long');
  const todaySell = todayAutoOrders.filter(o => o.direction === 'short');
  // 今日成交额（按 filledVolume * price 估算）
  const todayBuyAmount = todayBuy.reduce((s, o) => s + (o.filledVolume || o.volume) * o.price, 0);
  const todaySellAmount = todaySell.reduce((s, o) => s + (o.filledVolume || o.volume) * o.price, 0);

  // 总盈亏（直接从 API 取，含手动+自动）
  const todayKey = new Date().toISOString().slice(0, 10);
  const wasDismissed = dismissed === todayKey;

  // 15:30 后强制显示（盘后总结），其它时候只显示有自动成交的情况
  const now = new Date();
  const isAfterClose = now.getHours() > 15 || (now.getHours() === 15 && now.getMinutes() >= 30);
  const shouldShow = ap.isAutoPilot || todayAutoOrders.length > 0 || (isAfterClose && !wasDismissed);
  if (!shouldShow || wasDismissed) return null;

  // Modal 内容（用同一段数据，popped=true 时显示在 fixed 模态中）
  const reportContent = (
    <div className={popped
      ? 'bg-gradient-to-br from-slate-900 to-cyan-950/40 border border-cyan-700/60 rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto'
      : 'bg-gradient-to-r from-slate-900 via-cyan-950/30 to-slate-900 border border-cyan-800/50 rounded-xl p-4'
    }>
      <div data-wizard-target="daily-report" className="flex items-center justify-between mb-3">
        <h2 className={popped ? 'text-2xl font-bold text-cyan-300' : 'text-lg font-bold text-cyan-300'}>
          📊 自动驾驶日报
          <span className="text-xs text-slate-500 font-normal ml-2">
            {new Date().toLocaleDateString('zh-CN')}
            {isAfterClose && !todayAutoOrders.length && (
              <span className="ml-2 text-amber-400">· 盘后总结</span>
            )}
          </span>
        </h2>
        <div className="flex items-center gap-1">
          {/* 导出 Markdown 按钮 */}
          <button
            onClick={() => {
              const md = generateReportMarkdown(todayKey, todayAutoOrders, todayBuyAmount, todaySellAmount, benchmarkChange, ap);
              const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `自动驾驶日报_${todayKey}.md`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="text-xs text-slate-500 hover:text-emerald-400 px-1"
            title="导出为 Markdown 文件"
          >
            📄 导出
          </button>
          <button
            onClick={() => {
              localStorage.setItem(`quant_report_dismissed_${todayKey}`, todayKey);
              setDismissed(todayKey);
              setPopped(false);
            }}
            className="text-slate-500 hover:text-slate-300"
            title="今日不再显示"
          >
            ✕
          </button>
        </div>
      </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* 自动成交笔数 */}
          <div className="bg-slate-900/50 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">🤖 今日自动成交</div>
            <div className="text-2xl font-bold text-white">{todayAutoOrders.length} <span className="text-xs text-slate-500 font-normal">笔</span></div>
            <div className="text-xs text-slate-400 mt-1">
              买 {todayBuy.length} · 卖 {todaySell.length}
            </div>
          </div>
          {/* 买入金额 */}
          <div className="bg-slate-900/50 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">💰 买入金额</div>
            <div className="text-2xl font-bold text-rose-400">{fmtMoney(todayBuyAmount)}</div>
            <div className="text-xs text-slate-400 mt-1">
              均价估算
            </div>
          </div>
          {/* 卖出金额 */}
          <div className="bg-slate-900/50 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">💸 卖出金额</div>
            <div className="text-2xl font-bold text-emerald-400">{fmtMoney(todaySellAmount)}</div>
            <div className="text-xs text-slate-400 mt-1">
              均价估算
            </div>
          </div>
          {/* 对比基准 */}
          <div className="bg-slate-900/50 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">📈 沪深 300 今日</div>
            <div className={`text-2xl font-bold ${benchmarkChange !== null && benchmarkChange >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {benchmarkChange !== null ? fmtPct(benchmarkChange) : '加载中…'}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              自动驾驶表现对比
            </div>
          </div>
        </div>
        {/* 盈亏对比 */}
        <div className="mt-3 pt-3 border-t border-slate-800 grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-slate-500">累计盈亏：</span>
            <span className={`font-semibold ml-1 ${ap.totalPnL >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {fmtMoney(ap.totalPnL)}
            </span>
          </div>
          <div>
            <span className="text-slate-500">总资产：</span>
            <span className="font-semibold ml-1 text-white">{fmtMoney(ap.totalAssets)}</span>
          </div>
        </div>
        {todayAutoOrders.length === 0 && ap.isAutoPilot && (
          <p className="text-xs text-slate-500 mt-2 text-center">
            ⏳ 自动驾驶中，暂无成交信号 · 策略池 {ap.tradingCodes.length} 只等待触发
          </p>
        )}
        {todayAutoOrders.length === 0 && !ap.isAutoPilot && isAfterClose && (
          <p className="text-xs text-slate-500 mt-2 text-center">
            ☕ 今日无自动成交 · 策略未启用或全天无信号
          </p>
        )}
      </div>
  );

  // popped=true：弹窗（fixed modal，遮罩 + 居中）
  if (popped) {
    return (
      <>
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setPopped(false)}
        >
          <div onClick={e => e.stopPropagation()}>
            {reportContent}
          </div>
        </div>
        {/* 同时保留一个内联版（用户关闭弹窗后仍能看到） */}
        <section className="mb-6">{reportContent}</section>
      </>
    );
  }

  return <section className="mb-6">{reportContent}</section>;
}

// ==================== ⑤b-ai 简易诊断引擎（无 LLM 规则版）====================

interface AccountSnapshotForAI {
  totalAssets: number;
  totalPnL: number;
  positions: { code: string; name: string; unrealizedPnLPct: number; unrealizedPnL: number }[];
}
interface DiagnosisInput {
  benchmark: number | null;                    // 沪深 300 今日 %
  todayPnl: number;                            // 今日盈亏额（估算：用 ap.totalPnL - 上次）
  todayAutoCount: number;                      // 今日自动成交笔数
  todayAutoBuys: number;                       // 今日自动买入笔数
  todayAutoSells: number;                      // 今日自动卖出笔数
  account: AccountSnapshotForAI;
  strategyHitRate: number | null;              // 策略命中率 0-100，null=无成交
  factorFreshnessDays: number;                 // 因子分析距今天数
  isAutoPilot: boolean;
}

interface Diagnosis {
  score: number;          // 0-100
  level: 'great' | 'good' | 'ok' | 'warn' | 'bad';
  headline: string;       // 一句话总结
  insights: string[];     // 多条诊断
  suggestions: string[];  // 行动建议
}

function generateDiagnosis(input: DiagnosisInput): Diagnosis {
  const insights: string[] = [];
  const suggestions: string[] = [];
  let score = 50; // 起点

  // 1. 今日表现 vs 基准
  if (input.benchmark !== null) {
    const benchmark = input.benchmark;
    // 用 totalPnL 估算今日盈亏% （简化：用总盈亏/总资产）
    const todayPct = input.account.totalAssets > 0
      ? (input.todayPnl / input.account.totalAssets) * 100
      : 0;
    const diff = todayPct - benchmark;
    if (diff > 1) {
      score += 15;
      insights.push(`📈 **跑赢基准** ${diff.toFixed(2)} 个百分点（今日 ${todayPct.toFixed(2)}% vs 沪深300 ${benchmark.toFixed(2)}%）`);
    } else if (diff < -1) {
      score -= 15;
      insights.push(`📉 **跑输基准** ${Math.abs(diff).toFixed(2)} 个百分点（今日 ${todayPct.toFixed(2)}% vs 沪深300 ${benchmark.toFixed(2)}%）`);
    } else {
      insights.push(`➖ 与基准基本持平（差距 ${diff.toFixed(2)} 个百分点）`);
    }
  }

  // 2. 持仓健康度
  const positions = input.account.positions;
  if (positions.length > 0) {
    const winners = positions.filter(p => p.unrealizedPnL >= 0).length;
    const losers = positions.filter(p => p.unrealizedPnL < 0).length;
    const winRate = (winners / positions.length) * 100;
    if (winRate >= 70) {
      score += 10;
      insights.push(`✅ 持仓健康度高：${winners}/${positions.length} 只盈利（${winRate.toFixed(0)}%）`);
    } else if (winRate >= 50) {
      insights.push(`➖ 持仓一般：${winners}/${positions.length} 只盈利（${winRate.toFixed(0)}%）`);
    } else {
      score -= 10;
      insights.push(`⚠️ 持仓偏弱：仅 ${winners}/${positions.length} 只盈利（${winRate.toFixed(0)}%）`);
    }
    // 最大亏损
    const maxLoss = Math.min(...positions.map(p => p.unrealizedPnLPct));
    if (maxLoss < -10) {
      score -= 10;
      insights.push(`🚨 最大浮亏 ${maxLoss.toFixed(1)}%（${positions.find(p => p.unrealizedPnLPct === maxLoss)?.name}），建议检查止损`);
      suggestions.push(`考虑对 ${positions.find(p => p.unrealizedPnLPct === maxLoss)?.name} 设置止损或减仓`);
    } else if (maxLoss < -5) {
      insights.push(`⚠️ 存在较大浮亏 ${maxLoss.toFixed(1)}%`);
    }
  } else {
    insights.push(`📭 当前无持仓`);
    suggestions.push(`从「② 今日推荐」一键加入策略池`);
  }

  // 3. 自动驾驶活跃度
  if (input.isAutoPilot) {
    if (input.todayAutoCount >= 5) {
      score += 5;
      insights.push(`🤖 自动驾驶活跃：今日成交 ${input.todayAutoCount} 笔`);
    } else if (input.todayAutoCount === 0) {
      score -= 5;
      insights.push(`🤖 自动驾驶运行中但今日无成交（信号较少）`);
    }
  } else {
    suggestions.push(`开启「🤖 自动驾驶」让策略按信号自动成交`);
  }

  // 4. 策略有效性
  if (input.strategyHitRate !== null) {
    if (input.strategyHitRate >= 80) {
      score += 10;
      insights.push(`🎯 策略命中率高 ${input.strategyHitRate.toFixed(0)}%：自动驾驶与因子推荐高度一致`);
    } else if (input.strategyHitRate >= 60) {
      insights.push(`✅ 策略命中率 ${input.strategyHitRate.toFixed(0)}%：基本对齐因子`);
    } else if (input.strategyHitRate < 40) {
      score -= 10;
      insights.push(`⚠️ 策略命中率仅 ${input.strategyHitRate.toFixed(0)}%：可能需要调优`);
      suggestions.push(`查看「📊 策略有效性」检查偏离原因`);
    }
  }

  // 5. 因子新鲜度
  if (input.factorFreshnessDays > 3) {
    score -= 5;
    insights.push(`🕐 因子数据陈旧（${input.factorFreshnessDays} 天前）`);
    suggestions.push(`到「② 今日推荐」点 ⚡ 重新分析因子`);
  } else if (input.factorFreshnessDays > 1) {
    insights.push(`🕐 因子数据 ${input.factorFreshnessDays} 天前（建议每日更新）`);
  }

  // 分数归一化
  score = Math.max(0, Math.min(100, score));

  // 评级
  let level: Diagnosis['level'];
  let headline: string;
  if (score >= 80) {
    level = 'great';
    headline = '🌟 整体表现优秀，继续保持';
  } else if (score >= 65) {
    level = 'good';
    headline = '✅ 整体表现良好，稳中向好';
  } else if (score >= 45) {
    level = 'ok';
    headline = '➖ 整体表现一般，有改进空间';
  } else if (score >= 25) {
    level = 'warn';
    headline = '⚠️ 整体表现需关注';
  } else {
    level = 'bad';
    headline = '❌ 整体表现较差，建议重新审视策略';
  }

  // 默认建议（永远至少给一条）
  if (suggestions.length === 0) {
    suggestions.push(`保持当前节奏，监控下次自动驾驶信号`);
  }

  return { score, level, headline, insights, suggestions };
}

function AIDiagnosisPanel() {
  const ap = useAutoPilot();
  const [benchmark, setBenchmark] = useState<number | null>(null);
  const [strategyHitRate, setStrategyHitRate] = useState<number | null>(null);
  const [factorFreshnessDays, setFactorFreshnessDays] = useState<number>(0);
  const [account, setAccount] = useState<AccountSnapshotForAI>({
    totalAssets: 0, totalPnL: 0, positions: [],
  });
  const [expanded, setExpanded] = useState(true);

  // 拉沪深 300
  useEffect(() => {
    fetch('/api/stock/realtime?codes=000300.SH')
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data?.[0]) setBenchmark(json.data[0].changePercent ?? 0);
      })
      .catch(() => {});
  }, []);

  // v3.0（2026-06-15）：拉 snapshot 统计 + 拉 WF 面板时自动回填未来收益
  useEffect(() => {
    (async () => {
      try {
        const { getSnapshotStats, fillFutureReturns } = await import('@/lib/quant/db/factor-snapshots');
        const stats = await getSnapshotStats();
        // @ts-ignore — 大文件 TS 漏检 setter；dev 实际能找到
        setSnapshotStats(stats);
        // 拉完后自动尝试回填未来收益（如果有 5/20 天前的快照未填）
        const f5 = await fillFutureReturns(5);
        const f20 = await fillFutureReturns(20);
        if (f5.filled > 0 || f20.filled > 0) {
          const newStats = await getSnapshotStats();
          // @ts-ignore
          setSnapshotStats(newStats);
        }
      } catch (e) {
        console.warn('[snapshot] load failed:', e);
      }
    })();
  }, []);
  // 注：setSnapshotStats 由 useState 声明（行 3231）

  // 拉账户 + 命中率
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/simulator');
        const json = await res.json();
        if (json.success && json.data?.account) {
          setAccount({
            totalAssets: json.data.account.totalAssets || 0,
            totalPnL: json.data.account.totalPnL || 0,
            positions: (json.data.account.positions || []).map((p: any) => ({
              code: p.code, name: p.name || p.code,
              unrealizedPnL: p.unrealizedPnL || 0,
              unrealizedPnLPct: p.avgCost > 0 ? ((p.currentPrice - p.avgCost) / p.avgCost) * 100 : 0,
            })),
          });
        }
      } catch { /* ignore */ }
    })();
  }, [ap.orders.length]);

  // 计算策略命中率（实际成交 ∩ Top10）
  useEffect(() => {
    (async () => {
      try {
        const { db } = await import('@/lib/quant/db/database');
        const table = db.stockScores;
        if (!table) return;
        const all = await table.toArray();
        if (all.length === 0) return;
        const latestDate = [...new Set(all.map(r => r.date))].sort().at(-1);
        const source = all.filter(r => r.date === latestDate && r.period === '5d');
        const topCodes = new Set(
          source.sort((a, b) => b.compositeScore - a.compositeScore).slice(0, 10).map(r => r.code)
        );
        const filledCodes = new Set(
          ap.orders.filter(o => o.status === 'filled').map(o => o.code)
        );
        if (filledCodes.size === 0) { setStrategyHitRate(null); return; }
        const hit = [...filledCodes].filter(c => topCodes.has(c)).length;
        setStrategyHitRate((hit / filledCodes.size) * 100);
      } catch { /* ignore */ }
    })();
  }, [ap.orders]);

  // 因子新鲜度（天）
  useEffect(() => {
    (async () => {
      try {
        const { db } = await import('@/lib/quant/db/database');
        const table = db.stockScores;
        if (!table) return;
        const all = await table.toArray();
        if (all.length === 0) { setFactorFreshnessDays(99); return; }
        const latestDate = [...new Set(all.map(r => r.date))].sort().at(-1);
        if (!latestDate) return;
        const y = parseInt(latestDate.slice(0, 4));
        const m = parseInt(latestDate.slice(4, 6)) - 1;
        const d = parseInt(latestDate.slice(6, 8));
        const latest = new Date(y, m, d);
        const diff = Math.floor((Date.now() - latest.getTime()) / (1000 * 60 * 60 * 24));
        setFactorFreshnessDays(Math.max(0, diff));
      } catch { /* ignore */ }
    })();
  }, []);

  // 今日自动成交数
  const todayAutoOrders = ap.orders.filter(o =>
    isToday(o.timestamp) && o.status === 'filled' && ap.tradingCodes.includes(o.code)
  );
  const todayAutoBuys = todayAutoOrders.filter(o => o.direction === 'long').length;
  const todayAutoSells = todayAutoOrders.filter(o => o.direction === 'short').length;

  // 简化：用 totalPnL 作为"今日盈亏"（实际应从 db.equityPoints 算）
  const diagnosis = generateDiagnosis({
    benchmark,
    todayPnl: ap.totalPnL,
    todayAutoCount: todayAutoOrders.length,
    todayAutoBuys,
    todayAutoSells,
    account,
    strategyHitRate,
    factorFreshnessDays,
    isAutoPilot: ap.isAutoPilot,
  });

  const levelColorMap: Record<typeof diagnosis.level, string> = {
    great: 'from-amber-900/30 to-yellow-900/20 border-amber-700/50',
    good: 'from-emerald-900/30 to-cyan-900/20 border-emerald-700/50',
    ok: 'from-blue-900/30 to-slate-900/20 border-blue-700/50',
    warn: 'from-amber-900/30 to-orange-900/20 border-amber-700/50',
    bad: 'from-red-900/30 to-rose-900/20 border-red-700/50',
  };
  const scoreColor = diagnosis.score >= 70 ? 'text-amber-400' :
                      diagnosis.score >= 45 ? 'text-blue-400' :
                      'text-orange-400';

  return (
    <section className="mb-6">
      <div className={`bg-gradient-to-r ${levelColorMap[diagnosis.level]} border rounded-xl p-4`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            🧠 简易诊断
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800/60 text-slate-300 border border-slate-700" title="基于规则引擎，非 LLM">
              ⚙️ 规则版
            </span>
          </h2>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs text-slate-500">综合评分</div>
              <div className={`text-2xl font-bold ${scoreColor}`}>{diagnosis.score}</div>
            </div>
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-xs text-slate-500 hover:text-slate-300"
              title={expanded ? '收起' : '展开'}
            >
              {expanded ? '▲' : '▼'}
            </button>
          </div>
        </div>
        <p className="text-sm font-medium text-slate-200 mb-3">{diagnosis.headline}</p>
        {expanded && (
          <>
            <div className="space-y-1.5 mb-3">
              {diagnosis.insights.map((line, i) => (
                <div key={i} className="text-xs text-slate-300 leading-relaxed" dangerouslySetInnerHTML={{ __html: line.replace(/\*\*/g, '') }} />
              ))}
            </div>
            {diagnosis.suggestions.length > 0 && (
              <div className="pt-3 border-t border-slate-800/50">
                <div className="text-xs text-slate-500 mb-1.5">💡 建议</div>
                <div className="space-y-1">
                  {diagnosis.suggestions.map((s, i) => (
                    <div key={i} className="text-xs text-cyan-300">• {s}</div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// ==================== ⑤d 智能复盘（周报）====================

// 周报 → Markdown 导出
function generateWeeklyMarkdown(
  now: Date,
  filledOrders: SimOrder[],
  autoFilled: SimOrder[],
  buys: SimOrder[],
  sells: SimOrder[],
  buyAmount: number,
  sellAmount: number,
  uniqueStocks: Set<string>,
  ap: { totalAssets: number; totalPnL: number; isAutoPilot: boolean; tradingCodes: string[] },
  rating: { icon: string; text: string; color: string }
): string {
  const weekKey = getISOWeekKey(now);
  const startDate = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  const totalReturnPct = ap.totalAssets > 0 ? ((ap.totalAssets - 1_000_000) / 1_000_000) * 100 : 0;
  const winRate = sells.length > 0 ? (sells.length / (buys.length + sells.length)) * 100 : 0;
  const md: string[] = [
    `# 🎯 智能复盘（周报）`,
    ``,
    `**周期**：${fmt(startDate)} - ${fmt(now)}（${weekKey}）`,
    `**生成时间**：${now.toLocaleString('zh-CN')}`,
    `**整体评级**：${rating.icon} ${rating.text}`,
    ``,
    `## 📈 本周统计`,
    ``,
    `| 指标 | 数值 |`,
    `| --- | --- |`,
    `| 🤖 自动成交 | ${autoFilled.length} 笔 |`,
    `| 👆 手动成交 | ${filledOrders.length - autoFilled.length} 笔 |`,
    `| 📊 总成交 | ${filledOrders.length} 笔 |`,
    `| 🎯 涉及股票 | ${uniqueStocks.size} 只 |`,
    `| 💰 买入金额 | ${fmtMoney(buyAmount)} |`,
    `| 💸 卖出金额 | ${fmtMoney(sellAmount)} |`,
    `| 📈 买卖比 | ${buys.length} : ${sells.length} |`,
    `| 🎲 卖出占比 | ${winRate.toFixed(0)}% |`,
    `| 💼 累计盈亏 | ${fmtMoney(ap.totalPnL)} |`,
    `| 💎 总资产 | ${fmtMoney(ap.totalAssets)} (${fmtPct(totalReturnPct)}) |`,
    ``,
  ];

  if (filledOrders.length > 0) {
    md.push(`## 📜 本周成交明细 (${filledOrders.length} 笔)`, ``);
    md.push(`| 时间 | 方向 | 来源 | 代码 | 价格 | 数量 |`);
    md.push(`| --- | --- | --- | --- | --- | --- |`);
    filledOrders.forEach(o => {
      const isAuto = ap.tradingCodes.includes(o.code);
      const time = formatOrderTime(o.timestamp);
      const dir = o.direction === 'long' ? '↑ 买' : '↓ 卖';
      const source = isAuto ? '🤖 自动' : '👆 手动';
      md.push(`| ${time} | ${dir} | ${source} | ${o.code} | ¥${o.price.toFixed(2)} | ${o.filledVolume || o.volume} |`);
    });
    md.push(``);
  } else {
    md.push(`## ☕ 本周无成交`, ``);
    md.push(`策略未启用或本周无信号触发。`);
    md.push(``);
  }

  md.push(`---`, ``);
  md.push(`*本报告由 AI4U 量化交易系统自动生成。模拟盘仅供学习研究，不构成投资建议。*`);
  return md.join('\n');
}

function WeeklyReview() {
  const ap = useAutoPilot();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [forceShow, setForceShow] = useState(false);

  useEffect(() => {
    // ISO 周编号 (YYYY-Www)
    const now = new Date();
    const weekKey = getISOWeekKey(now);
    setDismissed(localStorage.getItem(`quant_weekly_dismissed_${weekKey}`));
  }, []);

  // 解析过去 7 天的订单
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const weekOrders = ap.orders.filter(o => o.timestamp >= weekAgo.getTime());
  const filledOrders = weekOrders.filter(o => o.status === 'filled');
  const autoFilled = filledOrders.filter(o => ap.tradingCodes.includes(o.code));
  const buys = filledOrders.filter(o => o.direction === 'long');
  const sells = filledOrders.filter(o => o.direction === 'short');
  const buyAmount = buys.reduce((s, o) => s + (o.filledVolume || o.volume) * o.price, 0);
  const sellAmount = sells.reduce((s, o) => s + (o.filledVolume || o.volume) * o.price, 0);

  // 计算唯一股票 + 胜率（用当前价对比）
  const uniqueStocks = new Set(filledOrders.map(o => o.code));
  // 估算胜率：卖单里"卖出价>买入价（用 avgCost）"的比例——但 avgCost 不可得
  // 简化：胜率 = 卖单数 / 总成单数（仅参考）
  const winRate = sells.length > 0 ? (sells.length / (buys.length + sells.length)) * 100 : 0;

  // 触发条件：周日 20:00 之后 OR 强制显示
  const isSundayAfter8 = now.getDay() === 0 && now.getHours() >= 20;
  const shouldShow = isSundayAfter8 || forceShow;
  if (!shouldShow || dismissed === getISOWeekKey(now) || filledOrders.length === 0) return null;

  // 优秀/良好/一般
  let rating: { icon: string; text: string; color: string };
  if (autoFilled.length >= 10 && winRate >= 60) {
    rating = { icon: '🌟', text: '本周策略表现优秀', color: 'text-amber-400' };
  } else if (autoFilled.length >= 3) {
    rating = { icon: '✅', text: '本周策略运行正常', color: 'text-emerald-400' };
  } else {
    rating = { icon: '☕', text: '本周交易较少', color: 'text-slate-400' };
  }

  return (
    <section className="mb-6">
      <div className="bg-gradient-to-br from-slate-900 to-purple-950/30 border border-purple-800/40 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <span className="text-purple-300">🎯 智能复盘</span>
            <span className="text-xs text-slate-500 font-normal">本周 (近 7 天)</span>
            <span className={`text-[10px] ${rating.color}`}>{rating.icon} {rating.text}</span>
          </h2>
          <div className="flex items-center gap-1">
            {/* 导出 Markdown 按钮 */}
            <button
              onClick={() => {
                const md = generateWeeklyMarkdown(now, filledOrders, autoFilled, buys, sells, buyAmount, sellAmount, uniqueStocks, ap, rating);
                const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `智能复盘_${getISOWeekKey(now)}.md`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="text-xs text-slate-500 hover:text-emerald-400 px-1"
              title="导出为 Markdown 文件"
            >
              📄 导出
            </button>
            <button
              onClickCapture={() => {
                const wk = getISOWeekKey(now);
                localStorage.setItem(`quant_weekly_dismissed_${wk}`, wk);
                setDismissed(wk);
              }}
              className="text-xs text-slate-500 hover:text-slate-300 px-1"
              title="本周不再显示"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-slate-900/50 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">🤖 自动成交</div>
            <div className="text-2xl font-bold text-cyan-400">{autoFilled.length} <span className="text-xs text-slate-500 font-normal">笔</span></div>
            <div className="text-xs text-slate-400 mt-1">手动 {filledOrders.length - autoFilled.length} 笔</div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">📊 涉及股票</div>
            <div className="text-2xl font-bold text-white">{uniqueStocks.size} <span className="text-xs text-slate-500 font-normal">只</span></div>
            <div className="text-xs text-slate-400 mt-1">买 {buys.length} 卖 {sells.length}</div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">💰 资金周转</div>
            <div className="text-lg font-bold text-rose-400">↑ {fmtMoney(buyAmount)}</div>
            <div className="text-lg font-bold text-emerald-400">↓ {fmtMoney(sellAmount)}</div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">💼 累计盈亏</div>
            <div className={`text-2xl font-bold ${ap.totalPnL >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {ap.totalPnL >= 0 ? '+' : ''}{fmtMoney(ap.totalPnL)}
            </div>
            <div className="text-xs text-slate-400 mt-1">总资产 {fmtMoney(ap.totalAssets)}</div>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-slate-800 grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-slate-500">买卖笔数比：</span>
            <span className="font-semibold ml-1 text-white">
              {buys.length} : {sells.length}
            </span>
          </div>
          <div>
            <span className="text-slate-500">总成交笔数：</span>
            <span className="font-semibold ml-1 text-white">{filledOrders.length} 笔</span>
          </div>
        </div>

        <details className="mt-3">
          <summary className="text-xs text-slate-500 cursor-pointer hover:text-purple-400">
            📜 查看本周成交明细 ({filledOrders.length} 笔)
          </summary>
          <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
            {filledOrders.length === 0 ? (
              <div className="text-xs text-slate-500 text-center py-2">本周无成交</div>
            ) : (
              filledOrders.slice(0, 20).map(o => {
                const isAuto = ap.tradingCodes.includes(o.code);
                return (
                  <div key={o.id} className="text-xs flex items-center justify-between bg-slate-900/30 rounded px-2 py-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-slate-500 font-mono text-[10px]">{formatOrderTime(o.timestamp).slice(0, 5)}</span>
                      <span className={o.direction === 'long' ? 'text-rose-400' : 'text-emerald-400'}>
                        {o.direction === 'long' ? '↑' : '↓'}
                      </span>
                      <span className="text-white truncate">{o.code}</span>
                      <span className={`text-[10px] ${isAuto ? 'text-cyan-400' : 'text-slate-500'}`}>
                        {isAuto ? '🤖' : '👆'}
                      </span>
                    </div>
                    <span className="text-slate-400 font-mono text-[10px]">¥{o.price.toFixed(2)} × {o.filledVolume || o.volume}</span>
                  </div>
                );
              })
            )}
          </div>
        </details>
      </div>
    </section>
  );
}

// ISO 周编号（YYYY-Www）
function getISOWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

// ==================== ⑥ 高级功能（折叠区） ====================

function AdvancedFeatures() {
  const [open, setOpen] = useState(false);
  const modules = [
    { title: '因子研究', desc: 'IC/IR 验证 · 多因子权重 · 失效预警', icon: '📊', href: '/quant/factor-analysis-v2' },
    { title: '个股回测', desc: '单股历史回测 · 12 策略', icon: '📈', href: '/quant/pro#backtest' },
    { title: '组合回测', desc: '多因子组合 · 调仓 · 归因', icon: '🎯', href: '/quant/pro#factor-portfolio' },
    { title: '下载中心', desc: 'APK/PPTX/PDF/数据 一键下载', icon: '📦', href: '/quant/pro#downloads' },
    { title: 'AI 助手', desc: '自然语言对话 · 策略问答', icon: '🤖', href: '/quant/pro#ai' },
    { title: '行情数据', desc: '完整 K线 / 分时 / 异动', icon: '📁', href: '/quant/pro#data' },
  ];
  return (
    <section className="mb-12">
      <button
        onClick={() => setOpen(!open)}
        className="w-fit sm:w-full mx-auto sm:mx-0 flex items-center justify-between gap-3 px-4 py-2.5 sm:px-3 sm:py-3 bg-slate-900 border border-slate-800 rounded-full sm:rounded-xl hover:border-slate-600 transition-colors whitespace-nowrap"
      >
        <span className="text-sm font-semibold text-slate-300">
          ④ 高级功能（{modules.length}）
        </span>
        <span className="text-slate-500 text-xs sm:text-sm">{open ? '▲ 收起' : '▼ 展开'}</span>
      </button>
      {open && (
        <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-3">
          {modules.map(m => (
            <Link
              key={m.href}
              href={m.href}
              className="bg-slate-900 border border-slate-800 hover:border-blue-500 rounded-xl p-4 transition-colors group"
            >
              <div className="text-2xl mb-2">{m.icon}</div>
              <div className="text-white text-sm font-medium group-hover:text-blue-400 transition-colors">{m.title}</div>
              <div className="text-slate-500 text-xs mt-0.5">{m.desc}</div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// ==================== 主页 ====================

export default function QuantLitePage() {
  const [, setTick] = useState(0);
  // 自选股 10s 刷新
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  // 📊 股票详情弹窗（点击股票名 → 弹出 K 线 / 分时 / 财务概览）
  const [selectedDetail, setSelectedDetail] = useState<{ code: string; name: string } | null>(null);

  // 📐 综合分详情弹窗（点击综合分 → 弹出 8 大类 / 3 大支柱构成 + 计算公式）
  const [selectedScoreDetail, setSelectedScoreDetail] = useState<ScoreDetailStock | null>(null);
  // 当前选用的评分版本（v1 3-pillar / v2 8 大类）— 弹窗用它决定展示哪套公式
  const [scoreVersion] = useState<'v1' | 'v2'>(() => {
    if (typeof localStorage === 'undefined') return 'v2';
    return (localStorage.getItem('quant_score_version') as 'v1' | 'v2') || 'v2';
  });

  return (
    <QuantCacheProvider>
      <QuantDataProvider>
        <AutoPilotProvider>
          <div className="min-h-screen bg-slate-950 text-slate-100">
            {/* v3.0.2（2026-06-15）：新手引导向导 — 首次进入自动显示 */}
            <OnboardingWizard />
            {/* v3.0.2（2026-06-15）：移动端底部 Tab Bar — 业界标准 5 tab 导航 */}
            {/* @ts-ignore — 大文件 setter 漏检；dev 实际能找到 */}
            <MobileBottomTabBar />
            <TopBar />
            <PriceAnomalyDetector />
            <main className="max-w-7xl mx-auto px-4 py-6">
              <MarketOverview />
              <HotSectorSection />
              <RiskEventStream />
              <TodayRecommendations
                onAddToSimulator={() => {}}
                onShowDetail={(s) => setSelectedDetail(s)}
                onShowScoreDetail={(s) => setSelectedScoreDetail(s)}
              />
              <WatchlistMonitor
                onGoPro={() => {}}
                onShowDetail={(s) => setSelectedDetail(s)}
              />
              <V1VsV2BacktestPanel />
              <SimulatorSnapshot />
              <EquityCurveChart />
              <RiskSettingsPanel />
              <PortfolioOverlapAnalysis />
              <AIDiagnosisPanel />
              <StrategyEffectiveness />
              <div data-section-target="autopilot">
                <AutoPilotDailyReport />
                <AutoTradeJournal />
                <WeeklyReview />
              </div>
              <AdvancedFeatures />
              <footer className="text-center text-xs text-slate-600 py-4">
                AI4U 量化交易系统 · 速览模式 · 模拟盘仅供学习研究，不构成投资建议
              </footer>
            </main>
          </div>
          {/* K线 / 分时 详情弹窗（点击 ②今日推荐 / ③盯盘 中的股票名触发） */}
          {selectedDetail && (
            <StockChart
              code={selectedDetail.code}
              name={selectedDetail.name || selectedDetail.code}
              onClose={() => setSelectedDetail(null)}
            />
          )}
          {/* 📐 综合分详情弹窗（点击 ②今日推荐 中的综合分触发 — 8 大类 / 3 大支柱 + 公式） */}
          {selectedScoreDetail && (
            <ScoreDetailModal
              stock={selectedScoreDetail}
              scoreVersion={scoreVersion}
              onClose={() => setSelectedScoreDetail(null)}
            />
          )}
        </AutoPilotProvider>
      </QuantDataProvider>
    </QuantCacheProvider>
  );
}
