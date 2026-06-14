import { Topbar } from '@/erp/layout/topbar'
import Link from 'next/link'
import styles from './vendors.module.css'

interface Vendor {
  id: string
  name: string
  contact: string
  phone: string
  email: string
  city: string
  category: string
  payable: number
  createdAt: string
}

const mockVendors: Vendor[] = [
  { id: '1', name: '联想（北京）有限公司', contact: '张经理', phone: '400-100-2000', email: 'procurement@lenovo.com.cn', city: '北京', category: '办公设备', payable: 156000, createdAt: '2024-01-01' },
  { id: '2', name: '得力集团有限公司', contact: '李小姐', phone: '400-100-3000', email: 'b2b@delicloud.com', city: '宁波', category: '办公用品', payable: 42000, createdAt: '2024-01-05' },
  { id: '3', name: '成都万事达物流', contact: '王师傅', phone: '028-65001234', email: 'order@wsdwl.com', city: '成都', category: '物流服务', payable: 28000, createdAt: '2024-04-15' },
  { id: '4', name: '深圳华强电子', contact: '赵总', phone: '0755-83001234', email: 'sales@hqew.com', city: '深圳', category: '电子元器件', payable: 89000, createdAt: '2024-03-20' },
  { id: '5', name: '广州建材批发', contact: '陈老板', phone: '020-32001234', email: 'order@gzjc.com', city: '广州', category: '五金建材', payable: 55000, createdAt: '2024-06-10' },
]

export default function VendorsPage() {
  return (
    <div>
      <Topbar title="供应商管理" breadcrumb={[{ label: '采购管理' }, { label: '供应商' }]} />
      <div style={{ padding: 24 }}>
        <div className={styles.tableWrapper}>
          <div className={styles.toolbar}>
            <div className={styles.left}>
              <input type="checkbox" />
              <span style={{ fontSize: 13, color: '#64748b' }}>全选</span>
            </div>
            <div className={styles.right}>
              <Link href="/erp/purchase/vendors/new" className={styles.newBtn}>+ 新建供应商</Link>
            </div>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.checkboxCell}><input type="checkbox" /></th>
                <th>供应商名称</th>
                <th>联系人</th>
                <th>联系方式</th>
                <th>城市</th>
                <th>行业</th>
                <th className={styles.rightCell}>应付账款</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {mockVendors.map(vendor => (
                <tr key={vendor.id} className={styles.row}>
                  <td className={styles.checkboxCell}><input type="checkbox" /></td>
                  <td>
                    <div className={styles.nameCell}>
                      <span className={styles.name}>{vendor.name}</span>
                    </div>
                  </td>
                  <td>{vendor.contact}</td>
                  <td>
                    <div className={styles.contactCell}>
                      <span>{vendor.phone}</span>
                      <span className={styles.email}>{vendor.email}</span>
                    </div>
                  </td>
                  <td>{vendor.city}</td>
                  <td>{vendor.category}</td>
                  <td className={styles.rightCell}>
                    <span className={vendor.payable > 0 ? styles.payable : ''}>
                      {vendor.payable > 0 ? `¥${vendor.payable.toLocaleString()}` : '-'}
                    </span>
                  </td>
                  <td>
                    <div className={styles.actions}>
                      <Link href={`/erp/purchase/vendors/${vendor.id}`} className={styles.actionBtn} title="详情">🔍</Link>
                      <Link href={`/erp/purchase/vendors/${vendor.id}/edit`} className={styles.actionBtn} title="编辑">✏️</Link>
                      <button className={styles.actionBtn} title="删除">🗑️</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.pagination}>
            <span className={styles.paginationInfo}>显示 1-{mockVendors.length} 条，共 {mockVendors.length} 条</span>
            <div className={styles.paginationBtns}>
              <button className={styles.pageBtn} disabled>‹</button>
              <button className={`${styles.pageBtn} ${styles.active}`}>1</button>
              <button className={styles.pageBtn} disabled>›</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}