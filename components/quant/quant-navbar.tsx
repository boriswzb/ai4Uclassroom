'use client';

import { UserIdentityBadge } from './user-identity-badge';
import Link from 'next/link';

type TabType = 'backtest' | 'factor-portfolio' | 'simulator' | 'monitor' | 'strategies' | 'data' | 'ai' | 'downloads' | 'factor-analysis' | 'screener' | 'home';

const TABS: { id: TabType; label: string; icon: string; href: string }[] = [
  { id: 'home',            label: '首页',    icon: '🏠',   href: '/quant' },
  { id: 'screener',        label: '智能选股', icon: '🎯',   href: '/quant#screener' },
  { id: 'factor-analysis', label: '因子研究', icon: '📊',   href: '/quant/factor-analysis-v2' },
  { id: 'factor-portfolio', label: '组合回测', icon: '🎲', href: '/quant#factor-portfolio' },
  { id: 'backtest',       label: '个股回测', icon: '📈',   href: '/quant#backtest' },
  { id: 'monitor',        label: '盯盘',    icon: '📡',   href: '/quant#monitor' },
  { id: 'simulator',      label: '交易',    icon: '🎮',   href: '/quant#simulator' },
  { id: 'data',           label: '行情',    icon: '📁',   href: '/quant#data' },
  { id: 'strategies',     label: '策略',    icon: '⚙️',   href: '/quant#strategies' },
  { id: 'ai',             label: 'AI助手',  icon: '🤖',   href: '/quant#ai' },
  { id: 'downloads',      label: '下载',    icon: '📦',   href: '/quant/downloads' },
];

interface QuantNavbarProps {
  activeTab?: TabType;
}

export default function QuantNavbar({ activeTab }: QuantNavbarProps) {
  return (
    <>
      {/* 头部 */}
      <header className="bg-slate-900 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/quant-logo.svg" alt="AI4U量化交易系统" className="h-8 w-auto" />
            <span className="text-xs px-2 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-800">🔧 专业模式</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/quant"
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 hover:border-amber-500 hover:text-amber-400 text-slate-300 transition-colors flex items-center gap-1"
              title="切到速览模式（一页式简洁界面）"
            >
              ⚡ 速览模式
            </Link>
            <UserIdentityBadge />
          </div>
        </div>
      </header>

      {/* 导航 */}
      <nav className="bg-slate-900 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto scrollbar-none">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;

              const isFactorAnalysis = tab.id === 'factor-analysis';
              const handleClick = () => {
                if (isFactorAnalysis) {
                  // 因子研究是独立页面，不走 hash 路由
                  window.location.href = tab.href;
                } else {
                  // 需要回到 /quant 主页面再切 hash（factor-analysis 是独立路径）
                  if (window.location.pathname !== '/quant') {
                    window.location.href = `/quant#${tab.id}`;
                  } else {
                    window.location.hash = tab.id;
                  }
                }
              };

              return (
                <button
                  key={tab.id}
                  onClick={handleClick}
                  className={`py-3 px-3 border-b-2 text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                    isActive
                      ? 'border-blue-400 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
}
