/**
 * 热点板块 / 板块轮动 — 纯函数模块
 *
 * 设计思想（A 股"资金市"特性）：
 *   A 股的板块行情由资金主导，热点板块往往是主力资金集中流入的方向。
 *   但纯按"当日涨幅最高板块"推荐会追高接盘（板块头部往往已大涨、估值贵）。
 *
 * 业界标准做法 = 两层结构：
 *   第 1 层（板块轮动）：在 v2 候选池内按【申万一级行业】聚合，算每个板块的
 *                         热度分（涨幅百分位 + 资金流百分位 + 上涨占比），
 *                         筛选出"当前资金集中 / 处于轮动上升期"的热点板块 TopN。
 *   第 2 层（板块内选优质股）：在热点板块【内部】按 v2 综合分取 top 股作为"板块龙头"，\
 *                         既借热点东风，又避开"追热垃圾股"。
 *
 * 与 v2 评分的关系：
 *   applySectorBoost() 会给【属于热点板块】的股票加一个板块热度分（默认权重 15%），
 *   让热点板块内的优质股在综合推荐里自然靠前 —— 这就是"热点模块多推荐一点"，
 *   但权重克制（15%），保留估值/质量/反转对冲，避免纯追热点。
 *
 * 数据来源完全自洽：只用 v2 候选池（limit*3 只，已去 ST/涨跌停/停牌）的
 *   industry + changePercent + moneyFlow 分项，无外部数据源冲突、无额外拉取。
 */

import type { V2ScoreResult } from './types';

export interface HotSectorLeader {
  code: string;
  name: string;
  composite: number;       // boost 后综合分
  baseComposite: number;   // boost 前综合分
  changePercent: number;
  sectorBoost: number;     // 板块加持分
}

export interface HotSectorItem {
  industry: string;        // 申万一级行业名
  count: number;           // 候选池中该行业股票数
  upCount: number;         // 上涨家数
  downCount: number;       // 下跌家数
  avgChangePercent: number; // 板块平均涨幅（%）
  avgMoneyFlow: number;    // 板块平均资金流分项（0-1）
  heatScore: number;       // 板块热度 0-100（核心指标）
  // 2026-09-06（方案 A）：情绪周期 / 退潮识别 —— 「热度后回调」内化
  phase?: SectorPhase;     // 生命周期阶段
  overheated?: boolean;    // 是否已过热点（高潮，追高接盘风险）
  retreating?: boolean;    // 是否退潮（回调中，别推荐）
  avgBias20?: number;      // 板块平均 20 日乖离率（%，过热信号）
  avgADX?: number;         // 板块平均 ADX（0-100，趋势确认）
  avgTurnover?: number;    // 板块平均换手率（%）
  avgSustain?: number;     // 板块近5日上涨占比（momentum5>0 比例 0-1，持续性确认，过滤单日脉冲）
  avgMomentum20?: number;  // 板块平均20日动量（%）（B 方案：板块RS主轴，来自候选池成员 momentum20）
  limitUpCount?: number;   // 候选池内该板块涨停家数（changePercent≥9.9）（B 方案：涨停确认）
  // 2026-09-06（预留 B/C）：事件/主题加持分（AI 等国际热点事件 → 行业映射，暂无来源默认 0）
  eventBoost?: number;
  rank: number;            // 热度排名（1 起）
  leaders: HotSectorLeader[]; // 板块内优质股 top（boost 后 composite 最高）
  isLeading: boolean;      // 是否本轮热度榜首
}

export interface HotSectorConfig {
  topN: number;            // 取前几个热点板块（默认 8）
  leaderCount: number;     // 每板块展示 top 股数（默认 3）
  boostWeight: number;     // 板块热度加分权重（默认 0.15 = 15%，克制不追高）
  minCount: number;        // 板块最少成分股数（默认 4，配合扩池 + 贝叶斯平滑，样本不足的热度不可信）
  minHeat: number;         // 板块热度及格线（默认 0，上榜即算）
  // 2026-09-06（B 方案）：全市场板块行情（行业名 → 当日涨幅/上涨占比），有则当日热度用全市场口径（无样本失真）
  market?: Map<string, { pct: number; upCount: number; downCount: number }>;
}

/** 板块生命周期阶段（2026-09-06，方案 A） */
export type SectorPhase = 'early' | 'main' | 'climax' | 'retreat';

