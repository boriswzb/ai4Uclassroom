import { Suspense } from 'react'
import Link from 'next/link'
import { Topbar } from '@/erp/layout/topbar'
import { ProductsTable } from './products-table'
import styles from './products.module.css'

export default function InventoryProductsPage() {
  return (
    <div>
      <Topbar title="产品目录" breadcrumb={[{ label: '库存管理' }, { label: '产品目录' }]} />
      <div className={styles.container}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <input type="search" placeholder="搜索SKU、产品名称..." className={styles.searchInput} />
            <select className={styles.filterSelect}>
              <option value="">全部分类</option>
              <option value="电子设备">电子设备</option>
              <option value="办公家具">办公家具</option>
              <option value="网络设备">网络设备</option>
              <option value="软件服务">软件服务</option>
            </select>
            <select className={styles.filterSelect}>
              <option value="">全部类型</option>
              <option value="STANDARD">标准产品</option>
              <option value="SERVICE">服务</option>
              <option value="CONSUMABLE">消耗品</option>
            </select>
          </div>
          <div className={styles.toolbarRight}>
            <Link href="/erp/inventory/products/new" className={styles.primaryBtn}>+ 新建产品</Link>
          </div>
        </div>
        <Suspense fallback={<div className={styles.loading}>加载中...</div>}>
          <ProductsTable />
        </Suspense>
      </div>
    </div>
  )
}
