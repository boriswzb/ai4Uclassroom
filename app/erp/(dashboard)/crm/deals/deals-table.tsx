'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import styles from './deals-table.module.css'

interface Deal {
  id: string
  name: string
  amount: number
  stage: string
  probability: number
  source: string
  expectedClose: string
  createdAt: string
  company: { id: string; name: string } | null
  contact: { id: string; name: string } | null
}

const mockDeals: Deal[] = [
  { id: '1', name: '企业路由器采购项目', amount: 280000, stage: '商务谈判', probability: 60, source: '电话营销', expectedClose: '2024-12-31', createdAt: '2024-08-01', company: { id: '1', name: '深圳市腾达科技有限公司' }, contact: { id: '1', name: '张总' } },
  { id: '2', name: '办公设备年度采购', amount: 156000, stage: '方案报价', probability: 40, source: '展会', expectedClose: '2024-11-30', createdAt: '2024-07-15', company: { id: '3', name: '北京华联集团' }, contact: { id: '3', name: '王总' } },
  { id: '3', name: '交换机设备采购', amount: 89000, stage: '合同签订', probability: 90, source: '客户推荐', expectedClose: '2024-10-15', createdAt: '2024-06-20', company: { id: '2', name: '广州中商贸易有限公司' }, contact: { id: '2', name: '李总' } },
  { id: '4', name: '台式机采购项目', amount: 340000, stage: '需求确认', probability: 20, source: '官网咨询', expectedClose: '2025-01-15', createdAt: '2024-09-01', company: { id: '1', name: '深圳市腾达科技有限公司' }, contact: null },
  { id: '5', name: '打印机采购订单', amount: 45000, stage: '商务谈判', probability: 70, source: '电话营销', expectedClose: '2024-11-20', createdAt: '2024-08-10', company: { id: '2', name: '广州中商贸易有限公司' }, contact: { id: '2', name: '李总' } },
]

interface ApiResponse { success: boolean; data: { items: Deal[]; total: number } }

const stageOrder = ['需求确认', '方案报价', '商务谈判', '合同签订']

function getStageClass(stage: string) {
  const map: Record<string, string> = {
    '需求确认': styles.stage_qualification,
    '方案报价': styles.stage_proposal,
    '商务谈判': styles.stage_negotiation,
    '合同签订': styles.stage_contract,
  }
  return map[stage] || styles.stage_qualification
}

export function DealsTable() {
  const router = useRouter()
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [stageFilter, setStageFilter] = useState('')

  useEffect(() => {
    fetch('/api/erp/deals')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then((d: ApiResponse | null) => setDeals(d?.data?.items ?? mockDeals))
      .finally(() => setLoading(false))
  }, [])

  const filteredDeals = stageFilter
    ? deals.filter(d => d.stage === stageFilter)
    : deals

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此商机？')) return
    try {
      await fetch(`/api/erp/deals/${id}`, { method: 'DELETE' })
      setDeals(prev => prev.filter(d => d.id !== id))
    } catch {
      alert('删除失败')
    }
  }

  const totalAmount = filteredDeals.reduce((sum, d) => sum + d.amount, 0)
  const weightedAmount = filteredDeals.reduce((sum, d) => sum + d.amount * (d.probability / 100), 0)

  if (loading) return <div className={styles.loading}>加载中...</div>

  return (
    <div className={styles.tableWrapper}>
      <div className={styles.tableHeader}>
        <input type="search" placeholder="搜索商机名称..." className={styles.searchInput} />
        <select className={styles.filterSelect} value={stageFilter} onChange={e => setStageFilter(e.target.value)}>
          <option value="">全部阶段</option>
          {stageOrder.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 20, fontSize: 12, color: '#94a3b8' }}>
          <span>商机总额: <strong style={{ color: '#34d399' }}>¥{totalAmount.toLocaleString()}</strong></span>
          <span>加权金额: <strong style={{ color: '#60a5fa' }}>¥{weightedAmount.toLocaleString()}</strong></span>
        </div>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>商机名称</th>
            <th>金额</th>
            <th>阶段</th>
            <th>概率</th>
            <th>关联公司</th>
            <th>来源</th>
            <th>预计成交</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {filteredDeals.map(deal => (
            <tr key={deal.id} className={styles.row}>
              <td><span className={styles.dealName}>{deal.name}</span></td>
              <td><span className={styles.dealAmount}>¥{deal.amount.toLocaleString()}</span></td>
              <td>
                <span className={`${styles.stageBadge} ${getStageClass(deal.stage)}`}>
                  <span className={styles.stageDot} />
                  {deal.stage}
                </span>
              </td>
              <td><span className={styles.probability}>{deal.probability}%</span></td>
              <td>
                {deal.company ? (
                  <div className={styles.companyCell}>
                    <span className={styles.companyName}>{deal.company.name}</span>
                    {deal.contact && <span className={styles.companySub}>{deal.contact.name}</span>}
                  </div>
                ) : '-'}
              </td>
              <td><span className={styles.source}>{deal.source || '-'}</span></td>
              <td><span className={styles.expectedClose}>{deal.expectedClose || '-'}</span></td>
              <td>
                <div className={styles.actions}>
                  <button className={styles.actionBtn} title="详情" onClick={() => router.push(`/erp/crm/deals/${deal.id}`)}>🔍</button>
                  <button className={styles.actionBtn} title="编辑" onClick={() => router.push(`/erp/crm/deals/${deal.id}/edit`)}>✏️</button>
                  <button className={styles.actionBtn} title="删除" onClick={() => handleDelete(deal.id)}>🗑️</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {filteredDeals.length === 0 && (
        <div className={styles.emptyState}>暂无商机数据</div>
      )}

      <div className={styles.pagination}>
        <span className={styles.paginationInfo}>显示 {filteredDeals.length} 条，共 {filteredDeals.length} 条</span>
        <div className={styles.paginationBtns}>
          <button className={styles.pageBtn} disabled>‹</button>
          <button className={`${styles.pageBtn} ${styles.active}`}>1</button>
          <button className={styles.pageBtn} disabled>›</button>
        </div>
      </div>
    </div>
  )
}