/**
 * 个股新闻 API
 * 数据来源：东方财富 (eastmoney.com)
 * 接口：个股新闻、公告、研报等综合资讯
 */
import { NextRequest, NextResponse } from 'next/server';
import { httpGetBuffer } from '@/lib/quant/http-utils';

export interface NewsItem {
  id: string;
  title: string;
  content: string;
  source: string;      // 新闻来源，如"东方财富"
  publishTime: string; // 发布时间 "YYYY-MM-DD HH:mm"
  url: string;
  code?: string;       // 关联股票代码
  tags: string[];      // 标签：["利好","业绩超预期"]等
  sentiment?: 'positive' | 'negative' | 'neutral'; // 情感倾向
  isImportant: boolean; // 是否重大 newsType === '重要'
}

interface EastMoneyNewsResponse {
  data: {
    pageindex: number;
    pagesize: number;
    total: number;
    list: EastMoneyNewsItem[];
  };
}

interface EastMoneyNewsItem {
  id: string;
  title: string;
  showTime: string;
  sources: string;
  Digest: string;
  notess: string;  // 关联股票代码，逗号分隔
  isquote: number;
  istj: number;    // 是否重大 1=重大
  BIGDISPOSID: string;
  ENTitle: string;
  url: string;
  lzqjSD: string;   // lzqjSD=1 疑似利好
  lzqjJX: string;   // lzqjJX=1 疑似利空
}

function toSentiment(item: EastMoneyNewsItem): 'positive' | 'negative' | 'neutral' {
  if (item.lzqjSD === '1') return 'positive';
  if (item.lzqjJX === '1') return 'negative';
  return 'neutral';
}

function toTags(item: EastMoneyNewsItem, title: string): string[] {
  const tags: string[] = [];
  if (item.istj === 1 || item.BIGDISPOSID) tags.push('重大');
  if (item.lzqjSD === '1') tags.push('利好');
  if (item.lzqjJX === '1') tags.push('利空');
  if (item.isquote === 1) tags.push('个股');
  // 从 title 提取关键词
  const kwMap: [string, string][] = [
    ['涨停', '涨停'], ['跌停', '跌停'], ['业绩', '业绩'],
    ['分红', '分红'], ['并购', '并购'], ['减持', '减持'],
    ['增持', '增持'], ['回购', '回购'], ['转债', '转债'],
    ['上市', '上市'], ['IPO', 'IPO'], ['科创', '科创板'],
    ['创业板', '创业板'], ['北交所', '北交所'], ['风险警示', '风险'],
  ];
  for (const [kw, tag] of kwMap) {
    if (title.includes(kw) && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function parseNewsItem(item: EastMoneyNewsItem): NewsItem {
  // 东方财富新闻 URL 格式
  const url = item.url || `https://finance.eastmoney.com/news/${item.id}.html`;

  return {
    id: item.id,
    title: item.title,
    content: item.Digest || '',
    source: item.sources || '东方财富',
    publishTime: item.showTime || '',
    url,
    code: item.notess || undefined,
    tags: toTags(item, item.title),
    sentiment: toSentiment(item),
    isImportant: item.istj === 1 || !!item.BIGDISPOSID,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code') || '';       // 股票代码如 000001
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
  const newsType = searchParams.get('type') || 'all'; // all|company|industry

  try {
    let url: string;

    if (code) {
      // 个股新闻 - 东方财富个股资讯接口
      const secid = code.endsWith('.SH') ? `1.${code.replace('.SH', '')}` : `0.${code.replace('.SZ', '')}`;
      // 东方财富 F10 个股新闻
      url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_NEWS_FOR_ORGINFO&columns=ALL&filter=(SECUCODE%3D%22${secid}%22)&pageNumber=${page}&pageSize=${pageSize}&sortTypes=-1&sortColumns=SHOWTIME&source=WEB&client=WEB`;
    } else {
      // 市场全资讯 - 东方财富 A 股资讯
      const nodeMap: Record<string, string> = {
        all: 'hs_a',           // A股资讯
        company: 'gsxw',      // 公司新闻
        industry: 'hyxw',      // 行业新闻
      };
      const node = nodeMap[newsType] || 'hs_a';
      url = `https://newsapi.eastmoney.com/kuaixun/v1/getlist_101_all_${page}_${pageSize}.html`;
    }

    const buffer = await httpGetBuffer(url);
    const text = buffer.toString('utf8');

    let result: EastMoneyNewsResponse | null = null;
    try {
      result = JSON.parse(text);
    } catch {
      // 尝试解析为非标准 JSON 格式
    }

    const news: NewsItem[] = [];
    if (result?.data?.list) {
      for (const item of result.data.list) {
        news.push(parseNewsItem(item as EastMoneyNewsItem));
      }
    }

    // 如果东方财富接口格式不符，回退使用新浪财经新闻
    if (news.length === 0 && code) {
      return fetchFromSina(code, page, pageSize);
    }

    return NextResponse.json({
      data: news,
      count: news.length,
      page,
      pageSize,
      success: true,
    });
  } catch (error) {
    console.error('[API/stock/news]', error);
    // 回退：尝试新浪财经
    if (code) {
      try {
        return await fetchFromSina(code, page, pageSize);
      } catch {
        // ignore
      }
    }
    return NextResponse.json({ error: 'Failed to fetch news', success: false, data: [] }, { status: 200 });
  }
}

async function fetchFromSina(code: string, page: number, pageSize: number): Promise<NextResponse> {
  const num = pageSize;
  const pageNum = page;
  const sinacode = code.endsWith('.SH') ? `sh${code.replace('.SH', '')}` : `sz${code.replace('.SZ', '')}`;
  const url = `https://vip.stock.finance.sina.com.cn/corp/go.php/vCR_CompanyNews/kind/search/id/${sinacode.slice(2)}.phtml`;

  // 新浪没有公开 API，回退到东方财富的另一个接口
  const secid = code.endsWith('.SH') ? `1.${code.replace('.SH', '')}` : `0.${code.replace('.SZ', '')}`;
  const buffer = await httpGetBuffer(
    `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_NEWS_FOR_ORGINFO&columns=ALL&filter=(SECUCODE%3D%22${secid}%22)&pageNumber=${pageNum}&pageSize=${num}&sortTypes=-1&sortColumns=SHOWTIME&source=WEB&client=WEB`
  );
  const text = buffer.toString('utf8');
  const result = JSON.parse(text);
  const news: NewsItem[] = [];

  if (result?.data?.list) {
    for (const item of result.data.list) {
      news.push(parseNewsItem(item as EastMoneyNewsItem));
    }
  }

  return NextResponse.json({ data: news, count: news.length, page, pageSize, success: true });
}
