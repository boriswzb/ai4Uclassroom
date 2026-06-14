'use client'
import { use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import styles from './company-detail.module.css'

interface Company {
  id: string; name: string; contact: string; phone: string; email: string
  city: string; province: string; type: string; employees: number
  website: string; industry: string; revenue: string; tags: string[]
  remark: string; createdAt: string
}

const mockCompanies: Record<string, Company> = {
  '1': {
    id: '1', name: '深圳市腾达科技有限公司', contact: '李明', phone: '0755-26551234', email: 'info@tengda.com',
    city: '深圳市', province: '广东省', type: 'customer', employees: 200, website: 'www.tengda.com',
    industry: '电子制造', revenue: '5000万', tags: ['优质客户', '科技', '华南'],
    remark: '长期合作客户，信用良好', createdAt: '2024-01-15 10:00:00'
  },
  '2': {
    id: '2', name: '广州中商贸易有限公司', contact: '王芳', phone: '020-88888888', email: 'order@zhongshang.com',
    city: '广州市', province: '广东省', type: 'customer', employees: 80, website: 'www.zhongshang.com',
    industry: '贸易', revenue: '3000万', tags: ['品牌商', '集团客户'],
    remark: '', createdAt: '2024-03-20 14:30:00'
  },
}

const typeBadge: Record<string, { cls: string; label: string }> = {
  customer: { cls: 'badgeCustomer', label: '客户' },
  supplier: { cls: 'badgeSupplier', label: '供应商' },
  both: { cls: 'badgeBoth', label: '客户/供应商' },
}

export default function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const company = mockCompanies[id] || { ...mockCompanies['1'], id, name: '未知公司' }
  const tb = typeBadge[company.type] || typeBadge.customer

  const handleDelete = async () => {
    if (!confirm('确定要删除这家公司吗？')) return
    try {
      const res = await fetch(`/erp/api/erp/companies/${id}`, { method: 'DELETE' })
      if (res.ok) router.push('/erp/crm/companies')
      else { const d = await res.json().catch(() => ({})); alert(d.message || '删除失败') }
    } catch { alert('网络错误') }
  }

  return (
    <div>
      <div className={styles.header}>
        <button onClick={() => router.back()} className={styles.backBtn}>← 返回</button>
        <div className={styles.headerInfo}>
          <h1 className={styles.title}>{company.name}</h1>
          <span className={`${styles.badge} ${styles[tb.cls as keyof typeof styles] as string}`}>{tb.label}</span>
        </div>
      </div>
      <div className={styles.container}>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>基本信息</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}><span className={styles.infoLabel}>公司名称</span><span className={styles.infoValue}>{company.name}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>联系人</span><span className={styles.infoValue}>{company.contact}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>联系电话</span><span className={styles.infoValue}>{company.phone}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>电子邮箱</span><span className={styles.infoValue}>{company.email}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>所属行业</span><span className={styles.infoValue}>{company.industry}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>员工人数</span><span className={styles.infoValue}>{company.employees}人</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>年营业额</span><span className={styles.infoValue}>{company.revenue}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>官网</span><span className={styles.infoValue}>{company.website}</span></div>
          </div>
        </div>
        {company.tags.length > 0 && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>标签</h2>
            <div className={styles.tagGrid}>
              {company.tags.map(t => <span key={t} className={styles.tag}>{t}</span>)}
            </div>
          </div>
        )}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>地址信息</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}><span className={styles.infoLabel}>省份</span><span className={styles.infoValue}>{company.province}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>城市</span><span className={styles.infoValue}>{company.city}</span></div>
          </div>
        </div>
        {company.remark && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>备注</h2>
            <p className={styles.remark}>{company.remark}</p>
          </div>
        )}
        <div className={styles.actions}>
          <Link href="/erp/crm/companies" className={styles.backLink}>← 返回列表</Link>
          <div className={styles.actionBtns}>
            <Link href={`/erp/crm/companies/${id}/edit`} className={styles.editBtn}>✏️ 编辑</Link>
            <button className={styles.deleteBtn} onClick={handleDelete}>🗑️ 删除</button>
          </div>
        </div>
      </div>
    </div>
  )
}
