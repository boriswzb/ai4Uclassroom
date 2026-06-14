import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

export async function GET() {
  try {
    const warehouses = await prisma.warehouse.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: { createdAt: 'desc' }
    })
    return NextResponse.json(warehouses)
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const warehouse = await prisma.warehouse.create({ data: body })
    return NextResponse.json(warehouse, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
  }
}
