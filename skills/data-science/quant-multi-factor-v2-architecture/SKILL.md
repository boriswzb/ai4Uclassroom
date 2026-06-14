---
name: quant-multi-factor-v2-architecture
description: OpenMAIC/quant 多因子评分 v2 模块架构 — 8 大类因子 + 截面百分位 + 行业/市值中性化 + 共线性 + IC 动态定权 + 真实资金流 + 10 个 WQ alpha。完整替代旧 3-pillar 评分（v1 保留做对比）。
category: data-science
tags: quant, stocks, multi-factor, barra, worldquant, neutralization, ic-weighting
created: 2026-06-04
related_skills: quant-multi-factor-scoring
---

# Quant Multi-Factor v2 — 完整架构

## 背景与问题

OpenMAIC/quant 旧版因子分析（`/api/stock/factor-analysis`）使用 3-pillar 评分（动量 40% + 资金流 30% + 技术 30%），存在以下系统性问题：

1. **动量偏置**：动量子项重复计入，真实动量权重 ~50-60%，推荐股票"都是涨得好的"
2. **估值/质量缺失**：没有 PE/PB/ROE 等压舱石因子
3. **反转缺失**：没有 RSI 反转对冲追涨
4. **资金流是"价推量"伪逻辑**：`factor-analysis/route.ts:1068-1078` 用"涨就当资金流入"模拟，与动量共线 ~0.9
5. **无 ST/涨跌停/停牌过滤**：涨停股直接排第一
6. **无行业/市值中性化**：银行/白酒/技术股天然估值差被 PE 因子绑架
7. **写死权重**：不随市场风格演化
8. **无共线性检测**

业界标准对比（Barra CNE5 / 主流私募 / GitHub AnQreiShikov/Multi-Factor-Strategy-Development-Framework）：

| 因子 | 业界 | v1 旧 | v2 新 |
|------|-----|-------|-------|
| 估值 pe/pb/ps | 20-30% | 0% | 18% |
| 质量 roe/margin | 15-20% | 0% | 14% |
| 动量 | 15-20% | ~50% | 12% |
| 反转 | 10-15% | 0% | 10% |
| 资金流 | 10-15% | 30%（伪）| 12%（真实）|
| 技术 | 10-15% | 30% | 12% |
| 换手 | 5-10% | 0% | 7% |
| WorldQuant Alpha | 0-20% | 0% | 15% |

## v2 架构（11 项优化全部实现）

### 文件结构
```
lib/quant/factor/v2/
├── types.ts                # 11 类因子类型 + 评分结果类型
├── percentile.ts           # 截面百分位归一化 + 去极值 (MAD) + 共线性检测
├── neutralize.ts           # 行业 + 市值 OLS 中性化 (Gauss-Jordan 矩阵求逆)
├── factors.ts              # 单只股票 11 类因子计算（含 WQ 10 alpha + 真实资金流）
├── alphas.ts               # 10 个 A 股 WorldQuant 101 alpha 改编
├── real-moneyflow.ts       # 东财真实主力净流入（替换价推量伪资金流）
├── weights.ts              # IC 动态定权 + 因子失效检测（连续 3 次 IC<0 降权 30%）
├── scorer.ts               # 8 大类加权合成 + v1 复刻（用于对比）
├── index.ts                # 主入口 + v1/v2 对比工具
└── compare.ts              # CLI 对比脚本（生产用 API 端点 /action=compare）

app/api/stock/factor-analysis-v2/
└── route.ts                # 独立 API 端点（与 v1 并存）

app/quant/factor-analysis-v2/
└── page.tsx                # 独立 UI 页面（含 v1 vs v2 对比视图）

scripts/
└── test-factor-v2.ts       # 8 个单元测试（无网络依赖）
```

### 调用链

```
GET /api/stock/factor-analysis-v2?action=scores&forwardPeriod=5
  1. getAllStocks() — 拉全市场列表（东财 vip.stock.finance.sina.com.cn）
  2. getKlinesBatch() — 批量拉 K 线（腾讯 web.ifzq.gtimg.cn）
  3. fetchMainNetInflowBatch() — 拉真实主力净流入（东财 push2his.eastmoney.com）
  4. computeFactors() × N — 并发 8 跑每只股票的 11 类因子
  5. computeFactorPercentiles() — 截面百分位归一化（MAD 去极值）
  6. neutralize() — 行业 + 市值 OLS 取残差
  7. checkCollinearity() — pairwise Pearson |r|>0.7 报警
  8. computeAndCacheV2Weights() — IC 动态定权 + 失效检测
  9. scoreFromPercentiles() — 8 大类加权合成
  10. detectFlags() — ST/涨跌停/停牌/低流动性过滤
  11. 排序输出
```

