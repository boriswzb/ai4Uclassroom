'use client'

import { useState } from 'react'
import styles from './cockpit.module.css'

interface KPI {
  label: string
  value: string
  change: string
  positive: boolean
  icon: string
}

interface ChartData {
  label: string
  value: number
  color: string
}

const kpis: KPI[] = [
  { label: '本月销售收入', value: '¥569,474', change: '+12.3%', positive: true, icon: '💰' },
  { label: '本月销售订单', value: '10 笔', change: '+2 笔', positive: true, icon: '📋' },
  { label: '应收账款', value: '¥269,528', change: '-8.5%', positive: false, icon: '📜' },
  { label: '库存商品', value: '¥892,000', change: '+3.2%', positive: true, icon: '🏭' },
  { label: '本月毛利润', value: '¥200,624', change: '+15.7%', positive: true, icon: '📈' },
  { label: '采购支出', value: '¥188,100', change: '+5.1%', positive: false, icon: '📦' },
]

const salesByCategory: ChartData[] = [
  { label: '电子设备', value: 42, color: '#2563eb' },
  { label: '网络设备', value: 28, color: '#7c3aed' },
  { label: '办公家具', value: 18, color: '#0891b2' },
  { label: '软件服务', value: 12, color: '#15803d' },
]

const monthlyTrend: ChartData[] = [
  { label: '1月', value: 38, color: '#2563eb' },
  { label: '2月', value: 52, color: '#2563eb' },
  { label: '3月', value: 47, color: '#2563eb' },
  { label: '4月', value: 61, color: '#2563eb' },
  { label: '5月', value: 55, color: '#2563eb' },
  { label: '6月', value: 68, color: '#2563eb' },
]

const recentOrders = [
  { no: 'SO-2025-000010', customer: '杭州云智科技', amount: 114921, status: '已确认', date: '03-12' },
  { no: 'SO-2025-000009', customer: '上海星火电子', amount: 30510, status: '草稿', date: '03-10' },
  { no: 'SO-2025-000008', customer: '北京华联集团', amount: 63533, status: '已收货', date: '03-08' },
  { no: 'SO-2025-000007', customer: '广州中商贸易', amount: 50850, status: '已确认', date: '03-05' },
  { no: 'SO-2025-000006', customer: '深圳腾达科技', amount: 83580, status: '已发货', date: '03-01' },
]

const topProducts = [
  { name: '商务笔记本 ThinkPad L15', sales: 20, amount: 110000 },
  { name: '企业路由器 R3000', sales: 30, amount: 48000 },
  { name: 'POE交换机 24口', sales: 15, amount: 33000 },
  { name: 'ThinkVision 显示器', sales: 10, amount: 35000 },
  { name: '服务器 Rancher R640', sales: 3, amount: 84000 },
]

