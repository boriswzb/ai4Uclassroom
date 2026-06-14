# QuantCraft: 下一代量化交易系统重构方案

> 基于对 JoinQuant / 米筐 / 掘金 / BigQuant / 宽邦 五大平台的研究
> 从职业投资者视角审视，2026年4月

---

## 一、为什么现有系统需要推倒重来

### 1.1 当前 OpenMAIC/quant 的根本问题

**"想到哪里做到哪里"的代价**：现有系统是一个 **战术型项目**（Tactical Project），而非 **战略型系统**（Strategic System）。两者有本质区别：

| 维度 | 战术型项目 | 战略型系统 |
|------|----------|----------|
| 目标 | 功能跑通 | 持续产生Alpha |
| 数据 | 拼接接口 | 清洗/对齐/存储 |
| 策略 | 5个指标 | 因子工厂 |
| 回测 | 事后验证 | 样本内外分离 |
| 风控 | 固定止损 | 动态风险预算 |
| 迭代 | 手动调参 | 因子挖掘+组合优化 |
| 生命周期 | 功能消失 | 策略可传承复用 |

**具体来说，当前系统缺失了这些职业投资者最需要的模块：**

```
缺失①：因子库（Alpha Factor Library）
  → JoinQuant 有200+因子，米筐有因子研究模块
  → 当前只有5个硬编码指标，无法扩展

缺失②：组合优化器（Portfolio Optimizer）
  → 只有"30%仓位"固定仓位，没有均值-方差优化
  → 没有Covariance矩阵估算

缺失③：样本外测试（Walk-Forward）
  → 只有一次性回测，无法做滚动窗口验证
  → 过拟合风险无法评估

缺失④：事件驱动回测（Event-Driven）
  → 当前是点 candle 回测，缺少财报/公告/宏观事件
  → 与真实交易环境脱节

缺失⑤：模拟交易与真实执行的桥接
  → 模拟是模拟，执行是执行，API broker 没有
  → 无法做"paper trading → 实盘"的迁移

缺失⑥：绩效归因（Performance Attribution）
  → 只有收益率，没有Brinson归因
  → 不知道收益来自选股还是择时

缺失⑦：风险管理 → 真正的风控体系
  → 当前只有固定止损/止盈
  → 没有VaR/CVaR/压力测试/黑天鹅保护
```

### 1.2 五大平台的核心差异

研究结论：五个平台代表了三种不同的量化哲学：

**A. 学术工程派（JoinQuant / 米筐）**
- 核心理念：让个人投资者用量化方法做**股票Alpha研究**
- 代表功能：Jupyter Notebook研究环境、因子分析框架、模拟组合
- 目标用户：Quant Researcher、有编程基础的投资者
- 最大优势：因子库 + 社区分享策略

**B. 工程落地派（掘金）**
- 核心理念：**实盘化**——让量化策略真正跑起来
- 代表功能：实时行情API、仿真柜台、算法下单、穿透式风控
- 目标用户：专业量化交易员、机构
- 最大优势：与期货/证券账户的直连接入

**C. AI赋能派（BigQuant / 宽邦）**
- 核心理念：用AI（机器学习）做**因子挖掘 + 策略生成**
- 代表功能：AI因子、遗传编程策略、ChatGPT式策略助手
- 目标用户：愿意尝试AI辅助研究的投资者
- 最大优势：AI降低研究门槛，挖掘人类难以发现的非线性规律

### 1.3 重新定位：QuantCraft

**新产品定位：面向职业个人投资者（Pro-Sumer）的 AI-Augmented Quant Research Platform**

```
三层用户：
  Level 1: 散户投资者 → 使用现成策略 / 一键跟单
  Level 2: 职业个人 → 因子研究 + 回测 + 模拟交易
  Level 3: 量化团队 → 因子库 + 组合管理 + 风控台
```

---

## 二、QuantCraft 系统架构

### 2.1 核心理念：Alpha = 因子 × 组合 × 风控

这九个字是职业量化交易的核心公式。系统设计全部围绕这三件事：

```
Alpha（超额收益）= 因子（信息优势） × 组合（风险分散） × 风控（下行保护）

数据   →  因子   →  策略   →  组合   →  执行   →  风控   →  绩效
  │        │        │        │        │        │        │
 DataHub Factor  Strategy Portfolio Execution RiskMgr Analytics
```

### 2.2 完整目录结构

