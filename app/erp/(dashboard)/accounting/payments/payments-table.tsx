'use client'

import { useState } from 'react'
import styles from './payments-table.module.css'

type PaymentType = 'RECEIVE' | 'PAY'
type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'WECHAT' | 'ALIPAY'

interface Payment {
  id: string
  paymentNo: string
  type: PaymentType
  contactName: string
  invoiceNo?: string
  amount: number
  method: PaymentMethod
  date: string
  reference: string
}

const mockPayments: Payment[] = [
  { id: '1', paymentNo: 'PAY-2025-000001', type: 'RECEIVE', contactName: '深圳市腾达科技有限公司', invoiceNo: 'INV-2025-000001', amount: 40680, method: 'BANK_TRANSFER', date: '2025-02-08', reference: '银行回单#20250208001' },
  { id: '2', paymentNo: 'PAY-2025-000002', type: 'PAY', contactName: '联想（北京）有限公司', invoiceNo: 'INV-2025-000004', amount: 137500, method: 'BANK_TRANSFER', date: '2025-02-14', reference: '银行回单#20250214001' },
  { id: '3', paymentNo: 'PAY-2025-000003', type: 'RECEIVE', contactName: '广州中商贸易有限公司', invoiceNo: 'INV-2025-000002', amount: 50000, method: 'BANK_TRANSFER', date: '2025-02-28', reference: '银行回单#20250228001' },
  { id: '4', paymentNo: 'PAY-2025-000004', type: 'PAY', contactName: '得力集团有限公司', invoiceNo: 'INV-2025-000005', amount: 28000, method: 'BANK_TRANSFER', date: '2025-03-02', reference: '银行回单#20250302001' },
  { id: '5', paymentNo: 'PAY-2025-000005', type: 'RECEIVE', contactName: '深圳市腾达科技有限公司', invoiceNo: 'INV-2025-000009', amount: 83580, method: 'WECHAT', date: '2025-03-20', reference: '微信转账' },
  { id: '6', paymentNo: 'PAY-2025-000006', type: 'PAY', contactName: '成都万事达物流', invoiceNo: 'INV-2025-000008', amount: 15000, method: 'ALIPAY', date: '2025-03-18', reference: '支付宝转账' },
  { id: '7', paymentNo: 'PAY-2025-000007', type: 'RECEIVE', contactName: '广州中商贸易有限公司', invoiceNo: 'INV-2025-000002', amount: 30000, method: 'BANK_TRANSFER', date: '2025-03-22', reference: '银行回单#20250322001' },
  { id: '8', paymentNo: 'PAY-2025-000008', type: 'PAY', contactName: '联想（北京）有限公司', invoiceNo: 'INV-2025-000011', amount: 20000, method: 'BANK_TRANSFER', date: '2025-03-25', reference: '银行回单#20250325001' },
  { id: '9', paymentNo: 'PAY-2025-000009', type: 'RECEIVE', contactName: '北京华联集团', amount: 20000, method: 'CASH', date: '2025-03-15', reference: '现金收款' },
  { id: '10', paymentNo: 'PAY-2025-000010', type: 'PAY', contactName: '得力集团有限公司', invoiceNo: undefined, amount: 5000, method: 'WECHAT', date: '2025-03-16', reference: '微信付款-办公用品' },
  { id: '11', paymentNo: 'PAY-2025-000011', type: 'RECEIVE', contactName: '上海星火电子', invoiceNo: undefined, amount: 20000, method: 'BANK_TRANSFER', date: '2025-03-18', reference: '预付款' },
  { id: '12', paymentNo: 'PAY-2025-000012', type: 'PAY', contactName: '杭州云智科技', invoiceNo: undefined, amount: 30000, method: 'BANK_TRANSFER', date: '2025-03-20', reference: '预付款-设备采购' },
  { id: '13', paymentNo: 'PAY-2025-000013', type: 'RECEIVE', contactName: '深圳市腾达科技有限公司', invoiceNo: 'INV-2025-000001', amount: 10000, method: 'ALIPAY', date: '2025-03-22', reference: '支付宝部分收款' },
  { id: '14', paymentNo: 'PAY-2025-000014', type: 'PAY', contactName: '联想（北京）有限公司', invoiceNo: 'INV-2025-000011', amount: 10000, method: 'WECHAT', date: '2025-03-28', reference: '微信付款-尾款' },
  { id: '15', paymentNo: 'PAY-2025-000015', type: 'RECEIVE', contactName: '广州中商贸易有限公司', invoiceNo: 'INV-2025-000010', amount: 50850, method: 'BANK_TRANSFER', date: '2025-04-02', reference: '银行回单#20250402001' },
]

const methodLabels: Record<PaymentMethod, string> = { CASH: '现金', BANK_TRANSFER: '银行转账', WECHAT: '微信', ALIPAY: '支付宝' }

export function PaymentsTable() {
  const [payments] = useState(mockPayments)

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.checkboxCell}><input type="checkbox" /></th>
            <th>单据号</th>
            <th>类型</th>
            <th>往来方</th>
            <th>关联发票</th>
            <th className={styles.rightCell}>金额</th>
            <th>支付方式</th>
            <th>日期</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {payments.map(p => (
            <tr key={p.id} className={styles.row}>
              <td className={styles.checkboxCell}><input type="checkbox" /></td>
              <td><span className={styles.paymentNo}>{p.paymentNo}</span></td>
              <td><span className={p.type === 'RECEIVE' ? styles.receiveBadge : styles.payBadge}>{p.type === 'RECEIVE' ? '收款' : '付款'}</span></td>
              <td>{p.contactName}</td>
              <td className={styles.ref}>{p.invoiceNo || '-'}</td>
              <td className={styles.rightCell}>
                <span className={p.type === 'RECEIVE' ? styles.receive : styles.pay}>¥{p.amount.toLocaleString()}</span>
              </td>
              <td><span className={styles.methodBadge}>{methodLabels[p.method]}</span></td>
              <td>{p.date}</td>
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
        <span className={styles.paginationInfo}>显示 1-15 条，共 15 条</span>
        <div className={styles.paginationBtns}>
          <button className={styles.pageBtn} disabled>‹</button>
          <button className={`${styles.pageBtn} ${styles.active}`}>1</button>
          <button className={styles.pageBtn} disabled>›</button>
        </div>
      </div>
    </div>
  )
}
