'use client';

import { useState, useRef, useCallback } from 'react';
import type { MediaItem } from '@/lib/media/types';

interface AudioPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
}

/**
 * Inline audio player hook for media cards.
 * Returns audioRef so callers can seek directly.
 * Handles subdirectory-aware URL resolution (window.location.origin fix).
 */
export function useAudioPlayer(item: MediaItem) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<AudioPlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: item.duration || 0,
    volume: 1,
  });
  const [loaded, setLoaded] = useState(false);

  const resolveUrl = useCallback((url: string) => {
    if (!url) return '';
    if (url.startsWith('data:') || url.startsWith('http')) return url;
    if (url.startsWith('/')) return `${window.location.origin}${url}`;
    return url;
  }, []);

  const initAudio = useCallback(() => {
    if (audioRef.current) return;
    const src = resolveUrl(item.mediaUrl);
    if (!src) return;
    audioRef.current = new Audio(src);
    audioRef.current.volume = state.volume;

    audioRef.current.addEventListener('loadedmetadata', () => {
      setLoaded(true);
      setState(s => ({ ...s, duration: audioRef.current!.duration }));
    });
    audioRef.current.addEventListener('timeupdate', () => {
      setState(s => ({ ...s, currentTime: audioRef.current!.currentTime }));
    });
    audioRef.current.addEventListener('ended', () => {
      setState(s => ({ ...s, isPlaying: false, currentTime: 0 }));
    });
    audioRef.current.addEventListener('error', () => {
      setState(s => ({ ...s, isPlaying: false }));
    });
  }, [item.mediaUrl, resolveUrl, state.volume]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) initAudio();
    if (!audioRef.current) return;

    if (state.isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
    setState(s => ({ ...s, isPlaying: !s.isPlaying }));
  }, [state.isPlaying, initAudio]);

  const seek = useCallback((ratio: number) => {
    if (!audioRef.current || !state.duration) return;
    audioRef.current.currentTime = ratio * state.duration;
    setState(s => ({ ...s, currentTime: ratio * state.duration }));
  }, [state.duration]);

  const progress = state.duration > 0 ? state.currentTime / state.duration : 0;

  return { state, loaded, togglePlay, seek, progress, audioRef, initAudio };
}

/** Compact inline player bar for use inside MediaCard */
export function CardAudioBar({
  item,
  compact = false,
}: {
  item: MediaItem;
  compact?: boolean;
}) {
  const { state, progress, togglePlay, seek, loaded } = useAudioPlayer(item);

  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!loaded) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    seek(Math.max(0, Math.min(1, ratio)));
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`flex items-center gap-2 ${compact ? 'px-2 pb-2' : 'p-3'}`}>
      {/* Play button */}
      <button
        onClick={togglePlay}
        className={`shrink-0 rounded-full flex items-center justify-center transition-colors ${
          compact
            ? 'w-8 h-8 bg-white/90 hover:bg-white'
            : 'w-10 h-10 bg-white/90 hover:bg-white shadow-lg'
        }`}
      >
        <span className={`text-slate-900 ${compact ? 'text-sm' : 'text-lg'}`}>
          {state.isPlaying ? '⏸' : '▶'}
        </span>
      </button>

      {/* Waveform progress */}
      <div className="flex-1">
        <div
          onClick={handleBarClick}
          className={`relative bg-slate-700 rounded-full cursor-pointer ${
            compact ? 'h-1' : 'h-1.5'
          }`}
        >
          {/* Filled progress */}
          <div
            className="absolute top-0 left-0 h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${progress * 100}%` }}
          />
          {/* Knob */}
          {loaded && (
            <div
              className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow"
              style={{ left: `calc(${progress * 100}% - 5px)` }}
            />
          )}
        </div>
      </div>

      {/* Time */}
      {!compact && (
        <div className="shrink-0 text-xs text-slate-400 w-12 text-right">
          {loaded ? (
            <>
              {formatTime(state.currentTime)}/{formatTime(state.duration)}
            </>
          ) : (
            '--:--'
          )}
        </div>
      )}
    </div>
  );
}
