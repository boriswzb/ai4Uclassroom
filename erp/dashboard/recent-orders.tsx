'use client'

import Link from 'next/link'
import styles from './recent-orders.module.css'

const mockOrders = [
  { id: 'SO-2025-000047', customer: '深圳市腾达科技有限公司', amount: 89990, status: 'confirmed', date: '2025-01-10' },
  { id: 'SO-2025-000046', customer: '广州中商贸易有限公司', amount: 25600, status: 'draft', date: '2025-01-09' },
  { id: 'SO-2025-000045', customer: '北京华联集团', amount: 179998, status: 'delivered', date: '2025-01-08' },
  { id: 'SO-2025-000044', customer: '深圳市腾达科技有限公司', amount: 45000, status: 'confirmed', date: '2025-01-07' },
]

export function RecentOrdersWidget() {
  return (
    <div className={styles.widget}>
      <div className={styles.header}>
        <h3 className={styles.title}>📋 最近销售订单</h3>
        <Link href="/erp/sales" className={styles.link}>查看全部 →</Link>
      </div>
      <div className={styles.list}>
        {mockOrders.map(order => (
          <div key={order.id} className={styles.item}>
            <div className={styles.info}>
              <div className={styles.orderId}>{order.id}</div>
              <div className={styles.customer}>{order.customer}</div>
              <div className={styles.date}>{order.date}</div>
            </div>
            <div className={styles.right}>
              <div className={styles.amount}>¥{order.amount.toLocaleString()}</div>
              <span className={`${styles.status} ${styles[order.status]}`}>
                {order.status === 'confirmed' ? '已确认' : order.status === 'draft' ? '草稿' : '已发货'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
