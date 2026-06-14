'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useSettingsStore } from '@/lib/store/settings';
import type { ImageProviderId, MediaItem, VideoProviderId } from '@/lib/media/types';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import { createLogger } from '@/lib/logger';

const log = createLogger('GeneratePanel');

interface GeneratePanelProps {
  defaultTab?: 'image' | 'music' | 'video';
  onClose: () => void;
  /** Called after successful generation + gallery save */
  onSuccess: (item: MediaItem) => void;
}

type GenStatus = 'idle' | 'generating' | 'done' | 'error';

const IMAGE_ASPECT_RATIOS = ['1:1', '16:9', '4:3', '9:16'] as const;
const VIDEO_ASPECT_RATIOS = ['16:9', '1:1', '9:16'] as const;

const IMAGE_STYLES = [
  'auto', '摄影', '写实', '插画', '动漫', '3D渲染', '油画', '水彩', '素描', '国风', '赛博朋克'
];

const MUSIC_GENRES = ['流行', '电子', '摇滚', '古典', '爵士', '民谣', '说唱', 'R&B', '国风', '轻音乐'] as const;
const MUSIC_VOICES = [
  { id: 'male-qn-qingyij', name: '清隽 (男声)' },
  { id: 'female-tian-mei', name: '甜美 (女声)' },
  { id: 'male-qn-jiping', name: '激情 (男声)' },
  { id: 'female-qn-buling', name: '嘹亮 (女声)' },
];

