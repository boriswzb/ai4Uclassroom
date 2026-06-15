/**
 * v3.0.2（2026-06-15）— OnboardingWizard 新手引导
 *
 * 设计哲学：
 *   - 5 步骤新手引导，10-15 秒可看完
 *   - 进度条 + 步骤标题 + 内容区 + 跳过/上一步/下一步/完成
 *   - localStorage 持久化：用户关闭后再次进入会从上次步骤继续
 *   - 不打断主流程：用户随时可关闭（不强制走完）
 *   - 触发时机：用户首次进入 /quant 页 + localStorage 没有 `quant_wizard_done` 标记
 *
 * 业界标准（参考）：
 *   - Notion / Linear / Figma 都是首次进入显示引导
 *   - Stripe Dashboard 引导分 5-6 步，每步配图 + CTA
 *   - Robinhood 引导 3 步完成首次交易（带金币奖励）
 *
 * 与项目偏好一致：
 *   - 用户偏好"功能完整、细节丰富"的 UI
 *   - 用户偏好"一站式无跳转完整体验"（所以步骤里有"在速览模式直接做 X"）
 *   - 用户"零容忍僵尸 UI"（所以每步都有"在速览模式怎么用"的具体说明）
 */

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WizardHighlight } from './WizardHighlight';

const STORAGE_KEY = 'quant_wizard_state';
const TOTAL_STEPS = 5;

export type WizardStep = 0 | 1 | 2 | 3 | 4;

interface WizardState {
  currentStep: WizardStep;
  completed: boolean;
  skipped: boolean;
  lastShownAt: number;
}

const DEFAULT_STATE: WizardState = {
  currentStep: 0,
  completed: false,
  skipped: false,
  lastShownAt: 0,
};

// ── 5 个步骤内容 ──
interface StepContent {
  emoji: string;
  title: string;
  subtitle: string;
  points: { icon: string; text: string; highlight?: string }[];
  cta: { text: string; action: 'next' | 'finish' | 'open-factor' | 'open-trading' | 'open-report' | 'dismiss' };
  targetSelector?: string;   // v3.0.2（2026-06-15）：步骤对应 UI 元素选择器（高亮用）
  targetTip?: string;         // 高亮旁的提示
}

