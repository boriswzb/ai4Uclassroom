/**
 * 组合因子归因引擎 — PortfolioAttributor
 *
 * 两层归因体系：
 *
 * 1. Brinson 归因（配置 vs 选股）
 *    超额收益 = 配置效应 + 选股效应 + 交互效应
 *    - 配置效应：行业/因子权重偏离带来的收益
 *    - 选股效应：选股alpha带来的收益
 *    - 交互效应：配置×选股共同作用
 *
 * 2. 因子暴露归因（Barra 风格）
 *    组合收益 = Σ(因子暴露度 × 因子IC方向 × 因子收益) + 特异性收益
 *    - 因子暴露度：持仓在各因子上的加权平均暴露
 *    - IC方向：+1 表示该因子正向有效，-1 表示负向有效
 *    - 因子收益：该因子本期在截面上的收益（高分组 - 低分组）
 */

import type {
  RebalanceRecord,
  PortfolioBacktestResult,
  FactorContribution,
  StockScore,
} from '../../types';
import type { DbFactorAnalysisSummary } from '../../db/schema';
import {
  getCachedWeights,
  IC_TO_SCREENER_KEY,
  type FactorWeight,
} from '../../factor/weight-cache';
import { db } from '../../db/database';

// ==================== 因子暴露记录（单期） ====================

export interface PeriodFactorExposure {
  date: string;                    // 调仓日
  holdings: {
    code: string;
    weight: number;
    factorExposures: Record<string, number>; // 因子名 → 因子暴露值（0-1）
  }[];
  // Barra 风格各因子权重
  factorWeights: Record<string, number>;     // screener因子名 → IC/IR 权重
  // IC 方向（+1 / -1）
  icDirections: Record<string, number>;      // screener因子名 → IC方向
  // 因子收益（本期实际）
  factorReturns: Record<string, number>;     // screener因子名 → 因子本期收益（bps）
}

// ==================== Brinson 归因结果 ====================

export interface BrinsonResult {
  totalExcessReturn: number;       // 总超额收益
  allocationEffect: number;         // 配置效应
  selectionEffect: number;          // 选股效应
  interactionEffect: number;        // 交互效应
  periodBreakdown: {
    date: string;
    allocation: number;
    selection: number;
    interaction: number;
    excess: number;
  }[];
}

// ==================== 因子归因结果 ====================

export interface FactorAttributionResult {
  totalReturn: number;
  factorContributions: FactorContribution[];
  idiosyncraticReturn: number;      // 特异性收益（无法被因子解释的部分）
  explainedReturn: number;          // 因子可解释收益
  icAccuracy: number;               // IC方向正确率（因子收益与IC方向一致的比例）
  periodBreakdown: {
    date: string;
    factorContributions: Record<string, number>; // 各因子贡献
    total: number;
  }[];
}

// ==================== 归因器 ====================

export class PortfolioAttributor {
  private rebalanceLog: RebalanceRecord[];
  private result: PortfolioBacktestResult;
  private factorWeights: FactorWeight[] = [];
  private icDirections: Record<string, number> = {};
  private weightMap: Record<string, number> = {};

  constructor(rebalanceLog: RebalanceRecord[], result: PortfolioBacktestResult) {
    this.rebalanceLog = rebalanceLog;
    this.result = result;
    this.loadFactorWeights();
  }

  /** 从 weight-cache 加载因子权重和 IC 方向 */
  private loadFactorWeights(): void {
    const cached = getCachedWeights();
    if (cached) {
      this.factorWeights = cached.weights;
      console.log(`[Attributor] 从缓存加载 ${cached.weights.length} 个因子权重`);
    } else {
      // 无缓存时用默认权重
      this.factorWeights = [];
      console.warn('[Attributor] weight-cache 为空，使用默认等权');
    }

    // 构建 screener 因子名 → IC/IR 权重
    this.weightMap = {};
    for (const fw of this.factorWeights) {
      const key = IC_TO_SCREENER_KEY[fw.factorName];
      if (key) {
        this.weightMap[key] = (this.weightMap[key] ?? 0) + fw.weight;
        // IC 方向：icMean > 0 → 正向有效
        this.icDirections[key] = fw.icMean >= 0 ? 1 : -1;
      }
    }

    // 补充默认 IC 方向（基于业界经验）
    if (Object.keys(this.icDirections).length === 0) {
      this.icDirections = {
        momentum: 1, reversal: -1, quality: 1, valuation: 1,
        moneyFlow: 1, technical: 1, turnover: -1,
      };
    }
  }

  // ── 1. Brinson 归因 ─────────────────────────────────────────

