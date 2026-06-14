'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import styles from './edit-order.module.css'

interface OrderItem {
  id: string
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  discount: number
  taxRate: number
}

interface Customer {
  id: string
  name: string
}

interface Product {
  id: string
  sku: string
  name: string
  sellingPrice: number
}

interface OrderDetail {
  id: string
  orderNo: string
  contactId: string
  contactName: string
  status: string
  orderDate: string
  deliveryDate: string
  remark: string
  items: { productName: string; quantity: number; unitPrice: number; discount: number; taxRate: number }[]
}

export default function EditSalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [contactId, setContactId] = useState('')
  const [orderDate, setOrderDate] = useState('')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [items, setItems] = useState<OrderItem[]>([
    { id: '1', productId: '', productName: '', quantity: 1, unitPrice: 0, discount: 0, taxRate: 13 },
  ])
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    // 获取客户列表
    fetch('/erp/api/contacts?isCustomer=true')
      .then(r => r.json())
      .then(data => {
        if (data.success && Array.isArray(data.data.items)) {
          setCustomers(data.data.items)
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

    // 获取订单数据
    fetch(`/erp/api/sales/orders/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && data.data) {
          const order: OrderDetail = data.data
          setContactId(order.contactId)
          setOrderDate(order.orderDate ? order.orderDate.split('T')[0] : '')
          setDeliveryDate(order.deliveryDate ? order.deliveryDate.split('T')[0] : '')
          setRemark(order.remark || '')
          if (order.items && order.items.length > 0) {
            setItems(order.items.map((item, idx) => ({
              id: String(idx + 1),
              productId: '',
              productName: item.productName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount,
              taxRate: item.taxRate,
            })))
          }
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  const subtotal = items.reduce((sum, item) => {
    return sum + item.quantity * item.unitPrice * (1 - item.discount / 100)
  }, 0)
  const discountAmount = items.reduce((sum, item) => {
    return sum + item.quantity * item.unitPrice * (item.discount / 100)
  }, 0)
  const taxAmount = subtotal * 0.13
  const totalAmount = subtotal + taxAmount

  const addItem = () => {
    setItems([...items, { id: crypto.randomUUID(), productId: '', productName: '', quantity: 1, unitPrice: 0, discount: 0, taxRate: 13 }])
  }

  const removeItem = (id: string) => {
    if (items.length > 1) setItems(items.filter(item => item.id !== id))
  }

  const updateItem = (id: string, field: keyof OrderItem, value: string | number) => {
    setItems(items.map(item => {
      if (item.id !== id) return item
      const updated = { ...item, [field]: value }
      // 当选择商品时，自动填充价格
      if (field === 'productId' && typeof value === 'string') {
        const product = products.find(p => p.id === value)
        if (product) {
          updated.productName = product.name
          updated.unitPrice = product.sellingPrice
        }
      }
      return updated
    }))
  }

  const itemSubtotal = (item: OrderItem) => {
    return item.quantity * item.unitPrice * (1 - item.discount / 100)
  }

  const handleSubmit = async () => {
    if (!contactId) {
      setError('请选择客户')
      return
    }
    if (!items.some(item => item.productName && item.quantity > 0)) {
      setError('请至少添加一个商品')
      return
    }

    setError('')
    setSubmitting(true)

    try {
      const res = await fetch(`/erp/api/sales/orders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId,
          orderDate: orderDate || undefined,
          deliveryDate: deliveryDate || undefined,
          items: items.filter(item => item.productName).map(item => ({
            productName: item.productName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount,
            taxRate: item.taxRate,
          })),
          remark: remark || undefined,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        router.push(`/erp/sales/orders/${id}`)
      } else {
        const err = await res.json()
        setError(err.message || '更新失败')
      }
    } catch (e) {
      setError('网络错误')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <span>加载中...</span>
      </div>
    )
  }

  return (
    <div>
      <div className={styles.header}>
        <button onClick={() => router.back()} className={styles.backBtn}>← 返回</button>
        <h1 className={styles.title}>编辑销售订单</h1>
      </div>

      <div className={styles.container}>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>基本信息</h2>
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label className={styles.label}>客户 *</label>
              <select className={styles.select} value={contactId} onChange={e => setContactId(e.target.value)} required>
                <option value="">请选择客户</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>订单日期</label>
              <input type="date" className={styles.input} value={orderDate} onChange={e => setOrderDate(e.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>交货日期</label>
              <input type="date" className={styles.input} value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>商品明细</h2>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.itemsTable}>
            <div className={styles.itemsHeader}>
              <span className={styles.colProduct}>商品名称</span>
              <span className={styles.colQty}>数量</span>
              <span className={styles.colPrice}>单价</span>
              <span className={styles.colDiscount}>折扣%</span>
              <span className={styles.colSubtotal}>小计</span>
              <span className={styles.colAction}></span>
            </div>
            {items.map(item => (
              <div key={item.id} className={styles.itemRow}>
                <div className={styles.colProduct}>
                  <select className={styles.select} value={item.productId} onChange={e => updateItem(item.id, 'productId', e.target.value)}>
                    <option value="">请选择商品</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name} (¥{p.sellingPrice})</option>)}
                  </select>
                  {!item.productId && item.productName && (
                    <span className={styles.productNameLabel}>{item.productName}</span>
                  )}
                </div>
                <div className={styles.colQty}>
                  <input type="number" className={styles.input} min="1" value={item.quantity} onChange={e => updateItem(item.id, 'quantity', parseInt(e.target.value) || 0)} />
                </div>
                <div className={styles.colPrice}>
                  <input type="number" className={styles.input} min="0" step="0.01" value={item.unitPrice} onChange={e => updateItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)} />
                </div>
                <div className={styles.colDiscount}>
                  <input type="number" className={styles.input} min="0" max="100" value={item.discount} onChange={e => updateItem(item.id, 'discount', parseFloat(e.target.value) || 0)} />
                </div>
                <div className={styles.colSubtotal}>
                  <span className={styles.subtotal}>¥{itemSubtotal(item).toLocaleString()}</span>
                </div>
                <div className={styles.colAction}>
                  <button type="button" className={styles.removeBtn} onClick={() => removeItem(item.id)} disabled={items.length === 1}>🗑️</button>
                </div>
              </div>
            ))}
            <button type="button" className={styles.addItemBtn} onClick={addItem}>+ 添加商品</button>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>金额汇总</h2>
          <div className={styles.amountSummary}>
            <div className={styles.amountRow}>
              <span>商品金额：</span><span>¥{subtotal.toLocaleString()}</span>
            </div>
            <div className={styles.amountRow}>
              <span>折扣金额：</span><span className={styles.discount}>-¥{discountAmount.toLocaleString()}</span>
            </div>
            <div className={styles.amountRow}>
              <span>税额（13%）：</span><span>¥{taxAmount.toLocaleString()}</span>
            </div>
            <div className={`${styles.amountRow} ${styles.totalRow}`}>
              <span>订单总额：</span><span className={styles.totalAmount}>¥{totalAmount.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>备注</h2>
          <textarea className={styles.textarea} rows={3} placeholder="请输入备注信息..." value={remark} onChange={e => setRemark(e.target.value)} />
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={() => router.back()}>取消</button>
          <button type="button" className={styles.submitBtn} onClick={handleSubmit} disabled={submitting}>
            {submitting ? '保存中...' : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  )
}