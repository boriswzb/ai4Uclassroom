'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ReportMeta } from '@/app/api/quant/reports/route';

/**
 * 下载中心（原"AI 报告"模块升级）
 *
 * 设计目标：
 *   - 统一管理可下载资源：APK/PPTX/PDF/MD/XLSX/CSV/JSON 等
 *   - 分类从"选股分析/回测报告/市场日报"等股票语义改为
 *     "安装包/文档/数据/工具/其它"（用户场景是"下载文件"）
 *   - 上传时去掉"相关股票代码"字段（与下载场景无关）
 *   - PPTX/MD 保留在线预览能力（向后兼容）
 */

// 分类体系（用户场景：想下载什么？）
// 保留旧分类（兼容老数据），用新分类做"用户视角"筛选
type Category = string;
const NEW_CATEGORIES = ['全部', '📱 安装包', '📄 文档', '📊 数据', '🔧 工具', '👤 用户上传', '📦 其它'] as const;
// 旧分类 → 新分类映射
const CATEGORY_MIGRATION: Record<string, string> = {
  '选股分析': '📊 数据',
  '回测报告': '📊 数据',
  '市场日报': '📊 数据',
  '风险评估': '📊 数据',
  '用户上传': '👤 用户上传',
  '其他': '📦 其它',
  '移动 App': '📱 安装包',
};

const CATEGORIES: readonly string[] = NEW_CATEGORIES;

const TYPE_ICONS: Record<string, string> = {
  pptx: '📊', pdf: '📄', md: '📝', xlsx: '📈', csv: '📋', json: '📦',
  apk: '📱',  // Android 安装包
};

