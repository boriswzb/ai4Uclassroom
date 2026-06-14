'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './warehouses-table.module.css'

interface Warehouse {
  id: string
  code: string
  name: string
  address: string
  manager: string
  productCount: number
  isDefault: boolean
}

const mockWarehouses: Warehouse[] = [
  { id: '1', code: 'SZ-WH01', name: '深圳仓', address: '广东省深圳市宝安区福永街道兴围社区物流园A栋', manager: '张经理', productCount: 128, isDefault: true },
  { id: '2', code: 'GZ-WH01', name: '广州仓', address: '广东省广州市白云区江高镇白云工业园B栋', manager: '李经理', productCount: 86, isDefault: false },
  { id: '3', code: 'SH-WH01', name: '上海仓', address: '上海市松江区小昆山镇定才路188号物流中心', manager: '王经理', productCount: 64, isDefault: false },
]

export function WarehousesTable() {
  const router = useRouter()
  const [warehouses] = useState(mockWarehouses)

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>仓库编码</th>
            <th>仓库名称</th>
            <th>地址</th>
            <th>负责人</th>
            <th className={styles.rightCell}>商品种类</th>
            <th>默认仓</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {warehouses.map(w => (
            <tr key={w.id} className={styles.row}>
              <td><span className={styles.code}>{w.code}</span></td>
              <td><span className={styles.name}>{w.name}</span></td>
              <td className={styles.address}>{w.address}</td>
              <td>{w.manager}</td>
              <td className={styles.rightCell}>{w.productCount} 种</td>
              <td>{w.isDefault ? <span className={styles.defaultBadge}>默认</span> : '-'}</td>
              <td>
                <div className={styles.actions}>
                  <button className={styles.actionBtn} title="详情" onClick={() => router.push(`/erp/inventory/warehouses/${w.id}`)}>🔍</button>
                  <button className={styles.actionBtn} title="编辑">✏️</button>
                  <button className={styles.actionBtn} title="删除">🗑️</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
