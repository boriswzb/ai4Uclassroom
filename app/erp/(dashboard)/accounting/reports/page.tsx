'use client'

import Link from 'next/link'
import styles from './reports.module.css'

const summary = [
  { label: '本月收入', value: '¥569,474', change: '+12.3%', positive: true, icon: '💰' },
  { label: '本月支出', value: '¥388,200', change: '+5.1%', positive: false, icon: '📤' },
  { label: '本月利润', value: '¥181,274', change: '+23.5%', positive: true, icon: '📈' },
  { label: '应收账款', value: '¥269,528', change: '-8.5%', positive: false, icon: '📜' },
]

const monthlyData = [
  { month: '1月', income: 42, expense: 28, profit: 14 },
  { month: '2月', income: 52, expense: 35, profit: 17 },
  { month: '3月', income: 56, expense: 38, profit: 18 },
  { month: '4月', income: 61, expense: 40, profit: 21 },
  { month: '5月', income: 55, expense: 36, profit: 19 },
  { month: '6月', income: 68, expense: 44, profit: 24 },
]

const cashFlow = [
  { label: '期初余额', value: 285000 },
  { label: '销售收款', value: 569474 },
  { label: '采购付款', value: -188100 },
  { label: '费用支出', value: -65000 },
  { label: '税费支出', value: -45000 },
  { label: '期末余额', value: 556374 },
]

const reportLinks = [
  { icon: '💰', label: '销售明细表', desc: '按月/按产品/按客户汇总销售收入', href: '/erp/accounting/invoices' },
  { icon: '📥', label: '采购明细表', desc: '按月/按供应商/按商品汇总采购支出', href: '/erp/purchase/orders' },
  { icon: '📊', label: '利润表', desc: '收入、成本、毛利、费用、净利润', href: '/erp/accounting/journal' },
  { icon: '🏦', label: '银行流水', desc: '各账户收支明细与余额', href: '/erp/accounting/accounts' },
  { icon: '📋', label: '日记账', desc: '所有凭证分录明细', href: '/erp/accounting/journal' },
  { icon: '⚖️', label: '科目余额表', desc: '各会计科目余额与累计发生额', href: '/erp/accounting/accounts' },
]

export default function AccountingReportsPage() {
  const maxIncome = Math.max(...monthlyData.map(d => d.income))

  return (
    <div className={styles.container}>
      <div className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <h1 className={styles.title}>财务报表</h1>
          <span className={styles.subtitle}>财务管理 · 2025年3月</span>
        </div>
      </div>

      {/* KPI Summary */}
      <div className={styles.kpiGrid}>
        {summary.map((s, i) => (
          <div key={i} className={styles.kpiCard}>
            <div className={styles.kpiTop}>
              <span className={styles.kpiIcon}>{s.icon}</span>
              <span className={`${styles.kpiChange} ${s.positive ? styles.positive : styles.negative}`}>
                {s.positive ? '↑' : '↓'} {s.change}
              </span>
            </div>
            <div className={styles.kpiValue}>{s.value}</div>
            <div className={styles.kpiLabel}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className={styles.chartsRow}>
        {/* Monthly Bar Chart */}
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>月度经营趋势（万元）</h3>
          <div className={styles.barChart}>
            {monthlyData.map((d, i) => (
              <div key={i} className={styles.barGroup}>
                <div className={styles.barStack}>
                  <div className={styles.barIncome} style={{ height: `${(d.income / maxIncome) * 100}%` }} title={`收入 ${d.income}万`} />
                  <div className={styles.barExpense} style={{ height: `${(d.expense / maxIncome) * 100}%` }} title={`支出 ${d.expense}万`} />
                </div>
                <span className={styles.barMonth}>{d.month}</span>
                <span className={styles.barProfit}>利润{d.profit}万</span>
              </div>
            ))}
          </div>
          <div className={styles.chartLegend}>
            <span className={styles.legendItem}><span className={styles.legendDot} style={{ background: '#2563eb' }} />收入</span>
            <span className={styles.legendItem}><span className={styles.legendDot} style={{ background: '#ef4444' }} />支出</span>
          </div>
        </div>

        {/* Cash Flow */}
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>现金流量（本月）</h3>
          <div className={styles.cashFlowList}>
            {cashFlow.map((item, i) => (
              <div key={i} className={styles.cashFlowItem}>
                <span className={styles.cashFlowLabel}>{item.label}</span>
                <span className={`${styles.cashFlowValue} ${item.value < 0 ? styles.negative : ''}`}>
                  {item.value >= 0 ? '+' : ''}¥{item.value.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Reports */}
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>报表入口</h3>
          <div className={styles.reportLinks}>
            {reportLinks.map((r, i) => (
              <Link key={i} href={r.href} className={styles.reportLink}>
                <span className={styles.reportIcon}>{r.icon}</span>
                <div className={styles.reportInfo}>
                  <span className={styles.reportLabel}>{r.label}</span>
                  <span className={styles.reportDesc}>{r.desc}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