```
/QuantCraft
├── SPEC.md                          # 产品规格说明书（这个文件）
├── README.md
├── package.json
├── next.config.ts
│
├── src/
│   ├── app/
│   │   ├── (app)/
│   │   │   │                          # 认证后布局
│   │   │   ├── layout.tsx
│   │   │   ├── dashboard/             # 工作台首页
│   │   │   │   └── page.tsx
│   │   │   ├── research/              # 量化研究（核心）
│   │   │   │   ├── page.tsx          # Jupyter式研究界面
│   │   │   │   ├── factors/           # 因子研究
│   │   │   │   │   ├── [id]/
│   │   │   │   │   └── new/
│   │   │   │   ├── backtests/        # 回测历史
│   │   │   │   │   ├── [id]/
│   │   │   │   │   └── compare/       # 对比分析
│   │   │   │   └── walks/            # Walk-Forward分析
│   │   │   │
│   │   │   ├── strategies/            # 策略管理
│   │   │   │   ├── page.tsx
│   │   │   │   ├── [id]/
│   │   │   │   └── import/           # 策略导入（掘金/聚宽格式）
│   │   │   │
│   │   │   ├── portfolio/             # 组合管理
│   │   │   │   ├── page.tsx          # 组合概览
│   │   │   │   ├── optimizer/         # 组合优化器
│   │   │   │   ├── builder/           # 组合构建器
│   │   │   │   └── attribution/       # 绩效归因
│   │   │   │
│   │   │   ├── trading/               # 实盘/模拟交易
│   │   │   │   ├── page.tsx
│   │   │   │   ├── orders/           # 订单管理
│   │   │   │   ├── positions/         # 持仓管理
│   │   │   │   └── logs/             # 交易日志
│   │   │   │
│   │   │   ├── risk/                  # 风险管理台
│   │   │   │   ├── page.tsx
│   │   │   │   ├── limits/           # 风险限额
│   │   │   │   ├── stress/           # 压力测试
│   │   │   │   └── var/              # VaR/CVaR
│   │   │   │
│   │   │   ├── data/                  # 数据中心
│   │   │   │   ├── page.tsx
│   │   │   │   ├── universe/         # 股票池管理
│   │   │   │   ├── fundamentals/     # 基本面数据
│   │   │   │   └── alternatives/     # 另类数据（舆情/宏观）
│   │   │   │
│   │   │   └── settings/
│   │   │       ├── brokers/          # 券商账户配置
│   │   │       ├── api-keys/         # 数据源API Key
│   │   │       └── preferences/      # 用户偏好
│   │   │
│   │   ├── (auth)/
│   │   │   ├── login/
│   │   │   ├── register/
│   │   │   └── invite/
│   │   │
│   │   ├── (marketing)/
│   │   │   ├── page.tsx              # 首页/落地页
│   │   │   ├── features/
│   │   │   └── pricing/
│   │   │
│   │   └── api/
│   │       ├── v1/                    # REST API v1
│   │       │   ├── factors/
│   │       │   │   ├── route.ts      # GET list, POST create
│   │       │   │   └── [id]/route.ts
│   │       │   ├── backtests/
│   │       │   ├── strategies/
│   │       │   ├── portfolio/
│   │       │   ├── orders/
│   │       │   ├── positions/
│   │       │   ├── risk/
│   │       │   ├── data/             # 行情数据代理
│   │       │   │   ├── realtime/
│   │       │   │   ├── kline/
│   │       │   │   ├── fundamentals/
│   │       │   │   └── search/
│   │       │   ├── user/
│   │       │   └── auth/
│   │       │
│   │       └── websocket/             # 实时行情WS
│   │           └── route.ts
│   │
│   │
│   ├── components/
│   │   ├── ui/                        # shadcn/ui 基础组件
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── select.tsx
│   │   │   ├── table.tsx
│   │   │   └── ...
│   │   │
│   │   ├── layout/                    # 全局布局组件
│   │   │   ├── app-shell.tsx         # 主应用壳
│   │   │   ├── sidebar.tsx
│   │   │   ├── header.tsx
│   │   │   └── breadcrumb.tsx
│   │   │
│   │   ├── data/                      # 数据展示组件
│   │   │   ├── stock-table.tsx        # 行情表格（virtual scroll）
│   │   │   ├── kline-chart.tsx       # K线图表（lightweight-charts）
│   │   │   ├── factor-chart.tsx      # 因子IC分析图
│   │   │   ├── equity-curve.tsx       # 权益曲线
│   │   │   ├── heatmap.tsx           # 月度收益热力图
│   │   │   └── attribution-table.tsx # 归因表格
│   │   │
│   │   ├── research/                  # 研究界面组件
│   │   │   ├── factor-editor.tsx     # 因子编辑（类Jupyter cell）
│   │   │   ├── factor-library.tsx    # 因子库侧边栏
│   │   │   ├── backtest-config.tsx  # 回测配置面板
│   │   │   ├── backtest-results.tsx # 回测结果面板
│   │   │   ├── signal-visualizer.tsx # 信号可视化
│   │   │   └── notebook-cell.tsx    # 研究笔记本单元格
│   │   │
│   │   ├── trading/                   # 交易组件
│   │   │   ├── order-entry.tsx       #下单面板
│   │   │   ├── position-card.tsx      #持仓卡片
│   │   │   ├── trade-log.tsx         #成交记录
│   │   │   ├── order-book.tsx        #订单簿
│   │   │   └── broker-status.tsx     #柜台连接状态
│   │   │
│   │   ├── risk/                      # 风控组件
│   │   │   ├── risk-dashboard.tsx    #风控仪表盘
│   │   │   ├── limit-editor.tsx      #限额编辑
│   │   │   ├── stress-scenarios.tsx  #压力情景
│   │   │   └── var-chart.tsx         #VaR图表
│   │   │
│   │   ├── ai/                        # AI增强组件
│   │   │   ├── strategy-chat.tsx     # 策略问答助手
│   │   │   ├── factor-generator.tsx  # AI因子生成
│   │   │   ├── signal-explainer.tsx  # 信号解读
│   │   │   └── report-generator.tsx  # 定期报告生成
│   │   │
│   │   └── shared/
│   │       ├── stock-selector.tsx     #股票搜索选择器
│   │       ├── date-range-picker.tsx #日期范围选择
│   │       └── loading-skeleton.tsx  #加载骨架屏
│   │
│   │
│   ├── lib/
│   │   ├── db/
│   │   │   ├── schema.prisma          # 数据库Schema（PostgreSQL）
│   │   │   └── client.ts             # Prisma客户端单例
│   │   │
│   │   ├── cache/
│   │   │   ├── redis.ts              # Redis客户端（ioredis）
│   │   │   ├── memory.ts            # 进程内LRU缓存（设计器）
│   │   │   └── keys.ts              # 缓存键命名规范
│   │   │
│   │   ├── queue/
│   │   │   ├── bull.ts              # 任务队列（回测/数据处理）
│   │   │   └── processors/
│   │   │       ├── backtest.worker.ts
│   │   │       ├── data.worker.ts
│   │   │       └── report.worker.ts
│   │   │
│   │   ├── broker/
│   │   │   ├── types.ts             # 券商接口抽象
│   │   │   ├── mock.ts              # 模拟柜台（开发用）
│   │   │   ├── ctp.ts               # 期货CTP接口（掘金风格）
│   │   │   └── sandbox/             # 证券仿真柜台
│   │   │
│   │   ├── factor/
│   │   │   ├── registry.ts          # 因子注册表（单例）
│   │   │   ├── factory.ts           # 因子工厂
│   │   │   ├── evaluator.ts         # 因子评估器（IC/IR）
│   │   │   └── operators/          # 因子运算基元
│   │   │       ├── ts.py            # 时间序列算子
│   │   │       ├── cs.py            # 截面算子
│   │   │       └── stats.py         # 统计算子
│   │   │
│   │   ├── backtest/
│   │   │   ├── engine.ts           # 事件驱动回测引擎
│   │   │   ├── events.ts           # 事件类型定义
│   │   │   ├── slippage.ts         # 滑点模型
│   │   │   ├── commission.ts       # 佣金模型
│   │   │   ├── optimizer.ts        # 参数优化器（网格/贝叶斯）
│   │   │   └── walkforward.ts       # Walk-Forward分析器
│   │   │
│   │   ├── portfolio/
│   │   │   ├── builder.ts          # 组合构建器
│   │   │   ├── optimizer.ts        # 均值-方差优化
│   │   │   ├── risk-model.ts       # Risk Model（Covariance矩阵）
│   │   │   ├── attribution.ts       # Brinson归因
│   │   │   └── rebalancer.ts       # 再平衡调度器
│   │   │
│   │   ├── risk/
│   │   │   ├── engine.ts           # 风控引擎
│   │   │   ├── limits.ts           # 风险限额定义
│   │   │   ├── var.py              # VaR/CVaR计算
│   │   │   ├── stress.py           # 压力测试
│   │   │   └── compliance.ts       # 合规检查（仓位限制/做空限制）
│   │   │
│   │   ├── strategy/
│   │   │   ├── base.ts             # 策略基类（ABC）
│   │   │   ├── executor.ts         # 策略执行器
│   │   │   ├── scheduler.ts        # 策略调度器
│   │   │   └── monitor.ts         # 策略状态监控
│   │   │
│   │   ├── data/
│   │   │   ├── connector.ts        # 数据连接器基类
│   │   │   ├── providers/
│   │   │   │   ├── eastmoney.ts    # 东方财富
│   │   │   │   ├── akshare.ts      # akshare
│   │   │   │   ├── tushare.ts      # Tushare（需要Token）
│   │   │   │   └── wind.ts         # Wind（需要License）
│   │   │   ├── aligner.ts          # 数据对齐（停牌/复权）
│   │   │   ├── cleanser.ts         # 数据清洗
│   │   │   └── loader.ts           # 历史数据加载器
│   │   │
│   │   ├── realtime/
│   │   │   ├── feed.ts             # 实时行情Feed
│   │   │   ├── aggregator.ts       # 多源行情聚合
│   │   │   └── websocket.ts        # WS连接管理
│   │   │
│   │   ├── ai/
│   │   │   ├── llm.ts              # LLM接口（OpenAI/Anthropic/本地）
│   │   │   ├── factor-generator.ts # 基于LLM的因子生成
│   │   │   ├── strategy-explainer.ts # 策略解读
│   │   │   └── report-generator.ts # 自动报告生成
│   │   │
│   │   └── utils/
│   │       ├── date.ts             # 日期工具（交易日历）
│   │       ├── math.ts             # 数学工具
│   │       ├── logger.ts           # 结构化日志
│   │       └── validation.ts       # 输入验证
│   │
│   │
│   ├── store/                        # Zustand 全局状态
│   │   ├── use-user-store.ts
│   │   ├── use-factor-store.ts
│   │   ├── use-backtest-store.ts
│   │   ├── use-strategy-store.ts
│   │   ├── use-portfolio-store.ts
│   │   ├── use-position-store.ts
│   │   ├── use-risk-store.ts
│   │   └── use-realtime-store.ts
│   │
│   │
│   └── types/
│       ├── alpha.ts                 # Alpha/因子类型
│       ├── backtest.ts             # 回测结果类型
│       ├── portfolio.ts            # 组合类型
│       ├── risk.ts                 # 风控类型
│       ├── market.ts               # 市场数据类型
│       ├── broker.ts               # 券商接口类型
│       └── api.ts                  # API请求/响应类型
│
│
├── prisma/
│   └── schema.prisma               # 数据库Schema
│
│
├── workers/                         # 后台Worker进程（独立）
│   ├── backtest.worker.ts         # 回测Worker
│   ├── data.worker.ts             # 数据更新Worker
│   ├── signal.worker.ts           # 策略信号Worker
│   └── report.worker.ts           # 报告生成Worker
│
│
├── scripts/
│   ├── backfill.ts                # 历史数据填充脚本
│   ├── migrate.ts                 # 数据迁移脚本
│   └── seed.ts                    # 测试数据生成
│
│
└── tests/
    ├── unit/
    │   ├── factor/
    │   ├── backtest/
    │   ├── portfolio/
    │   └── risk/
    └── integration/
        ├── data-flow.test.ts
        └── order-flow.test.ts
```

