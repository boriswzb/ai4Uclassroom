'use client';

import { useState, useEffect, useCallback } from 'react';
import MediaNavbar from '@/components/media/media-navbar';
import GalleryGrid from '@/components/media/gallery-grid';
import UploadPanel from '@/components/media/upload-panel';
import MediaDetail from '@/components/media/media-detail';
import GeneratePanel from '@/components/media/generate-panel';
import type { MediaItem } from '@/lib/media/types';

export default function MediaPage() {
  const [activeTab, setActiveTab] = useState('recommend');
  const [searchQuery, setSearchQuery] = useState('');
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);

  // Hash 路由同步
  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash) setActiveTab(hash);
    };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // 切换 Tab
  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab);
    window.location.hash = tab;
    setSelectedMedia(null);
  }, []);

  // 加载数据
  const fetchMedia = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeTab !== 'recommend') params.set('category', activeTab);
      if (searchQuery) params.set('search', searchQuery);
      const res = await fetch(`/api/media?${params}`);
      const data = await res.json();
      setMediaList(data.items || []);
    } catch {
      setMediaList([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab, searchQuery]);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  // 搜索
  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
  }, []);

  // 上传成功
  const handleUploadSuccess = useCallback(() => {
    setShowUpload(false);
    fetchMedia();
  }, [fetchMedia]);

  // AI生成成功
  const handleGenerateSuccess = useCallback((item: MediaItem) => {
    setShowGenerate(false);
    // 新生成的作品插入列表顶部
    setMediaList(prev => [item, ...prev]);
  }, []);

  // 删除
  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('确定删除？')) return;
    await fetch(`/api/media/${id}`, { method: 'DELETE' });
    setSelectedMedia(null);
    fetchMedia();
  }, [fetchMedia]);

  // 点赞/播放数更新同步回列表
  const handleMediaUpdate = useCallback((updated: MediaItem) => {
    setMediaList(prev => prev.map(i => i.id === updated.id ? updated : i));
    setSelectedMedia(updated);
  }, []);

  const tabs = [
    { id: 'recommend', label: '推荐', icon: '🎵' },
    { id: 'ai-music', label: 'AI音乐', icon: '🎹' },
    { id: 'ai-cover', label: 'AI翻唱', icon: '🎤' },
    { id: 'ai-image', label: 'AI图片', icon: '🖼️' },
    { id: 'ai-video', label: 'AI视频', icon: '🎬' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* 顶部导航 */}
      <MediaNavbar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onSearch={handleSearch}
        onUpload={() => setShowUpload(true)}
        onGenerate={() => setShowGenerate(true)}
      />

      {/* 主内容 */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* 标签页头 */}
        <div className="flex items-center gap-1 mb-6">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* 搜索结果提示 */}
        {searchQuery && (
          <div className="mb-4 text-slate-400 text-sm">
            搜索 "{searchQuery}" — 找到 {mediaList.length} 个结果
            <button onClick={() => setSearchQuery('')} className="ml-2 text-blue-400 hover:underline">清除</button>
          </div>
        )}

        {/* 内容网格 */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-slate-800 rounded-xl animate-pulse aspect-video" />
            ))}
          </div>
        ) : mediaList.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <div className="text-5xl mb-4">🎵</div>
            <p className="text-lg">暂无内容</p>
            <p className="text-sm mt-1">成为第一个上传者吧！</p>
            <button
              onClick={() => setShowUpload(true)}
              className="mt-4 px-4 py-2 bg-blue-600 rounded-lg text-sm hover:bg-blue-700 transition-colors"
            >
              上传作品
            </button>
          </div>
        ) : (
          <GalleryGrid
            items={mediaList}
            onItemClick={setSelectedMedia}
          />
        )}
      </main>

      {/* 上传面板 */}
      {showUpload && (
        <UploadPanel
          onClose={() => setShowUpload(false)}
          onSuccess={handleUploadSuccess}
        />
      )}

      {/* AI生成面板 */}
      {showGenerate && (
        <GeneratePanel
          onClose={() => setShowGenerate(false)}
          onSuccess={handleGenerateSuccess}
        />
      )}

      {/* 详情弹窗 */}
      {selectedMedia && (
        <MediaDetail
          item={selectedMedia}
          onClose={() => setSelectedMedia(null)}
          onDelete={handleDelete}
          onUpdate={handleMediaUpdate}
        />
      )}
    </div>
  );
}