const TYPE_COLORS: Record<string, string> = {
  pptx: 'bg-blue-900/50 text-blue-300 border-blue-700',
  pdf: 'bg-red-900/50 text-red-300 border-red-700',
  md: 'bg-green-900/50 text-green-300 border-green-700',
  xlsx: 'bg-emerald-900/50 text-emerald-300 border-emerald-700',
  csv: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  json: 'bg-purple-900/50 text-purple-300 border-purple-700',
  apk: 'bg-orange-900/50 text-orange-300 border-orange-700',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function DownloadsExplorer() {
  const REPORTS_CACHE_KEY = 'quant_reports_cache';
  // 改为无过期缓存：只要有缓存就一直用，后台静默刷新

  // 初始化：从 localStorage 恢复缓存（无过期限制）
  const [reports, setReports] = useState<ReportMeta[]>(() => {
    try {
      const cached = localStorage.getItem(REPORTS_CACHE_KEY);
      if (cached) {
        const { data } = JSON.parse(cached);
        return data || [];
      }
    } catch { /* ignore */ }
    return [];
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Category>('全部');
  const [selectedReport, setSelectedReport] = useState<ReportMeta | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 上传表单
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadCategory, setUploadCategory] = useState('📱 安装包');
  const [uploadAuthor, setUploadAuthor] = useState('');
  const [uploadSummary, setUploadSummary] = useState('');
  const [uploadTags, setUploadTags] = useState('');

  // 拉取文件列表（不传 category 给后端，客户端做过滤+迁移）
  const fetchReports = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const res = await fetch(`/api/quant/reports?${params}`);
      const json = await res.json();
      if (json.success) {
        setReports(json.data);
        // 存入 localStorage（无过期限制）
        try {
          localStorage.setItem(REPORTS_CACHE_KEY, JSON.stringify({ data: json.data }));
        } catch { /* ignore */ }
      }
      else if (!silent) setError(json.error || '获取文件列表失败');
    } catch {
      if (!silent) setError('网络错误，请重试');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [search]);

  // 客户端按新分类筛选（同时兼容旧分类）
  const filteredReports = useMemo(() => {
    if (category === '全部') return reports;
    const oldNamesMatching: string[] = Object.entries(CATEGORY_MIGRATION)
      .filter(([_, newName]) => newName === category)
      .map(([oldName]) => oldName);
    return reports.filter(r =>
      r.category === category || oldNamesMatching.includes(r.category)
    );
  }, [reports, category]);

  useEffect(() => {
    // 有缓存时先展示，后台静默刷新；无缓存则等待
    if (reports.length > 0) {
      setLoading(false);
      fetchReports(true); // 静默后台刷新
    } else {
      fetchReports(false);
    }
  }, []);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadError('');
    setUploadSuccess('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', uploadTitle || file.name.replace(/\.[^.]+$/, ''));
      formData.append('category', uploadCategory);
      formData.append('author', uploadAuthor || '用户上传');
      formData.append('summary', uploadSummary);
      formData.append('tags', uploadTags);
      const res = await fetch('/api/quant/reports', { method: 'POST', body: formData });
      const json = await res.json();
      if (json.success) {
        setUploadSuccess(`✅ 上传成功：${json.data.title}`);
        setShowUpload(false);
        setUploadTitle(''); setUploadSummary(''); setUploadTags('');
        fetchReports();
      } else {
        setUploadError(json.error || '上传失败');
      }
    } catch { setUploadError('网络错误，请重试'); }
    finally { setUploading(false); }
  };

  const handleDelete = async (report: ReportMeta) => {
    if (!confirm(`确定删除文件「${report.title}」？`)) return;
    try {
      const res = await fetch(`/api/quant/reports?id=${report.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) { if (selectedReport?.id === report.id) setSelectedReport(null); fetchReports(); }
      else alert(json.error || '删除失败');
    } catch { alert('网络错误'); }
  };

  const handleDownload = (report: ReportMeta) => {
    const link = document.createElement('a');
    link.href = `/reports/${report.filename}`;
    link.download = report.title + '.' + report.type;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-64">
          <input
            type="text" placeholder="搜索文件标题、标签..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-1 bg-slate-800 rounded-lg p-1 border border-slate-700">
          {CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setCategory(cat)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                category === cat ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}>
              {cat}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-slate-800 rounded-lg p-1 border border-slate-700">
          <button onClick={() => setViewMode('list')}
            className={`px-3 py-1 rounded text-xs font-medium ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            ☰ 列表
          </button>
          <button onClick={() => setViewMode('grid')}
            className={`px-3 py-1 rounded text-xs font-medium ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            ⊞ 网格
          </button>
        </div>
        <button onClick={() => setShowUpload(!showUpload)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
          <span>⬆</span>上传文件
        </button>
      </div>

      {/* 上传表单 */}
      {showUpload && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
          <h3 className="text-white font-semibold flex items-center gap-2"><span>📤</span>上传新文件</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">文件标题</label>
              <input type="text" value={uploadTitle} onChange={e => setUploadTitle(e.target.value)}
                placeholder="留空则使用文件名"
                className="w-full bg-slate-700 border border-slate-600 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">文件分类</label>
              <select value={uploadCategory} onChange={e => setUploadCategory(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {CATEGORIES.filter(c => c !== '全部').map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">作者/来源</label>
              <input type="text" value={uploadAuthor} onChange={e => setUploadAuthor(e.target.value)}
                placeholder="系统生成 / 用户上传"
                className="w-full bg-slate-700 border border-slate-600 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm text-slate-400 mb-1">标签（逗号分隔）</label>
              <input type="text" value={uploadTags} onChange={e => setUploadTags(e.target.value)}
                placeholder="如：Android,安装包,WebView"
                className="w-full bg-slate-700 border border-slate-600 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm text-slate-400 mb-1">说明</label>
              <textarea value={uploadSummary} onChange={e => setUploadSummary(e.target.value)}
                placeholder="简要描述这个文件..." rows={2}
                className="w-full bg-slate-700 border border-slate-600 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>
          </div>
          <div className="border-2 border-dashed border-slate-600 rounded-xl p-6 text-center hover:border-slate-500 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}>
            <input ref={fileInputRef} type="file" accept=".pptx,.pdf,.md,.xlsx,.csv,.json,.apk,.zip,.tar,.gz,.txt"
              className="hidden"
              onChange={e => { const file = e.target.files?.[0]; if (file) handleUpload(file); }} />
            <div className="text-4xl mb-2">📁</div>
            <div className="text-slate-300 text-sm">点击选择文件 或 拖拽文件到此处</div>
            <div className="text-slate-500 text-xs mt-1">支持 PPTX、PDF、Markdown、XLSX、CSV、JSON、APK、ZIP、TXT 等</div>
          </div>
          {uploadError && <div className="text-red-400 text-sm">❌ {uploadError}</div>}
          {uploadSuccess && <div className="text-green-400 text-sm">{uploadSuccess}</div>}
          {uploading && <div className="text-blue-400 text-sm">⏳ 上传中...</div>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowUpload(false)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition-colors">取消</button>
          </div>
        </div>
      )}

      {/* 文件列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <span className="text-2xl animate-spin mr-2">⏳</span>加载中...
        </div>
      ) : error ? (
        <div className="text-center py-20 text-red-400">❌ {error} <button onClick={() => fetchReports()} className="underline ml-2">重试</button></div>
      ) : filteredReports.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <div className="text-5xl mb-4">📭</div>
          <div className="text-lg">暂无文件</div>
          <div className="text-sm mt-1">点击右上角「上传文件」添加</div>
        </div>
      ) : viewMode === 'list' ? (
        <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-800 border-b border-slate-700 text-left">
                {['文件', '类型', '分类', '日期', '大小', '操作'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-medium text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredReports.map(report => (
                <tr key={report.id}
                  className={`border-b border-slate-800 hover:bg-slate-800/50 cursor-pointer transition-colors ${selectedReport?.id === report.id ? 'bg-blue-900/20' : ''}`}
                  onClick={() => setSelectedReport(report)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{TYPE_ICONS[report.type] || '📄'}</span>
                      <div>
                        <div className="text-white font-medium text-sm">{report.title}</div>
                        {report.summary && <div className="text-slate-500 text-xs mt-0.5 truncate max-w-xs">{report.summary}</div>}
                        {report.tags.length > 0 && (
                          <div className="flex gap-1 mt-1">{report.tags.slice(0, 3).map(tag => (
                            <span key={tag} className="text-xs px-1.5 py-0.5 bg-slate-700 text-slate-400 rounded">{tag}</span>
                          ))}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${TYPE_COLORS[report.type] || 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                      .{report.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400">{report.category}</td>
                  <td className="px-4 py-3 text-sm text-slate-400">{report.date}</td>
                  <td className="px-4 py-3 text-sm text-slate-400">{formatSize(report.size)}</td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedReport(report)}
                        className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors">查看</button>
                      <button onClick={() => handleDownload(report)}
                        className="text-xs px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors">下载</button>
                      <button onClick={() => handleDelete(report)}
                        className="text-xs px-3 py-1 bg-red-900/50 hover:bg-red-800/50 text-red-300 border border-red-700 rounded transition-colors">删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredReports.map(report => (
            <div key={report.id}
              className={`bg-slate-900 border rounded-xl p-4 cursor-pointer hover:border-blue-600 transition-all ${selectedReport?.id === report.id ? 'border-blue-500 shadow-lg shadow-blue-900/20' : 'border-slate-700'}`}
              onClick={() => setSelectedReport(report)}>
              <div className="flex items-start justify-between mb-3">
                <span className="text-4xl">{TYPE_ICONS[report.type] || '📄'}</span>
                <span className={`text-xs px-2 py-0.5 rounded border font-medium ${TYPE_COLORS[report.type] || ''}`}>.{report.type}</span>
              </div>
              <h3 className="text-white font-semibold text-sm mb-1 line-clamp-2">{report.title}</h3>
              <div className="text-xs text-slate-400 mb-2">{report.date} · {formatSize(report.size)}</div>
              {report.summary && <p className="text-xs text-slate-500 line-clamp-2 mb-2">{report.summary}</p>}
              {report.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">{report.tags.slice(0, 3).map(tag => (
                  <span key={tag} className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">{tag}</span>
                ))}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 文件详情预览 */}
      {selectedReport && (
        <FilePreviewModal
          report={selectedReport}
          onClose={() => setSelectedReport(null)}
          onDownload={() => handleDownload(selectedReport)}
        />
      )}
    </div>
  );
}

// ===================== Preview Modal =====================
function FilePreviewModal({ report, onClose, onDownload }: {
  report: ReportMeta;
  onClose: () => void;
  onDownload: () => void;
}) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [slideIdx, setSlideIdx] = useState(0);
  const [slideTexts, setSlideTexts] = useState<Array<{ title: string; items: string[] }>>([]);

  useEffect(() => {
    setLoading(true);
    setContent('');
    setSlideTexts([]);
    setSlideIdx(0);

    if (report.type === 'md') {
      fetch(`/reports/${report.filename}`)
        .then(r => r.text())
        .then(text => { setContent(text); setLoading(false); })
        .catch(() => setLoading(false));
    } else if (report.type === 'pptx') {
      // 用JSZip解析PPTX
      const loadAndParse = async () => {
        try {
          const res = await fetch(`/reports/${report.filename}`);
          const buf = await res.arrayBuffer();
          const JSZip = (await import('jszip')).default;
          const zip = await JSZip.loadAsync(buf);
          const fileMap: Record<string, { async: (t: string) => Promise<string> }> =
            (zip as unknown as { files: Record<string, { async: (type: string) => Promise<string> }> }).files || {};
          const slideFiles = Object.keys(fileMap)
            .filter(name => name.match(/^ppt\/slides\/slide\d+\.xml$/))
            .sort();

          const allTexts = await Promise.all(
            slideFiles.map(name =>
              fileMap[name].async('string').then((xml: string) => {
                const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
                const texts: string[] = [];
                for (const m of matches) {
                  const t = m.replace(/<a:t[^>]*>/, '').replace('<\/a:t>', '').trim();
                  if (t) texts.push(t);
                }
                return texts;
              })
            )
          );

          const slides = allTexts
            .filter(t => t.length > 0)
            .map((texts, i) => ({
              title: texts.find(t => t.length < 50) || ('幻灯片 ' + (i + 1)),
              items: texts,
            }));
          setSlideTexts(slides);
        } catch (e) {
          console.error('PPTX parse error:', e);
        } finally {
          setLoading(false);
        }
      };
      loadAndParse();
    } else {
      setLoading(false);
    }
  }, [report.filename, report.type]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-5xl bg-slate-900 border-l border-slate-700 flex flex-col shadow-2xl"
        style={{ maxHeight: '100vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 bg-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{TYPE_ICONS[report.type]}</span>
            <div>
              <h2 className="text-white font-semibold">{report.title}</h2>
              <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                <span>{report.date}</span><span>{report.category}</span>
                <span>{report.author}</span><span>{formatSize(report.size)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onDownload}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
              ⬇ 下载
            </button>
            <button onClick={onClose}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition-colors">
              ✕ 关闭
            </button>
          </div>
        </div>

        {/* Tags */}
        {(report.tags.length > 0 || report.summary) && (
          <div className="px-6 py-3 border-b border-slate-800 bg-slate-900 shrink-0">
            {report.summary && <p className="text-sm text-slate-400 mb-2">{report.summary}</p>}
            {report.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {report.tags.map(tag => (
                  <span key={tag} className="text-xs px-2 py-0.5 bg-blue-900/40 text-blue-300 rounded border border-blue-700">{tag}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Preview Area */}
        <div className="flex-1 overflow-hidden bg-slate-950">
          {report.type === 'pdf' ? (
            <iframe src={`/reports/${report.filename}`} className="w-full h-full border-0" title={report.title} />
          ) : report.type === 'md' ? (
            <div className="w-full h-full overflow-auto p-6">
              <div className="max-w-3xl mx-auto"><MarkdownView content={content} loading={loading} /></div>
            </div>
          ) : report.type === 'pptx' ? (
            loading ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <div className="text-4xl mb-3 animate-pulse">📊</div>
                <div>正在解析PPT文件...</div>
              </div>
            ) : slideTexts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500">
                <div className="text-5xl mb-4">📊</div>
                <div className="text-lg">无法解析PPT内容</div>
                <button onClick={onDownload} className="mt-4 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">下载PPTX文件</button>
              </div>
            ) : (
              <PPTXSlideView slides={slideTexts} slideIdx={slideIdx} setSlideIdx={setSlideIdx} />
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
              <div className="text-6xl mb-4">{TYPE_ICONS[report.type]}</div>
              <div className="text-lg">该文件类型暂不支持在线预览</div>
              <div className="text-sm text-slate-600 mt-1">{report.type.toUpperCase()} 格式</div>
              <button onClick={onDownload} className="mt-4 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">下载文件</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===================== PPTX Slide Viewer =====================
function PPTXSlideView({ slides, slideIdx, setSlideIdx }: {
  slides: Array<{ title: string; items: string[] }>;
  slideIdx: number;
  setSlideIdx: (i: number) => void;
}) {
  const slide = slides[slideIdx];

  return (
    <div className="flex flex-col h-full">
      {/* Slide nav */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 overflow-x-auto bg-slate-900 shrink-0">
        {slides.map((_, i) => (
          <button key={i} onClick={() => setSlideIdx(i)}
            className={`shrink-0 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              i === slideIdx ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'}`}>
            {i + 1}
          </button>
        ))}
      </div>

      {/* Slide content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-6">
            <div className="text-xs text-slate-500 mb-1">第 {slideIdx + 1} / {slides.length} 张幻灯片</div>
            <h3 className="text-lg font-semibold text-white">{slide.title}</h3>
          </div>

          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 space-y-2">
            {slide.items.map((text, i) => {
              const isBullet = text.match(/^[•\-\*\u25cf\u25cb]\s/);
              const isNumbered = text.match(/^\d+[.)、]\s/);
              const isTitle = i < 3 && text.length < 40;

              if (isBullet) {
                const marker = text.charAt(0);
                return (
                  <div key={i} className="flex gap-2 text-slate-300">
                    <span className="text-blue-400 shrink-0">{marker}</span>
                    <span className="text-sm leading-relaxed">{inlineFormat(text.slice(1).trim())}</span>
                  </div>
                );
              }
              if (isNumbered) {
                const num = text.match(/^(\d+[)、.)\s])(.*)/);
                return (
                  <div key={i} className="flex gap-2 text-slate-300">
                    <span className="text-blue-400 shrink-0 font-semibold">{num?.[1]}</span>
                    <span className="text-sm leading-relaxed">{inlineFormat(num?.[2] || text)}</span>
                  </div>
                );
              }
              if (isTitle) {
                return (
                  <div key={i} className="text-sm font-semibold text-white py-1 border-b border-slate-800">
                    {inlineFormat(text)}
                  </div>
                );
              }
              return (
                <div key={i} className="text-sm text-slate-400 leading-relaxed">{inlineFormat(text)}</div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer controls */}
      <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-900 shrink-0">
        <button onClick={() => setSlideIdx(Math.max(0, slideIdx - 1))}
          disabled={slideIdx === 0}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg text-sm transition-colors">
          ← 上一页
        </button>
        <div className="text-sm text-slate-400">{slideIdx + 1} / {slides.length}</div>
        <button onClick={() => setSlideIdx(Math.min(slides.length - 1, slideIdx + 1))}
          disabled={slideIdx === slides.length - 1}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg text-sm transition-colors">
          下一页 →
        </button>
      </div>
    </div>
  );
}

