'use client'

import { useState } from 'react'
import styles from '../settings.module.css'

interface Channel {
  id: string
  label: string
  enabled: boolean
  address: string
  template: string
}

export default function NotificationsPage() {
  const [email, setEmail] = useState<Channel>({
    id: 'email', label: '邮件通知', enabled: true,
    address: 'admin@huanchuang.com', template: '系统异常告警、审批通知'
  })
  const [sms, setSms] = useState<Channel>({
    id: 'sms', label: '短信通知', enabled: true,
    address: '138****8888', template: '库存预警、订单超时'
  })
  const [wechat, setWechat] = useState<Channel>({
    id: 'wechat', label: '企业微信', enabled: false,
    address: '未配置', template: '日报推送、审批结果'
  })
  const [dingtalk, setDingtalk] = useState<Channel>({
    id: 'dingtalk', label: '钉钉机器人', enabled: false,
    address: '未配置', template: '系统告警'
  })
  const [saved, setSaved] = useState(false)

  const toggle = (setter: React.Dispatch<React.SetStateAction<Channel>>) => {
    setter(prev => ({ ...prev, enabled: !prev.enabled }))
    setSaved(false)
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const NotifyRow = ({ channel, setter, channels }: { channel: Channel; setter: React.Dispatch<React.SetStateAction<Channel>>; channels: Channel[] }) => {
    const ch = channel as Channel
    return (
      <div className={styles.moduleCard} style={{ flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '24px', width: '40px', textAlign: 'center' }}>
            {ch.id === 'email' ? '📧' : ch.id === 'sms' ? '📱' : ch.id === 'wechat' ? '💬' : '🔔'}
          </span>
          <div style={{ flex: 1 }}>
            <div className={styles.moduleName}>{ch.label}</div>
            <div className={styles.moduleDesc}>{ch.template}</div>
          </div>
          <button
            className={`${styles.toggle} ${ch.enabled ? styles.toggleOn : styles.toggleOff}`}
            onClick={() => toggle(setter)}
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>
        {ch.enabled && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', color: '#64748b' }}>接收地址/账号</label>
              <input
                className={styles.input}
                value={ch.address}
                onChange={e => setter(prev => ({ ...prev, address: e.target.value }))}
                placeholder={ch.id === 'email' ? 'email@example.com' : '138****8888'}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', color: '#64748b' }}>触发场景</label>
              <select className={styles.select} value={ch.template} onChange={e => setter(prev => ({ ...prev, template: e.target.value }))}>
                <option>全部通知</option>
                <option>系统异常告警</option>
                <option>审批通知</option>
                <option>库存预警</option>
                <option>订单超时</option>
              </select>
            </div>
          </div>
        )}
      </div>
    )
  }

  const allChannels = [email, sms, wechat, dingtalk]
  const setters = [setEmail, setSms, setWechat, setDingtalk]

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>消息通知</h1>
        <p className={styles.subtitle}>配置系统通知渠道和触发规则</p>
      </div>
      <form onSubmit={handleSave} style={{ padding: '0 24px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '24px 0' }}>
          {allChannels.map((ch, i) => (
            <NotifyRow key={ch.id} channel={ch} setter={setters[i]} channels={allChannels} />
          ))}
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px', paddingBottom: '10px', borderBottom: '1px solid #f1f5f9' }}>通知规则</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[
              { label: '库存预警', desc: '当产品库存低于安全库存时', enabled: true, channel: '短信+邮件' },
              { label: '订单超时', desc: '销售订单超过3天未处理', enabled: true, channel: '企业微信' },
              { label: '应收款逾期', desc: '应收款超过30天未收', enabled: false, channel: '邮件' },
              { label: '审批结果通知', desc: '审批通过或驳回时', enabled: true, channel: '全部' },
              { label: '系统异常告警', desc: '数据库或服务异常时', enabled: true, channel: '全部' },
            ].map(rule => (
              <div key={rule.label} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: '#1e293b' }}>{rule.label}</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>{rule.desc}</div>
                </div>
                <span style={{ fontSize: '12px', padding: '2px 8px', background: '#f1f5f9', color: '#475569', borderRadius: '8px' }}>{rule.channel}</span>
                <button
                  className={`${styles.toggle} ${rule.enabled ? styles.toggleOn : styles.toggleOff}`}
                  type="button"
                  style={{ width: '36px', height: '20px' }}
                  onClick={() => {}}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.actions}>
          <button type="submit" className={styles.saveBtn}>
            {saved ? '✓ 保存成功' : '保存设置'}
          </button>
        </div>
      </form>
    </div>
  )
}