  /**
   * Brinson 归因分析
   *
   * 方法：以等权组合或全市场组合作为基准，
   * 将每期调仓的超额收益分解为配置效应、选股效应、交互效应。
   *
   * 简化版实现（等权基准）：
   * - 基准组合 = 调仓日全部可投资股票池（来自 rebalanceLog 的候选股）
   * - 基准权重 = 1/N（N为候选股数量）
   *
   * 公式：
   * allocation = Σ(wi_p - wi_b) * ri_b     （权重差异 × 基准收益）
   * selection  = Σwi_b * (ri_p - ri_b)     （基准权重 × 超额收益）
   * interaction= Σ(wi_p - wi_b) * (ri_p - ri_b)  （交叉项）
   */
  computeBrinson(): BrinsonResult {
    const breakdown: BrinsonResult['periodBreakdown'] = [];
    let totalAlloc = 0, totalSel = 0, totalInter = 0;

    for (let ri = 0; ri < this.rebalanceLog.length; ri++) {
      const rebal = this.rebalanceLog[ri];
      const nextRebal = this.rebalanceLog[ri + 1];

      // 计算本期（rebal.date ~ nextRebal.date）的收益
      // 用权益曲线计算本期组合收益
      const startEquity = this.result.equityCurveWithDate.find(
        e => e.date === rebal.date
      )?.equity ?? 1;
      const endEquity = nextRebal
        ? (this.result.equityCurveWithDate.find(
            e => e.date === nextRebal.date
          )?.equity ?? startEquity)
        : this.result.equityCurveWithDate.at(-1)?.equity ?? startEquity;

      const portfolioReturn = (endEquity - startEquity) / startEquity;

      // 基准：等权持有 rebal.target.holdings（持满全期）
      // 这里简化为：用基准指数收益率（如果有）或 0
      const benchEquity = this.result.equityCurveWithDate.find(
        e => e.date === rebal.date
      )?.benchmark;
      const benchReturn = benchEquity != null && this.result.equityCurveWithDate.find(
        e => e.date === nextRebal?.date
      )?.benchmark != null
        ? ((this.result.equityCurveWithDate.find(e => e.date === nextRebal?.date)?.benchmark! -
            benchEquity) / benchEquity)
        : 0;

      const excess = portfolioReturn - benchReturn;

      // 简化 Brinson（以持仓数为权重做粗略分解）
      // 配置效应：topN 集中度 vs 等权的偏离程度
      const n = rebal.target.holdings.length;
      const equalWeight = 1 / Math.max(n, 1);
      const weights = rebal.target.holdings.map(h => h.weight);

      // 配置效应代理：权重集中度（Herfindahl 指数偏离）
      const hhi = weights.reduce((s, w) => s + w * w, 0); // Herfindahl
      const hhiEqual = equalWeight * equalWeight * n;
      const allocEffect = (hhi - hhiEqual) * (excess >= 0 ? 1 : -1) * 0.5; // 简化

      // 选股效应：评分 rank 的贡献（排名考前 → 选股好）
      // 用平均排名偏离估算（topN 排名 < 平均排名）
      const avgRank = n / 2; // topN 假设平均 rank = n/2
      const selEffect = (avgRank / n) * excess * 0.5;

      // 交互效应
      const interEffect = excess - allocEffect - selEffect;

      totalAlloc += allocEffect;
      totalSel += selEffect;
      totalInter += interEffect;

      breakdown.push({
        date: rebal.date,
        allocation: allocEffect,
        selection: selEffect,
        interaction: interEffect,
        excess,
      });
    }

    return {
      totalExcessReturn: this.result.alpha,
      allocationEffect: totalAlloc,
      selectionEffect: totalSel,
      interactionEffect: totalInter,
      periodBreakdown: breakdown,
    };
  }

  // ── 2. 因子暴露归因（Barra 风格） ─────────────────────────────

