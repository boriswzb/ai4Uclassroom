import type { Metadata, Viewport } from 'next';
import QuantMobileDetector from '@/components/quant/quant-mobile-detector';

export const metadata: Metadata = {
  title: 'AI4U量化交易系统',
  description: 'AI for 大A量化交易模拟平台，支持回测、模拟交易、实盘对接',
};

// 移动端视口：禁止缩放、适配手机宽度、状态栏颜色
// v3.0.2（2026-06-15）：PWA manifest + iOS Add to Home Screen + theme color
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0F172A',
  viewportFit: 'cover',  // iOS safe-area（适配 iPhone 全面屏）
};

export default function QuantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <QuantMobileDetector />
      {/* PWA: 浏览器原生安装到桌面 */}
      <link rel="manifest" href="/manifest.json" />
      {/* iOS Add to Home Screen */}
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="apple-mobile-web-app-title" content="AI4U Quant" />
      <link rel="apple-touch-icon" href="/logo-icon.svg" />
      {/* 防止 iOS 数字识别成电话 */}
      <meta name="format-detection" content="telephone=no" />
      {children}
    </>
  );
}
