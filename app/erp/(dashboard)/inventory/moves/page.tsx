import { Suspense } from 'react'
import Link from 'next/link'
import { Topbar } from '@/erp/layout/topbar'
import { MovesTable } from './moves-table'
import styles from './moves.module.css'

export default function InventoryMovesPage() {
  return (
    <div>
      <Topbar title="库移动作" breadcrumb={[{ label: '库存管理' }, { label: '库移动作' }]} />
      <div className={styles.container}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <input type="search" placeholder="搜索单据号、产品..." className={styles.searchInput} />
            <select className={styles.filterSelect}>
              <option value="">全部类型</option>
              <option value="IN">入库</option>
              <option value="OUT">出库</option>
              <option value="TRANSFER">调拨</option>
              <option value="ADJUSTMENT">调整</option>
              <option value="PRODUCTION">生产入库</option>
            </select>
          </div>
          <div className={styles.toolbarRight}>
            <Link href="/erp/inventory/moves/new" className={styles.primaryBtn}>+ 新建移动</Link>
          </div>
        </div>
        <Suspense fallback={<div className={styles.loading}>加载中...</div>}>
          <MovesTable />
        </Suspense>
      </div>
    </div>
  )
}
