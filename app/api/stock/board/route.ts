/**
 * 行业板块涨跌 API
 * 通过新浪股票列表获取全量A股，按证监会行业分类聚合统计
 */
import { NextResponse } from 'next/server';
import { getIndustry } from '../../../../lib/quant/industry-map';

interface StockData {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  amount: number;
}

interface BoardItem {
  name: string;
  count: number;
  upCount: number;
  downCount: number;
  avgChangePercent: number;
  leadStock: string;
  leadChangePercent: number;
  totalAmount: number; // 总成交额（元）
}

async function fetchSinaNode(node: string): Promise<StockData[]> {
  const pageSize = 100;
  const stocks: StockData[] = [];
  let page = 1;

  while (true) {
    const url = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=${pageSize}&sort=changepercent&asc=0&node=${node}&symbol=&_s_r_a=page`;
    const res = await fetch(url, {
      headers: { Referer: 'https://finance.sina.com.cn' },
      next: { revalidate: 60 },
    });
    if (!res.ok) break;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    for (const item of data) {
      const symbol = item.symbol as string;
      const code = symbol.startsWith('sh')
        ? `${symbol.slice(2)}.SH`
        : symbol.startsWith('sz')
        ? `${symbol.slice(2)}.SZ`
        : symbol;

      stocks.push({
        code,
        name: item.name as string,
        price: parseFloat(item.trade) || 0,
        change: parseFloat(item.pricechange) || 0,
        changePercent: parseFloat(item.changepercent) || 0,
        volume: parseFloat(item.volume) || 0,
        amount: parseFloat(item.amount) || 0,
      });
    }

    if (data.length < pageSize) break;
    page++;
    if (page > 60) break; // 安全上限
  }

  return stocks;
}

function buildBoards(stocks: StockData[]): BoardItem[] {
  const map = new Map<string, StockData[]>();

  for (const stock of stocks) {
    const numCode = stock.code.replace('.SZ', '').replace('.SH', '').replace('.BJ', '');
    const industry = getIndustry(stock.code);
    if (!map.has(industry)) map.set(industry, []);
    map.get(industry)!.push(stock);
  }

  const boards: BoardItem[] = [];

  for (const [name, items] of map.entries()) {
    if (items.length < 3) continue;

    items.sort((a, b) => b.changePercent - a.changePercent);
    const upCount = items.filter(s => s.changePercent > 0).length;
    const downCount = items.filter(s => s.changePercent < 0).length;
    const avgChangePercent = items.reduce((sum, s) => sum + s.changePercent, 0) / items.length;
    const totalAmount = items.reduce((sum, s) => sum + s.amount, 0);

    boards.push({
      name,
      count: items.length,
      upCount,
      downCount,
      avgChangePercent: Math.round(avgChangePercent * 100) / 100,
      leadStock: items[0].name,
      leadChangePercent: items[0].changePercent,
      totalAmount,
    });
  }

  return boards;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sortBy = searchParams.get('sort') || 'avgChangePercent';
  const order = searchParams.get('order') || 'desc';
  const limit = parseInt(searchParams.get('limit') || '60', 10);

  try {
    const [shStocks, szStocks] = await Promise.all([
      fetchSinaNode('sh_a'),
      fetchSinaNode('sz_a'),
    ]);

    const allStocks = [...shStocks, ...szStocks];
    const boards = buildBoards(allStocks);

    boards.sort((a, b) => {
      let av = 0, bv = 0;
      if (sortBy === 'avgChangePercent') { av = a.avgChangePercent; bv = b.avgChangePercent; }
      else if (sortBy === 'totalAmount') { av = a.totalAmount; bv = b.totalAmount; }
      else if (sortBy === 'count') { av = a.count; bv = b.count; }
      else if (sortBy === 'upCount') { av = a.upCount; bv = b.upCount; }
      return order === 'desc' ? bv - av : av - bv;
    });

    return NextResponse.json({
      data: boards.slice(0, limit),
      total: boards.length,
      stocksFetched: allStocks.length,
      sortBy,
      order,
      success: true,
    });
  } catch (error) {
    console.error('[API/stock/board]', error);
    return NextResponse.json({ error: 'Failed to fetch board data', success: false }, { status: 500 });
  }
}
