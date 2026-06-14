/**
 * Factor v2 — v1 vs v2 对比测试脚本
 *
 * 用法（命令行）：
 *   cd /OpenMAIC && npx tsx lib/quant/factor/v2/compare.ts
 *
 * 跑什么：
 * 1. 同一批 100 只股票
 * 2. 跑 v1（旧 3-pillar）和 v2（新 8 大类）
 * 3. 对比 top10 重合度、平均涨幅、涨停数
 * 4. 输出可读报告
 *
 * 注：这个脚本是开发/验证用，不是生产代码
 * 实际生产用 API 端点 /api/stock/factor-analysis-v2?action=compare
 */

// 简单实现：直接用 fetch 调 API（无需起 server）
const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function runCompare(forwardPeriod: 5 | 20 = 5) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Factor v1 vs v2 对比测试 — forwardPeriod=${forwardPeriod}d`);
  console.log(`${'='.repeat(60)}\n`);

  const t0 = Date.now();
  const res = await fetch(
    `${BASE}/api/stock/factor-analysis-v2?action=compare&limit=50&forwardPeriod=${forwardPeriod}&filterFlags=true&weightMode=default`
  );
  if (!res.ok) {
    console.error('❌ API 调用失败:', res.status, res.statusText);
    return;
  }
  const json = await res.json();
  const t1 = Date.now();

  if (!json.success) {
    console.error('❌ API 返回错误:', json.error);
    return;
  }

  const { compare, count, _ms, _cache } = json;

  console.log(`✅ 调用成功（${count} 只票，API 耗时 ${_ms || '?'}ms，总耗时 ${t1 - t0}ms，缓存：${_cache}）\n`);

  console.log('━━━ 重合度 ━━━');
  console.log(`  Top10 重合: ${compare.overlap.top10}/10  (${(compare.overlap.top10Rate * 100).toFixed(0)}%)`);
  console.log(`  Top20 重合: ${compare.overlap.top20}/20  (${(compare.overlap.top20Rate * 100).toFixed(0)}%)`);

  console.log('\n━━━ 偏差统计（top10 平均涨跌幅） ━━━');
  console.log(`  v1: ${compare.v1Bias.avgChangePct >= 0 ? '+' : ''}${compare.v1Bias.avgChangePct.toFixed(2)}%`);
  console.log(`  v2: ${compare.v2Bias.avgChangePct >= 0 ? '+' : ''}${compare.v2Bias.avgChangePct.toFixed(1)}%`);

  console.log('\n━━━ 异常股票过滤 ━━━');
  console.log(`  v1 涨停: ${compare.v1Bias.limitUpCount} 只`);
  console.log(`  v1 ST:   ${compare.v1Bias.stCount} 只`);
  console.log(`  v2 涨停: ${compare.v2Bias.limitUpCount} 只`);
  console.log(`  v2 ST:   ${compare.v2Bias.stCount} 只`);

  console.log('\n━━━ v2 改进点 ━━━');
  if (compare.improvements.length === 0) {
    console.log('  (无显著改进点)');
  } else {
    for (const s of compare.improvements) console.log(`  ${s}`);
  }

  console.log('\n━━━ v1 Top 10 ━━━');
  compare.v1.forEach((r: any) => {
    console.log(`  ${r.rank.toString().padStart(2)}. ${r.code} ${r.name.padEnd(8, ' ')} 综合=${r.compositeScore.toFixed(2)}  ${r.isLimitUp ? '🚫 涨停' : ''}`);
  });

  console.log('\n━━━ v2 Top 10 ━━━');
  compare.v2.forEach((r: any, i: number) => {
    const flags = [
      r.flags.isST ? 'ST' : '',
      r.flags.isLimitUp ? '涨停' : '',
      r.flags.isNewShare ? '次新' : '',
    ].filter(Boolean).join('|') || '—';
    console.log(`  ${(i + 1).toString().padStart(2)}. ${r.code} ${r.name.padEnd(8, ' ')} 综合=${r.composite.toFixed(2)}  [${flags}]`);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ 测试完成');
  console.log(`${'='.repeat(60)}\n`);
}

// ── 多周期对比 ────────────────────────────────────
async function main() {
  console.log('Factor v2 对比测试 — 验证 v1 vs v2 在 5d/20d 调仓周期下的表现');
  await runCompare(5);
  await runCompare(20);
}

if (require.main === module) {
  main().catch(e => {
    console.error('❌ 脚本失败:', e);
    process.exit(1);
  });
}