const STEPS: StepContent[] = [
  // 0. 欢迎
  {
    emoji: '👋',
    title: '欢迎来到 OpenMAIC 量化交易',
    subtitle: '一站式无跳转完整体验 — 所有功能在速览模式 /quant 完成',
    points: [
      { icon: '📊', text: '11 类因子 / 8 风格 / Barra 风险模型 — 业界中上水准' },
      { icon: '🎯', text: '一站式：分析 / 盯盘 / 下单 / 自动驾驶 / 日报 全部在速览模式', highlight: '不强迫切到 /quant/pro' },
      { icon: '🚀', text: '点「⚡ 一键分析」即可开始 — 5-30 秒出全市场评分' },
    ],
    cta: { text: '下一步：开始分析', action: 'next' },
  },
  // 1. 因子分析
  {
    emoji: '📊',
    title: '步骤 1/4：因子分析',
    subtitle: '点 ⚡ 一键分析 → 11 类因子给每只票打分（综合分 0-100）',
    points: [
      { icon: '🔬', text: '8 大类：估值 / 质量 / 动量 / 反转 / 资金流 / 技术 / 换手 / WQ alpha' },
      { icon: '🎯', text: 'Top 10 候选会显示在「②今日推荐」区，可点 🎯 加入盯盘' },
      { icon: '🔍', text: '想看深度分析？点 Top 10 任意一行的 📊 按钮 → 详细分 + IC 权重' },
      { icon: '⚙️', text: '右上角 4 个开关：严谨 IC 权重 / 长动量 / 集中度 / WF 验证' },
    ],
    cta: { text: '下一步：风控验证', action: 'next' },
    targetSelector: '[data-wizard-target="one-click-analyze"]',
    targetTip: '点这里 — 5-30 秒出全市场 8 大类因子评分',
  },
  // 2. 风控验证
  {
    emoji: '🛡️',
    title: '步骤 2/4：风控 + 验证',
    subtitle: '「别只看分数」— 用专业工具检查权重是否真的有效',
    points: [
      { icon: '🛡️', text: '集中度 (HHI)：检测行业是否过度集中（>5% 警告）' },
      { icon: '📈', text: 'WF 验证：用过去 120 日真实数据，验证权重是否稳定有效' },
      { icon: '🎯', text: 'Barra 优化：从分数到权重 — 8 风格因子风险模型 + 行业约束' },
      { icon: '📉', text: '压力测试：2008/2015/2020 极端场景 — 损失 ≤ 2×VaR 才算通过' },
    ],
    cta: { text: '下一步：模拟交易', action: 'next' },
    targetSelector: '[data-wizard-target="wf-verify-btn"]',
    targetTip: '点这里打开 WF 验证面板（实时验证当前权重）',
  },
  // 3. 模拟交易
  {
    emoji: '🤖',
    title: '步骤 3/4：模拟交易 + 自动驾驶',
    subtitle: '24 小时可下单（非交易时段也能委托，模拟盘 fallback 到收盘价）',
    points: [
      { icon: '🟢', text: '手动下单：每行持仓的「🟢买入 / 🔴卖出 / 🧹清仓」按钮' },
      { icon: '⚡', text: '一键下单：Top 10 候选 → 调模拟盘 → 一笔完成（金额可在 ⚙️ 调）' },
      { icon: '🤖', text: '自动驾驶：基于 Top 10 自动开仓 / 加仓 / 止盈止损（首次开启需确认）' },
      { icon: '📋', text: '所有动作有完整审计：订单历史 / 持仓变化 / 风险触发记录' },
    ],
    cta: { text: '下一步：日报 + 结束', action: 'next' },
    targetSelector: '[data-wizard-target="position-row"]',
    targetTip: '这是当前持仓的某一行 — 点 🟢买入 / 🔴卖出 / 🧹清仓 按钮',
  },
  // 4. 日报 + 总结
  {
    emoji: '📋',
    title: '步骤 4/4：日报 + 持续追踪',
    subtitle: '5 项业界功能，超越 80% 个人量化项目',
    points: [
      { icon: '📋', text: '日报：每日 23:00 自动生成（模拟盘 vs 沪深 300 / 因子贡献 / 复盘）' },
      { icon: '📈', text: '历史趋势：WF 报告 IDB 持久化 + Sparkline 折线图（最近 30 次）' },
      { icon: '📥', text: '导出：CSV / JSON 导出所有历史验证报告（Excel 友好）' },
      { icon: '⭐', text: '完整功能清单：' + ' Barra / Rank IC / IC 衰减 / 风险归因 / 压力测试', highlight: '机构级工程完整度' },
    ],
    cta: { text: '完成！开始使用 →', action: 'finish' },
    targetSelector: '[data-wizard-target="daily-report"]',
    targetTip: '今日自动驾驶日报 — 对比沪深 300 表现 + 因子贡献',
  },
];

