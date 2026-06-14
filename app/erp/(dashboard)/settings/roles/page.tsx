'use client'

import { useState } from 'react'
import styles from './roles.module.css'

interface Role {
  id: string
  name: string
  description: string
  userCount: number
  permissions: string[]
}

const mockRoles: Role[] = [
  { id: '1', name: '超级管理员', description: '拥有系统所有权限', userCount: 1, permissions: ['*'] },
  { id: '2', name: '管理员', description: '除系统设置外的所有权限', userCount: 1, permissions: ['crm.*', 'sales.*', 'purchase.*', 'inventory.*', 'accounting.*', 'ai.*'] },
  { id: '3', name: '财务', description: '财务和发票管理', userCount: 2, permissions: ['accounting.*', 'sales.read', 'purchase.read'] },
  { id: '4', name: '销售', description: '销售订单和客户管理', userCount: 2, permissions: ['sales.*', 'crm.*'] },
  { id: '5', name: '采购', description: '采购订单管理', userCount: 1, permissions: ['purchase.*', 'inventory.read'] },
  { id: '6', name: '仓库', description: '库存和仓库管理', userCount: 1, permissions: ['inventory.*', 'purchase.read'] },
  { id: '7', name: '只读', description: '查看所有模块数据', userCount: 0, permissions: ['*.read'] },
]

export default function SettingsRolesPage() {
  const [roles] = useState(mockRoles)

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>角色权限</h1>
          <p className={styles.subtitle}>定义角色和权限配置</p>
        </div>
        <button className={styles.addBtn}>+ 添加角色</button>
      </div>
      <div className={styles.rolesGrid}>
        {roles.map(role => (
          <div key={role.id} className={styles.roleCard}>
            <div className={styles.roleHeader}>
              <span className={styles.roleName}>{role.name}</span>
              <span className={styles.userCount}>{role.userCount} 人</span>
            </div>
            <p className={styles.roleDesc}>{role.description}</p>
            <div className={styles.permissions}>
              {role.permissions[0] === '*'
                ? <span className={styles.allPerm}>所有权限</span>
                : role.permissions.map(p => (
                    <span key={p} className={styles.permTag}>{p.replace('.*', ' (全部)').replace('.read', ' (只读)')}</span>
                  ))
              }
            </div>
            <div className={styles.roleActions}>
              <button className={styles.editBtn}>✏️ 编辑</button>
              {role.name !== '超级管理员' && <button className={styles.deleteBtn}>🗑️ 删除</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
