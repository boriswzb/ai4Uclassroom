/**
 * 分时数据 API
 * 1. 非交易时段 + history=1 → 从东财 push2his 获取上一交易日历史分时
 * 2. 交易时段（默认）        → 从腾讯 qt.gtimg.cn 轮询实时数据，增量追加点
 */
import { NextRequest, NextResponse } from 'next/server';
import https from 'https';

// 内存中缓存各股票的分时数据（进程级别，重启后清空）
const minuteCache = new Map<string, {
  name: string;
  yestclose: number;
  points: { time: string; price: number; vol: number }[];
  lastUpdate: number;
}>();

function httpGet(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://finance.qq.com/',
        'Accept': '*/*',
      },
      secureProtocol: 'TLSv1_2_method',
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// 转换代码: 600519.SH -> 1.600519（东财格式）
function toEastmoneySecid(code: string): string {
  if (code.endsWith('.SH')) return `1.${code.replace('.SH', '')}`;
  if (code.endsWith('.SZ')) return `0.${code.replace('.SZ', '')}`;
  if (code.endsWith('.BJ')) return `0.${code.replace('.BJ', '')}`;
  return `0.${code}`;
}

// 转换代码: 600519.SH -> sh600519
function toQqCode(code: string): string {
  if (code.endsWith('.SH')) return `sh${code.replace('.SH', '')}`;
  if (code.endsWith('.SZ')) return `sz${code.replace('.SZ', '')}`;
  if (code.endsWith('.BJ')) return `bj${code.replace('.BJ', '')}`;
  return `sz${code}`;
}

// 判断当前是否为交易时段（9:30-12:00, 13:00-15:00）
function isTradingHour(): boolean {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const dayOfWeek = now.getDay();
  // 周末休市
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  const totalMin = h * 60 + m;
  return (totalMin >= 9 * 60 + 30 && totalMin < 12 * 60)
      || (totalMin >= 13 * 60 && totalMin < 15 * 60);
}