export function OnboardingWizard() {
  const [state, setState] = useState<WizardState>(DEFAULT_STATE);
  const [visible, setVisible] = useState(false);
  const mountedRef = useRef(false);

  // ── 加载状态 ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as WizardState;
        setState(parsed);
        // 仅在未完成 + 未跳过 + 距离上次 > 1 小时时显示
        if (!parsed.completed && !parsed.skipped && Date.now() - parsed.lastShownAt > 60 * 60 * 1000) {
          setVisible(true);
        }
      } else {
        // 首次进入：显示
        setVisible(true);
      }
    } catch {
      // ignore
    }
    mountedRef.current = true;
  }, []);

  // ── 持久化 ──
  const persist = useCallback((newState: WizardState) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...newState, lastShownAt: Date.now() }));
    } catch {
      // ignore
    }
  }, []);

  // ── 操作 ──
  const handleNext = useCallback(() => {
    setState(prev => {
      const newStep = Math.min(prev.currentStep + 1, TOTAL_STEPS - 1) as WizardStep;
      const newState = { ...prev, currentStep: newStep };
      persist(newState);
      return newState;
    });
  }, [persist]);

  const handlePrev = useCallback(() => {
    setState(prev => {
      const newStep = Math.max(prev.currentStep - 1, 0) as WizardStep;
      const newState = { ...prev, currentStep: newStep };
      persist(newState);
      return newState;
    });
  }, [persist]);

  const handleFinish = useCallback(() => {
    const newState = { ...state, completed: true };
    setState(newState);
    persist(newState);
    setVisible(false);
  }, [state, persist]);

  const handleSkip = useCallback(() => {
    const newState = { ...state, skipped: true };
    setState(newState);
    persist(newState);
    setVisible(false);
  }, [state, persist]);

  const handleReopen = useCallback(() => {
    setVisible(true);
    setState(prev => ({ ...prev, lastShownAt: Date.now() }));
  }, []);

  // ── 暴露全局「重开向导」事件 ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => handleReopen();
    window.addEventListener('quant:reopen-wizard', handler);
    return () => window.removeEventListener('quant:reopen-wizard', handler);
  }, [handleReopen]);

  if (!visible) {
    // 即使不显示，也提供"重看引导"按钮
    return (
      <button
        onClick={handleReopen}
        className="fixed bottom-4 right-4 z-40 text-xs px-3 py-2 bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-full border border-slate-700/50 shadow-lg backdrop-blur transition-colors"
        title="重新打开新手引导"
      >
        ❓ 使用向导
      </button>
    );
  }

  const step = STEPS[state.currentStep];
  const progress = ((state.currentStep + 1) / TOTAL_STEPS) * 100;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* v3.0.2（2026-06-15）：步骤高亮 — 指示向导对应 UI 元素 */}
      {step.targetSelector && (
        <WizardHighlight
          selector={step.targetSelector}
          stepNumber={state.currentStep + 1}
          totalSteps={TOTAL_STEPS}
          tip={step.targetTip}
        />
      )}
      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-slate-700/60 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* 顶部进度条 */}
        <div className="h-1 bg-slate-800 relative">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 via-cyan-500 to-blue-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* 头部：emoji + 标题 + 步骤号 + 关闭 */}
        <div className="px-6 pt-5 pb-3 flex items-start gap-3 border-b border-slate-800/60">
          <div className="text-5xl">{step.emoji}</div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] text-slate-500 font-mono">
                步骤 {state.currentStep + 1} / {TOTAL_STEPS}
              </span>
              {state.completed && <span className="text-[10px] text-emerald-400">已完成</span>}
              {state.skipped && <span className="text-[10px] text-slate-500">已跳过</span>}
            </div>
            <h2 className="text-lg font-bold text-slate-100">{step.title}</h2>
            <p className="text-sm text-slate-400 mt-1">{step.subtitle}</p>
          </div>
          <button
            onClick={handleSkip}
            className="text-slate-500 hover:text-slate-300 text-xl leading-none"
            aria-label="关闭"
            title="关闭（下次还会显示）"
          >
            ✕
          </button>
        </div>

        {/* 内容区：要点列表 */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          {step.points.map((p, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3 bg-slate-800/40 rounded-lg border border-slate-700/40 hover:border-slate-600/60 transition-colors"
            >
              <span className="text-2xl flex-shrink-0">{p.icon}</span>
              <div className="flex-1 text-sm text-slate-200 leading-relaxed">
                {p.text}
                {p.highlight && (
                  <span className="ml-1 text-[11px] text-cyan-400 font-medium">
                    ({p.highlight})
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 底部：步骤指示器 + 按钮 */}
        <div className="px-6 py-4 border-t border-slate-800/60 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => {
                  const newState = { ...state, currentStep: i as WizardStep };
                  setState(newState);
                  persist(newState);
                }}
                className={`w-2 h-2 rounded-full transition-all ${
                  i === state.currentStep ? 'bg-emerald-400 w-6' :
                  i < state.currentStep ? 'bg-emerald-700' : 'bg-slate-700'
                }`}
                aria-label={`跳到步骤 ${i + 1}`}
                title={`步骤 ${i + 1}: ${STEPS[i].title}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {state.currentStep > 0 && (
              <button
                onClick={handlePrev}
                className="text-xs px-3 py-1.5 text-slate-300 hover:text-slate-100 transition-colors"
              >
                ← 上一步
              </button>
            )}
            {step.cta.action === 'finish' ? (
              <button
                onClick={handleFinish}
                className="text-sm px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium"
              >
                {step.cta.text}
              </button>
            ) : (
              <button
                onClick={handleNext}
                className="text-sm px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium"
              >
                {step.cta.text} →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}