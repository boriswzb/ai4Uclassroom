/**
 * A股股票列表 API
 * 从新浪行情获取全量股票代码（沪市 + 深市）
 * 返回格式: { code: string, name: string }[]  e.g. { code: "600000.SH", name: "浦发银行" }
 */
import { NextResponse } from 'next/server';

// 内存缓存
let cachedList: { code: string; name: string }[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 1000 * 60 * 60; // 1小时

function sinaToCode(sinaSymbol: string): string {
  if (sinaSymbol.startsWith('sh')) return `${sinaSymbol.slice(2)}.SH`;
  if (sinaSymbol.startsWith('sz')) return `${sinaSymbol.slice(2)}.SZ`;
  return sinaSymbol;
}

async function fetchSinaNode(node: string): Promise<{ code: string; name: string }[]> {
  const stocks: { code: string; name: string }[] = [];
  const pageSize = 100;
  let page = 1;

  while (true) {
    const url = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeDataSimple?page=${page}&num=${pageSize}&sort=symbol&asc=1&node=${node}`;
    const res = await fetch(url, {
      headers: { Referer: 'https://finance.sina.com.cn' },
      next: { revalidate: 3600 }, // Next.js 缓存1小时
    });

    if (!res.ok) break;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    for (const item of data) {
      const raw = item.symbol as string; // e.g. "sh600000"
      const code = sinaToCode(raw);
      const name = item.name as string;
      if (code && name) {
        stocks.push({ code, name });
      }
    }

    if (data.length < pageSize) break;
    page++;
  }

  return stocks;
}

export async function GET() {
  const now = Date.now();

  // 缓存有效直接返回
  if (cachedList && now - cacheTime < CACHE_TTL) {
    return NextResponse.json({ data: cachedList, source: 'cache', count: cachedList.length });
  }

  try {
    // 并行获取沪市和深市
    const [shStocks, szStocks] = await Promise.all([
      fetchSinaNode('sh_a'),
      fetchSinaNode('sz_a'),
    ]);

    const all = [...shStocks, ...szStocks];

    // 去重（按 code）
    const seen = new Set<string>();
    const unique = all.filter(s => {
      if (seen.has(s.code)) return false;
      seen.add(s.code);
      return true;
    });

    // 按代码排序
    unique.sort((a, b) => a.code.localeCompare(b.code));

    cachedList = unique;
    cacheTime = now;

    return NextResponse.json({
      data: unique,
      source: 'sina',
      shCount: shStocks.length,
      szCount: szStocks.length,
      total: unique.length,
      cached: false,
    });
  } catch (err) {
    console.error('[API/stock/list]', err);
    // 缓存失效时返回旧缓存（如果有）
    if (cachedList) {
      return NextResponse.json({ data: cachedList, source: 'cache', count: cachedList.length, stale: true });
    }
    return NextResponse.json({ error: 'Failed to fetch stock list', success: false }, { status: 500 });
  }
}
