'use client';

/**
 * 模拟交易面板 — 在实时行情中验证策略实战有效性
 *
 * 【作用】：用经过回测验证的策略，在真实实时行情中模拟买卖，
 *         观察策略在实际运行时是否能产生合理信号并执行。
 *
 * 【局限性】：
 *   - 模拟成交，不动用真实资金，无法验证真实流动性
 *   - 无法验证大资金量的实际冲击成本
 *
 * 【正确的使用方式】：
 *   Step 1: 用选股器（因子分析）筛选候选股票
 *   Step 2: 在回测里用历史数据验证策略能赚钱
 *   Step 3: 在模拟交易里开启自动驾驶，让策略在实时行情中运行
 *         → 观察信号是否正常、账户是否按预期运行
 *         → 信号正常 → 说明策略框架可行
 *         → 信号异常/账户亏损 → 说明策略需调整
 *
 * 【核心功能】：
 *   - 自动驾驶模式：策略实时盯盘，满足条件自动下单（T+1结算）
 *   - 手动模式：自主选股，不依赖策略信号
 *   - 持仓管理：最多10支，T+1结算，7%止损/25%止盈
 *   - 信号日志：完整记录策略所有决策过程
 *
 * 【Pipeline 整合 — 输入端】：
 *   在「添加股票」弹窗中新增「组合持仓」Tab，
 *   可直接读取 PipelineStore 中的多因子组合持仓，
 *   选择某期调仓后批量将持仓股添加到模拟交易。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import type { Account, Direction } from '@/lib/quant/types';
import { useWatchlistStore, usePipelineStore } from '@/lib/quant/store';

// ==================== 类型 ====================

interface SimStock {
  code: string;
  name: string;
  strategy: 'macd' | 'kdj' | 'ma' | 'bollinger' | 'rsi'
    | 'williams' | 'bias' | 'mfi' | 'stochastic' | 'volume' | 'composite';
}

interface TradeLog {
  id: string;
  time: number;
  code: string;
  name: string;
  direction: Direction;
  price: number;
  volume: number;
  pnl?: number;
}

interface SystemLog {
  time: number;
  type: 'info' | 'warn' | 'trade' | 'signal' | 'error';
  msg: string;
}

interface PerformanceStats {
  totalReturn: number;
  totalReturnPct: number;
  winRate: number;
  totalTrades: number;
  maxDrawdown: number;
  sharpeRatio: number;
}

// ==================== 推荐股票 ====================

const RECOMMENDED_STOCKS = [
  { code: '000001.SZ', name: '平安银行', industry: '银行', reason: '低估值+均线多头' },
  { code: '600519.SH', name: '贵州茅台', industry: '白酒', reason: 'MACD底背离' },
  { code: '600036.SH', name: '招商银行', industry: '银行', reason: 'KDJ超卖反弹' },
  { code: '300750.SZ', name: '宁德时代', industry: '新能源', reason: '趋势突破' },
  { code: '601318.SH', name: '中国平安', industry: '保险', reason: '均线支撑' },
  { code: '000858.SZ', name: '五粮液', industry: '白酒', reason: 'MACD金叉' },
  { code: '688981.SH', name: '中芯国际', industry: '半导体', reason: 'KDJ低位' },
  { code: '002475.SZ', name: '立讯精密', industry: '消费电子', reason: '布林下轨' },
  { code: '600030.SH', name: '中信证券', industry: '券商', reason: '市场情绪回暖' },
  { code: '300059.SZ', name: '东方财富', industry: '互联网券商', reason: '资金流入' },
];

// P0-3 修复：从选股器拉取 Top N 数量
const SCREENER_TOP_N = 5;

const STRATEGY_LABELS: Record<string, string> = {
  macd: 'MACD 金叉',
  kdj: 'KDJ 超买/超卖',
  ma: '均线多头排列',
  bollinger: '布林带突破',
  rsi: 'RSI 强弱',
  williams: '威廉 %R',
  bias: '乖离率回归',
  mfi: 'MFI 资金流量',
  stochastic: 'KD 随机震荡',
  volume: '放量突破',
  composite: '多指标共振',
};

const STRATEGY_GUIDE: Record<string, {
  suitable: string;       // 适合行情
  risk: string;           // 风险等级
  params: string;         // 关键参数
  tip: string;            // 使用提示
  color: string;          // UI颜色
}> = {
  macd: {
    suitable: '趋势明确的上涨/下跌行情',
    risk: '中等',
    params: '快线12天 / 慢线26天 / 信号线9天',
    tip: 'MACD金叉（DIFF上穿DEA）买入，死叉卖出。趋势行情中胜率高，震荡行情中假信号多。建议配合ADX确认趋势强度。',
    color: 'blue',
  },
  kdj: {
    suitable: '区间震荡行情',
    risk: '中等偏高',
    params: 'N=9，M1=3，M2=3（RSV→K→D→J）',
    tip: 'KDJ在0-100波动。K、D低于20为超卖（买），高于80为超买（卖）。J值最敏感但易钝化，建议参考K、D而非J单独决策。',
    color: 'purple',
  },
  ma: {
    suitable: '中长期趋势行情',
    risk: '偏低',
    params: '短期5/20日均线，中期60日均线',
    tip: 'MA5上穿MA20为金叉（买入），下穿为死叉（卖出）。周期越长越稳定但越滞后。均线多头排列（5>20>60）时持仓，空头排列时观望。',
    color: 'green',
  },
  bollinger: {
    suitable: '波动收窄后的突破行情',
    risk: '偏高',
    params: '周期20天，标准差2倍',
    tip: '价格触及下轨可能反弹（买），触及上轨可能回落（卖）。布林带收口（波动率极低）后往往有大行情，可配合成交量突破确认。',
    color: 'orange',
  },
  rsi: {
    suitable: '震荡行情，高抛低吸',
    risk: '中等',
    params: '周期14天，超卖线30，超买线70',
    tip: 'RSI>70为超买（注意回落风险），RSI<30为超卖（注意反弹机会）。RSI与价格背离是重要反转信号。单边行情中RSI容易长时间高位/低位钝化。',
    color: 'yellow',
  },
  williams: {
    suitable: '震荡行情，抄底逃顶',
    risk: '中等',
    params: '周期14天，超卖线-80，超买线-20',
    tip: '威廉指标与RSI是"镜像关系"。%R从-80上穿（脱离超卖）=买入信号，从-20下穿（脱离超买）=卖出信号。震荡市中效果较好，趋势行情中信号较少。',
    color: 'pink',
  },
  bias: {
    suitable: '超跌反弹 / 均值回归行情',
    risk: '中等',
    params: '周期20天，正乖离上限5%，负乖离下限-5%',
    tip: '股价偏离均线过远会"均值回归"。负乖离过大（如<-5%）可能是超跌信号（买入），正乖离过大（如>5%）可能是高估信号（卖出）。适合有明显均值的白马股。',
    color: 'cyan',
  },
  mfi: {
    suitable: '量价配合行情，识别主力动向',
    risk: '中等',
    params: '周期14天，超卖线20，超买线80',
    tip: 'MFI是"带成交量的RSI"。MFI>80表示资金大量涌入但股价未必涨（警惕顶部），MFI<20表示资金撤离。顶背离（价涨量缩）是重要卖出信号。',
    color: 'indigo',
  },
  stochastic: {
    suitable: '短线震荡行情',
    risk: '偏高',
    params: 'K周期14，D周期3，超卖20，超买80',
    tip: '与KDJ类似但更简洁。K从下穿越D且两者都在20以下=买入，K从上穿越D且都在80以上=卖出。周期越短信号越灵敏但假信号越多，适合短线操作。',
    color: 'red',
  },
  volume: {
    suitable: '趋势确认后的顺势行情',
    risk: '中等',
    params: '量能周期20天，突破倍数1.5倍',
    tip: '"有量才有价"。放量突破20日高点是强势信号（买入），放量跌破20日低点是弱势信号（卖出）。缩量突破信号较弱，需谨慎。最佳用法：配合价格突破一起用。',
    color: 'emerald',
  },
  composite: {
    suitable: '多种行情，稳健操作',
    risk: '偏低（信号少但准）',
    params: '需MACD+ADX+RSI+成交量至少2个同时确认',
    tip: '多指标共振=更可靠但机会少。要求至少2个指标方向一致才发信号，大幅降低假信号概率。适合追求稳健、不追求高频交易的用户。信号少≠收益低，往往胜率更高。',
    color: 'violet',
  },
};

const ENSEMBLE_LABELS: Record<string, { name: string; desc: string; strategies: string }> = {
  voting: { name: '并联投票', desc: '少数服从多数，多策略民主决策', strategies: 'MACD + KDJ + RSI' },
  filter: { name: '串联过滤', desc: '主策略发信号，副策略可否决', strategies: 'MACD(主) + RSI(过滤)' },
  weighted: { name: '加权融合', desc: '各策略按权重投票，信号强度×权重', strategies: '5策略加权( MACD 30% )' },
  dynamic: { name: '动态切换', desc: '市场自适应，高波动→布林，趋势→MACD', strategies: '5策略自动切换' },
};

// ==================== 工具函数 ====================

function formatMoney(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(n: number): string {
  return (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '%';
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ==================== 主组件 ====================

export default function SimulatorPanel() {
  const [isRunning, setIsRunning] = useState(false);
  const [isAutoPilot, setIsAutoPilot] = useState(false);
  // P1-B：策略注册数（用于显示"策略未注册"警告徽章）
  const [strategiesCount, setStrategiesCount] = useState<{ strategies: number; ensembles: number }>({ strategies: 0, ensembles: 0 });
  // 名称兜底缓存：code → name。当 simStocks 没记录时使用，持久化到 localStorage。
  // 解决：自动交易/旧持仓/历史订单的股票没在 simStocks 列表时显示 '-' 的问题。
  const [nameCache, setNameCache] = useState<Record<string, string>>({});
  // P0-3：选股 Top N 拉取中标志
  const [isAddingFromScreener, setIsAddingFromScreener] = useState(false);
  const [mode, setMode] = useState<'single' | 'ensemble'>('single');
  const [selectedStrategy, setSelectedStrategy] = useState<'macd' | 'kdj' | 'ma' | 'bollinger' | 'rsi'
    | 'williams' | 'bias' | 'mfi' | 'stochastic' | 'volume' | 'composite'>('macd');
  const [selectedEnsemble, setSelectedEnsemble] = useState<'voting' | 'filter' | 'weighted' | 'dynamic'>('voting');
  const [simStocks, setSimStocks] = useState<SimStock[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  const [activePanel, setActivePanel] = useState<'portfolio' | 'orders' | 'logs'>('portfolio');
  const [recommendModal, setRecommendModal] = useState(false);
  const [pickerTab, setPickerTab] = useState<'recommend' | 'watchlist' | 'pipeline'>('recommend');
  const [summaryModal, setSummaryModal] = useState(false);
  const [stats, setStats] = useState<PerformanceStats | null>(null);
  const [isInviteUser, setIsInviteUser] = useState(false);
  const [currentUser, setCurrentUser] = useState('');

  // 自选股数据
  const storeWatchlists = useWatchlistStore(s => s.watchlists);
  const storeIsLoaded = useWatchlistStore(s => s.isLoaded);
  const activeWatchlistId = useWatchlistStore(s => s.activeWatchlistId);
  const activeWatchlist = storeWatchlists.find(w => w.id === activeWatchlistId);
  const watchlistCodes: string[] = activeWatchlist?.codes ?? [];

  // 读取策略管理传来的启动配置
  const configAppliedRef = useRef(false);

  useEffect(() => {
    if (configAppliedRef.current) return;
    configAppliedRef.current = true;
    const stored = localStorage.getItem('pendingSimulatorConfig');
    if (!stored) return;
    try {
      const config = JSON.parse(stored);
      localStorage.removeItem('pendingSimulatorConfig');
      if (config.codes && config.codes.length > 0) {
        const stocksWithNames: SimStock[] = config.codes.map((code: string) => ({
          code,
          name: code,
          strategy: config.strategyType || 'macd',
        }));
        setSimStocks(stocksWithNames);
        if (config.strategyType) {
          setSelectedStrategy(config.strategyType);
        }
        setTimeout(() => {
          fetch('/api/simulator', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'startWithStrategy',
              codes: config.codes,
              strategyType: config.strategyType || 'macd',
              strategyParams: config.strategyParams,  // 因子配置（所选因子+权重+评分）
            }),
          }).then(r => r.json()).then(json => {
            if (json.success) {
              setIsRunning(true);
              setIsAutoPilot(false);
              addSystemLog('info', `✅ 策略管理启动：${config.strategyType} × ${config.codes.length}支`);
            }
          });
        }, 500);
      }
    } catch {
      // ignore
    }
  }, []);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollState = useCallback(async () => {
    try {
      const res = await fetch('/api/simulator');
      const json = await res.json();
      if (json.success) {
        setIsRunning(json.data.isRunning);
        setIsAutoPilot(json.data.isAutoPilot);
        setStrategiesCount(json.data.strategiesCount ?? { strategies: 0, ensembles: 0 });
        setAccount(json.data.account);
        setIsInviteUser(json.data.isInviteUser ?? false);
        setCurrentUser(json.data.userId ?? '');

        // 刷新后恢复已选股票列表（引擎有 tradingCodes 但前端 simStocks 可能已重置）
        if (json.data.isRunning && json.data.tradingCodes?.length > 0 && simStocks.length === 0) {
          const codes: string[] = json.data.tradingCodes;
          setSimStocks(codes.map((code: string) => ({
            code,
            name: code,
            strategy: selectedStrategy,
          })));
        }

        if (json.data.orders) {
          const newTrades: TradeLog[] = json.data.orders
            .filter((o: { status: string }) => o.status === 'filled')
            .map((o: { id: string; timestamp: number; code: string; direction: Direction; price?: number; volume: number }) => ({
              id: o.id,
              time: o.timestamp,
              code: o.code,
              // 修复：订单对象本身没 name 字段，order.name 应在拉取时用 simStocks 实时解析
              // 这样即使 simStocks 后被刷新，旧订单仍能正确显示（每次 map 重新 lookup）
              name: resolveName(o.code),
              direction: o.direction,
              price: o.price || 0,
              volume: o.volume,
            }));
          if (newTrades.length > trades.length) {
            setTrades(prev => {
              const merged = [...newTrades, ...prev];
              const seen = new Set<string>();
              return merged.filter(t => {
                if (seen.has(t.id)) return false;
                seen.add(t.id);
                return true;
              }).slice(0, 100);
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }, [trades.length, simStocks.length]);

  useEffect(() => {
    pollState();
    pollRef.current = setInterval(pollState, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [pollState]);

  // 名称解析：simStocks 优先 → nameCache 兜底 → '—'（用 em-dash 比 '-' 更友好）
  // 解决：自动交易/旧持仓/历史订单的股票没在 simStocks 列表时显示 '—' 的问题
  const resolveName = (code: string): string => {
    const fromSimStocks = simStocks.find(s => s.code === code)?.name;
    if (fromSimStocks) return fromSimStocks;
    return nameCache[code] || '—';
  };

  // 名称兜底拉取：当持仓中出现 simStocks/nameCache 里都没有的 code 时，从 API 拉一次
  useEffect(() => {
    const codesToFetch = new Set<string>();
    for (const pos of account?.positions || []) {
      if (!simStocks.find(s => s.code === pos.code) && !nameCache[pos.code]) {
        codesToFetch.add(pos.code);
      }
    }
    if (codesToFetch.size === 0) return;
    let cancelled = false;
    (async () => {
      const updates: Record<string, string> = {};
      for (const code of codesToFetch) {
        try {
          const r = await fetch(`/api/stock/realtime?codes=${encodeURIComponent(code)}`);
          const j = await r.json();
          const name = j?.data?.[0]?.name;
          if (name) updates[code] = name;
        } catch { /* ignore */ }
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        setNameCache(prev => ({ ...prev, ...updates }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.positions]);

  // 自动驾驶
  const handleToggleAutoPilot = async () => {
    if (!isRunning) {
      toast.error('请先启动模拟交易');
      return;
    }
    const newState = !isAutoPilot;
    const res = await fetch('/api/simulator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'autopilot', enabled: newState }),
    });
    const json = await res.json();
    if (json.success) {
      setIsAutoPilot(newState);
      addSystemLog('info', newState ? '🤖 自动驾驶已开启' : '🔰 自动驾驶已关闭，转为手动模式');
    } else {
      toast.error('操作失败: ' + json.error);
    }
  };

  // 启动
  const handleStart = async () => {
    if (simStocks.length === 0) {
      toast.error('请先添加要模拟的股票（最多10支）');
      return;
    }
    const codes = simStocks.map(s => s.code);
    addSystemLog('info', `🚀 启动模拟交易（${codes.length}支股票）`);

    const payload = mode === 'ensemble'
      ? { action: 'startEnsemble', codes, ensembleType: selectedEnsemble }
      : { action: 'start', codes, strategyType: selectedStrategy };

    const res = await fetch('/api/simulator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.success) {
      setIsRunning(true);
      setIsAutoPilot(false);
      addSystemLog('info', '✅ 引擎启动成功，自动驾驶待开启');
    } else {
      addSystemLog('error', '❌ 启动失败: ' + json.error);
      toast.error('启动失败: ' + json.error);
    }
  };

  // 停止
  const handleStop = async () => {
    await fetch('/api/simulator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    });
    setIsRunning(false);
    setIsAutoPilot(false);
    addSystemLog('info', '⏹ 模拟交易已停止');
  };

  // 添加股票
  const handleAddStock = (stock: { code: string; name: string; industry?: string; reason?: string }) => {
    if (simStocks.length >= 10) { toast.warning('最多10支'); return; }
    if (simStocks.find(s => s.code === stock.code)) { toast.warning('已添加'); return; }
    setSimStocks(prev => [...prev, { code: stock.code, name: stock.name, strategy: selectedStrategy }]);
    addSystemLog('info', `📌 添加 ${stock.name}(${stock.code}) 策略[${STRATEGY_LABELS[selectedStrategy]}]`);
  };

  const handleRemoveStock = (code: string) => {
    setSimStocks(prev => prev.filter(s => s.code !== code));
    if (isRunning) {
      fetch('/api/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'removeStock', code }),
      });
    }
  };

  // 重置
  const handleReset = async () => {
    if (!confirm('确定重置账户？所有持仓和记录将清空。')) return;
    await fetch('/api/simulator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset', initialCash: 1000000 }),
    });
    setIsRunning(false);
    setIsAutoPilot(false);
    setSimStocks([]);
    setTrades([]);
    setSystemLogs([]);
    setStats(null);
    addSystemLog('info', '🔄 账户已重置为 ¥1,000,000');
  };

  // P0-3 修复：从选股器拉取 Top N 综合评分股票，一键追加到模拟交易
  const handleAddFromScreener = async () => {
    if (isAddingFromScreener) return;
    setIsAddingFromScreener(true);
    addSystemLog('info', `🎯 正在从智能选股拉取 Top ${SCREENER_TOP_N}...`);
    try {
      // 1. 拉取综合评分 Top N
      const res = await fetch(`/api/stock/screener?scoreSort=true&limit=${SCREENER_TOP_N}`);
      const json = await res.json();
      if (!json.success || !json.stocks || json.stocks.length === 0) {
        toast.error('选股 API 返回为空，请稍后重试');
        return;
      }
      const picked = json.stocks.slice(0, SCREENER_TOP_N);
      const codes = picked.map((s: { code: string }) => s.code);

      // 2. 加到前端 simStocks
      const newStocks: SimStock[] = picked.map((s: { code: string; name: string }) => ({
        code: s.code, name: s.name, strategy: selectedStrategy,
      }));
      setSimStocks(prev => {
        const existing = new Set(prev.map(p => p.code));
        return [...prev, ...newStocks.filter(s => !existing.has(s.code))];
      });

      addSystemLog('info', `🎯 选股 Top ${codes.length}: ${picked.map((s: { name: string; code: string }) => `${s.name}(${s.code})`).join(', ')}`);

      // 3. 调后端 addCodes（增量追加，不重置账户/持仓/策略）
      const addRes = await fetch('/api/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addCodes',
          codes,
          strategyType: selectedStrategy,
          factorScores: Object.fromEntries(picked.map((s: { code: string; compositeScore?: number }) => [s.code, s.compositeScore ?? 0])),
        }),
      });
      const addJson = await addRes.json();
      if (addJson.success) {
        setIsRunning(true);
        addSystemLog('info', `✅ ${addJson.message}`);
        toast.success(`🎯 ${addJson.message}`);
        // 4. 自动开启自动驾驶（如尚未开启）
        if (!isAutoPilot) {
          await fetch('/api/simulator', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'autopilot', enabled: true }),
          });
          setIsAutoPilot(true);
          addSystemLog('info', '🤖 已自动开启自动驾驶（基于' + STRATEGY_LABELS[selectedStrategy] + '）');
          toast.success('🤖 自动驾驶已自动开启');
        }
        pollState();
      } else {
        toast.error('追加失败: ' + (addJson.error || '未知错误'));
      }
    } catch (err: any) {
      toast.error('选股拉取失败: ' + (err?.message || err));
    } finally {
      setIsAddingFromScreener(false);
    }
  };

  // 手动下单
  const [orderForm, setOrderForm] = useState({
    code: '',
    direction: 'long' as Direction,
    volume: 100,
    type: 'market' as 'market' | 'limit',
    limitPrice: 0,
  });

  const handleOrder = async () => {
    if (!orderForm.code || !orderForm.volume) { toast.warning('请填写完整'); return; }
    if (isAutoPilot) { toast.warning('自动驾驶开启中，请先关闭'); return; }
    const res = await fetch('/api/simulator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'order', ...orderForm }),
    });
    const json = await res.json();
    if (json.success) {
      pollState();
    } else {
      toast.error('下单失败: ' + json.error);
    }
  };

  // 系统日志
  const addSystemLog = (type: SystemLog['type'], msg: string) => {
    setSystemLogs(prev => [{ time: Date.now(), type, msg }, ...prev].slice(0, 200));
  };

  // 生成交易总结
  const generateSummary = useCallback(() => {
    if (!account) return;
    const closedTrades = trades.filter(t => t.direction === 'short');
    const winTrades = closedTrades.filter(t => (t.pnl || 0) > 0).length;
    const totalReturn = account.totalAssets - 1000000;
    setStats({
      totalReturn,
      totalReturnPct: totalReturn / 1000000,
      winRate: closedTrades.length > 0 ? winTrades / closedTrades.length : 0,
      totalTrades: trades.length,
      maxDrawdown: 0,
      sharpeRatio: 0,
    });
    setSummaryModal(true);
  }, [account, trades]);

  // 颜色工具
  const profitColor = (n: number) => n >= 0 ? 'text-red-400' : 'text-green-400';
  const profitBg = (n: number) => n >= 0 ? 'bg-red-900/20 border-red-800' : 'bg-green-900/20 border-green-800';
  const logTypeColor = (type: SystemLog['type']) => {
    switch (type) {
      case 'trade': return 'text-yellow-300';
      case 'signal': return 'text-blue-300';
      case 'warn': return 'text-orange-300';
      case 'error': return 'text-red-400';
      default: return 'text-slate-400';
    }
  };
  const logTypePrefix = (type: SystemLog['type']) => {
    switch (type) {
      case 'trade': return '📊';
      case 'signal': return '📡';
      case 'warn': return '⚠️';
      case 'error': return '🚨';
      default: return 'ℹ️';
    }
  };

  return (
    <div className="space-y-4">
      {/* 顶部：账户总览 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">总资产</div>
          <div className="text-xl font-bold text-white">
            ¥{formatMoney(account?.totalAssets || 1000000)}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">持仓市值</div>
          <div className="text-xl font-bold text-white">
            ¥{formatMoney((account?.positions || []).reduce((s, p) => s + p.marketValue, 0))}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">累计盈亏</div>
          <div className={`text-xl font-bold ${profitColor(account?.totalPnL || 0)}`}>
            {account?.totalPnL !== undefined && account.totalPnL >= 0 ? '+' : ''}
            {formatMoney(account?.totalPnL || 0)}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">持仓股票</div>
          <div className="text-xl font-bold text-white">
            {(account?.positions || []).length} / 10
          </div>
        </div>
      </div>

      {/* 控制栏 */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-3">
        {/* 第一行：策略模式 */}
        <div className="flex items-center gap-4 flex-wrap">
          <label className="text-sm text-slate-400 shrink-0">策略模式:</label>
          <div className="flex gap-1 bg-slate-800 rounded-lg p-0.5">
            <button
              onClick={() => setMode('single')}
              disabled={isRunning}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                mode === 'single'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white disabled:opacity-40'
              }`}
            >
              单策略
            </button>
            <button
              onClick={() => setMode('ensemble')}
              disabled={isRunning}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                mode === 'ensemble'
                  ? 'bg-purple-600 text-white'
                  : 'text-slate-400 hover:text-white disabled:opacity-40'
              }`}
            >
              ⚡ 策略组合
            </button>
          </div>

          {/* 单策略下拉 */}
          {mode === 'single' && (
            <select
              value={selectedStrategy}
              onChange={e => setSelectedStrategy(e.target.value as typeof selectedStrategy)}
              disabled={isRunning}
              className="bg-slate-800 border border-slate-600 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              <option value="macd">① MACD 金叉 — 趋势型，适合趋势行情</option>
              <option value="kdj">② KDJ 超买超卖 — 震荡型，适合区间波动</option>
              <option value="ma">③ 均线多头排列 — 趋势型，适合顺势而为</option>
              <option value="bollinger">④ 布林带突破 — 突破型，适合波动收窄后爆发</option>
              <option value="rsi">⑤ RSI 强弱 — 超买超卖，适合反向操作</option>
              <option value="williams">⑥ 威廉 %R — 超买超卖，适合震荡市抄底逃顶</option>
              <option value="bias">⑦ 乖离率回归 — 均值回归，适合超跌反弹行情</option>
              <option value="mfi">⑧ MFI 资金流量 — 量价共振，识别主力资金动向</option>
              <option value="stochastic">⑨ KD 随机震荡 — 敏感震荡，适合短线操作</option>
              <option value="volume">⑩ 放量突破 — 趋势确认，适合突破关键点位</option>
              <option value="composite">⑪ 多指标共振 — 稳健型，4大指标全确认才下单</option>
            </select>
          )}

          {/* 策略指南面板 */}
          {mode === 'single' && (
            <div className={`mt-3 p-4 rounded-xl border text-sm leading-relaxed ${
              selectedStrategy === 'macd' ? 'bg-blue-900/20 border-blue-800 text-blue-200' :
              selectedStrategy === 'kdj' ? 'bg-purple-900/20 border-purple-800 text-purple-200' :
              selectedStrategy === 'ma' ? 'bg-green-900/20 border-green-800 text-green-200' :
              selectedStrategy === 'bollinger' ? 'bg-orange-900/20 border-orange-800 text-orange-200' :
              selectedStrategy === 'rsi' ? 'bg-yellow-900/20 border-yellow-800 text-yellow-200' :
              selectedStrategy === 'williams' ? 'bg-pink-900/20 border-pink-800 text-pink-200' :
              selectedStrategy === 'bias' ? 'bg-cyan-900/20 border-cyan-800 text-cyan-200' :
              selectedStrategy === 'mfi' ? 'bg-indigo-900/20 border-indigo-800 text-indigo-200' :
              selectedStrategy === 'stochastic' ? 'bg-red-900/20 border-red-800 text-red-200' :
              selectedStrategy === 'volume' ? 'bg-emerald-900/20 border-emerald-800 text-emerald-200' :
              'bg-violet-900/20 border-violet-800 text-violet-200'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">💡</span>
                <span className="font-bold">{STRATEGY_LABELS[selectedStrategy]} 策略指南</span>
                <span className="ml-auto text-xs opacity-75">风险：{STRATEGY_GUIDE[selectedStrategy]?.risk}</span>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-2 text-xs opacity-80">
                <div>
                  <span className="opacity-60">适合行情：</span>
                  <span>{STRATEGY_GUIDE[selectedStrategy]?.suitable}</span>
                </div>
                <div>
                  <span className="opacity-60">关键参数：</span>
                  <span>{STRATEGY_GUIDE[selectedStrategy]?.params}</span>
                </div>
              </div>
              <div className="text-xs opacity-90">
                <span className="opacity-60">使用提示：</span>
                <span>{STRATEGY_GUIDE[selectedStrategy]?.tip}</span>
              </div>
            </div>
          )}

          {/* 右侧：用户身份 */}
          <div className="ml-auto flex items-center gap-3">
            {isInviteUser ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-green-900/30 border border-green-700 text-green-300">
                <span>👤</span>
                <span>{currentUser}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-slate-800 border border-slate-600 text-slate-400">
                <span>👤</span>
                <span>访客</span>
                <button
                  onClick={() => { window.dispatchEvent(new CustomEvent('__open_invite_modal__')); }}
                  className="ml-1 px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition-colors"
                >
                  登录
                </button>
              </div>
            )}
            {isRunning && (
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
                isAutoPilot
                  ? 'bg-cyan-900/30 border-cyan-600 text-cyan-300'
                  : 'bg-yellow-900/30 border-yellow-700 text-yellow-300'
              }`}
              >
                <span className={`w-2 h-2 rounded-full ${isAutoPilot ? 'bg-cyan-400 animate-pulse' : 'bg-yellow-400'}`} />
                {isAutoPilot ? '🤖 自动驾驶运行中' : '⏳ 手动模式'}
              </div>
            )}
            {/* P1-B：策略未注册警告徽章 — isAutoPilot 开启但 strategies/ensembles 都为 0 时显示 */}
            {isAutoPilot && strategiesCount.strategies === 0 && strategiesCount.ensembles === 0 && (
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border bg-red-900/40 border-red-600 text-red-300 animate-pulse"
                title="引擎已开启自动驾驶但未注册任何策略实例，自动驾驶不会自动交易。请重启引擎并选择策略类型，或重新开启自动驾驶以触发自动回退注册。"
              >
                <span className="w-2 h-2 rounded-full bg-red-400" />
                ⚠️ 策略未注册（自动驾驶空转）
              </div>
            )}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
              isRunning
                ? 'bg-green-900/30 border-green-700 text-green-300'
                : 'bg-slate-800 border-slate-600 text-slate-400'
            }`}
            >
              <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-400' : 'bg-slate-500'}`} />
              {isRunning ? '引擎运行中' : '已停止'}
            </div>
          </div>
        </div>

        {/* 组合策略卡片 */}
        {mode === 'ensemble' && (
          <div className="grid grid-cols-2 gap-2">
            {(Object.entries(ENSEMBLE_LABELS) as [typeof selectedEnsemble, typeof ENSEMBLE_LABELS.voting][]).map(([key, info]) => (
              <button
                key={key}
                onClick={() => setSelectedEnsemble(key)}
                disabled={isRunning}
                className={`text-left p-3 rounded-lg border-2 transition-all ${
                  selectedEnsemble === key
                    ? 'border-purple-500 bg-purple-900/20'
                    : 'border-slate-700 bg-slate-800 hover:border-slate-600 disabled:opacity-40'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-sm font-bold ${selectedEnsemble === key ? 'text-purple-300' : 'text-white'}`}>
                    {info.name}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    selectedEnsemble === key ? 'bg-purple-700 text-purple-200' : 'bg-slate-700 text-slate-400'
                  }`}>
                    {key === 'voting' ? '3策略' : key === 'filter' ? '2策略' : '5策略'}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mb-1">{info.desc}</div>
                <div className="text-xs text-blue-400">{info.strategies}</div>
              </button>
            ))}
          </div>
        )}

        {/* 第二行：操作按钮 */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setRecommendModal(true)}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
            disabled={isRunning || simStocks.length >= 10}
          >
            + 添加股票 ({simStocks.length}/10)
          </button>

          {/* P0-3 修复：选股 Top N 一键追加到模拟交易 */}
          <button
            onClick={handleAddFromScreener}
            className="px-4 py-1.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
            disabled={isAddingFromScreener || simStocks.length >= 10}
            title="从智能选股综合评分 Top N 一键追加，自动加入交易池并开启自动驾驶"
          >
            <span>🎯</span>
            {isAddingFromScreener ? '拉取中...' : `选股 Top ${SCREENER_TOP_N} 一键追加`}
          </button>

          {!isRunning ? (
            <button
              onClick={handleStart}
              className="px-6 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium transition-colors flex items-center gap-2"
            >
              <span>▶</span> 启动引擎
            </button>
          ) : (
            <button
              onClick={handleStop}
              className="px-6 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium transition-colors flex items-center gap-2"
            >
              <span>⏹</span> 停止
            </button>
          )}

          {isRunning && (
            <button
              onClick={handleToggleAutoPilot}
              className={`px-5 py-1.5 rounded text-sm font-bold transition-all flex items-center gap-2 border-2 ${
                isAutoPilot
                  ? 'bg-cyan-600 border-cyan-400 text-white shadow-lg shadow-cyan-900/50 animate-pulse'
                  : 'bg-slate-700 border-slate-600 text-slate-300 hover:border-cyan-600 hover:text-cyan-300'
              }`}
            >
              {isAutoPilot ? (
                <>
                  <span className="text-lg">🤖</span>
                  <span>自动驾驶 ON</span>
                </>
              ) : (
                <>
                  <span className="text-lg">🅿️</span>
                  <span>开启自动驾驶</span>
                </>
              )}
            </button>
          )}

          <button
            onClick={handleReset}
            className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm transition-colors"
          >
            重置账户
          </button>

          <button
            onClick={generateSummary}
            className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm transition-colors"
          >
            📋 交易总结
          </button>
        </div>

        {/* 自动驾驶说明条 */}
        {isAutoPilot && (
          <div className="space-y-2">
            <div className="px-4 py-2.5 bg-cyan-900/20 border border-cyan-800 rounded-lg text-sm text-cyan-300 flex items-center gap-2">
              <span className="text-lg">🤖</span>
              <span>
                <strong>自动驾驶已开启</strong>，系统将根据 <strong>{STRATEGY_LABELS[selectedStrategy]}</strong> 策略自动执行买卖，
                每30秒检查一次信号。持仓股票将在出现卖出信号时自动平仓。
              </span>
            </div>
            {/* 高级风控说明 */}
            <div className="px-4 py-3 bg-slate-800/60 border border-slate-700 rounded-lg text-xs text-slate-400">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-cyan-400">🛡️</span>
                <span className="font-semibold text-cyan-300">高级风控已启用</span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                <div>• 止损：7%固定止损 + ATR动态止损（2倍ATR）</div>
                <div>• 止盈：15%固定止盈 + 移动止盈（盈利10%激活）</div>
                <div>• 仓位：单笔最大风险2%，最大持仓30%账户</div>
                <div>• 市场感知：高波动市自动降仓至60%，强趋势加仓至120%</div>
              </div>
            </div>
          </div>
        )}

        {/* 已选股票标签 — name 主、code 次（统一规范） */}
        {simStocks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {simStocks.map(s => (
              <span key={s.code} className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-800 border border-slate-600 rounded-full text-sm">
                <span className="text-white font-medium">{s.name}</span>
                <span className="text-slate-400 text-xs font-mono">{s.code}</span>
                <span className="text-xs text-blue-400">[{STRATEGY_LABELS[s.strategy]}]</span>
                {!isRunning && (
                  <button onClick={() => handleRemoveStock(s.code)} className="text-slate-500 hover:text-red-400 ml-1">
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 子Tab：持仓 / 订单 / 信号日志 */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
        <div className="flex border-b border-slate-700">
          {[
            { id: 'portfolio', label: '持仓详情' },
            { id: 'orders', label: `交易记录 (${trades.length})` },
            { id: 'logs', label: `📡 信号日志 (${systemLogs.length})` },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActivePanel(tab.id as typeof activePanel)}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activePanel === tab.id
                  ? 'border-blue-400 text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {/* 持仓详情 */}
          {activePanel === 'portfolio' && (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 text-xs border-b border-slate-700">
                      <th className="text-left py-2 px-2">名称</th>
                      <th className="text-left py-2 px-2">代码</th>
                      <th className="text-right py-2 px-2">持仓量</th>
                      <th className="text-right py-2 px-2">成本价</th>
                      <th className="text-right py-2 px-2">现价</th>
                      <th className="text-right py-2 px-2">市值</th>
                      <th className="text-right py-2 px-2">浮动盈亏</th>
                      <th className="text-right py-2 px-2">盈亏%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(account?.positions || []).length === 0 && (
                      <tr>
                        <td colSpan={8} className="text-center py-8 text-slate-500">
                          {isAutoPilot ? '自动驾驶正在寻找买入机会...' : '暂无持仓，点击「添加股票」开始模拟'}
                        </td>
                      </tr>
                    )}
                    {(account?.positions || []).map(pos => {
                      const pnlPct = pos.avgCost > 0 ? (pos.currentPrice - pos.avgCost) / pos.avgCost : 0;
                      return (
                        <tr key={pos.code} className="border-b border-slate-800 hover:bg-slate-800/50">
                          {/* 名称（主） + 代码（次，monospace 灰色）— 统一规则 */}
                          <td className="py-2 px-2 text-white font-medium">{resolveName(pos.code)}</td>
                          <td className="py-2 px-2 text-slate-500 font-mono text-xs">{pos.code}</td>
                          <td className="py-2 px-2 text-right text-white">{pos.volume}</td>
                          <td className="py-2 px-2 text-right text-slate-300">{pos.avgCost.toFixed(2)}</td>
                          <td className="py-2 px-2 text-right text-white">{pos.currentPrice.toFixed(2)}</td>
                          <td className="py-2 px-2 text-right text-slate-300">{formatMoney(pos.marketValue)}</td>
                          <td className={`py-2 px-2 text-right font-medium ${profitColor(pos.unrealizedPnL)}`}>
                            {pos.unrealizedPnL >= 0 ? '+' : ''}{formatMoney(pos.unrealizedPnL)}
                          </td>
                          <td className={`py-2 px-2 text-right font-medium ${profitColor(pnlPct)}`}>
                            {pnlPct >= 0 ? '+' : ''}{(pnlPct * 100).toFixed(2)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 手动下单区 */}
              <div className="border-t border-slate-700 pt-4 mt-2">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-slate-300">手动下单（自动驾驶关闭时可用）</h4>
                  {isAutoPilot && (
                    <span className="text-xs text-cyan-400">🤖 自动驾驶中，请先关闭自动驾驶</span>
                  )}
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">股票代码</label>
                    <input
                      type="text"
                      value={orderForm.code}
                      onChange={e => setOrderForm(p => ({ ...p, code: e.target.value }))}
                      placeholder="000001.SZ"
                      disabled={isAutoPilot}
                      className="w-36 bg-slate-800 border border-slate-600 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">方向</label>
                    <select
                      value={orderForm.direction}
                      onChange={e => setOrderForm(p => ({ ...p, direction: e.target.value as Direction }))}
                      disabled={isAutoPilot}
                      className="bg-slate-800 border border-slate-600 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                      <option value="long">买入（做多）</option>
                      <option value="short">卖出（平仓）</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">数量（手）</label>
                    <input
                      type="number"
                      value={orderForm.volume}
                      onChange={e => setOrderForm(p => ({ ...p, volume: parseInt(e.target.value) || 0 }))}
                      min={100} step={100}
                      disabled={isAutoPilot}
                      className="w-28 bg-slate-800 border border-slate-600 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">下单类型</label>
                    <select
                      value={orderForm.type}
                      onChange={e => setOrderForm(p => ({ ...p, type: e.target.value as 'market' | 'limit' }))}
                      disabled={isAutoPilot}
                      className="bg-slate-800 border border-slate-600 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                      <option value="market">市价单</option>
                      <option value="limit">限价单</option>
                    </select>
                  </div>
                  {orderForm.type === 'limit' && (
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">限价</label>
                      <input
                        type="number"
                        value={orderForm.limitPrice}
                        onChange={e => setOrderForm(p => ({ ...p, limitPrice: parseFloat(e.target.value) || 0 }))}
                        step={0.01}
                        disabled={isAutoPilot}
                        className="w-28 bg-slate-800 border border-slate-600 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                      />
                    </div>
                  )}
                  <button
                    onClick={handleOrder}
                    disabled={isAutoPilot}
                    className="px-5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    提交订单
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 交易记录 */}
          {activePanel === 'orders' && (
            <div>
              {trades.length === 0 && (
                <div className="text-center py-12 text-slate-500">暂无交易记录</div>
              )}
              <div className="space-y-2">
                {trades.map((t, idx) => (
                  <div
                    key={`${t.id}-${idx}`}
                    className={`flex items-center justify-between px-4 py-2.5 rounded-lg border text-sm ${profitBg(t.direction === 'short' ? (t.pnl || 0) : 0)}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                        t.direction === 'long' ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'
                      }`}>
                        {t.direction === 'long' ? '买入' : '卖出'}
                      </span>
                      {/* 名称（主） + 代码（次）— 统一规则 */}
                      <span className="text-slate-200 font-medium">{t.name || t.code}</span>
                      <span className="text-slate-500 font-mono text-xs">{t.code}</span>
                    </div>
                    <div className="flex items-center gap-6 text-slate-300">
                      <span className="text-right">
                        <span className="text-slate-500">@</span> {t.price > 0 ? t.price.toFixed(2) : '市价'}
                      </span>
                      <span className="text-right w-20">{t.volume > 0 ? `${t.volume}股` : '-'}</span>
                      <span className="text-right w-20 text-xs text-slate-500">{formatTime(t.time)}</span>
                      {t.pnl !== undefined && t.pnl !== 0 && (
                        <span className={`text-right w-24 font-medium ${profitColor(t.pnl)}`}>
                          {t.pnl >= 0 ? '+' : ''}{formatMoney(t.pnl)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 信号日志 */}
          {activePanel === 'logs' && (
            <div>
              {systemLogs.length === 0 && (
                <div className="text-center py-12">
                  <div className="text-slate-500 mb-2">暂无信号日志</div>
                  <div className="text-xs text-slate-600">开启自动驾驶后，策略信号和交易事件将显示在这里</div>
                </div>
              )}
              <div className="space-y-1 max-h-96 overflow-y-auto font-mono text-xs">
                {systemLogs.map((log, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-3 py-1.5 px-2 rounded ${
                      log.type === 'error' ? 'bg-red-900/10' :
                      log.type === 'trade' ? 'bg-yellow-900/10' :
                      log.type === 'signal' ? 'bg-blue-900/10' :
                      'hover:bg-slate-800/50'
                    }`}
                  >
                    <span className="text-slate-600 shrink-0 w-16">{formatTime(log.time)}</span>
                    <span className={`shrink-0 ${logTypeColor(log.type)}`}>{logTypePrefix(log.type)}</span>
                    <span className={logTypeColor(log.type)}>{log.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 推荐股票弹窗 */}
      {recommendModal && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setRecommendModal(false)}
        >
          <div
            className="bg-slate-900 border border-slate-600 rounded-xl w-[640px] max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
              <h3 className="text-lg font-bold text-white">选择要模拟的股票</h3>
              <button onClick={() => setRecommendModal(false)} className="text-slate-400 hover:text-white text-xl">
                ×
              </button>
            </div>
            {/* Tab切换 */}
            <div className="flex border-b border-slate-700 px-4 pt-2">
              <button
                onClick={() => setPickerTab('recommend')}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                  pickerTab === 'recommend'
                    ? 'border-blue-500 text-blue-400 bg-slate-800'
                    : 'border-transparent text-slate-400 hover:text-white hover:bg-slate-800/50'
                }`}
              >
                推荐股票
              </button>
              <button
                onClick={() => setPickerTab('watchlist')}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                  pickerTab === 'watchlist'
                    ? 'border-blue-500 text-blue-400 bg-slate-800'
                    : 'border-transparent text-slate-400 hover:text-white hover:bg-slate-800/50'
                }`}
              >
                我的自选 {storeIsLoaded && watchlistCodes.length > 0 && (
                  <span className="ml-1 text-xs px-1.5 py-0.5 bg-blue-600 text-white rounded-full">{watchlistCodes.length}</span>
                )}
              </button>
              <button
                onClick={() => setPickerTab('pipeline')}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                  pickerTab === 'pipeline'
                    ? 'border-yellow-500 text-yellow-400 bg-slate-800'
                    : 'border-transparent text-slate-400 hover:text-white hover:bg-slate-800/50'
                }`}
              >
                组合持仓
              </button>
            </div>
            <div className="p-4 space-y-2">
              {pickerTab === 'recommend' && RECOMMENDED_STOCKS.map(stock => {
                const added = simStocks.some(s => s.code === stock.code);
                return (
                  <div
                    key={stock.code}
                    className="flex items-center justify-between p-3 bg-slate-800 rounded-lg hover:bg-slate-750 border border-slate-700"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-white font-medium">{stock.code}</span>
                        <span className="text-slate-200">{stock.name}</span>
                        <span className="text-xs px-1.5 py-0.5 bg-slate-700 text-slate-400 rounded">{stock.industry}</span>
                      </div>
                      <div className="text-xs text-blue-400 mt-0.5">推荐理由：{stock.reason}</div>
                    </div>
                    <button
                      onClick={() => { handleAddStock(stock); setRecommendModal(false); }}
                      disabled={added || simStocks.length >= 10}
                      className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                        added
                          ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      {added ? '已添加' : '+ 添加'}
                    </button>
                  </div>
                );
              })}
              {pickerTab === 'watchlist' && (
                storeIsLoaded ? (
                  watchlistCodes.length > 0 ? (
                    watchlistCodes.map(code => {
                      const added = simStocks.some(s => s.code === code);
                      // 自选股没有 reason/industry，用 code 做唯一标识
                      const name = simStocks.find(s => s.code === code)?.name ?? code;
                      return (
                        <div
                          key={code}
                          className="flex items-center justify-between p-3 bg-slate-800 rounded-lg hover:bg-slate-750 border border-slate-700"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-white font-medium">{code}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              // 自选股只有 code，从 simStocks 找 name（如果已添加过），否则用 code 做 display name
                              const existing = simStocks.find(s => s.code === code);
                              handleAddStock({ code, name: existing?.name ?? code });
                              setRecommendModal(false);
                            }}
                            disabled={added || simStocks.length >= 10}
                            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                              added
                                ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                                : 'bg-blue-600 hover:bg-blue-700 text-white'
                            }`}
                          >
                            {added ? '已添加' : '+ 添加'}
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-8 text-slate-500">
                      <div className="text-3xl mb-2">⭐</div>
                      <div>自选股列表为空</div>
                      <div className="text-xs mt-1">在因子分析或其他模块添加股票到自选</div>
                    </div>
                  )
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    <div className="text-xs">自选股加载中...</div>
                  </div>
                )
              )}
              {pickerTab === 'pipeline' && (
                <PipelinePicker onAdd={handleAddStock} simStocks={simStocks} />
              )}
            </div>
            <div className="px-6 py-3 border-t border-slate-700 text-xs text-slate-500">
              当前已选 {simStocks.length}/10 支股票 ·
              {pickerTab === 'recommend' ? '基于系统选股策略推荐的热门标的' :
               pickerTab === 'watchlist' ? '来自您的自选股列表' :
               '来自 Pipeline 多因子组合持仓'}
            </div>
          </div>
        </div>
      )}

      {/* 交易总结弹窗 */}
      {summaryModal && stats && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setSummaryModal(false)}
        >
          <div
            className="bg-slate-900 border border-slate-600 rounded-xl w-[560px]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
              <h3 className="text-lg font-bold text-white">📋 交易总结报告</h3>
              <button onClick={() => setSummaryModal(false)} className="text-slate-400 hover:text-white text-xl">
                ×
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className={`p-4 rounded-lg border ${profitBg(stats.totalReturn)}`}>
                  <div className="text-xs text-slate-400 mb-1">累计收益率</div>
                  <div className={`text-2xl font-bold ${profitColor(stats.totalReturn)}`}>
                    {formatPct(stats.totalReturnPct)}
                  </div>
                  <div className={`text-sm ${profitColor(stats.totalReturn)}`}>
                    {stats.totalReturn >= 0 ? '+' : ''}{formatMoney(stats.totalReturn)}
                  </div>
                </div>
                <div className="p-4 rounded-lg border bg-slate-800 border-slate-700">
                  <div className="text-xs text-slate-400 mb-1">总交易次数</div>
                  <div className="text-2xl font-bold text-white">{stats.totalTrades}</div>
                  <div className="text-sm text-slate-400">笔</div>
                </div>
                <div className="p-4 rounded-lg border bg-slate-800 border-slate-700">
                  <div className="text-xs text-slate-400 mb-1">胜率</div>
                  <div className="text-2xl font-bold text-white">{formatPct(stats.winRate)}</div>
                  <div className="text-sm text-slate-400">盈利/总平仓</div>
                </div>
                <div className="p-4 rounded-lg border bg-slate-800 border-slate-700">
                  <div className="text-xs text-slate-400 mb-1">最大回撤</div>
                  <div className="text-2xl font-bold text-green-400">{formatPct(stats.maxDrawdown)}</div>
                  <div className="text-sm text-slate-400">历史最大</div>
                </div>
              </div>
              <div className="p-4 bg-slate-800 rounded-lg border border-slate-700">
                <div className="text-sm font-semibold text-white mb-2">策略综合评价</div>
                <div className="text-sm text-slate-400 leading-relaxed">
                  {stats.totalReturnPct > 0.1
                    ? '✅ 策略表现优异，累计收益显著跑赢大盘。'
                    : stats.totalReturnPct > 0
                    ? '📈 策略整体正收益，建议继续观察。'
                    : '⚠️ 策略处于亏损状态，建议优化参数或更换策略。'}
                  {' '}
                  {stats.winRate > 0.5
                    ? '胜率超过50%，盈利能力较强。'
                    : stats.winRate > 0.3
                    ? '胜率一般，建议关注止损纪律。'
                    : '胜率偏低，需优化入场信号。'}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-700 flex justify-end">
              <button
                onClick={() => setSummaryModal(false)}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// P4: Pipeline 组合持仓选择器
