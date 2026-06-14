import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

export async function GET() {
  try {
    const products = await prisma.product.findMany({
      include: { warehouse: true },
      orderBy: { createdAt: 'desc' }
    })
    return NextResponse.json(products)
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const product = await prisma.product.create({ data: body })
    return NextResponse.json(product, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
  }
}
