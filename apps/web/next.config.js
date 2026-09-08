/** @type {import('next').NextConfig} */
const nextConfig = {
  // 静态导出：生成 out/ 目录，实现前端产物与后端产物隔离
  output: 'export',
  // 静态导出下禁用图片优化（无服务端运行时）
  images: { unoptimized: true },
  // 让 Next 转译 workspace 内的 TS 源码包
  transpilePackages: ['@quickwiki/shared'],
  reactStrictMode: true,
};

module.exports = nextConfig;
