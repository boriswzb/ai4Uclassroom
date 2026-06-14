'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import MinuteChart from './minute-chart';
import StockDetailPanel from './stock-detail-panel';

type KLineType = 'day' | 'week' | 'month' | '1' | '5' | '15' | '30' | '60';
type ViewMode = 'kline' | 'minute';

interface StockChartProps {
  code: string;
  name: string;
  onClose?: () => void;
}

interface QuoteData {
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

export default function StockChart({ code, name, onClose }: StockChartProps) {
  const chartRef = useRef<ReactECharts>(null);
  const [kLineType, setKLineType] = useState<KLineType>('day');
  const [viewMode, setViewMode] = useState<ViewMode>('minute'); // 默认显示分时
  const [loading, setLoading] = useState(false);
  const [rawData, setRawData] = useState<QuoteData[]>([]);
  const [showMA5, setShowMA5] = useState(true);
  const [showMA10, setShowMA10] = useState(true);
  const [showMA20, setShowMA20] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // P1-增强：右侧详情面板（公司/新闻/异动）开关
  // 默认开启（用户点击股票名时就是想看详细信息），用户可手动关闭
  const [showInfo, setShowInfo] = useState(true);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  const handleClose = useCallback(() => {
    if (isFullscreen) {
      setIsFullscreen(false);
    } else {
      onClose?.();
    }
  }, [isFullscreen, onClose]);

  const fetchData = useCallback(async (period: KLineType) => {
    setLoading(true);
    try {
      // period: day=日K, week=周K, month=月K, 1/5/15/30/60=分钟K
      const apiPeriod = period === 'day' ? 'day' : period === 'week' ? 'week' : period === 'month' ? 'month' : period;
      const response = await fetch(`/api/stock/kline?code=${code}&period=${apiPeriod}&count=200`);
      const json = await response.json();

      if (!json.success || !json.data || json.data.length === 0) {
        console.warn('[StockChart] K线数据为空:', json);
        return;
      }

      const data: QuoteData[] = json.data.map((b: any) => ({
        date: new Date(b.timestamp).toISOString().slice(0, 10),
        open: b.open,
        close: b.close,
        high: b.high,
        low: b.low,
        volume: b.volume,
      }));

      setRawData(data);
    } catch (err) {
      console.error('[StockChart] 获取K线失败:', err);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    fetchData(kLineType);
  }, [fetchData, kLineType]);

  const buildOption = useCallback((): EChartsOption => {
    if (rawData.length === 0) return {};

    const dates = rawData.map(d => d.date);
    const closes = rawData.map(d => d.close);
    const volumes = rawData.map(d => d.volume);

    const ma5Data = calcMA(closes, 5);
    const ma10Data = calcMA(closes, 10);
    const ma20Data = calcMA(closes, 20);

    const volColors = rawData.map(d => d.close >= d.open ? '#ef4444' : '#10b981');

    const series: any[] = [
      {
        name: 'K线',
        type: 'candlestick',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: rawData.map(d => [d.open, d.close, d.low, d.high]),
        itemStyle: {
          color: '#ef4444',
          color0: '#10b981',
          borderColor: '#ef4444',
          borderColor0: '#10b981',
        },
      },
      {
        name: 'MA5', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
        data: ma5Data, smooth: false,
        lineStyle: { width: 1, color: '#f59e0b' },
        symbol: 'none', tooltip: { show: true },
        visible: showMA5,
      },
      {
        name: 'MA10', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
        data: ma10Data, smooth: false,
        lineStyle: { width: 1, color: '#3b82f6' },
        symbol: 'none', tooltip: { show: true },
        visible: showMA10,
      },
      {
        name: 'MA20', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
        data: ma20Data, smooth: false,
        lineStyle: { width: 1, color: '#a855f7' },
        symbol: 'none', tooltip: { show: true },
        visible: showMA20,
      },
      {
        name: '成交量',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumes.map((v, i) => ({ value: v, itemStyle: { color: volColors[i] } })),
        visible: showVolume,
      },
    ];

    return {
      backgroundColor: '#1a1a2e',
      textStyle: { color: '#9ca3af', fontSize: 11 },
      legend: { show: false },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', crossStyle: { color: '#6b7280' } },
        backgroundColor: 'rgba(17,17,26,0.95)',
        borderColor: '#374151',
        textStyle: { color: '#d1d5db', fontSize: 12 },
        formatter: (params: any) => {
          const p = params[0];
          const idx = p.dataIndex;
          const d = rawData[idx];
          if (!d) return '';
          const color = d.close >= d.open
            ? '<span style="color:#ef4444">▲</span>'
            : '<span style="color:#10b981">▼</span>';
          return '<div style="font-size:12px;line-height:1.8"><div style="color:#d1d5db;font-weight:bold">' +
            d.date + '</div><div>开: <span style="color:#fff">' + d.open + '</span> &nbsp; 收: <span style="color:#fff">' + d.close + '</span></div><div>高: <span style="color:#ef4444">' + d.high + '</span> &nbsp; 低: <span style="color:#10b981">' + d.low + '</span></div><div>成交量: <span style="color:#fff">' + (d.volume / 10000).toFixed(0) + '万手</span></div></div>';
        },
      },
      axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
      xAxis: [
        {
          type: 'category', data: dates, gridIndex: 0,
          boundaryGap: false, axisLine: { lineStyle: { color: '#374151' } },
          axisTick: { show: false }, axisLabel: { color: '#6b7280', fontSize: 10 },
          splitLine: { show: true, lineStyle: { color: '#2d2d3d', type: 'dashed' } },
        },
        {
          type: 'category', data: dates, gridIndex: 1,
          boundaryGap: false, axisLine: { lineStyle: { color: '#374151' } },
          axisTick: { show: false }, axisLabel: { show: false },
          splitLine: { show: false },
        },
      ],
      yAxis: [
        {
          scale: true, gridIndex: 0,
          splitArea: { show: true, areaStyle: { color: ['#1a1a2e', '#1e1e32'] } },
          axisLine: { lineStyle: { color: '#374151' } },
          axisTick: { show: false },
          axisLabel: { color: '#6b7280', fontSize: 10, formatter: (v: number) => v.toFixed(2) },
          splitLine: { lineStyle: { color: '#2d2d3d', type: 'dashed' } },
        },
        {
          scale: true, gridIndex: 1,
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { show: false }, splitLine: { show: false },
        },
      ],
      grid: [
        { left: 60, right: 60, top: 20, height: '55%' },
        { left: 60, right: 60, top: '75%', height: '15%' },
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], start: 60, end: 100 },
        {
          type: 'slider', xAxisIndex: [0, 1], bottom: 4, height: 18,
          backgroundColor: '#1a1a2e', borderColor: '#374151',
          fillerColor: 'rgba(59,130,246,0.15)', handleStyle: { color: '#3b82f6' },
          textStyle: { color: '#6b7280', fontSize: 10 }, start: 60, end: 100,
        },
      ],
      series,
    };
  }, [rawData, showMA5, showMA10, showMA20, showVolume]);

  // 响应式：宽屏（>1024px）展示右侧详情面板 → 加宽到 1280px
  // 窄屏保持 960px，详情面板在图表下方
  const chartContainerClass = isFullscreen
    ? 'fixed inset-0 z-50 flex items-center justify-center'
    : 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60';
  const chartBoxClass = isFullscreen
    ? 'bg-[#1a1a2e] w-full h-full overflow-hidden shadow-2xl flex flex-col'
    : showInfo
      ? 'bg-[#1a1a2e] rounded-lg w-full max-w-[1280px] h-[85vh] max-h-[90vh] overflow-hidden shadow-2xl flex flex-col'
      : 'bg-[#1a1a2e] rounded-lg w-[960px] h-[85vh] max-h-[90vh] overflow-hidden shadow-2xl flex flex-col';

  return (
    <div className={chartContainerClass} onClick={isFullscreen ? undefined : handleClose}>
      <div className={chartBoxClass} onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className={`flex items-center justify-between px-6 py-4 border-b border-[#2d2d3d] shrink-0 ${isFullscreen ? 'bg-[#1a1a2e]/60 backdrop-blur-sm' : ''}`}>
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">{name}</h2>
              <span className="text-sm text-gray-400">{code}</span>
            </div>
            <div className="flex gap-1 ml-4">
              <button
                onClick={() => setViewMode('minute')}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  viewMode === 'minute'
                    ? 'bg-blue-600 text-white'
                    : 'bg-[#2d2d3d] text-gray-400 hover:text-white'
                }`}
              >
                分时
              </button>
              {([
                { type: '1' as KLineType, label: '1分' },
                { type: '5' as KLineType, label: '5分' },
                { type: '15' as KLineType, label: '15分' },
                { type: '30' as KLineType, label: '30分' },
                { type: '60' as KLineType, label: '60分' },
                { type: 'day' as KLineType, label: '日K' },
                { type: 'week' as KLineType, label: '周K' },
                { type: 'month' as KLineType, label: '月K' },
              ]).map(({ type, label }) => (
                <button
                  key={type}
                  onClick={() => { setKLineType(type); setViewMode('kline'); }}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    viewMode === 'kline' && kLineType === type
                      ? 'bg-blue-600 text-white'
                      : 'bg-[#2d2d3d] text-gray-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-3 text-xs">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showMA5}
                  onChange={e => setShowMA5(e.target.checked)}
                  className="accent-amber-500 w-3 h-3"
                />
                <span style={{ color: '#f59e0b' }}>MA5</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showMA10}
                  onChange={e => setShowMA10(e.target.checked)}
                  className="accent-blue-500 w-3 h-3"
                />
                <span style={{ color: '#3b82f6' }}>MA10</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showMA20}
                  onChange={e => setShowMA20(e.target.checked)}
                  className="accent-purple-500 w-3 h-3"
                />
                <span style={{ color: '#a855f7' }}>MA20</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showVolume}
                  onChange={e => setShowVolume(e.target.checked)}
                  className="accent-gray-400 w-3 h-3"
                />
                <span className="text-gray-400">成交量</span>
              </label>
              <button
                onClick={() => setShowInfo(v => !v)}
                className={`ml-2 px-2 py-1 text-xs border rounded transition-colors ${
                  showInfo
                    ? 'text-blue-300 border-blue-500/50 bg-blue-900/20'
                    : 'text-gray-400 border-[#2d2d3d] hover:border-gray-500'
                }`}
                title={showInfo ? '隐藏右侧详情面板' : '显示右侧详情面板（公司/新闻/异动）'}
              >
                {showInfo ? '⮜ 详情' : '⮞ 详情'}
              </button>
              <button
                onClick={toggleFullscreen}
                className="ml-1 px-2 py-1 text-xs text-gray-400 hover:text-white border border-[#2d2d3d] rounded hover:border-gray-500 transition-colors"
                title={isFullscreen ? '退出全屏' : '全屏'}
              >
                {isFullscreen ? '⊡ 退出' : '⊡ 全屏'}
              </button>
            </div>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-[#2d2d3d] transition-colors"
            >
              {isFullscreen ? '⊡' : '✕'}
            </button>
          </div>
        </div>

        {/* 主体区域：图表 + 右侧详情面板（响应式） */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          {/* 图表区域 */}
          <div
            className="relative px-4 pb-4 lg:pb-0 lg:py-0 lg:pl-4 lg:pr-2"
            style={{
              flex: showInfo ? '1 1 60%' : '1 1 100%',
              minHeight: isFullscreen ? 'calc(100vh - 140px)' : 'calc(85vh - 140px)',
              height: isFullscreen ? 'calc(100vh - 140px)' : 'calc(85vh - 140px)',
            }}
          >
            <div className="w-full h-full">
              {viewMode === 'minute' ? (
                <MinuteChart code={code} name={name} />
              ) : (
                <>
                  {(loading || rawData.length === 0) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e]/90 z-10">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-gray-400 text-sm">{loading ? '加载K线数据中...' : '暂无数据'}</span>
                      </div>
                    </div>
                  )}
                  <ReactECharts
                    ref={chartRef}
                    option={buildOption()}
                    style={{ width: '100%', height: '100%' }}
                    opts={{ renderer: 'canvas' }}
                  />
                </>
              )}
            </div>
          </div>

          {/* 右侧详情面板：公司/新闻/异动 */}
          {showInfo && (
            <div
              className="border-t lg:border-t-0 lg:border-l border-[#2d2d3d] shrink-0"
              style={{
                flex: '0 0 40%',
                width: '100%',
                maxWidth: '100%',
                minHeight: isFullscreen ? '0' : '300px',
                height: isFullscreen ? 'auto' : undefined,
              }}
            >
              <div className="h-full" style={{ height: isFullscreen ? 'calc(100vh - 60px)' : 'calc(85vh - 60px)' }}>
                <StockDetailPanel code={code} name={name} />
              </div>
            </div>
          )}
        </div>

        {/* 图例说明 */}
        {viewMode === 'kline' && (
        <div className="flex items-center gap-6 px-6 py-3 border-t border-[#2d2d3d] text-xs text-gray-400 shrink-0">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-[#ef4444]" /> 涨(红)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-[#10b981]" /> 跌(绿)
          </span>
          <span style={{ color: '#f59e0b' }}>MA5 黄色</span>
          <span style={{ color: '#3b82f6' }}>MA10 蓝色</span>
          <span style={{ color: '#a855f7' }}>MA20 紫色</span>
          <span className="text-gray-500 ml-auto">数据来源: 腾讯行情</span>
        </div>
        )}
      </div>
    </div>
  );
}
