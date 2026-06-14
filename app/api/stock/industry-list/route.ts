/**
 * 东财行业分类 API
 * 数据源：东方财富 证监会行业分类
 * 接口：RPT_PCBUS_TRADE_BOARD（行业板块汇总）
 *       RPT_PCBUS_BKCOLUMN_HS（板块成分股）
 *
 * 统一行业数据出口，解决 industry-map.ts 静态字典为空的问题。
 */
import { NextRequest, NextResponse } from 'next/server';
import https from 'node:https';

function httpGet(url: string, timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://data.eastmoney.com/',
        'Accept': '*/*',
      },
      secureProtocol: 'TLSv1_2_method',
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

interface EastMoneyBoard {
  BOARDCODE: string;   // 板块代码，如 "BK0467"
  BOARDNAME: string;   // 板块名称，如 "半导体"
  CLOSEPICE?: string;
  CHANGE_RATE?: string;
  AVG_PRICE?: string;
  UP_COUNT?: string;   // 上涨家数
  DOWN_COUNT?: string; // 下跌家数
  NEWEST_PRICE?: string;
  TURNOVERRATE?: string;
  RELATIVE_MARKET?: string;
  TOTAL_MARKET?: string;
}

interface BoardResult {
  code: number;
  message: string;
  data: {
    result: {
      pages: number;
      data: EastMoneyBoard[];
    };
  };
}

// 全量行业板块列表（东财）
const BOARD_LIST_API =
  'https://datacenter-web.eastmoney.com/api/data/v1/get' +
  '?reportName=RPT_PCBUS_TRADE_BOARD' +
  '&columns=BOARDCODE,BOARDNAME,CHANGE_RATE,UP_COUNT,DOWN_COUNT,NEWEST_PRICE,TURNOVERRATE,RELATIVE_MARKET,TOTAL_MARKET' +
  '&pageNumber=1&pageSize=200' +
  '&type=RPT_PCBUS_TRADE_BOARD' +
  '&token=894050c76af8597a853f5b408b759f5d';

