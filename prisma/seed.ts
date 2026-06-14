import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.resolve(__dirname, 'dev.db')
const adapter = new PrismaLibSql({ url: `file:${dbPath}` })
const prisma = new PrismaClient({ adapter })

async function main() {
  // ========== 仓库 ==========
  const wh1 = await prisma.warehouse.create({
    data: { code: 'WH-001', name: '总部仓库', location: '深圳市南山区科技园', manager: '李主管', capacity: 5000, used: 3200, status: 'active' }
  })
  const wh2 = await prisma.warehouse.create({
    data: { code: 'WH-002', name: '分部仓库', location: '广州市天河区', manager: '张主管', capacity: 3000, used: 1200, status: 'active' }
  })

  // ========== 产品 ==========
  const products = await Promise.all([
    prisma.product.create({ data: { code: 'ELEC-001', name: '联想ThinkPad笔记本', category: 'electronics', unit: '台', cost: 5500, price: 6500, reorderPoint: 10, warehouseId: wh1.id } }),
    prisma.product.create({ data: { code: 'ELEC-002', name: '戴尔显示器27寸', category: 'electronics', unit: '台', cost: 1400, price: 1800, reorderPoint: 10, warehouseId: wh1.id } }),
    prisma.product.create({ data: { code: 'ELEC-003', name: '机械键盘87键', category: 'computer', unit: '把', cost: 220, price: 299, reorderPoint: 15, warehouseId: wh1.id } }),
    prisma.product.create({ data: { code: 'OFFICE-001', name: '得力订书机', category: 'office', unit: '个', cost: 20, price: 35, reorderPoint: 50, warehouseId: wh1.id } }),
    prisma.product.create({ data: { code: 'OFFICE-002', name: '中性笔（黑色）', category: 'office', unit: '支', cost: 3, price: 5, reorderPoint: 20, warehouseId: wh1.id } }),
    prisma.product.create({ data: { code: 'ELEC-004', name: '罗技无线鼠标', category: 'computer', unit: '个', cost: 65, price: 89, reorderPoint: 30, warehouseId: wh1.id } }),
  ])

  // ========== 供应商 ==========
  const vendors = await Promise.all([
    prisma.vendor.create({ data: { name: '联想（北京）有限公司', category: 'it', contact: '采购部', email: 'b2b@lenovo.com.cn', phone: '400-100-2000', address: '北京市海淀区上地西路6号', payable: 156000, rating: 5 } }),
    prisma.vendor.create({ data: { name: '得力集团有限公司', category: 'office', contact: '陈经理', email: 'b2b@delicloud.com', phone: '400-100-3000', address: '浙江省宁波市鄞州区', payable: 42000, rating: 5 } }),
    prisma.vendor.create({ data: { name: '成都万事达物流', category: 'logistics', contact: '赵经理', email: 'order@wsdwl.com', phone: '028-65001234', address: '四川省成都市双流区', payable: 28000, rating: 4 } }),
    prisma.vendor.create({ data: { name: '深圳华强电子', category: 'it', contact: '林总', email: 'sales@hq.com', phone: '0755-83001234', address: '深圳市福田区华强北路', payable: 89000, rating: 4 } }),
  ])

  // ========== 公司 ==========
  const companies = await Promise.all([
    prisma.company.create({ data: { name: '深圳市腾达科技有限公司', industry: 'tech', contact: '张经理', email: 'purchase@tengda.com', phone: '0755-26551234', city: '深圳', type: 'customer', revenue: 1850000, employees: 256, tags: '["优质客户","科技"]' } }),
    prisma.company.create({ data: { name: '广州中商贸易有限公司', industry: 'trade', contact: '李总监', email: 'order@zhongshang.com', phone: '020-88888888', city: '广州', type: 'customer', revenue: 3200000, employees: 89, tags: '["贸易","华南"]' } }),
    prisma.company.create({ data: { name: '北京华联集团', industry: 'trade', contact: '王总', email: 'procurement@hualian.com', phone: '010-66668888', city: '北京', type: 'customer', revenue: 8900000, employees: 1200, tags: '["集团客户","华北"]' } }),
    prisma.company.create({ data: { name: '上海星火电子', industry: 'tech', contact: '刘总', email: 'info@xinghuo.com', phone: '021-55001234', city: '上海', type: 'customer', revenue: 890000, employees: 45, tags: '["科技","华东"]' } }),
    prisma.company.create({ data: { name: '杭州云智科技', industry: 'tech', contact: '周总监', email: 'buy@yunzhi.com', phone: '0571-88001234', city: '杭州', type: 'customer', revenue: 2100000, employees: 120, tags: '["优质客户","科技","华东"]' } }),
  ])

  // ========== 联系人 ==========
  await Promise.all([
    prisma.contact.create({ data: { name: '张经理', email: 'purchase@tengda.com', phone: '0755-26551234', isCustomer: true, isSupplier: false, receivable: 185000, payable: 0, tags: '["优质客户"]', companyId: companies[0].id } }),
    prisma.contact.create({ data: { name: '李总监', email: 'order@zhongshang.com', phone: '020-88888888', isCustomer: true, isSupplier: false, receivable: 320000, payable: 0, tags: '["贸易"]', companyId: companies[1].id } }),
    prisma.contact.create({ data: { name: '王总', email: 'procurement@hualian.com', phone: '010-66668888', isCustomer: true, isSupplier: false, receivable: 127000, payable: 0, tags: '["集团客户"]', companyId: companies[2].id } }),
    prisma.contact.create({ data: { name: '刘总', email: 'info@xinghuo.com', phone: '021-55001234', isCustomer: true, isSupplier: false, receivable: 89000, payable: 0, tags: '["科技"]', companyId: companies[3].id } }),
    prisma.contact.create({ data: { name: '周总监', email: 'buy@yunzhi.com', phone: '0571-88001234', isCustomer: true, isSupplier: false, receivable: 210000, payable: 0, tags: '["优质客户","科技"]', companyId: companies[4].id } }),
  ])

  // ========== 商机 ==========
  await Promise.all([
    prisma.deal.create({ data: { name: '腾达科技 ERP采购项目', companyId: companies[0].id, amount: 580000, stage: 'negotiation', probability: 70, source: 'referral', expectedClose: '2026-06-15' } }),
    prisma.deal.create({ data: { name: '中商贸易 办公设备采购', companyId: companies[1].id, amount: 126000, stage: 'proposal', probability: 50, source: 'exhibition', expectedClose: '2026-06-30' } }),
    prisma.deal.create({ data: { name: '华联集团 批量采购计划', companyId: companies[2].id, amount: 890000, stage: 'qualification', probability: 20, source: 'cold_call', expectedClose: '2026-08-01' } }),
    prisma.deal.create({ data: { name: '星火电子 服务器升级', companyId: companies[3].id, amount: 320000, stage: 'contract', probability: 90, source: 'online', expectedClose: '2026-05-20' } }),
    prisma.deal.create({ data: { name: '云智科技 年度维保服务', companyId: companies[4].id, amount: 85000, stage: 'negotiation', probability: 75, source: 'referral', expectedClose: '2026-05-25' } }),
  ])

  // ========== 销售订单 ==========
  const so1 = await prisma.salesOrder.create({
    data: { orderNo: 'SO-2026-000047', customerId: companies[0].id, contact: '张经理', date: '2026-05-10', amount: 89990, status: 'confirmed', payment: 'paid' }
  })
  await prisma.salesOrderItem.create({ data: { orderId: so1.id, productId: products[0].id, productName: products[0].name, quantity: 1, unit: products[0].unit, price: products[0].price, subtotal: 6500 } })
  await prisma.salesOrderItem.create({ data: { orderId: so1.id, productId: products[1].id, productName: products[1].name, quantity: 2, unit: products[1].unit, price: products[1].price, subtotal: 3600 } })
  await prisma.salesOrderItem.create({ data: { orderId: so1.id, productId: products[5].id, productName: products[5].name, quantity: 10, unit: products[5].unit, price: products[5].price, subtotal: 890 } })

  // ========== 采购订单 ==========
  await prisma.purchaseOrder.create({
    data: { orderNo: 'PO-2026-000031', vendorId: vendors[1].id, contact: '陈经理', date: '2026-05-08', amount: 42000, status: 'completed', payment: 'paid' }
  })

  // ========== 库移动作 ==========
  await prisma.inventoryMove.create({ data: { moveNo: 'ST-2026-000089', type: 'in', productId: products[5].id, quantity: 100, warehouseId: wh1.id, operator: '李主管', date: '2026-05-12', status: 'completed', remark: '供应商送货' } })

  // ========== 发票 ==========
  await prisma.invoice.create({ data: { invoiceNo: 'INV-2026-00047', companyId: companies[0].id, type: 'sales', amount: 89990, taxAmount: 11699, totalAmount: 101689, status: 'paid', issueDate: '2026-05-10', dueDate: '2026-06-10', paidDate: '2026-05-15' } })

  // ========== 收款 ==========
  await prisma.payment.create({ data: { paymentNo: 'RV-2026-000045', type: 'receivable', companyId: companies[0].id, amount: 101689, relatedDoc: 'INV-2026-00047', date: '2026-05-15', method: '银行转账', status: 'confirmed', remark: '订单收款' } })

  // ========== 日记账 ==========
  await prisma.journalEntry.create({ data: { date: '2026-05-15', voucherNo: 'JZ-2026-00089', type: 'sales', account: '银行存款', debit: 101689, credit: 0, counterparty: '深圳市腾达科技有限公司', remark: '收款', sourceDoc: 'RV-2026-000045' } })
  await prisma.journalEntry.create({ data: { date: '2026-05-15', voucherNo: 'JZ-2026-00089', type: 'sales', account: '应收账款', debit: 0, credit: 101689, counterparty: '深圳市腾达科技有限公司', remark: '收款', sourceDoc: 'RV-2026-000045' } })

  console.log('Seed data created successfully!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
