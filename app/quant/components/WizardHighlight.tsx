/**
 * v3.0.2（2026-06-15）— WizardHighlight 向导高亮覆盖层
 *
 * 用途：向导某步骤时，把对应 UI 元素高亮（pulse + scrollIntoView）
 *
 * 业界标准（Notion/Linear/Figma）：
 *   - 高亮区域 = 浏览器原生 pulse animation
 *   - 顶部加 "步骤 X" 标记牌
 *   - 点击高亮外区域不响应（强制用户聚焦）
 *
 * 关键：实时算位置（因为 UI 可能 resize/scroll）
 *   - ResizeObserver + scroll listener
 *   - 位置变化时立即更新
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';

interface WizardHighlightProps {
  selector: string;  // CSS selector（如 '.one-click-analyze-btn'）
  stepNumber: number;
  totalSteps: number;
  tip?: string;       // 高亮旁的提示文字
}

export function WizardHighlight({ selector, stepNumber, totalSteps, tip }: WizardHighlightProps) {
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [found, setFound] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined' || !selector) return;

    const update = () => {
      const el = document.querySelector(selector);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({
          top: r.top + window.scrollY,
          left: r.left + window.scrollX,
          width: r.width,
          height: r.height,
        });
        setFound(true);
        // 滚到可视范围（如果不在）
        if (r.top < 0 || r.bottom > window.innerHeight) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else {
        setFound(false);
      }
    };

    update();
    const intervalId = setInterval(update, 500);  // 0.5s 检查一次（适应动态 UI）
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);

    return () => {
      clearInterval(intervalId);
      ro.disconnect();
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [selector]);

  if (!rect) {
    return found ? null : (
      <div className="fixed top-20 right-4 z-50 bg-amber-900/90 border border-amber-500/50 text-amber-200 px-3 py-2 rounded text-xs shadow-lg">
        ⚠️ 找不到目标元素 <code className="bg-amber-950/50 px-1 rounded">{selector}</code>
        <div className="text-[10px] mt-1 text-amber-300/80">请先到对应页面（可能在「②今日推荐」/「④模拟交易」）</div>
      </div>
    );
  }

  return (
    <>
      {/* 4 边框高亮 */}
      <div
        className="fixed pointer-events-none z-40 rounded-lg"
        style={{
          top: rect.top - window.scrollY - 6,
          left: rect.left - 6,
          width: rect.width + 12,
          height: rect.height + 12,
          border: '2px solid rgb(245, 158, 11)',
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55), 0 0 30px rgba(245, 158, 11, 0.6)',
          animation: 'pulse 1.5s ease-in-out infinite',
        }}
      />
      {/* 顶部「步骤 X」标记牌 */}
      <div
        className="fixed z-40 pointer-events-none"
        style={{
          top: rect.top - window.scrollY - 36,
          left: rect.left,
        }}
      >
        <div className="bg-amber-500 text-slate-900 text-[11px] font-bold px-2 py-0.5 rounded shadow-lg">
          步骤 {stepNumber} / {totalSteps}
        </div>
      </div>
      {/* 提示气泡（在元素下方） */}
      {tip && (
        <div
          className="fixed z-40 pointer-events-none max-w-xs"
          style={{
            top: rect.top - window.scrollY + rect.height + 10,
            left: rect.left,
          }}
        >
          <div className="bg-slate-900/95 border border-amber-500/40 text-amber-200 text-xs px-3 py-2 rounded shadow-xl backdrop-blur">
            💡 {tip}
          </div>
        </div>
      )}
      {/* pulse 动画样式 */}
      <style jsx>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.02); opacity: 0.85; }
        }
      `}</style>
    </>
  );
}