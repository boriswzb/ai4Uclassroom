/**
 * 交易异动 API
 * 数据来源：东方财富 (eastmoney.com)
 * 包括：涨停原因、跌停原因、异动龙虎榜等
 */
import { NextRequest, NextResponse } from 'next/server';
import { httpGetBuffer } from '@/lib/quant/http-utils';

export interface AlertItem {
  code: string;
  name: string;
  alertType: 'zt' | 'dt' | 'yd' | 'lhb'; // 涨停/跌停/异动/龙虎榜
  alertReason: string;   // 异动原因
  publishTime: string;   // 发布时间
  changePercent: number;  // 涨跌幅
  turnover: number;      // 换手率
  amount: number;       // 成交额
  closePrice: number;   // 收盘价/当前价
  preClose: number;     // 昨收
}

interface EastMoneyZTItem {
  sc: string;   // 股票代码
  n: string;    // 股票名称
  y: string;    // 涨停原因
  t: string;    // 发布时间
  z: string;    // 涨跌幅
  h: string;    // 换手率
  e: string;    // 成交额
  p: string;    // 当前/收盘价
  o: string;    // 昨收
}

function parseZTItem(item: EastMoneyZTItem): AlertItem {
  return {
    code: item.sc,
    name: item.n,
    alertType: 'zt',
    alertReason: item.y || '未披露原因',
    publishTime: item.t,
    changePercent: parseFloat(item.z) || 0,
    turnover: parseFloat(item.h) || 0,
    amount: parseFloat(item.e) || 0,
    closePrice: parseFloat(item.p) || 0,
    preClose: parseFloat(item.o) || 0,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = (searchParams.get('type') || 'zt') as 'zt' | 'dt' | 'yd' | 'lhb';
  const date = searchParams.get('date') || ''; // 格式 YYYYMMDD
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);

  try {
    const today = date || new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const num = pageSize;
    const pn = page;

    // 东方财富 涨停原因详情接口
    // zt = 涨停池, dt = 跌停池, yd = 异动, lhb = 龙虎榜
    const apiMap: Record<string, string> = {
      zt: 'https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztts&Pageindex=0&pagesize=20&ts=1&type=0&v=084E1ABB586B4480858D3ADF05F49D8D&tb=0',
      dt: 'https://push2ex.eastmoney.com/getTopicDTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.dtts&Pageindex=0&pagesize=20&ts=1&type=0&v=084E1ABB586B4480858D3ADF05F49D8D',
      yd: 'https://push2ex.eastmoney.com/getYDZX?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ydzx',
    };

    const url = apiMap[type] || apiMap['zt'];

    const buffer = await httpGetBuffer(url);
    const text = buffer.toString('utf8');

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'Invalid response', success: false, data: [] }, { status: 200 });
    }

    const alerts: AlertItem[] = [];
    let rawData: any[] = [];

    if (type === 'zt') {
      rawData = json.data?.pool || json.pool || [];
      for (const item of rawData) {
        alerts.push(parseZTItem(item as EastMoneyZTItem));
      }
    } else if (type === 'dt') {
      rawData = json.data?.pool || json.pool || [];
      for (const item of rawData) {
        alerts.push({
          ...parseZTItem(item as EastMoneyZTItem),
          alertType: 'dt',
        });
      }
    } else if (type === 'yd') {
      rawData = json.data || [];
      for (const item of rawData) {
        alerts.push({
          code: item.sc || item.code || '',
          name: item.nm || item.name || '',
          alertType: 'yd',
          alertReason: item.r || item.reason || item.y || '异动',
          publishTime: item.t || '',
          changePercent: parseFloat(item.z || item.chg || '0'),
          turnover: parseFloat(item.h || '0'),
          amount: parseFloat(item.e || '0'),
          closePrice: parseFloat(item.p || '0'),
          preClose: parseFloat(item.o || '0'),
        });
      }
    } else {
      // 龙虎榜
      rawData = json.data || [];
      for (const item of rawData) {
        alerts.push({
          code: item.sc || '',
          name: item.nm || '',
          alertType: 'lhb',
          alertReason: item.btype ? `龙虎榜(${item.btype})` : '龙虎榜',
          publishTime: item.t || '',
          changePercent: parseFloat(item.z || '0'),
          turnover: parseFloat(item.h || '0'),
          amount: parseFloat(item.e || '0'),
          closePrice: parseFloat(item.p || '0'),
          preClose: parseFloat(item.o || '0'),
        });
      }
    }

    return NextResponse.json({
      data: alerts,
      count: alerts.length,
      type,
      date: today,
      success: true,
    });
  } catch (error) {
    console.error('[API/stock/alerts]', error);
    return NextResponse.json({ error: 'Failed to fetch alerts', success: false, data: [] }, { status: 200 });
  }
}
