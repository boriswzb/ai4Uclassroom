/**
 * 市场舆情 API
 * 综合数据源：
 *   - 东方财富 股吧热度
 *   - 微博/雪球 情绪指标
 *   - 涨跌停家数（市场情绪温度计）
 *   - 融资融券余额（杠杆情绪）
 */
import { NextRequest, NextResponse } from 'next/server';
import { httpGetBuffer } from '@/lib/quant/http-utils';

export interface SentimentIndex {
  date: string;
  overall: number;         // 0-100，综合情绪指数
  level: 'fear' | 'neutral' | 'greed'; // 恐惧/中性/贪婪
  hotStocks: HotStock[];   // 今日最热股票
  marketBreadth: MarketBreadth; // 市场广度（涨跌家数比）
  marginBalance: MarginBalance; // 融资融券（可选）
  bullBearVote?: {          // 牛熊投票（if available）
    bullish: number;        // 看涨比例%
    bearish: number;        // 看跌比例%
    neutral: number;        // 中性比例%
  };
}

export interface HotStock {
  rank: number;
  code: string;
  name: string;
  heat: number;            // 热度值
  changePercent: number;   // 涨跌幅
  sentiment: 'positive' | 'negative' | 'neutral';
  mainTopic: string;       // 讨论最多的话题
}

export interface MarketBreadth {
  upCount: number;         // 上涨家数
  downCount: number;       // 下跌家数
  limitUpCount: number;    // 涨停家数
  limitDownCount: number;  // 跌停家数
  flatCount: number;       // 平盘家数
  upDownRatio: number;     // 涨跌比 (upCount/downCount)
  advanceRate: number;     // 市场广度 (upCount/(upCount+downCount))
}

export interface MarginBalance {
  marginBalance: number;   // 融资余额（亿元）
  marginBalanceChange: number; // 融资余额变化
  shortBalance: number;    // 融券余额（亿元）
  shortBalanceChange: number;  // 融券余额变化
  marginBalanceRatio: number;  // 融资融券比（市场偏好）
}

// 东方财富实时股吧热度
interface EMHotStock {
  SECURITY_CODE: string;
  SECURITY_NAME: string;
  HOT_SCORE: string;
  ZT_SCORE: string;
  NEWINFO_SCORE: string;
  PLATE_SCORE: string;
  CHANGE_RATE: string;
  CUR_PRICE: string;
}

/** 雪球实时热门股 */
async function fetchXueqiuHot(): Promise<HotStock[]> {
  try {
    const url = 'https://stock.xueqiu.com/v5/stock/hot/hotstock.json?size=10&type=trend&_=1';
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://xueqiu.com',
        'Cookie': 'xq_a_token=placeholder', // 需要真实 token，此处作降级
      },
      next: { revalidate: 300 },
    });
    if (!res.ok) throw new Error('xueqiu failed');
    const json = await res.json();
    const stocks: HotStock[] = [];
    const list = json?.data?.list || [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      stocks.push({
        rank: i + 1,
        code: item.symbol?.replace('SH', '.SH').replace('SZ', '.SZ') || '',
        name: item.name || item.symbol || '',
        heat: item.score || 0,
        changePercent: parseFloat(item.percent || '0'),
        sentiment: (item.percent || '0').startsWith('-') ? 'negative' :
                   parseFloat(item.percent || '0') > 0 ? 'positive' : 'neutral',
        mainTopic: item.topic || '',
      });
    }
    return stocks;
  } catch {
    return [];
  }
}

/** 东方财富 股吧热度（热度榜） */
async function fetchEastmoneyHot(): Promise<HotStock[]> {
  try {
    const url = 'https://emappdata.eastmoney.com/stockrank/getAllCurrentList?appId=appId01&devId=1&pageSize=20&pageNo=1& plateId=0&plateHotList=0&sortType=0&industryType=0&fundType=0&securityType=0&marketType=0&status=0';
    const buffer = await httpGetBuffer(url);
    const text = buffer.toString('utf8');
    const json = JSON.parse(text);
    const stocks: HotStock[] = [];
    const list = json?.data || [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      stocks.push({
        rank: i + 1,
        code: item.securityCode || '',
        name: item.securityName || '',
        heat: parseFloat(item.hotScore || '0'),
        changePercent: parseFloat(item.changeRate || '0'),
        sentiment: parseFloat(item.changeRate || '0') > 0 ? 'positive' :
                   parseFloat(item.changeRate || '0') < 0 ? 'negative' : 'neutral',
        mainTopic: '',
      });
    }
    return stocks;
  } catch {
    return [];
  }
}

