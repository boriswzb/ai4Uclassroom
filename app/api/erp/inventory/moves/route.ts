import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

export async function GET() {
  try {
    const moves = await prisma.inventoryMove.findMany({
      include: { product: true, warehouse: true },
      orderBy: { createdAt: 'desc' }
    })
    return NextResponse.json(moves)
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const move = await prisma.inventoryMove.create({ data: body })
    return NextResponse.json(move, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
  }
}
