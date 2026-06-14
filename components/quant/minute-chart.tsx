'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';

interface MinuteChartProps {
  code: string;
  name: string;
}

interface MinutePoint {
  time: string;
  price: number;
  vol: number;
}

interface MinuteResponse {
  code: string;
  name: string;
  yestclose: number;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  time: string;
  data: MinutePoint[];
  isHistory: boolean;
}

export default function MinuteChart({ code, name }: MinuteChartProps) {
  const chartRef = useRef<ReactECharts>(null);
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState<MinuteResponse | null>(null);
  const [points, setPoints] = useState<MinutePoint[]>([]);
  const [isHistory, setIsHistory] = useState(false);

  const fetchMinuteData = useCallback(async (isInitial: boolean) => {
    try {
      const url = `/api/stock/minute-data?codes=${code}&reset=${isInitial ? 1 : 0}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success || !json.data || json.data.length === 0) return;

      const item: MinuteResponse = json.data[0];
      setQuote(item);
      setIsHistory(!!item.isHistory);

      if (item.data && item.data.length > 0) {
        setPoints(prev => {
          if (isInitial || prev.length === 0) return item.data;

          // 增量追加：只添加新的点（时间更大）
          const lastTime = prev[prev.length - 1]?.time;
          if (lastTime && item.data.length > 0) {
            const lastNewTime = item.data[item.data.length - 1].time;
            if (lastNewTime > lastTime) {
              // 找新增的点
              const newPoints = item.data.filter(p => p.time > lastTime);
              if (newPoints.length > 0) {
                const merged = [...prev, ...newPoints];
                // 限制最多保留500点
                return merged.slice(-500);
              }
            }
          }
          return item.data;
        });
      }
    } catch (err) {
      console.error('[MinuteChart] fetch error:', err);
    }
  }, [code]);

  // 初始加载
  useEffect(() => {
    setLoading(true);
    fetchMinuteData(true).finally(() => setLoading(false));
  }, [fetchMinuteData]);

  // 轮询：交易时段每15秒刷新，非交易时段每60秒
  useEffect(() => {
    const interval = isHistory ? 60_000 : 15_000;
    const timer = setInterval(() => fetchMinuteData(false), interval);
    return () => clearInterval(timer);
  }, [fetchMinuteData, isHistory]);

  // 构建 ECharts 配置
  const buildOption = useCallback((): EChartsOption => {
    if (points.length === 0) return {};

    const times = points.map(p => p.time);
    const prices = points.map(p => p.price);
    const vols = points.map(p => p.vol);
    const yestclose = quote?.yestclose ?? prices[0];

    // 颜色：价格在昨收线上方红色，下方绿色
    const lineColor = (quote?.change ?? 0) >= 0 ? '#ef4444' : '#10b981';
    const areaColor = lineColor;

    // 价格范围（给上下5%留白）
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice || yestclose * 0.02;
    const yMin = Math.max(0, minPrice - priceRange * 0.2);
    const yMax = maxPrice + priceRange * 0.2;

    // 成交量柱状图颜色
    const volColors = points.map((p, i) => {
      if (i === 0) return lineColor;
      return p.price >= prices[i - 1] ? '#ef4444' : '#10b981';
    });

    const gridHeight = '52%';
    const volTop = '68%';
    const volHeight = '12%';

    return {
      backgroundColor: '#1a1a2e',
      textStyle: { color: '#9ca3af', fontSize: 11 },
      legend: { show: false },
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'line',
          lineStyle: { color: '#4a5568', width: 1, type: 'dashed' },
        },
        backgroundColor: 'rgba(17,17,26,0.95)',
        borderColor: '#374151',
        textStyle: { color: '#d1d5db', fontSize: 12 },
        formatter: (params: any) => {
          const p = params[0];
          const idx = p.dataIndex;
          const pt = points[idx];
          if (!pt) return '';
          const changeAmt = quote?.change ?? 0;
          const changePct = quote?.changePercent ?? 0;
          const color = changeAmt >= 0 ? '#ef4444' : '#10b981';
          const arrow = changeAmt >= 0 ? '▲' : '▼';
          return `<div style="font-size:12px;line-height:1.8">
            <div style="color:#9ca3af">${pt.time}</div>
            <div>价格: <span style="color:#fff;font-weight:bold">${pt.price.toFixed(2)}</span></div>
            <div>涨跌: <span style="color:${color}">${arrow} ${Math.abs(changeAmt).toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)</span></div>
            <div>昨收: <span style="color:#fff">${yestclose.toFixed(2)}</span></div>
          </div>`;
        },
      },
      axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
      xAxis: [
        {
          type: 'category',
          data: times,
          gridIndex: 0,
          boundaryGap: false,
          axisLine: { lineStyle: { color: '#374151' } },
          axisTick: { show: false },
          axisLabel: {
            color: '#6b7280',
            fontSize: 10,
            formatter: (val: string) => val,
          },
          splitLine: { show: false },
          min: 'dataMin',
          max: 'dataMax',
        },
        {
          type: 'category',
          data: times,
          gridIndex: 1,
          boundaryGap: false,
          axisLine: { lineStyle: { color: '#374151' } },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
          min: 'dataMin',
          max: 'dataMax',
        },
      ],
      yAxis: [
        {
          scale: true,
          gridIndex: 0,
          min: yMin,
          max: yMax,
          splitArea: { show: true, areaStyle: { color: ['#1a1a2e', '#1e1e32'] } },
          axisLine: { lineStyle: { color: '#374151' } },
          axisTick: { show: false },
          axisLabel: {
            color: '#6b7280',
            fontSize: 10,
            formatter: (v: number) => v.toFixed(2),
          },
          splitLine: { lineStyle: { color: '#2d2d3d', type: 'dashed' } },
        },
        {
          scale: true,
          gridIndex: 1,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
        },
      ],
      grid: [
        { left: 60, right: 60, top: 16, height: gridHeight },
        { left: 60, right: 60, top: volTop, height: volHeight },
      ],
      series: [
        {
          name: '分时',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: prices,
          smooth: false,
          symbol: 'none',
          lineStyle: { width: 1.5, color: lineColor },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: areaColor + '55' },
                { offset: 1, color: areaColor + '00' },
              ],
            },
          },
          markLine: {
            silent: true,
            symbol: ['none', 'none'],
            data: [
              {
                yAxis: yestclose,
                lineStyle: { color: '#f59e0b', type: 'dashed', width: 1 },
                label: {
                  show: true,
                  position: 'end',
                  formatter: `昨收 ${yestclose.toFixed(2)}`,
                  color: '#f59e0b',
                  fontSize: 10,
                },
              },
            ],
          },
        },
        {
          name: '成交量',
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: vols.map((v, i) => ({ value: v, itemStyle: { color: volColors[i] } })),
          barMaxWidth: 4,
        },
      ],
    };
  }, [points, quote, isHistory]);

  // 价格信息头
  const priceDisplay = quote?.price ?? 0;
  const changeAmt = quote?.change ?? 0;
  const changePct = quote?.changePercent ?? 0;
  const isUp = changeAmt >= 0;
  const priceColor = isUp ? '#ef4444' : '#10b981';
  const arrow = isUp ? '▲' : '▼';

  return (
    <div className="flex flex-col h-full">
      {/* 价格头部 */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-[#2d2d3d] shrink-0">
        <div>
          <span className="text-2xl font-bold" style={{ color: priceColor }}>
            {priceDisplay > 0 ? priceDisplay.toFixed(2) : '--'}
          </span>
          <span className="ml-2 text-sm" style={{ color: priceColor }}>
            {arrow} {Math.abs(changeAmt).toFixed(2)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
          </span>
        </div>
        <div className="flex gap-4 text-xs text-gray-400">
          <span>开 {quote?.open?.toFixed(2) ?? '--'}</span>
          <span>高 <span style={{ color: '#ef4444' }}>{quote?.high?.toFixed(2) ?? '--'}</span></span>
          <span>低 <span style={{ color: '#10b981' }}>{quote?.low?.toFixed(2) ?? '--'}</span></span>
          <span>昨 {quote?.yestclose?.toFixed(2) ?? '--'}</span>
        </div>
        {isHistory && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
            上一交易日
          </span>
        )}
        <span className="text-xs text-gray-500 ml-auto">更新: {quote?.time ?? '--:--'}</span>
      </div>

      {/* 图表 */}
      <div className="flex-1 min-h-0">
        {loading && points.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            加载分时数据...
          </div>
        ) : points.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            暂无分时数据
          </div>
        ) : (
          <ReactECharts
            ref={chartRef}
            option={buildOption()}
            notMerge={false}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        )}
      </div>
    </div>
  );
}
