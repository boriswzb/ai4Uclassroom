/**
 * 实时行情 API 代理 (增强版)
 * 支持技术指标计算和信号生成
 * 服务器端调用腾讯行情 qt.gtimg.cn（GBK 编码，https 模块解决 TLS 问题）
 */
import { NextRequest, NextResponse } from 'next/server';
import https from 'https';
import { KBar } from '@/lib/quant/types';
import { computeIndicators } from '@/lib/quant/strategies/indicators';

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

// 转换代码格式:
//   000001.SZ -> sz000001
//   600000.SH -> sh600000
//   sh000001  -> sh000001 (已是腾讯格式，直接返回)
function toQqCode(code: string): string {
  if (code.endsWith('.SH')) return `sh${code.replace('.SH', '')}`;
  if (code.endsWith('.SZ')) return `sz${code.replace('.SZ', '')}`;
  if (code.endsWith('.BJ')) return `bj${code.replace('.BJ', '')}`;
  // 已经是 sh/sz/bj 前缀（如 sh000001），直接返回
  if (code.startsWith('sh') || code.startsWith('sz') || code.startsWith('bj')) {
    return code;
  }
  return `sz${code}`;
}

// 解析腾讯实时行情
interface QuoteData {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  amount: number;
  open: number;
  high: number;
  low: number;
  timestamp: number;
}

function parseTencentQuote(codeList: string[], text: string): QuoteData[] {
  const result: QuoteData[] = [];
  const blocks = text.split(';').filter(b => b.includes('="'));

  for (const block of blocks) {
    const fields = block.split('~');
    if (fields.length < 35) continue;

    const rawCode = fields[2].trim();
    const name = fields[1].trim();
    const price = parseFloat(fields[3]) || 0;
    const open = parseFloat(fields[5]) || 0;
    const volume = parseFloat(fields[6]) || 0;
    const high = parseFloat(fields[33]) || 0;
    const low = parseFloat(fields[34]) || 0;
    const change = parseFloat(fields[31]) || 0;
    const changePercent = parseFloat(fields[32]) || 0;
    const amount = parseFloat(fields[37]) || 0;

    // 优先精确匹配，再尝试模糊匹配，最后从腾讯原始数据推断
    const rawNum = rawCode.padStart(6, '0');
    const matched = codeList.find(c => {
      const num = c.replace('.SZ', '').replace('.SH', '').replace('.BJ', '');
      return num === rawNum || num === rawCode;
    });
    // 推断市场后缀：0开头→深圳，6/9开头→上海
    const inferredCode = matched || (rawNum.startsWith('6') || rawNum.startsWith('9')
      ? `${rawNum}.SH` : `${rawNum}.SZ`);

    result.push({
      code: inferredCode,
      name,
      price,
      change,
      changePercent,
      open,
      high,
      low,
      volume,
      amount,
      timestamp: Date.now(),
    });
  }

  return result;
}

