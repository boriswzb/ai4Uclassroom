'use client'

import { useState } from 'react'
import styles from '../settings.module.css'

interface ApiKey {
  id: string
  name: string
  key: string
  permission: string
  createdAt: string
  lastUsed: string
  active: boolean
}

const mockKeys: ApiKey[] = [
  { id: '1', name: '东方财富数据接口', key: 'em_live_4a2b****8f3e', permission: '行情数据读取', createdAt: '2024-03-15', lastUsed: '2025-05-14 09:32', active: true },
  { id: '2', name: '微信公众号回调', key: 'wx_mp_hook_****9d2c', permission: '消息接收', createdAt: '2024-06-20', lastUsed: '2025-05-13 18:10', active: true },
  { id: '3', name: '短信通知服务', key: 'sms_aliyun_****7f1a', permission: '发送短信', createdAt: '2024-09-01', lastUsed: '2025-05-10 11:05', active: true },
  { id: '4', name: '物流追踪API', key: 'logistics_kd****a3b9', permission: '快递查询', createdAt: '2025-01-08', lastUsed: '2025-04-28 14:22', active: false },
]

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>(mockKeys)
  const [showCreate, setShowCreate] = useState(false)
  const [newKey, setNewKey] = useState({ name: '', permission: '行情数据读取' })
  const [creating, setCreating] = useState(false)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKey.name.trim()) return
    setCreating(true)
    await new Promise(r => setTimeout(r, 800))
    const generated = 'ak_' + Math.random().toString(36).slice(2, 10) + '****' + Math.random().toString(36).slice(2, 6)
    const k: ApiKey = {
      id: Date.now().toString(),
      name: newKey.name,
      key: generated,
      permission: newKey.permission,
      createdAt: new Date().toLocaleDateString('zh-CN'),
      lastUsed: '从未使用',
      active: true,
    }
    setKeys(prev => [k, ...prev])
    setShowCreate(false)
    setNewKey({ name: '', permission: '行情数据读取' })
    setCreating(false)
  }

  const toggleKey = (id: string) => {
    setKeys(prev => prev.map(k => k.id === id ? { ...k, active: !k.active } : k))
  }

  const deleteKey = (id: string) => {
    if (!confirm('确定删除此 API 密钥？')) return
    setKeys(prev => prev.filter(k => k.id !== id))
  }

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key).catch(() => {})
  }

  return (
    <div>
      <div className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className={styles.title}>API密钥</h1>
          <p className={styles.subtitle}>管理第三方系统接入凭证</p>
        </div>
        <button className={styles.addBtn} onClick={() => setShowCreate(true)}>+ 新建密钥</button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} style={{ margin: '0 24px 20px', padding: '20px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px' }}>创建新密钥</h3>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', color: '#475569', fontWeight: 500 }}>密钥名称</label>
              <input className={styles.input} value={newKey.name} onChange={e => setNewKey({ ...newKey, name: e.target.value })} placeholder="例如：东方财富数据接口" required />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', color: '#475569', fontWeight: 500 }}>权限范围</label>
              <select className={styles.select} value={newKey.permission} onChange={e => setNewKey({ ...newKey, permission: e.target.value })}>
                <option>行情数据读取</option>
                <option>消息接收</option>
                <option>发送短信</option>
                <option>发送邮件</option>
                <option>快递查询</option>
                <option>全量权限</option>
              </select>
            </div>
            <button type="submit" className={styles.saveBtn} disabled={creating}>{creating ? '生成中...' : '生成密钥'}</button>
            <button type="button" onClick={() => setShowCreate(false)} style={{ padding: '9px 16px', border: '1px solid #e2e8f0', borderRadius: '6px', background: '#fff', cursor: 'pointer' }}>取消</button>
          </div>
        </form>
      )}

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>密钥名称</th>
              <th>密钥</th>
              <th>权限范围</th>
              <th>创建时间</th>
              <th>最后使用</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {keys.map(k => (
              <tr key={k.id} className={styles.row}>
                <td className={styles.name}>{k.name}</td>
                <td><code style={{ fontSize: '13px', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', color: '#475569' }}>{k.key}</code></td>
                <td><span style={{ fontSize: '12px', padding: '2px 8px', background: '#eff6ff', color: '#2563eb', borderRadius: '8px' }}>{k.permission}</span></td>
                <td className={styles.lastLogin}>{k.createdAt}</td>
                <td className={styles.lastLogin}>{k.lastUsed}</td>
                <td>
                  <button
                    onClick={() => toggleKey(k.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    title={k.active ? '点击禁用' : '点击启用'}
                  >
                    {k.active
                      ? <span className={styles.activeBadge}>已启用</span>
                      : <span className={styles.inactiveBadge}>已禁用</span>}
                  </button>
                </td>
                <td className={styles.actions}>
                  <button className={styles.actionBtn} onClick={() => copyKey(k.key)} title="复制密钥">复制</button>
                  <button className={styles.deleteBtn} onClick={() => deleteKey(k.id)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