---

## 三、核心模块设计要点

### 3.1 数据层（DataHub）—— 所有Alpha的起点

```
质量层次：原始数据 → 清洗数据 → 因子数据 → 信号数据
```

**核心原则：**
1. **单一数据源（Single Source of Truth）**：同一个股票同一个复权方式，全系统统一
2. **可追溯性（Traceability）**：每一根K线能追溯到交易所原始报文
3. **交易日历**：A股/港股/期货/美股分别管理，处理调休/停牌/退市

**因子数据模型（核心）：**
```typescript
// types/alpha.ts
interface FactorDefinition {
  id: string;
  name: string;                    // 中文名称
  symbol: string;                  // 符号标识 e.g. "MACD_12_26_9"
  category: 'price' | 'volume' | 'fundamental' | 'sentiment' | '宏观';
  description: string;
  formula: string;                 // 显示用公式
  dependencies: string[];           // 依赖的其他因子ID
  parameters: Record<string, number | string>;
  createdBy: string;               // userId 或 "system"
  isPublic: boolean;                // 公开因子 vs 个人因子
  tags: string[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

// 因子值矩阵（时间 × 股票 × 因子）
interface FactorMatrix {
  factorId: string;
  dates: string[];                  // YYYYMMDD
  codes: string[];                  // 股票代码
  values: Float32Array;             // 扁平化 2D array
  // 值访问：values[i * codes.length + j] = date[i] × code[j]
}

// 因子评估指标
interface FactorPerformance {
  factorId: string;
  icMean: number;                  // IC均值
  icStd: number;                   // IC标准差
  ir: number;                      // IC均值/IC标准差
  rankICMean: number;
  rankICStd: number;
  rankIR: number;
  turnover: number;                // 换手率
  LongShortReturn: number;         // 多空组合收益
}
```