// ─────────────────────────────────────────

function PipelinePicker({
  onAdd,
  simStocks,
}: {
  onAdd: (stock: { code: string; name: string; industry?: string; reason?: string }) => void;
  simStocks: { code: string; name: string; strategy: string }[];
}) {
  const results = usePipelineStore(s => s.results);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [selectedRebalanceIdx, setSelectedRebalanceIdx] = useState<number | null>(null);
  const [stockNames, setStockNames] = useState<Record<string, string>>({});
  const [loadingNames, setLoadingNames] = useState(false);

  const selectedResult = results.find(r => r.id === selectedResultId) ?? null;
  const selectedRebalance = selectedResult && selectedRebalanceIdx !== null
    ? selectedResult.rebalanceLog[selectedRebalanceIdx] ?? null
    : null;

  // 加载持仓股名称
  useEffect(() => {
    if (!selectedRebalance || selectedRebalance.holdings.length === 0) return;
    const codes = selectedRebalance.holdings.map(h => h.code);
    const missing = codes.filter(c => !stockNames[c]);
    if (missing.length === 0) return;
    let cancelled = false;
    setLoadingNames(true);
    fetch(`/api/stock/realtime?codes=${missing.join(',')}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const map: Record<string, string> = { ...stockNames };
        (data.data || []).forEach((item: { code: string; name: string }) => {
          if (item.code && item.name) map[item.code] = item.name;
        });
        setStockNames(map);
        setLoadingNames(false);
      })
      .catch(() => { if (!cancelled) setLoadingNames(false); });
    return () => { cancelled = true; };
  }, [selectedRebalance]);

  if (results.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500">
        <div className="text-3xl mb-2">📦</div>
        <div>暂无 Pipeline 组合</div>
        <div className="text-xs mt-1">请先在「多因子组合」中运行回测</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 组合列表 */}
      <div className="space-y-1">
        {results.map(r => (
          <button
            key={r.id}
            onClick={() => { setSelectedResultId(r.id); setSelectedRebalanceIdx(null); }}
            className={`w-full text-left px-3 py-2 rounded border text-xs ${
              selectedResultId === r.id
                ? 'bg-yellow-900 border-yellow-600 text-yellow-200'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600'
            }`}
          >
            <div className="font-medium">{r.name}</div>
            <div className="text-slate-500 mt-0.5">
              {r.startDate}~{r.endDate} · {r.rebalanceLog.length}期调仓 · 年化{(r.annualReturn * 100).toFixed(1)}%
            </div>
          </button>
        ))}
      </div>

      {/* 调仓期 */}
      {selectedResult && (
        <div>
          <div className="text-xs text-slate-400 mb-1">选择调仓期（添加到模拟交易）：</div>
          <div className="flex flex-wrap gap-1">
            {selectedResult.rebalanceLog.map((rb, idx) => (
              <button
                key={idx}
                onClick={() => setSelectedRebalanceIdx(idx)}
                className={`text-xs px-2 py-1 rounded ${
                  selectedRebalanceIdx === idx
                    ? 'bg-yellow-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {rb.date} ({rb.holdings.length}股)
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 持仓明细 + 添加 */}
      {selectedRebalance && (
        <div className="space-y-1">
          <div className="text-xs text-slate-400 mb-1">
            {loadingNames ? '加载中...' : `${selectedRebalance.holdings.length} 只持仓`}
          </div>
          {selectedRebalance.holdings.map(h => {
            const added = simStocks.some(s => s.code === h.code);
            const name = stockNames[h.code] ?? h.code;
            return (
              <div key={h.code} className="flex items-center justify-between p-2 bg-slate-800 rounded border border-slate-700">
                <div>
                  <span className="font-mono text-white text-sm">{h.code}</span>
                  <span className="text-slate-300 text-sm ml-2">{name}</span>
                </div>
                <button
                  onClick={() => { onAdd({ code: h.code, name }); }}
                  disabled={added || simStocks.length >= 10}
                  className={`text-xs px-3 py-1 rounded font-medium ${
                    added
                      ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                      : 'bg-yellow-600 hover:bg-yellow-700 text-white'
                  }`}
                >
                  {added ? '已添加' : '+ 添加'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
