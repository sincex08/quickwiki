import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { SyncBootstrap } from "@/components/sync-bootstrap";

export const metadata: Metadata = {
  title: "QuickWiki - 本地优先笔记",
  description: "本地优先的个人知识库与快速记录工具",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "QuickWiki",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#3b82f6",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** 防止暗色模式首屏闪烁：在 HTML 解析阶段同步应用主题 */
const themeInitScript = `(function(){try{var t=localStorage.getItem('quickwiki.theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="h-dvh overflow-hidden font-sans antialiased">
        <ThemeProvider>{children}</ThemeProvider>
        <ServiceWorkerRegister />
        <SyncBootstrap />
      </body>
    </html>
  );
}
