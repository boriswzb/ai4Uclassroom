/**
 * v3.0.2（2026-06-15）— MobileBottomTabBar 移动端底部 Tab Bar
 *
 * 业界标准（参考：Robinhood / Webull / 雪球 / 同花顺 App）：
 *   - 4-5 个核心 tab：今日推荐 / 盯盘 / 交易 / 自动驾驶 / 我
 *   - 中间一个"加号"凸起（业界常见 — 突出"下单"动作）
 *   - iOS safe-area 适配（底部留 34px）
 *   - active tab 用品牌色 + 上方 indicator
 *   - 数字徽章（未读 / 持仓 / 持仓盈亏）
 *
 * 实现策略：
 *   - 通过 scrollIntoView 滚动到对应 section
 *   - 用 hash 路由 / query string 持久化 tab
 *   - 自动适配 `.ai4u-quant-app` 模式（WebView 自动隐藏）
 */

'use client';

import React, { useState, useEffect } from 'react';

type TabId = 'recommendations' | 'watchlist' | 'trading' | 'autopilot' | 'me';

interface Tab {
  id: TabId;
  emoji: string;
  label: string;
  /** Section selector 滚动到 */
  target: string;
  /** 副标签（徽章值） */
  badge?: number | string;
}

const TABS: Tab[] = [
  { id: 'recommendations', emoji: '🎯', label: '推荐', target: 'section-recommendations' },
  { id: 'watchlist', emoji: '📡', label: '盯盘', target: 'section-watchlist' },
  { id: 'trading', emoji: '🟢', label: '交易', target: 'section-trading' },
  { id: 'autopilot', emoji: '🤖', label: 'Auto', target: 'section-autopilot' },
  { id: 'me', emoji: '👤', label: '我', target: 'section-me' },
];

interface Props {
  /** 实时未读 / 持仓数 / 盈亏 数字（可选） */
  recommendationsCount?: number;
  watchlistCount?: number;
  tradingCount?: number;
  autopilotOn?: boolean;
}

export function MobileBottomTabBar({
  recommendationsCount = 0,
  watchlistCount = 0,
  tradingCount = 0,
  autopilotOn = false,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('recommendations');
  const [visible, setVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  // 根据 URL 初始化（支持 ?tab=trading）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const tab = url.searchParams.get('tab') as TabId | null;
    if (tab && TABS.find(t => t.id === tab)) {
      setActiveTab(tab);
      // 滚动到目标
      setTimeout(() => scrollToSection(tab), 100);
    }
  }, []);

  // 滚动监听：向下滑隐藏，向上滑显示（业界标准 Tab Bar 行为）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleScroll = () => {
      const currentY = window.scrollY;
      if (currentY < 100) {
        setVisible(true);
      } else if (currentY > lastScrollY + 10) {
        // 下滑
        setVisible(false);
      } else if (currentY < lastScrollY - 10) {
        // 上滑
        setVisible(true);
      }
      setLastScrollY(currentY);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  const scrollToSection = (id: TabId) => {
    const tab = TABS.find(t => t.id === id);
    if (!tab) return;
    // 优先用 data-section-target
    const el = document.querySelector(`[data-section-target="${id}"]`) ||
               document.querySelector(`#${tab.target}`) ||
               document.querySelector(`.${tab.target}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleClick = (id: TabId) => {
    setActiveTab(id);
    scrollToSection(id);
    // 更新 URL
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', id);
      window.history.replaceState({}, '', url.toString());
    }
  };

  // 角标计算
  const getBadge = (id: TabId): number | string | undefined => {
    if (id === 'recommendations' && recommendationsCount > 0) return recommendationsCount;
    if (id === 'watchlist' && watchlistCount > 0) return watchlistCount;
    if (id === 'trading' && tradingCount > 0) return tradingCount;
    if (id === 'autopilot' && autopilotOn) return '●';
    return undefined;
  };

  return (
    <>
      {/* 移动端 Tab Bar 容器 — 只在窄屏显示 */}
      <nav
        className={`md:hidden fixed left-0 right-0 z-30 bg-slate-900/95 backdrop-blur-md border-t border-slate-700/50 transition-transform duration-300 ${
          visible ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{
          bottom: 0,
          paddingBottom: 'env(safe-area-inset-bottom, 0)',
        }}
        role="navigation"
        aria-label="底部导航"
      >
        <div className="grid grid-cols-5 max-w-screen-sm mx-auto">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const badge = getBadge(tab.id);
            return (
              <button
                key={tab.id}
                onClick={() => handleClick(tab.id)}
                className={`relative flex flex-col items-center justify-center py-2 transition-colors ${
                  isActive ? 'text-cyan-400' : 'text-slate-500'
                }`}
                style={{ minHeight: '56px' /* iOS HIG 最小点击区 */ }}
                aria-label={tab.label}
                aria-current={isActive ? 'page' : undefined}
              >
                {/* 顶部 indicator */}
                {isActive && (
                  <span className="absolute top-0 w-8 h-0.5 bg-cyan-400 rounded-full" />
                )}
                <span className="text-2xl mb-0.5" aria-hidden="true">{tab.emoji}</span>
                <span className="text-[10px] font-medium leading-tight">{tab.label}</span>
                {/* 角标 */}
                {badge !== undefined && (
                  <span
                    className={`absolute top-1 right-1/4 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center ${
                      badge === '●' ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-slate-900'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* 占位：给底部 tab bar 留出空间（避免被覆盖） */}
      <div
        className="md:hidden"
        style={{
          height: 'calc(56px + env(safe-area-inset-bottom, 0))',
        }}
      />
    </>
  );
}