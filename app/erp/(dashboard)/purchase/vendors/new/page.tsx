'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from '../vendors.module.css'

export default function NewVendorPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '',
    contact: '',
    phone: '',
    email: '',
    city: '',
    address: '',
    category: '',
    bank: '',
    account: '',
    taxRate: '0',
    remark: '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError('供应商名称不能为空'); return }
    if (!form.contact.trim()) { setError('联系人不能为空'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/erp/purchase/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.message || '创建失败')
        return
      }
      router.push('/erp/purchase/vendors')
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className={styles.header}>
        <button onClick={() => router.back()} className={styles.backBtn}>← 返回</button>
        <h1 className={styles.title}>新建供应商</h1>
      </div>
      <div className={styles.formContainer}>
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>基本信息</h2>
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label className={styles.label}>供应商名称 <span className={styles.required}>*</span></label>
              <input name="name" value={form.name} onChange={handleChange} placeholder="请输入供应商全称" className={styles.input} />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>联系人 <span className={styles.required}>*</span></label>
              <input name="contact" value={form.contact} onChange={handleChange} placeholder="请输入联系人姓名" className={styles.input} />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>联系电话</label>
              <input name="phone" value={form.phone} onChange={handleChange} placeholder="请输入联系电话" className={styles.input} />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>电子邮箱</label>
              <input name="email" value={form.email} onChange={handleChange} placeholder="请输入邮箱地址" className={styles.input} type="email" />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>城市</label>
              <input name="city" value={form.city} onChange={handleChange} placeholder="如：深圳市" className={styles.input} />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>所属行业</label>
              <select name="category" value={form.category} onChange={handleChange} className={styles.select}>
                <option value="">请选择</option>
                <option value="电子元器件">电子元器件</option>
                <option value="办公设备">办公设备</option>
                <option value="五金建材">五金建材</option>
                <option value="食品饮料">食品饮料</option>
                <option value="服装纺织">服装纺织</option>
                <option value="化工原料">化工原料</option>
                <option value="其他">其他</option>
              </select>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>地址信息</h2>
          <div className={styles.formGrid}>
            <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
              <label className={styles.label}>详细地址</label>
              <input name="address" value={form.address} onChange={handleChange} placeholder="请输入详细地址" className={styles.input} />
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>财务信息</h2>
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label className={styles.label}>开户银行</label>
              <input name="bank" value={form.bank} onChange={handleChange} placeholder="如：中国工商银行深圳分行" className={styles.input} />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>银行账号</label>
              <input name="account" value={form.account} onChange={handleChange} placeholder="请输入银行账号" className={styles.input} />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>默认税率（%）</label>
              <input name="taxRate" value={form.taxRate} onChange={handleChange} placeholder="如：13" className={styles.input} type="number" min="0" max="100" />
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>备注</h2>
          <div className={styles.formGrid}>
            <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
              <textarea name="remark" value={form.remark} onChange={handleChange} placeholder="备注信息..." className={styles.textarea} rows={3} />
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <button type="button" onClick={() => router.back()} className={styles.cancelBtn}>取消</button>
          <button type="button" onClick={() => handleSubmit()} disabled={loading} className={styles.submitBtn}>
            {loading ? '创建中...' : '创建供应商'}
          </button>
        </div>
      </div>
    </div>
  )
}
