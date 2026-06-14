'use client';

import { useState, useRef } from 'react';

interface UploadPanelProps {
  onClose: () => void;
  onSuccess: () => void;
}

const CATEGORIES = [
  { value: 'ai-music', label: 'AI音乐', icon: '🎹' },
  { value: 'ai-cover', label: 'AI翻唱', icon: '🎤' },
  { value: 'ai-image', label: 'AI图片', icon: '🖼️' },
  { value: 'ai-video', label: 'AI视频', icon: '🎬' },
];

const VOICE_SOURCES = [
  '孙燕姿', '周杰伦', '王菲', '林俊杰', 'Taylor Swift',
  'Adele', 'Billie Eilish', '其他', '原创'
];

export default function UploadPanel({ onClose, onSuccess }: UploadPanelProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('ai-music');
  const [tags, setTags] = useState('');
  const [voiceSource, setVoiceSource] = useState('');
  const [prompt, setPrompt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const thumbRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('请选择文件');
      return;
    }
    if (!title.trim()) {
      setError('请输入标题');
      return;
    }

    setUploading(true);
    setError('');

    const formData = new FormData();
    formData.append('title', title.trim());
    formData.append('description', description.trim());
    formData.append('category', category);
    formData.append('tags', tags.trim());
    formData.append('voiceSource', voiceSource || '');
    formData.append('prompt', prompt || '');
    formData.append('file', file);
    if (thumbnail) formData.append('thumbnail', thumbnail);

    try {
      const res = await fetch('/api/media', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '上传失败');
        return;
      }
      onSuccess();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 px-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-slate-900 rounded-2xl shadow-2xl border border-slate-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h2 className="text-lg font-bold text-white">上传作品</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm px-4 py-2 rounded-lg">
              {error}
            </div>
          )}

          {/* 类别 */}
          <div>
            <label className="block text-sm text-slate-400 mb-2">类别</label>
            <div className="grid grid-cols-3 gap-2">
              {CATEGORIES.map(cat => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => setCategory(cat.value)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    category === cat.value
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  <span className="mr-1">{cat.icon}</span>
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* 标题 */}
          <div>
            <label className="block text-sm text-slate-400 mb-1">标题 <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="给作品起个名字..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              maxLength={80}
            />
          </div>

          {/* 描述 */}
          <div>
            <label className="block text-sm text-slate-400 mb-1">简介</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="介绍下这个作品..."
              rows={3}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
              maxLength={500}
            />
          </div>

          {/* 翻唱声源 */}
          {category === 'ai-cover' && (
            <div>
              <label className="block text-sm text-slate-400 mb-1">声源模仿</label>
              <div className="flex flex-wrap gap-1.5">
                {VOICE_SOURCES.map(v => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVoiceSource(v)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      voiceSource === v
                        ? 'bg-pink-600 border-pink-500 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* AI提示词 */}
          {category === 'ai-image' && (
            <div>
              <label className="block text-sm text-slate-400 mb-1">AI提示词 (Prompt)</label>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="使用的AI生成提示词..."
                rows={2}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>
          )}

          {/* 标签 */}
          <div>
            <label className="block text-sm text-slate-400 mb-1">标签（用逗号分隔）</label>
            <input
              type="text"
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="流行,翻唱,AI孙燕姿"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* 文件 */}
          <div>
            <label className="block text-sm text-slate-400 mb-1">媒体文件 <span className="text-red-500">*</span></label>
            <input
              ref={fileRef}
              type="file"
              accept={category === 'ai-image' ? 'image/*' : category === 'ai-video' ? 'video/*,.mp4,.mov,.avi' : 'audio/*,.mp3,.wav,.flac'}
              onChange={e => setFile(e.target.files?.[0] || null)}
              className="hidden"
            />
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-slate-700 rounded-lg p-4 text-center cursor-pointer hover:border-blue-500 transition-colors"
            >
              {file ? (
                <div className="text-sm text-blue-400">{file.name}</div>
              ) : (
                <div className="text-slate-500 text-sm">
                  {category === 'ai-image' ? '点击选择图片文件' : category === 'ai-video' ? '点击选择视频文件' : '点击选择音频文件'}
                </div>
              )}
            </div>
          </div>

          {/* 封面 */}
          <div>
            <label className="block text-sm text-slate-400 mb-1">封面图（可选）</label>
            <input
              ref={thumbRef}
              type="file"
              accept="image/*"
              onChange={e => setThumbnail(e.target.files?.[0] || null)}
              className="hidden"
            />
            <div
              onClick={() => thumbRef.current?.click()}
              className="border border-slate-700 rounded-lg p-3 text-center cursor-pointer hover:border-slate-600 transition-colors"
            >
              {thumbnail ? (
                <div className="text-sm text-blue-400">{thumbnail.name}</div>
              ) : (
                <div className="text-slate-500 text-xs">点击选择封面图（可选）</div>
              )}
            </div>
          </div>

          {/* 提交 */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm text-slate-300 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={uploading}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
            >
              {uploading ? '上传中...' : '确认上传'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
