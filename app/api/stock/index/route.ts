/**
 * 指数实时行情 API
 * 从腾讯行情获取主要指数实时数据
 */
import { NextResponse } from 'next/server';
import { httpGetBuffer } from '../../../../lib/quant/http-utils';

const INDEX_MAP: Record<string, string> = {
  'sh000001': '上证指数',
  'sz399001': '深证成指',
  'sz399006': '创业板指',
  'sh000688': '科创50',
  'sh000300': '沪深300',
  'sh000016': '上证50',
  'sh000905': '中证500',
  'sz399905': '中证1000',
  'sh000852': '中证2000',
};

interface IndexQuote {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  volume: number;   // 成交量（万手）
  amount: number;   // 成交额（亿元）
  timestamp: string;
}

function parseIndex(text: string): IndexQuote[] {
  const result: IndexQuote[] = [];
  const blocks = text.split(';').filter(b => b.includes('="'));

  for (const block of blocks) {
    const raw = block.split('="')[1] || '';
    const fields = raw.split('~');
    if (fields.length < 35) continue;

    const rawCode = fields[2].trim();
    const fullCode = `sz${rawCode}`;
    const name = INDEX_MAP[fullCode] || fields[1].trim() || rawCode;

    result.push({
      code: rawCode,
      name,
      price: parseFloat(fields[3]) || 0,
      change: parseFloat(fields[31]) || 0,
      changePercent: parseFloat(fields[32]) || 0,
      open: parseFloat(fields[5]) || 0,
      high: parseFloat(fields[33]) || 0,
      low: parseFloat(fields[34]) || 0,
      volume: parseFloat(fields[36]) || 0,
      amount: parseFloat(fields[37]) || 0,
      timestamp: fields[30] || '',
    });
  }

  return result;
}

export async function GET() {
  const codes = Object.keys(INDEX_MAP).join(',');
  const url = `https://qt.gtimg.cn/q=${codes}`;

  try {
    const buffer = await httpGetBuffer(url);
    const text = new TextDecoder('gbk').decode(buffer);
    const data = parseIndex(text);

    return NextResponse.json({
      data,
      success: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API/stock/index]', error);
    return NextResponse.json({ error: 'Failed to fetch index data', success: false }, { status: 500 });
  }
}