### 3.2 因子层（FactorLayer）—— 从数据到信息

这是当前 OpenMAIC/quant **最薄弱**的环节。现有系统只有5个硬编码指标，新的系统需要：

**因子工厂模式：**
```typescript
// lib/factor/factory.ts
class FactorFactory {
  // 注册算子
  registerOperator(name: string, fn: FactorOperator): void;

  // 编译因子表达式（支持DSL）
  compile(expression: string): CompiledFactor;

  // 批量计算
  calculate(factor: CompiledFactor, data: DataMatrix): FactorMatrix;
}

// 支持的算子类型
type FactorOperator =
  | 'TS_SUM'      // 时间序列求和
  | 'TS_MEAN'     // 均线
  | 'TS_STD'      // 标准差
  | 'TS_CORR'     // 时间序列相关
  | 'CS_RANK'     // 截面排名
  | 'CS_ZSCORE'   // 截面Z-Score
  | 'DELTA'       // 一阶差分
  | 'LOG'         // 对数
  | 'POWER'       // 幂
  | 'MIN' / 'MAX' // 极值
  | 'QUANTILE';   // 分位数
```

**预置因子库（参考 JoinQuant）：**
```
技术类（20+）：
  MACD, KDJ, RSI, Bollinger, MA(5/10/20/60/120/250), EMA, WR, CCI, ATR, OBV

量价类（15+）：
  换手率, 成交量增长率, 价格动量, 波动率, 相对强弱

基本面类（30+）：
  PE, PB, PS, PCF, 股息率, ROE, ROA, 净利润增长率, 营收增长率
  资产负债率, 流动比率, 存货周转率, 应收账款周转率

舆情类（10+）：
  研报数量, 关注度, 新闻情感, 分析师评级, 机构持仓变化

宏观类（5+）：
  无风险利率, 汇率, 商品指数, VIX, 货币供应量
```

