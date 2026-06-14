import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

export async function GET() {
  try {
    const orders = await prisma.purchaseOrder.findMany({
      include: { vendor: true, items: true },
      orderBy: { createdAt: 'desc' }
    })
    return NextResponse.json(orders)
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { items, ...orderData } = body
    const order = await prisma.purchaseOrder.create({
      data: {
        ...orderData,
        items: items ? { create: items } : undefined
      },
      include: { items: true }
    })
    return NextResponse.json(order, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
  }
}