export const HOT_SECTOR_CONFIG: HotSectorConfig = {
  topN: 8,
  leaderCount: 3,
  boostWeight: 0.15,
  minCount: 4,
  minHeat: 0,
};

// ── 情绪周期判定（2026-09-06 方案 A）──────────────────────────────
// 目标：把「热度后回调」这个波动内化为板块权重的一部分——\n//   已透支的热点（高潮）降分，退潮中的板块降分，避免在鱼尾接盘。\n// 截面启发式（无历史时序，用当前截面近似生命周期位置）：\n//   - 退潮 retreat：20日乖离转负（高位回落）或板块普跌（上涨占比骤降）\n//   - 高潮 climax：乖离过大（涨幅透支）仍在上涨（强趋势尾段）\n//   - 主升 main：ADX 趋势确认 + 上涨占比不低（该推阶段）\n//   - 启动 early：乖离小/负、上涨占比中、趋势未确认
function classifySectorPhase(o: { avgBias20: number; avgADX: number; upRatio: number }): SectorPhase {
  const { avgBias20, avgADX, upRatio } = o;
  if (avgBias20 <= -5) return 'retreat';
  if (upRatio <= 0.35) return 'retreat';
  if (avgBias20 >= 12) return 'climax';
  if (avgADX >= 25 && upRatio >= 0.5) return 'main';
  return 'early';
}

// 已透支热度的降分（方案 A 核心：回调波动内化，克制不抹杀热点）
function heatCyclePenalty(phase: SectorPhase, avgBias20: number): number {
  // 高潮：乖离越大扣越多（12→6 分，22→16 分封顶）
  if (phase === 'climax') return Math.min(16, 6 + Math.max(0, avgBias20 - 12));
  // 退潮：回调中扣 12~20（别在退潮期推）
  if (phase === 'retreat') return 12 + Math.min(8, Math.max(0, -avgBias20 - 5));
  return 0; // 启动/主升不扣
}

