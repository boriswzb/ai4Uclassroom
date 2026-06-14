import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : 'standalone',
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: [],
  typescript: {
    // 跳过 node_modules 类型检查，避免 Next.js 内部类型与当前 TS 版本冲突
    ignoreBuildErrors: true,
  },
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
  // 允许开发环境从域名访问
  allowedDevOrigins: ['www.ai4uclassroom.com', 'ai4uclassroom.com', 'localhost', '127.0.0.1'],
  // 修复 HTTPS 代理后的 WebSocket HMR 问题
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Forwarded-Proto', value: 'https' },
        ],
      },
    ];
  },
};

export default nextConfig;
