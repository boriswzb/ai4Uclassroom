'use client'
import { use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import styles from './product-detail.module.css'

interface Product {
  id: string; code: string; name: string; category: string; unit: string
  price: number; cost: number; stock: number; minStock: number
  warehouse: string; supplier: string; barcode: string
  weight: number; dimensions: string; description: string; createdAt: string
}

const mockProducts: Record<string, Product> = {
  '1': {
    id: '1', code: 'P-2025-00001', name: '企业路由器 R2000', category: '网络设备', unit: '台',
    price: 800, cost: 480, stock: 156, minStock: 50, warehouse: '深圳仓',
    supplier: '深圳市腾达科技有限公司', barcode: '6901234567890',
    weight: 0.8, dimensions: '30x20x5cm', description: '高性能企业级路由器，支持千兆网络',
    createdAt: '2024-06-15 10:00:00'
  },
  '2': {
    id: '2', code: 'P-2025-00002', name: '商务笔记本 ThinkPad L15', category: '电脑设备', unit: '台',
    price: 5500, cost: 4200, stock: 28, minStock: 30, warehouse: '深圳仓',
    supplier: '广州中商贸易有限公司', barcode: '6902345678901',
    weight: 1.9, dimensions: '36x25x2cm', description: 'Intel i5处理器，8GB内存，512GB SSD',
    createdAt: '2024-08-20 10:00:00'
  },
}

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const product = mockProducts[id] || { ...mockProducts['1'], id, name: '未知商品' }
  const isLowStock = product.stock < product.minStock

  const handleDelete = async () => {
    if (!confirm('确定要删除这个商品吗？')) return
    try {
      const res = await fetch(`/erp/api/erp/inventory/products/${id}`, { method: 'DELETE' })
      if (res.ok) router.push('/erp/inventory/products')
      else { const d = await res.json().catch(() => ({})); alert(d.message || '删除失败') }
    } catch { alert('网络错误') }
  }

  return (
    <div>
      <div className={styles.header}>
        <button onClick={() => router.back()} className={styles.backBtn}>← 返回</button>
        <div className={styles.headerInfo}>
          <h1 className={styles.title}>{product.name}</h1>
          {isLowStock && <span className={styles.stockWarning}>⚠️ 库存不足</span>}
        </div>
      </div>
      <div className={styles.container}>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>基本信息</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}><span className={styles.infoLabel}>商品编码</span><span className={styles.infoValue}>{product.code}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>商品名称</span><span className={styles.infoValue}>{product.name}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>商品分类</span><span className={styles.infoValue}>{product.category}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>单位</span><span className={styles.infoValue}>{product.unit}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>条码</span><span className={styles.infoValue}>{product.barcode}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>重量</span><span className={styles.infoValue}>{product.weight}kg</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>规格</span><span className={styles.infoValue}>{product.dimensions}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>供应商</span><span className={styles.infoValue}>{product.supplier}</span></div>
          </div>
        </div>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>库存信息</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}><span className={styles.infoLabel}>当前库存</span>
              <span className={styles.infoValue} style={{ color: isLowStock ? '#f87171' : '#10b981', fontWeight: 600 }}>
                {product.stock} {product.unit}
              </span>
            </div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>最低库存</span><span className={styles.infoValue}>{product.minStock} {product.unit}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>仓库</span><span className={styles.infoValue}>{product.warehouse}</span></div>
          </div>
        </div>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>财务信息</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}><span className={styles.infoLabel}>参考进价</span><span className={styles.infoValue}>¥{product.cost.toLocaleString()}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>参考售价</span><span className={styles.infoValue}>¥{product.price.toLocaleString()}</span></div>
            <div className={styles.infoItem}><span className={styles.infoLabel}>库存价值</span><span className={styles.infoValue}>¥{(product.stock * product.cost).toLocaleString()}</span></div>
          </div>
        </div>
        {product.description && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>商品描述</h2>
            <p className={styles.remark}>{product.description}</p>
          </div>
        )}
        <div className={styles.actions}>
          <Link href="/erp/inventory/products" className={styles.backLink}>← 返回列表</Link>
          <div className={styles.actionBtns}>
            <Link href={`/erp/inventory/products/${id}/edit`} className={styles.editBtn}>✏️ 编辑</Link>
            <button className={styles.deleteBtn} onClick={handleDelete}>🗑️ 删除</button>
          </div>
        </div>
      </div>
    </div>
  )
}