// ===================== Markdown Viewer =====================
function MarkdownView({ content, loading }: { content: string; loading: boolean }) {
  if (loading) return <div className="text-center py-20 text-slate-400">⏳ 加载中...</div>;

  const blocks = parseMdBlocks(content);

  return (
    <div className="space-y-1">
      {blocks.map((block, bi) => {
        if (block.type === 'h1') return <h1 key={bi} className="text-2xl font-bold text-white mt-8 mb-4 pb-2 border-b border-slate-700">{(block.text ?? '')}</h1>;
        if (block.type === 'h2') return <h2 key={bi} className="text-xl font-bold text-white mt-6 mb-3">{(block.text ?? '')}</h2>;
        if (block.type === 'h3') return <h3 key={bi} className="text-lg font-semibold text-slate-200 mt-4 mb-2">{(block.text ?? '')}</h3>;
        if (block.type === 'list') return (
          <ul key={bi} className="list-disc list-inside space-y-1 my-2 text-slate-300">
            {(block.items ?? []).map((item, li) => <li key={li}>{inlineFormat(item)}</li>)}
          </ul>
        );
        if (block.type === 'table') {
          const rows = block.rows ?? [];
          return (
            <table key={bi} className="w-full border-collapse my-3 text-sm">
              <thead>
                <tr className="border-b border-slate-600">
                  {rows[0].map((cell, ci) => (
                    <th key={ci} className="text-left text-slate-300 font-medium py-2 px-3">{inlineFormat(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(2).map((row, ri) => (
                  <tr key={ri} className="border-b border-slate-800">
                    {row.map((cell, ci) => (
                      <td key={ci} className="py-2 px-3 text-slate-400">{inlineFormat(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        if (block.type === 'empty') return <div key={bi} className="h-2" />;
        return <p key={bi} className="text-slate-300 my-1">{inlineFormat(block.text ?? '')}</p>;
      })}
    </div>
  );
}

// ===================== Helpers =====================
type BlockType = 'h1' | 'h2' | 'h3' | 'list' | 'table' | 'p' | 'empty';
type Block = { type: BlockType; text?: string; items?: string[]; rows?: string[][] };

function parseMdBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith('# ')) { blocks.push({ type: 'h1', text: line.slice(2) }); i++; }
    else if (line.startsWith('## ')) { blocks.push({ type: 'h2', text: line.slice(3) }); i++; }
    else if (line.startsWith('### ')) { blocks.push({ type: 'h3', text: line.slice(4) }); i++; }
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: string[] = [];
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(lines[i].slice(2)); i++;
      }
      blocks.push({ type: 'list', items });
    } else if (line.match(/^\|[^|]+\|/)) {
      const tableRows: string[][] = [];
      while (i < lines.length && lines[i].trim().match(/^\|[^|]+\|/)) {
        const row = lines[i].trim();
        if (!row.match(/^\|[-| :]+\|/)) {
          const cells = row.split('|').filter((_, ci) => ci > 0 && ci < row.split('|').length - 1);
          tableRows.push(cells.map(c => c.trim()));
        }
        i++;
      }
      if (tableRows.length > 0) blocks.push({ type: 'table', rows: tableRows });
    } else if (line === '') { blocks.push({ type: 'empty' }); i++; }
    else { blocks.push({ type: 'p', text: line }); i++; }
  }
  return blocks;
}

function inlineFormat(text: string): React.ReactNode {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={idx} className="text-white font-semibold">{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={idx} className="italic">{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={idx} className="bg-slate-800 text-blue-300 px-1 rounded text-sm">{part.slice(1, -1)}</code>;
    return part;
  });
}