/** 按 industry 聚合候选池,计算每个板块热度 */
export function computeHotSectors(
  results: V2ScoreResult[],
  cfg: Partial<HotSectorConfig> = {}
): HotSectorItem[] {
  const c = { ...HOT_SECTOR_CONFIG, ...cfg };
  const groups = new Map<string, V2ScoreResult[]>();

  for (const r of results) {
    const ind = r.industry || '__no_industry__';
    if (!groups.has(ind)) groups.set(ind, []);
    groups.get(ind)!.push(r);
  }

  // 板块基础统计（过滤成分股过少的板块）
  const sectors: Omit<HotSectorItem, 'rank' | 'leaders' | 'isLeading'>[] = [];
  for (const [industry, list] of groups.entries()) {
    if (list.length < c.minCount) continue;
    const upCount = list.filter(s => s.changePercent > 0).length;
    const downCount = list.filter(s => s.changePercent < 0).length;
    const avgChangePercent = list.reduce((s, x) => s + x.changePercent, 0) / list.length;
    const avgMoneyFlow = list.reduce((s, x) => s + (x.moneyFlow ?? 0.5), 0) / list.length;
    // 2026-09-06（方案 A）：情绪周期统计 —— 板块平均 20日乖离 / ADX / 换手率
    const avgBias20 = list.reduce((s, x) => s + (x.rawFactors?.bias20 ?? 0), 0) / list.length;
    const avgADX = list.reduce((s, x) => s + (x.rawFactors?.adx ?? 0), 0) / list.length;
    const avgTurnover = list.reduce((s, x) => s + (x.rawFactors?.turnoverRate ?? 0), 0) / list.length;
    // 2026-09-06（方案 D）：近5日上涨占比（momentum5>0 比例）—— 确认热点「连续几天在涨」而不仅是单日脉冲
    const avgSustain = list.reduce((s, x) => s + ((x.rawFactors?.momentum5 ?? 0) > 0 ? 1 : 0), 0) / list.length;
    // 2026-09-06（B 方案）：板块 20 日动量 RS（板块趋势主轴）+ 涨停确认（候选池内涨停家数）
    const avgMomentum20 = list.reduce((s, x) => s + (x.rawFactors?.momentum20 ?? 0), 0) / list.length;
    const limitUpCount = list.filter(x => x.changePercent >= 9.9).length;
    sectors.push({
      industry,
      count: list.length,
      upCount,
      downCount,
      limitUpCount,
      avgChangePercent: Math.round(avgChangePercent * 100) / 100,
      avgMoneyFlow,
      avgBias20,
      avgADX,
      avgTurnover,
      avgSustain,
      avgMomentum20,
      // 预留 B/C：事件/主题加持分（暂无外部事件源，默认 0）
      eventBoost: 0,
      heatScore: 0, // 下面统一算百分位
    });
  }
  if (sectors.length === 0) return [];

  // 百分位热度：涨幅 50% + 资金流 30% + 上涨占比 20%
  //（先对 avgChangePercent 做百分位，再对 avgMoneyFlow 做百分位）
  const sortedPct = [...sectors.map(s => s.avgChangePercent)].sort((a, b) => a - b);
  const pctOf = (v: number) => {
    if (sortedPct.length === 0) return 0.5;
    let lo = 0, hi = sortedPct.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedPct[mid] < v) lo = mid + 1; else hi = mid; }
    return lo / sortedPct.length;
  };
  const fpc = sectors.map(s => s.avgChangePercent);
  const sortedFlow = [...sectors.map(s => s.avgMoneyFlow)].sort((a, b) => a - b);
  const flowPctOf = (v: number) => {
    if (sortedFlow.length === 0) return 0.5;
    let lo = 0, hi = sortedFlow.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedFlow[mid] < v) lo = mid + 1; else hi = mid; }
    return lo / sortedFlow.length;
  };
  // 2026-09-06（B 方案）：板块 20 日动量 RS 百分位（动量主轴）
  const sortedMom = [...sectors.map(s => s.avgMomentum20 ?? 0)].sort((a, b) => a - b);
  const momPctOf = (v: number) => {
    if (sortedMom.length === 0) return 0.5;
    let lo = 0, hi = sortedMom.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedMom[mid] < v) lo = mid + 1; else hi = mid; }
    return lo / sortedMom.length;
  };

  sectors.forEach((s) => {
    // 2026-09-06（B 方案）：有全市场板块行情则当日涨幅/上涨占比用全市场口径（无样本失真）
    const market = c.market?.get(s.industry);
    const marketUpRatio = market && market.upCount + market.downCount > 0
      ? Math.max(0, Math.min(1, market.upCount / (market.upCount + market.downCount)))
      : undefined;
    // 当日涨幅分（25）：全市场板块涨幅（-3%~+3% 归一化）或候选池涨幅百分位
    const dayPctPart = market
      ? Math.max(0, Math.min(1, (market.pct + 3) / 6)) * 25
      : pctOf(s.avgChangePercent) * 25;
    // 上涨占比分（12）：全市场（样本足，无平滑）或候选池贝叶斯平滑
    const upRatioPart = (marketUpRatio !== undefined
      ? marketUpRatio
      : (s.upCount + 2) / (s.count + 4)) * 12;
    // 资金流分（15）：候选池 avgMoneyFlow 百分位（自洽）
    const flowPart = flowPctOf(s.avgMoneyFlow) * 15;
    // 板块 20 日 RS 主轴（28）：动量趋势是热点可持续的核心
    const rsPart = momPctOf(s.avgMomentum20 ?? 0) * 28;
    // 涨停确认（10）：候选池内板块涨停家数越多越强（封顶 3 家=满）
    const limitPart = Math.min(1, (s.limitUpCount ?? 0) / 3) * 10;
    // 5日持续（10）：过滤单日脉冲
    const sustainPart = (s.avgSustain ?? 0.5) * 10;
    const heat = dayPctPart + upRatioPart + flowPart + rsPart + limitPart + sustainPart;
    // 2026-09-06（方案 A）：情绪周期判定 + 已透支热度折扣（「热度后回调」内化）
    const phase = classifySectorPhase({ avgBias20: s.avgBias20 ?? 0, avgADX: s.avgADX ?? 0, upRatio: marketUpRatio ?? (s.upCount + 2) / (s.count + 4) });
    const penalty = heatCyclePenalty(phase, s.avgBias20 ?? 0);
    s.phase = phase;
    s.overheated = phase === 'climax';
    s.retreating = phase === 'retreat';
    s.heatScore = Math.max(0, Math.round(heat - penalty));
  });

  // 热度排序,过滤及格线,取 topN
  sectors.sort((a, b) => b.heatScore - a.heatScore);
  const top = sectors.filter(s => s.heatScore >= c.minHeat).slice(0, c.topN);

  return top.map((s, i) => {
    const members = results.filter(r => (r.industry || '__no_industry__') === s.industry);
    // 板块内取 boost 后综合分最高的 leaderCount 只
    const ranked = [...members].sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0));
    const leaders: HotSectorLeader[] = ranked.slice(0, c.leaderCount).map(m => ({
      code: m.code,
      name: m.name,
      composite: m.composite ?? 0,
      baseComposite: (m as any).baseComposite ?? m.composite ?? 0,
      changePercent: m.changePercent,
      sectorBoost: (m as any).sectorBoost ?? 0,
    }));
    return {
      ...s,
      rank: i + 1,
      leaders,
      isLeading: i === 0,
    };
  });
}

