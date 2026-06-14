'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './moves-table.module.css'

type MoveType = 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT' | 'PRODUCTION'

interface Move {
  id: string
  moveNo: string
  type: MoveType
  productName: string
  warehouseName: string
  toWarehouse?: string
  quantity: number
  unit: string
  reference: string
  createdAt: string
  creator: string
}

const mockMoves: Move[] = [
  { id: '1', moveNo: 'SM-2025-000001', type: 'IN', productName: '企业路由器 R2000', warehouseName: '深圳仓', quantity: 100, unit: '台', reference: 'PO-2025-000001', createdAt: '2025-01-16', creator: '张三' },
  { id: '2', moveNo: 'SM-2025-000002', type: 'OUT', productName: '企业路由器 R2000', warehouseName: '深圳仓', quantity: 50, unit: '台', reference: 'SO-2025-000001', createdAt: '2025-01-20', creator: '李四' },
  { id: '3', moveNo: 'SM-2025-000003', type: 'TRANSFER', productName: '商务笔记本 ThinkPad L15', warehouseName: '深圳仓', toWarehouse: '广州仓', quantity: 20, unit: '台', reference: '调拨单 TR-2025-001', createdAt: '2025-02-06', creator: '王五' },
  { id: '4', moveNo: 'SM-2025-000004', type: 'ADJUSTMENT', productName: 'POE交换机 24口', warehouseName: '深圳仓', quantity: -2, unit: '台', reference: '盘点差异', createdAt: '2025-02-10', creator: '赵六' },
  { id: '5', moveNo: 'SM-2025-000005', type: 'IN', productName: 'ThinkPad X1 Carbon 笔记本', warehouseName: '深圳仓', quantity: 10, unit: '台', reference: 'PO-2025-000001', createdAt: '2025-01-26', creator: '张三' },
  { id: '6', moveNo: 'SM-2025-000006', type: 'OUT', productName: 'ThinkVision 显示器', warehouseName: '深圳仓', quantity: 5, unit: '台', reference: 'SO-2025-000001', createdAt: '2025-01-26', creator: '李四' },
  { id: '7', moveNo: 'SM-2025-000007', type: 'PRODUCTION', productName: '定制服务器 CS-001', warehouseName: '深圳仓', quantity: 3, unit: '台', reference: '工单 WO-2025-008', createdAt: '2025-02-15', creator: '赵六' },
  { id: '8', moveNo: 'SM-2025-000008', type: 'IN', productName: '物流服务套餐', warehouseName: '广州仓', quantity: 5, unit: '套', reference: 'PO-2025-000003', createdAt: '2025-02-28', creator: '王五' },
  { id: '9', moveNo: 'SM-2025-000009', type: 'OUT', productName: '企业交换机 S4500-48P', warehouseName: '广州仓', quantity: 10, unit: '台', reference: 'SO-2025-000003', createdAt: '2025-03-05', creator: '李四' },
  { id: '10', moveNo: 'SM-2025-000010', type: 'TRANSFER', productName: '无线AP WAP-300', warehouseName: '深圳仓', toWarehouse: '上海仓', quantity: 40, unit: '台', reference: '调拨单 TR-2025-003', createdAt: '2025-03-08', creator: '张三' },
  { id: '11', moveNo: 'SM-2025-000011', type: 'ADJUSTMENT', productName: 'ThinkCentre M920t 台式机', warehouseName: '上海仓', quantity: 3, unit: '台', reference: '盘点调整', createdAt: '2025-03-10', creator: '赵六' },
  { id: '12', moveNo: 'SM-2025-000012', type: 'OUT', productName: 'UPS不间断电源 3KVA', warehouseName: '深圳仓', quantity: 4, unit: '台', reference: 'SO-2025-000010', createdAt: '2025-03-20', creator: '王五' },
]

const typeLabels: Record<MoveType, string> = { IN: '入库', OUT: '出库', TRANSFER: '调拨', ADJUSTMENT: '调整', PRODUCTION: '生产' }

export function MovesTable() {
  const router = useRouter()
  const [moves] = useState(mockMoves)

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>单据号</th>
            <th>类型</th>
            <th>产品</th>
            <th>仓库</th>
            <th>目标仓库</th>
            <th className={styles.rightCell}>数量</th>
            <th>关联单据</th>
            <th>日期</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {moves.map(m => (
            <tr key={m.id} className={styles.row}>
              <td><span className={styles.moveNo}>{m.moveNo}</span></td>
              <td><span className={styles.typeBadge} data-type={m.type}>{typeLabels[m.type]}</span></td>
              <td>{m.productName}</td>
              <td>{m.warehouseName}</td>
              <td>{m.toWarehouse || '-'}</td>
              <td className={styles.rightCell}>
                <span className={m.quantity < 0 ? styles.negative : ''}>{m.quantity > 0 ? '+' : ''}{m.quantity} {m.unit}</span>
              </td>
              <td className={styles.ref}>{m.reference}</td>
              <td>{m.createdAt}</td>
              <td>
                <div className={styles.actions}>
                  <button className={styles.actionBtn} title="详情" onClick={() => router.push(`/erp/inventory/moves/${m.id}`)}>👁️</button>
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
