import { Suspense } from 'react'
import Link from 'next/link'
import { Topbar } from '@/erp/layout/topbar'
import { CompaniesTable } from './companies-table'
import styles from './companies.module.css'

export default function CompaniesPage() {
  return (
    <div>
      <Topbar title="公司管理" breadcrumb={[{ label: '客户关系' }, { label: '公司' }]} />
      <div className={styles.container}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <span className={styles.recordCount}>共 5 家公司</span>
          </div>
          <div className={styles.toolbarRight}>
            <button className={styles.importBtn}>📥 导入</button>
            <button className={styles.exportBtn}>📤 导出</button>
            <Link href="/erp/crm/companies/new" className={styles.primaryBtn}>+ 新建公司</Link>
          </div>
        </div>

        <Suspense fallback={<div className={styles.loading}>加载中...</div>}>
          <CompaniesTable />
        </Suspense>
      </div>
    </div>
  )
}