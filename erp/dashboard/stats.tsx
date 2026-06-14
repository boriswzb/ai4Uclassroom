'use client'

import styles from './stats.module.css'

interface Stat {
  value: number
  change: number
  trend: 'up' | 'down' | 'neutral'
}

interface StatsProps {
  stats: {
    monthlyRevenue: Stat
    newOrders: Stat
    inventoryAlerts: Stat
    pendingInvoices: Stat
    receivables: Stat
    payables: Stat
  }
}

function formatCurrency(value: number): string {
  if (value >= 100000000) return `¥${(value / 100000000).toFixed(1)}亿`
  if (value >= 10000) return `¥${(value / 10000).toFixed(0)}万`
  return `¥${value.toLocaleString()}`
}

function formatNumber(value: number): string {
  return value.toLocaleString()
}

function TrendArrow({ trend }: { trend: string }) {
  if (trend === 'up') return <span>↑</span>
  if (trend === 'down') return <span>↓</span>
  return <span>→</span>
}

export function DashboardStats({ stats }: StatsProps) {
  const cards = [
    { key: 'monthlyRevenue', label: '本月营收', value: formatCurrency(stats.monthlyRevenue.value), change: stats.monthlyRevenue.change, trend: stats.monthlyRevenue.trend, color: 'revenue' },
    { key: 'newOrders', label: '新增订单', value: formatNumber(stats.newOrders.value), change: stats.newOrders.change, trend: stats.newOrders.trend, color: 'orders' },
    { key: 'inventoryAlerts', label: '库存预警', value: formatNumber(stats.inventoryAlerts.value), change: stats.inventoryAlerts.change, trend: stats.inventoryAlerts.trend, color: 'alerts' },
    { key: 'pendingInvoices', label: '待收款发票', value: formatNumber(stats.pendingInvoices.value), change: stats.pendingInvoices.change, trend: stats.pendingInvoices.trend, color: 'invoices' },
    { key: 'receivables', label: '应收账款', value: formatCurrency(stats.receivables.value), change: stats.receivables.change, trend: stats.receivables.trend, color: 'receivables' },
    { key: 'payables', label: '应付账款', value: formatCurrency(stats.payables.value), change: stats.payables.change, trend: stats.payables.trend, color: 'payables' },
  ]

  return (
    <div className={styles.statsGrid}>
      {cards.map(card => (
        <div key={card.key} className={styles.statCard} data-color={card.color}>
          <div className={styles.statLabel}>{card.label}</div>
          <div className={styles.statValue}>{card.value}</div>
          <div className={`${styles.statChange} ${styles[card.trend]}`}>
            <TrendArrow trend={card.trend} />
            <span>{card.change > 0 ? '+' : ''}{card.change}%</span>
            <span className={styles.vsText}>vs上月</span>
          </div>
        </div>
      ))}
    </div>
  )
}
