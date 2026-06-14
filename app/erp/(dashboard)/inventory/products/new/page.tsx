'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './new-product.module.css'

export default function NewProductPage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    sku: '',
    name: '',
    category: '',
    unit: '',
    costPrice: '',
    sellingPrice: '',
    stock: '',
    reorderPoint: '',
    description: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.sku.trim()) {
      setError('请输入商品SKU')
      return
    }
    if (!formData.name.trim()) {
      setError('请输入商品名称')
      return
    }

    setError('')
    setSubmitting(true)

    try {
      const res = await fetch('/erp/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: formData.sku,
          name: formData.name,
          category: formData.category || undefined,
          unit: formData.unit || undefined,
          costPrice: formData.costPrice ? parseFloat(formData.costPrice) : undefined,
          sellingPrice: formData.sellingPrice ? parseFloat(formData.sellingPrice) : undefined,
          stock: formData.stock ? parseInt(formData.stock) : undefined,
          reorderPoint: formData.reorderPoint ? parseInt(formData.reorderPoint) : undefined,
          description: formData.description || undefined,
        }),
      })

      if (res.ok) {
        router.push('/inventory/products')
      } else {
        const err = await res.json()
        setError(err.message || '创建失败')
      }
    } catch (e) {
      setError('网络错误')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className={styles.header}>
        <button onClick={() => router.back()} className={styles.backBtn}>← 返回</button>
        <h1 className={styles.title}>新建商品</h1>
      </div>

      <div className={styles.container}>
        <form onSubmit={handleSubmit}>
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>基本信息</h2>
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.label}>SKU *</label>
                <input
                  type="text"
                  name="sku"
                  className={styles.input}
                  value={formData.sku}
                  onChange={handleChange}
                  placeholder="请输入商品SKU"
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>商品名称 *</label>
                <input
                  type="text"
                  name="name"
                  className={styles.input}
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="请输入商品名称"
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>类别</label>
                <input
                  type="text"
                  name="category"
                  className={styles.input}
                  value={formData.category}
                  onChange={handleChange}
                  placeholder="请输入商品类别"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>单位</label>
                <select name="unit" className={styles.select} value={formData.unit} onChange={handleChange}>
                  <option value="">请选择单位</option>
                  <option value="个">个</option>
                  <option value="件">件</option>
                  <option value="台">台</option>
                  <option value="箱">箱</option>
                  <option value="套">套</option>
                  <option value="盒">盒</option>
                  <option value="米">米</option>
                  <option value="千克">千克</option>
                  <option value="升">升</option>
                </select>
              </div>
            </div>
          </div>

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>价格与库存</h2>
            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.label}>成本价</label>
                <input
                  type="number"
                  name="costPrice"
                  className={styles.input}
                  value={formData.costPrice}
                  onChange={handleChange}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>销售价</label>
                <input
                  type="number"
                  name="sellingPrice"
                  className={styles.input}
                  value={formData.sellingPrice}
                  onChange={handleChange}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>当前库存</label>
                <input
                  type="number"
                  name="stock"
                  className={styles.input}
                  value={formData.stock}
                  onChange={handleChange}
                  placeholder="0"
                  min="0"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>再订货点</label>
                <input
                  type="number"
                  name="reorderPoint"
                  className={styles.input}
                  value={formData.reorderPoint}
                  onChange={handleChange}
                  placeholder="0"
                  min="0"
                />
              </div>
            </div>
          </div>

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>商品描述</h2>
            <textarea
              name="description"
              className={styles.textarea}
              rows={4}
              placeholder="请输入商品描述..."
              value={formData.description}
              onChange={handleChange}
            />
          </div>

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={() => router.back()}>取消</button>
            <button type="submit" className={styles.submitBtn} disabled={submitting}>
              {submitting ? '提交中...' : '创建商品'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}