/**
 * 给属于热点板块的股票加板块热度分（默认权重 15%，克制不追高）
 * 返回新数组；会写 sectorBoost / baseComposite 字段,并重算 composite。
 */
export function applySectorBoost(
  results: V2ScoreResult[],
  hot: HotSectorItem[],
  cfg: Partial<HotSectorConfig> = {}
): V2ScoreResult[] {
  const boostWeight = cfg.boostWeight ?? HOT_SECTOR_CONFIG.boostWeight;
  const hotByIndustry = new Map(hot.map(h => [h.industry, h]));
  const boostedCount = hot.reduce((s, h) => s + h.count, 0) || 0;

  return results.map(r => {
    const sector = (r.industry && hotByIndustry.get(r.industry)) || null;
    if (!sector) return r;
    const sectorBoost = Math.round(sector.heatScore * boostWeight * 100) / 100;
    const baseComposite = r.composite ?? 0;
    return {
      ...r,
      composite: Math.round((baseComposite + sectorBoost) * 100) / 100,
      sectorBoost,
      baseComposite,
      sectorHeat: sector.heatScore,
      sectorIndustry: sector.industry,
    } as V2ScoreResult;
  });
}

export function countBoostedIndustries(hot: HotSectorItem[]): number {
  return hot.length;
}

// ── 分级配额（方案 A：热度越高 → 推荐数量越多，且最多 N 个板块）──────────────
// 设计（2026-09-06）：
//   今日推荐 = pickN（默认 10）支，横跨最多 maxSectors（默认 4）个热点板块，
//   名额按各板块 heatScore 比例分配（最大余数法，热度越高分的席越多）；
//   板块内取 boost 后综合分最高的（规避"追热垃圾股"）。
//   与 applySectorBoost 的关系：boost 决定"板块内选谁"，配额决定"每板块选几只"——
//   两级配合，让"热度最高的板块推荐最多"从软性加分变成硬性数量保证。

export interface QuotaPick {
  code: string;
  name: string;
  industry: string;
  sectorRank: number;   // 全局热度名次（1 起，越小越热）
  sectorHeat: number;   // 板块热度 0-100
  quotaSlots: number;   // 该板块本次分到的名额
  composite: number;    // boost 后综合分
  changePercent: number;
}

export interface QuotaSectorAlloc {
  industry: string;
  rank: number;
  heat: number;
  slots: number;
}

export interface QuotaSummary {
  pickN: number;        // 目标推荐数量
  maxSectors: number;   // 最多板块数
  sectors: QuotaSectorAlloc[];  // 参与配额的板块及各自名额
  totalSlots: number;   // 计划名额（= pickN，若板块容量不足则小于 pickN）
  filledSlots: number;  // 实际填满名额
}

