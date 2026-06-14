'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import styles from './companies-table.module.css'

interface Company {
  id: string
  name: string
  industry: string
  contact: string
  email: string
  phone: string
  city: string
  type: string
  revenue: number
  employees: number
  tags: string[]
  createdAt: string
  _count?: { contacts: number; deals: number }
}

const mockCompanies: Company[] = [
  { id: '1', name: '深圳市腾达科技有限公司', industry: '电子科技', contact: '张总', email: 'purchase@tengda.com', phone: '0755-26551234', city: '深圳', type: 'customer', revenue: 5000000, employees: 200, tags: ['优质客户', '科技'], createdAt: '2024-03-15', _count: { contacts: 1, deals: 2 } },
  { id: '2', name: '广州中商贸易有限公司', industry: '贸易', contact: '李总', email: 'order@zhongshang.com', phone: '020-88888888', city: '广州', type: 'customer', revenue: 3000000, employees: 80, tags: ['贸易', '华南'], createdAt: '2024-05-20', _count: { contacts: 1, deals: 1 } },
  { id: '3', name: '北京华联集团', industry: '零售', contact: '王总', email: 'procurement@hualian.com', phone: '010-66668888', city: '北京', type: 'customer', revenue: 20000000, employees: 500, tags: ['集团客户', '华北'], createdAt: '2024-02-10', _count: { contacts: 1, deals: 3 } },
  { id: '4', name: '联想（北京）有限公司', industry: 'IT设备', contact: '刘总', email: 'sales@lenovo.com.cn', phone: '400-100-2000', city: '北京', type: 'supplier', revenue: 100000000, employees: 5000, tags: ['品牌商', 'IT设备'], createdAt: '2024-01-01', _count: { contacts: 1, deals: 2 } },
  { id: '5', name: '得力集团有限公司', industry: '办公用品', contact: '陈总', email: 'b2b@delicloud.com', phone: '400-100-3000', city: '宁波', type: 'supplier', revenue: 50000000, employees: 2000, tags: ['办公用品', '品牌商'], createdAt: '2024-01-05', _count: { contacts: 1, deals: 1 } },
]

interface ApiResponse { success: boolean; data: { items: Company[]; total: number } }

export function CompaniesTable() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    fetchCompanies()
  }, [])

  const fetchCompanies = async (searchQuery?: string) => {
    setLoading(true)
    try {
      const url = searchQuery
        ? `/api/erp/companies?search=${encodeURIComponent(searchQuery)}`
        : '/api/erp/companies'
      const res = await fetch(url)
      const data: ApiResponse = await res.json()
      if (data.success) {
        setCompanies(data.data.items)
        setTotal(data.data.total)
      } else {
        setCompanies(mockCompanies)
        setTotal(mockCompanies.length)
      }
    } catch {
      setCompanies(mockCompanies)
      setTotal(mockCompanies.length)
    } finally {
      setLoading(false)
    }
  }

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearch(value)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => fetchCompanies(value), 300)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此公司？')) return
    try {
      await fetch(`/api/erp/companies/${id}`, { method: 'DELETE' })
      setCompanies(prev => prev.filter(c => c.id !== id))
      setTotal(prev => prev - 1)
    } catch {
      alert('删除失败')
    }
  }

  if (loading) return <div className={styles.loading}>加载中...</div>

  return (
    <div className={styles.tableWrapper}>
      <div className={styles.tableHeader}>
        <input
          type="search"
          placeholder="搜索公司名称、行业..."
          className={styles.searchInput}
          value={search}
          onChange={handleSearchChange}
        />
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.checkboxCell}>
              <input type="checkbox" />
            </th>
            <th>公司名称</th>
            <th>行业</th>
            <th>联系人</th>
            <th>城市</th>
            <th>类型</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {companies.map(company => (
            <tr key={company.id} className={styles.row}>
              <td className={styles.checkboxCell}>
                <input type="checkbox" />
              </td>
              <td>
                <div className={styles.nameCell}>
                  <span className={styles.name}>{company.name}</span>
                  {company.tags.length > 0 && (
                    <div className={styles.tagsCell}>
                      {company.tags.slice(0, 3).map(tag => (
                        <span key={tag} className={styles.tag}>{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              </td>
              <td>
                <span className={styles.industryBadge}>{company.industry || '-'}</span>
              </td>
              <td>{company.contact || '-'}</td>
              <td>{company.city || '-'}</td>
              <td>
                <span className={`${styles.typeBadge} ${company.type === 'supplier' ? styles.typeSupplier : styles.typeCustomer}`}>
                  {company.type === 'supplier' ? '供应商' : '客户'}
                </span>
              </td>
              <td className={styles.dateCell}>{company.createdAt}</td>
              <td>
                <div className={styles.actions}>
                  <button className={styles.actionBtn} title="详情" onClick={() => router.push(`/erp/crm/companies/${company.id}`)}>🔍</button>
                  <button className={styles.actionBtn} title="编辑" onClick={() => router.push(`/erp/crm/companies/${company.id}/edit`)}>✏️</button>
                  <button className={styles.actionBtn} title="删除" onClick={() => handleDelete(company.id)}>🗑️</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {companies.length === 0 && (
        <div className={styles.emptyState}>暂无公司数据</div>
      )}

      <div className={styles.pagination}>
        <span className={styles.paginationInfo}>
          显示 1-{companies.length} 条，共 {total} 条
        </span>
        <div className={styles.paginationBtns}>
          <button className={styles.pageBtn} disabled>‹</button>
          <button className={`${styles.pageBtn} ${styles.active}`}>1</button>
          <button className={styles.pageBtn} disabled>›</button>
        </div>
      </div>
    </div>
  )
}