### 8 大类因子

| 因子 | 权重 | 构成 | 方向 |
|------|------|------|------|
| 估值 | 18% | pe+pb+ps 反向百分位 | 低估值高分 |
| 质量 | 14% | roe+grossMargin 正向 + debtRatio 反向 | 高质量高分 |
| 动量 | 12% | 20日收益百分位 | 高动量高分 |
| 反转 | 10% | rsi 反向 + bias 反向 | 超卖高分 |
| 资金流 | 12% | 真实主力净流入百分位 | 主力流入高分 |
| 技术 | 12% | macd+kdj+boll+adx 综合 | 多头排列高分 |
| 换手 | 7% | 适度区间（3-15% 最优） | 活跃适中高分 |
| WQ Alpha | 15% | 10 个 WorldQuant 101 alpha 复合 | 公式综合 |

### 10 个 WorldQuant 101 alpha（A 股改编版）

| # | 名称 | 原始公式 | A 股权重 | IC 预期 |
|---|------|----------|----------|---------|
| 1 | 量价同向 | sign(Δvol) × sign(Δclose) × sign(Δclose-sma) | 10% | ~0.04 |
| 2 | 3日反转 | -rank(Δret_3) × corr(open, vol, 10) | 15% | ~0.05 |
| 3 | 高点/收盘 | sma(high,20)/close | 10% | ~0.03 |
| 4 | 量-低相关 | corr(sma(vol,20), low, 5) | 8% | ~0.03 |
| 5 | 开/量排名 | rank(open) - rank(vol) | 8% | ~0.02 |
| 6 | 价 vs VWAP | √(high×low) - vwap | 10% | ~0.04 |
| 7 | 双均线偏离 | -(close - sma(sma(close,10),21)) | 12% | ~0.05 |
| 8 | 高低位置 | (low - close) / (high - low) | 10% | ~0.04 |
| 9 | 中长均线差 | (sma(50) - sma(200)) / close | 10% | ~0.04 |
| 10 | 开-量负相关 | -corr(open, vol, 10) | 7% | ~0.03 |

### 关键实现细节

#### 1. MAD 去极值（更稳健）
```typescript
export function winsorizeMAD(values: number[]): number[] {
  const median = ...; // 中位数
  const mad = ...; // 中位数绝对偏差
  if (mad === 0) return values;
  const lower = median - 3 * 1.4826 * mad;  // 1.4826 是高斯常数
  const upper = median + 3 * 1.4826 * mad;
  return values.map(v => Math.max(lower, Math.min(upper, v)));
}
```
- 比 3σ 更稳健（受极值影响小）
- 1.4826 = 1/(Φ^-1(0.75)) 经验常数
- 默认 3 × MAD 截断

#### 2. 行业 + 市值中性化（OLS 取残差）
```typescript
function ols(X: number[][], y: number[]): { beta, residuals } {
  // X: n×p 设计矩阵 [截距, 行业 dummy × 31, log(市值)]
  // 用 Gauss-Jordan 消元法求 (X'X)^-1
  // residuals = y - X * beta
}
```
- 行业 dummy：31 列（申万一级）
- 市值：log(总市值) 1 列
- 截距：1 列
- 总设计矩阵：n × 33 列
- 取残差后重新归一化到 0-1

#### 3. 共线性检测
```typescript
const pairs: { a, b, corr }[] = [];
for (let i = 0; i < factors.length; i++) {
  for (let j = i+1; j < factors.length; j++) {
    const r = pearsonCorr(...);
    if (Math.abs(r) >= 0.7) pairs.push({a, b, corr: r});
  }
}
```
- 阈值 |r| ≥ 0.7
- 仅报警，不自动剔除（保留给用户决定）

