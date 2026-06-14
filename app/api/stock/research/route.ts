/**
 * 券商研报 API
 * 数据来源：东方财富 (eastmoney.com)
 * 支持：机构评级、目标价、盈利预测、研报摘要
 */
import { NextRequest, NextResponse } from 'next/server';
import { httpGetBuffer } from '@/lib/quant/http-utils';

export interface ResearchReport {
  id: string;
  title: string;          // 研报标题
  author: string;         // 券商机构
  authors: string[];      // 分析师团队
  code: string;           // 相关股票代码
  name: string;           // 相关股票名称
  rating: string;         // 评级：买入/增持/中性/减持/卖出
  ratingChange?: string;  // 评级变动：上调/下调/维持
  targetPrice?: number;   // 目标价
  currentPrice?: number;  // 当前股价（评级时）
  upside: number;        // 潜在涨幅%
  publishTime: string;    // 发布日期
  reportType: 'industry' | 'company' | 'macro'; // 研报类型
  reportPdfUrl?: string; // PDF 链接
  abstract?: string;     // 摘要
 盈利预测?: {
    year: string;
    eps: number;    // EPS 每股收益
    revenue: number; // 营业收入
    netProfit: number; // 净利润
  }[];
}

interface EastMoneyResearchResponse {
  result?: {
    data?: EastMoneyResearchItem[];
    count?: number;
  };
}

interface EastMoneyResearchItem {
  id: string;
  title: string;
  orgName: string;
  analyst: string;
  emRating: string;
  ratingChange?: string;
  estPrice?: string;
  curPrice?: string;
  orgType: string;
  rptType: string;
  publishDate: string;
  forecastTable?: string;
  securitiesCode?: string;
  securitiesName?: string;
  pdfUrl?: string;
  summary?: string;
}

/** 东方财富研报评级映射 */
const RATING_MAP: Record<string, string> = {
  '买入': '买入',
  '增持': '增持',
  '中性': '中性',
  '减持': '减持',
  '卖出': '卖出',
  '强烈推荐': '买入',
  '推荐': '买入',
  '审慎推荐': '增持',
  '回避': '减持',
  '领先大市': '买入',
  '同步大市': '中性',
  '落后大市': '卖出',
};

function parseRating(emRating: string): string {
  return RATING_MAP[emRating] || emRating || '未知';
}

function parseForecast(forecastTable: string | undefined): ResearchReport['盈利预测'] {
  if (!forecastTable) return [];
  try {
    // 格式通常是表格字符串，简单解析
    const rows = forecastTable.split(';');
    return rows.map(row => {
      const cols = row.split(',');
      if (cols.length >= 4) {
        return {
          year: cols[0]?.trim() || '',
          eps: parseFloat(cols[1]?.trim() || '0'),
          revenue: parseFloat(cols[2]?.trim() || '0'),
          netProfit: parseFloat(cols[3]?.trim() || '0'),
        };
      }
      return null;
    }).filter(Boolean) as ResearchReport['盈利预测'];
  } catch {
    return [];
  }
}

function parseReport(item: EastMoneyResearchItem): ResearchReport {
  const targetPrice = parseFloat(item.estPrice || '0');
  const currentPrice = parseFloat(item.curPrice || '0');
  const upside = currentPrice > 0 && targetPrice > 0
    ? parseFloat(((targetPrice - currentPrice) / currentPrice * 100).toFixed(2))
    : 0;

  // 研报 URL
  const reportUrl = item.pdfUrl ||
    (item.id ? `https://data.eastmoney.com/report/RESEARCH_REPORT/${item.id}.html` : '');

  return {
    id: item.id,
    title: item.title,
    author: item.orgName || '',
    authors: item.analyst ? [item.analyst] : [],
    code: item.securitiesCode || '',
    name: item.securitiesName || '',
    rating: parseRating(item.emRating),
    ratingChange: item.ratingChange || undefined,
    targetPrice: targetPrice > 0 ? targetPrice : undefined,
    currentPrice: currentPrice > 0 ? currentPrice : undefined,
    upside,
    publishTime: item.publishDate || '',
    reportType: (item.rptType === 'industry_report' ? 'industry' : 'company') as ResearchReport['reportType'],
    reportPdfUrl: reportUrl,
    abstract: item.summary,
    盈利预测: parseForecast(item.forecastTable),
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code') || '';         // 股票代码
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
  const type = searchParams.get('type') || 'all';      // all|company|industry

  try {
    let url: string;
    const num = pageSize;
    const pn = page;

    if (code) {
      // 个股研报
      const secid = code.endsWith('.SH') ? `1.${code.replace('.SH', '')}` : `0.${code.replace('.SZ', '')}`;
      url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_RESEARCH_REPORT&columns=ALL&filter=(SECUCODE%3D%22${secid}%22)&pageNumber=${pn}&pageSize=${num}&sortTypes=-1&sortColumns=PUBLISHDATE&source=WEB&client=WEB`;
    } else {
      // 最新全市场研报
      const typeFilter = type === 'industry' ? '(RPTTYPE%3D%22industry_report%22)' : '';
      url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_RESEARCH_REPORT&columns=ALL${typeFilter}&pageNumber=${pn}&pageSize=${num}&sortTypes=-1&sortColumns=PUBLISHDATE&source=WEB&client=WEB`;
    }

    const buffer = await httpGetBuffer(url);
    const text = buffer.toString('utf8');
    let result: EastMoneyResearchResponse;

    try {
      result = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'Invalid response', success: false, data: [] }, { status: 200 });
    }

    const reports: ResearchReport[] = [];
    const items = result?.result?.data || [];
    for (const item of items) {
      reports.push(parseReport(item as EastMoneyResearchItem));
    }

    return NextResponse.json({
      data: reports,
      count: reports.length,
      total: result?.result?.count || 0,
      page,
      pageSize,
      success: true,
    });
  } catch (error) {
    console.error('[API/stock/research]', error);
    return NextResponse.json({ error: 'Failed to fetch research', success: false, data: [] }, { status: 200 });
  }
}
