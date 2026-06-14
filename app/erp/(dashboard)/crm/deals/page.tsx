import { Suspense } from 'react'
import Link from 'next/link'
import { Topbar } from '@/erp/layout/topbar'
import { DealsTable } from './deals-table'
import styles from './deals.module.css'

export default function DealsPage() {
  return (
    <div>
      <Topbar title="商机管理" breadcrumb={[{ label: '客户关系' }, { label: '商机' }]} />
      <div className={styles.container}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <span className={styles.recordCount}>管理所有商机线索</span>
          </div>
          <div className={styles.toolbarRight}>
            <button className={styles.importBtn}>📥 导入</button>
            <button className={styles.exportBtn}>📤 导出</button>
            <Link href="/erp/crm/deals/new" className={styles.primaryBtn}>+ 新建商机</Link>
          </div>
        </div>

        <Suspense fallback={<div className={styles.loading}>加载中...</div>}>
          <DealsTable />
        </Suspense>
      </div>
    </div>
  )
}
