import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI4U多媒体中心',
  description: 'AI生成音乐、图片、翻唱作品展示平台',
};

export default function MediaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
