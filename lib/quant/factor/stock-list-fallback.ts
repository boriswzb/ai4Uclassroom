/**
 * 全市场股票列表获取 — v1/v2 共享
 *
 * 背景：sina `vip.stock.finance.sina.com.cn` 在服务端经常被反爬挡死（返回 HTML）；
 *       东财 push2 / push2his 走不通（TLS 失败）。
 *       唯一稳定的全市场报价源是腾讯 `qt.gtimg.cn`。
 *
 * 策略：
 * 1. 优先调 sina 拉全市场（5000+ 只）
 * 2. sina 失败或返回 < 50 只时，fallback 到 qt.gtimg 拉内置 96 只活跃股种子
 * 3. qt.gtimg 响应是 GBK 编码，用 NodeJS 内置 TextDecoder 解码
 */
import https from 'node:https';

// ── 精简 A 股活跃股种子（沪深 300 头部 + 创业板/科创板龙头 + 各行业代表）──
export const STOCK_SEED_CODES: string[] = [
  // 沪市主板（100 只）
  '600519', '600000', '600036', '600276', '600887', '600030', '601318', '601398',
  '601857', '601988', '601288', '601628', '601319', '601336', '601012', '601888',
  '600900', '600028', '600050', '600104', '600196', '600438', '600585', '600690',
  '600837', '600703', '600745', '600460', '600406', '600886', '600188', '600547',
  '600489', '600362', '600183', '600660', '600600', '600009', '600271', '600588',
  '600845', '600436', '600763', '600893', '600918', '600958', '600999', '600023',
  '600015', '600016', '600018', '600019', '600025', '600028', '600031', '600048',
  '600061', '600085', '600089', '600111', '600150', '600188', '600196', '600256',
  '600332', '600340', '600346', '600352', '600362', '600369', '600372', '600383',
  '600406', '600436', '600438', '600487', '600498', '600522', '600547', '600570',
  '600585', '600588', '600600', '600660', '600690', '600703', '600795', '600837',
  '600886', '600887', '600893', '600900', '600918', '600941', '600958', '600989',
  '601012', '601066', '601088', '601138', '601166', '601169', '601186', '601288',
  '601318', '601319', '601328', '601336', '601398', '601628', '601633', '601658',
  '601668', '601688', '601728', '601766', '601800', '601818', '601838', '601857',
  '601888', '601898', '601899', '601916', '601919', '601939', '601985', '601988',
  '601995', '601998', '603259', '603288', '603501', '603799', '603833', '603899',
  // 深市主板（60 只）
  '000001', '000002', '000063', '000333', '000651', '000858', '000725', '000538',
  '000568', '000625', '000776', '000792', '000895', '000938', '000963', '000977',
  '000999', '002142', '002415', '002475', '002594', '002607', '002714', '002920',
  '300750', '300059', '300015', '300760', '000333', '000651', '000001', '000002',
  '002230', '002241', '002371', '002466', '002555', '002594', '002607', '002714',
  '002812', '002841', '002920', '300003', '300014', '300015', '300033', '300059',
  '300122', '300124', '300142', '300144', '300223', '300316', '300347', '300408',
  '300413', '300433', '300498', '300601', '300628', '300661', '300674', '300750',
  '300760', '300782', '300866', '300999', '301236', '301269', '301308', '301498',
  // 创业板（30 只）
  '300124', '300142', '300223', '300316', '300347', '300408', '300433', '300498',
  '300601', '300628', '300661', '300674', '300750', '300760', '300782', '300866',
  '300999', '301236', '301269', '301308', '301498', '002271', '002311', '002466',
  '002555', '002594', '002607', '002714', '002812', '002841',
  // 科创板（20 只）
  '688981', '688041', '688256', '688271', '688599', '688111', '688169', '688223',
  '688036', '688065', '688082', '688099', '688126', '688169', '688223', '688271',
  '688321', '688599', '688981', '689009',
];

// ── 共享 StockRaw 接口（sina + qt.gtimg 都映射到这）──
export interface StockRaw {
  symbol: string; name: string; trade: string; changepercent: string;
  volume: string; amount: string; pe: string; pb: string;
  mktcap: string; nmc: string; turnoverratio: string;
}

