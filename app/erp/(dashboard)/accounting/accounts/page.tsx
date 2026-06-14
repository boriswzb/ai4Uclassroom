import { Suspense } from 'react'
import { Topbar } from '@/erp/layout/topbar'
import { AccountsTable } from './accounts-table'
import styles from './accounts.module.css'

export default function AccountingAccountsPage() {
  return (
    <div>
      <Topbar title="会计科目" breadcrumb={[{ label: '财务管理' }, { label: '会计科目' }]} />
      <div className={styles.container}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <input type="search" placeholder="搜索科目编码、名称..." className={styles.searchInput} />
            <select className={styles.filterSelect}>
              <option value="">全部类型</option>
              <option value="ASSET">资产</option>
              <option value="LIABILITY">负债</option>
              <option value="EQUITY">权益</option>
              <option value="COST">成本</option>
              <option value="EXPENSE">费用</option>
              <option value="REVENUE">收入</option>
            </select>
          </div>
          <div className={styles.toolbarRight}>
            <button className={styles.primaryBtn}>+ 新建科目</button>
          </div>
        </div>
        <Suspense fallback={<div className={styles.loading}>加载中...</div>}>
          <AccountsTable />
        </Suspense>
      </div>
    </div>
  )
}
