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
  rank: number;            // 热度排名（1 起）
  leaders: HotSectorLeader[]; // 板块内优质股 top（boost 后 composite 最高）
  isLeading: boolean;      // 是否本轮热度榜首
}

export interface HotSectorConfig {
  topN: number;            // 取前几个热点板块（默认 8）
  leaderCount: number;     // 每板块展示 top 股数（默认 3）
  boostWeight: number;     // 板块热度加分权重（默认 0.15 = 15%，克制不追高）
  minCount: number;        // 板块最少成分股数（默认 3）
  minHeat: number;         // 板块热度及格线（默认 0，上榜即算）
}

export const HOT_SECTOR_CONFIG: HotSectorConfig = {
  topN: 8,
  leaderCount: 3,
  boostWeight: 0.15,
  minCount: 3,
  minHeat: 0,
};

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
    sectors.push({
      industry,
      count: list.length,
      upCount,
      downCount,
      avgChangePercent: Math.round(avgChangePercent * 100) / 100,
      avgMoneyFlow,
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

  sectors.forEach((s, i) => {
    const upRatio = s.upCount / s.count;
    const heat = 50 * pctOf(s.avgChangePercent)
              + 30 * flowPctOf(s.avgMoneyFlow)
              + 20 * upRatio;
    s.heatScore = Math.round(heat);
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
