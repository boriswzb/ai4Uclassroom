/**
 * K线数据 API 代理
 * 支持日K、周K、月K（腾讯）和分钟K线（新浪）
 * 服务器端调用，绕过浏览器限制
 */
import { NextRequest, NextResponse } from 'next/server';
import https from 'https';

function httpGet(url: string): Promise<string> {
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
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// 转换代码格式: 000001.SZ -> sz000001, 600000.SH -> sh600000
function toQqCode(code: string): string {
  if (code.endsWith('.SH')) return `sh${code.replace('.SH', '')}`;
  if (code.endsWith('.SZ')) return `sz${code.replace('.SZ', '')}`;
  if (code.endsWith('.BJ')) return `bj${code.replace('.BJ', '')}`;
  return `sz${code}`;
}

// 转换新浪格式: 000001.SZ -> sh000001
function toSinaCode(code: string): string {
  if (code.endsWith('.SH')) return `sh${code.replace('.SH', '')}`;
  if (code.endsWith('.SZ')) return `sz${code.replace('.SZ', '')}`;
  if (code.endsWith('.BJ')) return `bj${code.replace('.BJ', '')}`;
  return `sz${code}`;
}

// 解析日K/周K/月K（腾讯）
interface KlineBar {
  code: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
}

function parseTencentKline(code: string, text: string, period: string): KlineBar[] {
  const jsonStr = text.split('=', 2)[1] || '{}';
  const json = JSON.parse(jsonStr);
  const qqCode = toQqCode(code).toLowerCase();
  const bars: string[][] = json.data?.[qqCode]?.[period] || [];

  return bars.map((bar: string[]) => ({
    code,
    timestamp: new Date(bar[0]).getTime(),
    open: parseFloat(bar[1]) || 0,
    high: parseFloat(bar[3]) || 0,
    low: parseFloat(bar[4]) || 0,
    close: parseFloat(bar[2]) || 0,
    volume: parseFloat(bar[5]) || 0,
    amount: parseFloat(bar[6]) || 0,
  }));
}

// 解析分钟K线（新浪）
function parseSinaMinute(code: string, json: any[]): KlineBar[] {
  if (!Array.isArray(json)) return [];
  return json.map((bar: any) => ({
    code,
    timestamp: new Date(bar.day).getTime(),
    open: parseFloat(bar.open) || 0,
    high: parseFloat(bar.high) || 0,
    low: parseFloat(bar.low) || 0,
    close: parseFloat(bar.close) || 0,
    volume: parseFloat(bar.volume) || 0,
    amount: 0,
  }));
}

// 分钟K线比例 -> 新浪 scale
function scaleToSinaScale(scale: number): number {
  switch (scale) {
    case 1: return 1;
    case 5: return 5;
    case 15: return 15;
    case 30: return 30;
    case 60: return 60;
    default: return 5;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code') || '';
  const period = searchParams.get('period') || 'day'; // day/week/month/1/5/15/30/60
  const count = parseInt(searchParams.get('count') || '200', 10);

  if (!code) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 });
  }

  const qqCode = toQqCode(code);

  try {
    let klines: KlineBar[] = [];

    // 分钟K线用新浪接口
    if (['1', '5', '15', '30', '60'].includes(period)) {
      const scale = scaleToSinaScale(parseInt(period, 10));
      const sinaCode = toSinaCode(code);
      const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaCode}&scale=${scale}&datalen=${Math.min(count, 500)}`;
      const text = await httpGet(url);
      const json = JSON.parse(text);
      klines = parseSinaMinute(code, json);
    }
    // 日K / 周K / 月K 用腾讯接口
    else {
      const qqPeriod = period === 'day' ? 'day' : period;
      const url = `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?_var=kline_${qqPeriod}&param=${qqCode},${qqPeriod},,,${count}`;
      const text = await httpGet(url);
      klines = parseTencentKline(code, text, qqPeriod);
    }

    return NextResponse.json({
      data: klines,
      code,
      period,
      count: klines.length,
      success: true,
    });
  } catch (error) {
    console.error('[API/stock/kline]', error);
    return NextResponse.json({ error: 'Failed to fetch kline', success: false }, { status: 500 });
  }
}
