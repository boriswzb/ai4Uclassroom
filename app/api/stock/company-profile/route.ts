/**
 * 公司概况 API
 * 从东方财富 RPT_F10_ORG_BASICINFO 获取个股公司概况
 *
 * 关键字段：
 * - ORG_NAME: 公司全称
 * - ORG_PROFIE / ORG_PROFILE: 公司简介
 * - MAIN_BUSINESS: 主营业务
 * - CHAIRMAN: 董事长
 * - FOUND_DATE: 成立日期
 * - REG_CAPITAL: 注册资本（万元）
 * - LISTING_DATE: 上市日期
 * - TRADE_MARKET: 上市市场
 * - CONTROL_HOLDER: 控股股东
 * - AREA_BOARD_NAME: 所属地域
 * - GROSS_PROFIT_RATIO: 毛利率
 * - INCOME_STRU_NAMENEW: 营收结构
 */
import { NextRequest, NextResponse } from 'next/server';
import https from 'https';

function httpGet(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://data.eastmoney.com/',
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

// 转换代码: 000001.SZ -> 000001 (东财格式不带后缀)
function toEmCode(code: string): string {
  return code.replace('.SZ', '').replace('.SH', '').replace('.BJ', '');
}

interface CompanyProfile {
  code: string;
  name: string;
  orgName: string;           // 公司全称
  orgProfile: string;        // 公司简介
  mainBusiness: string;       // 主营业务
  chairman: string;          // 董事长
  foundDate: string;         // 成立日期
  listingDate: string;       // 上市日期
  regCapital: number;        // 注册资本（万元）
  regCapitalFormatted: string; // 注册资本（格式化）
  tradeMarket: string;       // 上市市场
  controlHolder: string;     // 控股股东
  areaBoard: string;         // 所属地域
  grossProfitRatio: number;  // 毛利率
  incomeStructure: string;   // 营收结构
  orgTel: string;            // 联系电话
  orgEmail: string;          // 联系邮箱
  orgWeb: string;            // 公司网站
  address: string;           // 公司地址
}

function parse(data: any, code: string): CompanyProfile | null {
  if (!data) return null;

  const regCapital = parseFloat(data.REG_CAPITAL) || 0;
  // 格式化注册资本
  let regCapitalFormatted = '';
  if (regCapital >= 10000) {
    regCapitalFormatted = `${(regCapital / 10000).toFixed(2)}亿`;
  } else {
    regCapitalFormatted = `${regCapital.toFixed(2)}万`;
  }

  return {
    code,
    name: data.SECURITY_NAME_ABBR || '',
    orgName: data.ORG_NAME || '',
    orgProfile: data.ORG_PROFIE || data.ORG_PROFILE || '',
    mainBusiness: data.MAIN_BUSINESS || '',
    chairman: data.CHAIRMAN || '',
    foundDate: data.FOUND_DATE ? String(data.FOUND_DATE).slice(0, 10) : '',
    listingDate: data.LISTING_DATE ? String(data.LISTING_DATE).slice(0, 10) : '',
    regCapital,
    regCapitalFormatted,
    tradeMarket: data.TRADE_MARKET || '',
    controlHolder: data.CONTROL_HOLDER || '',
    areaBoard: data.AREA_BOARD_NAME || '',
    grossProfitRatio: parseFloat(data.GROSS_PROFIT_RATIO) || 0,
    incomeStructure: data.INCOME_STRU_NAMENEW || data.INCOME_STRU_NAME || '',
    orgTel: data.ORG_TEL || '',
    orgEmail: data.ORG_EMAIL || '',
    orgWeb: data.ORG_WEB || '',
    address: data.ADDRESS || '',
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const codes = searchParams.get('codes') || '';

  if (!codes) {
    return NextResponse.json({ error: 'codes is required' }, { status: 400 });
  }

  const codeList = codes.split(',').filter(Boolean);
  const emCodes = codeList.map(toEmCode);

  try {
    // 东方财富 RPT_F10_ORG_BASICINFO（code 不带后缀）
    const url = `https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_ORG_BASICINFO&columns=ALL&filter=(SECURITY_CODE%3D%22${emCodes.join('%22)(SECURITY_CODE%3D%22')}%22)&client=PC&pageNumber=1&pageSize=${codeList.length}`;
    const buffer = await httpGet(url);
    const raw = JSON.parse(buffer.toString('utf-8'));

    if (!raw.success || !raw.result?.data) {
      return NextResponse.json({ data: [], success: true, count: 0 });
    }

    const profiles = (raw.result.data as any[])
      .map(item => parse(item, item.SECURITY_CODE + (item.SECUCODE?.includes('.SH') ? '.SH' : '.SZ')))
      .filter(Boolean);

    return NextResponse.json({
      data: profiles,
      count: profiles.length,
      success: true,
    });
  } catch (error) {
    console.error('[API/stock/company-profile]', error);
    return NextResponse.json({ error: 'Failed to fetch company profile', success: false }, { status: 500 });
  }
}
