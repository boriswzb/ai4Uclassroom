/**
 * 资金流向 API
 * 基于实时行情数据计算资金流向指标
 * 通过腾讯实时行情批量获取个股成交数据
 */
import { NextRequest, NextResponse } from 'next/server';
import { httpGetBuffer } from '../../../../lib/quant/http-utils';

interface FlowItem {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;   // 成交量（手）
  amount: number;   // 成交额（万元）
  turnover: number; // 换手率%
  mainNetInflow: number;   // 估算主力净流入（万元）= 成交额 × 换手率修正
  mainNetInflowLevel: 'large' | 'medium' | 'small'; // 流入级别
  timestamp: string;
}

// 腾讯行情字段映射（已验证）
function parseRealtime(text: string, codeList: string[]): FlowItem[] {
  const result: FlowItem[] = [];
  const blocks = text.split(';').filter(b => b.includes('="'));

  for (const block of blocks) {
    const raw = block.split('="')[1] || '';
    const fields = raw.split('~');
    if (fields.length < 40) continue;

    const rawCode = fields[2].trim();
    const code = codeList.find(c => {
      const num = c.replace('.SZ', '').replace('.SH', '').replace('.BJ', '');
      return rawCode === num || rawCode === num.padStart(6, '0');
    }) || rawCode;

    const amount = parseFloat(fields[37]) || 0;       // 成交额（万元）
    const turnover = parseFloat(fields[38]) || 0;      // 换手率%
    const changePercent = parseFloat(fields[32]) || 0; // 涨跌幅%

    // 主力净流入估算：
    // 换手率高的股票，主力资金占比通常更大
    // 涨时主力流入，跌时主力流出
    // 修正系数：换手率越高，主力占比估算越高（最高 ~70%）
    const mainRatio = Math.min(0.7, turnover / 100 * 2.5);
    const sign = parseFloat(fields[31]) >= 0 ? 1 : -1;
    const mainNetInflow = amount * mainRatio * sign;

    // 流入级别
    const absRatio = Math.abs(mainNetInflow) / (amount + 1);
    const mainNetInflowLevel: 'large' | 'medium' | 'small' =
      absRatio > 0.3 ? 'large' :
      absRatio > 0.1 ? 'medium' : 'small';

    result.push({
      code,
      name: fields[1].trim(),
      price: parseFloat(fields[3]) || 0,
      change: parseFloat(fields[31]) || 0,
      changePercent,
      volume: parseFloat(fields[36]) || 0,
      amount,
      turnover,
      mainNetInflow: Math.round(mainNetInflow * 100) / 100,
      mainNetInflowLevel,
      timestamp: fields[30] || '',
    });
  }

  return result;
}

function toQqCode(code: string): string {
  if (code.endsWith('.SH')) return `sh${code.replace('.SH', '')}`;
  if (code.endsWith('.SZ')) return `sz${code.replace('.SZ', '')}`;
  if (code.endsWith('.BJ')) return `bj${code.replace('.BJ', '')}`;
  return `sz${code}`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const codes = searchParams.get('codes') || '';
  const sortBy = searchParams.get('sort') || 'mainNetInflow';
  const order = searchParams.get('order') || 'desc';
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

  if (!codes) {
    return NextResponse.json({ error: 'codes is required' }, { status: 400 });
  }

  const codeList = codes.split(',').filter(Boolean);
  const qqCodes = codeList.map(toQqCode).join(',');
  const url = `https://qt.gtimg.cn/q=${qqCodes}`;

  try {
    const buffer = await httpGetBuffer(url);
    const text = new TextDecoder('gbk').decode(buffer);
    let data = parseRealtime(text, codeList);

    data.sort((a, b) => {
      let av = 0, bv = 0;
      if (sortBy === 'mainNetInflow') { av = a.mainNetInflow; bv = b.mainNetInflow; }
      else if (sortBy === 'mainNetInflowLevel') {
        const order_ = { large: 3, medium: 2, small: 1 };
        av = order_[a.mainNetInflowLevel]; bv = order_[b.mainNetInflowLevel];
      }
      else if (sortBy === 'changePercent') { av = a.changePercent; bv = b.changePercent; }
      else if (sortBy === 'amount') { av = a.amount; bv = b.amount; }
      else if (sortBy === 'turnover') { av = a.turnover; bv = b.turnover; }
      return order === 'desc' ? bv - av : av - bv;
    });

    return NextResponse.json({
      data: data.slice(0, limit),
      count: data.length,
      success: true,
    });
  } catch (error) {
    console.error('[API/stock/flow]', error);
    return NextResponse.json({ error: 'Failed to fetch flow data', success: false }, { status: 500 });
  }
}
