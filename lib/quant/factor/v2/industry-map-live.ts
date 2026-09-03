/**
 * v2 行业实时映射 — datacenter.eastmoney.com RPT_F10_ORG_BASICINFO 真实行业
 *
 * 背景与根因（2026-09 修复 v2 — 前版依赖东财 push2 clist f100）：
 *   industry-map.ts#getIndustry() 用静态 PAIRS 表 + PREFIX_MAP 代码前缀兜底。
 *   PREFIX_MAP 由"每个 PAIRS 代码的前 3/4 位"构建，只保留第一个出现的行业 ——
 *   造成：002 开头所有中小板股 →「汽车整车」、000 →「房地产开发」、601 →「银行」，
 *   灾难性错误分类，直接污染行业中性化 + 热点板块聚合。
 *
 * 前版方案（push2 clist f100 全市场分页拉取）的两个根本问题：
 *   1) push2.eastmoney.com 在服务器端**间歇性被墙**（curl/node 常 Empty reply），
 *      依赖它做全市场行业映射非常脆弱；
 *   2) 批量分页拉取时 f12(f100) 出现**代码与行业错位**（抽查 5 只看不出，拉大批量露馅），
 *      导致众兴菌业→证券、海天精工→银行、迎驾贡酒→半导体 等张冠李戴。
 *
 * 本版方案（2026-09 修复 v2）：
 *   datacenter.eastmoney.com **可达且权威**（实测 200），
 *   RPT_F10_ORG_BASICINFO 每只股返回东财一级/二级行业板（BOARD_NAME_1LEVEL/_2LEVEL）：
 *     000001 平安银行 → 银行；600519 贵州茅台 → 白酒Ⅱ；
 *     000951 中国重汽 → 商用车；601882 海天精工 → 通用设备；
 *     002772 众兴菌业 → 种植业；300008 天海防务 → 航海装备Ⅱ。
 *   按代码**精确**查询 → 无分页、无错位；并发限流 + 模块级缓存(TTL 7d) + in-flight 去重。
 *   行业名规范化：剥掉「Ⅱ/Ⅲ」罗马数字后缀 → 白酒Ⅱ→白酒、证券Ⅱ→证券，与静态表风格对齐。
 */
import https from 'node:https';

// 模块级缓存（code → 行业）
let _cache: Map<string, string> | null = null;
let _cacheTs = 0;
const TTL = 7 * 24 * 60 * 60 * 1000; // 7 天（行业极少变）

// in-flight 去重：每个 code 同一时刻只发起一次网络请求
const _inflight = new Map<string, Promise<string | undefined>>();

// 并发限流（防打爆 datacenter）
let _active = 0;
const _MAX_CONCURRENT = 16;
const _queue: (() => void)[] = [];

function httpGet(url: string, timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://emweb.securities.eastmoney.com/',
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

/** 简单并发信号量 */
async function withLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (_active >= _MAX_CONCURRENT) {
    await new Promise<void>((r) => _queue.push(r));
  }
  _active++;
  try {
    return await fn();
  } finally {
    _active--;
    const next = _queue.shift();
    if (next) next();
  }
}

/** 行业名规范化：白酒Ⅱ→白酒、证券Ⅱ→证券、电子化学品Ⅱ→电子化学品 */
function normalizeIndustry(raw: string): string {
  const t = raw.trim();
  return t.replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$/g, '').trim() || t;
}

/** 拉单只股票真实行业（datacenter RPT_F10），失败/无数据 → undefined */
async function fetchIndustry(sec: string): Promise<string | undefined> {
  const url =
    'https://datacenter.eastmoney.com/securities/api/data/v1/get' +
    `?reportName=RPT_F10_ORG_BASICINFO` +
    `&columns=BOARD_NAME_1LEVEL,BOARD_NAME_2LEVEL` +
    `&filter=(SECURITY_CODE%3D%22${sec}%22)&client=PC&pageNumber=1&pageSize=1`;
  return withLimit(async () => {
    const text = await httpGet(url);
    const json = JSON.parse(text);
    const rows = json?.result?.data;
    const row = Array.isArray(rows) && rows[0];
    const l2 = row?.BOARD_NAME_2LEVEL;
    const l1 = row?.BOARD_NAME_1LEVEL;
    const raw = typeof l2 === 'string' && l2.trim() ? l2 : l1;
    if (typeof raw === 'string' && raw.trim()) return normalizeIndustry(raw);
    return undefined;
  }).catch(() => undefined); // 网络/解析失败 → 失败静默，调用方走静态兜底
}

/** 规范化股票代码 → 纯 6 位数字（兼容 sh600519 / 600519.SH / 600519） */
function normalizeCode(code: string): string {
  const num = code
    .replace(/^[a-z]+/i, '')
    .replace(/\.(SZ|SH|BJ)$/i, '')
    .replace(/\D/g, '');
  return num.length === 6 ? num : '';
}

/**
 * 查单只股票的真实行业。
 * 命中缓存直接返回；未命中发起一次 datacenter 请求（in-flight 去重 + 并发限流）。
 * 未命中/失败返回 undefined，由调用方 fallback 到 getIndustry()。
 */
export async function getLiveIndustry(code: string): Promise<string | undefined> {
  const num = normalizeCode(code);
  if (!num) return undefined;

  const cached = _cache?.get(num);
  if (cached !== undefined && Date.now() - _cacheTs < TTL) return cached;

  const inflight = _inflight.get(num);
  if (inflight) return inflight;

  const p = fetchIndustry(num).then((ind) => {
    if (ind) {
      if (!_cache) _cache = new Map();
      // 覆盖：只接受有效行业，避免用错误数据覆盖已有正确缓存
      _cache.set(num, ind);
      _cacheTs = Date.now();
    }
    return ind;
  }).finally(() => {
    _inflight.delete(num);
  });
  _inflight.set(num, p);
  return p;
}

/**
 * 返回当前缓存映射（兼容旧接口；未拉取的 code 不在其中）。
 * 注意：本方案按需缓存，不保证全市场覆盖。
 */
export async function getLiveIndustryMap(): Promise<Map<string, string>> {
  return _cache ?? new Map<string, string>();
}

/** 测试用：清理缓存 */
export function clearLiveIndustryCache(): void {
  _cache = null;
  _cacheTs = 0;
  _inflight.clear();
}
