import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

export async function GET() {
  try {
    const vendors = await prisma.vendor.findMany({ orderBy: { createdAt: 'desc' } })
    return NextResponse.json(vendors)
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const vendor = await prisma.vendor.create({ data: body })
    return NextResponse.json(vendor, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
  }
}