// 缓存
let industryCache: { boards: IndustryBoard[]; ts: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10分钟

export interface IndustryBoard {
  code: string;       // 东财板块代码
  name: string;        // 板块名称
  changeRate: number;  // 涨跌幅
  upCount: number;     // 上涨数
  downCount: number;   // 下跌数
  stockCount: number;  // 成分股数量
}

export interface StockIndustry {
  code: string;   // 股票代码，如 "600000.SH"
  name: string;
  industry: string;   // 行业/板块名称
  boardCode: string;  // 东财板块代码
}

async function fetchBoards(): Promise<IndustryBoard[]> {
  if (industryCache && Date.now() - industryCache.ts < CACHE_TTL) {
    return industryCache.boards;
  }

  try {
    const text = await httpGet(BOARD_LIST_API);
    const json: BoardResult = JSON.parse(text);

    if (json.code !== 0 || !json.data?.result?.data) {
      throw new Error(`EastMoney API error: ${json.message}`);
    }

    const boards: IndustryBoard[] = json.data.result.data
      .map((b: EastMoneyBoard) => ({
        code: b.BOARDCODE || '',
        name: b.BOARDNAME || '',
        changeRate: parseFloat(b.CHANGE_RATE || '0'),
        upCount: parseInt(b.UP_COUNT || '0', 10),
        downCount: parseInt(b.DOWN_COUNT || '0', 10),
        stockCount: parseInt(b.UP_COUNT || '0', 10) + parseInt(b.DOWN_COUNT || '0', 10),
      }))
      .filter(b => b.name && b.name !== '-');

    industryCache = { boards, ts: Date.now() };
    console.log(`[IndustryList] 加载 ${boards.length} 个东财行业板块`);
    return boards;
  } catch (e) {
    console.error('[IndustryList] 获取东财行业数据失败:', e);
    // 降级：返回空数组（不要让整个API崩溃）
    return industryCache?.boards || [];
  }
}

// 股票代码转东财格式
function toSecuCode(code: string): string {
  const num = code.replace('.SZ', '').replace('.SH', '').replace('.BJ', '');
  if (code.endsWith('.SH')) return `${num}.SH`;
  if (code.endsWith('.SZ')) return `${num}.SZ`;
  if (code.endsWith('.BJ')) return `${num}.BJ`;
  return num;
}

// 获取单只股票的东财行业信息
async function fetchStockIndustry(code: string): Promise<StockIndustry | null> {
  const secucode = toSecuCode(code);
  const url =
    'https://datacenter-web.eastmoney.com/api/data/v1/get' +
    '?reportName=RPT_F10_BASIC_ORGINFO' +
    '&columns=SECUCODE,SECURITY_CODE,SECURITY_NAME,ORG_NAME,ORG_TYPE' +
    `&filter=(SECUCODE%3D%22${secucode}%22)` +
    '&pageNumber=1&pageSize=1' +
    '&token=894050c76af8597a853f5b408b759f5d';

  try {
    const text = await httpGet(url, 10000);
    const json = JSON.parse(text);
    // 这个接口返回的是公司基本信息，不含行业
    // 改用股票搜索接口含行业字段
    return null;
  } catch {
    return null;
  }
}

// 获取行业板块下的成分股（批量）
async function fetchBoardStocks(boardCode: string): Promise<string[]> {
  const url =
    'https://datacenter-web.eastmoney.com/api/data/v1/get' +
    '?reportName=RPT_PCBUS_BKCOLUMN_DJSJ' +
    '&columns=SECUCODE,SECURITY_CODE' +
    `&filter=(BOARDCODE%3D%22${boardCode}%22)` +
    '&pageNumber=1&pageSize=500' +
    '&token=894050c76af8597a853f5b408b759f5d';

  try {
    const text = await httpGet(url, 15000);
    const json = JSON.parse(text);
    if (json.code !== 0 || !json.data?.result?.data) return [];
    return (json.data.result.data as Array<{SECUCODE: string}>)
      .map((s: {SECUCODE: string}) => {
        const sc = s.SECUCODE || '';
        if (sc.endsWith('.SH')) return sc;
        if (sc.endsWith('.SZ')) return sc;
        return sc;
      });
  } catch {
    return [];
  }
}

// 全量A股 → 东财行业映射（缓存在内存）
let stockIndustryMap: Map<string, string> | null = null; // code -> boardName
let stockIndustryTs = 0;
const STOCK_INDUSTRY_TTL = 60 * 60 * 1000; // 1小时

async function buildStockIndustryMap(): Promise<Map<string, string>> {
  if (stockIndustryMap && Date.now() - stockIndustryTs < STOCK_INDUSTRY_TTL) {
    return stockIndustryMap;
  }

  console.log('[IndustryList] 构建股票→行业映射（全量A股）...');
  const boards = await fetchBoards();
  const map = new Map<string, string>();

  // 批量获取各板块成分股
  const batchSize = 5;
  for (let i = 0; i < boards.length; i += batchSize) {
    const chunk = boards.slice(i, i + batchSize);
    const results = await Promise.all(
      chunk.map(async (b) => {
        const codes = await fetchBoardStocks(b.code);
        return { name: b.name, codes };
      })
    );
    for (const { name, codes } of results) {
      for (const code of codes) {
        if (!map.has(code)) map.set(code, name);
      }
    }
    console.log(`[IndustryList] 已处理 ${Math.min(i + batchSize, boards.length)}/${boards.length} 板块`);
  }

  stockIndustryMap = map;
  stockIndustryTs = Date.now();
  console.log(`[IndustryList] 映射完成，共 ${map.size} 只股票`);
  return map;
}

// GET /api/stock/industry-list
// 返回行业板块列表
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const boardCode = searchParams.get('boardCode');
  const code = searchParams.get('code'); // 单只股票的行业

  try {
    // 单只股票行业查询
    if (code) {
      const map = await buildStockIndustryMap();
      const industry = map.get(code);
      return NextResponse.json({
        success: true,
        data: industry || '其他',
        code,
      });
    }

    // 返回全量行业板块列表
    if (boardCode) {
      const stocks = await fetchBoardStocks(boardCode);
      return NextResponse.json({ success: true, data: { boardCode, stocks } });
    }

    // 默认返回全量板块列表
    const boards = await fetchBoards();
    return NextResponse.json({
      success: true,
      data: boards,
      total: boards.length,
    });
  } catch (e) {
    console.error('[IndustryList]', e);
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
