import { Suspense } from 'react'
import Link from 'next/link'
import { Topbar } from '@/erp/layout/topbar'
import { WarehousesTable } from './warehouses-table'
import styles from './warehouses.module.css'

export default function InventoryWarehousesPage() {
  return (
    <div>
      <Topbar title="仓库管理" breadcrumb={[{ label: '库存管理' }, { label: '仓库' }]} />
      <div className={styles.container}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <input type="search" placeholder="搜索仓库名称、编码..." className={styles.searchInput} />
          </div>
          <div className={styles.toolbarRight}>
            <Link href="/erp/inventory/warehouses/new" className={styles.primaryBtn}>+ 新建仓库</Link>
          </div>
        </div>
        <Suspense fallback={<div className={styles.loading}>加载中...</div>}>
          <WarehousesTable />
        </Suspense>
      </div>
    </div>
  )
}
