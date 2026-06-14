'use client'

// 销售趋势图（使用 Recharts）
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Bar
} from 'recharts'
import styles from './sales-chart.module.css'

interface SalesData {
  month: string
  revenue: number
  orders: number
}

interface Props {
  data: SalesData[]
}

function formatYAxis(value: number): string {
  if (value >= 1000000) return `¥${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `¥${(value / 1000).toFixed(0)}K`
  return `¥${value}`
}

interface PayloadEntry {
  name?: string
  value?: number | string
  color?: string
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: PayloadEntry[]; label?: string }) => {
  if (!active || !payload?.length) return null
  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipLabel}>{label}</p>
      {payload.map((entry, i: number) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: ¥{Number(entry.value).toLocaleString()}
        </p>
      ))}
    </div>
  )
}

export function SalesChart({ data }: Props) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>营收趋势</h3>
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: '#34d399' }} />
            营收
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: '#60a5fa' }} />
            订单数
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#34d399" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="month"
            tick={{ fill: '#64748b', fontSize: 12 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            tickLine={false}
          />
          <YAxis
            yAxisId="left"
            tickFormatter={formatYAxis}
            tick={{ fill: '#64748b', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fill: '#64748b', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="revenue"
            stroke="#34d399"
            strokeWidth={2}
            fill="url(#colorRevenue)"
            name="营收"
          />
          <Bar
            yAxisId="right"
            dataKey="orders"
            fill="#60a5fa"
            opacity={0.6}
            radius={[4, 4, 0, 0]}
            name="订单数"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