### 3.3 回测层（BacktestEngine）—— 事件驱动的仿真

**当前 OpenMAIC 的问题：** 是"点回测"（bar-by-bar），而不是"事件回测"（event-driven）。真实交易中，订单成交有一个**订单生命周期**：

```
signal → order → pending → filled/partial/rejected → position update
```

**新的回测引擎架构：**
```typescript
// lib/backtest/engine.ts

// 事件类型
type BacktestEvent =
  | { type: 'BAR'; data: KBar }
  | { type: 'SIGNAL'; signal: Signal; bar: KBar }
  | { type: 'ORDER_NEW'; order: Order }
  | { type: 'ORDER_FILLED'; order: Order; fillPrice: number; fillTime: Date }
  | { type: 'ORDER_REJECTED'; order: Order; reason: string }
  | { type: 'POSITION_OPEN'; position: Position; order: Order }
  | { type: 'POSITION_CLOSE'; position: Position; pnl: number; order: Order }
  | { type: 'DIVIDEND'; code: string; amount: number; date: Date }
  | { type: 'SPLIT'; code: string; ratio: number; date: Date }
  | { type: 'BENCHMARK_UPDATE'; value: number };

class BacktestEngine {
  // 事件订阅
  on(event: BacktestEvent['type'], handler: (e: BacktestEvent) => void): void;

  // 运行回测
  run(config: BacktestConfig): Promise<BacktestResult>;

  // 步进模式（用于研究调试）
  step(): Promise<BacktestEvent>;
  resume(): void;
  pause(): void;

  // 交易成本模型
  setCommission(commission: CommissionModel): void;
  setSlippage(slippage: SlippageModel): void;
}

// 佣金模型（可组合）
interface CommissionModel {
  calculate(order: Order, filledPrice: number): number;
  // 预设：A股万分之三（最低5元），ETF万分之三，期货每手固定
}
```

**关键：Walk-Forward 分析**
```typescript
// lib/backtest/walkforward.ts
interface WalkForwardConfig {
  trainStart: string;              // 训练期开始
  trainEnd: string;                // 训练期结束
  testStart: string;               // 测试期开始
  testEnd: string;                 // 测试期结束
  windowType: 'rolling' | 'expanding'; // 滚动窗口 vs 递增窗口
  windowSize?: number;             // 滚动窗口大小（月）
  stepSize?: number;              // 滚动步长
}

interface WalkForwardResult {
  windows: Array<{
    trainPeriod: { start: string; end: string };
    testPeriod: { start: string; end: string };
    trainResult: BacktestResult;
    testResult: BacktestResult;
    params: Record<string, number>; // 最优参数
  }>;
  aggregatedTrain: AggregateMetrics;
  aggregatedTest: AggregateMetrics;
  stabilityScore: number;          // 参数稳定性（不同窗口参数变化程度）
}
```

### 3.4 组合层（PortfolioLayer）—— 风险分散的艺术

