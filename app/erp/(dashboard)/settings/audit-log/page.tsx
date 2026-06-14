'use client'

import { useState } from 'react'
import styles from '../settings.module.css'

interface LogEntry {
  id: string
  time: string
  user: string
  action: string
  module: string
  detail: string
  ip: string
}

const mockLogs: LogEntry[] = [
  { id: '1', time: '2025-05-14 18:32:15', user: '张经理', action: '创建', module: '销售订单', detail: '新建订单 SO-2025-000047，金额 ¥89,990', ip: '192.168.1.101' },
  { id: '2', time: '2025-05-14 17:15:08', user: '李财务', action: '审批', module: '采购订单', detail: '审批采购单 PO-2025-000023 通过', ip: '192.168.1.102' },
  { id: '3', time: '2025-05-14 16:45:33', user: '王仓管', action: '入库', module: '库存', detail: '商品[企业路由器 R3000]入库 50 件', ip: '192.168.1.103' },
  { id: '4', time: '2025-05-14 15:20:11', user: '系统', action: '自动', module: '库存预警', detail: '无线鼠标 ELEC-002 库存低于安全线（3 < 10）', ip: 'localhost' },
  { id: '5', time: '2025-05-14 14:08:44', user: '张经理', action: '查看', module: '客户管理', detail: '查看客户[深圳市腾达科技有限公司]详情', ip: '192.168.1.101' },
  { id: '6', time: '2025-05-14 11:30:22', user: '赵销售', action: '创建', module: '销售订单', detail: '新建订单 SO-2025-000046，金额 ¥25,600', ip: '192.168.1.104' },
  { id: '7', time: '2025-05-14 10:05:55', user: '李财务', action: '收款', module: '财务', detail: '登记收款 ¥50,000，来自深圳腾达科技', ip: '192.168.1.102' },
  { id: '8', time: '2025-05-13 17:52:10', user: '管理员', action: '登录', module: '系统', detail: '后台管理员登录成功', ip: '192.168.1.1' },
  { id: '9', time: '2025-05-13 16:30:00', user: '张经理', action: '编辑', module: '产品管理', detail: '更新产品[ThinkPad X1 Carbon]价格 6999→7499', ip: '192.168.1.101' },
  { id: '10', time: '2025-05-13 14:20:33', user: '赵销售', action: '报价', module: 'CRM', detail: '为[广州中商贸易]生成报价单 Q-2025-00012', ip: '192.168.1.104' },
]

const actionColors: Record<string, string> = {
  '创建': '#16a34a', '编辑': '#2563eb', '删除': '#dc2626', '审批': '#7c3aed',
  '入库': '#16a34a', '出库': '#f59e0b', '收款': '#16a34a', '付款': '#dc2626',
  '查看': '#64748b', '登录': '#475569', '自动': '#94a3b8', '报价': '#2563eb',
}

const modules = ['全部', '销售订单', '采购订单', '库存', '客户管理', 'CRM', '财务', '系统']
const users = ['全部', '张经理', '李财务', '王仓管', '赵销售', '管理员']
const actions = ['全部', '创建', '编辑', '删除', '审批', '入库', '出库', '收款', '付款', '查看', '登录', '自动']

export default function AuditLogPage() {
  const [module, setModule] = useState('全部')
  const [user, setUser] = useState('全部')
  const [action, setAction] = useState('全部')
  const [keyword, setKeyword] = useState('')

  const filtered = mockLogs.filter(log => {
    if (module !== '全部' && log.module !== module) return false
    if (user !== '全部' && log.user !== user) return false
    if (action !== '全部' && log.action !== action) return false
    if (keyword && !log.detail.includes(keyword) && !log.user.includes(keyword)) return false
    return true
  })

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>操作日志</h1>
        <p className={styles.subtitle}>记录所有关键业务操作，支持追溯和审计</p>
      </div>

      <div style={{ padding: '16px 24px', background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className={styles.searchInput}
          placeholder="搜索操作详情..."
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          style={{ width: '200px' }}
        />
        <select className={styles.select} value={module} onChange={e => setModule(e.target.value)} style={{ padding: '7px 12px' }}>
          {modules.map(m => <option key={m}>{m}</option>)}
        </select>
        <select className={styles.select} value={user} onChange={e => setUser(e.target.value)} style={{ padding: '7px 12px' }}>
          {users.map(u => <option key={u}>{u}</option>)}
        </select>
        <select className={styles.select} value={action} onChange={e => setAction(e.target.value)} style={{ padding: '7px 12px' }}>
          {actions.map(a => <option key={a}>{a}</option>)}
        </select>
        <span style={{ fontSize: '13px', color: '#94a3b8', marginLeft: 'auto' }}>共 {filtered.length} 条记录</span>
      </div>

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>时间</th>
              <th>用户</th>
              <th>操作</th>
              <th>模块</th>
              <th>详情</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(log => (
              <tr key={log.id} className={styles.row}>
                <td className={styles.lastLogin}>{log.time}</td>
                <td><span className={styles.name}>{log.user}</span></td>
                <td>
                  <span style={{
                    fontSize: '12px', fontWeight: 500, padding: '2px 8px', borderRadius: '8px',
                    background: `${actionColors[log.action]}18`, color: actionColors[log.action]
                  }}>
                    {log.action}
                  </span>
                </td>
                <td><span className={styles.roleBadge}>{log.module}</span></td>
                <td style={{ color: '#475569', fontSize: '13px', maxWidth: '300px' }}>{log.detail}</td>
                <td className={styles.lastLogin}>{log.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
