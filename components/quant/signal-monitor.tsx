'use client';

/**
 * 实时盯盘面板 — 监控自选股的策略信号与价格异动
 *
 * 【作用】：把选股器选出的股票加入自选，实时接收策略买卖信号推送，
 *         在行情异动时第一时间看到并决定是否跟进交易。
 *
 * 【局限性】：
 *   - 信号仅供参考，不构成投资建议
 *   - 实时行情存在延迟（东方财富数据约3-5秒）
 *   - A股T+1制度导致当日买入无法卖出
 *
 * 【与其他模块的关系】：
 *   - 输入：自选股列表（来自选股器 / 手动添加）
 *   - 输出：买卖信号 → 决定是否在模拟交易中建仓
 *
 * 【盯盘不能做什么】：
 *   - 不能自动下单（下单是模拟交易的职责）
 *   - 不能验证策略是否赚钱（验证是回测的职责）
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { getDataCache, isMarketOpen } from '@/lib/quant/data/data-cache';
import { stockDataCache } from '@/lib/quant/data/stock-data-cache';
import { useWatchlistStore } from '@/lib/quant/store';
import { getRealtimeSignalEngine } from '@/lib/quant/strategies/realtime-signal-engine';

// ==================== Types ====================

interface WatchedStock {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  indicators: {
    macd: { value: number; signal: string; histogram: number };
    kdj: { k: number; d: number; j: number; signal: string };
    bollinger: { upper: number; middle: number; lower: number; position: number | string };
    ma: { ma5: number; ma10: number; ma20: number; ma60: number; position: string };
    cci: { value: number; signal: string };
    obv: { value: number; signal: string };
    adx: { value: number; adx: number; signal: string };
  };
  signal: { direction: string; strength: number; reason: string };
  lastUpdate: number;
}

interface StockSignalHistory {
  timestamp: number;
  direction: string;
  reason: string;
}

// ==================== Constants ====================

const QUICK_STOCKS = [
  { name: '平安银行', code: '000001.SZ' },
  { name: '万科A', code: '000002.SZ' },
  { name: '贵州茅台', code: '600519.SH' },
  { name: '宁德时代', code: '300750.SZ' },
];

const QUICK_INDICES = [
  { name: '沪深300', code: 'sh000300' },
  { name: '创业板指', code: 'sz399006' },
  { name: '科创50', code: 'sh000688' },
];

const POLL_INTERVAL = 5000;

// ==================== Utility Functions ====================

function formatCode(code: string): string {
  if (code.endsWith('.SH')) return code;
  if (code.endsWith('.SZ')) return code;
  if (code.endsWith('.BJ')) return code;
  // Try to guess exchange
  if (code.startsWith('6')) return `${code}.SH`;
  if (code.startsWith('000') || code.startsWith('001') || code.startsWith('002') || code.startsWith('300')) return `${code}.SZ`;
  return `${code}.SZ`;
}

function parseCodeInput(input: string): string | null {
  const trimmed = input.trim().toUpperCase();
  if (!trimmed) return null;
  // Already in full format
  if (trimmed.includes('.') && (trimmed.endsWith('.SH') || trimmed.endsWith('.SZ') || trimmed.endsWith('.BJ'))) {
    return trimmed;
  }
  // Try to parse as code only (6 digits)
  if (/^\d{6}$/.test(trimmed)) {
    return formatCode(trimmed);
  }
  return null;
}

// ==================== Signal Badge Components ====================

function MacdBadge({ signal }: { signal: string }) {
  const config: Record<string, { label: string; className: string }> = {
    golden_cross: { label: '金叉', className: 'bg-green-900/50 text-green-300' },
    dead_cross: { label: '死叉', className: 'bg-red-900/50 text-red-300' },
    bullish: { label: '多头', className: 'bg-blue-900/50 text-blue-300' },
    bearish: { label: '空头', className: 'bg-purple-900/50 text-purple-300' },
    neutral: { label: '-', className: 'bg-slate-700 text-slate-300' },
  };
  const { label, className } = config[signal] || config.neutral;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function KdjBadge({ signal }: { signal: string }) {
  const config: Record<string, { label: string; className: string }> = {
    overbought: { label: '超买', className: 'bg-red-900/50 text-red-300' },
    oversold: { label: '超卖', className: 'bg-green-900/50 text-green-300' },
    golden_cross: { label: '金叉', className: 'bg-blue-900/50 text-blue-300' },
    dead_cross: { label: '死叉', className: 'bg-purple-900/50 text-purple-300' },
    bullish_arrangement: { label: '多头排列', className: 'bg-blue-900/50 text-blue-300' },
    bearish_arrangement: { label: '空头排列', className: 'bg-purple-900/50 text-purple-300' },
    neutral: { label: '-', className: 'bg-slate-700 text-slate-300' },
  };
  const { label, className } = config[signal] || config.neutral;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function BollingerBadge({ position }: { position: number | string }) {
  // API returns position as a number (0-1 representing price position within bands)
  // But may also return strings like "above_upper", "above_middle", etc.
  // Handle string positions
  if (typeof position === 'string') {
    const posMap: Record<string, { label: string; className: string }> = {
      above_upper: { label: '突破上轨', className: 'bg-red-900/50 text-red-300' },
      above_middle: { label: '中轨上方', className: 'bg-blue-900/50 text-blue-300' },
      below_middle: { label: '中轨下方', className: 'bg-purple-900/50 text-purple-300' },
      below_lower: { label: '下轨附近', className: 'bg-green-900/50 text-green-300' },
    };
    const config = posMap[position] || { label: position, className: 'bg-slate-700 text-slate-300' };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${config.className}`}>
        {config.label}
      </span>
    );
  }
  
  // Handle numeric position (0-1)
  let label = '中轨';
  let className = 'bg-slate-700 text-slate-300';
  
  if (position > 0.95) { label = '突破上轨'; className = 'bg-red-900/50 text-red-300'; }
  else if (position > 0.7) { label = '上轨附近'; className = 'bg-orange-900/50 text-orange-300'; }
  else if (position > 0.5) { label = '中轨上方'; className = 'bg-blue-900/50 text-blue-300'; }
  else if (position > 0.3) { label = '中轨下方'; className = 'bg-purple-900/50 text-purple-300'; }
  else if (position > 0.05) { label = '下轨附近'; className = 'bg-green-900/50 text-green-300'; }
  else if (position <= 0.05) { label = '突破下轨'; className = 'bg-green-900/50 text-green-300'; }
  
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function MaBadge({ position }: { position: string }) {
  const config: Record<string, { label: string; className: string }> = {
    above_ma20: { label: '价格>MA20', className: 'bg-red-900/50 text-red-300' },
    below_ma20: { label: '价格<MA20', className: 'bg-green-900/50 text-green-300' },
    bullish_arrangement: { label: 'MA多头', className: 'bg-blue-900/50 text-blue-300' },
    bearish_arrangement: { label: 'MA空头', className: 'bg-purple-900/50 text-purple-300' },
    neutral: { label: '-', className: 'bg-slate-700 text-slate-300' },
  };
  const { label, className } = config[position] || config.neutral;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function SignalBadge({ direction, strength }: { direction: string; strength: number }) {
  if (direction === 'long') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-green-900/50 text-green-300 text-sm font-medium">
        <span>✅</span>
        <span>买入</span>
        {strength > 0 && <span className="text-xs opacity-75">({(strength * 100).toFixed(0)}%)</span>}
      </span>
    );
  }
  if (direction === 'short') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-900/50 text-red-300 text-sm font-medium">
        <span>❌</span>
        <span>卖出</span>
        {strength > 0 && <span className="text-xs opacity-75">({(strength * 100).toFixed(0)}%)</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-yellow-900/50 text-yellow-300 text-sm font-medium">
      <span>⚠️</span>
      <span>观望</span>
    </span>
  );
}

// ==================== Loading Skeleton ====================

function TableSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map(i => (
        <div key={i} className="flex items-center gap-4 p-4 bg-slate-800 rounded-lg border border-slate-700 animate-pulse">
          <div className="w-24 h-4 bg-slate-700 rounded"></div>
          <div className="w-20 h-4 bg-slate-700 rounded"></div>
          <div className="w-20 h-4 bg-slate-700 rounded"></div>
          <div className="w-16 h-4 bg-slate-700 rounded"></div>
          <div className="flex gap-2">
            <div className="w-12 h-4 bg-slate-700 rounded"></div>
            <div className="w-12 h-4 bg-slate-700 rounded"></div>
          </div>
          <div className="w-20 h-4 bg-slate-700 rounded"></div>
          <div className="w-16 h-4 bg-slate-700 rounded"></div>
        </div>
      ))}
    </div>
  );
}

// ==================== Mini Chart Component ====================

interface MiniChartProps {
  code: string;
  name: string;
}

interface KLineData {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

function calcMA(values: number[], period: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    const slice = values.slice(i - period + 1, i + 1);
    return parseFloat((slice.reduce((a, b) => a + b, 0) / period).toFixed(2));
  });
}

function MiniChart({ code, name }: MiniChartProps) {
  const [loading, setLoading] = useState(true);
  const [klineData, setKlineData] = useState<KLineData[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function fetchKline() {
      try {
        // 获取日K线数据
        const period = 'day';
        const response = await fetch(`/api/stock/kline?code=${code}&period=${period}&count=60`);
        const json = await response.json();
        
        if (cancelled || !json.success || !json.data || json.data.length === 0) return;

        const data: KLineData[] = json.data.map((b: any) => ({
          date: new Date(b.timestamp).toISOString().slice(0, 10),
          open: b.open,
          close: b.close,
          high: b.high,
          low: b.low,
          volume: b.volume,
        }));

        setKlineData(data);
      } catch (err) {
        console.error('[MiniChart] Failed to fetch kline:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchKline();
    return () => { cancelled = true; };
  }, [code]);

  const buildOption = useCallback((): EChartsOption => {
    if (klineData.length === 0) return {};

    const dates = klineData.map(d => d.date);
    const closes = klineData.map(d => d.close);
    const volumes = klineData.map(d => d.volume);

    const ma5Data = calcMA(closes, 5);
    const ma20Data = calcMA(closes, 20);
    const ma60Data = calcMA(closes, 60);

    const volColors = klineData.map(d => d.close >= d.open ? '#ef4444' : '#10b981');

    // Compute simple MACD (DIF, DEA, HIST) - using explicit loops to avoid type inference issues
    const ema12Values: number[] = [];
    const ema26Values: number[] = [];
    const k12 = 2 / (12 + 1);
    const k26 = 2 / (26 + 1);
    
    for (let i = 0; i < closes.length; i++) {
      if (i === 0) {
        ema12Values.push(closes[0]);
        ema26Values.push(closes[0]);
      } else {
        ema12Values.push(closes[i] * k12 + ema12Values[i - 1] * (1 - k12));
        ema26Values.push(closes[i] * k26 + ema26Values[i - 1] * (1 - k26));
      }
    }
    
    const difValues: number[] = ema12Values.map((v, i) => v - ema26Values[i]);
    const deaValues: number[] = [];
    const k9 = 2 / (9 + 1);
    
    for (let i = 0; i < difValues.length; i++) {
      if (i === 0) {
        deaValues.push(difValues[0]);
      } else {
        deaValues.push(difValues[i] * k9 + deaValues[i - 1] * (1 - k9));
      }
    }
    
    const histogramValues: number[] = difValues.map((v, i) => (v - deaValues[i]) * 2);

    // Simple KDJ (last 9 values)
    const kdjPeriod = 9;
    const kValues: number[] = [];
    const dValues: number[] = [];
    const jValues: number[] = [];
    
    for (let i = 0; i < closes.length; i++) {
      if (i < kdjPeriod - 1) {
        kValues.push(50);
        dValues.push(50);
        jValues.push(50);
      } else {
        const slice = closes.slice(i - kdjPeriod + 1, i + 1);
        const highVal = Math.max(...slice);
        const lowVal = Math.min(...slice);
        const rsv = highVal === lowVal ? 50 : (closes[i] - lowVal) / (highVal - lowVal) * 100;
        const k = 2 / 3 * (kValues[i - 1] || 50) + 1 / 3 * rsv;
        const d = 2 / 3 * (dValues[i - 1] || 50) + 1 / 3 * k;
        const j = 3 * k - 2 * d;
        kValues.push(k);
        dValues.push(d);
        jValues.push(j);
      }
    }

    const macdColors = histogramValues.map((v: number) => v >= 0 ? '#ef4444' : '#10b981');
    const kdjColors = kValues.map((v: number, _i: number) => {
      if (v > 80) return '#ef4444';
      if (v < 20) return '#10b981';
      return '#3b82f6';
    });

    return {
      backgroundColor: '#1a1a2e',
      textStyle: { color: '#9ca3af', fontSize: 10 },
      legend: { show: false },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', crossStyle: { color: '#6b7280' } },
        backgroundColor: 'rgba(17,17,26,0.95)',
        borderColor: '#374151',
        textStyle: { color: '#d1d5db', fontSize: 11 },
      },
      axisPointer: { link: [{ xAxisIndex: [0, 1, 2] }] },
      xAxis: [
        { type: 'category', data: dates, gridIndex: 0, boundaryGap: false, axisLine: { lineStyle: { color: '#374151' } }, axisTick: { show: false }, axisLabel: { color: '#6b7280', fontSize: 9 }, splitLine: { show: true, lineStyle: { color: '#2d2d3d', type: 'dashed' } } },
        { type: 'category', data: dates, gridIndex: 1, boundaryGap: false, axisLine: { lineStyle: { color: '#374151' } }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false } },
        { type: 'category', data: dates, gridIndex: 2, boundaryGap: false, axisLine: { lineStyle: { color: '#374151' } }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false } },
      ],
      yAxis: [
        { scale: true, gridIndex: 0, splitArea: { show: true, areaStyle: { color: ['#1a1a2e', '#1e1e32'] } }, axisLine: { lineStyle: { color: '#374151' } }, axisTick: { show: false }, axisLabel: { color: '#6b7280', fontSize: 9, formatter: (v: number) => v.toFixed(2) }, splitLine: { lineStyle: { color: '#2d2d3d', type: 'dashed' } } },
        { scale: true, gridIndex: 1, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false } },
        { scale: true, gridIndex: 2, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false } },
      ],
      grid: [
        { left: 50, right: 10, top: 10, height: '45%' },
        { left: 50, right: 10, top: '58%', height: '20%' },
        { left: 50, right: 10, top: '81%', height: '15%' },
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1, 2], start: 50, end: 100 },
      ],
      series: [
        // K线
        { name: 'K线', type: 'candlestick', xAxisIndex: 0, yAxisIndex: 0, data: klineData.map(d => [d.open, d.close, d.low, d.high]), itemStyle: { color: '#ef4444', color0: '#10b981', borderColor: '#ef4444', borderColor0: '#10b981' } },
        // MA5
        { name: 'MA5', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma5Data, smooth: false, lineStyle: { width: 1, color: '#f59e0b' }, symbol: 'none' },
        // MA20
        { name: 'MA20', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma20Data, smooth: false, lineStyle: { width: 1, color: '#a855f7' }, symbol: 'none' },
        // MA60
        { name: 'MA60', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma60Data, smooth: false, lineStyle: { width: 1, color: '#06b6d4' }, symbol: 'none' },
        // MACD
        { name: 'MACD', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: histogramValues.map((v: number, i: number) => ({ value: v, itemStyle: { color: macdColors[i] } })) },
        { name: 'DIF', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: difValues, smooth: false, lineStyle: { width: 1, color: '#3b82f6' }, symbol: 'none' },
        { name: 'DEA', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: deaValues, smooth: false, lineStyle: { width: 1, color: '#f59e0b' }, symbol: 'none' },
        // KDJ
        { name: 'K', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: kValues, smooth: false, lineStyle: { width: 1, color: '#3b82f6' }, symbol: 'none' },
        { name: 'D', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: dValues, smooth: false, lineStyle: { width: 1, color: '#a855f7' }, symbol: 'none' },
        { name: 'J', type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: jValues, smooth: false, lineStyle: { width: 1, color: '#f59e0b' }, symbol: 'none' },
      ],
    };
  }, [klineData]);

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center bg-[#1a1a2e] rounded-lg">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-400 text-xs">加载图表中...</span>
        </div>
      </div>
    );
  }

  if (klineData.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center bg-[#1a1a2e] rounded-lg">
        <span className="text-gray-400 text-sm">暂无数据</span>
      </div>
    );
  }

  return (
    <ReactECharts
      option={buildOption()}
      style={{ width: '100%', height: 300 }}
      opts={{ renderer: 'canvas' }}
    />
  );
}

// ==================== Stock Detail Panel ====================

interface DetailPanelProps {
  stock: WatchedStock;
  onAddToScreener: () => void;
}

function DetailPanel({ stock, onAddToScreener }: DetailPanelProps) {
  const [history, setHistory] = useState<StockSignalHistory[]>([]);
  const [activeTab, setActiveTab] = useState<'signal' | 'news' | 'announcement' | 'alert'>('signal');
  const [newsList, setNewsList] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [annLoading, setAnnLoading] = useState(false);
  const [alertLoading, setAlertLoading] = useState(false);

  // In a real app, we'd fetch signal history from API
  // For now, generate mock history based on current signal
  useEffect(() => {
    const mockHistory: StockSignalHistory[] = [];
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const directions = ['long', 'short', 'neutral'] as const;
      const reasons = ['MACD金叉', 'KDJ超卖', '价格站上MA20', '均线多头排列', 'MACD死叉', 'KDJ超买'];
      mockHistory.push({
        timestamp: now - i * 3600000 * (Math.random() * 10 + 1),
        direction: directions[Math.floor(Math.random() * 3)],
        reason: reasons[Math.floor(Math.random() * reasons.length)],
      });
    }
    setHistory(mockHistory);
  }, [stock.code]);

  // Fetch news when切换到 news tab（走 IndexedDB 缓存）
  useEffect(() => {
    if (activeTab !== 'news') return;
    setNewsLoading(true);
    const rawCode = stock.code.replace('.SZ', '').replace('.SH', '');
    stockDataCache.news(rawCode).then(({ data }) => {
      if (data?.data) setNewsList(data.data);
    }).catch(() => {}).finally(() => setNewsLoading(false));
  }, [activeTab, stock.code]);

  // Fetch announcements when切换到 announcement tab（走 IndexedDB 缓存）
  useEffect(() => {
    if (activeTab !== 'announcement') return;
    setAnnLoading(true);
    const rawCode = stock.code.replace('.SZ', '').replace('.SH', '');
    stockDataCache.announcement(rawCode).then(({ data }) => {
      if (data?.data) setAnnouncements(data.data);
    }).catch(() => {}).finally(() => setAnnLoading(false));
  }, [activeTab, stock.code]);

  // Fetch alerts (涨停/跌停/异动原因) when切换到 alert tab
  useEffect(() => {
    if (activeTab !== 'alert') return;
    setAlertLoading(true);
    const rawCode = stock.code.replace('.SZ', '').replace('.SH', '');
    Promise.all([
      fetch(`/api/stock/alerts?type=zt&pageSize=20`),
      fetch(`/api/stock/alerts?type=yd&pageSize=20`),
    ])
      .then(([ztRes, ydRes]) => Promise.all([ztRes.json(), ydRes.json()]))
      .then(([ztJson, ydJson]) => {
        const ztItems = (ztJson.data || []).filter((i: any) =>
          i.code === rawCode || i.code === stock.code.split('.')[0]
        );
        const ydItems = (ydJson.data || []).filter((i: any) =>
          i.code === rawCode || i.code === stock.code.split('.')[0]
        );
        setAlerts([...ztItems, ...ydItems]);
      })
      .catch(() => {})
      .finally(() => setAlertLoading(false));
  }, [activeTab, stock.code]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const { indicators, signal } = stock;

  return (
    <div className="mt-4 bg-slate-800 border border-slate-700 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-white">{stock.name}</h3>
          <span className="text-sm text-slate-400">{stock.code}</span>
        </div>
        <button
          onClick={onAddToScreener}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          添加到选股器
        </button>
      </div>

      {/* Chart */}
      <div className="mb-4 rounded-lg overflow-hidden border border-slate-700">
        <MiniChart code={stock.code} name={stock.name} />
      </div>

      {/* Technical Indicators */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {/* MACD */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">MACD</div>
          <div className="text-sm font-medium text-white">
            DIF: {indicators.macd.value.toFixed(3)}
          </div>
          <div className="text-sm text-slate-200">DEA: {(indicators.macd.value * 0.8).toFixed(3)}</div>
          <div className="text-sm text-slate-200">柱: {indicators.macd.histogram.toFixed(3)}</div>
          <div className="mt-1">
            <MacdBadge signal={indicators.macd.signal} />
          </div>
        </div>

        {/* KDJ */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">KDJ</div>
          <div className="text-sm font-medium text-white">
            K: {indicators.kdj.k.toFixed(1)}
          </div>
          <div className="text-sm text-slate-200">D: {indicators.kdj.d.toFixed(1)}</div>
          <div className="text-sm text-slate-200">J: {indicators.kdj.j.toFixed(1)}</div>
          <div className="mt-1">
            <KdjBadge signal={indicators.kdj.signal} />
          </div>
        </div>

        {/* Bollinger */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">布林带</div>
          <div className="text-sm font-medium text-white">
            上轨: {indicators.bollinger.upper.toFixed(2)}
          </div>
          <div className="text-sm text-slate-200">中轨: {indicators.bollinger.middle.toFixed(2)}</div>
          <div className="text-sm text-slate-200">下轨: {indicators.bollinger.lower.toFixed(2)}</div>
          <div className="mt-1">
            <BollingerBadge position={indicators.bollinger.position} />
          </div>
        </div>

        {/* MA */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">均线</div>
          <div className="text-sm font-medium text-white">
            MA5: {indicators.ma.ma5.toFixed(2)}
          </div>
          <div className="text-sm text-slate-200">MA10: {indicators.ma.ma10.toFixed(2)}</div>
          <div className="text-sm text-slate-200">MA20: {indicators.ma.ma20.toFixed(2)}</div>
          <div className="text-sm text-slate-200">MA60: {indicators.ma.ma60.toFixed(2)}</div>
        </div>

        {/* CCI */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">CCI</div>
          <div className="text-sm font-medium text-white">
            {indicators.cci.value.toFixed(1)}
          </div>
          <div className="mt-1">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
              indicators.cci.signal === 'cci_oversold' ? 'bg-green-900/50 text-green-300' :
              indicators.cci.signal === 'cci_overbought' ? 'bg-red-900/50 text-red-300' :
              'bg-slate-700 text-slate-300'
            }`}>
              {indicators.cci.signal === 'cci_oversold' ? '超卖' :
               indicators.cci.signal === 'cci_overbought' ? '超买' : '中性'}
            </span>
          </div>
        </div>

        {/* OBV */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">OBV</div>
          <div className="text-sm font-medium text-white">
            {indicators.obv.value.toFixed(0)}
          </div>
          <div className="mt-1">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
              indicators.obv.signal === 'obv_rise' ? 'bg-green-900/50 text-green-300' :
              indicators.obv.signal === 'obv_fall' ? 'bg-red-900/50 text-red-300' :
              'bg-slate-700 text-slate-300'
            }`}>
              {indicators.obv.signal === 'obv_rise' ? '上升' :
               indicators.obv.signal === 'obv_fall' ? '下降' : '中性'}
            </span>
          </div>
        </div>

        {/* ADX */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">ADX</div>
          <div className="text-sm font-medium text-white">
            {indicators.adx.adx.toFixed(1)}
          </div>
          <div className="text-sm text-slate-200">DMI: {indicators.adx.value.toFixed(1)}</div>
          <div className="mt-1">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
              indicators.adx.signal === 'strong_up' ? 'bg-green-900/50 text-green-300' :
              indicators.adx.signal === 'strong_down' ? 'bg-red-900/50 text-red-300' :
              'bg-slate-700 text-slate-300'
            }`}>
              {indicators.adx.signal === 'strong_up' ? '强势上涨' :
               indicators.adx.signal === 'strong_down' ? '强势下跌' : '趋弱'}
            </span>
          </div>
        </div>
      </div>

      {/* Signal Summary */}
      <div className="bg-blue-900/30 border border-blue-800 rounded-lg p-3 mb-4">
        <div className="text-xs text-blue-300 font-medium mb-1">综合信号</div>
        <div className="flex items-center gap-3">
          <SignalBadge direction={signal.direction} strength={signal.strength} />
          <span className="text-sm text-slate-200">{signal.reason}</span>
        </div>
      </div>

      {/* 消息面 Tab 切换 */}
      <div className="flex border-b border-slate-700 mb-4">
        {([
          { key: 'signal', label: '📊 信号历史' },
          { key: 'news', label: '📰 最新新闻' },
          { key: 'announcement', label: '📋 公司公告' },
          { key: 'alert', label: '🚨 异动分析' },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-400 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 信号历史 */}
      {activeTab === 'signal' && (
      <div>
        <div className="text-sm font-medium text-slate-200 mb-2">信号历史</div>
        <div className="space-y-2">
          {history.map((h, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-slate-700 last:border-0">
              <span className="text-sm text-slate-400">{formatTime(h.timestamp)}</span>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded ${
                  h.direction === 'long' ? 'bg-green-900/50 text-green-300' :
                  h.direction === 'short' ? 'bg-red-900/50 text-red-300' :
                  'bg-yellow-900/50 text-yellow-300'
                }`}>
                  {h.direction === 'long' ? '买入' : h.direction === 'short' ? '卖出' : '观望'}
                </span>
                <span className="text-sm text-slate-400">{h.reason}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* 新闻列表 */}
      {activeTab === 'news' && (
        <div>
          <div className="text-sm font-medium text-slate-200 mb-3">最新资讯</div>
          {newsLoading ? (
            <div className="py-8 text-center text-slate-400">
              <div className="text-2xl mb-2 animate-spin">⟳</div>
              <p className="text-sm">加载中...</p>
            </div>
          ) : newsList.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-sm">暂无新闻</div>
          ) : (
            <div className="space-y-2">
              {newsList.map((item: any, i: number) => (
                <a
                  key={i}
                  href={item.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block bg-slate-800/80 border border-slate-700 rounded-lg p-3 hover:bg-slate-700/60 transition-colors group"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {item.tags?.map((tag: string) => (
                          <span key={tag} className={`text-xs px-1.5 py-0.5 rounded ${
                            tag === '利好' ? 'bg-red-900/50 text-red-300' :
                            tag === '利空' ? 'bg-green-900/50 text-green-300' :
                            tag === '重大' ? 'bg-yellow-900/50 text-yellow-300' :
                            'bg-slate-700 text-slate-300'
                          }`}>{tag}</span>
                        ))}
                        {item.isImportant && (
                          <span className="text-xs bg-yellow-900/50 text-yellow-300 px-1.5 py-0.5 rounded">重要</span>
                        )}
                        <span className="text-xs text-slate-500 ml-auto">{item.publishTime}</span>
                      </div>
                      <div className="text-sm text-slate-200 group-hover:text-white line-clamp-2">{item.title}</div>
                      <div className="text-xs text-slate-500 mt-1 line-clamp-1">{item.content || item.Digest}</div>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 公告列表 */}
      {activeTab === 'announcement' && (
        <div>
          <div className="text-sm font-medium text-slate-200 mb-3">公司公告</div>
          {annLoading ? (
            <div className="py-8 text-center text-slate-400">
              <div className="text-2xl mb-2 animate-spin">⟳</div>
              <p className="text-sm">加载中...</p>
            </div>
          ) : announcements.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-sm">暂无公告</div>
          ) : (
            <div className="space-y-2">
              {announcements.map((item: any, i: number) => (
                <a
                  key={i}
                  href={item.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block bg-slate-800/80 border border-slate-700 rounded-lg p-3 hover:bg-slate-700/60 transition-colors group"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded">
                          {item.category}
                        </span>
                        <span className="text-xs text-slate-500 ml-auto">{item.publishTime}</span>
                      </div>
                      <div className="text-sm text-slate-200 group-hover:text-white line-clamp-2">{item.title}</div>
                      {item.abstract && (
                        <div className="text-xs text-slate-500 mt-1 line-clamp-1">{item.abstract}</div>
                      )}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 异动分析 */}
      {activeTab === 'alert' && (
        <div>
          <div className="text-sm font-medium text-slate-200 mb-3">异动历史记录</div>
          {alertLoading ? (
            <div className="py-8 text-center text-slate-400">
              <div className="text-2xl mb-2 animate-spin">⟳</div>
              <p className="text-sm">加载中...</p>
            </div>
          ) : alerts.length === 0 ? (
            <div className="py-8 text-center">
              <div className="text-3xl mb-2">✨</div>
              <p className="text-slate-500 text-sm">该股票近期无异动记录</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* 异动原因分析摘要 */}
              <div className="bg-slate-800/80 border border-slate-700 rounded-lg p-3">
                <div className="text-xs text-slate-400 mb-2">异动原因统计</div>
                <div className="space-y-1">
                  {(() => {
                    const reasonCount: Record<string, number> = {};
                    alerts.forEach((a: any) => { reasonCount[a.alertReason] = (reasonCount[a.alertReason] || 0) + 1; });
                    const sorted = Object.entries(reasonCount).sort((a, b) => b[1] - a[1]);
                    return sorted.slice(0, 5).map(([reason, count]) => (
                      <div key={reason} className="flex items-center justify-between">
                        <span className="text-xs text-slate-300 truncate flex-1 mr-2">{reason}</span>
                        <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded">{count}次</span>
                      </div>
                    ));
                  })()}
                </div>
              </div>

              {/* 异动列表 */}
              <div className="text-xs text-slate-500 mb-2">最近异动 ({alerts.length}条)</div>
              {alerts.map((item: any, i: number) => (
                <div
                  key={i}
                  className={`border rounded-lg p-3 ${
                    item.alertType === 'zt' ? 'border-red-800/60 bg-red-900/10' :
                    item.alertType === 'dt' ? 'border-green-800/60 bg-green-900/10' :
                    'border-yellow-800/60 bg-yellow-900/10'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                        item.alertType === 'zt' ? 'bg-red-900/50 text-red-300' :
                        item.alertType === 'dt' ? 'bg-green-900/50 text-green-300' :
                        'bg-yellow-900/50 text-yellow-300'
                      }`}>
                        {item.alertType === 'zt' ? '🔺 涨停' : item.alertType === 'dt' ? '🔻 跌停' : '⚡ 异动'}
                      </span>
                      <span className="text-xs text-slate-500">{item.publishTime}</span>
                    </div>
                    <span className={`text-sm font-medium ${
                      item.changePercent >= 0 ? 'text-red-400' : 'text-green-400'
                    }`}>
                      {item.changePercent >= 0 ? '+' : ''}{item.changePercent.toFixed(2)}%
                    </span>
                  </div>
                  {/* 异动原因 */}
                  <div className="flex items-start gap-2">
                    <span className="text-xs text-slate-400 mt-0.5">原因:</span>
                    <span className="text-sm text-slate-200">{item.alertReason}</span>
                  </div>
                  {/* 成交信息 */}
                  {(item.turnover > 0 || item.amount > 0) && (
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                      {item.turnover > 0 && <span>换手率: <span className="text-slate-300">{item.turnover.toFixed(2)}%</span></span>}
                      {item.amount > 0 && <span>成交额: <span className="text-slate-300">{(item.amount / 100000000).toFixed(2)}亿</span></span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==================== Alert Banner Component ====================

interface AlertBannerItem {
  code: string;
  name: string;
  changePercent: number;
  alertType: 'zt' | 'dt' | 'yd';
  alertReason: string;
}

function AlertBanner() {
  const ALERT_CACHE_KEY = 'quant_alert_banner_cache';
  const ALERT_CACHE_TTL = 5 * 60 * 1000; // 5分钟

  // 初始化：始终优先从 localStorage 恢复，再后台静默刷新
  const [ztStocks, setZtStocks] = useState<AlertBannerItem[]>(() => {
    try {
      const cached = localStorage.getItem(ALERT_CACHE_KEY);
      if (cached) {
        const { data, ts } = JSON.parse(cached);
        if (Date.now() - ts < ALERT_CACHE_TTL) return data.zt || [];
      }
    } catch { /* ignore */ }
    return [];
  });
  const [dtStocks, setDtStocks] = useState<AlertBannerItem[]>(() => {
    try {
      const cached = localStorage.getItem(ALERT_CACHE_KEY);
      if (cached) {
        const { data, ts } = JSON.parse(cached);
        if (Date.now() - ts < ALERT_CACHE_TTL) return data.dt || [];
      }
    } catch { /* ignore */ }
    return [];
  });
  const [ydStocks, setYdStocks] = useState<AlertBannerItem[]>(() => {
    try {
      const cached = localStorage.getItem(ALERT_CACHE_KEY);
      if (cached) {
        const { data, ts } = JSON.parse(cached);
        if (Date.now() - ts < ALERT_CACHE_TTL) return data.yd || [];
      }
    } catch { /* ignore */ }
    return [];
  });
  const [lastUpdate, setLastUpdate] = useState<string>(() => {
    try {
      const cached = localStorage.getItem(ALERT_CACHE_KEY);
      if (cached) {
        const { ts } = JSON.parse(cached);
        if (ts) return new Date(ts).toLocaleTimeString();
      }
    } catch { /* ignore */ }
    return '';
  });
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    try {
      const [ztRes, dtRes, ydRes] = await Promise.all([
        fetch('/api/stock/alerts?type=zt&pageSize=10'),
        fetch('/api/stock/alerts?type=dt&pageSize=5'),
        fetch('/api/stock/alerts?type=yd&pageSize=10'),
      ]);
      const [ztJson, dtJson, ydJson] = await Promise.all([ztRes.json(), dtRes.json(), ydRes.json()]);

      const newZt = (ztJson.data || []).slice(0, 8).map((i: any) => ({
        code: i.code, name: i.name,
        changePercent: i.changePercent,
        alertType: 'zt' as const,
        alertReason: i.alertReason,
      }));
      const newDt = (dtJson.data || []).slice(0, 5).map((i: any) => ({
        code: i.code, name: i.name,
        changePercent: i.changePercent,
        alertType: 'dt' as const,
        alertReason: i.alertReason,
      }));
      const newYd = (ydJson.data || []).slice(0, 8).map((i: any) => ({
        code: i.code, name: i.name,
        changePercent: i.changePercent,
        alertType: 'yd' as const,
        alertReason: i.alertReason,
      }));
      const now = Date.now();

      setZtStocks(newZt);
      setDtStocks(newDt);
      setYdStocks(newYd);
      setLastUpdate(new Date(now).toLocaleTimeString());
      // 存入 localStorage（使用新的数据，避免闭包旧值 bug）
      try {
        localStorage.setItem(ALERT_CACHE_KEY, JSON.stringify({
          data: { zt: newZt, dt: newDt, yd: newYd },
          ts: now,
        }));
      } catch { /* ignore */ }
    } catch (e) {
      console.error('[AlertBanner] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 有缓存时先展示，后台静默刷新
    const hasCache = ztStocks.length > 0 || dtStocks.length > 0 || ydStocks.length > 0;
    if (hasCache) {
      setLoading(false);
      fetchAlerts(); // 静默后台刷新
    } else {
      fetchAlerts();
    }
    const id = setInterval(fetchAlerts, 30_000); // 每30秒刷新
    return () => clearInterval(id);
  }, []);

  if (loading) return null;

  const totalAlerts = ztStocks.length + dtStocks.length + ydStocks.length;
  if (totalAlerts === 0) return null;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden mb-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-yellow-400">🚨 异动快讯</span>
          <span className="text-xs text-slate-500">最后更新 {lastUpdate}</span>
        </div>
        <button
          onClick={fetchAlerts}
          className="text-xs text-slate-400 hover:text-white transition-colors"
        >
          刷新
        </button>
      </div>

      {/* Content */}
      <div className="p-3 space-y-3">
        {/* 涨停 */}
        {ztStocks.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-red-400 bg-red-900/30 px-2 py-0.5 rounded">
                🔺 涨停 ({ztStocks.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {ztStocks.map((s) => (
                <div
                  key={s.code}
                  className="flex items-center gap-2 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-red-900/40 transition-colors group"
                  title={`涨停原因: ${s.alertReason}`}
                >
                  <span className="text-sm font-medium text-red-300">{s.name}</span>
                  <span className="text-xs text-red-400">+{s.changePercent.toFixed(1)}%</span>
                  <span className="text-xs text-slate-400 group-hover:text-slate-300 max-w-[120px] truncate">
                    {s.alertReason}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 跌停 */}
        {dtStocks.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-green-400 bg-green-900/30 px-2 py-0.5 rounded">
                🔻 跌停 ({dtStocks.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {dtStocks.map((s) => (
                <div
                  key={s.code}
                  className="flex items-center gap-2 bg-green-900/20 border border-green-800/50 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-green-900/40 transition-colors group"
                  title={`跌停原因: ${s.alertReason}`}
                >
                  <span className="text-sm font-medium text-green-300">{s.name}</span>
                  <span className="text-xs text-green-400">{s.changePercent.toFixed(1)}%</span>
                  <span className="text-xs text-slate-400 group-hover:text-slate-300 max-w-[120px] truncate">
                    {s.alertReason}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 异动 */}
        {ydStocks.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-yellow-400 bg-yellow-900/30 px-2 py-0.5 rounded">
                ⚡ 异动 ({ydStocks.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {ydStocks.map((s) => (
                <div
                  key={s.code}
                  className="flex items-center gap-2 bg-yellow-900/20 border border-yellow-800/50 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-yellow-900/40 transition-colors group"
                  title={`异动原因: ${s.alertReason}`}
                >
                  <span className="text-sm font-medium text-yellow-200">{s.name}</span>
                  <span className={`text-xs ${s.changePercent >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {s.changePercent >= 0 ? '+' : ''}{s.changePercent.toFixed(1)}%
                  </span>
                  <span className="text-xs text-slate-400 group-hover:text-slate-300 max-w-[120px] truncate">
                    {s.alertReason}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Main Component ====================

export default function SignalMonitor() {
  // 自选股：从 Dexie store 读取（而非本地 state）
  const storeWatchlists = useWatchlistStore(s => s.watchlists);
  const storeIsLoaded = useWatchlistStore(s => s.isLoaded);
  const activeWatchlistId = useWatchlistStore(s => s.activeWatchlistId);
  const addStockToStore = useWatchlistStore(s => s.addStock);
  const removeStockFromStore = useWatchlistStore(s => s.removeStock);

  // 从 store 同步当前激活分组的股票列表
  const activeWatchlist = storeWatchlists.find(w => w.id === activeWatchlistId);
  const watchlistCodes: string[] = activeWatchlist?.codes ?? [];

  // 实时行情数据（内存 state，行情数据不适合存 Dexie）
  const [watchlistData, setWatchlistData] = useState<Map<string, WatchedStock>>(new Map());
  const [selectedStock, setSelectedStock] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const watchlistDataRef = useRef<Map<string, WatchedStock>>(new Map());
  // 代码→名称映射（从 /api/stock/list 加载，1小时有效）
  const nameMapRef = useRef<Map<string, string>>(new Map());
  // 实时信号引擎（跨轮询复用）
  const signalEngineRef = useRef<ReturnType<typeof getRealtimeSignalEngine> | null>(null);

  // ── 账户资金状态（用于仓位计算） ──────────────────
  const [accountBalance, setAccountBalance] = useState<number>(100000);
  const [submittingCode, setSubmittingCode] = useState<string | null>(null);

  // 拉取模拟账户余额
  useEffect(() => {
    fetch('/api/simulator')
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data?.account?.balance) {
          setAccountBalance(json.data.account.balance);
        }
      })
      .catch(() => {});
  }, []);

  // Keep watchlistDataRef in sync with state
  useEffect(() => {
    watchlistDataRef.current = watchlistData;
  }, [watchlistData]);

  // 当 store 完成加载且 watchlist codes 变化时，初始化 watchlistData
  useEffect(() => {
    if (!storeIsLoaded) return;
    // 异步加载股票名称映射（利用 Next.js 1小时服务端缓存，很快）
    if (nameMapRef.current.size === 0) {
      fetch('/api/stock/list')
        .then(r => r.json())
        .then(json => {
          if (json.data) {
            for (const s of json.data) {
              nameMapRef.current.set(s.code, s.name);
            }
          }
        })
        .catch(() => {});
    }
  }, [storeIsLoaded]);

  useEffect(() => {
    if (!storeIsLoaded) return;
    // 用现有 codes 初始化 watchlistData map
    const map = new Map<string, WatchedStock>();
    for (const code of watchlistCodes) {
      const existing = watchlistDataRef.current.get(code);
      if (existing) {
        map.set(code, existing);
      } else {
        map.set(code, {
          code,
          name: nameMapRef.current.get(code) || code,
          price: 0,
          change: 0,
          changePercent: 0,
          indicators: {
            macd: { value: 0, signal: 'neutral', histogram: 0 },
            kdj: { k: 0, d: 0, j: 0, signal: 'neutral' },
            bollinger: { upper: 0, middle: 0, lower: 0, position: 0.5 },
            ma: { ma5: 0, ma10: 0, ma20: 0, ma60: 0, position: 'neutral' },
            cci: { value: 0, signal: 'cci_neutral' },
            obv: { value: 0, signal: 'obv_neutral' },
            adx: { value: 0, adx: 0, signal: 'weak' },
          },
          signal: { direction: 'neutral', strength: 0, reason: '等待数据...' },
          lastUpdate: 0,
        });
      }
    }
    setWatchlistData(map);
    if (watchlistCodes.length > 0 && !selectedStock) {
      setSelectedStock(watchlistCodes[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeIsLoaded, watchlistCodes.join(',')]);

  // 从首页因子分析跳转过来时，自动选中对应股票
  useEffect(() => {
    if (!storeIsLoaded) return;
    const code = sessionStorage.getItem('home_to_monitor');
    if (code && watchlistCodes.includes(code)) {
      setSelectedStock(code);
    } else if (code && !watchlistCodes.includes(code)) {
      // 代码不在当前自选里，先加到自选再选中
      addStockToStore(activeWatchlistId || '', code).then(() => {
        setSelectedStock(code);
      });
    }
    sessionStorage.removeItem('home_to_monitor');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeIsLoaded]);

  // Fetch data for all watched stocks — uses watchlistDataRef to avoid stale closure
  // 获取实时信号引擎（懒初始化）
  const getEngine = useCallback(() => {
    if (!signalEngineRef.current) {
      signalEngineRef.current = getRealtimeSignalEngine();
    }
    return signalEngineRef.current;
  }, []);

  // 加载某股票的日K线数据（仅在首次或缓存空时调用）
  const loadKlineIfNeeded = useCallback(async (code: string) => {
    const engine = getEngine();
    const cached = engine.getKbars(code);
    if (cached.length > 0) return; // 已有缓存，跳过

    try {
      const resp = await fetch(`/api/stock/kline?code=${code}&period=day&count=60`);
      const json = await resp.json();
      if (json.success && json.data && json.data.length > 0) {
        engine.setKbars(code, json.data);
      }
    } catch (e) {
      console.error('[SignalMonitor] Failed to load kline for', code, e);
    }
  }, [getEngine]);

  // 为所有自选股预加载K线数据（幂等调用）
  useEffect(() => {
    if (!storeIsLoaded || watchlistCodes.length === 0) return;
    // 并发加载但不阻塞行情轮询
    watchlistCodes.forEach(code => { loadKlineIfNeeded(code); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeIsLoaded, watchlistCodes.join(',')]);

  const fetchWatchlistData = useCallback(async () => {
    const currentMap = watchlistDataRef.current;
    if (currentMap.size === 0) return;

    const codes = Array.from(currentMap.keys()).join(',');
    const cache = getDataCache();
    const engine = getEngine();

    try {
      setIsStale(false);

      // 市场关闭时尝试从缓存读取
      if (!isMarketOpen()) {
        const cached = cache.getQuote(Array.from(currentMap.keys()));
        if (cached.size > 0) {
          setWatchlistData(prev => {
            const next = new Map(prev);
            for (const [code, update] of cached) {
              const stock = next.get(code);
              if (stock) {
                next.set(code, {
                  ...stock,
                  name: update.name || stock.name,
                  price: update.price,
                  change: update.change,
                  changePercent: update.changePercent,
                  lastUpdate: Date.now(),
                });
              }
            }
            return next;
          });
          setLastFetch(new Date());
          return;
        }
      }

      // 获取实时行情（不带指标，由客户端引擎计算）
      const response = await fetch(`/api/stock/realtime?codes=${codes}&indicators=0`);
      const json = await response.json();

      if (json.success && json.data) {
        // 写入缓存
        for (const item of json.data) {
          cache.setQuote(item.code, item);
        }

        // 用实时行情驱动信号引擎，计算综合信号
        for (const item of json.data) {
          const result = engine.updateRealtimeQuote(item.code, {
            price: item.price,
            open: item.open,
            high: item.high,
            low: item.low,
            volume: item.volume,
          });

          if (result) {
            // 将引擎输出的指标/signal 覆盖到 watchlistData
            currentMap.set(item.code, {
              ...(currentMap.get(item.code) || {
                code: item.code,
                name: item.name || item.code,
                indicators: {} as WatchedStock['indicators'],
                signal: { direction: 'neutral', strength: 0, reason: '' },
              }),
              name: item.name || currentMap.get(item.code)?.name || item.code,
              price: item.price,
              change: item.change,
              changePercent: item.changePercent,
              indicators: {
                macd: {
                  value: result.indicators.macd.value,
                  signal: result.indicators.macd.state,
                  histogram: result.indicators.macd.histogram,
                },
                kdj: {
                  k: result.indicators.kdj.k,
                  d: result.indicators.kdj.d,
                  j: result.indicators.kdj.j,
                  signal: result.indicators.kdj.state,
                },
                bollinger: {
                  upper: result.indicators.bollinger.upper,
                  middle: result.indicators.bollinger.middle,
                  lower: result.indicators.bollinger.lower,
                  position: result.indicators.bollinger.position,
                },
                ma: {
                  ma5: result.indicators.sma5,
                  ma10: result.indicators.sma10,
                  ma20: result.indicators.sma20,
                  ma60: result.indicators.sma60,
                  position: result.compositeSignal.direction === 'long' ? 'above_ma20' :
                            result.compositeSignal.direction === 'short' ? 'below_ma20' : 'neutral',
                },
                cci: { value: result.indicators.cci.value, signal: result.indicators.cci.state },
                obv: { value: result.indicators.obv.value, signal: result.indicators.obv.state },
                adx: { value: result.indicators.adx.value, adx: result.indicators.adx.adx, signal: result.indicators.adx.state },
              },
              signal: {
                direction: result.compositeSignal.direction,
                strength: result.compositeSignal.strength,
                reason: result.compositeSignal.reason,
              },
              lastUpdate: Date.now(),
            });
          } else {
            // 引擎数据不足（K线未加载完），降级用原始行情
            const stock = currentMap.get(item.code);
            if (stock) {
              currentMap.set(item.code, {
                ...stock,
                name: item.name || stock.name,
                price: item.price,
                change: item.change,
                changePercent: item.changePercent,
                lastUpdate: Date.now(),
              });
            }
          }
        }

        setWatchlistData(new Map(currentMap));
        setLastFetch(new Date());
      }
    } catch (err) {
      console.error('[SignalMonitor] Fetch error:', err);
      setIsStale(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getEngine]);

  // Debounced autocomplete search
  const searchStocks = useCallback((keyword: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!keyword.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setSearchLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stock/search?q=${encodeURIComponent(keyword)}&limit=8`);
        const json = await res.json();
        setSuggestions(json.data || []);
        setShowSuggestions(true);
      } catch {
        setSuggestions([]);
      } finally {
        setSearchLoading(false);
      }
    }, 200);
  }, []);

  // Click outside to close suggestions
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Initial fetch and polling — market-hours aware, refs avoid dependency cycles
  useEffect(() => {
    fetchWatchlistData();
    
    // 交易时段5s轮询，非交易时段停掉轮询（指数等数据已缓存）
    let intervalId: NodeJS.Timeout | null = null;
    
    const scheduleTick = () => {
      if (intervalId) clearInterval(intervalId);
      if (isMarketOpen()) {
        intervalId = setInterval(fetchWatchlistData, POLL_INTERVAL);
      } else {
        // 非交易时段每分钟检查一次是否开盘
        intervalId = setInterval(() => {
          if (isMarketOpen()) {
            clearInterval(intervalId!);
            fetchWatchlistData();
            scheduleTick();
          }
        }, 60_000);
      }
    };
    
    scheduleTick();
    
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — fetchWatchlistData is stable via watchlistRef

  // Add stock to watchlist (writes to Dexie store + local state)
  // name is optional; if not provided the API response will fill it in on next refresh
  const addStock = useCallback((code: string, name?: string) => {
    const formattedCode = parseCodeInput(code);
    if (!formattedCode) return;

    // 检查 store 中是否已存在（按当前激活分组）
    const state = useWatchlistStore.getState();
    const activeId = state.activeWatchlistId;
    if (!activeId) return;

    // 如果当前激活分组已有此股票，跳过
    const activeWl = state.watchlists.find(w => w.id === activeId);
    if (activeWl?.codes.includes(formattedCode)) return;

    // 写入 Dexie
    addStockToStore(activeId, formattedCode);

    // 更新本地 watchlistData
    setWatchlistData(prev => {
      if (prev.has(formattedCode)) return prev;
      const next = new Map(prev);
      next.set(formattedCode, {
        code: formattedCode,
        name: name || nameMapRef.current.get(formattedCode) || formattedCode,  // name 优先，fallback: 代码映射表 → 代码占位
        price: 0,
        change: 0,
        changePercent: 0,
        indicators: {
          macd: { value: 0, signal: 'neutral', histogram: 0 },
          kdj: { k: 0, d: 0, j: 0, signal: 'neutral' },
          bollinger: { upper: 0, middle: 0, lower: 0, position: 0.5 },
          ma: { ma5: 0, ma10: 0, ma20: 0, ma60: 0, position: 'neutral' },
          cci: { value: 0, signal: 'cci_neutral' },
          obv: { value: 0, signal: 'obv_neutral' },
          adx: { value: 0, adx: 0, signal: 'weak' },
        },
        signal: { direction: 'neutral', strength: 0, reason: '等待数据...' },
        lastUpdate: 0,
      });
      return next;
    });
    setSelectedStock(formattedCode);

    // 立即拉取这只股票的数据（不等下次轮询）
    fetch(`/api/stock/realtime?codes=${formattedCode}&indicators=1`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data && json.data[0]) {
          const item = json.data[0];
          setWatchlistData(prev => {
            const stock = prev.get(formattedCode);
            if (!stock) return prev;
            return new Map(prev).set(formattedCode, {
              ...stock,
              name: item.name || stock.name,
              price: item.price,
              change: item.change,
              changePercent: item.changePercent,
              indicators: item.indicators || stock.indicators,
              signal: item.signal || stock.signal,
              lastUpdate: Date.now(),
            });
          });
        }
      })
      .catch(() => {});
  }, [addStockToStore]);

  // Remove stock from watchlist (writes to Dexie + local state)
  const removeStock = useCallback((code: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const state = useWatchlistStore.getState();
    const activeId = state.activeWatchlistId;
    if (!activeId) return;

    // 从 Dexie 删除
    removeStockFromStore(activeId, code);

    // 从本地 state 删除
    setWatchlistData(prev => {
      const next = new Map(prev);
      next.delete(code);
      return next;
    });
    if (selectedStock === code) setSelectedStock(null);
  }, [removeStockFromStore, selectedStock]);

  // ── 快速买卖 ──────────────────────────────────────
  // 根据评分计算建议仓位（单股上限）
  const getPositionLimit = (score: number): number => {
    if (score >= 70) return Math.min(0.20, score / 100); // 重仓：20%
    if (score >= 55) return Math.min(0.12, score / 100); // 中仓：12%
    if (score >= 40) return Math.min(0.08, score / 100); // 轻仓：8%
    return 0;
  };

  // 计算某只股票的建议买入数量（手 = 100股）
  const calcShares = (price: number, score: number, totalBalance: number): number => {
    const limitPct = getPositionLimit(score);
    if (limitPct === 0 || price <= 0) return 0;
    const amount = totalBalance * limitPct;
    const shares = Math.floor(amount / price / 100) * 100; // 向下取整100股
    return shares;
  };

  const handleQuickBuy = async (stock: WatchedStock) => {
    if (stock.price <= 0) { toast.error('行情价格无效'); return; }
    const score = Math.round(stock.signal.strength * 100) || 50;
    const volume = calcShares(stock.price, score, accountBalance);
    if (volume === 0) { toast.warning('评分过低，暂不建议买入'); return; }
    setSubmittingCode(stock.code);
    try {
      const res = await fetch('/api/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'order', code: stock.code, direction: 'long', type: 'market', volume }),
      });
      const json = await res.json();
      if (json.success) {
        // 刷新账户余额
        const accRes = await fetch('/api/simulator');
        const accJson = await accRes.json();
        if (accJson.success && accJson.data?.account?.balance) {
          setAccountBalance(accJson.data.account.balance);
        }
        toast.success(`买入成功：${stock.name} × ${volume}股`);
      } else {
        toast.error('买入失败：' + (json.error || '未知错误'));
      }
    } catch {
      toast.error('网络错误，买入失败');
    } finally {
      setSubmittingCode(null);
    }
  };

  const handleQuickSell = async (stock: WatchedStock) => {
    if (stock.price <= 0) { toast.error('行情价格无效'); return; }
    setSubmittingCode(stock.code);
    try {
      // 先查询当前账户持仓量
      const accRes = await fetch('/api/simulator');
      const accJson = await accRes.json();
      if (!accJson.success) { toast.error('查询账户失败'); return; }
      const positions: any[] = accJson.data?.positions ?? [];
      const pos = positions.find((p: any) => p.code === stock.code);
      const volume = pos?.volume ?? 0;
      if (volume === 0) { toast.warning('当前没有持仓，无需卖出'); setSubmittingCode(null); return; }
      const res = await fetch('/api/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'order', code: stock.code, direction: 'short', type: 'market', volume }),
      });
      const json = await res.json();
      if (json.success) {
        if (accJson.data?.account?.balance) setAccountBalance(accJson.data.account.balance);
        toast.success(`卖出成功：${stock.name} × ${volume}股`);
      } else {
        toast.error('卖出失败：' + (json.error || '未知错误'));
      }
    } catch {
      toast.error('网络错误，卖出失败');
    } finally {
      setSubmittingCode(null);
    }
  };

  // Handle search input change
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchInput(val);
    setHighlightedIdx(-1);
    searchStocks(val);
  }, [searchStocks]);

  // Handle keyboard navigation in suggestions
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Enter') {
        const code = parseCodeInput(searchInput);
        if (code) { addStock(code); setSearchInput(''); setShowSuggestions(false); }
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIdx(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = highlightedIdx >= 0 ? highlightedIdx : 0;
      const s = suggestions[idx];
      if (s) {
        addStock(s.code);
        setSearchInput('');
        setShowSuggestions(false);
      } else {
        const code = parseCodeInput(searchInput);
        if (code) { addStock(code); setSearchInput(''); setShowSuggestions(false); }
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  }, [showSuggestions, suggestions, highlightedIdx, searchInput, addStock]);

  // Select from suggestion dropdown
  const selectSuggestion = useCallback((s: any) => {
    addStock(s.code, s.name);
    setSearchInput('');
    setShowSuggestions(false);
    setSuggestions([]);
  }, [addStock]);

  // Quick add handlers
  const handleQuickAdd = useCallback((code: string, name?: string) => {
    addStock(formatCode(code), name);
  }, [addStock]);

  const selectedStockData = selectedStock ? watchlistData.get(selectedStock) : undefined;

  return (
    <div className="space-y-4">
      {/* 异动快讯 Banner */}
      <AlertBanner />

      {/* Search & Add Bar */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
        {/* Search Input with Autocomplete */}
        <div className="relative mb-3" ref={searchRef}>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              {searchLoading ? (
                <span className="animate-spin inline-block">⟳</span>
              ) : (
                <span>🔍</span>
              )}
            </span>
            <input
              type="text"
              value={searchInput}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              onFocus={() => searchInput && setShowSuggestions(true)}
              placeholder="输入股票代码、名称或拼音缩写..."
              className="w-full pl-10 pr-4 py-2 border border-slate-600 bg-slate-800 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="off"
            />
          </div>

          {/* Suggestions Dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50 overflow-hidden">
              {suggestions.map((s, i) => (
                <button
                  key={s.code}
                  onClick={() => selectSuggestion(s)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-700 transition-colors ${
                    highlightedIdx === i ? 'bg-slate-700' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold ${
                      s.exchange === 'SH' ? 'text-blue-400' :
                      s.exchange === 'BJ' ? 'text-orange-400' : 'text-green-400'
                    }`}>
                      {s.name}
                    </span>
                    <span className="text-xs text-slate-500">{s.code.split('.')[0]}</span>
                    {s.pinyin && (
                      <span className="text-xs text-slate-600">{s.pinyin.toUpperCase()}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{s.market}</span>
                    {s.type && s.type !== '股票' && (
                      <span className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">{s.type}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Quick Add Stocks */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-400 mr-1">常用股票:</span>
          {QUICK_STOCKS.map(stock => (
            <button
              key={stock.code}
              onClick={() => handleQuickAdd(stock.code, stock.name)}
              className="px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 rounded transition-colors"
            >
              {stock.name} {stock.code.replace('.SZ', '').replace('.SH', '')}
            </button>
          ))}
        </div>

        {/* Quick Add Indices */}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="text-sm text-slate-400 mr-1">指数:</span>
          {QUICK_INDICES.map(idx => (
            <button
              key={idx.code}
              onClick={() => {
                // 指数代码转换：sh->.SH, sz->.SZ
                const idxCode = idx.code.startsWith('sh')
                  ? idx.code.replace('sh', '') + '.SH'
                  : idx.code.startsWith('sz')
                    ? idx.code.replace('sz', '') + '.SZ'
                    : idx.code;
                addStock(idxCode, idx.name);
              }}
              className="px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 rounded transition-colors"
            >
              {idx.name}
            </button>
          ))}
        </div>
      </div>

      {/* Update Status */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span>更新中...</span>
        </div>
      )}
      {isStale && (
        <div className="flex items-center gap-2 px-3 py-2 bg-yellow-900/30 border border-yellow-700 rounded-lg text-sm text-yellow-300">
          <span>⚠️</span>
          <span>数据延迟，请检查网络连接</span>
        </div>
      )}
      {lastFetch && !loading && !isStale && (
        <div className="text-xs text-slate-500">
          最后更新: {lastFetch.toLocaleTimeString()}
          {watchlistData.size > 0 && ` · ${watchlistData.size}只股票`}
        </div>
      )}

      {/* Watchlist Table */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
        {watchlistData.size === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <div className="text-4xl mb-2">📊</div>
            <div>添加股票到监控列表，开始实时盯盘</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="bg-slate-800 border-b border-slate-700 text-sm text-slate-300">
                  <th className="text-left py-3 px-4 font-medium">股票名称</th>
                  <th className="text-left py-3 px-4 font-medium">代码</th>
                  <th className="text-right py-3 px-4 font-medium">现价</th>
                  <th className="text-right py-3 px-4 font-medium">涨跌幅</th>
                  <th className="text-center py-3 px-4 font-medium">MACD</th>
                  <th className="text-center py-3 px-4 font-medium">KDJ</th>
                  <th className="text-center py-3 px-4 font-medium">布林带</th>
                  <th className="text-center py-3 px-4 font-medium">均线</th>
                  <th className="text-center py-3 px-4 font-medium">异动</th>
                  <th className="text-center py-3 px-4 font-medium">信号</th>
                  <th className="text-center py-3 px-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(watchlistData.values()).map(stock => {
                  const isUp = stock.change >= 0;
                  const isSelected = selectedStock === stock.code;
                  
                  return (
                    <tr
                      key={stock.code}
                      onClick={() => setSelectedStock(isSelected ? null : stock.code)}
                      className={`border-b border-slate-700 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-900/30 border-l-4 border-l-blue-500'
                          : 'hover:bg-slate-700/50'
                      }`}
                    >
                      {/* Name */}
                      <td className="py-3 px-4">
                        <div className={`font-medium ${isUp ? 'text-red-400' : 'text-green-400'}`}>
                          {stock.name}
                        </div>
                      </td>

                      {/* Code */}
                      <td className="py-3 px-4 text-sm text-slate-400 font-mono">
                        {stock.code.replace('.SH', '').replace('.SZ', '').replace('.BJ', '')}
                      </td>

                      {/* Price */}
                      <td className="py-3 px-4 text-right">
                        <span className={`text-lg font-bold ${isUp ? 'text-red-400' : 'text-green-400'}`}>
                          {stock.price > 0 ? stock.price.toFixed(2) : '-'}
                        </span>
                      </td>

                      {/* Change Percent */}
                      <td className="py-3 px-4 text-right">
                        <span className={`inline-flex items-center px-2 py-1 rounded text-sm font-medium ${
                          isUp
                            ? 'bg-red-900/50 text-red-300'
                            : 'bg-green-900/50 text-green-300'
                        }`}>
                          {isUp ? '+' : ''}{stock.changePercent.toFixed(2)}%
                        </span>
                      </td>

                      {/* MACD */}
                      <td className="py-3 px-4 text-center">
                        <MacdBadge signal={stock.indicators.macd.signal} />
                      </td>

                      {/* KDJ */}
                      <td className="py-3 px-4 text-center">
                        <KdjBadge signal={stock.indicators.kdj.signal} />
                      </td>

                      {/* Bollinger */}
                      <td className="py-3 px-4 text-center">
                        <BollingerBadge position={stock.indicators.bollinger.position} />
                      </td>

                      {/* MA */}
                      <td className="py-3 px-4 text-center">
                        <MaBadge position={stock.indicators.ma.position} />
                      </td>

                      {/* 异动标记 */}
                      <td className="py-3 px-4 text-center">
                        {stock.changePercent >= 9.9 && stock.changePercent <= 10.1 && (
                          <span className="inline-flex items-center gap-1 bg-red-900/50 text-red-300 text-xs px-2 py-1 rounded font-bold" title="涨停">
                            🔺 涨停
                          </span>
                        )}
                        {stock.changePercent <= -9.9 && stock.changePercent >= -10.1 && (
                          <span className="inline-flex items-center gap-1 bg-green-900/50 text-green-300 text-xs px-2 py-1 rounded font-bold" title="跌停">
                            🔻 跌停
                          </span>
                        )}
                        {stock.changePercent > 5 && stock.changePercent < 9.9 && (
                          <span className="inline-flex items-center gap-1 bg-yellow-900/50 text-yellow-300 text-xs px-2 py-1 rounded" title="快速上涨">
                            ⚡ {stock.changePercent.toFixed(1)}%
                          </span>
                        )}
                        {stock.changePercent < -5 && stock.changePercent > -9.9 && (
                          <span className="inline-flex items-center gap-1 bg-yellow-900/50 text-yellow-300 text-xs px-2 py-1 rounded" title="快速下跌">
                            ⚡ {stock.changePercent.toFixed(1)}%
                          </span>
                        )}
                      </td>

                      {/* Signal */}
                      <td className="py-3 px-4 text-center">
                        <SignalBadge direction={stock.signal.direction} strength={stock.signal.strength} />
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-2 text-center">
                        <div className="flex flex-col items-center gap-1">
                          {/* 建议仓位提示 */}
                          {(() => {
                            const score = Math.round(stock.signal.strength * 100) || 50;
                            const pct = getPositionLimit(score);
                            const shares = pct > 0 && stock.price > 0 ? Math.floor(accountBalance * pct / stock.price / 100) * 100 : 0;
                            if (pct === 0) return null;
                            return (
                              <span className="text-xs text-slate-500 whitespace-nowrap">
                                建议{shares}股
                              </span>
                            );
                          })()}
                          {/* 操作按钮组 */}
                          <div className="flex gap-1 justify-center">
                            {stock.signal.direction !== 'short' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleQuickBuy(stock); }}
                                disabled={submittingCode === stock.code}
                                className="px-2 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
                              >
                                {submittingCode === stock.code ? '...' : '买入'}
                              </button>
                            )}
                            {stock.signal.direction !== 'long' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleQuickSell(stock); }}
                                disabled={submittingCode === stock.code}
                                className="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
                              >
                                {submittingCode === stock.code ? '...' : '卖出'}
                              </button>
                            )}
                            <button
                              onClick={(e) => removeStock(stock.code, e)}
                              className="px-1.5 py-1 text-xs text-slate-400 hover:text-red-400 hover:bg-red-900/30 rounded transition-colors"
                              title="移除自选"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Panel */}
      {selectedStockData && (
        <DetailPanel
          stock={selectedStockData}
          onAddToScreener={() => {
            // In a real app, this would add to screener
            console.log('Add to screener:', selectedStockData.code);
          }}
        />
      )}
    </div>
  );
}