// 解析腾讯日K线
function parseTencentKline(code: string, text: string): KBar[] {
  const jsonStr = text.split('=', 2)[1] || '{}';
  const json = JSON.parse(jsonStr);
  const qqCode = toQqCode(code).toLowerCase();
  const bars: string[][] = json.data?.[qqCode]?.day || [];

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

// 计算信号
interface SignalResult {
  direction: 'long' | 'short' | 'neutral';
  strength: number;
  reason: string;
}

function computeSignal(
  price: number,
  indicators: ReturnType<typeof computeIndicators>,
  lastIndex: number
): SignalResult {
  const reasons: string[] = [];
  let longSignals = 0;
  let shortSignals = 0;

  // MACD 信号检测
  const macdLen = indicators.macd.macd.length;
  if (lastIndex >= 1 && macdLen >= 2) {
    const currIdx = Math.min(lastIndex, macdLen - 1);
    const prevIdx = currIdx - 1;

    const currDif = indicators.macd.macd[currIdx];
    const currDea = indicators.macd.signal[currIdx];
    const prevDif = indicators.macd.macd[prevIdx];
    const prevDea = indicators.macd.signal[prevIdx];

    // 金叉：DIF 从下方穿越 DEA
    if (prevDif <= prevDea && currDif > currDea) {
      longSignals += 1;
      reasons.push('MACD金叉');
    }
    // 死叉：DIF 从上方穿越 DEA
    if (prevDif >= prevDea && currDif < currDea) {
      shortSignals += 1;
      reasons.push('MACD死叉');
    }
  }

  // KDJ 信号检测
  const kdjLen = indicators.kdj.k.length;
  if (lastIndex >= 0 && kdjLen >= 1) {
    const currIdx = Math.min(lastIndex, kdjLen - 1);
    const k = indicators.kdj.k[currIdx];
    const d = indicators.kdj.d[currIdx];
    const j = indicators.kdj.j[currIdx];

    if (!isNaN(k) && !isNaN(d) && !isNaN(j)) {
      if (k > 80) {
        shortSignals += 1;
        reasons.push('KDJ超买');
      }
      if (k < 20) {
        longSignals += 1;
        reasons.push('KDJ超卖');
      }
      // KDJ 多头排列 (K>D>J 且都在50以上)
      if (k > d && d > j && k > 50) {
        longSignals += 0.5;
        reasons.push('KDJ多头排列');
      }
      // KDJ 空头排列 (K<D<J 且都在50以下)
      if (k < d && d < j && k < 50) {
        shortSignals += 0.5;
        reasons.push('KDJ空头排列');
      }
    }
  }

  // MA 信号检测
  const smaLen = indicators.sma20.length;
  if (lastIndex >= 0 && smaLen >= 1) {
    const currIdx = Math.min(lastIndex, smaLen - 1);
    const sma5 = indicators.sma5[currIdx];
    const sma10 = indicators.sma10[currIdx];
    const sma20 = indicators.sma20[currIdx];
    const sma60 = indicators.sma60[currIdx];

    if (!isNaN(sma20)) {
      if (price > sma20) {
        longSignals += 1;
        reasons.push('价格站上MA20');
      } else {
        shortSignals += 1;
        reasons.push('价格跌破MA20');
      }
    }

    // 均线多头排列
    if (!isNaN(sma5) && !isNaN(sma10) && !isNaN(sma20) && sma5 > sma10 && sma10 > sma20) {
      longSignals += 0.5;
      reasons.push('均线多头排列');
    }
    // 均线空头排列
    if (!isNaN(sma5) && !isNaN(sma10) && !isNaN(sma20) && sma5 < sma10 && sma10 < sma20) {
      shortSignals += 0.5;
      reasons.push('均线空头排列');
    }
  }

  // 综合判断
  const totalSignals = longSignals + shortSignals;
  let direction: 'long' | 'short' | 'neutral' = 'neutral';
  let strength = 0;

  if (totalSignals > 0) {
    if (longSignals > shortSignals) {
      direction = 'long';
      strength = Math.min(longSignals / (totalSignals + 2), 1);
    } else if (shortSignals > longSignals) {
      direction = 'short';
      strength = Math.min(shortSignals / (totalSignals + 2), 1);
    }
  }

  return {
    direction,
    strength: Math.round(strength * 100) / 100,
    reason: reasons.length > 0 ? reasons.join('，') : '无明显信号',
  };
}

// 格式化指标输出
interface FormattedIndicators {
  macd: { value: number; signal: string; histogram: number };
  kdj: { k: number; d: number; j: number; signal: string };
  bollinger: { upper: number; middle: number; lower: number; position: number };
  ma: { ma5: number; ma10: number; ma20: number; ma60: number; position: string };
}

function formatIndicators(
  indicators: ReturnType<typeof computeIndicators>,
  price: number,
  lastIndex: number
): FormattedIndicators {
  const idx = Math.min(lastIndex, indicators.sma5.length - 1);

  const macd = indicators.macd;
  const kdj = indicators.kdj;
  const bollinger = indicators.bollinger;
  const sma5 = indicators.sma5;
  const sma10 = indicators.sma10;
  const sma20 = indicators.sma20;
  const sma60 = indicators.sma60;

  // MACD signal
  let macdSignal = 'neutral';
  if (idx >= 1) {
    const currDif = macd.macd[idx];
    const currDea = macd.signal[idx];
    const prevDif = macd.macd[idx - 1];
    const prevDea = macd.signal[idx - 1];
    if (prevDif <= prevDea && currDif > currDea) macdSignal = 'golden_cross';
    if (prevDif >= prevDea && currDif < currDea) macdSignal = 'dead_cross';
  }

  // KDJ signal
  let kdjSignal = 'neutral';
  const k = kdj.k[idx];
  const d = kdj.d[idx];
  const j = kdj.j[idx];
  if (!isNaN(k)) {
    if (k > 80) kdjSignal = 'overbought';
    else if (k < 20) kdjSignal = 'oversold';
    else if (k > d && d > j && k > 50) kdjSignal = 'bullish_arrangement';
    else if (k < d && d < j && k < 50) kdjSignal = 'bearish_arrangement';
  }

  // Bollinger position
  const bbUpper = bollinger.upper[idx];
  const bbLower = bollinger.lower[idx];
  const bbPosition = !isNaN(bbUpper) && !isNaN(bbLower) && bbUpper !== bbLower
    ? (price - bbLower) / (bbUpper - bbLower)
    : 0.5;

  // MA position
  let maPosition = 'neutral';
  const ma20Val = sma20[idx];
  if (!isNaN(ma20Val)) {
    maPosition = price > ma20Val ? 'above_ma20' : 'below_ma20';
  }

  return {
    macd: {
      value: !isNaN(macd.macd[idx]) ? macd.macd[idx] : 0,
      signal: macdSignal,
      histogram: !isNaN(macd.histogram[idx]) ? macd.histogram[idx] : 0,
    },
    kdj: {
      k: !isNaN(k) ? k : 0,
      d: !isNaN(d) ? d : 0,
      j: !isNaN(j) ? j : 0,
      signal: kdjSignal,
    },
    bollinger: {
      upper: !isNaN(bbUpper) ? bbUpper : 0,
      middle: !isNaN(bollinger.middle[idx]) ? bollinger.middle[idx] : 0,
      lower: !isNaN(bbLower) ? bbLower : 0,
      position: Math.round(bbPosition * 100) / 100,
    },
    ma: {
      ma5: !isNaN(sma5[idx]) ? sma5[idx] : 0,
      ma10: !isNaN(sma10[idx]) ? sma10[idx] : 0,
      ma20: !isNaN(ma20Val) ? ma20Val : 0,
      ma60: !isNaN(sma60[idx]) ? sma60[idx] : 0,
      position: maPosition,
    },
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const codes = searchParams.get('codes') || '';
  const indicatorsParam = searchParams.get('indicators') || '0';
  const includeIndicators = indicatorsParam === '1';

  if (!codes) {
    return NextResponse.json({ error: 'codes is required', success: false }, { status: 400 });
  }

  const codeList = codes.split(',').filter(Boolean);

  // 转换代码格式: 000001.SZ -> sz000001, 600000.SH -> sh600000
  const qqCodes = codeList.map((code: string) => toQqCode(code.trim())).join(',');

  try {
    // 获取实时行情
    const quoteBuffer = await httpGet(`https://qt.gtimg.cn/q=${qqCodes}`);
    const quoteText = new TextDecoder('gbk').decode(quoteBuffer);
    const quotes = parseTencentQuote(codeList, quoteText);

    const result: any[] = [];

    for (const quote of quotes) {
      const item: any = { ...quote };

      // 如果需要计算指标
      if (includeIndicators) {
        try {
          // 获取60天日K线数据
          const qqCode = toQqCode(quote.code);
          const klineUrl = `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?_var=kline_day&param=${qqCode},day,,,60`;
          const klineBuffer = await httpGet(klineUrl);
          const klineText = klineBuffer.toString('utf8');
          const klines = parseTencentKline(quote.code, klineText);

          if (klines.length > 0) {
            // 计算指标
            const ind = computeIndicators(klines);
            const lastIndex = klines.length - 1;

            // 格式化指标
            item.indicators = formatIndicators(ind, quote.price, lastIndex);

            // 计算信号
            item.signal = computeSignal(quote.price, ind, lastIndex);
          } else {
            item.indicators = null;
            item.signal = { direction: 'neutral', strength: 0, reason: 'K线数据不足' };
          }
        } catch (indError) {
          console.error(`[API/stock/realtime] Indicator error for ${quote.code}:`, indError);
          item.indicators = null;
          item.signal = { direction: 'neutral', strength: 0, reason: '指标计算失败' };
        }
      }

      result.push(item);
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[API/stock/realtime]', error);
    return NextResponse.json({ error: 'Failed to fetch', success: false }, { status: 500 });
  }
}
