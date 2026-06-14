import { Suspense } from 'react'
import Link from 'next/link'
import { Topbar } from '@/erp/layout/topbar'
import { OrdersTable } from './orders-table'
import styles from './orders.module.css'

export default function PurchaseOrdersPage() {
  return (
    <div>
      <Topbar title="采购订单" breadcrumb={[{ label: '采购管理' }, { label: '采购订单' }]} />
      <div className={styles.container}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <input
              type="search"
              placeholder="搜索订单号、供应商..."
              className={styles.searchInput}
            />
            <select className={styles.filterSelect}>
              <option value="">全部状态</option>
              <option value="DRAFT">草稿</option>
              <option value="CONFIRMED">已确认</option>
              <option value="ORDERED">已下单</option>
              <option value="RECEIVED">已收货</option>
              <option value="CANCELLED">已取消</option>
            </select>
          </div>
          <div className={styles.toolbarRight}>
            <button className={styles.importBtn}>📥 导入</button>
            <button className={styles.exportBtn}>📤 导出</button>
            <Link href="/erp/purchase/orders/new" className={styles.primaryBtn}>+ 新建采购订单</Link>
          </div>
        </div>

        <Suspense fallback={<div className={styles.loading}>加载中...</div>}>
          <OrdersTable />
        </Suspense>
      </div>
    </div>
  )
}