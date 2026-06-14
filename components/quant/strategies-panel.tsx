'use client';

/**
 * 策略管理面板 — 配置和管理量化交易策略参数
 *
 * 【作用】：为选股器选出的股票选择合适的策略类型（MACD/布林带/均线等），
 *         并配置止止损、仓位等交易参数，然后一键启动模拟交易。
 *
 * 【策略职责划分】：
 *   - 选股器（因子分析）负责回答"买什么"
 *   - 策略管理负责回答"怎么买/怎么卖"（买卖条件、止止损）
 *   - 盯盘负责实时推送"什么时候买卖"
 *   - 模拟交易负责执行买卖并结算
 *
 * 【局限性】：
 *   - 策略参数（周期/阈值）需要通过回测验证效果
 *   - 参数对市场行情有适应性，特定行情可能需要调整
 *
 * 【正确的使用方式】：
 *   Step 1: 在选股器中选出候选股票
 *   Step 2: 在回测中验证策略参数是否有效
 *   Step 3: 在策略管理面板配置参数，点击"启动模拟交易"
 *   Step 4: 观察模拟交易运行结果，调整参数后重新验证
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { BacktestResultV2 } from '@/lib/quant/types';
import { useStrategyStore, type StrategyItem } from '@/lib/quant/store';

// ── 策略定义 ──────────────────────────────────

type StrategyType = 'macd' | 'kdj' | 'ma' | 'bollinger' | 'rsi';

interface StrategyDef {
  id: StrategyType;
  name: string;
  desc: string;
  params: { label: string; default: string }[];
  color: string;
}

// ── 策略列表 ──────────────────────────────────

const STRATEGY_DEFS: StrategyDef[] = [
  {
    id: 'macd',
    name: 'MACD 金叉策略',
    desc: 'DIF 上穿 DEA 买入，下穿卖出；适用于趋势型行情',
    color: 'blue',
    params: [
      { label: '快线周期', default: '12' },
      { label: '慢线周期', default: '26' },
      { label: '信号线周期', default: '9' },
    ],
  },
  {
    id: 'kdj',
    name: 'KDJ 超买超卖策略',
    desc: 'K值<20 超卖买入，K值>80 超买卖出；适用于震荡行情',
    color: 'purple',
    params: [
      { label: '周期', default: '9' },
      { label: '超卖阈值', default: '20' },
      { label: '超买阈值', default: '80' },
    ],
  },
  {
    id: 'ma',
    name: '均线多头排列策略',
    desc: '收盘价上穿20日均线买入，下穿卖出；适用于趋势跟踪',
    color: 'green',
    params: [
      { label: '短期均线', default: '5' },
      { label: '长期均线', default: '20' },
    ],
  },
  {
    id: 'bollinger',
    name: '布林带突破策略',
    desc: '价格突破布林上轨买入，跌破下轨卖出；适用于波动型行情',
    color: 'orange',
    params: [
      { label: '周期', default: '20' },
      { label: '标准差倍数', default: '2' },
    ],
  },
  {
    id: 'rsi',
    name: 'RSI 强弱策略',
    desc: 'RSI<30 超卖买入，RSI>70 超买卖出；适用于震荡行情',
    color: 'red',
    params: [
      { label: '周期', default: '14' },
      { label: '超卖阈值', default: '30' },
      { label: '超买阈值', default: '70' },
    ],
  },
];

// ── Ensemble 定义 ──────────────────────────────────

interface EnsembleDef {
  id: 'voting' | 'filter' | 'weighted' | 'dynamic';
  name: string;
  desc: string;
  strategies: string;
  color: string;
}

const ENSEMBLE_DEFS: EnsembleDef[] = [
  {
    id: 'voting',
    name: '并联投票组合',
    desc: 'MACD + KDJ + RSI 少数服从多数',
    strategies: '3策略投票',
    color: 'cyan',
  },
  {
    id: 'filter',
    name: '串联过滤组合',
    desc: 'MACD发信号，RSI 可否决',
    strategies: 'MACD(主) + RSI(过滤)',
    color: 'violet',
  },
  {
    id: 'weighted',
    name: '加权融合组合',
    desc: '5策略按权重融合，信号强度×权重',
    strategies: '5策略加权',
    color: 'amber',
  },
  {
    id: 'dynamic',
    name: '动态切换组合',
    desc: '市场自适应：高波动→布林，趋势→MACD',
    strategies: '5策略自动切换',
    color: 'rose',
  },
];

const STRATEGY_COLOR_MAP: Record<string, string> = {
  macd: 'blue', kdj: 'purple', ma: 'green', bollinger: 'orange', rsi: 'red',
  voting: 'cyan', filter: 'violet', weighted: 'amber', dynamic: 'rose',
};

const STRATEGY_STATUS_COLORS: Record<string, string> = {
  running: 'bg-green-900/50 text-green-300 border-green-700',
  stopped: 'bg-slate-700 text-slate-400 border-slate-600',
  untested: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
};

function formatPct(n?: number) {
  if (n === undefined) return '-';
  return (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '%';
}

function formatMoney(n: number) {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

// ── 主组件 ──────────────────────────────────

interface StrategiesPanelProps {
  onLaunchSimulator?: (config: { strategyType: StrategyType; codes: string[] }) => void;
}

export default function StrategiesPanel({ onLaunchSimulator }: StrategiesPanelProps) {
  const strategies = useStrategyStore(s => s.strategies);
  const ensembles = useStrategyStore(s => s.ensembles);
  const updateBacktestResult = useStrategyStore(s => s.updateBacktestResult);
  const addStrategy = useStrategyStore(s => s.addStrategy);
  const removeStrategy = useStrategyStore(s => s.removeStrategy);
  const bindStocks = useStrategyStore(s => s.bindStocks);

  const [mode, setMode] = useState<'single' | 'ensemble'>('single');
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyType>('macd');
  const [selectedEnsemble, setSelectedEnsemble] = useState<'voting' | 'filter' | 'weighted' | 'dynamic'>('voting');

  // 选中的股票列表（待启动）
  const [selectedStocks, setSelectedStocks] = useState<string[]>([]);

  // 模拟器运行中的策略ID（内存状态，通过API同步）
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());

  // 拉取当前模拟器运行状态
  const syncRunningStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/simulator');
      const json = await res.json();
      if (json.success) {
        // 从引擎获取运行中的策略信息并同步到 store
        // 目前 simulator 不暴露策略列表，通过 polling 结果间接判断
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    syncRunningStatus();
    const t = setInterval(syncRunningStatus, 5000);
    return () => clearInterval(t);
  }, [syncRunningStatus]);

  // ── 消费回测结果（BacktestPanel 通过 localStorage 推送） ──
  useEffect(() => {
    async function processBacktest() {
      try {
        const raw = localStorage.getItem('pendingBacktestResult');
        if (!raw) return;
        localStorage.removeItem('pendingBacktestResult');
        const { strategyType: btType, stockCode: btCode, result: btResult }: {
          strategyType: StrategyType;
          stockCode: string;
          result: BacktestResultV2;
        } = JSON.parse(raw);

        const currentStrategies = useStrategyStore.getState().strategies;
        // 尝试找到匹配的策略（按 type 匹配）
        const matched = currentStrategies.find(
          s => s.type === btType && s.boundStocks.includes(btCode)
        );
        if (matched) {
          await updateBacktestResult(matched.id, btResult, btCode);
        } else {
          // 未找到匹配：自动创建一个策略记录
          const def = STRATEGY_DEFS.find(d => d.id === btType);
          const newId = await addStrategy({
            name: def ? `${def.name} × ${btCode}` : `${btType} × ${btCode}`,
            type: btType,
            desc: def?.desc ?? '',
            status: 'stopped',
            params: {},
            enabled: false,
            tags: [],
            boundStocks: [btCode],
          });
          await updateBacktestResult(newId, btResult, btCode);
        }
      } catch { /* parse / storage errors: ignore */ }
    }
    processBacktest();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 仅在挂载时执行一次，通过 localStorage 通信

  // ── 添加/删除股票到策略 ──
  const handleToggleStock = (code: string) => {
    setSelectedStocks(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  // ── 切换策略状态（启动/停止） ──
  const handleToggleRunning = async (strategyId: string) => {
    const s = strategies.find(s => s.id === strategyId);
    if (!s) return;

    if (s.status === 'running') {
      await fetch('/api/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      setRunningIds(prev => { const n = new Set(prev); n.delete(strategyId); return n; });
    } else if (selectedStocks.length > 0) {
      const res = await fetch('/api/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'startWithStrategy',
          codes: selectedStocks,
          strategyType: s.type,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setRunningIds(prev => { const n = new Set(prev); n.add(strategyId); return n; });
      }
    }
  };

  // ── 从回测结果更新策略表现 ──
  const handleUpdateFromBacktest = (strategyId: string, result: BacktestResultV2) => {
    updateBacktestResult(strategyId, result, '');
  };

  // ── 快捷添加策略 ──
  const handleAddStrategy = async (type: StrategyType, name: string, desc: string) => {
    await addStrategy({
      name, type, desc,
      status: 'untested',
      params: {},
      enabled: false,
      tags: [],
      boundStocks: [],
    });
  };

  // ── 删除策略 ──
  const handleRemoveStrategy = async (id: string) => {
    await removeStrategy(id);
  };

  // ── 启动模拟交易 ──
  const handleLaunchSimulator = async () => {
    if (selectedStocks.length === 0) {
      alert('请先在下方选择要交易的股票');
      return;
    }
    if (onLaunchSimulator) {
      onLaunchSimulator({ strategyType: selectedStrategy, codes: selectedStocks });
    } else {
      // 直接调 API
      const res = await fetch('/api/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'startWithStrategy',
          codes: selectedStocks,
          strategyType: selectedStrategy,
        }),
      });
      const json = await res.json();
      if (json.success) {
        alert(`✅ ${mode === 'single' ? STRATEGY_DEFS.find(d => d.id === selectedStrategy)?.name : ENSEMBLE_DEFS.find(d => d.id === selectedEnsemble)?.name} 已启动 ${selectedStocks.length} 支股票！请切换到模拟交易标签页开启自动驾驶。`);
      } else {
        alert('启动失败: ' + json.error);
      }
    }
  };

  const activeStrategy = mode === 'single'
    ? STRATEGY_DEFS.find(d => d.id === selectedStrategy)
    : ENSEMBLE_DEFS.find(d => d.id === selectedEnsemble);

  return (
    <div className="space-y-4">

      {/* 策略选择区 */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">策略管理</h2>
          <div className="flex gap-2 bg-slate-800 rounded-lg p-0.5 border border-slate-700">
            <button
              onClick={() => setMode('single')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${mode === 'single' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              单策略
            </button>
            <button
              onClick={() => setMode('ensemble')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${mode === 'ensemble' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              ⚡ 策略组合
            </button>
          </div>
        </div>

        {/* 单策略选择 */}
        {mode === 'single' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {STRATEGY_DEFS.map(def => (
              <div
                key={def.id}
                onClick={() => setSelectedStrategy(def.id)}
                className={`cursor-pointer rounded-xl p-4 border-2 transition-all ${
                  selectedStrategy === def.id
                    ? `border-${def.color}-500 bg-${def.color}-900/20`
                    : 'border-slate-700 bg-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className={`font-semibold text-sm ${selectedStrategy === def.id ? `text-${def.color}-300` : 'text-white'}`}>
                    {def.name}
                  </h3>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    selectedStrategy === def.id ? `bg-${def.color}-700 text-${def.color}-200` : 'bg-slate-700 text-slate-400'
                  }`}>
                    {def.id.toUpperCase()}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mb-2">{def.desc}</p>
                <div className="flex flex-wrap gap-1">
                  {def.params.map(p => (
                    <span key={p.label} className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                      {p.label}:{p.default}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 组合策略选择 */}
        {mode === 'ensemble' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {ENSEMBLE_DEFS.map(def => (
              <div
                key={def.id}
                onClick={() => setSelectedEnsemble(def.id)}
                className={`cursor-pointer rounded-xl p-4 border-2 transition-all ${
                  selectedEnsemble === def.id
                    ? `border-${def.color}-500 bg-${def.color}-900/20`
                    : 'border-slate-700 bg-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <h3 className={`font-semibold text-sm ${selectedEnsemble === def.id ? `text-${def.color}-300` : 'text-white'}`}>
                    {def.name}
                  </h3>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    selectedEnsemble === def.id ? `bg-${def.color}-700 text-${def.color}-200` : 'bg-slate-700 text-slate-400'
                  }`}>
                    {def.id}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mb-1">{def.desc}</p>
                <p className="text-xs text-blue-400">{def.strategies}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 策略参数配置 */}
      {mode === 'single' && (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-3">参数配置</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {(STRATEGY_DEFS.find(d => d.id === selectedStrategy)?.params || []).map(p => (
              <div key={p.label}>
                <label className="block text-xs text-slate-400 mb-1">{p.label}</label>
                <input
                  type="number"
                  defaultValue={p.default}
                  className="w-full border border-slate-600 rounded px-2 py-1.5 text-sm bg-slate-800 text-white"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 股票选择区（选择哪些股票用这个策略跑） */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">
            选择股票
            <span className="ml-2 text-slate-400 font-normal text-xs">
              已选 {selectedStocks.length} 支（最多10支）
            </span>
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedStocks([])}
              className="px-3 py-1 text-xs bg-slate-800 border border-slate-600 text-slate-300 rounded hover:bg-slate-700"
            >
              清空
            </button>
            <button
              onClick={() => {
                // 常用股票快捷填入
                const defaults = ['000001.SZ', '600519.SH', '600036.SH', '300750.SZ', '601318.SH'];
                setSelectedStocks(defaults);
              }}
              className="px-3 py-1 text-xs bg-blue-900/50 border border-blue-700 text-blue-300 rounded hover:bg-blue-900"
            >
              + 填入示例股票
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { code: '000001.SZ', name: '平安银行' },
            { code: '600519.SH', name: '贵州茅台' },
            { code: '600036.SH', name: '招商银行' },
            { code: '300750.SZ', name: '宁德时代' },
            { code: '601318.SH', name: '中国平安' },
            { code: '000858.SZ', name: '五粮液' },
            { code: '688981.SH', name: '中芯国际' },
            { code: '002475.SZ', name: '立讯精密' },
            { code: '600030.SH', name: '中信证券' },
            { code: '300059.SZ', name: '东方财富' },
          ].map(stock => (
            <button
              key={stock.code}
              onClick={() => handleToggleStock(stock.code)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                selectedStocks.includes(stock.code)
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-slate-500'
              }`}
            >
              {stock.name} {stock.code.endsWith('.SH') ? '沪' : '深'}
            </button>
          ))}
        </div>
      </div>

      {/* 启动按钮 */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <button
            onClick={handleLaunchSimulator}
            disabled={selectedStocks.length === 0}
            className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-bold transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>▶</span>
            启动模拟交易
          </button>
          <span className="text-sm text-slate-400">
            {activeStrategy && (
              <>
                策略：<span className="text-white font-medium">{activeStrategy.name}</span>
                {selectedStocks.length > 0 && <span className="ml-2">，股票：{selectedStocks.join('、')}</span>}
              </>
            )}
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          💡 启动后将跳转到模拟交易页面，请开启自动驾驶让策略自动运行
        </p>
      </div>

      {/* 已配置的策略列表（展示用户自定义的策略） */}
      {strategies.length > 0 && (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-3">已保存策略</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {strategies.map(s => (
              <div key={s.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-semibold text-white text-sm">{s.name}</h4>
                    <p className="text-xs text-slate-400 mt-0.5">{s.desc}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded border ${STRATEGY_STATUS_COLORS[s.status]}`}>
                    {s.status === 'running' ? '运行中' : s.status === 'stopped' ? '已停止' : '待回测'}
                  </span>
                </div>
                {s.cumulativeReturn !== undefined && (
                  <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                    <div className="text-center">
                      <div className="text-slate-400">累计收益</div>
                      <div className={`font-bold ${s.cumulativeReturn >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {formatPct(s.cumulativeReturn)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-slate-400">胜率</div>
                      <div className="text-white font-bold">{s.winRate !== undefined ? formatPct(s.winRate) : '-'}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-slate-400">交易次数</div>
                      <div className="text-white font-bold">{s.totalTrades ?? '-'}</div>
                    </div>
                  </div>
                )}
                <button
                  onClick={() => handleToggleRunning(s.id)}
                  className={`mt-2 w-full px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                    s.status === 'running'
                      ? 'bg-red-900/30 border-red-700 text-red-300 hover:bg-red-900/50'
                      : 'bg-green-900/30 border-green-700 text-green-300 hover:bg-green-900/50'
                  }`}
                >
                  {s.status === 'running' ? '⏹ 停止策略' : '▶ 启动策略'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
