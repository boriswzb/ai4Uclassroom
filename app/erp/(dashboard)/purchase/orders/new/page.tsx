'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import styles from './new-order.module.css'

interface OrderItem {
  id: string
  productId: string
  productName: string
  quantity: number
  unitPrice: number
}

interface Supplier {
  id: string
  name: string
}

interface Product {
  id: string
  sku: string
  name: string
  costPrice: number
}

export default function NewPurchaseOrderPage() {
  const router = useRouter()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0])
  const [expectedDate, setExpectedDate] = useState('')
  const [items, setItems] = useState<OrderItem[]>([
    { id: '1', productId: '', productName: '', quantity: 1, unitPrice: 0 },
  ])
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // 获取供应商列表
    fetch('/erp/api/contacts?isSupplier=true')
      .then(r => r.json())
      .then(data => {
        if (data.success && Array.isArray(data.data.items)) {
          setSuppliers(data.data.items)
        }
      })
      .catch(() => {})

    // 获取产品列表
    fetch('/erp/api/products')
      .then(r => r.json())
      .then(data => {
        if (data.success && Array.isArray(data.data.items)) {
          setProducts(data.data.items)
        }
      })
      .catch(() => {})
  }, [])

  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const tax = Math.round(subtotal * 0.13)
  const totalAmount = subtotal + tax

  const addItem = () => {
    setItems([...items, { id: crypto.randomUUID(), productId: '', productName: '', quantity: 1, unitPrice: 0 }])
  }

  const removeItem = (id: string) => {
    if (items.length > 1) {
      setItems(items.filter(item => item.id !== id))
    }
  }

  const updateItem = (id: string, field: keyof OrderItem, value: string | number) => {
    setItems(items.map(item => {
      if (item.id !== id) return item
      const updated = { ...item, [field]: value }
      // 当选择商品时，自动填充价格（采购价）
      if (field === 'productId' && typeof value === 'string') {
        const product = products.find(p => p.id === value)
        if (product) {
          updated.productName = product.name
          updated.unitPrice = product.costPrice
        }
      }
      return updated
    }))
  }

  const handleSubmit = async () => {
    if (!supplierId) {
      setError('请选择供应商')
      return
    }
    if (!items.some(item => item.productId && item.quantity > 0)) {
      setError('请至少添加一个商品')
      return
    }

    setError('')
    setSubmitting(true)

    try {
      const res = await fetch('/erp/api/purchase/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: supplierId,
          orderDate,
          expectedDate: expectedDate || undefined,
          items: items.filter(item => item.productId).map(item => ({
            productName: item.productName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
          remark: remark || undefined,
        }),
      })

      if (res.ok) {
        router.push('/erp/purchase/orders')
      } else {
        const err = await res.json()
        setError(err.message || '创建失败')
      }
    } catch (e) {
      setError('网络错误')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className={styles.header}>
        <button onClick={() => router.back()} className={styles.backBtn}>← 返回</button>
        <h1 className={styles.title}>新建采购订单</h1>
      </div>

      <div className={styles.container}>
        {/* 基本信息 */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>基本信息</h2>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label className={styles.label}>供应商 *</label>
              <select
                className={styles.select}
                value={supplierId}
                onChange={e => setSupplierId(e.target.value)}
                required
              >
                <option value="">请选择供应商</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>订单日期</label>
              <input
                type="date"
                className={styles.input}
                value={orderDate}
                onChange={e => setOrderDate(e.target.value)}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>预计到货日期</label>
              <input
                type="date"
                className={styles.input}
                value={expectedDate}
                onChange={e => setExpectedDate(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* 商品明细 */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>商品明细</h2>
          <div className={styles.itemsTable}>
            <div className={styles.itemsHeader}>
              <span className={styles.colProduct}>商品名称</span>
              <span className={styles.colQty}>数量</span>
              <span className={styles.colPrice}>单价（元）</span>
              <span className={styles.colSubtotal}>小计</span>
              <span className={styles.colAction}></span>
            </div>
            {items.map(item => (
              <div key={item.id} className={styles.itemRow}>
                <div className={styles.colProduct}>
                  <select
                    className={styles.select}
                    value={item.productId}
                    onChange={e => updateItem(item.id, 'productId', e.target.value)}
                  >
                    <option value="">请选择商品</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name} (¥{p.costPrice})</option>
                    ))}
                  </select>
                </div>
                <div className={styles.colQty}>
                  <input
                    type="number"
                    className={styles.input}
                    min="1"
                    value={item.quantity}
                    onChange={e => updateItem(item.id, 'quantity', parseInt(e.target.value) || 0)}
                  />
                </div>
                <div className={styles.colPrice}>
                  <input
                    type="number"
                    className={styles.input}
                    min="0"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={e => updateItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className={styles.colSubtotal}>
                  <span className={styles.subtotal}>¥{(item.quantity * item.unitPrice).toLocaleString()}</span>
                </div>
                <div className={styles.colAction}>
                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={() => removeItem(item.id)}
                    disabled={items.length === 1}
                  >🗑️</button>
                </div>
              </div>
            ))}
            <button type="button" className={styles.addItemBtn} onClick={addItem}>+ 添加商品</button>
          </div>
        </div>

        {/* 金额汇总 */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>金额汇总</h2>
          <div className={styles.amountSummary}>
            <div className={styles.amountRow}>
              <span>商品金额：</span>
              <span>¥{subtotal.toLocaleString()}</span>
            </div>
            <div className={styles.amountRow}>
              <span>税率（13%）：</span>
              <span>¥{tax.toLocaleString()}</span>
            </div>
            <div className={`${styles.amountRow} ${styles.totalRow}`}>
              <span>订单总额：</span>
              <span className={styles.totalAmount}>¥{totalAmount.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* 备注 */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>备注</h2>
          <textarea
            className={styles.textarea}
            rows={3}
            placeholder="请输入备注信息..."
            value={remark}
            onChange={e => setRemark(e.target.value)}
          />
        </div>

        {/* 操作按钮 */}
        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={() => router.back()}>取消</button>
          <button type="button" className={styles.draftBtn}>保存草稿</button>
          <button type="button" className={styles.submitBtn} onClick={() => handleSubmit()} disabled={submitting}>提交订单</button>
        </div>
      </div>
    </div>
  )
}