**现代组合理论（MPT）的实际应用：**
```typescript
// lib/portfolio/optimizer.ts

interface PortfolioConfig {
  objective: 'max_sharpe' | 'min_variance' | 'risk_parity' | 'equal_weight';
  constraints: {
    maxWeightPerStock: number;    // 单只股票最大权重（默认10%）
    minWeightPerStock: number;     // 最小权重（0或0.1%）
    maxSectorWeight?: number;       // 行业最大权重
    maxLeverage: number;           // 最大杠杆（默认1.0）
    minCashRatio: number;          // 最低现金比例
  };
  riskModel: 'historical' | 'shrinkage' | 'factor';
  optimizationTargetReturn?: number; // 目标收益（用于有效前沿）
}

class PortfolioOptimizer {
  optimize(
    expectedReturns: number[],    // 股票预期收益
    covarianceMatrix: number[][], // 协方差矩阵
    config: PortfolioConfig
  ): OptimizationResult;

  // 构建风险平价组合
  riskParity(expectedReturns: number[], covarianceMatrix: number[][]): number[];

  // 黑嘴维茨有效前沿
  efficientFrontier(
    expectedReturns: number[],
    covarianceMatrix: number[][]
  ): EfficientFrontierPoint[];
}

// 协方差矩阵估算（收缩估计）
class CovarianceEstimator {
  // Ledoit-Wolf收缩估计（解决样本外不稳定问题）
  ledoitWolf(returns: number[][]): number[][];
  // 因子模型协方差（更稳定）
  factorModel(factorBetas: number[][], factorCov: number[][], idioVar: number[]): number[][];
}
```

**绩效归因（Brinson Model）：**
```typescript
// lib/portfolio/attribution.ts
interface AttributionResult {
  totalReturn: number;
  benchmarkReturn: number;
  excessReturn: number;            // 超额收益

  // Brinson三因子分解
  allocationEffect: number;        // 资产配置效应
  selectionEffect: number;         // 选股效应
  interactionEffect: number;       // 交互效应

  // 进一步分解到行业/因子
  sectorContributions: Record<string, number>;
  factorContributions: Record<string, number>;

  // 择时 vs 选股
  timingEffect: number;
  selectivityEffect: number;
}
```

### 3.5 风控层（RiskLayer）—— 生存的底线

**三层风控体系：**
```typescript
// lib/risk/engine.ts

// 第一层：合规检查（规则引擎）
interface ComplianceRule {
  id: string;
  name: string;
  check(order: Order, account: Account): { allowed: boolean; reason?: string };
  severity: 'block' | 'warn' | 'log';
}

// 预设规则
// - 单笔订单不超过账户净值5%
// - 单日亏损不超过账户净值7%（硬止损）
// - 单一股票持仓不超过总净值15%
// - 禁止ST/*ST（可选）
// - 科创板/创业板需要风险测评合格

// 第二层：市场风险度量
class MarketRiskEngine {
  // 历史VaR（95%/99%置信区间）
  historicalVaR(positions: Position[], confidence: 0.95 | 0.99, horizon: number): number;

  // CVaR（条件尾部期望）
  cvar(positions: Position[], confidence: 0.95): number;

  // Greeks风控（如果交易期权/期货）
  deltaPortfolio(positions: Position[]): number;
  gammaPortfolio(positions: Position[]): number;

  // 压力测试：指定情景下的损益
  stressTest(
    positions: Position[],
    scenario: StressScenario
  ): StressResult;
}

interface StressScenario {
  name: string;
  // 情景定义：股票/期货/汇率/利率冲击比例
  shocks: Record<string, number>; // e.g. { '沪深300': -0.1, '十年国债': 0.02 }
}

// 第三层：实时风控（监控+告警+自动平仓）
class RealtimeRiskMonitor {
  // 订阅实时行情
  subscribe(positions: Position[]): void;

  // 触发止损检查
  onQuote(code: string, price: number): void;

  // 告警
  onAlert(handler: (alert: RiskAlert) => void): void;
}

interface RiskAlert {
  level: 'warning' | 'critical' | 'forced_liquidation';
  message: string;
  affectedPositions: string[];
  suggestedAction: string;
}
```

### 3.6 执行层（ExecutionLayer）—— 从信号到订单

**执行算法（TWAP/VWAP/POV/IS）：**
```typescript
// lib/strategy/executor.ts

type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';

interface ExecutionAlgo {
  // 生成订单列表（拆单）
  generateOrders(
    signal: Signal,
    targetPosition: number,  // 目标持仓（股数）
    currentPosition: number,  // 当前持仓
    urgency: 'low' | 'medium' | 'high'
  ): ScheduledOrder[];
}

interface ScheduledOrder {
  orderType: OrderType;
  price: number | 'market';
  volume: number;
  startTime: Date;
  endTime: Date;
  priority: number;
}

// 预设执行算法
class TWAPExecutor implements ExecutionAlgo {}
class VWAPExecutor implements ExecutionAlgo {}  // 参考历史成交量分布
class POVExecutor implements ExecutionAlgo {}   // 成交量百分比
class ISExecutor implements ExecutionAlgo {}    // Implementation Shortfall
```

