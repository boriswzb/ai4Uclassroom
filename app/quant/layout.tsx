import type { Metadata, Viewport } from 'next';
import QuantMobileDetector from '@/components/quant/quant-mobile-detector';

export const metadata: Metadata = {
  title: 'AI4U量化交易系统',
  description: 'AI for 大A量化交易模拟平台，支持回测、模拟交易、实盘对接',
};

// 移动端视口：禁止缩放、适配手机宽度、状态栏颜色
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0F172A',
};

export default function QuantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <QuantMobileDetector />
      {children}
    </>
  );
}
