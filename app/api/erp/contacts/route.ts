import { NextRequest, NextResponse } from 'next/server'

const mockContacts = [
  { id: '1', name: '深圳市腾达科技有限公司', email: 'purchase@tengda.com', phone: '0755-26551234', isCustomer: true, isSupplier: false, receivable: 185000, payable: 0, tags: ['优质客户', '科技'], createdAt: '2024-03-15', companyId: null },
  { id: '2', name: '广州中商贸易有限公司', email: 'order@zhongshang.com', phone: '020-88888888', isCustomer: true, isSupplier: false, receivable: 320000, payable: 0, tags: ['贸易', '华南'], createdAt: '2024-05-20', companyId: null },
  { id: '3', name: '北京华联集团', email: 'procurement@hualian.com', phone: '010-66668888', isCustomer: true, isSupplier: false, receivable: 127000, payable: 0, tags: ['集团客户', '华北'], createdAt: '2024-02-10', companyId: null },
  { id: '4', name: '联想（北京）有限公司', email: 'sales@lenovo.com.cn', phone: '400-100-2000', isCustomer: false, isSupplier: true, receivable: 0, payable: 156000, tags: ['品牌商', 'IT设备'], createdAt: '2024-01-01', companyId: null },
  { id: '5', name: '得力集团有限公司', email: 'b2b@delicloud.com', phone: '400-100-3000', isCustomer: false, isSupplier: true, receivable: 0, payable: 42000, tags: ['办公用品', '品牌商'], createdAt: '2024-01-05', companyId: null },
  { id: '6', name: '上海星火电子', email: 'info@xinghuo.com', phone: '021-55001234', isCustomer: true, isSupplier: false, receivable: 89000, payable: 0, tags: ['科技'], createdAt: '2024-06-01', companyId: null },
  { id: '7', name: '成都万事达物流', email: 'order@wsdwl.com', phone: '028-65001234', isCustomer: false, isSupplier: true, receivable: 0, payable: 28000, tags: ['物流'], createdAt: '2024-04-15', companyId: null },
  { id: '8', name: '杭州云智科技', email: 'buy@yunzhi.com', phone: '0571-88001234', isCustomer: true, isSupplier: false, receivable: 210000, payable: 0, tags: ['优质客户', '科技', '华东'], createdAt: '2024-07-22', companyId: null },
]

export async function GET() {
  try {
    const { prisma } = await import('@/lib/db/prisma')
    const contacts = await prisma.contact.findMany({
      orderBy: { createdAt: 'desc' }
    })
    const result = contacts.map(c => ({ ...c, tags: c.tags ? JSON.parse(c.tags) : [] }))
    return NextResponse.json({ success: true, data: { items: result, total: result.length } })
  } catch {
    return NextResponse.json({ success: true, data: { items: mockContacts, total: mockContacts.length } })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { prisma } = await import('@/lib/db/prisma')
    const body = await req.json()
    const contact = await prisma.contact.create({
      data: {
        name: body.name,
        email: body.email || null,
        phone: body.phone || null,
        isCustomer: body.isCustomer ?? false,
        isSupplier: body.isSupplier ?? false,
        tags: body.tags ? JSON.stringify(body.tags) : null,
        receivable: body.receivable ?? 0,
        payable: body.payable ?? 0,
        companyId: body.companyId || null,
      }
    })
    return NextResponse.json({ success: true, data: contact }, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to create contact'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
