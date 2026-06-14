import { Suspense } from 'react'
import Link from 'next/link'
import { Topbar } from '@/erp/layout/topbar'
import { PaymentsTable } from './payments-table'
import styles from './payments.module.css'

export default function AccountingPaymentsPage() {
  return (
    <div>
      <Topbar title="收款/付款" breadcrumb={[{ label: '财务管理' }, { label: '收款付款' }]} />
      <div className={styles.container}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <input type="search" placeholder="搜索单据号、往来方..." className={styles.searchInput} />
            <select className={styles.filterSelect}>
              <option value="">全部类型</option>
              <option value="RECEIVE">收款</option>
              <option value="PAY">付款</option>
            </select>
            <select className={styles.filterSelect}>
              <option value="">全部方式</option>
              <option value="CASH">现金</option>
              <option value="BANK_TRANSFER">银行转账</option>
              <option value="WECHAT">微信</option>
              <option value="ALIPAY">支付宝</option>
            </select>
          </div>
          <div className={styles.toolbarRight}>
            <Link href="/erp/accounting/payments/new" className={styles.primaryBtn}>+ 新建收付款</Link>
          </div>
        </div>
        <Suspense fallback={<div className={styles.loading}>加载中...</div>}>
          <PaymentsTable />
        </Suspense>
      </div>
    </div>
  )
}
