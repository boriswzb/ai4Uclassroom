'use client'
import { use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import styles from './vendor-detail.module.css'

interface Vendor {
  id: string; name: string; contact: string; phone: string; email: string
  city: string; address: string; category: string; bank: string
  account: string; taxRate: string; remark: string; createdAt: string
}

const mockVendors: Record<string, Vendor> = {
  '1': {
    id: '1', name: '深圳市腾达科技有限公司', contact: '李明', phone: '0755-26551234', email: 'sale@tengda.com',
    city: '深圳市', address: '南山区科技园南路88号', category: '电子元器件',
    bank: '中国工商银行深圳南山支行', account: '400012345678901234',
    taxRate: '13', remark: '长期供货商，账期30天', createdAt: '2024-01-10 10:00:00'
  },
  '2': {
    id: '2', name: '广州中商贸易有限公司', contact: '王芳', phone: '020-88888888', email: 'order@zhongshang.com',
    city: '广州市', address: '天河区珠江新城花城大道68号', category: '办公设备',
    bank: '中国建设银行广州珠江新城支行', account: '620012345678901235',
    taxRate: '13', remark: '', createdAt: '2024-02-15 10:00:00'
  },
}

export default function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const vendor = mockVendors[id] || { ...mockVendors['1'], id, name: '未知供应商' }

  const handleDelete = async () => {
    if (!confirm('确定要删除此供应商吗？')) return
    try {
      const res = await fetch(`/erp/api/erp/purchase/vendors/${id}`, { method: 'DELETE' })
      if (res.ok) router.push('/erp/purchase/vendors')
      else { const d = await res.json().catch(() => ({})); alert(d.message || '删除失败') }
    } catch { alert('网络错误') }
  }

  return (
    <div>
      <div className={styles.header}>
        <button onClick={() => router.back()} className={styles.backBtn}>← 返回</button>
        <div className={styles.headerInfo}>
          <h1 className={styles.title}>{vendor.name}</h1>
        </div>
      </div>
      <div className={styles.container}>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>基本信息</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}><span className={styles.infoLabel}>供应商名称</span><span className={styles.infoValue}>{vendor.name}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>联系人</span><span className={styles.infoValue}>{vendor.contact}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>联系电话</span><span className={styles.infoValue}>{vendor.phone}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>电子邮箱</span><span className={styles.infoValue}>{vendor.email}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>城市</span><span className={styles.infoValue}>{vendor.city}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>所属行业</span><span className={styles.infoValue}>{vendor.category}</span></div>
          </div>
        </div>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>地址信息</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem} style={{ gridColumn: '1 / -1' }}><span className={styles.infoLabel}>详细地址</span><span className={styles.infoValue}>{vendor.address}</span></div>
          </div>
        </div>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>财务信息</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}><span className={styles.infoLabel}>开户银行</span><span className={styles.infoValue}>{vendor.bank}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>银行账号</span><span className={styles.infoValue}>{vendor.account}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>默认税率</span><span className={styles.infoValue}>{vendor.taxRate}%</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>创建时间</span><span className={styles.infoValue}>{vendor.createdAt}</span></div>
          </div>
        </div>
        {vendor.remark && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>备注</h2>
            <p className={styles.remark}>{vendor.remark}</p>
          </div>
        )}
        <div className={styles.actions}>
          <Link href="/erp/purchase/vendors" className={styles.backLink}>← 返回列表</Link>
          <div className={styles.actionBtns}>
            <Link href={`/erp/purchase/vendors/${id}/edit`} className={styles.editBtn}>✏️ 编辑</Link>
            <button className={styles.deleteBtn} onClick={handleDelete}>🗑️ 删除</button>
          </div>
        </div>
      </div>
    </div>
  )
}
