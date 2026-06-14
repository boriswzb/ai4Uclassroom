'use client'
import { use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import styles from './move-detail.module.css'

interface MoveItem { productName: string; quantity: number }
interface Move {
  id: string; moveNo: string; type: string; fromWarehouse: string; toWarehouse: string
  operator: string; moveDate: string; status: string
  items: MoveItem[]; totalAmount: number; remark: string; createdAt: string
}

const mockMoves: Record<string, Move> = {
  '1': {
    id: '1', moveNo: 'ST-2025-000001', type: 'transfer', fromWarehouse: '深圳仓', toWarehouse: '广州仓',
    operator: '张三', moveDate: '2025-01-18', status: 'completed',
    items: [{ productName: '企业路由器 R2000', quantity: 30 }],
    totalAmount: 24000, remark: '调拨至广州分公司', createdAt: '2025-01-18 08:30:00'
  },
  '2': {
    id: '2', moveNo: 'ST-2025-000002', type: 'stock_in', fromWarehouse: '', toWarehouse: '深圳仓',
    operator: '李四', moveDate: '2025-01-20', status: 'completed',
    items: [{ productName: '商务笔记本 ThinkPad L15', quantity: 20 }],
    totalAmount: 110000, remark: '采购入库', createdAt: '2025-01-20 09:00:00'
  },
}

const typeLabels: Record<string, string> = { transfer: '调拨', adjustment: '库存调整', stock_in: '采购入库', stock_out: '销售出库' }
const typeCls: Record<string, string> = { transfer: 'badgeDraft', adjustment: 'badgePending', stock_in: 'badgeCompleted', stock_out: 'badgeInactive' }
const statusLabels: Record<string, string> = { pending: '待处理', completed: '已完成', cancelled: '已取消' }
const statusCls: Record<string, string> = { pending: 'badgePending', completed: 'badgeCompleted', cancelled: 'badgeCancelled' }

export default function MoveDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const move = mockMoves[id] || { ...mockMoves['1'], id, moveNo: '未知' }

  const handleDelete = async () => {
    if (!confirm('确定要删除此库存记录吗？')) return
    try {
      const res = await fetch(`/erp/api/erp/inventory/moves/${id}`, { method: 'DELETE' })
      if (res.ok) router.push('/erp/inventory/moves')
      else { const d = await res.json().catch(() => ({})); alert(d.message || '删除失败') }
    } catch { alert('网络错误') }
  }

  const typeLabel = typeLabels[move.type] || move.type
  const statusLabel = statusLabels[move.status] || move.status

  return (
    <div>
      <div className={styles.header}>
        <button onClick={() => router.back()} className={styles.backBtn}>← 返回</button>
        <div className={styles.headerInfo}>
          <h1 className={styles.title}>{move.moveNo}</h1>
          <span className={`${styles.badge} ${styles[statusCls[move.status] as keyof typeof styles] as string}`}>{statusLabel}</span>
        </div>
      </div>
      <div className={styles.container}>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>基本信息</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}><span className={styles.infoLabel}>单据编号</span><span className={styles.infoValue}>{move.moveNo}</span></div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>单据类型</span>
              <span className={`${styles.badge} ${styles[typeCls[move.type] as keyof typeof styles] as string}`}>{typeLabel}</span>
            </div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>操作日期</span><span className={styles.infoValue}>{move.moveDate}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>操作人</span><span className={styles.infoValue}>{move.operator}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>创建时间</span><span className={styles.infoValue}>{move.createdAt}</span></div>
          </div>
        </div>
        {move.type === 'transfer' && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>调拨信息</h2>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}><span className={styles.infoLabel}>源仓库</span><span className={styles.infoValue}>{move.fromWarehouse}</span></div>
              <div className={styles.infoItem}><span className={styles.infoLabel}>目标仓库</span><span className={styles.infoValue}>{move.toWarehouse}</span></div>
            </div>
          </div>
        )}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>商品明细</h2>
          <div className={styles.itemsTable}>
            <div className={styles.itemsHeader}>
              <span>商品名称</span><span>数量</span><span>参考金额</span>
            </div>
            {move.items.map((item, i) => (
              <div key={i} className={styles.itemRow}>
                <span className={styles.infoValue}>{item.productName}</span>
                <span className={styles.infoValue}>{item.quantity}</span>
                <span className={styles.infoValue}>¥{(item.quantity * 800).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
        {move.remark && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>备注</h2>
            <p className={styles.remark}>{move.remark}</p>
          </div>
        )}
        <div className={styles.actions}>
          <Link href="/erp/inventory/moves" className={styles.backLink}>← 返回列表</Link>
          <div className={styles.actionBtns}>
            <button className={styles.deleteBtn} onClick={handleDelete}>🗑️ 删除</button>
          </div>
        </div>
      </div>
    </div>
  )
}