export default function GeneratePanel({ defaultTab = 'image', onClose, onSuccess }: GeneratePanelProps) {
  const [tab, setTab] = useState<'image' | 'music' | 'video'>(defaultTab);

  // ── Image generation state ────────────────────────────────────────────────
  const [imgPrompt, setImgPrompt] = useState('');
  const [imgNegativePrompt, setImgNegativePrompt] = useState('');
  const [imgAspectRatio, setImgAspectRatio] = useState<string>('1:1');
  const [imgStyle, setImgStyle] = useState('auto');
  const [imgProviderId, setImgProviderId] = useState<ImageProviderId>('seedream');
  const [imgStatus, setImgStatus] = useState<GenStatus>('idle');
  const [imgProgress, setImgProgress] = useState('');
  const [imgError, setImgError] = useState('');
  const [imgPreviewUrl, setImgPreviewUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Music generation state ──────────────────────────────────────────────────
  const [musicPrompt, setMusicPrompt] = useState('');
  const [musicGenre, setMusicGenre] = useState('');
  const [musicVoice, setMusicVoice] = useState('male-qn-qingyij');
  const [musicModel, setMusicModel] = useState('speech-02-hd');
  const [musicStatus, setMusicStatus] = useState<GenStatus>('idle');
  const [musicError, setMusicError] = useState('');
  const [musicProgress, setMusicProgress] = useState('');
  const [musicPreviewUrl, setMusicPreviewUrl] = useState<string | null>(null);
  const musicAbortRef = useRef<AbortController | null>(null);

  // ── Video generation state ───────────────────────────────────────────────────
  const [vidPrompt, setVidPrompt] = useState('');
  const [vidAspectRatio, setVidAspectRatio] = useState<string>('16:9');
  const [vidDuration, setVidDuration] = useState<number>(5);
  const [vidProviderId, setVidProviderId] = useState<string>('kling');
  const [vidModelId, setVidModelId] = useState<string>('kling-v2-6');
  const [vidStatus, setVidStatus] = useState<GenStatus>('idle');
  const [vidProgress, setVidProgress] = useState('');
  const [vidError, setVidError] = useState('');
  const [vidPreviewUrl, setVidPreviewUrl] = useState<string | null>(null);
  const vidAbortRef = useRef<AbortController | null>(null);

  const settings = useSettingsStore();
  const imgProviders = Object.values(IMAGE_PROVIDERS);
  const vidProviders = Object.values(VIDEO_PROVIDERS);

  // ── Image generation ────────────────────────────────────────────────────────
  const handleGenerateImage = useCallback(async () => {
    if (!imgPrompt.trim()) {
      setImgError('请输入图片描述');
      return;
    }

    setImgError('');
    setImgStatus('generating');
    setImgPreviewUrl(null);
    setImgProgress('正在连接AI绘图服务...');
    abortRef.current = new AbortController();

    try {
      const providerConfig = settings.imageProvidersConfig?.[imgProviderId];
      const apiKey = providerConfig?.apiKey || '';
      const baseUrl = providerConfig?.baseUrl || '';

      setImgProgress('正在生成图片，请稍候...');

      const response = await fetch('/api/generate/image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-image-provider': imgProviderId,
          'x-image-model': settings.imageModelId || '',
          'x-api-key': apiKey,
          'x-base-url': baseUrl,
        },
        body: JSON.stringify({
          prompt: imgPrompt.trim(),
          negativePrompt: imgNegativePrompt.trim() || undefined,
          aspectRatio: imgAspectRatio as any,
          style: imgStyle !== 'auto' ? imgStyle : undefined,
        }),
        signal: abortRef.current.signal,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || `生成失败 (${response.status})`);
      }

      const resultUrl = data.result?.url || data.result?.base64;
      if (!resultUrl) throw new Error('API未返回图片地址');

      setImgPreviewUrl(resultUrl.startsWith('data:') ? resultUrl : resultUrl);
      setImgStatus('done');
      setImgProgress('生成完成！');

      // Auto-save to gallery
      await saveImageToGallery(resultUrl, data.result);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setImgStatus('idle');
        setImgProgress('');
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setImgError(msg);
      setImgStatus('error');
      setImgProgress('');
      log.error('Image generation failed:', msg);
    }
  }, [imgPrompt, imgNegativePrompt, imgAspectRatio, imgStyle, imgProviderId, settings]);

  const handleCancelImage = () => {
    abortRef.current?.abort();
    setImgStatus('idle');
    setImgProgress('');
  };

  const saveImageToGallery = async (url: string, result: any) => {
    try {
      let blob: Blob;

      if (url.startsWith('data:')) {
        // data: URI — convert directly without proxy
        const res = await fetch(url);
        blob = await res.blob();
      } else {
        // Remote URL — must proxy through server to bypass CORS
        const res = await fetch('/api/proxy-media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        if (!res.ok) throw new Error('Failed to fetch generated image');
        blob = await res.blob();
      }

      // Build a FormData to POST to /api/media
      const id = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const formData = new FormData();
      formData.append('title', imgPrompt.slice(0, 60));
      formData.append('description', `AI生成 · ${IMAGE_PROVIDERS[imgProviderId]?.name || imgProviderId}`);
      formData.append('category', 'ai-image');
      formData.append('prompt', imgPrompt);
      formData.append('tags', `${imgStyle !== 'auto' ? imgStyle : 'AI生成'},${imgAspectRatio}`);
      formData.append('file', blob, `generated-${id}.png`);

      const res = await fetch('/api/media', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Failed to save to gallery');
      const savedItem = await res.json();
      onSuccess(savedItem);
    } catch (err) {
      log.error('Failed to save generated image to gallery:', err);
    }
  };

  // ── Music generation ─────────────────────────────────────────────────────────
  const handleGenerateMusic = useCallback(async () => {
    if (!musicPrompt.trim()) {
      setMusicError('请输入音乐描述');
      return;
    }

    setMusicError('');
    setMusicStatus('generating');
    setMusicPreviewUrl(null);
    setMusicProgress('正在连接音乐生成服务...');
    musicAbortRef.current = new AbortController();

    try {
      const providerConfig = settings.audioProvidersConfig?.['minimax-tts'];
      const apiKey = providerConfig?.apiKey || '';

      setMusicProgress('正在生成音乐，请稍候...');

      const response = await fetch('/api/generate/music', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          prompt: musicPrompt.trim(),
          model: musicModel,
          voice: musicVoice,
          genre: musicGenre || undefined,
        }),
        signal: musicAbortRef.current.signal,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || `生成失败 (${response.status})`);
      }

      // Convert base64 to data URI for audio playback
      const b64 = data.result?.base64;
      const format = data.result?.format || 'mp3';
      const audioDataUri = `data:audio/${format};base64,${b64}`;

      setMusicPreviewUrl(audioDataUri);
      setMusicStatus('done');
      setMusicProgress('生成完成！');

      // Auto-save to gallery
      await saveMusicToGallery(audioDataUri, data.result);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setMusicStatus('idle');
        setMusicProgress('');
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setMusicError(msg);
      setMusicStatus('error');
      setMusicProgress('');
      log.error('Music generation failed:', msg);
    }
  }, [musicPrompt, musicModel, musicVoice, musicGenre, settings]);

  const handleCancelMusic = () => {
    musicAbortRef.current?.abort();
    setMusicStatus('idle');
    setMusicProgress('');
  };

  const saveMusicToGallery = async (dataUri: string, result: any) => {
    try {
      // Convert data URI to blob
      const res = await fetch(dataUri);
      const blob = await res.blob();

      const id = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const formData = new FormData();
      formData.append('title', musicPrompt.slice(0, 60));
      formData.append('description', `AI音乐生成 · ${musicGenre || '通用风格'}`);
      formData.append('category', 'ai-music');
      formData.append('prompt', musicPrompt);
      formData.append('tags', `${musicGenre || 'AI音乐'},${musicModel}`);
      formData.append('file', blob, `generated-${id}.mp3`);

      const res2 = await fetch('/api/media', { method: 'POST', body: formData });
      if (!res2.ok) throw new Error('Failed to save to gallery');
      const savedItem = await res2.json();
      onSuccess(savedItem);
    } catch (err) {
      log.error('Failed to save generated music to gallery:', err);
    }
  };

  const isGenerating = imgStatus === 'generating' || musicStatus === 'generating' || vidStatus === 'generating';

  // ── Video generation ────────────────────────────────────────────────────────
  const handleGenerateVideo = useCallback(async () => {
    if (!vidPrompt.trim()) {
      setVidError('请输入视频描述');
      return;
    }
    setVidError('');
    setVidStatus('generating');
    setVidPreviewUrl(null);
    setVidProgress('正在生成视频（可能需要数分钟）...');
    vidAbortRef.current = new AbortController();

    try {
      const providerConfig = settings.videoProvidersConfig?.[vidProviderId as keyof typeof settings.videoProvidersConfig];
      const apiKey = providerConfig?.apiKey || '';
      const baseUrl = providerConfig?.baseUrl || '';

      setVidProgress('已提交视频生成任务，等待结果...');

      const response = await fetch('/api/generate/video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-video-provider': vidProviderId,
          'x-video-model': vidModelId,
          'x-api-key': apiKey,
          'x-base-url': baseUrl,
        },
        body: JSON.stringify({
          prompt: vidPrompt.trim(),
          aspectRatio: vidAspectRatio as any,
          duration: vidDuration,
        }),
        signal: vidAbortRef.current.signal,
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || `生成失败 (${response.status})`);
      }

      const resultUrl = data.result?.url;
      if (!resultUrl) throw new Error('API未返回视频地址');

      setVidPreviewUrl(resultUrl);
      setVidStatus('done');
      setVidProgress('生成完成！');

      // Auto-save to gallery
      await saveVideoToGallery(resultUrl, data.result);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setVidStatus('idle');
        setVidProgress('');
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setVidError(msg);
      setVidStatus('error');
      setVidProgress('');
      log.error('Video generation failed:', msg);
    }
  }, [vidPrompt, vidAspectRatio, vidDuration, vidProviderId, vidModelId, settings]);

  const handleCancelVideo = () => {
    vidAbortRef.current?.abort();
    setVidStatus('idle');
    setVidProgress('');
  };

  const saveVideoToGallery = async (url: string, result: any) => {
    try {
      const res = await fetch('/api/proxy-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) throw new Error('Failed to fetch video');
      const blob = await res.blob();

      const id = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const formData = new FormData();
      formData.append('title', vidPrompt.slice(0, 60));
      formData.append('description', `AI视频生成 · ${vidProviders.find(p => p.id === vidProviderId)?.name || vidProviderId}`);
      formData.append('category', 'ai-video');
      formData.append('prompt', vidPrompt);
      formData.append('tags', `AI视频,${vidAspectRatio},${vidDuration}秒`);
      formData.append('file', blob, `generated-${id}.mp4`);

      const res2 = await fetch('/api/media', { method: 'POST', body: formData });
      if (!res2.ok) throw new Error('Failed to save to gallery');
      const savedItem = await res2.json();
      onSuccess(savedItem);
    } catch (err) {
      log.error('Failed to save generated video to gallery:', err);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 px-4 bg-black/70 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl bg-slate-900 rounded-2xl shadow-2xl border border-slate-700 overflow-hidden max-h-[88vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold text-white">AI创作中心</h2>
            <div className="flex gap-1">
              {(['image', 'music', 'video'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                    tab === t ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {t === 'image' ? '🖼️ AI绘图' : t === 'music' ? '🎵 AI音乐' : '🎬 AI视频'}
                </button>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── Image Tab ─────────────────────────────────────────────────── */}
          {tab === 'image' && (
            <div className="space-y-5">
              {/* Provider */}
              <div>
                <label className="block text-sm text-slate-400 mb-2">绘图引擎</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {imgProviders.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setImgProviderId(p.id as ImageProviderId)}
                      className={`px-3 py-2 rounded-lg text-sm border transition-colors text-left ${
                        imgProviderId === p.id
                          ? 'bg-blue-600/20 border-blue-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {p.models[0]?.name || p.id}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Prompt */}
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  图片描述 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={imgPrompt}
                  onChange={e => setImgPrompt(e.target.value)}
                  placeholder="描述你想要生成的图片内容..."
                  rows={3}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
                  maxLength={500}
                  disabled={imgStatus === 'generating'}
                />
                <div className="text-right text-xs text-slate-500 mt-1">{imgPrompt.length}/500</div>
              </div>

              {/* Negative Prompt */}
              <details className="group">
                <summary className="text-sm text-slate-500 cursor-pointer hover:text-slate-400 list-none flex items-center gap-1">
                  <span className="text-xs group-open:hidden">▶</span>
                  <span className="text-xs hidden group-open:inline">▼</span>
                  高级选项：反向提示词
                </summary>
                <div className="mt-2">
                  <textarea
                    value={imgNegativePrompt}
                    onChange={e => setImgNegativePrompt(e.target.value)}
                    placeholder="不希望出现的元素..."
                    rows={2}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 resize-none"
                    disabled={imgStatus === 'generating'}
                  />
                </div>
              </details>

              {/* Aspect Ratio */}
              <div>
                <label className="block text-sm text-slate-400 mb-2">图片比例</label>
                <div className="flex gap-2 flex-wrap">
                  {IMAGE_ASPECT_RATIOS.map(ar => (
                    <button
                      key={ar}
                      onClick={() => setImgAspectRatio(ar)}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                        imgAspectRatio === ar
                          ? 'bg-blue-600/20 border-blue-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      {ar}
                    </button>
                  ))}
                </div>
              </div>

              {/* Style */}
              <div>
                <label className="block text-sm text-slate-400 mb-2">艺术风格</label>
                <div className="flex gap-2 flex-wrap">
                  {IMAGE_STYLES.map(s => (
                    <button
                      key={s}
                      onClick={() => setImgStyle(s)}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                        imgStyle === s
                          ? 'bg-blue-600/20 border-blue-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview */}
              {imgPreviewUrl && (
                <div className="rounded-xl overflow-hidden border border-slate-700">
                  <img
                    src={imgPreviewUrl}
                    alt="生成预览"
                    className="w-full object-contain bg-slate-950 max-h-72"
                  />
                </div>
              )}

              {/* Progress */}
              {imgProgress && (
                <div className="text-sm text-blue-400 bg-blue-900/20 border border-blue-800 rounded-lg px-4 py-2">
                  {imgProgress}
                </div>
              )}

              {/* Error */}
              {imgError && (
                <div className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-4 py-2">
                  {imgError}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                {imgStatus === 'generating' ? (
                  <button
                    onClick={handleCancelImage}
                    className="flex-1 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium text-white transition-colors"
                  >
                    取消生成
                  </button>
                ) : (
                  <button
                    onClick={handleGenerateImage}
                    disabled={!imgPrompt.trim() || isGenerating}
                    className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors flex items-center justify-center gap-2"
                  >
                    <span>✨</span>
                    <span>开始生成</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Music Tab ──────────────────────────────────────────────────── */}
          {tab === 'music' && (
            <div className="space-y-5">
              {/* Info banner */}
              <div className="bg-amber-900/20 border border-amber-700 rounded-lg px-4 py-3 text-sm text-amber-300">
                🎵 基于 MiniMax TTS 语音合成，支持多种音色和风格，适合短视频配乐。
              </div>

              {/* Model */}
              <div>
                <label className="block text-sm text-slate-400 mb-2">语音模型</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { id: 'speech-02-hd', label: 'Speech 02 HD（高音质）' },
                    { id: 'speech-02-turbo', label: 'Speech 02 Turbo（快速）' },
                    { id: 'speech-2.8-hd', label: 'Speech 2.8 HD' },
                  ].map(m => (
                    <button
                      key={m.id}
                      onClick={() => setMusicModel(m.id)}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                        musicModel === m.id
                          ? 'bg-blue-600/20 border-blue-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Voice */}
              <div>
                <label className="block text-sm text-slate-400 mb-2">音色</label>
                <div className="flex gap-2 flex-wrap">
                  {MUSIC_VOICES.map(v => (
                    <button
                      key={v.id}
                      onClick={() => setMusicVoice(v.id)}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                        musicVoice === v.id
                          ? 'bg-blue-600/20 border-blue-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Genre */}
              <div>
                <label className="block text-sm text-slate-400 mb-2">音乐风格</label>
                <div className="flex gap-2 flex-wrap">
                  {MUSIC_GENRES.map(g => (
                    <button
                      key={g}
                      onClick={() => setMusicGenre(prev => prev === g ? '' : g)}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                        musicGenre === g
                          ? 'bg-blue-600/20 border-blue-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              {/* Prompt */}
              <div>
                <label className="block text-sm text-slate-400 mb-1">音乐描述</label>
                <textarea
                  value={musicPrompt}
                  onChange={e => setMusicPrompt(e.target.value)}
                  placeholder="描述你想要生成的歌曲：风格、情绪、主题、乐器等...&#10;例如：欢快的电子音乐，适合派对场景，充满活力的节拍"
                  rows={3}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
                  maxLength={300}
                  disabled={musicStatus === 'generating'}
                />
                <div className="text-right text-xs text-slate-500 mt-1">{musicPrompt.length}/300</div>
              </div>

              {/* Audio preview */}
              {musicPreviewUrl && (
                <div className="rounded-xl border border-slate-700 overflow-hidden bg-slate-950">
                  <audio
                    src={musicPreviewUrl}
                    controls
                    className="w-full h-10"
                  />
                </div>
              )}

              {/* Progress */}
              {musicProgress && (
                <div className="text-sm text-blue-400 bg-blue-900/20 border border-blue-800 rounded-lg px-4 py-2">
                  {musicProgress}
                </div>
              )}

              {/* Error */}
              {musicError && (
                <div className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-4 py-2">
                  {musicError}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                {musicStatus === 'generating' ? (
                  <button
                    onClick={handleCancelMusic}
                    className="flex-1 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium text-white transition-colors"
                  >
                    取消生成
                  </button>
                ) : (
                  <button
                    onClick={handleGenerateMusic}
                    disabled={!musicPrompt.trim() || isGenerating}
                    className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors flex items-center justify-center gap-2"
                  >
                    <span>✨</span>
                    <span>生成音乐</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Video Tab ─────────────────────────────────────────────────── */}
          {tab === 'video' && (() => {
            const currentProvider = VIDEO_PROVIDERS[vidProviderId as VideoProviderId];
            const supportedArs = currentProvider?.supportedAspectRatios ?? ['16:9', '1:1', '9:16'];
            const supportedDurs = currentProvider?.supportedDurations ?? [5];
            const supportedRes = currentProvider?.supportedResolutions ?? ['720p'];

            const handleProviderChange = (pid: string) => {
              setVidProviderId(pid);
              const p = VIDEO_PROVIDERS[pid as VideoProviderId];
              if (p?.models?.[0]) setVidModelId(p.models[0].id);
              // Reset aspect/duration to first supported
              if (!supportedArs.includes(vidAspectRatio)) setVidAspectRatio(supportedArs[0]);
              if (!supportedDurs.includes(vidDuration)) setVidDuration(supportedDurs[0]);
            };

            return (
            <div className="space-y-5">
              {/* Provider */}
              <div>
                <label className="block text-sm text-slate-400 mb-2">视频引擎</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {vidProviders.map(p => (
                    <button
                      key={p.id}
                      onClick={() => handleProviderChange(p.id)}
                      className={`px-3 py-2 rounded-lg text-sm border transition-colors text-left ${
                        vidProviderId === p.id
                          ? 'bg-blue-600/20 border-blue-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {p.models[0]?.name ?? p.id}
                        {p.models.length > 1 && ` +${p.models.length - 1}`}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Model selector */}
              {currentProvider?.models && currentProvider.models.length > 1 && (
                <div>
                  <label className="block text-sm text-slate-400 mb-2">选择模型</label>
                  <div className="flex flex-wrap gap-2">
                    {currentProvider.models.map(m => (
                      <button
                        key={m.id}
                        onClick={() => setVidModelId(m.id)}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                          vidModelId === m.id
                            ? 'bg-blue-600/20 border-blue-500 text-white'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Prompt */}
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  视频描述 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={vidPrompt}
                  onChange={e => setVidPrompt(e.target.value)}
                  placeholder="描述你想要生成的视频场景、动作、氛围..."
                  rows={3}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
                  maxLength={500}
                  disabled={vidStatus === 'generating'}
                />
              </div>

              {/* Aspect Ratio — dynamic */}
              <div>
                <label className="block text-sm text-slate-400 mb-2">视频比例</label>
                <div className="flex gap-2 flex-wrap">
                  {supportedArs.map(ar => (
                    <button
                      key={ar}
                      onClick={() => setVidAspectRatio(ar)}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                        vidAspectRatio === ar
                          ? 'bg-blue-600/20 border-blue-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      {ar}
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration — dynamic */}
              {supportedDurs.length > 0 && (
                <div>
                  <label className="block text-sm text-slate-400 mb-2">视频时长</label>
                  <div className="flex gap-2">
                    {supportedDurs.map(d => (
                      <button
                        key={d}
                        onClick={() => setVidDuration(d)}
                        className={`px-4 py-1.5 rounded-lg text-sm border transition-colors ${
                          vidDuration === d
                            ? 'bg-blue-600/20 border-blue-500 text-white'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        {d}秒
                      </button>
                    ))}
                  </div>
                  {supportedDurs.length === 1 && (
                    <p className="text-xs text-slate-500 mt-1">
                      {currentProvider.name} 仅支持 {supportedDurs[0]} 秒视频
                    </p>
                  )}
                </div>
              )}

              {/* Resolution hint */}
              {supportedRes.length > 0 && (
                <p className="text-xs text-slate-500 -mt-2">
                  分辨率: {supportedRes.join(' / ')}
                  {currentProvider.maxDuration && ` · 最大时长 ${currentProvider.maxDuration}秒`}
                </p>
              )}

              {/* Preview / Video player */}
              {vidPreviewUrl && (
                <div className="rounded-xl overflow-hidden border border-slate-700 bg-slate-950">
                  <video
                    src={vidPreviewUrl}
                    controls
                    className="w-full max-h-72 object-contain"
                    playsInline
                  />
                </div>
              )}

              {/* Progress */}
              {vidProgress && (
                <div className="text-sm text-blue-400 bg-blue-900/20 border border-blue-800 rounded-lg px-4 py-2">
                  {vidProgress}
                </div>
              )}

              {/* Error */}
              {vidError && (
                <div className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-4 py-2">
                  {vidError}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                {vidStatus === 'generating' ? (
                  <button
                    onClick={handleCancelVideo}
                    className="flex-1 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium text-white transition-colors"
                  >
                    取消生成
                  </button>
                ) : (
                  <button
                    onClick={handleGenerateVideo}
                    disabled={!vidPrompt.trim() || isGenerating}
                    className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors flex items-center justify-center gap-2"
                  >
                    <span>✨</span>
                    <span>生成视频</span>
                  </button>
                )}
              </div>
            </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
