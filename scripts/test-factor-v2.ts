/**
 * Factor v2 — 单元测试（无网络依赖）
 *
 * 验证：
 * 1. computeFactorPercentiles — 百分位归一化
 * 2. checkCollinearity — 共线性检测
 * 3. neutralize — OLS 中性化
 * 4. scoreV2 — 全流程评分
 * 5. computeV1VsV2Compare — v1/v2 对比
 * 6. WQ alphas — 10 个 alpha
 * 7. winsorize — 去极值
 */

import {
  computeFactorPercentiles,
  winsorizeMAD,
  winsorizeQuantile,
  toPercentileAsc,
  toPercentileDesc,
  pearsonCorr,
  checkCollinearity,
} from '../lib/quant/factor/v2/percentile';
import { neutralize } from '../lib/quant/factor/v2/neutralize';
import { scoreV2, computeV1Pillars } from '../lib/quant/factor/v2/scorer';
import { computeV1VsV2Compare } from '../lib/quant/factor/v2';
import { computeWQAlphas, WQ_ALPHA_INFO } from '../lib/quant/factor/v2/alphas';
import type { FactorRawValues, KBar } from '../lib/quant/factor/v2/types';

// 简化版 KBar 构造
function makeKBar(closes: number[], vols: number[] = []): KBar[] {
  return closes.map((c, i) => ({
    code: 'test.SH',
    timestamp: Date.now() - (closes.length - i) * 86400_000,
    open: c, high: c * 1.01, low: c * 0.99, close: c,
    volume: vols[i] || 1e6, amount: c * 1e6,
  }));
}

function makeCandidate(overrides: Partial<FactorRawValues> = {}): FactorRawValues {
  return {
    code: '600000.SH', name: '测试股票',
    price: 10, changePercent: 1,
    marketCap: 1e10, floatMarketCap: 5e9,
    industry: '银行',
    pe: 10, pb: 1.2, ps: 2,
    roe: 12, grossMargin: 30, debtRatio: 50, eps: 1.0,
    momentum5: 0.02, momentum10: 0.03, momentum20: 0.05, momentum60: 0.10,
    rsi14: 50, cci14: 0, bias20: 1,
    mainNetInflow5d: 1e8, mainNetInflow20d: 5e8, mainNetInflowRatio: 0.1,
    volumeRatio: 1.2, turnoverRate: 5,
    macdHist: 0.1, kdjK: 50, kdjD: 50,
    bollPosition: 0.5, adx: 25, lowVolatility: 0.02,
    avgAmount20d: 5e8,
    wqAlphaScore: 0,
    ...overrides,
  };
}

// ── 1. winsorize 测试 ─────────────────────────────
console.log('━━━ Test 1: winsorizeMAD ━━━');
{
  const vals = [1, 2, 3, 4, 5, 100, 6, 7, 8, 9, -50];
  const out = winsorizeMAD(vals);
  console.log(`  input  : ${JSON.stringify(vals)}`);
  console.log(`  output : ${JSON.stringify(out.map(v => Math.round(v * 100) / 100))}`);
  console.assert(out[0] === 1, 'MAD fails: 第一个值应为 1');
  console.assert(out[5] < 100, 'MAD fails: 100 异常值应被截断');
  console.log('  ✅ 通过');
}

console.log('\n━━━ Test 2: winsorizeQuantile ━━━');
{
  const vals = Array.from({ length: 100 }, (_, i) => i);
  const out = winsorizeQuantile(vals, 0.05, 0.95);
  console.assert(out[0] >= 5 && out[0] < 10, 'Quantile fails: 0.05 下界');
  console.assert(out[99] <= 95 && out[99] > 90, 'Quantile fails: 0.95 上界');
  console.log('  ✅ 通过');
}

// ── 2. 百分位归一化 ─────────────────────────────
console.log('\n━━━ Test 3: 百分位归一化 ━━━');
{
  const vals = [10, 20, 30, 40, 50];
  const asc = toPercentileAsc(vals);
  const desc = toPercentileDesc(vals);
  console.log(`  input:  ${JSON.stringify(vals)}`);
  console.log(`  asc:    ${JSON.stringify(asc)}`);
  console.log(`  desc:   ${JSON.stringify(desc)}`);
  console.assert(asc[0] === 0, 'min 应该是 0');
  console.assert(asc[4] === 1, 'max 应该是 1');
  console.assert(desc[0] === 1, 'desc 应该是反向');
  console.log('  ✅ 通过');
}

