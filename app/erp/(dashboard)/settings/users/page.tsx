'use client'

import { useState } from 'react'
import styles from './users.module.css'

interface User {
  id: string
  name: string
  email: string
  role: string
  department: string
  status: 'ACTIVE' | 'INACTIVE'
  lastLogin: string
}

const mockUsers: User[] = [
  { id: '1', name: '张总', email: 'zhang@huanchuang.com', role: '超级管理员', department: '管理层', status: 'ACTIVE', lastLogin: '2025-03-20 09:30' },
  { id: '2', name: '李明', email: 'liming@huanchuang.com', role: '管理员', department: 'IT部', status: 'ACTIVE', lastLogin: '2025-03-20 08:15' },
  { id: '3', name: '王芳', email: 'wangfang@huanchuang.com', role: '财务', department: '财务部', status: 'ACTIVE', lastLogin: '2025-03-19 17:45' },
  { id: '4', name: '刘强', email: 'liuqiang@huanchuang.com', role: '销售', department: '销售部', status: 'ACTIVE', lastLogin: '2025-03-20 10:00' },
  { id: '5', name: '陈静', email: 'chenjing@huanchuang.com', role: '采购', department: '采购部', status: 'ACTIVE', lastLogin: '2025-03-19 16:20' },
  { id: '6', name: '赵鹏', email: 'zhaopeng@huanchuang.com', role: '仓库', department: '仓储部', status: 'ACTIVE', lastLogin: '2025-03-20 07:50' },
  { id: '7', name: '周莉', email: 'zhouli@huanchuang.com', role: '销售', department: '销售部', status: 'INACTIVE', lastLogin: '2025-02-28 14:30' },
  { id: '8', name: '吴昊', email: 'wuhao@huanchuang.com', role: '财务', department: '财务部', status: 'ACTIVE', lastLogin: '2025-03-20 09:00' },
]

export default function SettingsUsersPage() {
  const [users] = useState(mockUsers)
  const [search, setSearch] = useState('')
  const filtered = users.filter(u => u.name.includes(search) || u.email.includes(search))

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>用户管理</h1>
          <p className={styles.subtitle}>管理系统的使用人员</p>
        </div>
        <button className={styles.addBtn}>+ 添加用户</button>
      </div>
      <div className={styles.toolbar}>
        <input type="search" placeholder="搜索用户..." className={styles.searchInput} value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>姓名</th>
              <th>邮箱</th>
              <th>角色</th>
              <th>部门</th>
              <th>状态</th>
              <th>最后登录</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id} className={styles.row}>
                <td><span className={styles.name}>{u.name}</span></td>
                <td>{u.email}</td>
                <td><span className={styles.roleBadge} data-role={u.role}>{u.role}</span></td>
                <td>{u.department}</td>
                <td><span className={u.status === 'ACTIVE' ? styles.activeBadge : styles.inactiveBadge}>{u.status === 'ACTIVE' ? '启用' : '禁用'}</span></td>
                <td className={styles.lastLogin}>{u.lastLogin}</td>
                <td>
                  <div className={styles.actions}>
                    <button className={styles.actionBtn}>✏️</button>
                    <button className={styles.actionBtn}>🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