// 获取上一交易日（简单实现：只工作日）
function getPrevTradingDay(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  let offset = dayOfWeek === 1 ? 3 : 1; // 周一往前推3天，其他推1天
  if (dayOfWeek === 0) offset = 2; // 周日往前推2天
  const d = new Date(now);
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 解析腾讯实时行情字段
interface QuoteFields {
  name: string;
  price: number;
  yestclose: number;
  open: number;
  volume: number;
  amount: number;
  high: number;
  low: number;
  time: string;
  change: number;
  changePercent: number;
}

function parseQuote(text: string, qqCode: string): QuoteFields | null {
  const match = text.match(new RegExp(`v_${qqCode}="([^"]+)"`));
  if (!match) return null;
  const f = match[1].split('~');
  if (f.length < 35) return null;
  return {
    name: f[1] || '',
    price: parseFloat(f[3]) || 0,
    yestclose: parseFloat(f[4]) || 0,
    open: parseFloat(f[5]) || 0,
    volume: parseFloat(f[6]) || 0,
    amount: parseFloat(f[37]) || 0,
    high: parseFloat(f[33]) || 0,
    low: parseFloat(f[34]) || 0,
    time: f[30] || '',
    change: parseFloat(f[31]) || 0,
    changePercent: parseFloat(f[32]) || 0,
  };
}

// 格式化时间戳 "20260511161407" -> "09:30"
function formatTime(ts: string): string {
  if (ts.length < 9) return ts;
  const h = ts.slice(8, 10);
  const m = ts.slice(10, 12);
  return `${h}:${m}`;
}

// 从东财 push2his 获取上一交易日历史分时
async function fetchHistoryMinute(code: string) {
  const secid = toEastmoneySecid(code);
  const prevDay = getPrevTradingDay();
  const url = `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1`;
  const buf = await httpGet(url);
  const json = JSON.parse(buf.toString('utf8'));

  if (!json.data || !json.data.trends) {
    throw new Error('no history data');
  }

  const rawTrends: string[] = json.data.trends;
  const preClose = json.data.preClose || 0;
  const name = json.data.name || '';

  // 解析趋势数据: "2026-05-09 09:15,price,open,high,low,vol,amount,..."
  const points: { time: string; price: number; vol: number }[] = [];
  for (const t of rawTrends) {
    const parts = t.split(',');
    if (parts.length < 5) continue;
    const dt = parts[0]; // "2026-05-09 09:15"
    const timePart = dt.split(' ')[1] || dt; // "09:15"
    // 价格是实际值（非百分制），东财分时价格直接可用
    const price = parseFloat(parts[1]) || 0;
    const vol = parseFloat(parts[5]) || 0;
    if (price > 0) {
      points.push({ time: timePart, price, vol });
    }
  }

  return { name, preClose, points };
}

// 从腾讯 qt.gtimg.cn 获取实时分时
async function fetchLiveMinute(code: string) {
  const qqCode = toQqCode(code);
  const url = `https://qt.gtimg.cn/q=${qqCode}`;
  const buf = await httpGet(url);
  const text = new TextDecoder('gbk').decode(buf);
  const quote = parseQuote(text, qqCode);
  if (!quote || !quote.price) throw new Error('no live data');
  return quote;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const codes = searchParams.get('codes') || '';
  const reset = searchParams.get('reset') === '1';
  const history = searchParams.get('history') === '1'; // 强制拉历史分时

  if (!codes) {
    return NextResponse.json({ error: 'codes is required', success: false }, { status: 400 });
  }

  const codeList = codes.split(',').filter(Boolean);
  const now = Date.now();
  const inTrading = isTradingHour();

  try {
    const results = [];

    for (const code of codeList) {
      const trimmedCode = code.trim();

      // 非交易时段 或者 强制请求历史 → 拉东财上一交易日分时
      if (!inTrading || history) {
        try {
          const hist = await fetchHistoryMinute(trimmedCode);
          results.push({
            code: trimmedCode,
            name: hist.name,
            yestclose: hist.preClose,
            price: hist.points.length > 0 ? hist.points[hist.points.length - 1].price : hist.preClose,
            change: 0,
            changePercent: 0,
            open: hist.points.length > 0 ? hist.points[0].price : hist.preClose,
            high: hist.points.length > 0 ? Math.max(...hist.points.map(p => p.price)) : hist.preClose,
            low: hist.points.length > 0 ? Math.min(...hist.points.map(p => p.price)) : hist.preClose,
            volume: 0,
            amount: 0,
            time: hist.points.length > 0 ? hist.points[hist.points.length - 1].time : '--:--',
            data: hist.points,
            isHistory: true,
          });
          // 清空实时缓存，避免下次请求混用
          minuteCache.delete(trimmedCode);
          continue;
        } catch (e) {
          console.warn(`[minute-data] history fetch failed for ${trimmedCode}:`, e);
          // 历史拉失败，尝试降级到实时
        }
      }

      // 交易时段：实时分时（增量追加）
      const quote = await fetchLiveMinute(trimmedCode);
      const timeStr = formatTime(quote.time);
      const newPoint = { time: timeStr, price: quote.price, vol: quote.volume };

      let cached = minuteCache.get(trimmedCode);

      const cacheAge = cached ? (now - cached.lastUpdate) : Infinity;
      const isNewDay = timeStr >= '09:30' && timeStr <= '09:35';
      const isStale = cacheAge > 30 * 60 * 1000;

      if (reset || !cached || isNewDay || isStale) {
        cached = {
          name: quote.name,
          yestclose: quote.yestclose,
          points: [newPoint],
          lastUpdate: now,
        };
        minuteCache.set(trimmedCode, cached);
      } else {
        const last = cached.points[cached.points.length - 1];
        if (last.time !== timeStr || last.price !== quote.price) {
          cached.points.push(newPoint);
          cached.lastUpdate = now;
          if (cached.points.length > 500) {
            cached.points = cached.points.slice(-500);
          }
        }
      }

      const todayPoints = cached.points.filter(p => {
        const t = p.time.replace(':', '');
        const tn = parseInt(t);
        return tn >= 930 && tn <= 1500;
      });

      results.push({
        code: trimmedCode,
        name: quote.name,
        yestclose: quote.yestclose,
        price: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
        open: quote.open,
        high: quote.high,
        low: quote.low,
        volume: quote.volume,
        amount: quote.amount,
        time: timeStr,
        data: todayPoints,
        isHistory: false,
      });
    }

    return NextResponse.json({ success: true, data: results });
  } catch (e) {
    console.error('[minute-data]', e);
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
