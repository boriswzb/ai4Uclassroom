import { Suspense } from 'react'
import { Topbar } from '@/erp/layout/topbar'
import { JournalTable } from './journal-table'
import styles from './journal.module.css'

export default function AccountingJournalPage() {
  return (
    <div>
      <Topbar title="日记账" breadcrumb={[{ label: '财务管理' }, { label: '日记账' }]} />
      <div className={styles.container}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <input type="search" placeholder="搜索凭证号、描述..." className={styles.searchInput} />
            <input type="date" className={styles.dateInput} />
          </div>
          <div className={styles.toolbarRight}>
            <button className={styles.primaryBtn}>+ 新建凭证</button>
          </div>
        </div>
        <Suspense fallback={<div className={styles.loading}>加载中...</div>}>
          <JournalTable />
        </Suspense>
      </div>
    </div>
  )
}