export function buildHotQuotaPicks(
  boostedResults: V2ScoreResult[],
  hotSectors: HotSectorItem[],
  opts: { pickN?: number; maxSectors?: number; maxSlotsPerSector?: number } = {}
): { picks: QuotaPick[]; summary: QuotaSummary } {
  const pickN = Math.max(1, opts.pickN ?? 10);
  const maxSectors = Math.max(1, opts.maxSectors ?? 4);
  // 方案 C（2026-09-06）：单板块席位上限 —— 热度第一板块也不能一家独大，
  // 保证行业数 ≥ ceil(pickN / maxSlotsPerSector)、单板块占比 ≤ maxSlotsPerSector/pickN，
  // 让\"往热点集中\"与\"集中度风控\"平衡（默认 3 席 → 单板块 ≤ 30%，不触发行业上限告警）
  // 默认 4 席：既让\"热度第一板块能拿最多席位\"（如 4/3/2/1），又不至于一家独大（≤40%），行业数 ≥ 3。
  const maxSlotsPerSector = Math.max(1, opts.maxSlotsPerSector ?? 4);
  // 前 maxSectors 个热点板块（hotSectors 已按热度降序）
  const chosen = hotSectors.slice(0, maxSectors);

  // 按行业归组 + 组内按 boost 后综合分降序（板块内取龙头）
  const membersByIndustry = new Map<string, V2ScoreResult[]>();
  for (const r of boostedResults) {
    const ind = r.industry || '__no_industry__';
    if (!membersByIndustry.has(ind)) membersByIndustry.set(ind, []);
    membersByIndustry.get(ind)!.push(r);
  }
  const avail = chosen.map((h, i) => ({
    h,
    rank: i + 1,
    members: [...(membersByIndustry.get(h.industry) || [])]
      .sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0)),
  }));
  const capacity = avail.map(x => x.members.length);
  // 方案 C：板块可分配上限 = min(实际成员数, 单板块席位上限)
  const allocCap = capacity.map((c, i) => Math.min(c, maxSlotsPerSector));

  // ── 一、按热度比例分配名额（最大余数法），每板块下限 1 席 ──
  const heatTotal = avail.reduce((s, x) => s + Math.max(x.h.heatScore, 1), 0);
  let slots = avail.map(x => Math.max(1, Math.floor(pickN * Math.max(x.h.heatScore, 1) / heatTotal)));

  // 若 floor 总和超 pickN（板块 heat 太接近），从热度最低的板块削到 = pickN
  let sum = slots.reduce((a, b) => a + b, 0);
  if (sum > pickN) {
    const byHeatAsc = avail.map((_, i) => i).sort((a, b) => avail[b].h.heatScore - avail[a].h.heatScore);
    for (const i of byHeatAsc) {
      if (sum <= pickN) break;
      const cut = Math.min(sum - pickN, slots[i] - 1);
      slots[i] -= cut; sum -= cut;
    }
  }
  // 最大余数：剩余名额补给"小数部分最大"的板块
  let rem = pickN - sum;
  if (rem > 0) {
    const frac = avail.map((x, i) => ({
      i,
      fr: (pickN * Math.max(x.h.heatScore, 1) / heatTotal) - slots[i],
    })).sort((a, b) => b.fr - a.fr);
    for (const f of frac) {
      if (rem <= 0) break;
      slots[f.i]++; rem--;
    }
  }

  // ── 二、clip 到板块可分配上限（含单板块席位上限），溢出名额补给仍有容量的板块（按热度从高到低） ──
  let overflowPool = 0;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] > allocCap[i]) { overflowPool += slots[i] - allocCap[i]; slots[i] = allocCap[i]; }
  }
  for (let j = 0; j < avail.length && overflowPool > 0; j++) {
    const add = Math.min(overflowPool, allocCap[j] - slots[j]);
    slots[j] += add; overflowPool -= add;
  }

  // ── 三、按热度名次顺序取各板块龙头，产出 picks ──
  const picks: QuotaPick[] = [];
  const sectors: QuotaSectorAlloc[] = [];
  for (let i = 0; i < avail.length; i++) {
    const { h, rank, members } = avail[i];
    const n = slots[i];
    sectors.push({ industry: h.industry, rank, heat: h.heatScore, slots: n });
    for (let k = 0; k < Math.min(n, members.length); k++) {
      const m = members[k];
      picks.push({
        code: m.code,
        name: m.name,
        industry: h.industry,
        sectorRank: rank,
        sectorHeat: h.heatScore,
        quotaSlots: n,
        composite: m.composite ?? 0,
        changePercent: m.changePercent,
      });
    }
  }
  // 顺序：板块热度名次升序（榜首在前）+ 板块内按综合分降序
  picks.sort((a, b) => a.sectorRank - b.sectorRank || b.composite - a.composite);

  return {
    picks,
    summary: {
      pickN,
      maxSectors,
      sectors,
      totalSlots: picks.length,
      filledSlots: picks.length,
    },
  };
}
