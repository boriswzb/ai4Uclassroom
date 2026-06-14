'use client'

import { useState } from 'react'
import Link from 'next/link'
import styles from './orders-table.module.css'

type OrderStatus = 'DRAFT' | 'CONFIRMED' | 'ORDERED' | 'RECEIVED' | 'CANCELLED'

interface OrderItem {
  productName: string
  quantity: number
  unitPrice: number
}

interface PurchaseOrder {
  id: string
  orderNo: string
  supplierId: string
  supplierName: string
  status: OrderStatus
  items: OrderItem[]
  totalAmount: number
  orderDate: string
  expectedDate: string
  createdAt: string
}

const mockOrders: PurchaseOrder[] = [
  {
    id: '1',
    orderNo: 'PO-2025-000001',
    supplierId: '4',
    supplierName: '联想（北京）有限公司',
    status: 'RECEIVED',
    items: [
      { productName: 'ThinkPad X1 Carbon 笔记本', quantity: 10, unitPrice: 12000 },
      { productName: 'ThinkVision 显示器', quantity: 5, unitPrice: 3500 },
    ],
    totalAmount: 137500,
    orderDate: '2025-01-15',
    expectedDate: '2025-01-25',
    createdAt: '2025-01-15',
  },
  {
    id: '2',
    orderNo: 'PO-2025-000002',
    supplierId: '5',
    supplierName: '得力集团有限公司',
    status: 'ORDERED',
    items: [
      { productName: '得力办公桌椅套装', quantity: 20, unitPrice: 800 },
      { productName: '得力文件柜', quantity: 10, unitPrice: 1200 },
    ],
    totalAmount: 28000,
    orderDate: '2025-02-03',
    expectedDate: '2025-02-13',
    createdAt: '2025-02-03',
  },
  {
    id: '3',
    orderNo: 'PO-2025-000003',
    supplierId: '7',
    supplierName: '成都万事达物流',
    status: 'CONFIRMED',
    items: [
      { productName: '物流服务（季度套餐）', quantity: 1, unitPrice: 15000 },
    ],
    totalAmount: 15000,
    orderDate: '2025-02-20',
    expectedDate: '2025-02-28',
    createdAt: '2025-02-20',
  },
  {
    id: '4',
    orderNo: 'PO-2025-000004',
    supplierId: '4',
    supplierName: '联想（北京）有限公司',
    status: 'DRAFT',
    items: [
      { productName: 'ThinkPad T14s 笔记本', quantity: 15, unitPrice: 8500 },
      { productName: 'Lenovo 电源适配器', quantity: 15, unitPrice: 200 },
    ],
    totalAmount: 130500,
    orderDate: '2025-03-01',
    expectedDate: '2025-03-15',
    createdAt: '2025-03-01',
  },
  {
    id: '5',
    orderNo: 'PO-2025-000005',
    supplierId: '5',
    supplierName: '得力集团有限公司',
    status: 'CANCELLED',
    items: [
      { productName: '得力智能碎纸机', quantity: 5, unitPrice: 600 },
    ],
    totalAmount: 3000,
    orderDate: '2025-01-10',
    expectedDate: '2025-01-20',
    createdAt: '2025-01-10',
  },
  {
    id: '6',
    orderNo: 'PO-2025-000006',
    supplierId: '7',
    supplierName: '成都万事达物流',
    status: 'RECEIVED',
    items: [
      { productName: '货运服务（月度套餐）', quantity: 3, unitPrice: 8000 },
    ],
    totalAmount: 24000,
    orderDate: '2024-12-15',
    expectedDate: '2024-12-25',
    createdAt: '2024-12-15',
  },
  {
    id: '7',
    orderNo: 'PO-2025-000007',
    supplierId: '4',
    supplierName: '联想（北京）有限公司',
    status: 'ORDERED',
    items: [
      { productName: 'ThinkCentre M920t 台式机', quantity: 8, unitPrice: 5500 },
      { productName: 'Lenovo USB-C 扩展坞', quantity: 8, unitPrice: 450 },
    ],
    totalAmount: 47600,
    orderDate: '2025-03-10',
    expectedDate: '2025-03-20',
    createdAt: '2025-03-10',
  },
  {
    id: '8',
    orderNo: 'PO-2025-000008',
    supplierId: '5',
    supplierName: '得力集团有限公司',
    status: 'CONFIRMED',
    items: [
      { productName: '得力白板套装', quantity: 12, unitPrice: 350 },
      { productName: '得力投影幕布', quantity: 6, unitPrice: 550 },
    ],
    totalAmount: 7500,
    orderDate: '2025-03-12',
    expectedDate: '2025-03-22',
    createdAt: '2025-03-12',
  },
]

const statusLabels: Record<OrderStatus, string> = {
  DRAFT: '草稿',
  CONFIRMED: '已确认',
  ORDERED: '已下单',
  RECEIVED: '已收货',
  CANCELLED: '已取消',
}

export function OrdersTable() {
  const [orders] = useState(mockOrders)

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.checkboxCell}>
              <input type="checkbox" />
            </th>
            <th>订单号</th>
            <th>供应商</th>
            <th>状态</th>
            <th className={styles.rightCell}>订单金额</th>
            <th>订单日期</th>
            <th>预计到货</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {orders.map(order => (
            <tr key={order.id} className={styles.row}>
              <td className={styles.checkboxCell}>
                <input type="checkbox" />
              </td>
              <td>
                <Link href={`/erp/purchase/orders/${order.id}`} className={styles.orderNo}>
                  {order.orderNo}
                </Link>
              </td>
              <td>
                <div className={styles.supplierCell}>
                  <span className={styles.supplierName}>{order.supplierName}</span>
                </div>
              </td>
              <td>
                <span className={styles.badge} data-status={order.status}>
                  {statusLabels[order.status]}
                </span>
              </td>
              <td className={styles.rightCell}>
                <span className={styles.amount}>¥{order.totalAmount.toLocaleString()}</span>
              </td>
              <td>{order.orderDate}</td>
              <td>{order.expectedDate}</td>
              <td>
                <div className={styles.actions}>
                  <Link href={`/erp/purchase/orders/${order.id}`} className={styles.actionBtn} title="查看详情">👁️</Link>
                  <Link href={`/erp/purchase/orders/${order.id}/edit`} className={styles.actionBtn} title="编辑">✏️</Link>
                  <button className={styles.actionBtn} title="删除" onClick={async () => {
                    if (confirm(`确定删除订单 ${order.orderNo}？`)) {
                      await fetch(`/erp/api/purchase/orders/${order.id}`, { method: 'DELETE' })
                      window.location.reload()
                    }
                  }}>🗑️</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 分页 */}
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