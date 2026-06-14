'use client'
import { use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import styles from './warehouse-detail.module.css'

interface Warehouse {
  id: string; code: string; name: string; location: string; manager: string
  phone: string; type: string; totalStock: number; capacity: number
  status: string; remark: string; createdAt: string
}

const mockWarehouses: Record<string, Warehouse> = {
  '1': {
    id: '1', code: 'WH-SZ-001', name: '深圳中心仓', location: '广东省深圳市宝安区福永街道兴围社区物流园A区',
    manager: '张建国', phone: '0755-23456789', type: '中心仓',
    totalStock: 3680, capacity: 10000, status: 'active',
    remark: '主仓库，支持同城配送', createdAt: '2023-01-01 00:00:00'
  },
  '2': {
    id: '2', code: 'WH-GZ-001', name: '广州分仓', location: '广东省广州市白云区石井镇物流园B区',
    manager: '陈小红', phone: '020-23456789', type: '区域仓',
    totalStock: 1250, capacity: 5000, status: 'active',
    remark: '', createdAt: '2023-06-01 00:00:00'
  },
}

export default function WarehouseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const wh = mockWarehouses[id] || { ...mockWarehouses['1'], id, name: '未知仓库' }
  const isActive = wh.status === 'active'
  const usageRate = Math.round((wh.totalStock / wh.capacity) * 100)

  const handleDelete = async () => {
    if (!confirm('确定要删除这个仓库吗？')) return
    try {
      const res = await fetch(`/erp/api/erp/inventory/warehouses/${id}`, { method: 'DELETE' })
      if (res.ok) router.push('/erp/inventory/warehouses')
      else { const d = await res.json().catch(() => ({})); alert(d.message || '删除失败') }
    } catch { alert('网络错误') }
  }

  return (
    <div>
      <div className={styles.header}>
        <button onClick={() => router.back()} className={styles.backBtn}>← 返回</button>
        <div className={styles.headerInfo}>
          <h1 className={styles.title}>{wh.name}</h1>
          <span className={`${styles.badge} ${isActive ? styles.badgeActive : styles.badgeInactive}`}>
            {isActive ? '启用' : '停用'}
          </span>
        </div>
      </div>
      <div className={styles.container}>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>基本信息</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}><span className={styles.infoLabel}>仓库编码</span><span className={styles.infoValue}>{wh.code}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>仓库名称</span><span className={styles.infoValue}>{wh.name}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>仓库类型</span><span className={styles.infoValue}>{wh.type}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>负责人</span><span className={styles.infoValue}>{wh.manager}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>联系电话</span><span className={styles.infoValue}>{wh.phone}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>创建时间</span><span className={styles.infoValue}>{wh.createdAt}</span></div>
          </div>
        </div>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>库位信息</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem} style={{ gridColumn: '1 / -1' }}><span className={styles.infoLabel}>仓库地址</span><span className={styles.infoValue}>{wh.location}</span></div>
          </div>
        </div>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>库存概况</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}><span className={styles.infoLabel}>当前库存量</span><span className={styles.infoValue}>{wh.totalStock.toLocaleString()}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>库容上限</span><span className={styles.infoValue}>{wh.capacity.toLocaleString()}</span></div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>库容使用率</span>
              <div className={styles.probabilityBar}>
                <div className={styles.probabilityTrack}><div className={styles.probabilityFill} style={{ width: `${usageRate}%` }} /></div>
                <span className={styles.probabilityText}>{usageRate}%</span>
              </div>
            </div>
          </div>
        </div>
        {wh.remark && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>备注</h2>
            <p className={styles.remark}>{wh.remark}</p>
          </div>
        )}
        <div className={styles.actions}>
          <Link href="/erp/inventory/warehouses" className={styles.backLink}>← 返回列表</Link>
          <div className={styles.actionBtns}>
            <Link href={`/erp/inventory/warehouses/${id}/edit`} className={styles.editBtn}>✏️ 编辑</Link>
            <button className={styles.deleteBtn} onClick={handleDelete}>🗑️ 删除</button>
          </div>
        </div>
      </div>
    </div>
  )
}
