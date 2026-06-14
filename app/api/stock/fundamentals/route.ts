/**
 * 股票基本面 API
 * 从腾讯行情 qt.gtimg.cn 获取个股基本面数据
 * 支持 PE、PB、市值、换手率、涨跌等
 */
import { NextRequest, NextResponse } from 'next/server';
import https from 'https';

function httpGet(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://finance.qq.com/',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      secureProtocol: 'TLSv1_2_method',
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// 转换代码: 000001.SZ -> sz000001
function toQqCode(code: string): string {
  if (code.endsWith('.SH')) return `sh${code.replace('.SH', '')}`;
  if (code.endsWith('.SZ')) return `sz${code.replace('.SZ', '')}`;
  if (code.endsWith('.BJ')) return `bj${code.replace('.BJ', '')}`;
  return `sz${code}`;
}

// 字段映射 (腾讯行情 qt.gtimg.cn):
// [1]=name [2]=code [3]=price [4]=yesterday_close [5]=open
// [6]=volume(手) [31]=change [32]=changePercent
// [33]=high [34]=low [36]=volume [37]=amount(万元)
// [38]=turnover(%) [39]=PE [44]=mktcap(亿) [45]=nmc(流通市值亿)
// [46]=turnover2(%) [47]=high52w [48]=low52w
// [49]=PB [50]=52w_change(%) [51]=closeprice
// [52]=dynamic_pe [53]=tsp
interface Fundamentals {
  code: string;
  name: string;
  price: number;
  yesterdayClose: number;
  open: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;        // 成交量（手）
  amount: number;        // 成交额（万元）
  turnover: number;      // 换手率%
  pe: number;           // 市盈率
  pb: number;           // 市净率
  marketCap: number;     // 总市值（亿元）
  negMarketCap: number;  // 流通市值（亿元）
  high52w: number;       // 52周最高
  low52w: number;       // 52周最低
  timestamp: string;
}

function parse(text: string, codeList: string[]): Fundamentals[] {
  const result: Fundamentals[] = [];
  const blocks = text.split(';').filter(b => b.includes('="'));

  for (const block of blocks) {
    const raw = block.split('="')[1] || '';
    const fields = raw.split('~');
    if (fields.length < 50) continue;

    const rawCode = fields[2].trim();
    const code = codeList.find(c => {
      const num = c.replace('.SZ', '').replace('.SH', '').replace('.BJ', '');
      return rawCode === num || rawCode === num.padStart(6, '0');
    }) || fields[2];

    result.push({
      code,
      name: fields[1].trim(),
      price: parseFloat(fields[3]) || 0,
      yesterdayClose: parseFloat(fields[4]) || 0,
      open: parseFloat(fields[5]) || 0,
      change: parseFloat(fields[31]) || 0,
      changePercent: parseFloat(fields[32]) || 0,
      high: parseFloat(fields[33]) || 0,
      low: parseFloat(fields[34]) || 0,
      volume: parseFloat(fields[36]) || 0,
      amount: parseFloat(fields[37]) || 0,
      turnover: parseFloat(fields[38]) || 0,
      pe: parseFloat(fields[39]) || 0,
      pb: parseFloat(fields[49]) || 0,
      marketCap: parseFloat(fields[44]) || 0,
      negMarketCap: parseFloat(fields[45]) || 0,
      high52w: parseFloat(fields[47]) || 0,
      low52w: parseFloat(fields[48]) || 0,
      timestamp: fields[30] || '',
    });
  }

  return result;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const codes = searchParams.get('codes') || '';

  if (!codes) {
    return NextResponse.json({ error: 'codes is required' }, { status: 400 });
  }

  const codeList = codes.split(',').filter(Boolean);
  const qqCodes = codeList.map(toQqCode).join(',');
  const url = `https://qt.gtimg.cn/q=${qqCodes}`;

  try {
    const buffer = await httpGet(url);
    const text = new TextDecoder('gbk').decode(buffer);
    const data = parse(text, codeList);

    return NextResponse.json({
      data,
      count: data.length,
      success: true,
    });
  } catch (error) {
    console.error('[API/stock/fundamentals]', error);
    return NextResponse.json({ error: 'Failed to fetch fundamentals', success: false }, { status: 500 });
  }
}
