/**
 * 股票搜索 API
 * 支持：代码搜索、名称拼音搜索、汉字模糊搜索
 * 数据来源：东方财富搜索建议
 */
import { NextRequest, NextResponse } from 'next/server';
import { httpGetBuffer } from '@/lib/quant/http-utils';

export interface SearchResult {
  code: string;       // 完整代码 000001.SZ
  name: string;        // 股票名称
  pinyin?: string;    // 拼音缩写
  exchange: 'SZ' | 'SH' | 'BJ'; // 交易所
  market?: string;    // 市场：沪深京
  type?: string;      // 类型：股票/指数/基金
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const keyword = searchParams.get('q') || searchParams.get('keyword') || '';
  const limit = parseInt(searchParams.get('limit') || '10', 10);

  if (keyword.length < 1) {
    return NextResponse.json({ data: [], success: true });
  }

  try {
    // 东方财富搜索建议接口
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(keyword)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&markettype=&mktnum=&jys=&classify=&sectype=&status=&count=${limit}`;

    const buffer = await httpGetBuffer(url);
    const text = buffer.toString('utf8');
    const json = JSON.parse(text);

    const results: SearchResult[] = [];
    const items = json?.QuotationCodeTable?.Data || json?.Data || [];

    for (const item of items) {
      const code: string = item.c || item.Code || '';
      const name: string = item.n || item.Name || '';
      const pinyin: string = item.pinyin || item.py || '';
      const secid: string = item.s || item.secid || '';

      // 判断交易所
      let exchange: 'SZ' | 'SH' | 'BJ' = 'SZ';
      if (secid.startsWith('1.') || code.startsWith('6')) exchange = 'SH';
      else if (secid.startsWith('0.') || code.startsWith('0') || code.startsWith('3')) exchange = 'SZ';
      else if (secid.startsWith('8.') || code.startsWith('8')) exchange = 'BJ';

      // 过滤ST等
      if (name.includes('ST') || name.includes('退') || name.includes('*')) {
        // 保留ST，但不显示风险提示股
      }

      results.push({
        code: `${code.replace(/^(\d{6}).*$/, '$1')}.${exchange}`,
        name,
        pinyin,
        exchange,
        market: exchange === 'SH' ? '沪市' : exchange === 'SZ' ? '深市' : '京市',
        type: item.type || '',
      });
    }

    return NextResponse.json({
      data: results.slice(0, limit),
      count: results.length,
      success: true,
    });
  } catch (error) {
    console.error('[API/stock/search]', error);
    return NextResponse.json({ error: 'Search failed', success: false, data: [] }, { status: 200 });
  }
}