/** 涨跌家数统计（东方财富市场宽度） */
async function fetchMarketBreadth(): Promise<MarketBreadth> {
  try {
    // 东方财富 A 股涨跌统计
    const url = 'https://push2ex.eastmoney.com/getMarketBreadth?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.mb&type=0&Pageindex=0&pagesize=1&ts=1&v=084E1ABB586B4480858D3ADF05F49D8D';
    const buffer = await httpGetBuffer(url);
    const text = buffer.toString('utf8');
    const json = JSON.parse(text);
    const data = json?.data || {};

    const upCount = parseInt(data.up || '0');
    const downCount = parseInt(data.down || '0');
    const flatCount = parseInt(data.flat || '0') || (5000 - upCount - downCount);
    const limitUpCount = parseInt(data.limitUp || '0');
    const limitDownCount = parseInt(data.limitDown || '0');
    const upDownRatio = downCount > 0 ? parseFloat((upCount / downCount).toFixed(2)) : 0;
    const total = upCount + downCount;
    const advanceRate = total > 0 ? parseFloat(((upCount / total) * 100).toFixed(2)) : 50;

    return {
      upCount,
      downCount,
      limitUpCount,
      limitDownCount,
      flatCount,
      upDownRatio,
      advanceRate,
    };
  } catch {
    return {
      upCount: 0,
      downCount: 0,
      limitUpCount: 0,
      limitDownCount: 0,
      flatCount: 0,
      upDownRatio: 0,
      advanceRate: 50,
    };
  }
}

/** 融资融券余额 */
async function fetchMarginBalance(): Promise<MarginBalance | null> {
  try {
    // 上海/深圳融资融券汇总
    const url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_RZRQ_MARGIN_BALANCE&columns=ALL&pageNumber=1&pageSize=1&sortTypes=-1&sortColumns=BALANCE_DATE&source=WEB&client=WEB';
    const buffer = await httpGetBuffer(url);
    const text = buffer.toString('utf8');
    const json = JSON.parse(text);
    const item = json?.result?.data?.[0];
    if (!item) return null;

    const marginBalance = parseFloat(item.rzye || '0') / 100000000; // 转换为亿
    const marginBalanceChange = parseFloat(item.rzyeChange || '0') / 100000000;
    const shortBalance = parseFloat(item.rqye || '0') / 100000000;
    const shortBalanceChange = parseFloat(item.rqyeChange || '0') / 100000000;

    return {
      marginBalance,
      marginBalanceChange,
      shortBalance,
      shortBalanceChange,
      marginBalanceRatio: shortBalance > 0 ? parseFloat((marginBalance / shortBalance).toFixed(2)) : 0,
    };
  } catch {
    return null;
  }
}

/** 综合计算情绪指数 */
function calcSentiment(breadth: MarketBreadth, margin: MarginBalance | null): SentimentIndex {
  let score = 50; // 基准 50

  // 市场宽度打分（权重 40%）
  const breadthScore = breadth.advanceRate; // 0-100
  score = score * 0.4 + breadthScore * 0.4;

  // 涨停家数加分（权重 20%）
  // 正常涨停家数 50-100 家为情绪较好
  let ztBonus = 0;
  if (breadth.limitUpCount >= 100) ztBonus = 30;
  else if (breadth.limitUpCount >= 70) ztBonus = 20;
  else if (breadth.limitUpCount >= 50) ztBonus = 10;
  else if (breadth.limitUpCount >= 30) ztBonus = 5;
  else if (breadth.limitUpCount < 10) ztBonus = -20;
  else if (breadth.limitUpCount === 0) ztBonus = -30;
  score += ztBonus * 0.2;

  // 融资融券比打分（权重 20%）
  if (margin) {
    const ratio = margin.marginBalanceRatio;
    let marginScore = 50;
    if (ratio >= 3) marginScore = 80;
    else if (ratio >= 2) marginScore = 65;
    else if (ratio >= 1.5) marginScore = 55;
    else if (ratio >= 1) marginScore = 50;
    else marginScore = 35;
    score = score * 0.8 + marginScore * 0.2;
  }

  // 限制在 0-100
  score = Math.max(0, Math.min(100, score));

  const level: SentimentIndex['level'] =
    score < 35 ? 'fear' : score > 65 ? 'greed' : 'neutral';

  return {
    date: new Date().toISOString().slice(0, 10),
    overall: parseFloat(score.toFixed(1)),
    level,
    hotStocks: [], // 单独填充
    marketBreadth: breadth,
    marginBalance: margin || {
      marginBalance: 0,
      marginBalanceChange: 0,
      shortBalance: 0,
      shortBalanceChange: 0,
      marginBalanceRatio: 0,
    },
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'all'; // all|hot|breadth|margin

  try {
    if (type === 'hot') {
      const hot = await fetchEastmoneyHot();
      return NextResponse.json({ data: hot, success: true });
    }

    if (type === 'breadth') {
      const breadth = await fetchMarketBreadth();
      return NextResponse.json({ data: breadth, success: true });
    }

    if (type === 'margin') {
      const margin = await fetchMarginBalance();
      return NextResponse.json({ data: margin, success: true });
    }

    // 全量：并行获取各维度数据
    const [hot, breadth, margin] = await Promise.all([
      fetchEastmoneyHot(),
      fetchMarketBreadth(),
      fetchMarginBalance(),
    ]);

    const sentiment = calcSentiment(breadth, margin);
    sentiment.hotStocks = hot;

    return NextResponse.json({
      data: sentiment,
      success: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API/stock/sentiment]', error);
    return NextResponse.json({ error: 'Failed to fetch sentiment', success: false }, { status: 200 });
  }
}
