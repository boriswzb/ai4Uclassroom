import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

export async function GET() {
  try {
    const invoices = await prisma.invoice.findMany({
      include: { company: true },
      orderBy: { createdAt: 'desc' }
    })
    return NextResponse.json(invoices)
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const invoice = await prisma.invoice.create({ data: body })
    return NextResponse.json(invoice, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
  }
}
