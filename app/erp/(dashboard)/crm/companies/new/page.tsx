'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './new-company.module.css'

const tagOptions = ['优质客户', '科技', '贸易', '华南', '华北', '华东', '品牌商', 'IT设备', '办公用品', '物流', '集团客户']

export default function NewCompanyPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '',
    industry: '',
    employeeCount: '',
    website: '',
    address: '',
    phone: '',
    description: '',
    tags: [] as string[],
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('公司名称不能为空')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/erp/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.message || '创建失败')
        return
      }
      router.push('/erp/crm/companies')
    } catch {
      setError('网络错误，请重试')
    } finally {
      setLoading(false)
    }
  }

  const toggleTag = (tag: string) => {
    setForm(prev => ({
      ...prev,
      tags: prev.tags.includes(tag)
        ? prev.tags.filter(t => t !== tag)
        : [...prev.tags, tag],
    }))
  }

  return (
    <div>
      <div className={styles.header}>
        <button onClick={() => router.back()} className={styles.backBtn}>← 返回</button>
        <h1 className={styles.title}>新建公司</h1>
      </div>

      <form onSubmit={handleSubmit} className={styles.container}>
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>基本信息</h2>
          <div className={styles.formGrid}>
            <div className={styles.formGroup} style={{ gridColumn: 'span 2' }}>
              <label className={styles.label}>公司名称 <span className={styles.required}>*</span></label>
              <input
                type="text"
                className={styles.input}
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="请输入公司名称"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>行业</label>
              <input
                type="text"
                className={styles.input}
                value={form.industry}
                onChange={e => setForm(p => ({ ...p, industry: e.target.value }))}
                placeholder="如：科技、贸易"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>员工人数</label>
              <input
                type="text"
                className={styles.input}
                value={form.employeeCount}
                onChange={e => setForm(p => ({ ...p, employeeCount: e.target.value }))}
                placeholder="如：100-500"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>官网</label>
              <input
                type="text"
                className={styles.input}
                value={form.website}
                onChange={e => setForm(p => ({ ...p, website: e.target.value }))}
                placeholder="www.example.com"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>电话</label>
              <input
                type="text"
                className={styles.input}
                value={form.phone}
                onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                placeholder="0755-xxxxxxx"
              />
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>标签</h2>
          <div className={styles.tagGrid}>
            {tagOptions.map(tag => (
              <button
                key={tag}
                type="button"
                className={`${styles.tagBtn} ${form.tags.includes(tag) ? styles.tagActive : ''}`}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>地址</h2>
          <div className={styles.formGrid}>
            <div className={styles.formGroup} style={{ gridColumn: 'span 3' }}>
              <label className={styles.label}>详细地址</label>
              <input
                type="text"
                className={styles.input}
                value={form.address}
                onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
                placeholder="详细地址"
              />
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>公司简介</h2>
          <textarea
            className={styles.textarea}
            value={form.description}
            onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            placeholder="公司简介..."
            rows={4}
          />
        </div>

        <div className={styles.actions}>
          <button type="button" onClick={() => router.back()} className={styles.cancelBtn}>取消</button>
          <button type="submit" disabled={loading} className={styles.submitBtn}>
            {loading ? '创建中...' : '创建公司'}
          </button>
        </div>
      </form>
    </div>
  )
}