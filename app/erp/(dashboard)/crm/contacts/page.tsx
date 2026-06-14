import { Suspense } from 'react'
import Link from 'next/link'
import { Topbar } from '@/erp/layout/topbar'
import { ContactsTable } from './contacts-table'
import styles from './contacts.module.css'

export default function ContactsPage() {
  return (
    <div>
      <Topbar title="客户管理" breadcrumb={[{ label: '客户关系' }, { label: '联系人' }]} />
      <div className={styles.container}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarRight}>
            <button className={styles.importBtn}>📥 导入</button>
            <button className={styles.exportBtn}>📤 导出</button>
            <Link href="/erp/crm/contacts/new" className={styles.primaryBtn}>+ 新建联系人</Link>
          </div>
        </div>

        <Suspense fallback={<div className={styles.loading}>加载中...</div>}>
          <ContactsTable />
        </Suspense>
      </div>
    </div>
  )
}