export default function CockpitPage() {
  const [selectedPeriod, setSelectedPeriod] = useState('month')

  return (
    <div className={styles.container}>
      <div className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <h1 className={styles.title}>管理驾驶舱</h1>
          <span className={styles.subtitle}>数据概览 · 2025年3月</span>
        </div>
        <div className={styles.periodTabs}>
          {['week', 'month', 'quarter', 'year'].map(p => (
            <button key={p} className={`${styles.periodTab} ${selectedPeriod === p ? styles.active : ''}`} onClick={() => setSelectedPeriod(p)}>
              {p === 'week' ? '本周' : p === 'month' ? '本月' : p === 'quarter' ? '本季' : '本年'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className={styles.kpiGrid}>
        {kpis.map((kpi, i) => (
          <div key={i} className={styles.kpiCard}>
            <div className={styles.kpiTop}>
              <span className={styles.kpiIcon}>{kpi.icon}</span>
              <span className={`${styles.kpiChange} ${kpi.positive ? styles.positive : styles.negative}`}>
                {kpi.positive ? '↑' : '↓'} {kpi.change}
              </span>
            </div>
            <div className={styles.kpiValue}>{kpi.value}</div>
            <div className={styles.kpiLabel}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className={styles.chartsRow}>
        {/* Monthly Trend Bar */}
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>月度销售趋势（万元）</h3>
          <div className={styles.barChart}>
            {monthlyTrend.map((item, i) => (
              <div key={i} className={styles.barItem}>
                <div className={styles.barWrapper}>
                  <div className={styles.bar} style={{ height: `${item.value}%` }} />
                </div>
                <span className={styles.barLabel}>{item.label}</span>
                <span className={styles.barValue}>{item.value}万</span>
              </div>
            ))}
          </div>
        </div>

        {/* Category Pie */}
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>销售品类占比</h3>
          <div className={styles.pieChart}>
            <div className={styles.pieCircle}>
              <div className={styles.pieCenter}>
                <span className={styles.pieCenterValue}>¥569K</span>
                <span className={styles.pieCenterLabel}>本月销售</span>
              </div>
            </div>
            <div className={styles.pieLegend}>
              {salesByCategory.map((item, i) => (
                <div key={i} className={styles.legendItem}>
                  <span className={styles.legendDot} style={{ background: item.color }} />
                  <span className={styles.legendLabel}>{item.label}</span>
                  <span className={styles.legendValue}>{item.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Status Distribution */}
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>订单状态分布</h3>
          <div className={styles.statusList}>
            {[
              { label: '已收货', count: 3, color: '#15803d', pct: 30 },
              { label: '已确认', count: 3, color: '#2563eb', pct: 30 },
              { label: '已发货', count: 2, color: '#c2410c', pct: 20 },
              { label: '草稿', count: 2, color: '#64748b', pct: 20 },
            ].map((s, i) => (
              <div key={i} className={styles.statusItem}>
                <div className={styles.statusLeft}>
                  <span className={styles.statusDot} style={{ background: s.color }} />
                  <span className={styles.statusLabel}>{s.label}</span>
                  <span className={styles.statusCount}>{s.count}笔</span>
                </div>
                <div className={styles.statusBar}>
                  <div className={styles.statusBarFill} style={{ width: `${s.pct}%`, background: s.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className={styles.bottomRow}>
        {/* Recent Orders */}
        <div className={styles.tableCard}>
          <h3 className={styles.chartTitle}>最近订单</h3>
          <table className={styles.miniTable}>
            <thead>
              <tr><th>订单号</th><th>客户</th><th>金额</th><th>状态</th><th>日期</th></tr>
            </thead>
            <tbody>
              {recentOrders.map((o, i) => (
                <tr key={i}>
                  <td className={styles.orderNo}>{o.no}</td>
                  <td>{o.customer}</td>
                  <td className={styles.amount}>¥{o.amount.toLocaleString()}</td>
                  <td><span className={styles.statusBadge} data-status={o.status}>{o.status}</span></td>
                  <td>{o.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Top Products */}
        <div className={styles.tableCard}>
          <h3 className={styles.chartTitle}>热销产品 TOP 5</h3>
          <table className={styles.miniTable}>
            <thead>
              <tr><th>#</th><th>产品</th><th>销量</th><th>销售额</th></tr>
            </thead>
            <tbody>
              {topProducts.map((p, i) => (
                <tr key={i}>
                  <td className={styles.rank}>{i + 1}</td>
                  <td className={styles.productName}>{p.name}</td>
                  <td>{p.sales}</td>
                  <td className={styles.amount}>¥{p.amount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Alerts */}
        <div className={styles.alertCard}>
          <h3 className={styles.chartTitle}>待办提醒</h3>
          <div className={styles.alerts}>
            {[
              { icon: '⚠️', text: '3笔订单已逾期未收款', level: 'danger' },
              { icon: '📦', text: '5个产品库存低于安全线', level: 'warning' },
              { icon: '📋', text: '8笔采购订单待确认', level: 'info' },
              { icon: '💰', text: '本月还有 ¥89,528 应收未收', level: 'warning' },
              { icon: '🔔', text: '3笔销售订单待发货', level: 'info' },
            ].map((alert, i) => (
              <div key={i} className={`${styles.alertItem} ${styles[alert.level]}`}>
                <span>{alert.icon}</span>
                <span>{alert.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
