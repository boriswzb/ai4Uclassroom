'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import styles from './new-warehouse.module.css'

export default function NewWarehousePage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    location: '',
    manager: '',
    capacity: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.code.trim()) { setError('请输入仓库编码'); return }
    if (!formData.name.trim()) { setError('请输入仓库名称'); return }
    setError('')
    setSuccess('')
    setSubmitting(true)

    try {
      const res = await fetch('/api/erp/inventory/warehouses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: formData.code.trim(),
          name: formData.name.trim(),
          location: formData.location.trim() || undefined,
          manager: formData.manager.trim() || undefined,
          capacity: formData.capacity ? parseInt(formData.capacity) : 0,
        }),
      })

      if (res.ok) {
        setSuccess('仓库创建成功！')
        setTimeout(() => router.push('/erp/inventory/warehouses'), 1000)
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || '创建失败，请检查编码是否重复')
      }
    } catch {
      setError('网络错误，请检查网络连接')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className={styles.header}>
        <button onClick={() => router.back()} className={styles.backBtn}>← 返回</button>
        <h1 className={styles.title}>新建仓库</h1>
      </div>

      <div className={styles.container}>
        <form onSubmit={handleSubmit}>
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>基本信息</h2>
            {error && <div className={styles.error}>{error}</div>}
            {success && <div className={styles.success}>{success}</div>}
            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.label}>仓库编码 *</label>
                <input type="text" name="code" className={styles.input} value={formData.code} onChange={handleChange} placeholder="例如：WH-001" required />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>仓库名称 *</label>
                <input type="text" name="name" className={styles.input} value={formData.name} onChange={handleChange} placeholder="例如：深圳总部仓" required />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>负责人</label>
                <input type="text" name="manager" className={styles.input} value={formData.manager} onChange={handleChange} placeholder="请输入负责人姓名" />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>库容（平方米）</label>
                <input type="number" name="capacity" className={styles.input} value={formData.capacity} onChange={handleChange} placeholder="可选，如 500" />
              </div>
              <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
                <label className={styles.label}>仓库地址</label>
                <input type="text" name="location" className={styles.input} value={formData.location} onChange={handleChange} placeholder="请输入仓库详细地址" />
              </div>
            </div>
          </div>

          <div className={styles.actions}>
            <Link href="/erp/inventory/warehouses" className={styles.cancelBtn}>取消</Link>
            <button type="submit" className={styles.submitBtn} disabled={submitting}>
              {submitting ? '创建中...' : '创建仓库'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
