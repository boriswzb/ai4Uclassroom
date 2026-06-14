'use client';

import { useState } from 'react';
import type { MediaItem } from '@/lib/media/types';
import { useAudioPlayer } from './audio-player';

interface MediaCardProps {
  item: MediaItem;
  onClick: () => void;
}

function formatPlays(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function CategoryBadge({ category }: { category: string }) {
  const map: Record<string, { label: string; color: string }> = {
    'ai-music':    { label: 'AI音乐', color: 'bg-blue-600' },
    'ai-cover':    { label: 'AI翻唱', color: 'bg-pink-600' },
    'ai-image':    { label: 'AI图片', color: 'bg-purple-600' },
    'ai-video':    { label: 'AI视频', color: 'bg-orange-600' },
  };
  const { label, color } = map[category] ?? { label: category, color: 'bg-slate-600' };
  return (
    <span className={`${color} text-white text-xs px-1.5 py-0.5 rounded`}>
      {label}
    </span>
  );
}

/** Video thumbnail with a permanent centered play-icon overlay */
function VideoThumbOverlay({ thumbnail, title }: { thumbnail: string; title: string }) {
  const [imgError, setImgError] = useState(false);
  return (
    <div className="relative w-full h-full">
      <img
        src={imgError ? `https://picsum.photos/seed/${title}/640/360` : thumbnail}
        alt={title}
        onError={() => setImgError(true)}
        className="w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
        <div className="w-14 h-14 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
          <span className="text-slate-900 text-xl ml-1">▶</span>
        </div>
      </div>
    </div>
  );
}

export default function MediaCard({ item, onClick }: MediaCardProps) {
  const [imgError, setImgError] = useState(false);

  const isAudio = item.type === 'music' || item.type === 'cover';
  const isVideo = item.type === 'video';
  const thumbUrl = imgError || !item.thumbnail
    ? `https://picsum.photos/seed/${item.id}/320/180`
    : item.thumbnail;

  // audioRef is returned so we can seek without importing the ref directly
  const { state: playerState, togglePlay, progress, loaded, audioRef, initAudio } = useAudioPlayer(item);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!loaded) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    // If audio not yet created, create it first then seek
    if (!audioRef.current) {
      initAudio();
      // After initAudio(), audioRef.current will exist; seek after short delay
      setTimeout(() => {
        if (audioRef.current && playerState.duration > 0) {
          audioRef.current.currentTime = ratio * playerState.duration;
        }
      }, 50);
      return;
    }
    if (playerState.duration > 0) {
      audioRef.current.currentTime = ratio * playerState.duration;
    }
  };

  return (
    <div
      className="group bg-slate-900 rounded-xl overflow-hidden cursor-pointer hover:bg-slate-800 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/50 flex flex-col"
      onClick={onClick}
    >
      {/* ── Thumbnail / cover ── */}
      <div className="relative aspect-video bg-slate-800 overflow-hidden flex-shrink-0">
        {isVideo ? (
          <VideoThumbOverlay thumbnail={thumbUrl} title={item.id} />
        ) : (
          <>
            <img
              src={thumbUrl}
              alt={item.title}
              onError={() => setImgError(true)}
              className="w-full h-full object-cover"
            />
            {/* Hover play overlay — hidden for audio items (they have inline player) */}
            {!isAudio && (
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div className="w-12 h-12 bg-white/90 rounded-full flex items-center justify-center">
                  <span className="text-slate-900 text-lg">▶</span>
                </div>
              </div>
            )}
          </>
        )}

        {/* Category badge */}
        <div className="absolute top-2 left-2">
          <CategoryBadge category={item.category} />
        </div>

        {/* Voice source — cover items */}
        {item.voiceSource && (
          <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-0.5 rounded">
            🎤 {item.voiceSource}
          </div>
        )}

        {/* Duration */}
        {item.duration && !isVideo && (
          <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
            {Math.floor(item.duration / 60)}:{String(item.duration % 60).padStart(2, '0')}
          </div>
        )}
        {isVideo && item.duration && (
          <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
            {item.duration}s
          </div>
        )}

        {/* Plays */}
        <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
          <span>▶</span>
          <span>{formatPlays(item.plays)}</span>
        </div>
      </div>

      {/* ── Inline audio player bar — music / cover only ── */}
      {isAudio && (
        <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5 bg-slate-900/60">
          <button
            onClick={(e) => { e.stopPropagation(); togglePlay(); }}
            className="shrink-0 w-7 h-7 bg-white/90 hover:bg-white rounded-full flex items-center justify-center transition-colors"
          >
            <span className="text-slate-900 text-xs">
              {playerState.isPlaying ? '⏸' : '▶'}
            </span>
          </button>

          {/* Seekable mini progress bar */}
          <div
            className="flex-1 h-1 bg-slate-700 rounded-full cursor-pointer relative"
            onClick={handleSeek}
          >
            <div
              className="h-full bg-blue-500 rounded-full transition-all"
              style={{
                width: playerState.duration > 0
                  ? `${(playerState.currentTime / playerState.duration) * 100}%`
                  : '0%',
              }}
            />
          </div>

          <span className="shrink-0 text-slate-500 text-xs">
            {loaded ? `${Math.floor(playerState.currentTime)}s` : '--'}
          </span>
        </div>
      )}

      {/* ── Info ── */}
      <div className="p-3 flex-1">
        <h3 className="text-white text-sm font-medium truncate mb-1">{item.title}</h3>
        <div className="flex items-center justify-between">
          <span className="text-slate-500 text-xs">{item.author}</span>
          <div className="flex items-center gap-3 text-slate-500 text-xs">
            <span>♥ {formatPlays(item.likes)}</span>
          </div>
        </div>
        {item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {item.tags.slice(0, 3).map(tag => (
              <span key={tag} className="text-xs bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
