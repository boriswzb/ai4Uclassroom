'use client'

import { useState } from 'react'
import styles from '../settings.module.css'

export default function SettingsOrgPage() {
  const [org, setOrg] = useState({
    name: '深圳华创科技有限公司',
    legalName: '深圳市华创科技有限公司',
    registrationNo: '91440300MA5DXXXXXX',
    industry: '批发业',
    employeeCount: '50-100',
    address: '广东省深圳市南山区粤海街道科技园南区A1栋18层',
    phone: '0755-86521000',
    email: 'admin@huanchuang.com',
    website: 'www.huanchuang.com',
    taxNo: '91440300MA5DXXXXXX',
    bankName: '中国工商银行深圳南山支行',
    bankAccount: '4000123456789012345',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    alert('组织信息已保存！')
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>组织信息</h1>
        <p className={styles.subtitle}>管理公司的基本信息</p>
      </div>
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>基本信息</h2>
          <div className={styles.grid}>
            <div className={styles.field}>
              <label className={styles.label}>组织名称 *</label>
              <input type="text" className={styles.input} value={org.name} onChange={e => setOrg({ ...org, name: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>法定名称</label>
              <input type="text" className={styles.input} value={org.legalName} onChange={e => setOrg({ ...org, legalName: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>统一社会信用代码</label>
              <input type="text" className={styles.input} value={org.registrationNo} onChange={e => setOrg({ ...org, registrationNo: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>所属行业</label>
              <select className={styles.select} value={org.industry} onChange={e => setOrg({ ...org, industry: e.target.value })}>
                <option value="批发业">批发业</option>
                <option value="零售业">零售业</option>
                <option value="制造业">制造业</option>
                <option value="信息技术">信息技术</option>
                <option value="服务业">服务业</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>员工数量</label>
              <select className={styles.select} value={org.employeeCount} onChange={e => setOrg({ ...org, employeeCount: e.target.value })}>
                <option value="1-10">1-10人</option>
                <option value="11-50">11-50人</option>
                <option value="50-100">50-100人</option>
                <option value="100-500">100-500人</option>
                <option value="500+">500人以上</option>
              </select>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>联系方式</h2>
          <div className={styles.grid}>
            <div className={styles.field}>
              <label className={styles.label}>地址</label>
              <input type="text" className={styles.input} value={org.address} onChange={e => setOrg({ ...org, address: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>联系电话</label>
              <input type="text" className={styles.input} value={org.phone} onChange={e => setOrg({ ...org, phone: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>电子邮箱</label>
              <input type="email" className={styles.input} value={org.email} onChange={e => setOrg({ ...org, email: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>网站</label>
              <input type="text" className={styles.input} value={org.website} onChange={e => setOrg({ ...org, website: e.target.value })} />
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>财务信息</h2>
          <div className={styles.grid}>
            <div className={styles.field}>
              <label className={styles.label}>税务登记号</label>
              <input type="text" className={styles.input} value={org.taxNo} onChange={e => setOrg({ ...org, taxNo: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>开户银行</label>
              <input type="text" className={styles.input} value={org.bankName} onChange={e => setOrg({ ...org, bankName: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>银行账号</label>
              <input type="text" className={styles.input} value={org.bankAccount} onChange={e => setOrg({ ...org, bankAccount: e.target.value })} />
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <button type="submit" className={styles.saveBtn}>保存修改</button>
        </div>
      </form>
    </div>
  )
}
