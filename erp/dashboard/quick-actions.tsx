'use client'

import Link from 'next/link'
import styles from './quick-actions.module.css'

const actions = [
  { icon: '📋', label: '新建销售订单', href: '/erp/sales/orders/new', color: '#34d399' },
  { icon: '🛒', label: '新建采购订单', href: '/erp/purchase/orders/new', color: '#60a5fa' },
  { icon: '📦', label: '盘点入库', href: '/erp/inventory/moves/new', color: '#f59e0b' },
  { icon: '💰', label: '收款登记', href: '/erp/accounting/payments/new', color: '#a78bfa' },
  { icon: '👤', label: '新增客户', href: '/erp/crm/contacts/new', color: '#f472b6' },
  { icon: '📄', label: '开具发票', href: '/erp/accounting/invoices/new', color: '#fbbf24' },
  { icon: '🤖', label: 'AI数据分析', href: '/erp/ai/analytics', color: '#8b5cf6' },
  { icon: '⚙️', label: '系统设置', href: '/erp/settings', color: '#64748b' },
]

export function QuickActions() {
  return (
    <div className={styles.container}>
      <div className={styles.title}>快捷操作</div>
      <div className={styles.grid}>
        {actions.map(action => (
          <Link key={action.label} href={action.href} className={styles.btn}>
            <span
              className={styles.icon}
              style={{ background: `${action.color}20`, color: action.color }}
            >
              {action.icon}
            </span>
            <span className={styles.label}>{action.label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
