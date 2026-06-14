'use client'

import Link from 'next/link'
import styles from './crm.module.css'

const kpis = [
  { label: '客户总数', value: '328', change: '+12', positive: true, icon: '👥' },
  { label: '本月新增', value: '18', change: '+5', positive: true, icon: '🆕' },
  { label: '商机数量', value: '46', change: '-3', positive: false, icon: '💼' },
  { label: '预计成交额', value: '¥286万', change: '+23.5%', positive: true, icon: '📈' },
]

const funnelData = [
  { label: '需求确认', count: 15, pct: 100, cls: 'stageQualified' },
  { label: '方案报价', count: 12, pct: 80, cls: 'stageProposal' },
  { label: '商务谈判', count: 8, pct: 53, cls: 'stageNegotiation' },
  { label: '合同签订', count: 4, pct: 27, cls: 'stageContract' },
]

const sourceData = [
  { label: '老客户推荐', count: 24, color: '#6366f1' },
  { label: '线上推广', count: 18, color: '#3b82f6' },
  { label: '行业展会', count: 12, color: '#10b981' },
  { label: '电话拓展', count: 9, color: '#f59e0b' },
  { label: '其他渠道', count: 6, color: '#64748b' },
]

const recentContacts = [
  { name: '李明', company: '深圳市腾达科技有限公司', lastContact: '2025-03-15', nextFollowup: '2025-03-22', status: 'active' },
  { name: '王芳', company: '广州中商贸易有限公司', lastContact: '2025-03-14', nextFollowup: '2025-03-21', status: 'active' },
  { name: '张伟', company: '北京华联集团', lastContact: '2025-03-10', nextFollowup: '2025-03-20', status: 'pending' },
  { name: '陈小红', company: '上海星火电子', lastContact: '2025-03-08', nextFollowup: '2025-03-18', status: 'active' },
  { name: '刘强', company: '杭州云智科技', lastContact: '2025-03-05', nextFollowup: '2025-03-19', status: 'inactive' },
]

const hotDeals = [
  { title: '腾达科技采购项目', company: '深圳市腾达科技有限公司', amount: 500000, stage: 'negotiation' },
  { title: '中商贸易办公设备采购', company: '广州中商贸易有限公司', amount: 280000, stage: 'proposal' },
  { title: '华联集团网络升级', company: '北京华联集团', amount: 180000, stage: 'qualified' },
]

export default function CRMPage() {
  return (
    <div className={styles.container}>
      <div className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <h1 className={styles.title}>客户管理</h1>
          <span className={styles.subtitle}>CRM · 2025年3月</span>
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

      {/* Middle Row */}
      <div className={styles.cardsRow}>
        {/* Funnel */}
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>销售漏斗</h3>
          <div className={styles.funnelList}>
            {funnelData.map((f, i) => (
              <div key={i} className={styles.funnelItem}>
                <span className={styles.funnelLabel}>{f.label}</span>
                <div className={styles.funnelBar}>
                  <div className={`${styles.funnelBarFill} ${styles[f.cls]}`} style={{ width: `${f.pct}%` }}>
                    {f.count}个
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Source */}
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>客户来源</h3>
          <div className={styles.sourceList}>
            {sourceData.map((s, i) => (
              <div key={i} className={styles.sourceItem}>
                <span className={styles.sourceDot} style={{ background: s.color }} />
                <span className={styles.sourceLabel}>{s.label}</span>
                <span className={styles.sourceCount}>{s.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>快捷入口</h3>
          <div className={styles.quickLinks}>
            <Link href="/erp/crm/contacts" className={styles.quickLink}>
              <span className={styles.quickLinkIcon}>👥</span>
              <span className={styles.quickLinkLabel}>联系人</span>
            </Link>
            <Link href="/erp/crm/companies" className={styles.quickLink}>
              <span className={styles.quickLinkIcon}>🏢</span>
              <span className={styles.quickLinkLabel}>公司</span>
            </Link>
            <Link href="/erp/crm/deals" className={styles.quickLink}>
              <span className={styles.quickLinkIcon}>💼</span>
              <span className={styles.quickLinkLabel}>商机</span>
            </Link>
            <Link href="/erp/crm/contacts/new" className={styles.quickLink}>
              <span className={styles.quickLinkIcon}>➕</span>
              <span className={styles.quickLinkLabel}>新建联系人</span>
            </Link>
            <Link href="/erp/crm/companies/new" className={styles.quickLink}>
              <span className={styles.quickLinkIcon}>🏗️</span>
              <span className={styles.quickLinkLabel}>新建公司</span>
            </Link>
            <Link href="/erp/crm/deals/new" className={styles.quickLink}>
              <span className={styles.quickLinkIcon}>✨</span>
              <span className={styles.quickLinkLabel}>新建商机</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className={styles.cardsRow}>
        {/* Recent Contacts */}
        <div className={styles.card} style={{ gridColumn: '1 / 3' }}>
          <h3 className={styles.cardTitle}>最近联系</h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>姓名</th>
                <th>公司</th>
                <th>最后联系</th>
                <th>下次跟进</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {recentContacts.map((c, i) => (
                <tr key={i}>
                  <td className={styles.customerName}>{c.name}</td>
                  <td>{c.company}</td>
                  <td>{c.lastContact}</td>
                  <td>{c.nextFollowup}</td>
                  <td>
                    <span className={`${styles.statusBadge} ${
                      c.status === 'active' ? styles.sActive :
                      c.status === 'pending' ? styles.sPending :
                      styles.sInactive
                    }`}>
                      {c.status === 'active' ? '活跃' : c.status === 'pending' ? '待跟进' : '不活跃'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Hot Deals */}
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>热门商机</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {hotDeals.map((d, i) => (
              <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500, marginBottom: 4 }}>{d.title}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>{d.company}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', fontFamily: 'monospace' }}>
                    ¥{d.amount.toLocaleString()}
                  </span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    {d.stage === 'negotiation' ? '商务谈判' : d.stage === 'proposal' ? '方案报价' : '需求确认'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
