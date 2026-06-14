'use client'

import { useState } from 'react'
import styles from './journal-table.module.css'

interface JournalLine {
  accountCode: string
  accountName: string
  debit: number
  credit: number
}

interface JournalEntry {
  id: string
  entryNumber: string
  date: string
  description: string
  amount: number
  lines: JournalLine[]
  creator: string
  isPosted: boolean
}

const mockEntries: JournalEntry[] = [
  {
    id: '1', entryNumber: 'JE-2025-000001', date: '2025-01-15', description: '收到腾达科技货款', amount: 40680,
    lines: [
      { accountCode: '1002', accountName: '银行存款', debit: 40680, credit: 0 },
      { accountCode: '1122', accountName: '应收账款', debit: 0, credit: 40680 },
    ], creator: '张三', isPosted: true,
  },
  {
    id: '2', entryNumber: 'JE-2025-000002', date: '2025-01-15', description: '支付联想采购款', amount: 137500,
    lines: [
      { accountCode: '2202', accountName: '应付账款', debit: 137500, credit: 0 },
      { accountCode: '1002', accountName: '银行存款', debit: 0, credit: 137500 },
    ], creator: '李四', isPosted: true,
  },
  {
    id: '3', entryNumber: 'JE-2025-000003', date: '2025-02-05', description: '销售商品确认收入', amount: 132210,
    lines: [
      { accountCode: '1122', accountName: '应收账款', debit: 132210, credit: 0 },
      { accountCode: '6001', accountName: '主营业务收入', debit: 0, credit: 117000 },
      { accountCode: '2221', accountName: '应交税费-销项税', debit: 0, credit: 15210 },
    ], creator: '张三', isPosted: true,
  },
  {
    id: '4', entryNumber: 'JE-2025-000004', date: '2025-02-05', description: '结转销售成本', amount: 85000,
    lines: [
      { accountCode: '6401', accountName: '主营业务成本', debit: 85000, credit: 0 },
      { accountCode: '1405', accountName: '库存商品', debit: 0, credit: 85000 },
    ], creator: '张三', isPosted: true,
  },
  {
    id: '5', entryNumber: 'JE-2025-000005', date: '2025-02-20', description: '支付办公室租金', amount: 15000,
    lines: [
      { accountCode: '6602', accountName: '管理费用-租金', debit: 15000, credit: 0 },
      { accountCode: '1002', accountName: '银行存款', debit: 0, credit: 15000 },
    ], creator: '王五', isPosted: true,
  },
  {
    id: '6', entryNumber: 'JE-2025-000006', date: '2025-03-01', description: '计提本月工资', amount: 120000,
    lines: [
      { accountCode: '6601', accountName: '管理费用-工资', debit: 120000, credit: 0 },
      { accountCode: '2211', accountName: '应付职工薪酬', debit: 0, credit: 120000 },
    ], creator: '赵六', isPosted: true,
  },
  {
    id: '7', entryNumber: 'JE-2025-000007', date: '2025-03-10', description: '采购固定资产', amount: 28000,
    lines: [
      { accountCode: '1601', accountName: '固定资产', debit: 28000, credit: 0 },
      { accountCode: '1002', accountName: '银行存款', debit: 0, credit: 28000 },
    ], creator: '李四', isPosted: false,
  },
  {
    id: '8', entryNumber: 'JE-2025-000008', date: '2025-03-12', description: '收到云智科技预付款', amount: 30000,
    lines: [
      { accountCode: '1002', accountName: '银行存款', debit: 30000, credit: 0 },
      { accountCode: '2231', accountName: '预收账款', debit: 0, credit: 30000 },
    ], creator: '张三', isPosted: true,
  },
]

export function JournalTable() {
  const [entries] = useState(mockEntries)

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>凭证号</th>
            <th>日期</th>
            <th>摘要</th>
            <th className={styles.rightCell}>借方合计</th>
            <th className={styles.rightCell}>贷方合计</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(entry => (
            <tr key={entry.id} className={styles.row}>
              <td><span className={styles.entryNo}>{entry.entryNumber}</span></td>
              <td>{entry.date}</td>
              <td>
                <div className={styles.descCell}>
                  <span>{entry.description}</span>
                  <div className={styles.lines}>
                    {entry.lines.map((line, i) => (
                      <div key={i} className={styles.line}>
                        <span className={styles.account}>{line.accountCode} {line.accountName}</span>
                        <span className={line.debit > 0 ? styles.debit : styles.credit}>
                          {line.debit > 0 ? `¥${line.debit.toLocaleString()}` : ''}
                          {line.credit > 0 ? `¥${line.credit.toLocaleString()}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </td>
              <td className={styles.rightCell}><span className={styles.debitTotal}>¥{entry.amount.toLocaleString()}</span></td>
              <td className={styles.rightCell}><span className={styles.creditTotal}>¥{entry.amount.toLocaleString()}</span></td>
              <td><span className={entry.isPosted ? styles.postedBadge : styles.draftBadge}>{entry.isPosted ? '已过账' : '草稿'}</span></td>
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
        <span className={styles.paginationInfo}>显示 1-8 条，共 8 条</span>
        <div className={styles.paginationBtns}>
          <button className={styles.pageBtn} disabled>‹</button>
          <button className={`${styles.pageBtn} ${styles.active}`}>1</button>
          <button className={styles.pageBtn} disabled>›</button>
        </div>
      </div>
    </div>
  )
}
