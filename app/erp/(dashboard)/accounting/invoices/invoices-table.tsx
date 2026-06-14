'use client'

import { useState } from 'react'
import styles from './invoices-table.module.css'

type InvoiceType = 'SALE' | 'PURCHASE'
type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'PARTIAL' | 'CANCELLED' | 'OVERDUE'

interface Invoice {
  id: string
  invoiceNo: string
  type: InvoiceType
  contactName: string
  status: InvoiceStatus
  totalAmount: number
  paidAmount: number
  issueDate: string
  dueDate: string
}

const mockInvoices: Invoice[] = [
  { id: '1', invoiceNo: 'INV-2025-000001', type: 'SALE', contactName: '深圳市腾达科技有限公司', status: 'PAID', totalAmount: 40680, paidAmount: 40680, issueDate: '2025-01-10', dueDate: '2025-02-10' },
  { id: '2', invoiceNo: 'INV-2025-000002', type: 'SALE', contactName: '广州中商贸易有限公司', status: 'PARTIAL', totalAmount: 132210, paidAmount: 80000, issueDate: '2025-02-05', dueDate: '2025-03-05' },
  { id: '3', invoiceNo: 'INV-2025-000003', type: 'SALE', contactName: '北京华联集团', status: 'ISSUED', totalAmount: 37968, paidAmount: 0, issueDate: '2025-02-20', dueDate: '2025-03-20' },
  { id: '4', invoiceNo: 'INV-2025-000004', type: 'PURCHASE', contactName: '联想（北京）有限公司', status: 'PAID', totalAmount: 137500, paidAmount: 137500, issueDate: '2025-01-15', dueDate: '2025-02-15' },
  { id: '5', invoiceNo: 'INV-2025-000005', type: 'PURCHASE', contactName: '得力集团有限公司', status: 'ISSUED', totalAmount: 28000, paidAmount: 0, issueDate: '2025-02-03', dueDate: '2025-03-03' },
  { id: '6', invoiceNo: 'INV-2025-000006', type: 'SALE', contactName: '上海星火电子', status: 'OVERDUE', totalAmount: 49720, paidAmount: 0, issueDate: '2025-01-20', dueDate: '2025-02-20' },
  { id: '7', invoiceNo: 'INV-2025-000007', type: 'SALE', contactName: '杭州云智科技', status: 'DRAFT', totalAmount: 80682, paidAmount: 0, issueDate: '2025-03-01', dueDate: '2025-04-01' },
  { id: '8', invoiceNo: 'INV-2025-000008', type: 'PURCHASE', contactName: '成都万事达物流', status: 'PAID', totalAmount: 15000, paidAmount: 15000, issueDate: '2025-02-20', dueDate: '2025-03-20' },
  { id: '9', invoiceNo: 'INV-2025-000009', type: 'SALE', contactName: '深圳市腾达科技有限公司', status: 'PAID', totalAmount: 83580, paidAmount: 83580, issueDate: '2025-02-25', dueDate: '2025-03-25' },
  { id: '10', invoiceNo: 'INV-2025-000010', type: 'SALE', contactName: '广州中商贸易有限公司', status: 'ISSUED', totalAmount: 50850, paidAmount: 0, issueDate: '2025-03-05', dueDate: '2025-04-05' },
  { id: '11', invoiceNo: 'INV-2025-000011', type: 'PURCHASE', contactName: '联想（北京）有限公司', status: 'PARTIAL', totalAmount: 47600, paidAmount: 20000, issueDate: '2025-03-10', dueDate: '2025-04-10' },
  { id: '12', invoiceNo: 'INV-2025-000012', type: 'SALE', contactName: '北京华联集团', status: 'CANCELLED', totalAmount: 63533, paidAmount: 0, issueDate: '2025-01-20', dueDate: '2025-02-20' },
]

const statusLabels: Record<InvoiceStatus, string> = { DRAFT: '草稿', ISSUED: '已开出', PAID: '已付款', PARTIAL: '部分', CANCELLED: '已取消', OVERDUE: '逾期' }
const typeLabels: Record<InvoiceType, string> = { SALE: '销售', PURCHASE: '采购' }

export function InvoicesTable() {
  const [invoices] = useState(mockInvoices)

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.checkboxCell}><input type="checkbox" /></th>
            <th>发票号</th>
            <th>类型</th>
            <th>客户/供应商</th>
            <th>状态</th>
            <th className={styles.rightCell}>发票金额</th>
            <th className={styles.rightCell}>已付金额</th>
            <th>开票日期</th>
            <th>到期日期</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map(inv => (
            <tr key={inv.id} className={styles.row}>
              <td className={styles.checkboxCell}><input type="checkbox" /></td>
              <td><span className={styles.invoiceNo}>{inv.invoiceNo}</span></td>
              <td><span className={inv.type === 'SALE' ? styles.saleBadge : styles.purchaseBadge}>{typeLabels[inv.type]}</span></td>
              <td>{inv.contactName}</td>
              <td><span className={styles.badge} data-status={inv.status}>{statusLabels[inv.status]}</span></td>
              <td className={styles.rightCell}><span className={styles.amount}>¥{inv.totalAmount.toLocaleString()}</span></td>
              <td className={styles.rightCell}>
                {inv.paidAmount > 0 ? <span className={inv.paidAmount >= inv.totalAmount ? styles.paid : styles.partial}>¥{inv.paidAmount.toLocaleString()}</span> : '-'}
              </td>
              <td>{inv.issueDate}</td>
              <td className={inv.status === 'OVERDUE' ? styles.overdue : ''}>{inv.dueDate}</td>
              <td>
                <div className={styles.actions}>
                  <button className={styles.actionBtn} title="查看">👁️</button>
                  <button className={styles.actionBtn} title="编辑">✏️</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.pagination}>
        <span className={styles.paginationInfo}>显示 1-12 条，共 12 条</span>
        <div className={styles.paginationBtns}>
          <button className={styles.pageBtn} disabled>‹</button>
          <button className={`${styles.pageBtn} ${styles.active}`}>1</button>
          <button className={styles.pageBtn} disabled>›</button>
        </div>
      </div>
    </div>
  )
}
