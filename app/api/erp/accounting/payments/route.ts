import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

export async function GET() {
  try {
    const payments = await prisma.payment.findMany({
      include: { company: true },
      orderBy: { createdAt: 'desc' }
    })
    return NextResponse.json(payments)
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const payment = await prisma.payment.create({ data: body })
    return NextResponse.json(payment, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
  }
}