#### 4. IC 动态定权 + 失效检测
```typescript
function deriveWeightsFromIC(factorICs): Record<string, number> {
  // weight_i = max(IC_i, 0) × IR_i
  // 归一化到 100
  // IC<0 不给权重（让反向因子归零，让正向因子占满）
}

function checkDegradation(factorName, icHistory): {
  // 从末尾数连续负 IC 次数
  // ≥3 → 降权 30%
}
```
- 复用 `weight-cache.ts` 的 `recordFactorIC()` 保持 IC 历史
- 失败/降权信息写进 `degradationReport`，前端可高亮 ⚠️

#### 5. 真实主力净流入（接东财）
```
https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get
  ?lmt=60&klt=1
  &fields1=f1,f2,f3,f4
  &fields2=f51,f52,f53,f54,f55,f56,f57,f58
  &secid=1.600519
```
- 返回 60 个交易日的主力/超大/大/中/小单净流入
- 并发 5，5s 超时
- fallback：KBar OBV 估算（仅在拉不到时使用）

#### 6. 11 项优化全部实现清单

| # | 优化项 | 实现位置 |
|---|--------|----------|
| 1 | ST/涨跌停/停牌过滤 | `factors.ts:detectFlags()` |
| 2 | momentum 子项去重 | v2 8-pillar 自动去重 |
| 3 | 反转对冲（RSI<30） | `scorer.ts` reversal pillar |
| 4 | 估值锚（PE/PB/PS） | `scorer.ts` valuation pillar |
| 5 | 1%-99% 去极值 | `percentile.ts:winsorizeQuantile` |
| 6 | screener 7 因子体系 | 直接复用，扩展为 8 类 |
| 7 | 接东财真实资金流 | `real-moneyflow.ts` |
| 8 | 行业/市值中性化 | `neutralize.ts` |
| 9 | IC 动态定权 | `weights.ts:deriveWeightsFromIC` |
| 10 | 10 个 WorldQuant alpha | `alphas.ts` |
| 11 | 因子失效检测 | `weights.ts:checkDegradation` |

### 集成到 lite 模式

`app/quant/page.tsx` 加了 v1/v2 toggle：

```typescript
const [scoreVersion, setScoreVersion] = useState<'v1' | 'v2'>('v2');

const handleRunAnalysis = async () => {
  const apiUrl = scoreVersion === 'v2'
    ? `/api/stock/factor-analysis-v2?action=scores&limit=80&...`
    : `/api/stock/factor-analysis?action=full&...`;
  // ...
};
```

UI 在 5d/20d toggle 旁边加 v1/v2 切换：
- v2: 8 大类（绿）— 默认
- v1: 3-pillar（黄）— 保留用于对比

IDB 写入的 `technicalScore` 字段也已经从 v2 API 正确填入（修复了此前的字段缺失 bug）。

## 测试与验证

### 8 个单元测试（无网络依赖）

```bash
cd /OpenMAIC && npx tsx scripts/test-factor-v2.ts
```

输出：
```
✅ Test 1: winsorizeMAD
✅ Test 2: winsorizeQuantile
✅ Test 3: 百分位归一化
✅ Test 4: pearsonCorr + 共线性
✅ Test 5: 100 只股票跑 v2 评分
✅ Test 6: v1 vs v2 对比（v1 平均涨 7.00% → v2 平均涨 3.10%，v1 涨停 5 只 → v2 涨停 0 只）
✅ Test 7: 10 个 WQ alpha
✅ Test 8: 行业中性化（银行 vs 计算机）
```

### CLI 对比脚本（需要 dev server）

```bash
npm run dev  # 起 dev server
npx tsx lib/quant/factor/v2/compare.ts
```

输出 v1 vs v2 top10 对比 + 偏差统计 + 改进点。

### API 端点对比模式

```
GET /api/stock/factor-analysis-v2?action=compare
  &limit=50
  &forwardPeriod=5
  &filterFlags=true
  &weightMode=default  # default | ic
```

返回：
```json
{
  "success": true,
  "version": "v2",
  "count": 3500,
  "compare": {
    "v1": [{...top10...}],
    "v2": [{...top10...}],
    "overlap": { "top10": 5, "top10Rate": 0.5, "top20": 12, "top20Rate": 0.6 },
    "v1Bias": { "avgChangePct": 7.0, "limitUpCount": 5, "stCount": 0 },
    "v2Bias": { "avgChangePct": 3.1, "limitUpCount": 0, "stCount": 0 },
    "improvements": [
      "✅ 涨停过滤：v1 top10 有 5 只涨停，v2 已过滤为 0",
      "✅ 动量偏置降低：v1 平均涨 7.0% → v2 3.1%"
    ]
  },
  "diagnostics": {
    "percentileWarnings": [...],
    "collinearityPairs": [...],
    "filteredCount": 245,
    "originalCount": 3500,
    "weightSource": "default"
  }
}
```

