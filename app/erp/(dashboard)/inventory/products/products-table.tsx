'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './products-table.module.css'

type ProductType = 'STANDARD' | 'SERVICE' | 'CONSUMABLE'

interface Product {
  id: string
  sku: string
  name: string
  category: string
  unit: string
  costPrice: number
  sellingPrice: number
  stockQty: number
  reorderPoint: number
  type: ProductType
}

const mockProducts: Product[] = [
  { id: '1', sku: 'NET-R2000', name: '企业路由器 R2000', category: '网络设备', unit: '台', costPrice: 520, sellingPrice: 800, stockQty: 45, reorderPoint: 20, type: 'STANDARD' },
  { id: '2', sku: 'NET-R3000', name: '企业路由器 R3000', category: '网络设备', unit: '台', costPrice: 1050, sellingPrice: 1600, stockQty: 18, reorderPoint: 15, type: 'STANDARD' },
  { id: '3', sku: 'NET-SW24P', name: 'POE交换机 24口', category: '网络设备', unit: '台', costPrice: 1450, sellingPrice: 2200, stockQty: 12, reorderPoint: 10, type: 'STANDARD' },
  { id: '4', sku: 'NET-SW48P', name: '企业交换机 S4500-48P', category: '网络设备', unit: '台', costPrice: 2800, sellingPrice: 4200, stockQty: 8, reorderPoint: 5, type: 'STANDARD' },
  { id: '5', sku: 'NET-AP300', name: '无线AP WAP-300', category: '网络设备', unit: '台', costPrice: 290, sellingPrice: 450, stockQty: 60, reorderPoint: 25, type: 'STANDARD' },
  { id: '6', sku: 'NET-FW2000', name: '防火墙 FW-2000', category: '网络设备', unit: '台', costPrice: 22000, sellingPrice: 35000, stockQty: 3, reorderPoint: 3, type: 'STANDARD' },
  { id: '7', sku: 'IT-TPL15', name: '商务笔记本 ThinkPad L15', category: '电子设备', unit: '台', costPrice: 4200, sellingPrice: 5500, stockQty: 25, reorderPoint: 10, type: 'STANDARD' },
  { id: '8', sku: 'IT-TPX1C', name: 'ThinkPad X1 Carbon 笔记本', category: '电子设备', unit: '台', costPrice: 9500, sellingPrice: 12000, stockQty: 5, reorderPoint: 5, type: 'STANDARD' },
  { id: '9', sku: 'IT-M920T', name: 'ThinkCentre M920t 台式机', category: '电子设备', unit: '台', costPrice: 4000, sellingPrice: 5500, stockQty: 15, reorderPoint: 8, type: 'STANDARD' },
  { id: '10', sku: 'OFF-DESK01', name: '得力办公桌椅套装', category: '办公家具', unit: '套', costPrice: 550, sellingPrice: 800, stockQty: 30, reorderPoint: 10, type: 'STANDARD' },
  { id: '11', sku: 'OFF-CAB01', name: '得力文件柜', category: '办公家具', unit: '个', costPrice: 800, sellingPrice: 1200, stockQty: 22, reorderPoint: 8, type: 'STANDARD' },
  { id: '12', sku: 'SEC-SS500', name: '得力智能碎纸机', category: '办公家具', unit: '台', costPrice: 400, sellingPrice: 600, stockQty: 18, reorderPoint: 8, type: 'STANDARD' },
  { id: '13', sku: 'MON-TV50', name: 'ThinkVision 显示器', category: '电子设备', unit: '台', costPrice: 2200, sellingPrice: 3500, stockQty: 14, reorderPoint: 8, type: 'STANDARD' },
  { id: '14', sku: 'SVC-LOGIST', name: '物流服务（季度套餐）', category: '软件服务', unit: '套', costPrice: 0, sellingPrice: 15000, stockQty: 999, reorderPoint: 0, type: 'SERVICE' },
  { id: '15', sku: 'SEC-PROJ01', name: '投影仪 EB-990U', category: '电子设备', unit: '台', costPrice: 4200, sellingPrice: 6500, stockQty: 6, reorderPoint: 4, type: 'STANDARD' },
]

const typeLabels: Record<ProductType, string> = { STANDARD: '标准', SERVICE: '服务', CONSUMABLE: '消耗' }

export function ProductsTable() {
  const router = useRouter()
  const [products] = useState(mockProducts)

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.checkboxCell}><input type="checkbox" /></th>
            <th>SKU</th>
            <th>产品名称</th>
            <th>分类</th>
            <th>类型</th>
            <th className={styles.rightCell}>成本价</th>
            <th className={styles.rightCell}>销售价</th>
            <th className={styles.rightCell}>库存数量</th>
            <th className={styles.rightCell}>补货点</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {products.map(p => (
            <tr key={p.id} className={styles.row}>
              <td className={styles.checkboxCell}><input type="checkbox" /></td>
              <td><span className={styles.sku}>{p.sku}</span></td>
              <td><span className={styles.name}>{p.name}</span></td>
              <td>{p.category}</td>
              <td><span className={styles.typeBadge} data-type={p.type}>{typeLabels[p.type]}</span></td>
              <td className={styles.rightCell}>¥{p.costPrice.toLocaleString()}</td>
              <td className={styles.rightCell}>¥{p.sellingPrice.toLocaleString()}</td>
              <td className={styles.rightCell}>
                <span className={p.stockQty <= p.reorderPoint ? styles.lowStock : ''}>{p.stockQty} {p.unit}</span>
              </td>
              <td className={styles.rightCell}>{p.reorderPoint} {p.unit}</td>
              <td>
                <div className={styles.actions}>
                  <button className={styles.actionBtn} title="详情" onClick={() => router.push(`/erp/inventory/products/${p.id}`)}>🔍</button>
                  <button className={styles.actionBtn} title="编辑">✏️</button>
                  <button className={styles.actionBtn} title="删除">🗑️</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.pagination}>
        <span className={styles.paginationInfo}>显示 1-15 条，共 15 条</span>
        <div className={styles.paginationBtns}>
          <button className={styles.pageBtn} disabled>‹</button>
          <button className={`${styles.pageBtn} ${styles.active}`}>1</button>
          <button className={styles.pageBtn} disabled>›</button>
        </div>
      </div>
    </div>
  )
}
