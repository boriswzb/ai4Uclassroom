import { NextRequest, NextResponse } from 'next/server'

const mockCompanies = [
  { id: '1', name: '深圳市腾达科技有限公司', industry: '电子科技', contact: '张总', email: 'purchase@tengda.com', phone: '0755-26551234', city: '深圳', type: 'customer', revenue: 5000000, employees: 200, tags: ['优质客户', '科技'], createdAt: '2024-03-15', _count: { contacts: 1, deals: 2 } },
  { id: '2', name: '广州中商贸易有限公司', industry: '贸易', contact: '李总', email: 'order@zhongshang.com', phone: '020-88888888', city: '广州', type: 'customer', revenue: 3000000, employees: 80, tags: ['贸易', '华南'], createdAt: '2024-05-20', _count: { contacts: 1, deals: 1 } },
  { id: '3', name: '北京华联集团', industry: '零售', contact: '王总', email: 'procurement@hualian.com', phone: '010-66668888', city: '北京', type: 'customer', revenue: 20000000, employees: 500, tags: ['集团客户', '华北'], createdAt: '2024-02-10', _count: { contacts: 1, deals: 3 } },
  { id: '4', name: '联想（北京）有限公司', industry: 'IT设备', contact: '刘总', email: 'sales@lenovo.com.cn', phone: '400-100-2000', city: '北京', type: 'supplier', revenue: 100000000, employees: 5000, tags: ['品牌商', 'IT设备'], createdAt: '2024-01-01', _count: { contacts: 1, deals: 2 } },
  { id: '5', name: '得力集团有限公司', industry: '办公用品', contact: '陈总', email: 'b2b@delicloud.com', phone: '400-100-3000', city: '宁波', type: 'supplier', revenue: 50000000, employees: 2000, tags: ['办公用品', '品牌商'], createdAt: '2024-01-05', _count: { contacts: 1, deals: 1 } },
]

export async function GET() {
  try {
    const { prisma } = await import('@/lib/db/prisma')
    const companies = await prisma.company.findMany({
      include: { _count: { select: { contacts: true, deals: true } } },
      orderBy: { createdAt: 'desc' }
    })
    const result = companies.map(c => ({ ...c, tags: c.tags ? JSON.parse(c.tags) : [] }))
    return NextResponse.json({ success: true, data: { items: result, total: result.length } })
  } catch {
    return NextResponse.json({ success: true, data: { items: mockCompanies, total: mockCompanies.length } })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { prisma } = await import('@/lib/db/prisma')
    const body = await req.json()
    const company = await prisma.company.create({
      data: {
        name: body.name,
        industry: body.industry || null,
        contact: body.contact || null,
        email: body.email || null,
        phone: body.phone || null,
        city: body.city || null,
        type: body.type || 'customer',
        revenue: body.revenue ?? 0,
        employees: body.employees ?? 0,
        tags: body.tags ? JSON.stringify(body.tags) : null,
      }
    })
    return NextResponse.json({ success: true, data: company }, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to create company'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
