'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import styles from './order-detail.module.css'

type OrderStatus = 'DRAFT' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'

interface OrderItem { productName: string; quantity: number; unitPrice: number; discount: number; taxRate: number }
interface OrderDetail { id: string; orderNo: string; contactId: string; contactName: string; contactPhone: string; contactEmail: string; status: OrderStatus; items: OrderItem[]; subtotal: number; discountAmount: number; taxAmount: number; totalAmount: number; orderDate: string; deliveryDate: string; remark: string; createdAt: string; updatedAt: string }

const mockOrder: Record<string, OrderDetail> = {
  '1': { id: '1', orderNo: 'SO-2025-000001', contactId: '1', contactName: '深圳市腾达科技有限公司', contactPhone: '0755-26551234', contactEmail: 'purchase@tengda.com',
    status: 'DELIVERED', items: [{ productName: '企业路由器 R2000', quantity: 50, unitPrice: 800, discount: 5, taxRate: 13 }],
    subtotal: 38000, discountAmount: 2000, taxAmount: 4680, totalAmount: 40680,
    orderDate: '2025-01-10', deliveryDate: '2025-01-20', remark: '客户要求送货上门，提供安装服务', createdAt: '2025-01-10 10:00:00', updatedAt: '2025-01-22 14:30:00' },
  '2': { id: '2', orderNo: 'SO-2025-000002', contactId: '2', contactName: '广州中商贸易有限公司', contactPhone: '020-88888888', contactEmail: 'order@zhongshang.com',
    status: 'SHIPPED', items: [
      { productName: '商务笔记本 ThinkPad L15', quantity: 20, unitPrice: 5500, discount: 0, taxRate: 13 },
      { productName: 'USB-C 扩展坞', quantity: 20, unitPrice: 350, discount: 0, taxRate: 13 },
    ],
    subtotal: 117000, discountAmount: 0, taxAmount: 15210, totalAmount: 132210,
    orderDate: '2025-02-05', deliveryDate: '2025-02-15', remark: '', createdAt: '2025-02-05 09:15:00', updatedAt: '2025-02-12 16:00:00' },
}

const statusLabels: Record<OrderStatus, string> = {
  DRAFT: '草稿', CONFIRMED: '已确认', SHIPPED: '已发货', DELIVERED: '已收货', CANCELLED: '已取消',
}

export default function SalesOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const order = mockOrder[id] || { ...mockOrder['1'], id, orderNo: `SO-2025-${id.padStart(6, '0')}`, contactName: '示例客户', status: 'DRAFT' }

  const subtotal = order.items.reduce((sum: number, item: OrderItem) => sum + item.quantity * item.unitPrice * (1 - item.discount / 100), 0)

  const handleEdit = () => {
    router.push(`/erp/sales/orders/${id}/edit`)
  }

  const handleDelete = async () => {
    if (!confirm('确定要删除这个订单吗？')) return
    try {
      const res = await fetch(`/erp/api/sales/orders/${id}`, { method: 'DELETE' })
      if (res.ok) {
        router.push('/erp/sales/orders')
      } else {
        const err = await res.json()
        alert(err.message || '删除失败')
      }
    } catch {
      alert('网络错误')
    }
  }

  return (
    <div>
      <div className={styles.header}>
        <button onClick={() => router.back()} className={styles.backBtn}>← 返回</button>
        <div className={styles.headerInfo}>
          <h1 className={styles.title}>{order.orderNo}</h1>
          <span className={styles.badge} data-status={order.status}>{statusLabels[order.status]}</span>
        </div>
      </div>

      <div className={styles.container}>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>基本信息</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}><span className={styles.infoLabel}>客户</span><span className={styles.infoValue}>{order.contactName}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>联系电话</span><span className={styles.infoValue}>{order.contactPhone}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>电子邮箱</span><span className={styles.infoValue}>{order.contactEmail}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>订单日期</span><span className={styles.infoValue}>{order.orderDate}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>交货日期</span><span className={styles.infoValue}>{order.deliveryDate}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>创建时间</span><span className={styles.infoValue}>{order.createdAt}</span></div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>商品明细</h2>
          <div className={styles.itemsTable}>
            <div className={styles.itemsHeader}>
              <span className={styles.colProduct}>商品名称</span>
              <span className={styles.colQty}>数量</span>
              <span className={styles.colPrice}>单价</span>
              <span className={styles.colDiscount}>折扣</span>
              <span className={styles.colSubtotal}>小计</span>
            </div>
            {order.items.map((item: OrderItem, index: number) => (
              <div key={index} className={styles.itemRow}>
                <span className={styles.colProduct}>{item.productName}</span>
                <span className={styles.colQty}>{item.quantity}</span>
                <span className={styles.colPrice}>¥{item.unitPrice.toLocaleString()}</span>
                <span className={styles.colDiscount}>{item.discount > 0 ? `${item.discount}%` : '-'}</span>
                <span className={styles.colSubtotal}>¥{(item.quantity * item.unitPrice * (1 - item.discount / 100)).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>金额汇总</h2>
          <div className={styles.amountSummary}>
            <div className={styles.amountRow}><span>商品金额：</span><span>¥{subtotal.toLocaleString()}</span></div>
            {order.discountAmount > 0 && <div className={styles.amountRow}><span>折扣金额：</span><span className={styles.discount}>-¥{order.discountAmount.toLocaleString()}</span></div>}
            <div className={styles.amountRow}><span>税额（13%）：</span><span>¥{order.taxAmount.toLocaleString()}</span></div>
            <div className={`${styles.amountRow} ${styles.totalRow}`}><span>订单总额：</span><span className={styles.totalAmount}>¥{order.totalAmount.toLocaleString()}</span></div>
          </div>
        </div>

        {order.remark && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>备注</h2>
            <p className={styles.remark}>{order.remark}</p>
          </div>
        )}

        <div className={styles.actions}>
          <Link href="/erp/sales/orders" className={styles.backLink}>返回列表</Link>
          <div className={styles.actionBtns}>
            <button className={styles.editBtn} onClick={handleEdit}>✏️ 编辑</button>
            <button className={styles.deleteBtn} onClick={handleDelete}>🗑️ 删除</button>
          </div>
        </div>
      </div>
    </div>
  )
}
