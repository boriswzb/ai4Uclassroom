'use client'
import { use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import styles from './contact-detail.module.css'

interface Contact {
  id: string; name: string; email: string; phone: string; mobile: string
  position: string; company: string; isCustomer: boolean; isSupplier: boolean
  tags: string[]; province: string; city: string; street: string; remark: string
  createdAt: string
}

const mockContacts: Record<string, Contact> = {
  '1': {
    id: '1', name: '李明', email: 'liming@tengda.com', phone: '0755-26551234', mobile: '13800138001',
    position: '采购总监', company: '深圳市腾达科技有限公司', isCustomer: true, isSupplier: false,
    tags: ['优质客户', '科技', '华南'], province: '广东省', city: '深圳市', street: '南山区科技园南路88号',
    remark: '长期合作客户，信用良好，月结30天', createdAt: '2024-01-15 10:00:00'
  },
  '2': {
    id: '2', name: '王芳', email: 'wangfang@zhongshang.com', phone: '020-88888888', mobile: '13900139002',
    position: '销售经理', company: '广州中商贸易有限公司', isCustomer: true, isSupplier: false,
    tags: ['品牌商', '集团客户'], province: '广东省', city: '广州市', street: '天河区珠江新城花城大道68号',
    remark: '', createdAt: '2024-03-20 14:30:00'
  },
}

export default function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const contact = mockContacts[id] || { ...mockContacts['1'], id, name: '未知联系人' }

  const handleDelete = async () => {
    if (!confirm('确定要删除这个联系人吗？')) return
    try {
      const res = await fetch(`/erp/api/contacts/${id}`, { method: 'DELETE' })
      if (res.ok) router.push('/erp/crm/contacts')
      else { const d = await res.json().catch(() => ({})); alert(d.message || '删除失败') }
    } catch { alert('网络错误') }
  }

  const typeBadge = contact.isCustomer && contact.isSupplier
    ? { cls: styles.badgeBoth, label: '客户/供应商' }
    : contact.isSupplier ? { cls: styles.badgeSupplier, label: '供应商' }
    : { cls: styles.badgeCustomer, label: '客户' }

  return (
    <div>
      <div className={styles.header}>
        <button onClick={() => router.back()} className={styles.backBtn}>← 返回</button>
        <div className={styles.headerInfo}>
          <h1 className={styles.title}>{contact.name}</h1>
          <span className={`${styles.badge} ${typeBadge.cls}`}>{typeBadge.label}</span>
        </div>
      </div>
      <div className={styles.container}>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>基本信息</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}><span className={styles.infoLabel}>姓名</span><span className={styles.infoValue}>{contact.name}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>职位</span><span className={styles.infoValue}>{contact.position}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>公司</span><span className={styles.infoValue}>{contact.company}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>邮箱</span><span className={styles.infoValue}>{contact.email}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>电话</span><span className={styles.infoValue}>{contact.phone}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>手机</span><span className={styles.infoValue}>{contact.mobile}</span></div>
          </div>
        </div>
        {contact.tags.length > 0 && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>标签</h2>
            <div className={styles.tagGrid}>
              {contact.tags.map(t => <span key={t} className={styles.tag}>{t}</span>)}
            </div>
          </div>
        )}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>地址信息</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}><span className={styles.infoLabel}>省份</span><span className={styles.infoValue}>{contact.province}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>城市</span><span className={styles.infoValue}>{contact.city}</span></div>
            <div className={styles.infoItem} style={{ gridColumn: '1 / -1' }}><span className={styles.infoLabel}>详细地址</span><span className={styles.infoValue}>{contact.street}</span></div>
          </div>
        </div>
        {contact.remark && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>备注</h2>
            <p className={styles.remark}>{contact.remark}</p>
          </div>
        )}
        <div className={styles.actions}>
          <Link href="/erp/crm/contacts" className={styles.backLink}>← 返回列表</Link>
          <div className={styles.actionBtns}>
            <Link href={`/erp/crm/contacts/${id}/edit`} className={styles.editBtn}>✏️ 编辑</Link>
            <button className={styles.deleteBtn} onClick={handleDelete}>🗑️ 删除</button>
          </div>
        </div>
      </div>
    </div>
  )
}
