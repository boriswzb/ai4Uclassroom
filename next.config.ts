import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : 'standalone',
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: [],
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
