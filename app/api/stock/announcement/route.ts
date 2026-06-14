/**
 * 公司公告 API
 * 数据来源：东方财富 (eastmoney.com)
 * 支持按股票代码查询历年公告列表
 */
import { NextRequest, NextResponse } from 'next/server';
import { httpGetBuffer } from '@/lib/quant/http-utils';

export interface Announcement {
  id: string;
  title: string;         // 公告标题
  code: string;          // 股票代码
  name: string;          // 公司简称
  category: string;      // 公告类别
  publishTime: string;   // 发布时间
  url: string;           // 公告 PDF 链接
  pages?: number;        // 页数
  abstract?: string;     // 摘要
}

interface EastMoneyAnnouncementResponse {
  result?: {
    data?: EastMoneyAnnouncementItem[];
    count?: number;
  };
}

interface EastMoneyAnnouncementItem {
  noticeId: string;
  secCode: string;
  secName: string;
  noticeType: string;
  announcementTitle: string;
  publishTime: string;
  accessoryPath: string;
  pageNo?: number;
  noticeTypeName?: string;
  digest?: string;
}

/** 东方财富公告类别映射 */
const CATEGORY_MAP: Record<string, string> = {
  '0300': '业绩预告/快报',
  '0301': '定期报告',
  '0302': '利润分配',
  '0303': '配股',
  '0304': '公开增发',
  '0305': '限售股上市',
  '0306': '股权激励',
  '0307': '增持/回购',
  '0308': '减持',
  '0309': '并购重组',
  '0310': '风险提示',
  '0311': '退市/终止上市',
  '0399': '其他',
};

function parseCategory(typeCode: string): string {
  return CATEGORY_MAP[typeCode] || CATEGORY_MAP['0399'];
}

function buildPdfUrl(noticeId: string, accessoryPath: string): string {
  if (!accessoryPath) return '';
  if (accessoryPath.startsWith('http')) return accessoryPath;
  // 东方财富 PDF 路径格式
  return `https://www.cninfo.com.cn/new/disclosure/detail?noticeId=${noticeId}&noticeTime=${accessoryPath}`;
}

function parseAnnouncement(item: EastMoneyAnnouncementItem): Announcement {
  // 优先使用 cninfo 链接（巨潮网）
  const url = `https://www.cninfo.com.cn/new/disclosure/detail?noticeId=${item.noticeId}`;

  return {
    id: item.noticeId,
    title: item.announcementTitle,
    code: item.secCode,
    name: item.secName,
    category: item.noticeTypeName || parseCategory(item.noticeType),
    publishTime: item.publishTime,
    url,
    pages: item.pageNo,
    abstract: item.digest,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code') || '';        // 股票代码如 000001
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
  const category = searchParams.get('category') || ''; // 可选：过滤公告类型

  if (!code) {
    return NextResponse.json({ error: 'code is required', success: false }, { status: 400 });
  }

  try {
    // 东方财富公告接口（巨潮网数据源）
    const secid = code.endsWith('.SH') ? `1.${code.replace('.SH', '')}` : `0.${code.replace('.SZ', '')}`;
    let url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_ANNOUNCEMENT_JUCHAO&columns=ALL&filter=(SECUCODE%3D%22${secid}%22)&pageNumber=${page}&pageSize=${pageSize}&sortTypes=-1&sortColumns=PUBLISHTIME&source=WEB&client=WEB`;

    if (category) {
      url += `&filter=(NOTICETYPE%3D%22${category}%22)`;
    }

    const buffer = await httpGetBuffer(url);
    const text = buffer.toString('utf8');
    let result: EastMoneyAnnouncementResponse;
    try {
      result = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'Invalid response', success: false, data: [] }, { status: 200 });
    }

    const announcements: Announcement[] = [];
    const items = result?.result?.data || [];
    for (const item of items) {
      announcements.push(parseAnnouncement(item as EastMoneyAnnouncementItem));
    }

    return NextResponse.json({
      data: announcements,
      count: announcements.length,
      total: result?.result?.count || 0,
      page,
      pageSize,
      success: true,
    });
  } catch (error) {
    console.error('[API/stock/announcement]', error);
    return NextResponse.json({ error: 'Failed to fetch announcements', success: false, data: [] }, { status: 200 });
  }
}
