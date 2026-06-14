/**
 * v1 vs v2 因子模型对比回测 API
 *
 * GET /api/stock/backtest-v1-vs-v2?lookbackDays=30&topN=10
 *
 * 返回：每日净值曲线 + v1/v2/沪深300 的累计收益/最大回撤/Sharpe/胜率
 */
import { NextRequest, NextResponse } from 'next/server';
import { runV1VsV2Backtest, type BacktestConfig } from '@/lib/quant/factor/v1-vs-v2-backtest';

// 结果缓存（5 分钟）
let resultCache: { data: any; ts: number; key: string } | null = null;
const CACHE_TTL = 5 * 60_000;

export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const { searchParams } = new URL(request.url);
  const lookbackDays = Math.min(Math.max(parseInt(searchParams.get('lookbackDays') || '30'), 5), 120);
  const topN = Math.min(Math.max(parseInt(searchParams.get('topN') || '10'), 3), 30);
  const poolSize = Math.min(Math.max(parseInt(searchParams.get('poolSize') || '200'), 20), 300);
  const v2Short = searchParams.get('v2Short') !== 'false';  // 默认 true

  const config: BacktestConfig = {
    lookbackDays,
    topN,
    rebalanceDays: 1,  // 每天调仓（最细粒度对比）
    benchmark: '000300.SH',  // 沪深 300
    poolSize,
    v2Short,
  };

  // 缓存命中
  const key = JSON.stringify(config);
  if (resultCache && resultCache.key === key && Date.now() - resultCache.ts < CACHE_TTL) {
    return NextResponse.json({ ...resultCache.data, _cache: 'hit', _ms: Date.now() - t0 });
  }

  try {
    const result = await runV1VsV2Backtest(config);
    resultCache = { data: result, ts: Date.now(), key };
    return NextResponse.json({ ...result, _cache: 'miss', _ms: Date.now() - t0 });
  } catch (e: any) {
    console.error('[BacktestV1VsV2] error:', e);
    return NextResponse.json({ success: false, error: e.message || '回测失败' }, { status: 500 });
  }
}
