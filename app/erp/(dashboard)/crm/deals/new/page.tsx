'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './new-deal.module.css'

const stageOptions = ['需求确认', '方案报价', '商务谈判', '合同签订']
const sourceOptions = ['电话营销', '展会', '客户推荐', '官网咨询', '其他']

export default function NewDealPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '',
    amount: '',
    stage: '需求确认',
    probability: 20,
    source: '',
    expectedClose: '',
    companyName: '',
    contactName: '',
    remark: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('商机名称不能为空'); return }
    if (!form.amount.trim() || isNaN(Number(form.amount))) { setError('请输入有效金额'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/erp/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          amount: parseFloat(form.amount),
          stage: form.stage,
          probability: form.probability,
          source: form.source || null,
          expectedClose: form.expectedClose || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '创建失败')
        return
      }
      router.push('/erp/crm/deals')
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
        <h1 className={styles.title}>新建商机</h1>
      </div>

      <form onSubmit={handleSubmit} className={styles.container}>
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>基本信息</h2>
          <div className={styles.formGrid}>
            <div className={styles.formGroup} style={{ gridColumn: 'span 2' }}>
              <label className={styles.label}>商机名称 <span className={styles.required}>*</span></label>
              <input type="text" className={styles.input} value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="例如：XX公司采购项目" />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>金额（元）<span className={styles.required}>*</span></label>
              <input type="number" className={styles.input} value={form.amount}
                onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                placeholder="0.00" />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>销售阶段</label>
              <select className={styles.select} value={form.stage}
                onChange={e => setForm(p => ({ ...p, stage: e.target.value }))}>
                {stageOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>赢单概率（%）</label>
              <input type="number" className={styles.input} value={form.probability} min={0} max={100}
                onChange={e => setForm(p => ({ ...p, probability: parseInt(e.target.value) || 0 }))} />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>商机来源</label>
              <select className={styles.select} value={form.source}
                onChange={e => setForm(p => ({ ...p, source: e.target.value }))}>
                <option value="">请选择</option>
                {sourceOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>预计成交日期</label>
              <input type="date" className={styles.input} value={form.expectedClose}
                onChange={e => setForm(p => ({ ...p, expectedClose: e.target.value }))} />
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>备注</h2>
          <textarea className={styles.textarea} value={form.remark}
            onChange={e => setForm(p => ({ ...p, remark: e.target.value }))}
            placeholder="其他备注信息..." rows={3} />
        </div>

        <div className={styles.actions}>
          <button type="button" onClick={() => router.back()} className={styles.cancelBtn}>取消</button>
          <button type="submit" disabled={loading} className={styles.submitBtn}>
            {loading ? '创建中...' : '创建商机'}
          </button>
        </div>
      </form>
    </div>
  )
}