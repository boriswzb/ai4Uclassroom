'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './sidebar.module.css'

const BASE = '/erp'

const menuItems = [
  {
    group: '经营概览',
    items: [
      { label: '管理驾驶舱', href: `${BASE}/dashboard`, icon: '🚀', sub: [
        { label: '经营大屏', href: `${BASE}/dashboard` },
        { label: '数据驾驶舱', href: `${BASE}/cockpit` },
      ]},
    ],
  },
  {
    group: '客户关系',
    items: [
      { label: '客户管理', href: `${BASE}/crm`, icon: '👥', sub: [
        { label: '联系人', href: `${BASE}/crm/contacts` },
        { label: '公司', href: `${BASE}/crm/companies` },
        { label: '商机', href: `${BASE}/crm/deals` },
      ]},
    ],
  },
  {
    group: '销售',
    items: [
      { label: '销售订单', href: `${BASE}/sales/orders`, icon: '📋', sub: [
        { label: '所有订单', href: `${BASE}/sales/orders` },
        { label: '新建订单', href: `${BASE}/sales/orders/new` },
      ]},
      { label: '发票管理', href: `${BASE}/accounting/invoices`, icon: '📄' },
    ],
  },
  {
    group: '采购',
    items: [
      { label: '采购订单', href: `${BASE}/purchase/orders`, icon: '🛒', sub: [
        { label: '所有订单', href: `${BASE}/purchase/orders` },
        { label: '供应商', href: `${BASE}/purchase/vendors` },
      ]},
    ],
  },
  {
    group: '库存',
    items: [
      { label: '库存管理', href: `${BASE}/inventory/products`, icon: '📦', sub: [
        { label: '产品目录', href: `${BASE}/inventory/products` },
        { label: '仓库', href: `${BASE}/inventory/warehouses` },
        { label: '库移动作', href: `${BASE}/inventory/moves` },
      ]},
    ],
  },
  {
    group: '财务',
    items: [
      { label: '发票', href: `${BASE}/accounting/invoices`, icon: '💹' },
      { label: '收款/付款', href: `${BASE}/accounting/payments`, icon: '💰' },
      { label: '日记账', href: `${BASE}/accounting/journal`, icon: '📒' },
      { label: '会计科目', href: `${BASE}/accounting/accounts`, icon: '🗂️' },
      { label: '报表', href: `${BASE}/accounting/reports`, icon: '📊' },
    ],
  },
  {
    group: 'AI 智能',
    items: [
      { label: 'AI 分析', href: `${BASE}/ai`, icon: '🤖' },
    ],
  },
  {
    group: '系统',
    items: [
      { label: '设置', href: `${BASE}/settings`, icon: '⚙️', sub: [
        { label: '组织信息', href: `${BASE}/settings/organization` },
        { label: '用户管理', href: `${BASE}/settings/users` },
        { label: '角色权限', href: `${BASE}/settings/roles` },
        { label: '模块开关', href: `${BASE}/settings/modules` },
      ]},
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className={styles.sidebar}>
      {/* Logo */}
      <div className={styles.logo}>
        <span className={styles.logoIcon}>🏢</span>
        <div>
          <div className={styles.logoName}>OpenMAIC</div>
          <div className={styles.logoSub}>ERP System</div>
        </div>
      </div>

      {/* Search */}
      <div className={styles.searchBox}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input placeholder="搜索功能..." className={styles.searchInput} />
      </div>

      {/* Menu */}
      <nav className={styles.nav}>
        {menuItems.map(group => (
          <div key={group.group} className={styles.group}>
            <div className={styles.groupLabel}>{group.group}</div>
            {group.items.map(item => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
              return (
                <div key={item.href}>
                  <Link
                    href={item.href}
                    className={`${styles.menuItem} ${isActive ? styles.active : ''}`}
                  >
                    <span className={styles.menuIcon}>{item.icon}</span>
                    <span className={styles.menuLabel}>{item.label}</span>
                    {item.sub && <span className={styles.arrow}>›</span>}
                  </Link>
                  {item.sub && isActive && (
                    <div className={styles.subMenu}>
                      {item.sub.map(sub => (
                        <Link
                          key={sub.href}
                          href={sub.href}
                          className={`${styles.subItem} ${pathname === sub.href ? styles.activeSub : ''}`}
                        >
                          {sub.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Bottom: Org switcher + User */}
      <div className={styles.bottom}>
        <div className={styles.orgSwitcher}>
          <span className={styles.orgIcon}>🏭</span>
          <span className={styles.orgName}>ACME 演示公司</span>
          <span className={styles.orgBadge}>PRO</span>
        </div>
        <div className={styles.user}>
          <div className={styles.userAvatar}>👤</div>
          <div className={styles.userInfo}>
            <div className={styles.userName}>管理员</div>
            <div className={styles.userRole}>OWNER</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