## 已知限制与未来工作

### 当前 v2 局限
1. **行业分类**：用代码前缀推断（不精确）。生产应接东财/同花顺行业接口
2. **IC 动态定权**：UI 还没暴露 IC 历史图表（只在 diagnostics 里）
3. **回测验证**：v2 的实际收益还没做完整回测对比（需要更多时间）
4. **缓存策略**：结果级 5min 缓存，太短 — 实际 IC 数据日频变化，5min 是合理的
5. **真实资金流**：依赖东财公开接口，限频（5s 超时），fallback 概率 ~30%

### 推荐下一步
1. 接雪球/同花顺行业分类接口（替换代码前缀推断）
2. 跑完整回测对比 v1 vs v2 在 2018-2026 的 IC/IR/Rank IC
3. UI 暴露 IC 动态定权图（按因子 × 周期展示 IC 序列）
4. 加"自定义权重"UI：让用户手动调 8 大类权重
5. 接入宏观因子（PMI/CPI/利率）做 regime 自适应

## 关键决策记录

| 决策 | 原因 |
|------|------|
| 保留 v1 API 路径 | 用户要对比 v1/v2 |
| v2 默认开启 | 更客观 |
| 8 大类权重总和 100 | 行业标准（Barra）|
| 复用 weight-cache 的 recordFactorIC | 避免重写失效检测 |
| 不剔除共线性对，只报警 | 让用户决定 |
| MAD 去极值（不是 3σ） | 更稳健，对小样本友好 |
| 反向因子：pe/pb/ps/bias/volatility/debtRatio | 业界标准 |
| 真实资金流优先 + KBar 估算 fallback | 网络不稳定时仍可用 |
| 共线性阈值 0.7 | 业界默认（>0.8 太严，<0.5 太松）|
| 失效阈值 3 次连续负 IC | 复用现有 weight-cache 配置 |

## 关联资源

- 旧模块：`/OpenMAIC/app/api/stock/factor-analysis/route.ts`（保留）
- 旧页面：`/OpenMAIC/app/quant/factor-analysis/page.tsx`（保留）
- screener 7 因子：`/OpenMAIC/app/api/stock/screener/route.ts:467-548`（v2 借鉴）
- FactorPortfolioEngine：`/OpenMAIC/lib/quant/backtest/factor-portfolio/`（v2 可对接）
- weight-cache：`/OpenMAIC/lib/quant/factor/weight-cache.ts`（IC 历史 + 失效检测复用）
- 行业 skill：`/OpenMAIC/skills/data-science/quant-multi-factor-scoring/SKILL.md`（v1 旧文档）

## 通用的「并行 v2 + 对比」工作流（可推广到非量化场景）

这个工作流不仅适用于因子评分，用户原始需求「原模块可以保留」暗示了一种可推广的工程模式：

### 适用场景
- 发现生产系统存在结构性问题（偏置/漏洞/性能）
- 但线上用户已经依赖旧系统，不能直接替换
- 需要数据/UI 来证明新方案的优越性

### 五步流程
1. **审计旧模块**：列出结构性问题（不要急着改，列出清单）
2. **调研业界标准**：用真实参考（学术/开源/头部公司）支撑改进
3. **建并行 v2**：不修改旧代码，复制为 `_v2` 独立模块
4. **加 toggle + 对比工具**：让用户能瞬间切回 v1 做 A/B
5. **写单元测试验证修复**：用 mock 数据证明 v2 在偏差/异常场景下确实更优

### 反模式
- ❌ 直接改旧代码 → 无法回滚、生产事故
- ❌ 写完美新系统再切 → 用户无法验证、决策困难
- ❌ 只发改动不写对比 → 无法说服用户/PM/自己

### 配套 UI 模式
- 同一个入口加 v1/v2 toggle（默认 v2 让用户立即用新版，保留 v1 兜底）
- 单独的「对比」视图，列出偏差/重合度/异常股票数等可量化指标
- CLI 对比脚本（`scripts/test-*.ts`）+ 单元测试（`npx tsx` 直接跑）
