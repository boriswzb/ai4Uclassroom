'use client'
import { use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import styles from './deal-detail.module.css'

interface Deal {
  id: string; title: string; contactName: string; contactPhone: string; contactEmail: string
  stage: string; expectedAmount: number; probability: number
  expectedCloseDate: string; description: string; remark: string
  createdAt: string; updatedAt: string
}

const mockDeals: Record<string, Deal> = {
  '1': {
    id: '1', title: '腾达科技采购项目', contactName: '李明', contactPhone: '0755-26551234', contactEmail: 'purchase@tengda.com',
    stage: 'negotiation', expectedAmount: 500000, probability: 60,
    expectedCloseDate: '2025-03-15', description: '计划采购企业路由器100台、交换机20台',
    remark: '', createdAt: '2025-01-10 10:00:00', updatedAt: '2025-02-20 14:30:00'
  },
  '2': {
    id: '2', title: '中商贸易办公设备采购', contactName: '王芳', contactPhone: '020-88888888', contactEmail: 'order@zhongshang.com',
    stage: 'proposal', expectedAmount: 280000, probability: 40,
    expectedCloseDate: '2025-04-30', description: '采购联想笔记本50台、打印机10台',
    remark: '客户要求先发方案', createdAt: '2025-02-01 09:00:00', updatedAt: '2025-02-25 11:00:00'
  },
}

const stageLabels: Record<string, string> = {
  qualification: '需求确认', proposal: '方案报价', negotiation: '商务谈判', contract: '合同签订'
}
const stageColors: Record<string, string> = {
  qualification: 'badgeDraft', proposal: 'badgeBoth', negotiation: 'badgePending', contract: 'badgeCompleted'
}

export default function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const deal = mockDeals[id] || { ...mockDeals['1'], id, title: '未知商机' }
  const stageLabel = stageLabels[deal.stage] || deal.stage
  const stageCls = stageColors[deal.stage] || 'badgeDraft'

  const handleDelete = async () => {
    if (!confirm('确定要删除这个商机吗？')) return
    try {
      const res = await fetch(`/erp/api/erp/deals/${id}`, { method: 'DELETE' })
      if (res.ok) router.push('/erp/crm/deals')
      else { const d = await res.json().catch(() => ({})); alert(d.message || '删除失败') }
    } catch { alert('网络错误') }
  }

  return (
    <div>
      <div className={styles.header}>
        <button onClick={() => router.back()} className={styles.backBtn}>← 返回</button>
        <div className={styles.headerInfo}>
          <h1 className={styles.title}>{deal.title}</h1>
          <span className={`${styles.badge} ${styles[stageCls as keyof typeof styles] as string}`}>{stageLabel}</span>
        </div>
      </div>
      <div className={styles.container}>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>基本信息</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}><span className={styles.infoLabel}>商机名称</span><span className={styles.infoValue}>{deal.title}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>商机阶段</span><span className={styles.infoValue}>{stageLabel}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>预计成交金额</span><span className={styles.infoValue}>¥{deal.expectedAmount.toLocaleString()}</span></div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>赢单概率</span>
              <div className={styles.probabilityBar}>
                <div className={styles.probabilityTrack}><div className={styles.probabilityFill} style={{ width: `${deal.probability}%` }} /></div>
                <span className={styles.probabilityText}>{deal.probability}%</span>
              </div>
            </div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>预计成交日期</span><span className={styles.infoValue}>{deal.expectedCloseDate}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>创建时间</span><span className={styles.infoValue}>{deal.createdAt}</span></div>
          </div>
        </div>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>联系人信息</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}><span className={styles.infoLabel}>联系人</span><span className={styles.infoValue}>{deal.contactName}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>联系电话</span><span className={styles.infoValue}>{deal.contactPhone}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>电子邮箱</span><span className={styles.infoValue}>{deal.contactEmail}</span></div>
          </div>
        </div>
        {deal.description && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>商机详情</h2>
            <p className={styles.remark}>{deal.description}</p>
          </div>
        )}
        {deal.remark && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>备注</h2>
            <p className={styles.remark}>{deal.remark}</p>
          </div>
        )}
        <div className={styles.actions}>
          <Link href="/erp/crm/deals" className={styles.backLink}>← 返回列表</Link>
          <div className={styles.actionBtns}>
            <Link href={`/erp/crm/deals/${id}/edit`} className={styles.editBtn}>✏️ 编辑</Link>
            <button className={styles.deleteBtn} onClick={handleDelete}>🗑️ 删除</button>
          </div>
        </div>
      </div>
    </div>
  )
}