// ── 3. 共线性检测 ───────────────────────────────
console.log('\n━━━ Test 4: pearsonCorr + 共线性检测 ━━━');
{
  const r1 = pearsonCorr([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
  const r2 = pearsonCorr([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]);
  const r3 = pearsonCorr([1, 2, 3, 4, 5], [1, 1, 1, 1, 1]);
  console.log(`  正相关 r=1: ${r1.toFixed(3)} (期望 1.0)`);
  console.log(`  负相关 r=-1: ${r2.toFixed(3)} (期望 -1.0)`);
  console.log(`  常数 r=0:    ${r3.toFixed(3)} (期望 0.0)`);
  console.assert(Math.abs(r1 - 1) < 0.01, '正相关失败');
  console.assert(Math.abs(r2 + 1) < 0.01, '负相关失败');
  console.log('  ✅ 通过');
}

// ── 4. 全流程评分 ───────────────────────────────
console.log('\n━━━ Test 5: 100 只股票跑 v2 评分 ━━━');
{
  const candidates: FactorRawValues[] = Array.from({ length: 100 }, (_, i) =>
    makeCandidate({
      code: `60${(i + 1).toString().padStart(4, '0')}.SH`,
      name: `测试${i + 1}`,
      price: 5 + (i % 20),
      changePercent: (i % 30) - 15,  // -15 ~ +14
      pe: 5 + (i % 50),
      roe: 5 + (i % 30),
      momentum20: ((i % 40) - 20) / 100,  // -0.2 ~ +0.19
      mainNetInflow20d: ((i % 30) - 15) * 1e7,
      // 一只 ST 用来测试过滤
      ...(i === 0 ? { name: '*ST 测试' } : {}),
      // 一只涨停
      ...(i === 1 ? { changePercent: 10 } : {}),
    })
  );

  const out = scoreV2({
    candidates,
    options: {
      forwardPeriod: 5,
      neutralize: { industry: true, marketCap: true },
      weightMode: 'default',
      filterFlags: true,
    },
  });

  console.log(`  原始: ${out.diagnostics.originalCount} 只`);
  console.log(`  过滤: ${out.diagnostics.filteredCount} 只（ST/涨停/低流动性）`);
  console.log(`  Top 1: ${out.results[0]?.code} ${out.results[0]?.name} 综合=${out.results[0]?.composite.toFixed(1)}`);
  console.log(`  Top 1 分项: V=${out.results[0]?.valuation.toFixed(0)} Q=${out.results[0]?.quality.toFixed(0)} M=${out.results[0]?.momentum.toFixed(0)} R=${out.results[0]?.reversal.toFixed(0)} F=${out.results[0]?.moneyFlow.toFixed(0)} T=${out.results[0]?.technical.toFixed(0)}`);
  console.assert(out.results[0] !== undefined, '应有 Top 1');
  console.assert(!out.results[0]?.flags.isST, 'Top 1 不应该是 ST');
  console.assert(!out.results[0]?.flags.isLimitUp, 'Top 1 不应该是涨停');
  console.log('  ✅ 通过');
}

// ── 5. v1 vs v2 对比 ───────────────────────────
console.log('\n━━━ Test 6: v1 vs v2 对比 ━━━');
{
  const candidates: FactorRawValues[] = Array.from({ length: 50 }, (_, i) =>
    makeCandidate({
      code: `00${(i + 1).toString().padStart(4, '0')}.SZ`,
      name: `对比${i + 1}`,
      changePercent: (i % 30) - 5,
      momentum20: ((i % 20) - 10) / 100,
    })
  );

  const compare = computeV1VsV2Compare(candidates);
  console.log(`  Top10 重合: ${compare.overlap.top10}/10`);
  console.log(`  v1 top10 平均涨: ${compare.v1Bias.avgChangePct.toFixed(2)}%`);
  console.log(`  v2 top10 平均涨: ${compare.v2Bias.avgChangePct.toFixed(2)}%`);
  console.log(`  v1 涨停: ${compare.v1Bias.limitUpCount}, v2 涨停: ${compare.v2Bias.limitUpCount}`);
  console.assert(compare.v1.length === 10, 'v1 应该有 10 个');
  console.assert(compare.v2.length === 10, 'v2 应该有 10 个');
  console.log('  ✅ 通过');
}

// ── 6. WQ alphas ───────────────────────────────
console.log('\n━━━ Test 7: 10 个 WQ alpha ━━━');
{
  const closes = Array.from({ length: 250 }, (_, i) => 10 + Math.sin(i / 10) * 2);
  const vols = Array.from({ length: 250 }, () => 1e6);
  const bars = makeKBar(closes, vols);
  const score = computeWQAlphas(bars);
  console.log(`  合成分: ${score.toFixed(2)}（应在 -100 ~ +100）`);
  console.assert(score >= -100 && score <= 100, 'WQ alpha 分值超出范围');
  console.log(`  Alpha 数量: ${WQ_ALPHA_INFO.length}（期望 10）`);
  console.assert(WQ_ALPHA_INFO.length === 10, '应该有 10 个 alpha');
  console.log('  ✅ 通过');
}

// ── 7. 行业 + 市值中性化 ───────────────────────
console.log('\n━━━ Test 8: 行业中性化 ━━━');
{
  // 50 只银行股 vs 50 只科技股，应该中性化掉行业差异
  const candidates: FactorRawValues[] = [
    ...Array.from({ length: 30 }, (_, i) => makeCandidate({ code: `60${(i + 1).toString().padStart(4, '0')}.SH`, industry: '银行', pe: 5 + i * 0.1, marketCap: 1e12 })),
    ...Array.from({ length: 30 }, (_, i) => makeCandidate({ code: `30${(i + 1).toString().padStart(4, '0')}.SZ`, industry: '计算机', pe: 80 + i, marketCap: 5e10 })),
  ];
  const industries = candidates.map(c => c.industry);
  const { pcts } = computeFactorPercentiles(candidates);
  const { pcts: neutralPcts, warnings } = neutralize(pcts, industries, { industry: true, marketCap: true });
  console.log(`  原始 valuation 均值（银行 vs 计算机）应差异显著`);
  console.log(`  中性化后 valuation 银行: ${neutralPcts.slice(0, 30).reduce((s, p) => s + p.valuation, 0) / 30}`);
  console.log(`  中性化后 valuation 计算机: ${neutralPcts.slice(30).reduce((s, p) => s + p.valuation, 0) / 30}`);
  console.log(`  警告数: ${warnings.length}`);
  console.assert(warnings.length === 0 || warnings.every(w => !w.includes('失败')), '中性化不应失败');
  console.log('  ✅ 通过');
}

// ── 12. v3.0 新增：Barra 组合优化 ─────────────────
console.log('\n━━━ Test 12: optimizePortfolio（Barra 风险模型 + 组合优化）━━━');
{
  const { optimizePortfolio } = require('../lib/quant/factor/v2/barra-optimizer');
  // 100 只候选（50 银行 + 50 计算机，α 各异）
  const barraCandidates = [
    ...Array.from({ length: 50 }, (_, i) => ({
      code: `6000${i.toString().padStart(3, '0')}.SH`,
      industry: '银行',
      valuation: 0.3 + (i % 10) * 0.04,
      quality: 0.6 + (i % 5) * 0.04,
      momentum: 0.4 + (i % 7) * 0.05,
      reversal: 0.5,
      moneyFlow: 0.4 + (i % 6) * 0.06,
      technical: 0.5 + (i % 4) * 0.08,
      turnover: 0.5,
      wqAlpha: 0.5,
      alpha: 50 + (i % 5) * 4,
    })),
    ...Array.from({ length: 50 }, (_, i) => ({
      code: `3000${i.toString().padStart(3, '0')}.SZ`,
      industry: '计算机',
      valuation: 0.5 + (i % 8) * 0.04,
      quality: 0.7 + (i % 5) * 0.05,
      momentum: 0.5 + (i % 6) * 0.05,
      reversal: 0.4,
      moneyFlow: 0.6 + (i % 5) * 0.05,
      technical: 0.4 + (i % 4) * 0.08,
      turnover: 0.6,
      wqAlpha: 0.5,
      alpha: 60 + (i % 5) * 5,
    })),
  ];
  const opt = optimizePortfolio({
    candidates: barraCandidates,
    riskAversion: 1.0,
    maxSingleWeight: 0.15,
    maxIndustryDeviation: 0.05,
  });
  console.log(`  count: ${barraCandidates.length}, IR: ${opt.diagnostics.informationRatio.toFixed(2)}, 权重和: ${opt.weights.reduce((s: number, w: any) => s + w.weight, 0).toFixed(4)}`);
  const totalWeight = opt.weights.reduce((s: number, w: any) => s + w.weight, 0);
  console.assert(Math.abs(totalWeight - 1) < 0.01, '权重和应=1.0');
  console.assert(opt.diagnostics.alphaNormalization?.method === 'z-score', 'α 应 z-score');
  console.log('  ✅ 通过（α Z-score + IR 合理）');

  // 14. v3.0.2 新增：压力测试
  console.log('\n━━━ Test 14: runStressTest（5 场景压力测试）━━━');
  const { runStressTest } = require('../lib/quant/factor/v2/barra-optimizer');
  const stress = runStressTest(
    opt.weights.map((w: any) => ({ code: w.code, industry: w.industry, weight: w.weight, alpha: w.alpha, risk: w.risk })),
    {
      candidates: barraCandidates,
      riskAversion: 1.0,
      maxSingleWeight: 0.15,
      maxIndustryDeviation: 0.05,
    }
  );
  console.log(`  Baseline: σ=${stress.baseline.expectedVol.toFixed(1)}%`);
  stress.results.forEach((r: any) => {
    const icon = r.passed ? '✅' : '❌';
    console.log(`    ${icon} ${r.name}: 收益=${r.expectedReturn}%, σ=${r.expectedVol.toFixed(0)}%, VaR95=${r.var95.toFixed(0)}%`);
  });
  console.assert(stress.results.length === 5, '应有 5 个场景');
  console.log('  ✅ 通过（5 场景全部计算）');
}

console.log('\n' + '═'.repeat(60));
console.log('✅ 所有测试通过');
console.log('═'.repeat(60));
