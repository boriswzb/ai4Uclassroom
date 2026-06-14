'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import styles from './contacts-table.module.css'

interface Contact {
  id: string
  name: string
  email: string
  phone: string
  isCustomer: boolean
  isSupplier: boolean
  receivable: number
  payable: number
  tags: string[]
  createdAt: string
}

const mockContacts: Contact[] = [
  { id: '1', name: '深圳市腾达科技有限公司', email: 'purchase@tengda.com', phone: '0755-26551234', isCustomer: true, isSupplier: false, receivable: 185000, payable: 0, tags: ['优质客户', '科技'], createdAt: '2024-03-15' },
  { id: '2', name: '广州中商贸易有限公司', email: 'order@zhongshang.com', phone: '020-88888888', isCustomer: true, isSupplier: false, receivable: 320000, payable: 0, tags: ['贸易', '华南'], createdAt: '2024-05-20' },
  { id: '3', name: '北京华联集团', email: 'procurement@hualian.com', phone: '010-66668888', isCustomer: true, isSupplier: false, receivable: 127000, payable: 0, tags: ['集团客户', '华北'], createdAt: '2024-02-10' },
  { id: '4', name: '联想（北京）有限公司', email: 'sales@lenovo.com.cn', phone: '400-100-2000', isCustomer: false, isSupplier: true, receivable: 0, payable: 156000, tags: ['品牌商', 'IT设备'], createdAt: '2024-01-01' },
  { id: '5', name: '得力集团有限公司', email: 'b2b@delicloud.com', phone: '400-100-3000', isCustomer: false, isSupplier: true, receivable: 0, payable: 42000, tags: ['办公用品', '品牌商'], createdAt: '2024-01-05' },
  { id: '6', name: '上海星火电子', email: 'info@xinghuo.com', phone: '021-55001234', isCustomer: true, isSupplier: false, receivable: 89000, payable: 0, tags: ['科技'], createdAt: '2024-06-01' },
  { id: '7', name: '成都万事达物流', email: 'order@wsdwl.com', phone: '028-65001234', isCustomer: false, isSupplier: true, receivable: 0, payable: 28000, tags: ['物流'], createdAt: '2024-04-15' },
  { id: '8', name: '杭州云智科技', email: 'buy@yunzhi.com', phone: '0571-88001234', isCustomer: true, isSupplier: false, receivable: 210000, payable: 0, tags: ['优质客户', '科技', '华东'], createdAt: '2024-07-22' },
]

interface ApiResponse { success: boolean; data: { items: Contact[]; total: number } }

export function ContactsTable() {
  const router = useRouter()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/erp/contacts')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then((d: ApiResponse | null) => setContacts(d?.data?.items ?? mockContacts))
      .finally(() => setLoading(false))
  }, [])

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此联系人？')) return
    try {
      await fetch(`/api/erp/contacts/${id}`, { method: 'DELETE' })
      setContacts(prev => prev.filter(c => c.id !== id))
    } catch {
      alert('删除失败')
    }
  }

  if (loading) return <div className={styles.loading}>加载中...</div>

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.checkboxCell}>
              <input type="checkbox" />
            </th>
            <th>联系人/公司名称</th>
            <th>联系方式</th>
            <th>类型</th>
            <th>标签</th>
            <th className={styles.rightCell}>应收账款</th>
            <th className={styles.rightCell}>应付账款</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map(contact => (
            <tr key={contact.id} className={styles.row}>
              <td className={styles.checkboxCell}>
                <input type="checkbox" />
              </td>
              <td>
                <div className={styles.nameCell}>
                  <span className={styles.name}>{contact.name}</span>
                </div>
              </td>
              <td>
                <div className={styles.contactCell}>
                  <span>{contact.email}</span>
                  <span className={styles.phone}>{contact.phone}</span>
                </div>
              </td>
              <td>
                <div className={styles.typeCell}>
                  {contact.isCustomer && <span className={styles.badge} data-type="customer">客户</span>}
                  {contact.isSupplier && <span className={styles.badge} data-type="supplier">供应商</span>}
                </div>
              </td>
              <td>
                <div className={styles.tagsCell}>
                  {contact.tags.map(tag => (
                    <span key={tag} className={styles.tag}>{tag}</span>
                  ))}
                </div>
              </td>
              <td className={styles.rightCell}>
                <span className={contact.receivable > 0 ? styles.receivable : ''}>
                  {contact.receivable > 0 ? `¥${contact.receivable.toLocaleString()}` : '-'}
                </span>
              </td>
              <td className={styles.rightCell}>
                <span className={contact.payable > 0 ? styles.payable : ''}>
                  {contact.payable > 0 ? `¥${contact.payable.toLocaleString()}` : '-'}
                </span>
              </td>
              <td>
                <div className={styles.actions}>
                  <button className={styles.actionBtn} title="详情" onClick={() => router.push(`/erp/crm/contacts/${contact.id}`)}>🔍</button>
                  <button className={styles.actionBtn} title="编辑" onClick={() => router.push(`/erp/crm/contacts/${contact.id}/edit`)}>✏️</button>
                  <button className={styles.actionBtn} title="删除" onClick={() => handleDelete(contact.id)}>🗑️</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 分页 */}
      <div className={styles.pagination}>
        <span className={styles.paginationInfo}>显示 1-8 条，共 8 条</span>
        <div className={styles.paginationBtns}>
          <button className={styles.pageBtn} disabled>‹</button>
          <button className={`${styles.pageBtn} ${styles.active}`}>1</button>
          <button className={styles.pageBtn} disabled>›</button>
        </div>
      </div>
    </div>
  )
}
