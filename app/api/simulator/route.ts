/**
 * 模拟交易 API
 * 支持单策略（5种）和策略组合（4种组合模式）
 * 受邀用户数据隔离：每个受邀用户有独立的账户/持仓/历史
 */
import { NextRequest, NextResponse } from 'next/server';
import { liveSimulator } from '@/lib/quant/simulator/live-simulator';
import { simulatorPersistence } from '@/lib/quant/store/simulator-persistence';
import { checkInviteCookie } from '@/lib/server/invite-codes';
import {
  MACDStrategy, KDJStrategy, MAStrategy,
  BollingerStrategy, RSIStrategy
} from '@/lib/quant/strategies/strategy-engine';
import {
  CompositeStrategy,
  FactorScoreStrategy,
} from '@/lib/quant/strategies/new-strategies';
import {
  StrategyEnsemble,
  EnsembleMode,
  createVotingEnsemble,
  createFilterEnsemble,
  createWeightedEnsemble,
  createDynamicEnsemble,
} from '@/lib/quant/strategies/strategy-ensemble';
import { dataSourceManager } from '@/lib/quant/data/data-source';
import type { Direction } from '@/lib/quant/types';

// ==================== GET: 查询状态 ====================

export async function GET() {
  try {
    // 按当前用户身份恢复对应的账户
    const user = await checkInviteCookie();
    const userId = user.invited ? user.username : `guest_${user.username || 'anonymous'}`;

    const restoreResult = await simulatorPersistence.restore(userId);

    // 刷新后：如果有 runtime 绑定（自动驾驶曾开启），重建策略实例并重启引擎
    if (restoreResult.tradingCodes.length > 0 && restoreResult.autoPilot) {
      await liveSimulator.ensureRunning({
        codes: restoreResult.tradingCodes,
        strategyType: restoreResult.strategyType,
        ensembleType: restoreResult.ensembleType,
        autoPilot: restoreResult.autoPilot,
      });
      // 重建策略后同步到磁盘
      simulatorPersistence.syncCurrentToDisk(userId).catch(err => {
        console.error('[simulator GET] post-restore sync failed:', err);
      });
    }

    // P0 Bug 修复：刷新持仓价格（兜底拉不在 tradingCodes 中的持仓 K 线）
    try {
      const updated = await liveSimulator.refreshHoldingPrices();
      if (updated > 0) {
        console.log(`[simulator GET] refreshHoldingPrices updated ${updated} positions`);
      }
    } catch (e) {
      console.warn('[simulator GET] refreshHoldingPrices failed:', e);
    }

    const account = liveSimulator.getAccount();
    const isRunning = liveSimulator.isActive();
    const isAutoPilot = liveSimulator.isAutoPilotActive();
    const orders = liveSimulator.getOrders().slice(-50).reverse();
    const tradingCodes = liveSimulator.getTradingCodes();
    // P1-B：暴露策略注册数，前端用来判断是否显示"策略未注册"警告徽章
    const strategiesCount = liveSimulator.getStrategiesCount();

    return NextResponse.json({
      success: true,
      data: {
        isRunning,
        isAutoPilot,
        account,
        orders,
        userId,
        isInviteUser: user.invited,
        tradingCodes,
        strategiesCount,
      }
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ==================== POST: 操作 ====================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, ...params } = body;

    // 辅助：异步把当前 liveSimulator 状态写盘（不阻塞响应）
    const syncAfter = (userId: string) => {
      simulatorPersistence.syncCurrentToDisk(userId).catch(err => {
        console.error(`[simulator API] sync after ${action} failed:`, err);
      });
    };

    // 辅助：解析当前 userId
    const resolveUserId = async (): Promise<string> => {
      const u = await checkInviteCookie();
      return u.invited ? u.username : `guest_${u.username || 'anonymous'}`;
    };

    switch (action) {

      // ── 启动：单策略模式 ──
      case 'start':
      case 'startWithStrategy': {
        const { codes, strategyType, initialCash, strategyParams } = params as {
          codes: string[];
          strategyType: 'macd' | 'kdj' | 'ma' | 'bollinger' | 'rsi' | 'factor';
          initialCash?: number;
          strategyParams?: { factorScores?: Record<string, number> };
        };

        const factorScores = strategyParams?.factorScores;

        if (!codes || codes.length === 0) {
          return NextResponse.json({ success: false, error: '请添加股票' }, { status: 400 });
        }
        if (codes.length > 10) {
          return NextResponse.json({ success: false, error: '最多10支' }, { status: 400 });
        }

        // 获取用户身份并创建/查找账户
        const user = await checkInviteCookie();
        const userId = user.invited ? user.username : `guest_${user.username || 'anonymous'}`;
        const cash = initialCash || 1000000;

        // 查找或创建账户（浏览器侧写入 IndexedDB，Node.js 静默跳过）
        const accountId = await simulatorPersistence.findOrCreateAccount(userId, cash);
        if (accountId) {
          await simulatorPersistence.updateAccountCash(accountId, cash, 0, cash, 0);
        }

        liveSimulator.reset(cash);
        liveSimulator.setAccountId(accountId);

        for (const code of codes) {
          const strategy = createSingleStrategy(strategyType, factorScores);
          liveSimulator.addStrategy(code, strategy);
        }

        await liveSimulator.start();
        await dataSourceManager.setActiveSource('akshare');

        // 保存 runtime 绑定（刷新后用于重建策略实例）
        if (accountId) {
          await simulatorPersistence.updateAccountRuntime(accountId, codes, strategyType, undefined);
        }
        syncAfter(userId);

        return NextResponse.json({
          success: true,
          message: `${STRATEGY_NAMES[strategyType] || strategyType} 已启动（自动驾驶待开启）`,
          data: { isRunning: true, isAutoPilot: false, mode: 'single', strategyType, userId, accountId }
        });
      }

      // ── 启动：组合策略模式 ──
      case 'startEnsemble': {
        const { codes, ensembleType, initialCash } = params as {
          codes: string[];
          ensembleType: 'voting' | 'filter' | 'weighted' | 'dynamic';
          initialCash?: number;
        };

        if (!codes || codes.length === 0) {
          return NextResponse.json({ success: false, error: '请添加股票' }, { status: 400 });
        }
        if (codes.length > 10) {
          return NextResponse.json({ success: false, error: '最多10支' }, { status: 400 });
        }

        const user = await checkInviteCookie();
        const userId = user.invited ? user.username : `guest_${user.username || 'anonymous'}`;
        const cash = initialCash || 1000000;

        const accountId = await simulatorPersistence.findOrCreateAccount(userId, cash);
        if (accountId) {
          await simulatorPersistence.updateAccountCash(accountId, cash, 0, cash, 0);
        }

        liveSimulator.reset(cash);
        liveSimulator.setAccountId(accountId);

        for (const code of codes) {
          const ensemble = createPresetEnsemble(ensembleType);
          liveSimulator.addEnsemble(code, ensemble);
        }

        await liveSimulator.start();
        await dataSourceManager.setActiveSource('akshare');

        // 保存 runtime 绑定（刷新后用于重建策略实例）
        if (accountId) {
          await simulatorPersistence.updateAccountRuntime(accountId, codes, undefined, ensembleType);
        }
        syncAfter(userId);

        return NextResponse.json({
          success: true,
          message: `${ENSEMBLE_NAMES[ensembleType]} 已启动（自动驾驶待开启）`,
          data: { isRunning: true, isAutoPilot: false, mode: 'ensemble', ensembleType, userId, accountId }
        });
      }

      // ── 自动驾驶开关 ──
      case 'autopilot': {
        const { enabled } = params as { enabled: boolean };

        if (!liveSimulator.isActive()) {
          return NextResponse.json({ success: false, error: '请先启动模拟交易' }, { status: 400 });
        }

        liveSimulator.setAutoPilot(enabled);
        // 同步到磁盘
        const autopilotUserId = await resolveUserId();
        syncAfter(autopilotUserId);
        return NextResponse.json({
          success: true,
          message: enabled
            ? '自动驾驶已开启'
            : '自动驾驶已关闭，转为手动模式',
          data: { isAutoPilot: enabled }
        });
      }

      // ── P0-3 修复：增量追加股票（不重置引擎不重置账户）──
      // 场景：screener 选出 Top N 金股 → 一键追加到运行中的模拟交易
      case 'addCodes': {
        const { codes, strategyType, ensembleType, factorScores } = params as {
          codes: string[];
          strategyType?: 'macd' | 'kdj' | 'ma' | 'bollinger' | 'rsi' | 'factor';
          ensembleType?: 'voting' | 'filter' | 'weighted' | 'dynamic';
          factorScores?: Record<string, number>;
        };

        if (!codes || codes.length === 0) {
          return NextResponse.json({ success: false, error: '请传入 codes' }, { status: 400 });
        }

        const user = await checkInviteCookie();
        const userId = user.invited ? user.username : `guest_${user.username || 'anonymous'}`;
        const accountId = liveSimulator.getAccountId()
          || await simulatorPersistence.findOrCreateAccount(userId, liveSimulator.getAccount().cash);
        liveSimulator.setAccountId(accountId);

        const existingCodes = new Set(liveSimulator.getTradingCodes());
        const addedCodes: string[] = [];
        const skippedCodes: string[] = [];
        for (const code of codes) {
          if (existingCodes.has(code)) {
            skippedCodes.push(code);
            continue;
          }
          if (ensembleType) {
            const ensemble = createPresetEnsemble(ensembleType);
            liveSimulator.addEnsemble(code, ensemble);
          } else {
            const strategy = createSingleStrategy(strategyType || 'factor', factorScores);
            liveSimulator.addStrategy(code, strategy);
          }
          addedCodes.push(code);
        }

        // 如果引擎还没启动就启动
        if (!liveSimulator.isActive()) {
          await liveSimulator.start();
          await dataSourceManager.setActiveSource('akshare');
        } else {
          // 引擎已运行：手动重新触发 K线预加载（让新加的股票有历史数据）
          await liveSimulator.reloadAllHistory();
        }

        // 持久化 runtime 绑定
        if (accountId) {
          const allCodes = liveSimulator.getTradingCodes();
          await simulatorPersistence.updateAccountRuntime(
            accountId, allCodes,
            ensembleType ? undefined : (strategyType || 'factor'),
            ensembleType
          );
        }
        syncAfter(userId);

        return NextResponse.json({
          success: true,
          message: `已追加 ${addedCodes.length} 只${skippedCodes.length > 0 ? `（跳过 ${skippedCodes.length} 只已在池中）` : ''}`,
          data: { addedCodes, skippedCodes, totalCodes: liveSimulator.getTradingCodes().length }
        });
      }

      // ── 停止 ──
      case 'stop': {
        await liveSimulator.stop();
        const stopUserId = await resolveUserId();
        syncAfter(stopUserId);
        return NextResponse.json({ success: true, message: '模拟交易已停止' });
      }

      // ── 重置 ──
      case 'reset': {
        const user = await checkInviteCookie();
        const userId = user.invited ? user.username : `guest_${user.username || 'anonymous'}`;
        const cash = params.initialCash || 1000000;

        const accountId = await simulatorPersistence.findOrCreateAccount(userId, cash);
        if (accountId) {
          await simulatorPersistence.resetAccountData(accountId, cash);
        }

        liveSimulator.reset(cash);
        liveSimulator.setAccountId(accountId);
        syncAfter(userId);

        return NextResponse.json({ success: true, message: '账户已重置' });
      }

      // ── 手动下单 ──
      case 'order': {
        const { code, direction, volume, type, limitPrice } = params as {
          code: string;
          direction: Direction;
          volume: number;
          type: 'market' | 'limit';
          limitPrice?: number;
        };

        if (!code || !direction || !volume) {
          return NextResponse.json({ success: false, error: '参数不完整' }, { status: 400 });
        }

        const order = await liveSimulator.submitOrder(code, direction, type, volume, limitPrice);
        if (order.status === 'filled') {
          const accountId = liveSimulator.getAccountId();
          if (accountId) {
            const positions = liveSimulator.getPositionsForPersist();
            const zeroVolCodes = new Set<string>();
            for (const pos of positions) {
              if (pos.volume === 0) {
                zeroVolCodes.add(pos.code);
              } else {
                await simulatorPersistence.savePosition({ accountId, ...pos });
              }
            }
            for (const code of zeroVolCodes) {
              await simulatorPersistence.removePosition(accountId, code);
            }
            // 成交后：更新账户资金 + 同步到磁盘
            const acc = liveSimulator.getAccount();
            await simulatorPersistence.updateAccountCash(accountId, acc.cash, acc.frozen, acc.totalAssets, acc.totalPnL);
          }
        }
        // 任何下单都同步一次
        const orderUserId = await resolveUserId();
        syncAfter(orderUserId);
        // ── 手动平仓后移出策略池（P1：避免下一 tick 自动驾驶立刻重新建仓）──
        //   语义：用户主动清仓 = 表达"我不想再被自动交易这只票"
        //   触发条件（全部满足）：
        //     1) 手动平仓（方向 short）成交
        //     2) 该 code 当前持仓为 0（即这次真的清光了，不是减仓）
        //     3) 该 code 之前在策略池里（说明原来是自动驾驶/手动加进来的"待交易"标的）
        //   不影响：
        //     · 引擎自己的 short 1.0 清仓（走 this.submitOrder，不经过 API route）
        //     · 风控止损强平（RiskEngine 内部，不经过 API route）
        //     · 减仓未清光（持仓 != 0，跳过）
        if (order.status === 'filled' && direction === 'short') {
          const positions = liveSimulator.getPositionsForPersist();
          const pos = positions.find(p => p.code === code);
          const inPool = liveSimulator.getTradingCodes().includes(code);
          if ((!pos || pos.volume === 0) && inPool) {
            liveSimulator.removeStrategy(code);
            syncAfter(orderUserId); // 移除策略后再同步一次盘
            console.log(`[simulator API] 手动清仓 ${code}，已从策略池移除（自动驾驶不再建仓）`);
          }
        }
        return NextResponse.json({ success: true, data: { order } });
      }

      // ── 实时更新风控设置（速览模式 ⏰ 风险设置面板调用） ──
      case 'updateRisk': {
        const { stopLossPct, takeProfitPct, maxPositionPct, maxTotalPositions, enabled } = params as {
          stopLossPct: number;
          takeProfitPct: number;
          maxPositionPct: number;
          maxTotalPositions: number;
          enabled: boolean;
        };

        // 参数校验（防御性，避免前端 bug 把 liveSimulator 弄崩）
        if (
          typeof stopLossPct !== 'number' || typeof takeProfitPct !== 'number' ||
          typeof maxPositionPct !== 'number' || typeof maxTotalPositions !== 'number' ||
          typeof enabled !== 'boolean'
        ) {
          return NextResponse.json({ success: false, error: '参数类型错误' }, { status: 400 });
        }
        if (stopLossPct > 0 || stopLossPct < -50) {
          return NextResponse.json({ success: false, error: '止损百分比必须在 -50% ~ 0% 之间' }, { status: 400 });
        }
        if (takeProfitPct <= 0 || takeProfitPct > 200) {
          return NextResponse.json({ success: false, error: '止盈百分比必须在 0% ~ 200% 之间' }, { status: 400 });
        }
        if (maxPositionPct <= 0 || maxPositionPct > 100) {
          return NextResponse.json({ success: false, error: '单只最大占比必须在 0% ~ 100% 之间' }, { status: 400 });
        }
        if (maxTotalPositions <= 0 || maxTotalPositions > 50) {
          return NextResponse.json({ success: false, error: '策略池上限必须在 1 ~ 50 只之间' }, { status: 400 });
        }

        // 应用到 liveSimulator（即使没启动也安全：updateRiskSettings 只改阈值，不启停引擎）
        const result = liveSimulator.updateRiskSettings({
          stopLossPct,
          takeProfitPct,
          maxPositionPct,
          maxTotalPositions,
          enabled,
        });

        return NextResponse.json({
          success: true,
          message: `风控已更新：${result.changes.join(' · ')}`,
          data: {
            settings: { stopLossPct, takeProfitPct, maxPositionPct, maxTotalPositions, enabled },
            changes: result.changes,
          }
        });
      }

      default:
        return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('[Simulator API]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ==================== 工厂函数 ====================

function createSingleStrategy(type: string, factorScores?: Record<string, number>) {
  switch (type) {
    case 'kdj':       return new KDJStrategy();
    case 'ma':        return new MAStrategy();
    case 'bollinger': return new BollingerStrategy();
    case 'rsi':       return new RSIStrategy();
    case 'factor': {
      const s = new FactorScoreStrategy({ factorScores: factorScores ?? {} });
      return s;
    }
    default:          return new MACDStrategy();
  }
}

function createPresetEnsemble(type: EnsembleMode): StrategyEnsemble {
  switch (type) {
    case 'voting':   return createVotingEnsemble();
    case 'filter':   return createFilterEnsemble();
    case 'weighted': return createWeightedEnsemble();
    case 'dynamic':  return createDynamicEnsemble();
    default:          return createVotingEnsemble();
  }
}

// ==================== 名称映射 ====================

const STRATEGY_NAMES: Record<string, string> = {
  macd:      'MACD 金叉策略',
  kdj:       'KDJ 超买超卖策略',
  ma:        '均线多头排列策略',
  bollinger: '布林带突破策略',
  rsi:       'RSI 强弱策略',
  factor:    '因子综合评分策略',
};

const ENSEMBLE_NAMES: Record<string, string> = {
  voting:   '投票组合(MACD+KDJ+RSI)',
  filter:   '过滤组合(MACD主策略+RSI过滤)',
  weighted: '加权融合(5策略加权)',
  dynamic:  '动态切换(自适应市场)',
};
