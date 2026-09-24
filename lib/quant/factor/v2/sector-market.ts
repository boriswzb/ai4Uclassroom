/**
 * Factor v2 — 全市场板块行情数据源（B 方案：热点板块对齐业界口径）
 *
 * 业界标准的"热点板块"用【全市场行业板块行情】判定，而不是候选池内的小样本。
 * 本模块拉东财 push2 行业板块行情（每个板块：涨跌幅、成交额、主力净流入、上涨/下跌家数），
 * 让热点板块统计口径与业界对齐（每板块几十上百只成分，而非候选池仅 3~8 只的失真样本）。
 *
 * ⚠️ push2.eastmoney.com 在服务器端【间歇性被墙】（实测：小字段请求成功、全字段请求被
 * RemoteDisconnected 断开）——因此本模块：
 *   1) 只用精简字段（f2,f3,f6,f14,f62,f104,f105），降低请求体积减小被墙概率；
 *   2) 模块级缓存（默认 5 分钟）+ 失败静默返回 null，由调用方降级回候选池聚合逻辑。
 *
 * 调用方：lib/quant/factor/v2/hot-sector.ts::computeHotSectors(cfg.market)
 *
 * 东财板块字段（push2 clist, fs=m:90+t:2+f:!50 = 行业板块）：
 *   f2 板块最新点位 / f3 涨跌幅% / f6 成交额 / f14 板块名
 *   f62 主力净流入 / f104 上涨家数 / f105 下跌家数
 * 板块名（半导体/白酒/银行/证券/电力…）与 industry-map.ts 静态行业名基本一致，可直接按名匹配。
 */
import https from 'node:https';

export interface SectorBoardQuote {
  name: string;        // 板块/行业名
  pct: number;         // 当日涨跌幅 %（f3）
  amount: number;      // 成交额（f6，元）
  mainInflow: number;  // 主力净流入（f62，元；负=流出）
  upCount: number;     // 上涨家数（f104）
  downCount: number;   // 下跌家数（f105）
}

// 模块级缓存
let _cache: { map: Map<string, SectorBoardQuote>; ts: number } | null = null;
let CACHE_TTL = 5 * 60_000;

function httpGet(url: string, timeout = 12000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://quote.eastmoney.com/',
        'Accept': '*/*',
      },
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

/**
 * 拉全市场行业板块行情 → Map<板块名, SectorBoardQuote>。
 * 失败/被墙 → 返回 null（调用方降级到候选池聚合）。
 */
export async function fetchSectorBoardMarket(): Promise<Map<string, SectorBoardQuote> | null> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL) return _cache.map;
  try {
    // 精简字段，pz=500 一次拉全（行业板块约 496 个）
    const url =
      'https://push2.eastmoney.com/api/qt/clist/get' +
      '?pn=1&pz=600&po=1&np=1&fltt=2&invt=2&fid=f3' +
      '&fs=m:90+t:2+f:!50&fields=f2,f3,f6,f14,f62,f104,f105';
    const text = await httpGet(url);
    const json = JSON.parse(text);
    const rows = json?.data?.diff;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const map = new Map<string, SectorBoardQuote>();
    for (const r of rows) {
      const name = typeof r.f14 === 'string' ? r.f14.trim() : '';
      if (!name) continue;
      map.set(name, {
        name,
        pct: r.f3 ?? 0,
        amount: r.f6 ?? 0,
        mainInflow: r.f62 ?? 0,
        upCount: r.f104 ?? 0,
        downCount: r.f105 ?? 0,
      });
    }
    if (map.size === 0) return null;
    _cache = { map, ts: Date.now() };
    return map;
  } catch (e) {
    // 被墙/超时/解析失败 → 静默返回 null，调用方走候选池聚合降级
    console.warn('[SectorMarket] fetch failed (push2 被墙/超时), fallback to pool aggregation:', (e as Error).message);
    return null;
  }
}

/** 清理缓存（测试用） */
export function clearSectorBoardCache(): void { _cache = null; }
