import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

export async function GET() {
  try {
    const [
      companiesCount,
      contactsCount,
      dealsCount,
      salesOrdersCount,
      purchaseOrdersCount,
      productsCount,
      invoicesTotal,
      recentDeals,
      recentSales,
    ] = await Promise.all([
      prisma.company.count(),
      prisma.contact.count(),
      prisma.deal.count(),
      prisma.salesOrder.count(),
      prisma.purchaseOrder.count(),
      prisma.product.count(),
      prisma.invoice.aggregate({ _sum: { totalAmount: true } }),
      prisma.deal.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, amount: true, probability: true, stage: true, createdAt: true },
      }),
      prisma.salesOrder.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: { id: true, orderNo: true, amount: true, status: true, date: true, createdAt: true },
      }),
    ])

    // Calculate deal value
    const totalDealValue = recentDeals.reduce((sum, d) => sum + d.amount, 0)
    const weightedValue = recentDeals.reduce((sum, d) => sum + d.amount * (d.probability / 100), 0)

    // Sales by month (mock for now)
    const monthlySales = [
      { month: '1月', amount: 128000 },
      { month: '2月', amount: 156000 },
      { month: '3月', amount: 189000 },
      { month: '4月', amount: 142000 },
      { month: '5月', amount: 210000 },
      { month: '6月', amount: 175000 },
    ]

    return NextResponse.json({
      stats: {
        monthlyRevenue: { value: invoicesTotal._sum.totalAmount ?? 0, change: 12.5, trend: 'up' as const },
        newOrders: { value: salesOrdersCount, change: 8.2, trend: 'up' as const },
        inventoryAlerts: { value: 3, change: -2, trend: 'down' as const },
        pendingInvoices: { value: 8, change: 15.3, trend: 'up' as const },
        receivables: { value: 269528, change: -5.1, trend: 'down' as const },
        payables: { value: 142300, change: 3.8, trend: 'up' as const },
      },
      monthlySales: monthlySales.map(s => ({ month: s.month, revenue: s.amount, orders: Math.floor(s.amount / 5000) })),
      recentSales,
      recentDeals,
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 })
  }
}
