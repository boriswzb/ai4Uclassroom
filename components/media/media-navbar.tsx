'use client';

import { useState, useEffect } from 'react';
import type { MediaItem } from '@/lib/media/types';

const TABS = [
  { id: 'recommend', label: '推荐', icon: '🎵' },
  { id: 'ai-music', label: 'AI音乐', icon: '🎹' },
  { id: 'ai-cover', label: 'AI翻唱', icon: '🎤' },
  { id: 'ai-image', label: 'AI图片', icon: '🖼️' },
  { id: 'ai-video', label: 'AI视频', icon: '🎬' },
];

interface MediaNavbarProps {
  tabs?: typeof TABS;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onSearch: (q: string) => void;
  onUpload: () => void;
  onGenerate?: () => void;
}

export default function MediaNavbar({
  tabs = TABS,
  activeTab,
  onTabChange,
  onSearch,
  onUpload,
  onGenerate,
}: MediaNavbarProps) {
  const [search, setSearch] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(search);
  };

  return (
    <div className="sticky top-0 z-40 bg-slate-950/95 backdrop-blur border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center gap-4 h-14">
          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-blue-500 text-lg">🎵</span>
            <span className="font-bold text-white text-sm">AI4U 多媒体</span>
          </div>

          {/* 标签 */}
          <div className="flex items-center gap-1 overflow-x-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <span className="mr-1">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* 搜索 */}
          <form onSubmit={handleSearch} className="flex-1 max-w-xs ml-auto">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索音乐/翻唱/图片..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </form>

          {/* 上传按钮 */}
          <button
            onClick={onUpload}
            className="shrink-0 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
          >
            <span>⬆</span>
            <span>上传</span>
          </button>

          {/* AI创作按钮 */}
          {onGenerate && (
            <button
              onClick={onGenerate}
              className="shrink-0 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
            >
              <span>✨</span>
              <span>AI创作</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
