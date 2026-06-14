'use client'

import { useState } from 'react'
import styles from '../settings.module.css'

interface BackupJob {
  id: string
  name: string
  schedule: string
  scope: string
  retention: number
  lastRun: string
  nextRun: string
  status: 'success' | 'failed' | 'running' | 'idle'
  size: string
}

const mockJobs: BackupJob[] = [
  { id: '1', name: '每日全量备份', schedule: '每天 02:00', scope: '全部数据', retention: 30, lastRun: '2025-05-14 02:00:12', nextRun: '2025-05-15 02:00', status: 'success', size: '2.3 GB' },
  { id: '2', name: '每小时增量备份', schedule: '每1小时', scope: '交易数据', retention: 7, lastRun: '2025-05-14 18:00:05', nextRun: '2025-05-14 19:00', status: 'success', size: '156 MB' },
  { id: '3', name: '每周完整备份', schedule: '每周日 03:00', scope: '全部数据', retention: 90, lastRun: '2025-05-11 03:01:33', nextRun: '2025-05-18 03:00', status: 'success', size: '8.7 GB' },
  { id: '4', name: '配置变更备份', schedule: '实时', scope: '系统配置', retention: 30, lastRun: '2025-05-14 10:22:08', nextRun: '变更时触发', status: 'idle', size: '12 MB' },
]

export default function BackupPage() {
  const [jobs, setJobs] = useState<BackupJob[]>(mockJobs)
  const [running, setRunning] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [settings, setSettings] = useState({
    autoBackup: true,
    compressData: true,
    encryptBackup: false,
    backupPath: '/var/backup/erp',
    maxStorageGB: '500',
  })

  const runBackup = async (id: string) => {
    setRunning(id)
    await new Promise(r => setTimeout(r, 2500))
    setJobs(prev => prev.map(j => j.id === id ? {
      ...j, status: 'success' as const,
      lastRun: new Date().toLocaleString('zh-CN'),
      size: Math.floor(Math.random() * 500 + 50) + ' MB'
    } : j))
    setRunning(null)
  }

  const statusBadge = (status: BackupJob['status']) => {
    const map = {
      success: { label: '成功', cls: styles.activeBadge },
      failed: { label: '失败', cls: styles.inactiveBadge },
      running: { label: '运行中', cls: 'running' },
      idle: { label: '等待', cls: styles.inactiveBadge },
    }
    const { label, cls } = map[status]
    if (status === 'running') {
      return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', background: '#fef3c7', color: '#d97706', borderRadius: '8px', fontSize: '12px', fontWeight: 500 }}>
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#d97706', display: 'inline-block', animation: 'pulse 1s infinite' }} />
        运行中
      </span>
    }
    return <span className={cls}>{label}</span>
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>数据备份</h1>
        <p className={styles.subtitle}>配置自动备份策略，确保数据安全</p>
      </div>

      <form onSubmit={e => { e.preventDefault(); setSaved(true); setTimeout(() => setSaved(false), 2000) }} style={{ padding: '0 24px 24px' }}>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '20px', marginTop: '24px', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px', paddingBottom: '10px', borderBottom: '1px solid #f1f5f9' }}>备份设置</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '14px', color: '#1e293b', width: '140px', fontWeight: 500 }}>自动备份</span>
              <button
                type="button"
                className={`${styles.toggle} ${settings.autoBackup ? styles.toggleOn : styles.toggleOff}`}
                onClick={() => setSettings(s => ({ ...s, autoBackup: !s.autoBackup }))}
              >
                <span className={styles.toggleKnob} />
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '14px', color: '#1e293b', width: '140px', fontWeight: 500 }}>压缩数据</span>
              <button
                type="button"
                className={`${styles.toggle} ${settings.compressData ? styles.toggleOn : styles.toggleOff}`}
                onClick={() => setSettings(s => ({ ...s, compressData: !s.compressData }))}
              >
                <span className={styles.toggleKnob} />
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '14px', color: '#1e293b', width: '140px', fontWeight: 500 }}>加密备份</span>
              <button
                type="button"
                className={`${styles.toggle} ${settings.encryptBackup ? styles.toggleOn : styles.toggleOff}`}
                onClick={() => setSettings(s => ({ ...s, encryptBackup: !s.encryptBackup }))}
              >
                <span className={styles.toggleKnob} />
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '14px', color: '#1e293b', width: '140px', fontWeight: 500 }}>备份存储路径</span>
              <input
                className={styles.input}
                value={settings.backupPath}
                onChange={e => setSettings(s => ({ ...s, backupPath: e.target.value }))}
                style={{ flex: 1 }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '14px', color: '#1e293b', width: '140px', fontWeight: 500 }}>最大存储配额</span>
              <input
                className={styles.input}
                type="number"
                value={settings.maxStorageGB}
                onChange={e => setSettings(s => ({ ...s, maxStorageGB: e.target.value }))}
                style={{ width: '120px' }}
              />
              <span style={{ fontSize: '13px', color: '#94a3b8' }}>GB，超出时自动清理旧备份</span>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <button type="submit" className={styles.saveBtn}>{saved ? '✓ 已保存' : '保存设置'}</button>
        </div>
      </form>

      <div style={{ padding: '0 24px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px' }}>备份任务</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {jobs.map(job => (
            <div key={job.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#1e293b', marginBottom: '4px' }}>{job.name}</div>
                <div style={{ fontSize: '12px', color: '#94a3b8', display: 'flex', gap: '16px' }}>
                  <span>频率：{job.schedule}</span>
                  <span>范围：{job.scope}</span>
                  <span>保留：{job.retention}天</span>
                  <span>大小：{job.size}</span>
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                  上次运行：{job.lastRun} → 下次：{job.nextRun}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {statusBadge(job.status)}
                <button
                  className={styles.saveBtn}
                  style={{ padding: '6px 14px', fontSize: '13px' }}
                  onClick={() => runBackup(job.id)}
                  disabled={running !== null}
                >
                  {running === job.id ? '备份中...' : '立即备份'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