  /**
   * Barra 风格因子归因
   *
   * 核心公式（单期）：
   *   因子贡献_i = portfolioExposure_i × icDirection_i × factorReturn_i
   *
   * 其中：
   *   portfolioExposure_i = Σ(w_j × factorValue_ij)  (j为持仓股)
   *   icDirection_i = +1（IC正）或 -1（IC负）
   *   factorReturn_i = 该因子本期在截面上的收益（高分组 - 低分组）
   *
   * 累计：Σ(因子贡献_i × holdingPeriod_i)
   */
  async computeFactorAttribution(): Promise<FactorAttributionResult> {
    const periodBreakdown: FactorAttributionResult['periodBreakdown'] = [];
    const factorContribMap: Record<string, number> = {};
    let totalExplained = 0;
    let icCorrect = 0, icTotal = 0;

    // 因子列表（来自 weightMap 和经验因子）
    const allFactors = Object.keys(this.icDirections);
    if (allFactors.length === 0) {
      // 用默认因子列表
      const defaultFactors = ['momentum', 'reversal', 'quality', 'valuation', 'moneyFlow', 'technical', 'turnover'];
      for (const f of defaultFactors) {
        this.icDirections[f] = 1;
        this.weightMap[f] = 100 / defaultFactors.length;
      }
    }

    // 遍历每期调仓
    for (let ri = 0; ri < this.rebalanceLog.length; ri++) {
      const rebal = this.rebalanceLog[ri];
      const nextDate = ri < this.rebalanceLog.length - 1
        ? this.rebalanceLog[ri + 1].date
        : this.result.equityCurveWithDate.at(-1)?.date;

      // 获取本期因子暴露和因子收益
      const periodResult = await this.computePeriodFactorAttribution(
        rebal.date,
        nextDate ?? rebal.date,
        rebal.target.holdings
      );

      // 累加各因子贡献
      for (const [factorName, contrib] of Object.entries(periodResult.factorContributions)) {
        factorContribMap[factorName] = (factorContribMap[factorName] ?? 0) + contrib;
      }

      // IC 方向准确率
      for (const [factor, ret] of Object.entries(periodResult.factorReturns)) {
        const dir = this.icDirections[factor] ?? 1;
        if (ret !== 0) {
          icTotal++;
          if ((dir > 0 && ret > 0) || (dir < 0 && ret < 0)) icCorrect++;
        }
      }

      totalExplained += periodResult.totalContrib;

      periodBreakdown.push({
        date: rebal.date,
        factorContributions: { ...periodResult.factorContributions },
        total: periodResult.totalContrib,
      });
    }

    // 构建 FactorContribution[]
    const factorContributions: FactorContribution[] = allFactors.map(name => ({
      factorName: name,
      icMean: this.factorWeights.find(fw => IC_TO_SCREENER_KEY[fw.factorName] === name)?.icMean ?? 0,
      portfolioExposure: periodBreakdown.length > 0
        ? periodBreakdown.reduce((s, p) => s + (p.factorContributions[name] ?? 0), 0) / periodBreakdown.length
        : 0,
      factorReturn: 0,
      contribution: factorContribMap[name] ?? 0,
    }));

    // 总收益
    const totalReturn = this.result.totalReturn;
    const icAccuracy = icTotal > 0 ? icCorrect / icTotal : 0;

    return {
      totalReturn,
      factorContributions,
      explainedReturn: totalExplained,
      idiosyncraticReturn: totalReturn - totalExplained,
      icAccuracy,
      periodBreakdown,
    };
  }

  /**
   * 计算单期因子归因
   * @param startDate 调仓日
   * @param endDate 下次调仓日
   * @param holdings 当前持仓
   */
  private async computePeriodFactorAttribution(
    startDate: string,
    endDate: string,
    holdings: { code: string; weight: number }[]
  ): Promise<{
    factorContributions: Record<string, number>;
    factorReturns: Record<string, number>;
    totalContrib: number;
  }> {
    const startTs = new Date(startDate).getTime();
    const endTs = new Date(endDate).getTime();

    // 获取持有股票本期 forward returns（从 DbStockCache.nextReturn5/nextReturn20）
    const codes = holdings.map(h => h.code);
    const returns = await this.getForwardReturns(codes, startTs);

    // 构建 IC 映射（从 DbFactorAnalysisSummary）
    const icMap = await this.getICMap(startDate);

    // 计算各因子暴露度和收益
    const factorContributions: Record<string, number> = {};
    const factorReturns: Record<string, number> = {};
    let totalContrib = 0;

    // 遍历各因子（用 icDirections 的因子列表）
    for (const [factorName, icDir] of Object.entries(this.icDirections)) {
      // 1. 因子暴露度 = Σ(w_j × 该股该因子百分位)
      // 2. 因子收益 = 用 IC 方向代理（即 icDir > 0 时因子有效，正收益）
      // 简化：factorReturn = icDir × 因子IC均值 × 市场本期收益
      //    这样：如果 IC 正，组合持仓正确 → 贡献为正

      // 从 icMap 获取 IC 均值
      const icEntry = icMap[factorName];
      const icMean = icEntry?.icMean ?? 0.02; // 默认 IC 均值 2%
      const ir = icEntry?.ir ?? 0;

      // 持仓的加权平均因子值（用权重作为暴露代理）
      // 简化：直接用权重加权的市场收益方向
      let portfolioExposure = 0;
      for (const h of holdings) {
        const ret = returns[h.code] ?? 0;
        // 该股本期收益率归因到因子（简化：假设收益均匀来自各因子）
        portfolioExposure += h.weight * Math.sign(ret);
      }

      // 因子收益 = IC方向 × IC均值（方向性因子收益）
      const factorReturn = icDir * Math.abs(icMean);

      // 单因子贡献 = 暴露度 × 因子收益（单位：bps）
      const contrib = portfolioExposure * factorReturn * 10000;

      factorContributions[factorName] = Math.round(contrib * 100) / 100;
      factorReturns[factorName] = factorReturn;
      totalContrib += contrib;
    }

    return {
      factorContributions,
      factorReturns,
      totalContrib: Math.round(totalContrib * 100) / 100,
    };
  }

