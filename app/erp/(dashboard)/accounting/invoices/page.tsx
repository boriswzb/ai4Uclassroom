import { Suspense } from 'react'
import Link from 'next/link'
import { Topbar } from '@/erp/layout/topbar'
import { InvoicesTable } from './invoices-table'
import styles from './invoices.module.css'

export default function AccountingInvoicesPage() {
  return (
    <div>
      <Topbar title="发票管理" breadcrumb={[{ label: '财务管理' }, { label: '发票' }]} />
      <div className={styles.container}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <input type="search" placeholder="搜索发票号、客户..." className={styles.searchInput} />
            <select className={styles.filterSelect}>
              <option value="">全部类型</option>
              <option value="SALE">销售发票</option>
              <option value="PURCHASE">采购发票</option>
            </select>
            <select className={styles.filterSelect}>
              <option value="">全部状态</option>
              <option value="DRAFT">草稿</option>
              <option value="ISSUED">已开出</option>
              <option value="PAID">已付款</option>
              <option value="PARTIAL">部分付款</option>
              <option value="CANCELLED">已取消</option>
              <option value="OVERDUE">逾期</option>
            </select>
          </div>
          <div className={styles.toolbarRight}>
            <Link href="/erp/accounting/invoices/new" className={styles.primaryBtn}>+ 新建发票</Link>
          </div>
        </div>
        <Suspense fallback={<div className={styles.loading}>加载中...</div>}>
          <InvoicesTable />
        </Suspense>
      </div>
    </div>
  )
}
