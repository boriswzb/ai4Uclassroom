'use client'

import { useState } from 'react'
import styles from './accounts-table.module.css'

type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'COST' | 'EXPENSE' | 'REVENUE'

interface Account {
  id: string
  code: string
  name: string
  type: AccountType
  level: number
  isDetail: boolean
  currentBalance: number
  normalBalance: 'DEBIT' | 'CREDIT'
}

const mockAccounts: Account[] = [
  { id: '1', code: '1001', name: '库存现金', type: 'ASSET', level: 1, isDetail: true, currentBalance: 12580, normalBalance: 'DEBIT' },
  { id: '2', code: '1002', name: '银行存款', type: 'ASSET', level: 1, isDetail: true, currentBalance: 2856300, normalBalance: 'DEBIT' },
  { id: '3', code: '1122', name: '应收账款', type: 'ASSET', level: 1, isDetail: true, currentBalance: 456800, normalBalance: 'DEBIT' },
  { id: '4', code: '1405', name: '库存商品', type: 'ASSET', level: 1, isDetail: true, currentBalance: 892000, normalBalance: 'DEBIT' },
  { id: '5', code: '1601', name: '固定资产', type: 'ASSET', level: 1, isDetail: true, currentBalance: 1560000, normalBalance: 'DEBIT' },
  { id: '6', code: '2202', name: '应付账款', type: 'LIABILITY', level: 1, isDetail: true, currentBalance: 234500, normalBalance: 'CREDIT' },
  { id: '7', code: '2211', name: '应付职工薪酬', type: 'LIABILITY', level: 1, isDetail: true, currentBalance: 120000, normalBalance: 'CREDIT' },
  { id: '8', code: '2221', name: '应交税费', type: 'LIABILITY', level: 1, isDetail: true, currentBalance: 89100, normalBalance: 'CREDIT' },
  { id: '9', code: '2231', name: '预收账款', type: 'LIABILITY', level: 1, isDetail: true, currentBalance: 30000, normalBalance: 'CREDIT' },
  { id: '10', code: '4001', name: '实收资本', type: 'EQUITY', level: 1, isDetail: true, currentBalance: 5000000, normalBalance: 'CREDIT' },
  { id: '11', code: '4103', name: '本年利润', type: 'EQUITY', level: 1, isDetail: true, currentBalance: 890000, normalBalance: 'CREDIT' },
  { id: '12', code: '6001', name: '主营业务收入', type: 'REVENUE', level: 1, isDetail: true, currentBalance: 2890000, normalBalance: 'CREDIT' },
  { id: '13', code: '6401', name: '主营业务成本', type: 'COST', level: 1, isDetail: true, currentBalance: 1650000, normalBalance: 'DEBIT' },
  { id: '14', code: '6601', name: '管理费用-工资', type: 'EXPENSE', level: 2, isDetail: true, currentBalance: 480000, normalBalance: 'DEBIT' },
  { id: '15', code: '6602', name: '管理费用-租金', type: 'EXPENSE', level: 2, isDetail: true, currentBalance: 90000, normalBalance: 'DEBIT' },
]

const typeLabels: Record<AccountType, string> = { ASSET: '资产', LIABILITY: '负债', EQUITY: '权益', COST: '成本', EXPENSE: '费用', REVENUE: '收入' }
const typeColors: Record<AccountType, string> = { ASSET: '#1d4ed8', LIABILITY: '#c2410c', EQUITY: '#7c3aed', COST: '#0891b2', EXPENSE: '#dc2626', REVENUE: '#15803d' }

export function AccountsTable() {
  const [accounts] = useState(mockAccounts)

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>科目编码</th>
            <th>科目名称</th>
            <th>类型</th>
            <th>余额方向</th>
            <th className={styles.rightCell}>当前余额</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map(acc => (
            <tr key={acc.id} className={styles.row} style={acc.level > 1 ? { paddingLeft: `${(acc.level - 1) * 20}px` } : {}}>
              <td><span className={styles.code}>{acc.code}</span></td>
              <td style={acc.level > 1 ? { paddingLeft: `${(acc.level - 1) * 20}px` } : {}}>
                <span className={styles.name}>{acc.name}</span>
              </td>
              <td>
                <span className={styles.typeBadge} style={{ background: `${typeColors[acc.type]}15`, color: typeColors[acc.type] }}>
                  {typeLabels[acc.type]}
                </span>
              </td>
              <td><span className={acc.normalBalance === 'DEBIT' ? styles.debitNb : styles.creditNb}>{acc.normalBalance === 'DEBIT' ? '借' : '贷'}</span></td>
              <td className={styles.rightCell}>
                <span className={acc.normalBalance === 'DEBIT' ? styles.debitBal : styles.creditBal}>
                  {acc.currentBalance >= 0 ? '' : '-'}¥{Math.abs(acc.currentBalance).toLocaleString()}
                </span>
              </td>
              <td>
                <div className={styles.actions}>
                  <button className={styles.actionBtn} title="编辑">✏️</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