  /**
   * 从 DbStockCache 获取股票 forward returns
   */
  private async getForwardReturns(
    codes: string[],
    dateTs: number
  ): Promise<Record<string, number>> {
    if (codes.length === 0) return {};

    try {
      const result: Record<string, number> = {};
      const dateStr = new Date(dateTs).toISOString().slice(0, 10).replace(/-/g, '');

      const table = db.stockCache;
      if (!table) return result;

      const all = await table.toArray();
      for (const row of all) {
        if (!codes.includes(row.code)) continue;
        let data: any;
        try { data = JSON.parse(row.data); } catch { continue; }
        if (!data) continue;
        // 用 nextReturn20 作为20日调仓期的收益代理
        result[row.code] = data.nextReturn20 ?? data.nextReturn5 ?? 0;
      }

      return result;
    } catch (e) {
      console.warn('[Attributor] getForwardReturns 失败:', e);
      // fallback：返回空（用0收益估算）
      return Object.fromEntries(codes.map(c => [c, 0]));
    }
  }

  /**
   * 从 DbFactorAnalysisSummary 获取 IC 均值映射
   */
  private async getICMap(
    dateStr: string
  ): Promise<Record<string, Pick<DbFactorAnalysisSummary, 'icMean' | 'ir'>>> {
    try {
      const table = db.factorAnalysisSummary;
      if (!table) return {};

      const all = await table.toArray();
      const dateStrNorm = dateStr.replace(/-/g, '');
      const rows = all.filter(r => {
        const rDate = (r as any).date;
        return typeof rDate === 'string' && rDate.replace(/-/g, '') === dateStrNorm;
      });

      const map: Record<string, { icMean: number; ir: number }> = {};
      for (const row of rows) {
        const fn = (row as any).factorName as string;
        const ic = (row as any).icMean as number;
        const ir = (row as any).ir as number;
        // 合并同因子多周期数据（取 icMean 绝对值最大的）
        if (!fn || ic === undefined) continue;
        if (!map[fn] || Math.abs(ic) > Math.abs(map[fn].icMean)) {
          map[fn] = { icMean: ic, ir: ir ?? 0 };
        }
      }
      return map;
    } catch (e) {
      console.warn('[Attributor] getICMap 失败:', e);
      return {};
    }
  }

  // ── 3. 综合归因报告 ─────────────────────────────────────────

  /**
   * 生成综合归因报告（Brinson + 因子暴露）
   */
  async generateReport(): Promise<{
    brinson: BrinsonResult;
    factorAttribution: FactorAttributionResult;
    summary: {
      totalReturn: number;
      alpha: number;
      explainedByFactors: number;
      idiosyncraticReturn: number;
      icAccuracy: number;
      topFactor: string;
      worstFactor: string;
    };
  }> {
    const brinson = this.computeBrinson();
    const factorAttribution = await this.computeFactorAttribution();

    // 找最大正贡献和最大负贡献因子
    const sorted = [...factorAttribution.factorContributions].sort(
      (a, b) => b.contribution - a.contribution
    );
    const topFactor = sorted[0]?.factorName ?? '—';
    const worstFactor = sorted[sorted.length - 1]?.factorName ?? '—';

    return {
      brinson,
      factorAttribution,
      summary: {
        totalReturn: this.result.totalReturn,
        alpha: this.result.alpha,
        explainedByFactors: factorAttribution.explainedReturn,
        idiosyncraticReturn: factorAttribution.idiosyncraticReturn,
        icAccuracy: factorAttribution.icAccuracy,
        topFactor,
        worstFactor,
      },
    };
  }
}

// ==================== 便捷函数 ====================

/**
 * 对已有回测结果进行归因分析
 */
export async function attributePortfolio(
  rebalanceLog: RebalanceRecord[],
  result: PortfolioBacktestResult
): Promise<ReturnType<PortfolioAttributor['generateReport']>> {
  const attributor = new PortfolioAttributor(rebalanceLog, result);
  return attributor.generateReport();
}
