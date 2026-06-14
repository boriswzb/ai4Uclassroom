'use client'

import Link from 'next/link'
import styles from './inventory-widget.module.css'

const mockLowStock = [
  { sku: 'ELEC-002', name: '无线鼠标', warehouse: '总部仓库', qty: 3, reorderPoint: 10 },
  { sku: 'OFFICE-002', name: '中性笔（黑色）', warehouse: '总部仓库', qty: 8, reorderPoint: 20 },
  { sku: 'ELEC-003', name: '机械键盘', warehouse: '总部仓库', qty: 5, reorderPoint: 15 },
]

export function InventoryWidget() {
  return (
    <div className={styles.widget}>
      <div className={styles.header}>
        <h3 className={styles.title}>⚠️ 库存预警</h3>
        <Link href="/erp/inventory" className={styles.link}>查看全部 →</Link>
      </div>
      <div className={styles.list}>
        {mockLowStock.map(item => (
          <div key={item.sku} className={styles.item}>
            <div>
              <div className={styles.name}>{item.name}</div>
              <div className={styles.sku}>{item.sku} · {item.warehouse}</div>
            </div>
            <div className={styles.right}>
              <div className={`${styles.qty} ${item.qty < 5 ? styles.danger : styles.warning}`}>
                {item.qty}
              </div>
              <div className={styles.reorder}>补货点 {item.reorderPoint}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
