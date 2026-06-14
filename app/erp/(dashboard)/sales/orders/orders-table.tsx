'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import styles from './orders-table.module.css'

type OrderStatus = 'DRAFT' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'

interface OrderItem {
  productName: string
  quantity: number
  unitPrice: number
  discount: number
  taxRate: number
}

interface SalesOrder {
  id: string
  orderNo: string
  contactId: string
  contactName: string
  status: OrderStatus
  items: OrderItem[]
  subtotal: number
  discountAmount: number
  taxAmount: number
  totalAmount: number
  orderDate: string
  deliveryDate: string
  createdAt: string
}

const mockOrders: SalesOrder[] = [
  {
    id: '1', orderNo: 'SO-2025-000001', contactId: '1', contactName: '深圳市腾达科技有限公司',
    status: 'DELIVERED',
    items: [{ productName: '企业路由器 R2000', quantity: 50, unitPrice: 800, discount: 5, taxRate: 13 }],
    subtotal: 38000, discountAmount: 2000, taxAmount: 4680, totalAmount: 40680,
    orderDate: '2025-01-10', deliveryDate: '2025-01-20', createdAt: '2025-01-10',
  },
  {
    id: '2', orderNo: 'SO-2025-000002', contactId: '2', contactName: '广州中商贸易有限公司',
    status: 'SHIPPED',
    items: [
      { productName: '商务笔记本 ThinkPad L15', quantity: 20, unitPrice: 5500, discount: 0, taxRate: 13 },
      { productName: 'USB-C 扩展坞', quantity: 20, unitPrice: 350, discount: 0, taxRate: 13 },
    ],
    subtotal: 117000, discountAmount: 0, taxAmount: 15210, totalAmount: 132210,
    orderDate: '2025-02-05', deliveryDate: '2025-02-15', createdAt: '2025-02-05',
  },
  {
    id: '3', orderNo: 'SO-2025-000003', contactId: '3', contactName: '北京华联集团',
    status: 'CONFIRMED',
    items: [{ productName: '企业交换机 S4500-48P', quantity: 10, unitPrice: 4200, discount: 10, taxRate: 13 }],
    subtotal: 37800, discountAmount: 4200, taxAmount: 4368, totalAmount: 37968,
    orderDate: '2025-02-20', deliveryDate: '2025-03-05', createdAt: '2025-02-20',
  },
  {
    id: '4', orderNo: 'SO-2025-000004', contactId: '6', contactName: '上海星火电子',
    status: 'DRAFT',
    items: [
      { productName: '监控摄像头 IPC-360', quantity: 100, unitPrice: 280, discount: 0, taxRate: 13 },
      { productName: 'NVR录像机', quantity: 5, unitPrice: 3200, discount: 0, taxRate: 13 },
    ],
    subtotal: 44000, discountAmount: 0, taxAmount: 5720, totalAmount: 49720,
    orderDate: '2025-03-01', deliveryDate: '2025-03-10', createdAt: '2025-03-01',
  },
  {
    id: '5', orderNo: 'SO-2025-000005', contactId: '8', contactName: '杭州云智科技',
    status: 'CANCELLED',
    items: [{ productName: '服务器 Rancher R640', quantity: 3, unitPrice: 28000, discount: 15, taxRate: 13 }],
    subtotal: 84000, discountAmount: 12600, taxAmount: 9282, totalAmount: 80682,
    orderDate: '2025-01-15', deliveryDate: '2025-01-25', createdAt: '2025-01-15',
  },
  {
    id: '6', orderNo: 'SO-2025-000006', contactId: '1', contactName: '深圳市腾达科技有限公司',
    status: 'SHIPPED',
    items: [
      { productName: '企业路由器 R3000', quantity: 30, unitPrice: 1600, discount: 5, taxRate: 13 },
      { productName: 'POE交换机 24口', quantity: 15, unitPrice: 2200, discount: 5, taxRate: 13 },
    ],
    subtotal: 78300, discountAmount: 4335, taxAmount: 9615, totalAmount: 83580,
    orderDate: '2025-02-25', deliveryDate: '2025-03-05', createdAt: '2025-02-25',
  },
  {
    id: '7', orderNo: 'SO-2025-000007', contactId: '2', contactName: '广州中商贸易有限公司',
    status: 'CONFIRMED',
    items: [{ productName: '激光打印机 LP-5100', quantity: 25, unitPrice: 1800, discount: 0, taxRate: 13 }],
    subtotal: 45000, discountAmount: 0, taxAmount: 5850, totalAmount: 50850,
    orderDate: '2025-03-05', deliveryDate: '2025-03-12', createdAt: '2025-03-05',
  },
  {
    id: '8', orderNo: 'SO-2025-000008', contactId: '3', contactName: '北京华联集团',
    status: 'DELIVERED',
    items: [
      { productName: '投影仪 EB-990U', quantity: 8, unitPrice: 6500, discount: 8, taxRate: 13 },
      { productName: '电动幕布 150寸', quantity: 8, unitPrice: 1200, discount: 8, taxRate: 13 },
    ],
    subtotal: 61600, discountAmount: 5376, taxAmount: 7309, totalAmount: 63533,
    orderDate: '2025-01-20', deliveryDate: '2025-01-28', createdAt: '2025-01-20',
  },
  {
    id: '9', orderNo: 'SO-2025-000009', contactId: '6', contactName: '上海星火电子',
    status: 'DRAFT',
    items: [{ productName: '无线AP WAP-300', quantity: 60, unitPrice: 450, discount: 0, taxRate: 13 }],
    subtotal: 27000, discountAmount: 0, taxAmount: 3510, totalAmount: 30510,
    orderDate: '2025-03-10', deliveryDate: '2025-03-18', createdAt: '2025-03-10',
  },
  {
    id: '10', orderNo: 'SO-2025-000010', contactId: '8', contactName: '杭州云智科技',
    status: 'CONFIRMED',
    items: [
      { productName: '防火墙 FW-2000', quantity: 2, unitPrice: 35000, discount: 10, taxRate: 13 },
      { productName: 'UPS不间断电源 3KVA', quantity: 4, unitPrice: 8500, discount: 10, taxRate: 13 },
    ],
    subtotal: 113000, discountAmount: 11300, taxAmount: 13221, totalAmount: 114921,
    orderDate: '2025-03-12', deliveryDate: '2025-03-20', createdAt: '2025-03-12',
  },
]

