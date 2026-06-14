'use client';

import { useState, useRef, useCallback } from 'react';
import type { MediaItem } from '@/lib/media/types';

interface MediaDetailProps {
  item: MediaItem;
  onClose: () => void;
  onDelete: (id: string) => void;
  /** Called when likes or plays count changes (so parent can update its list) */
  onUpdate?: (updated: MediaItem) => void;
}

function formatPlays(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function MediaDetail({ item, onClose, onDelete, onUpdate }: MediaDetailProps) {
  const [localItem, setLocalItem] = useState(item);
  const [isPlaying, setIsPlaying] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [liked, setLiked] = useState(false);
  const [sharing, setSharing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isAudio = localItem.type === 'music' || localItem.type === 'cover';
  const thumbUrl = imgError || !localItem.thumbnail
    ? `https://picsum.photos/seed/${localItem.id}-detail/640/360`
    : localItem.thumbnail;

  /** Resolve any relative media URL to an absolute one for the Audio element */
  const resolveUrl = (url: string) => {
    if (!url) return '';
    if (url.startsWith('data:') || url.startsWith('http')) return url;
    if (url.startsWith('/')) return `${window.location.origin}${url}`;
    return url;
  };

  const togglePlay = useCallback(() => {
    let src = resolveUrl(localItem.mediaUrl);
    if (!src) return;

    if (!audioRef.current) {
      audioRef.current = new Audio(src);
      audioRef.current.addEventListener('ended', () => setIsPlaying(false));
      audioRef.current.addEventListener('error', () => setIsPlaying(false));
    }

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);

    // Increment plays on the server (fire-and-forget)
    fetch(`/api/media/${localItem.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plays: localItem.plays + 1 }),
    }).then(res => res.json()).then((updated: MediaItem) => {
      setLocalItem(updated);
      onUpdate?.(updated);
    }).catch(() => {});
  }, [isPlaying, localItem]);

  const handleLike = async () => {
    if (liked) return;
    const newLikes = localItem.likes + 1;
    setLiked(true);
    setLocalItem(prev => ({ ...prev, likes: newLikes }));
    try {
      const updated: MediaItem = await fetch(`/api/media/${localItem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ likes: newLikes }),
      }).then(r => r.json());
      setLocalItem(updated);
      onUpdate?.(updated);
    } catch {
      setLiked(false);
      setLocalItem(prev => ({ ...prev, likes: newLikes - 1 }));
    }
  };

  const handleShare = async () => {
    setSharing(true);
    const url = `${window.location.origin}/media#${localItem.category}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: localItem.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        alert('链接已复制到剪贴板！');
      }
    } catch {
      // User cancelled or not supported
    } finally {
      setSharing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-3xl bg-slate-900 rounded-2xl shadow-2xl border border-slate-700 overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <span className={`text-xs px-2 py-0.5 rounded ${
              localItem.category === 'ai-music' ? 'bg-blue-600' :
              localItem.category === 'ai-cover' ? 'bg-pink-600' :
              localItem.category === 'ai-video' ? 'bg-orange-600' : 'bg-purple-600'
            } text-white`}>
              {localItem.category === 'ai-music' ? 'AI音乐' :
               localItem.category === 'ai-cover' ? 'AI翻唱' :
               localItem.category === 'ai-video' ? 'AI视频' : 'AI图片'}
            </span>
            {localItem.voiceSource && (
              <span className="text-xs text-slate-400">🎤 {localItem.voiceSource}</span>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Media area */}
          <div className="relative bg-slate-950">
            {isAudio ? (
              <div className="relative">
                <img
                  src={thumbUrl}
                  alt={localItem.title}
                  onError={() => setImgError(true)}
                  className="w-full aspect-video object-cover"
                />
                {/* Play button overlay */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <button
                    onClick={togglePlay}
                    className="w-16 h-16 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-110"
                  >
                    <span className={`text-slate-900 text-2xl ${isPlaying ? '⏸' : '▶'}`} />
                  </button>
                </div>
                <audio ref={audioRef} className="hidden" />
              </div>
            ) : localItem.type === 'video' ? (
              <div className="relative">
                <img
                  src={thumbUrl}
                  alt={localItem.title}
                  onError={() => setImgError(true)}
                  className="w-full aspect-video object-cover"
                />
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <div className="w-16 h-16 bg-white/90 rounded-full flex items-center justify-center">
                    <span className="text-slate-900 text-2xl">▶</span>
                  </div>
                </div>
              </div>
            ) : (
              <img
                src={localItem.mediaUrl || thumbUrl}
                alt={localItem.title}
                onError={() => setImgError(true)}
                className="w-full aspect-video object-contain bg-slate-950"
              />
            )}
          </div>

          {/* Info */}
          <div className="p-6">
            <h2 className="text-xl font-bold text-white mb-2">{localItem.title}</h2>

            <div className="flex items-center gap-4 text-sm text-slate-400 mb-4 flex-wrap">
              <span>👤 {localItem.author}</span>
              <span>📅 {formatDate(localItem.createdAt)}</span>
              <span>▶ {formatPlays(localItem.plays)}播放</span>
              <span>♥ {formatPlays(localItem.likes)}</span>
              {localItem.duration && (
                <span>⏱ {Math.floor(localItem.duration / 60)}:{String(localItem.duration % 60).padStart(2, '0')}</span>
              )}
            </div>

            {/* Description */}
            {localItem.description && (
              <p className="text-slate-300 text-sm mb-4 leading-relaxed">{localItem.description}</p>
            )}

            {/* AI prompt */}
            {localItem.prompt && (
              <div className="bg-slate-800 rounded-lg p-3 mb-4">
                <div className="text-xs text-slate-500 mb-1">AI Prompt</div>
                <p className="text-slate-300 text-xs font-mono">{localItem.prompt}</p>
              </div>
            )}

            {/* Tags */}
            {localItem.tags && localItem.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {localItem.tags.map(tag => (
                  <span key={tag} className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-slate-800 flex gap-3 shrink-0">
          <button
            onClick={handleLike}
            disabled={liked}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              liked
                ? 'bg-pink-600/30 text-pink-400 cursor-default'
                : 'bg-slate-800 hover:bg-slate-700 text-white'
            }`}
          >
            <span>{liked ? '♥' : '♡'}</span>
            <span>{liked ? '已喜欢' : '喜欢'}</span>
            <span className="text-xs opacity-70">({formatPlays(localItem.likes)})</span>
          </button>

          <button
            onClick={handleShare}
            disabled={sharing}
            className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-medium text-white transition-colors flex items-center justify-center gap-2"
          >
            <span>↗</span>
            <span>{sharing ? '复制中...' : '分享'}</span>
          </button>

          <button
            onClick={() => onDelete(localItem.id)}
            className="px-4 py-2 bg-red-900/50 hover:bg-red-800 rounded-lg text-sm text-red-300 transition-colors"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}