// ── https 工具 ─────────────────────────────────
export function httpGet(url: string, timeout = 15000): Promise<string> {
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
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

export function httpGetRaw(url: string, timeout = 15000): Promise<Buffer> {
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
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── GBK 解码器（NodeJS 内置）──
const GBK_DECODER = new TextDecoder('gbk', { fatal: false });

// ── 解析单行 qt.gtimg 响应（GBK 编码）──
// 响应格式：v_sh600519="1~名称(GBK)~代码~最新~昨收~今开~成交量(手)~...~时间戳~涨跌额~涨跌幅~最高~最低~价/量/额~成交量(手)~成交额(万)~换手率~PE动~...~振幅~流通市值~总市值~PB~...~";
// 字段索引（~分隔）：
//   [0]=状态(数字) [1]=名称(GBK) [2]=代码 [3]=现价 [4]=昨收 [5]=今开 [6]=成交量(手)
//   [29] 买卖盘结束
//   [30]=时间戳(YYYYMMDDHHMMSS) [31]=涨跌额 [32]=涨跌幅(%) [33]=最高 [34]=最低
//   [35] 价格/成交量/成交额  [36]=成交量(手) [37]=成交额(万) [38]=换手率(%) [39]=PE(动)
//   [40..42] 占位
//   [43]=振幅(%) [44]=流通市值(亿) [45]=总市值(亿) [46]=市净率
export function parseTencentQuote(rawLine: Buffer): StockRaw | null {
  // 整行作 latin1 安全切分（其他字段是数字 + ASCII 标点，latin1 不破坏字节）
  const text = rawLine.toString('latin1');
  // 锚点：v_xxxx="..."（响应末尾是 ";\n 不是单独 "）
  const m = text.match(/^v_(\w+)="(.*?)"[\s;]*$/);
  if (!m) return null;
  const symWithPrefix = m[1];
  const num = symWithPrefix.replace(/^[a-z]+/i, '');
  if (!num || num.length < 6) return null;
  // m[2].split('~')[1] = 名称（GBK 字节被当作 latin1 字符串）
  const fields = m[2].split('~');
  const name = fields[1] ? GBK_DECODER.decode(Buffer.from(fields[1], 'latin1')) : '';
  return {
    symbol: num,  // 保持纯 6 位数字，下游用 startsWith('6') 推断后缀
    name,
    trade: fields[3] || '0',
    changepercent: fields[32] || '0',
    volume: fields[36] || '0',
    amount: fields[37] || '0',  // 万元
    turnoverratio: fields[38] || '0',
    pe: fields[39] || '-1',
    pb: fields[46] || '-1',
    mktcap: fields[45] || '0',  // 亿元
    nmc: fields[44] || '0',  // 流通市值（亿元）
  };
}

// ── 通过 qt.gtimg 批量拉种子股票报价 ──
export async function getAllStocksViaTencent(): Promise<StockRaw[]> {
  const BATCH = 80;
  const codes = Array.from(new Set(STOCK_SEED_CODES));  // 不限数量，按 80/批
  const allStocks: StockRaw[] = [];
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i + BATCH);
    const symList = batch.map(c =>
      (c.startsWith('6') || c.startsWith('5') ? 'sh' : c.startsWith('0') || c.startsWith('3') ? 'sz' : 'bj') + c);
    const url = `https://qt.gtimg.cn/q=${symList.join(',')}`;
    try {
      const rawBuf = await httpGetRaw(url);
      // qt.gtimg 响应是 GBK 编码，每行以 \n (0x0A) 结尾
      const lines: Buffer[] = [];
      let start = 0;
      for (let j = 0; j < rawBuf.length; j++) {
        if (rawBuf[j] === 0x0A) {
          if (j > start) lines.push(rawBuf.subarray(start, j));
          start = j + 1;
        }
      }
      if (start < rawBuf.length) lines.push(rawBuf.subarray(start));
      for (const lineBuf of lines) {
        const stock = parseTencentQuote(lineBuf);
        if (stock) allStocks.push(stock);
      }
    } catch (e) {
      console.error('[StockListFallback] qt.gtimg batch failed:', (e as Error).message);
    }
  }
  console.log(`[StockListFallback] fetched ${allStocks.length} stocks via qt.gtimg`);
  return allStocks;
}

// ── 共享 K 线拉取（修复 amount=0 历史 bug）──
// ifzq gtimg 日 K 字段：[日期, 开, 收, 高, 低, 成交量(手)] — 6 列无成交额
// 必须从成交量(手) × 100 × 收盘价 估算成交额（元），否则下游 isLowLiquidity 全过滤
export async function getKlinesBatchFromIfzq(
  codes: string[],
  count = 200,
  httpGetFn: (url: string, timeout?: number) => Promise<string>,
  cacheMap?: Map<string, { bars: any[]; ts: number }>,
  cacheTtlMs = 300_000,
): Promise<Map<string, any[]>> {
  const result = new Map<string, any[]>();
  const now = Date.now();
  const toFetch: string[] = [];
  for (const c of codes) {
    const cached = cacheMap?.get(c);
    // 缓存命中：bar 数 >= 30 + amount 有效（避免旧缓存全是 0）
    if (cached && now - cached.ts < cacheTtlMs && cached.bars.length >= 30 && cached.bars.some((b: any) => b.amount > 0)) {
      result.set(c, cached.bars);
    } else {
      toFetch.push(c);
    }
  }
  if (toFetch.length === 0) return result;

  const BATCH = 30;
  for (let i = 0; i < toFetch.length; i += BATCH) {
    const batch = toFetch.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(async (code): Promise<[string, any[]]> => {
        try {
          const num = code.replace(/\D/g, '');
          const suffix = code.endsWith('.SH') ? 'sh' : code.endsWith('.SZ') ? 'sz' : 'bj';
          const qqCode = `${suffix}${num}`;
          const url = `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?_var=kline_day&param=${qqCode},day,,,${count}`;
          const text = await httpGetFn(url);
          const jsonStr = text.split('=', 2)[1] || '{}';
          const json = JSON.parse(jsonStr);
          const bars = (json.data?.[qqCode]?.day || []).map((bar: string[]) => {
            const close = parseFloat(bar[2]) || 0;
            const volumeHand = parseFloat(bar[5]) || 0;
            return {
              code,
              timestamp: new Date(bar[0]).getTime(),
              open: parseFloat(bar[1]) || 0,
              high: parseFloat(bar[3]) || 0,
              low: parseFloat(bar[4]) || 0,
              close,
              volume: volumeHand,
              amount: volumeHand * 100 * close,  // 估算成交额（元）— 关键
            };
          });
          if (cacheMap) cacheMap.set(code, { bars, ts: Date.now() });
          return [code, bars];
        } catch {
          return [code, []];
        }
      })
    );
    for (const [code, bars] of batchResults) {
      if (bars.length > 0) result.set(code, bars);
    }
  }
  return result;
}