const statusLabels: Record<OrderStatus, string> = {
  DRAFT: '草稿', CONFIRMED: '已确认', SHIPPED: '已发货', DELIVERED: '已收货', CANCELLED: '已取消',
}

export function OrdersTable() {
  const [orders, setOrders] = useState(mockOrders)
  const router = useRouter()

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个订单吗？')) return
    try {
      const res = await fetch(`/erp/api/sales/orders/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setOrders(orders.filter(o => o.id !== id))
      } else {
        const err = await res.json()
        alert(err.message || '删除失败')
      }
    } catch {
      alert('网络错误')
    }
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.checkboxCell}><input type="checkbox" /></th>
            <th>订单号</th>
            <th>客户</th>
            <th>状态</th>
            <th className={styles.rightCell}>订单金额</th>
            <th>订单日期</th>
            <th>交货日期</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {orders.map(order => (
            <tr key={order.id} className={styles.row}>
              <td className={styles.checkboxCell}><input type="checkbox" /></td>
              <td>
                <Link href={`/erp/sales/orders/${order.id}`} className={styles.orderNo}>{order.orderNo}</Link>
              </td>
              <td>
                <div className={styles.contactCell}>
                  <span className={styles.contactName}>{order.contactName}</span>
                </div>
              </td>
              <td>
                <span className={styles.badge} data-status={order.status}>{statusLabels[order.status]}</span>
              </td>
              <td className={styles.rightCell}>
                <span className={styles.amount}>¥{order.totalAmount.toLocaleString()}</span>
              </td>
              <td>{order.orderDate}</td>
              <td>{order.deliveryDate}</td>
              <td>
                <div className={styles.actions}>
                  <Link href={`/erp/sales/orders/${order.id}`} className={styles.actionBtn} title="查看详情">👁️</Link>
                  <Link href={`/erp/sales/orders/${order.id}/edit`} className={styles.actionBtn} title="编辑">✏️</Link>
                  <button className={styles.actionBtn} title="删除" onClick={() => handleDelete(order.id)}>🗑️</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.pagination}>
        <span className={styles.paginationInfo}>显示 1-10 条，共 10 条</span>
        <div className={styles.paginationBtns}>
          <button className={styles.pageBtn} disabled>‹</button>
          <button className={`${styles.pageBtn} ${styles.active}`}>1</button>
          <button className={styles.pageBtn} disabled>›</button>
        </div>
      </div>
    </div>
  )
}
