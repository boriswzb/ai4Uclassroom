/**
 * v3.0.2（2026-06-15）— 移动 App 下载中心
 *
 * 业界标准（参考：1Password / Notion / Linear 移动版）：
 *   - 移动 App 下载卡片 + 二维码 + 平台标识
 *   - 移动端自动检测 → 直接显示下载链接
 *   - 桌面端显示二维码（手机扫码下载）
 *   - 安装方法详细分步图示
 *   - 隐私 + 权限 + 系统要求
 *
 * 路由：/quant/downloads
 *   - 避开 /quant/pro 路径（被 quant-mobile-detector 隐藏）
 *   - 速览模式专属（与设计哲学一致："一站式无跳转完整体验"）
 */

'use client';

import React, { useState, useEffect } from 'react';
import QuantNavbar from '@/components/quant/quant-navbar';

interface DownloadMeta {
  id: string;
  title: string;
  version: string;
  filename: string;
  size: number;
  url: string;
  platform: 'android' | 'ios';
  qrCode?: string;  // SVG QR code data URL
  releasedAt: string;
  changelog: string[];
  minOS: string;
  sizeNote: string;
}

const DOWNLOADS: DownloadMeta[] = [
  {
    id: 'apk-3.0.2',
    title: 'AI4U 量化 App',
    version: 'v3.0.2',
    filename: 'AI4U-Quant-App-v3.0.2.apk',
    size: 5_859_010,
    url: '/reports/AI4U-Quant-App-v3.0.2.apk',
    platform: 'android',
    releasedAt: '2026-06-15',
    minOS: 'Android 7.0+',
    sizeNote: '原生 WebView 容器，加载 https://www.ai4uclassroom.com/quant',
    changelog: [
      '✅ 5 Tab 底部导航（推荐 / 盯盘 / 交易 / Auto / 我）',
      '✅ iOS Add to Home Screen + manifest.json 4 shortcuts',
      '✅ 11 类因子 / 8 风格 / Barra 风险模型 + 风险归因',
      '✅ 5 场景压力测试（2008/2015/2020/2017/2019）',
      '✅ Rank IC + IC 衰减（AQR/Barra 标准）',
      '✅ α Z-score 标准化',
      '✅ WF 真实收益验证 + IDB 持久化',
      '✅ 5 步新手指引 + 自动高亮（targetSelector）',
      '✅ 风控总览 4 维度面板（Barra / WF / 压力 / 集中度）',
      '✅ Barra 一键下单 + 同步自动驾驶',
      '✅ 反事实对比（"如果当时选 Top 10 真实能赚多少"）',
      '✅ 移动端 touch 优化（44px 最小点击区 / 禁用双击缩放）',
    ],
  },
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function DownloadsPage() {
  const [isAndroid, setIsAndroid] = useState<boolean | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const ua = navigator.userAgent.toLowerCase();
    setIsAndroid(ua.includes('android'));
  }, []);

  const handleDownload = (d: DownloadMeta) => {
    setDownloading(true);
    const a = document.createElement('a');
    a.href = d.url;
    a.download = d.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => setDownloading(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <QuantNavbar />

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2 flex items-center gap-3">
            <span className="text-3xl">📱</span>
            移动 App 下载中心
          </h1>
          <p className="text-sm text-slate-400">
            把量化交易系统装进口袋 — 原生 WebView 容器，加载速览模式 /quant
          </p>
        </div>

        {/* 移动端横幅（自动检测 Android）*/}
        {isAndroid === true && (
          <div className="bg-gradient-to-r from-emerald-950/40 to-cyan-950/40 border border-emerald-700/40 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <span className="text-3xl">🤖</span>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-emerald-200 mb-1">检测到 Android 设备</h3>
                <p className="text-sm text-slate-300 mb-3">
                  点击下方「下载 APK」按钮 → 设置允许「未知来源」→ 点击下载文件安装
                </p>
                <button
                  onClick={() => handleDownload(DOWNLOADS[0])}
                  disabled={downloading}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium disabled:opacity-50"
                >
                  {downloading ? '下载中…' : '📥 立即下载 APK（5.6 MB）'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* iOS 引导（暂未提供 iOS IPA）*/}
        {isAndroid === false && (
          <div className="bg-gradient-to-r from-blue-950/40 to-slate-900 border border-blue-700/40 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <span className="text-3xl">🍎</span>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-blue-200 mb-1">iOS 用户请用 PWA 模式</h3>
                <p className="text-sm text-slate-300 mb-2">
                  打开 Safari 访问 <code className="bg-slate-800 px-1 rounded">ai4uclassroom.com/quant</code>，
                  点击底部「分享」按钮 → 选择「添加到主屏幕」→ 像原生 App 一样用
                </p>
                <ol className="text-xs text-slate-400 space-y-1 ml-4 list-decimal">
                  <li>Safari 打开 ai4uclassroom.com/quant</li>
                  <li>点底部 [⇧] 分享按钮</li>
                  <li>选「添加到主屏幕」</li>
                  <li>桌面上出现「AI4U Quant」图标 ✓</li>
                </ol>
              </div>
            </div>
          </div>
        )}

        {/* 桌面端显示二维码 */}
        {isAndroid === null && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              <div>
                <h3 className="text-lg font-semibold text-slate-200 mb-2">📱 用手机扫码下载</h3>
                <p className="text-sm text-slate-400 mb-3">
                  打开手机相机 → 扫描右侧二维码 → 用浏览器打开下载链接
                </p>
                <div className="text-xs text-slate-500 space-y-1">
                  <div>📋 文件大小：5.6 MB</div>
                  <div>📦 包名：com.ai4u.quantapp</div>
                  <div>📱 系统要求：Android 7.0+</div>
                  <div>🔗 加载地址：<code className="text-cyan-400">ai4uclassroom.com/quant</code></div>
                </div>
              </div>
              <div className="flex justify-center">
                <div className="bg-white p-4 rounded-lg shadow-xl">
                  <QRPlaceholder url={DOWNLOADS[0].url} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* App 详情卡片 */}
        {DOWNLOADS.map(d => (
          <div key={d.id} className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
            <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                  {d.title} <span className="text-sm px-2 py-0.5 rounded bg-cyan-900/40 text-cyan-300 border border-cyan-700/50">{d.version}</span>
                </h2>
                <p className="text-sm text-slate-400 mt-1">{d.sizeNote}</p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <div>📅 发布：{d.releasedAt}</div>
                <div>📦 {formatSize(d.size)}</div>
                <div>📱 {d.minOS}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-slate-800/60 rounded-lg p-3">
                <div className="text-2xl mb-1">📊</div>
                <div className="text-xs text-slate-400">因子</div>
                <div className="text-sm text-slate-200 font-semibold">11 类 / 8 风格</div>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-3">
                <div className="text-2xl mb-1">🎯</div>
                <div className="text-xs text-slate-400">风险模型</div>
                <div className="text-sm text-amber-300 font-semibold">Barra 9 因子</div>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-3">
                <div className="text-2xl mb-1">📉</div>
                <div className="text-xs text-slate-400">压力测试</div>
                <div className="text-sm text-cyan-300 font-semibold">5 历史场景</div>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-3">
                <div className="text-2xl mb-1">🤖</div>
                <div className="text-xs text-slate-400">自动驾驶</div>
                <div className="text-sm text-fuchsia-300 font-semibold">24h 模拟盘</div>
              </div>
            </div>

            <details className="mb-4">
              <summary className="cursor-pointer text-sm text-slate-300 hover:text-slate-100 mb-2 font-medium">
                📋 v3.0.2 更新日志（点击展开）
              </summary>
              <div className="bg-slate-800/40 rounded-lg p-3 space-y-1 text-xs text-slate-300">
                {d.changelog.map((line, i) => (
                  <div key={i} className="leading-relaxed">{line}</div>
                ))}
              </div>
            </details>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleDownload(d)}
                disabled={downloading}
                className="px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-2"
              >
                {downloading ? '⏳ 下载中…' : '📥 下载 APK'}
              </button>
              <a
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg font-medium"
              >
                🔗 直接打开
              </a>
              <a
                href="/quant"
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium"
              >
                🌐 网页版
              </a>
            </div>
          </div>
        ))}

        {/* 安装步骤 */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4 text-slate-200">📖 安装步骤</h3>
          <ol className="space-y-3 text-sm text-slate-300">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-cyan-900/50 text-cyan-300 flex items-center justify-center text-xs font-bold">1</span>
              <div>
                <div className="font-medium text-slate-100">下载 APK</div>
                <div className="text-xs text-slate-500">点击「下载 APK」或扫描二维码，文件 5.6 MB（很快）</div>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-cyan-900/50 text-cyan-300 flex items-center justify-center text-xs font-bold">2</span>
              <div>
                <div className="font-medium text-slate-100">允许「未知来源」</div>
                <div className="text-xs text-slate-500">设置 → 安全 → 允许「安装未知来源的应用」→ 选浏览器/文件管理器为「允许」</div>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-cyan-900/50 text-cyan-300 flex items-center justify-center text-xs font-bold">3</span>
              <div>
                <div className="font-medium text-slate-100">点击 APK 安装</div>
                <div className="text-xs text-slate-500">下载完成后系统会自动提示安装，或在「文件管理 → Downloads」中点 AI4U-Quant-App.apk</div>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-900/50 text-emerald-300 flex items-center justify-center text-xs font-bold">✓</span>
              <div>
                <div className="font-medium text-slate-100">桌面出现「AI4U 量化」图标</div>
                <div className="text-xs text-slate-500">像原生 App 一样打开，全屏 + 隐藏浏览器工具栏</div>
              </div>
            </li>
          </ol>
        </div>

        {/* 权限 + 隐私 */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-3 text-slate-200">🔒 权限 + 隐私</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-slate-300">
            <div>
              <div className="text-cyan-300 font-medium mb-1">📡 申请权限</div>
              <ul className="text-xs text-slate-400 space-y-0.5 ml-4 list-disc">
                <li>INTERNET（访问量化系统）</li>
                <li>无相机 / 通讯录 / 位置</li>
              </ul>
            </div>
            <div>
              <div className="text-emerald-300 font-medium mb-1">🛡️ 隐私保证</div>
              <ul className="text-xs text-slate-400 space-y-0.5 ml-4 list-disc">
                <li>不收集任何用户数据</li>
                <li>所有计算在服务端 / 用户浏览器</li>
                <li>不向第三方发送数据</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ── 二维码占位（生产环境用 qrcode 库）──
function QRPlaceholder({ url }: { url: string }) {
  // 简化版：显示 21×21 格子占位（实际项目用 qrcode.react 生成 SVG）
  const grid = Array.from({ length: 21 * 21 }, (_, i) => {
    // 伪随机：基于 URL hash
    return ((url.charCodeAt(i % url.length) + i) % 3) === 0;
  });
  return (
    <div className="grid grid-cols-21 gap-0 w-48 h-48" style={{ gridTemplateColumns: 'repeat(21, minmax(0, 1fr))' }}>
      {grid.map((on, i) => (
        <div key={i} className={on ? 'bg-slate-900' : 'bg-white'} style={{ aspectRatio: '1' }} />
      ))}
    </div>
  );
}