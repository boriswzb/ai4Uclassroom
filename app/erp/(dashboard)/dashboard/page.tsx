'use client'

import { useState, useEffect } from 'react'
import { DashboardStats } from '@/erp/dashboard/stats'
import { SalesChart } from '@/erp/dashboard/sales-chart'
import { QuickActions } from '@/erp/dashboard/quick-actions'
import { RecentOrdersWidget } from '@/erp/dashboard/recent-orders'
import { InventoryWidget } from '@/erp/dashboard/inventory-widget'
import { AiAssistantWidget } from '@/erp/dashboard/ai-assistant'
import styles from './dashboard.module.css'

interface DashboardData {
  stats: {
    monthlyRevenue: { value: number; change: number; trend: string }
    newOrders: { value: number; change: number; trend: string }
    inventoryAlerts: { value: number; change: number; trend: string }
    pendingInvoices: { value: number; change: number; trend: string }
    receivables: { value: number; change: number; trend: string }
    payables: { value: number; change: number; trend: string }
  }
  monthlySales: { month: string; revenue: number; orders: number }[]
  recentSales: unknown[]
  recentDeals: unknown[]
}

const mockData: DashboardData = {
  stats: {
    monthlyRevenue: { value: 569000, change: 12.5, trend: 'up' },
    newOrders: { value: 8, change: 8.2, trend: 'up' },
    inventoryAlerts: { value: 3, change: -2, trend: 'down' },
    pendingInvoices: { value: 8, change: 15.3, trend: 'up' },
    receivables: { value: 269528, change: -5.1, trend: 'down' },
    payables: { value: 142300, change: 3.8, trend: 'up' },
  },
  monthlySales: [
    { month: '1月', revenue: 128000, orders: 25 },
    { month: '2月', revenue: 156000, orders: 31 },
    { month: '3月', revenue: 189000, orders: 38 },
    { month: '4月', revenue: 142000, orders: 28 },
    { month: '5月', revenue: 210000, orders: 42 },
    { month: '6月', revenue: 175000, orders: 35 },
  ],
  recentSales: [],
  recentDeals: [],
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)

  useEffect(() => {
    fetch('/api/erp/dashboard')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then(d => setData(d || mockData))
  }, [])

  const stats = data?.stats ?? mockData.stats
  const monthlySales = data?.monthlySales ?? mockData.monthlySales

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>管理驾驶舱</h1>
        <p className={styles.subtitle}>企业经营全景概览</p>
      </div>
      <DashboardStats stats={stats} />
      <div className={styles.grid}>
        <div className={styles.chartSection}>
          <SalesChart data={monthlySales} />
        </div>
        <div className={styles.sideSection}>
          <QuickActions />
          <InventoryWidget />
        </div>
      </div>
      <div className={styles.bottomGrid}>
      <RecentOrdersWidget />
      <AiAssistantWidget />
      </div>
    </div>
  )
}
