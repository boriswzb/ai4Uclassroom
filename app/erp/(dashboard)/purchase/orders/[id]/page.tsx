'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import styles from './order-detail.module.css'

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
  supplierPhone: string
  supplierEmail: string
  status: OrderStatus
  items: OrderItem[]
  totalAmount: number
  orderDate: string
  expectedDate: string
  remark: string
  createdAt: string
  updatedAt: string
}

const mockOrder: PurchaseOrder = {
  id: '1',
  orderNo: 'PO-2025-000001',
  supplierId: '4',
  supplierName: '联想（北京）有限公司',
  supplierPhone: '400-100-2000',
  supplierEmail: 'sales@lenovo.com.cn',
  status: 'RECEIVED',
  items: [
    { productName: 'ThinkPad X1 Carbon 笔记本', quantity: 10, unitPrice: 12000 },
    { productName: 'ThinkVision 显示器', quantity: 5, unitPrice: 3500 },
  ],
  totalAmount: 137500,
  orderDate: '2025-01-15',
  expectedDate: '2025-01-25',
  remark: '需确保正品行货，有质量问题请及时联系',
  createdAt: '2025-01-15 09:30:00',
  updatedAt: '2025-01-20 14:20:00',
}

const statusLabels: Record<OrderStatus, string> = {
  DRAFT: '草稿',
  CONFIRMED: '已确认',
  ORDERED: '已下单',
  RECEIVED: '已收货',
  CANCELLED: '已取消',
}

export default function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  
  // Mock: 在实际应用中通过 ID 获取数据
  const order = mockOrder.id === id ? mockOrder : { ...mockOrder, id, orderNo: `PO-2025-${id.padStart(6, '0')}` }

  const subtotal = order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const tax = Math.round(subtotal * 0.13)
  const totalAmount = subtotal + tax

  return (
    <div>
      <div className={styles.header}>
        <button onClick={() => router.back()} className={styles.backBtn}>← 返回</button>
        <div className={styles.headerInfo}>
          <h1 className={styles.title}>{order.orderNo}</h1>
          <span className={styles.badge} data-status={order.status}>
            {statusLabels[order.status]}
          </span>
        </div>
      </div>

      <div className={styles.container}>
        {/* 基本信息 */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>基本信息</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>供应商</span>
              <span className={styles.infoValue}>{order.supplierName}</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>联系电话</span>
              <span className={styles.infoValue}>{order.supplierPhone}</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>电子邮箱</span>
              <span className={styles.infoValue}>{order.supplierEmail}</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>订单日期</span>
              <span className={styles.infoValue}>{order.orderDate}</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>预计到货</span>
              <span className={styles.infoValue}>{order.expectedDate}</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>创建时间</span>
              <span className={styles.infoValue}>{order.createdAt}</span>
            </div>
          </div>
        </div>

        {/* 商品明细 */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>商品明细</h2>
          <div className={styles.itemsTable}>
            <div className={styles.itemsHeader}>
              <span className={styles.colProduct}>商品名称</span>
              <span className={styles.colQty}>数量</span>
              <span className={styles.colPrice}>单价</span>
              <span className={styles.colSubtotal}>小计</span>
            </div>
            {order.items.map((item, index) => (
              <div key={index} className={styles.itemRow}>
                <span className={styles.colProduct}>{item.productName}</span>
                <span className={styles.colQty}>{item.quantity}</span>
                <span className={styles.colPrice}>¥{item.unitPrice.toLocaleString()}</span>
                <span className={styles.colSubtotal}>¥{(item.quantity * item.unitPrice).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 金额汇总 */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>金额汇总</h2>
          <div className={styles.amountSummary}>
            <div className={styles.amountRow}>
              <span>商品金额：</span>
              <span>¥{subtotal.toLocaleString()}</span>
            </div>
            <div className={styles.amountRow}>
              <span>税率（13%）：</span>
              <span>¥{tax.toLocaleString()}</span>
            </div>
            <div className={`${styles.amountRow} ${styles.totalRow}`}>
              <span>订单总额：</span>
              <span className={styles.totalAmount}>¥{totalAmount.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* 备注 */}
        {order.remark && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>备注</h2>
            <p className={styles.remark}>{order.remark}</p>
          </div>
        )}

        {/* 操作按钮 */}
        <div className={styles.actions}>
          <Link href="/erp/purchase/orders" className={styles.backLink}>返回列表</Link>
          <div className={styles.actionBtns}>
            <Link href={`/erp/purchase/orders/${id}/edit`} className={styles.editBtn}>✏️ 编辑</Link>
            <button className={styles.deleteBtn} onClick={async () => {
              if (confirm(`确定删除此订单？`)) {
                await fetch(`/erp/api/purchase/orders/${id}`, { method: 'DELETE' })
                router.push('/erp/purchase/orders')
              }
            }}>🗑️ 删除</button>
          </div>
        </div>
      </div>
    </div>
  )
}