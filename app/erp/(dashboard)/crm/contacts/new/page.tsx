'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './new-contact.module.css'

const tagOptions = ['优质客户', '科技', '贸易', '华南', '华北', '华东', '品牌商', 'IT设备', '办公用品', '物流', '集团客户']

export default function NewContactPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    mobile: '',
    position: '',
    isCustomer: true,
    isSupplier: false,
    tags: [] as string[],
    street: '',
    city: '',
    province: '',
    postalCode: '',
    remark: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('名称不能为空')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/erp/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.message || '创建失败')
        return
      }
      router.push('/erp/crm/contacts')
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
        <h1 className={styles.title}>新建联系人</h1>
      </div>

      <form onSubmit={handleSubmit} className={styles.container}>
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>基本信息</h2>
          <div className={styles.formGrid}>
            <div className={styles.formGroup} style={{ gridColumn: 'span 2' }}>
              <label className={styles.label}>名称 <span className={styles.required}>*</span></label>
              <input
                type="text"
                className={styles.input}
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="公司名称或个人姓名"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>邮箱</label>
              <input
                type="email"
                className={styles.input}
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                placeholder="email@example.com"
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
            <div className={styles.formGroup}>
              <label className={styles.label}>手机</label>
              <input
                type="text"
                className={styles.input}
                value={form.mobile}
                onChange={e => setForm(p => ({ ...p, mobile: e.target.value }))}
                placeholder="138xxxxxxx"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>职位</label>
              <input
                type="text"
                className={styles.input}
                value={form.position}
                onChange={e => setForm(p => ({ ...p, position: e.target.value }))}
                placeholder="采购经理"
              />
            </div>
          </div>

          <div className={styles.checkboxGroup}>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={form.isCustomer}
                onChange={e => setForm(p => ({ ...p, isCustomer: e.target.checked }))}
              />
              <span>客户</span>
            </label>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={form.isSupplier}
                onChange={e => setForm(p => ({ ...p, isSupplier: e.target.checked }))}
              />
              <span>供应商</span>
            </label>
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
              <label className={styles.label}>街道</label>
              <input
                type="text"
                className={styles.input}
                value={form.street}
                onChange={e => setForm(p => ({ ...p, street: e.target.value }))}
                placeholder="详细地址"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>省份</label>
              <input
                type="text"
                className={styles.input}
                value={form.province}
                onChange={e => setForm(p => ({ ...p, province: e.target.value }))}
                placeholder="广东省"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>城市</label>
              <input
                type="text"
                className={styles.input}
                value={form.city}
                onChange={e => setForm(p => ({ ...p, city: e.target.value }))}
                placeholder="深圳市"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>邮编</label>
              <input
                type="text"
                className={styles.input}
                value={form.postalCode}
                onChange={e => setForm(p => ({ ...p, postalCode: e.target.value }))}
                placeholder="518000"
              />
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>备注</h2>
          <textarea
            className={styles.textarea}
            value={form.remark}
            onChange={e => setForm(p => ({ ...p, remark: e.target.value }))}
            placeholder="其他备注信息..."
            rows={3}
          />
        </div>

        <div className={styles.actions}>
          <button type="button" onClick={() => router.back()} className={styles.cancelBtn}>取消</button>
          <button type="submit" disabled={loading} className={styles.submitBtn}>
            {loading ? '创建中...' : '创建联系人'}
          </button>
        </div>
      </form>
    </div>
  )
}