**券商接口抽象（支持掘金/聚宽实盘格式）：**
```typescript
// lib/broker/types.ts

interface BrokerConnector {
  // 连接状态
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;

  // 行情
  subscribeQuotes(codes: string[], handler: (quote: Quote) => void): void;
  unsubscribeQuotes(codes: string[]): void;

  // 订单
  sendOrder(order: OrderRequest): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<boolean>;
  getOpenOrders(): Promise<Order[]>;
  getOrderStatus(orderId: string): Promise<Order>;

  // 持仓/资金
  getAccount(): Promise<AccountInfo>;
  getPositions(): Promise<PositionInfo[]>;

  // 成交回报（WebSocket推送）
  onTrade(handler: (trade: Trade) => void): void;
  onOrderUpdate(handler: (order: Order) => void): void;
}

// 预设连接器
class MockBroker implements BrokerConnector {}     // 开发/回测用
class JoinQuantBroker implements BrokerConnector {} // 聚宽
class GoldMinerBroker implements BrokerConnector {} // 掘金
class CustomBroker implements BrokerConnector {}   // 用户自定义CTP
```

---

## 四、AI增强层（AI Augmentation）

这是 BigQuant / 宽邦 重点发力的方向，也是差异化竞争点：

```typescript
// lib/ai/llm.ts

interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'deepseek';
  model: string;
  temperature: number;
  apiKey?: string;          // 用户自有Key（保护隐私）
  baseURL?: string;          // 代理地址
}

// AI因子生成
class FactorGenerator {
  async generate(
    prompt: string,          // e.g. "生成一个基于成交量的反转因子"
    constraints: {
      category: 'price' | 'volume' | 'fundamental';
      maxLookback: number;
      avoidOverfitting: boolean;
    }
  ): Promise<{
    formula: string;         // e.g. "TS_RANK(DELTA(VOLUME,1), 20)"
    description: string;
    expectedDirection: 'long' | 'short' | 'market_neutral';
    confidence: number;
  }>;
}

// AI策略解读（将量化策略翻译成人话）
class StrategyExplainer {
  async explain(strategy: Strategy): Promise<{
    summary: string;         // 一句话描述
    logic: string;           // 逻辑描述
    strengths: string[];     // 策略优势
    weaknesses: string[];     // 策略劣势
    marketConditions: string[]; // 适合的市场环境
    riskFactors: string[];   // 已知风险点
  }>;
}

// AI定期报告生成
class ReportGenerator {
  async generateWeeklyReport(portfolioId: string): Promise<{
    summary: string;
    performance: PerformanceSummary;
    attribution: AttributionResult;
    riskMetrics: RiskSummary;
    topPositions: PositionSummary[];
    recommendations: string[];
  }>;
}
```

---

## 五、技术选型

### 5.1 为什么从"Next.js + 纯前端"转向"前后端分离"

| 维度 | 现有方案（Next.js SPA） | 新方案（前后端分离） |
|------|----------------------|------------------|
| 回测计算 | 浏览器端（算力限制） | 后端Worker（无限算力） |
| 数据存储 | IndexedDB（小数据） | PostgreSQL（大数据/时序） |
| 策略安全 | JS源码可见（泄露风险） | 后端黑盒运行 |
| 实盘对接 | 不可能 | 后端直接调用券商API |
| 多用户 | 不支持 | 支持（用户隔离） |
| 因子库 | 硬编码 | 数据库存储 + 共享 |
| 社区功能 | 不支持 | 可扩展 |

### 5.2 核心技术栈

```
后端：
  运行时：Node.js 20 + TypeScript
  Web框架：Next.js 16 (API Routes) 或 Hono（更轻量）
  数据库：PostgreSQL 16 + TimescaleDB（时序数据）
  缓存：Redis 7（因子缓存/会话）
  任务队列：BullMQ（基于Redis）
  ORM：Prisma 6
  WebSocket：Socket.io 或 native WS

前端：
  框架：Next.js 16 (App Router)
  UI：shadcn/ui + Tailwind CSS
  状态：Zustand（全局） + TanStack Query（服务端状态）
  图表：lightweight-charts（K线）+ Recharts（分析图）
  表格：TanStack Table（virtual scroll支持万行）
  日期：date-fns

量化计算（Browser）：  # 仅研究界面用
  指标计算：TypeScript实现（复用后端逻辑）
  简单回测：浏览器端（数据量小的时候）
  K线图表：lightweight-charts v5

部署：
  前端：Vercel / Cloudflare Pages
  后端：Railway / Render / 独立服务器
  数据库：Supabase Postgres / Neon
  缓存：Upstash Redis
```

