'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import styles from './new-payment.module.css'

interface Contact {
  id: string
  name: string
}

const paymentMethodOptions = [
  { value: 'BANK_TRANSFER', label: '银行转账' },
  { value: 'CASH', label: '现金' },
  { value: 'WECHAT', label: '微信支付' },
  { value: 'ALIPAY', label: '支付宝' },
]

export default function NewPaymentPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [form, setForm] = useState({
    type: '',
    amount: '',
    contactId: '',
    contactName: '',
    orderNo: '',
    paymentDate: new Date().toISOString().split('T')[0],
    paymentMethod: 'BANK_TRANSFER',
    remark: '',
  })

  useEffect(() => {
    fetchContacts()
  }, [])

  const fetchContacts = async () => {
    try {
      const res = await fetch('/erp/api/contacts')
      if (res.ok) {
        const data = await res.json()
        setContacts(data)
      }
    } catch (e) {
      console.error('Failed to fetch contacts', e)
    }
  }

  const handleContactChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const contactId = e.target.value
    const contact = contacts.find(c => c.id === contactId)
    setForm(prev => ({
      ...prev,
      contactId,
      contactName: contact?.name || '',
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.type) {
      setError('请选择付款类型')
      return
    }
    if (!form.amount || parseFloat(form.amount) <= 0) {
      setError('请输入有效金额')
      return
    }
    if (!form.contactId) {
      setError('请选择联系人')
      return
    }
    if (!form.paymentDate) {
      setError('请选择付款日期')
      return
    }

    setLoading(true)
    setError('')
    try {
      const res = await fetch('/erp/api/accounting/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.type,
          amount: parseFloat(form.amount),
          contactId: form.contactId,
          contactName: form.contactName,
          orderNo: form.orderNo || undefined,
          paymentDate: form.paymentDate,
          paymentMethod: form.paymentMethod,
          remark: form.remark || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.message || '创建失败')
        return
      }
      router.push('/erp/accounting/payments')
    } catch {
      setError('网络错误，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className={styles.header}>
        <button onClick={() => router.back()} className={styles.backBtn}>← 返回</button>
        <h1 className={styles.title}>新建收付款</h1>
      </div>

      <form onSubmit={handleSubmit} className={styles.container}>
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>基本信息</h2>
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label className={styles.label}>类型 <span className={styles.required}>*</span></label>
              <select
                className={styles.select}
                value={form.type}
                onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
              >
                <option value="">请选择类型</option>
                <option value="RECEIPT">收款</option>
                <option value="PAYMENT">付款</option>
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>金额 <span className={styles.required}>*</span></label>
              <input
                type="number"
                className={styles.input}
                value={form.amount}
                onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                placeholder="0.00"
                min="0"
                step="0.01"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>联系人 <span className={styles.required}>*</span></label>
              <select
                className={styles.select}
                value={form.contactId}
                onChange={handleContactChange}
              >
                <option value="">请选择联系人</option>
                {contacts.map(contact => (
                  <option key={contact.id} value={contact.id}>{contact.name}</option>
                ))}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>付款日期 <span className={styles.required}>*</span></label>
              <input
                type="date"
                className={styles.input}
                value={form.paymentDate}
                onChange={e => setForm(p => ({ ...p, paymentDate: e.target.value }))}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>付款方式</label>
              <select
                className={styles.select}
                value={form.paymentMethod}
                onChange={e => setForm(p => ({ ...p, paymentMethod: e.target.value }))}
              >
                {paymentMethodOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>单据号</label>
              <input
                type="text"
                className={styles.input}
                value={form.orderNo}
                onChange={e => setForm(p => ({ ...p, orderNo: e.target.value }))}
                placeholder="可选"
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
            {loading ? '创建中...' : '创建收付款'}
          </button>
        </div>
      </form>
    </div>
  )
}