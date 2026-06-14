import { Topbar } from '@/erp/layout/topbar'
import styles from './settings.module.css'

export default function SettingsPage() {
  return (
    <div>
      <Topbar title="系统设置" breadcrumb={[{ label: '系统' }, { label: '设置' }]} />
      <div style={{ padding: '24px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        {[
          { icon: '🏢', label: '组织信息', desc: '公司基本信息', href: '/settings/organization' },
          { icon: '👥', label: '用户管理', desc: '管理系统用户', href: '/settings/users' },
          { icon: '🔐', label: '角色权限', desc: '定义角色和权限', href: '/settings/roles' },
          { icon: '⚙️', label: '模块开关', desc: '启用/禁用系统模块', href: '/settings/modules' },
          { icon: '🔑', label: 'API密钥', desc: '管理第三方API', href: '/settings/api-keys' },
          { icon: '📧', label: '消息通知', desc: '邮件/短信通知设置', href: '/settings/notifications' },
          { icon: '🔔', label: '操作日志', desc: '查看系统操作记录', href: '/settings/audit-log' },
          { icon: '💾', label: '数据备份', desc: '系统数据备份设置', href: '/settings/backup' },
        ].map((item, i) => (
          <a key={i} href={item.href} style={{ textDecoration: 'none' }}>
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '8px', cursor: 'pointer', transition: 'all 0.15s' }}>
              <span style={{ fontSize: '28px' }}>{item.icon}</span>
              <span style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b' }}>{item.label}</span>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>{item.desc}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