### 5.3 为什么不是 Backtrader / Zipline / QuantConnect

这些是**通用量化框架**，优点是成熟，缺点是：
- 不适合 Web 原生（需要 Python 环境）
- 与现代 Web 前端集成成本高
- 不支持中国A股特殊规则（T+1、涨跌停、ST限制）
- 无法快速迭代 AI 功能

**QuantCraft 的核心差异**：原生为 Web 设计，AI-First，中国A股优先。

---

## 六、与 OpenMAIC 的关系

### 6.1 分离的充分理由

| 维度 | OpenMAIC | QuantCraft |
|------|---------|----------|
| 定位 | AI学习/创作平台 | 专业量化交易 |
| 用户 | AI爱好者/学习者 | 职业投资者/Quant |
| 架构 | 单体（Next.js） | 前后端分离 |
| 数据 | 拼接接口 | 清洗+存储+管理 |
| 策略 | 5个硬编码指标 | 因子工厂（可扩展） |
| 回测 | 点回测（浏览器） | 事件驱动（后端Worker） |
| 风控 | 固定止损 | 三层风控体系 |
| 团队 | 1-2人维护 | 可独立团队 |
| 商业模式 | 免费/学习 | 订阅制（专业功能付费） |

### 6.2 渐进迁移策略

```
Phase 1（立即）：
  → QuantCraft 作为独立仓库，从零开始
  → OpenMAIC/quant 保持现有功能，继续迭代
  → 共享登录系统（Supabase Auth）减少用户摩擦

Phase 2（3个月后）：
  → QuantCraft 完成核心回测+模拟交易
  → OpenMAIC/quant 引导专业用户迁移到 QuantCraft

Phase 3（6个月后）：
  → QuantCraft 支持实盘对接
  → OpenMAIC/quant 进入维护模式
```

### 6.3 命名建议

| 名称 | 风格 | 适合 |
|------|------|------|
| QuantCraft | Craft（工艺） | 专业但可亲，强调"手工打造" |
| AlphaForge | Forge（锻造） | 强调Alpha工厂 |
| QuantHub | Hub（枢纽） | 简洁，但不够独特 |
| WiseQuant | Wise（智慧） | AI导向 |

**推荐：QuantCraft** —— 简洁、有辨识度、暗示"量化是一种工艺"。

---

## 七、优先级与实施计划

### 7.1 MVP 核心功能（3个月）

```
P0（必须）：
  ✅ 用户认证（Supabase Auth）
  ✅ 数据中心（东方财富/Tushare数据）
  ✅ 因子编辑（简单表达式，支持5个基础指标）
  ✅ 回测引擎（事件驱动，支持基本交易成本）
  ✅ 模拟交易（与回测同一套框架）
  ✅ 组合管理（多策略组合，资金分配）

P1（重要）：
  ✅ Walk-Forward分析
  ✅ 权益曲线+绩效指标
  ✅ 基础风控（止损/仓位限制）
  ✅ 多数据源（Tushare/Akshare）

P2（增强）：
  ❌ 组合优化器
  ❌ 绩效归因
  ❌ AI因子生成
  ❌ 实盘对接
```

### 7.2 不再复制 OpenMAIC/quant 的功能

以下 OpenMAIC/quant 功能**不会**在新系统中复制：
- `ai-strategy-assistant.tsx` → QuantCraft 会重写（基于真实策略结构）
- `ai-report-viewer.tsx` → QuantCraft 重新设计（基于真实绩效数据）
- `industry-map.ts` → 作为数据而非独立模块
- `screener-panel.tsx` → QuantCraft 的选股在研究模块中作为因子研究的自然延伸

---

## 八、总结

**QuantCraft 的核心差异化：**

1. **Alpha = 因子 × 组合 × 风控** —— 这是职业量化的核心公式，系统所有模块都围绕这个公式设计
2. **AI-Augmented** —— AI因子生成、策略解读、自动报告，不是噱头而是核心功能
3. **前后端分离** —— 回测在后端Worker执行，不受浏览器算力限制
4. **中国A股原生** —— T+1、涨跌停、ST限制、ETF申赎、期货移仓，全部内置支持
5. **可传承** —— 因子库、策略、组合模板可以在用户间共享（可选社区模式）

**下一步行动：**
1. 创建 `QuantCraft` GitHub 仓库
2. 初始化 Next.js 项目，配置 Prisma + PostgreSQL
3. 实现 `DataHub` 数据层（东方财富数据接入）
4. 实现 `FactorFactory`（最小可行因子系统）
5. 实现 `BacktestEngine`（事件驱动）
6. 实现第一个完整的 `MACD均值回复` 策略端到端（研究→回测→模拟）

---

*本文档为产品架构设计文档，随着开发进展持续更新。*
*最后更新：2026年4月*
