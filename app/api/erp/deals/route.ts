import { NextRequest, NextResponse } from 'next/server'

const mockDeals = [
  { id: '1', name: '企业路由器采购项目', amount: 280000, stage: 'negotiation', probability: 60, source: '电话营销', expectedClose: '2024-12-31', createdAt: '2024-08-01', company: { id: '1', name: '深圳市腾达科技有限公司' }, contact: { id: '1', name: '张总' } },
  { id: '2', name: '办公设备年度采购', amount: 156000, stage: 'proposal', probability: 40, source: '展会', expectedClose: '2024-11-30', createdAt: '2024-07-15', company: { id: '3', name: '北京华联集团' }, contact: { id: '3', name: '王总' } },
  { id: '3', name: '交换机设备采购', amount: 89000, stage: 'contract', probability: 90, source: '客户推荐', expectedClose: '2024-10-15', createdAt: '2024-06-20', company: { id: '2', name: '广州中商贸易有限公司' }, contact: { id: '2', name: '李总' } },
]

const stageMap: Record<string, string> = {
  qualification: '需求确认',
  proposal: '方案报价',
  negotiation: '商务谈判',
  contract: '合同签订',
}

export async function GET() {
  try {
    const { prisma } = await import('@/lib/db/prisma')
    const deals = await prisma.deal.findMany({
      include: { company: true, contact: true },
      orderBy: { createdAt: 'desc' }
    })
    const result = deals.map(d => ({
      ...d,
      stage: stageMap[d.stage] || d.stage,
      company: d.company ? { id: d.company.id, name: d.company.name } : null,
      contact: d.contact ? { id: d.contact.id, name: d.contact.name } : null,
    }))
    return NextResponse.json({ success: true, data: { items: result, total: result.length } })
  } catch {
    return NextResponse.json({ success: true, data: { items: mockDeals, total: mockDeals.length } })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { prisma } = await import('@/lib/db/prisma')
    const body = await req.json()
    const stageKey = Object.entries(stageMap).find(([, v]) => v === body.stage)?.[0] ?? 'qualification'
    const deal = await prisma.deal.create({
      data: {
        name: body.name,
        amount: body.amount ?? 0,
        stage: stageKey,
        probability: body.probability ?? 0,
        source: body.source || null,
        expectedClose: body.expectedClose || null,
        companyId: body.companyId || null,
        contactId: body.contactId || null,
      }
    })
    return NextResponse.json({ success: true, data: deal }, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to create deal'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
