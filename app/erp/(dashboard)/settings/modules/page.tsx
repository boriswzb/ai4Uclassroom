'use client'

import { useState } from 'react'
import styles from './modules.module.css'

interface Module {
  id: string
  name: string
  icon: string
  description: string
  enabled: boolean
  order: number
}

const mockModules: Module[] = [
  { id: 'crm', name: '客户管理 CRM', icon: '👥', description: '联系人、客户公司、商机管理', enabled: true, order: 1 },
  { id: 'sales', name: '销售管理', icon: '💰', description: '销售订单、报价管理', enabled: true, order: 2 },
  { id: 'purchase', name: '采购管理', icon: '📦', description: '采购订单、供应商管理', enabled: true, order: 3 },
  { id: 'inventory', name: '库存管理', icon: '🏭', description: '产品目录、仓库、库移动作', enabled: true, order: 4 },
  { id: 'accounting', name: '财务管理', icon: '💳', description: '发票、收付款、日记账、会计科目', enabled: true, order: 5 },
  { id: 'ai', name: 'AI 助手', icon: '🤖', description: '智能数据分析与业务建议', enabled: true, order: 6 },
  { id: 'projects', name: '项目管理', icon: '📋', description: '项目任务、甘特图管理', enabled: false, order: 7 },
  { id: 'hr', name: '人力资源', icon: '👔', description: '员工档案、考勤、薪资', enabled: false, order: 8 },
]

export default function SettingsModulesPage() {
  const [modules, setModules] = useState(mockModules)

  const toggle = (id: string) => {
    setModules(modules.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m))
  }

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>模块开关</h1>
          <p className={styles.subtitle}>启用或禁用系统模块</p>
        </div>
      </div>
      <div className={styles.grid}>
        {modules.map(m => (
          <div key={m.id} className={`${styles.moduleCard} ${m.enabled ? styles.enabled : styles.disabled}`}>
            <div className={styles.moduleIcon}>{m.icon}</div>
            <div className={styles.moduleInfo}>
              <span className={styles.moduleName}>{m.name}</span>
              <span className={styles.moduleDesc}>{m.description}</span>
            </div>
            <button
              className={`${styles.toggle} ${m.enabled ? styles.toggleOn : styles.toggleOff}`}
              onClick={() => toggle(m.id)}
            >
              <span className={styles.toggleKnob} />
            </button>
          </div>
        ))}
      </div>
      <div className={styles.actions}>
        <button className={styles.saveBtn}>保存设置</button>
      </div>
    </div>
  )
}
