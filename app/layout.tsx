import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { Providers } from "@/components/providers"

// next/font 自托管字体，避开运行时请求 Google（GDPR / FOIT）。
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

// OG / Twitter 卡片：分享链接时显示标题 + 描述。
export const metadata: Metadata = {
  title: {
    default: "CocoaChat",
    template: "%s · CocoaChat",
  },
  description:
    "Bring your own key 的 AI 聊天客户端。会话、API Key、设置全部存在浏览器本地——服务端只做无状态透传。",
  applicationName: "CocoaChat",
  authors: [{ name: "Akokko" }],
  keywords: ["AI chat", "BYOK", "OpenAI", "DeepSeek", "Next.js", "IndexedDB"],
  openGraph: {
    type: "website",
    title: "CocoaChat",
    description:
      "Bring your own key 的 AI 聊天客户端。会话、API Key、设置全部存在浏览器本地。",
    siteName: "CocoaChat",
    locale: "zh_CN",
  },
  twitter: {
    card: "summary",
    title: "CocoaChat",
    description:
      "Bring your own key 的 AI 聊天客户端，数据完全在浏览器本地。",
  },
}

// Next 16 要求 viewport 独立导出；themeColor 让移动端地址栏跟随主题。
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfafd" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1419" },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // suppressHydrationWarning：next-themes 注入 class 会让 SSR/CSR 首次渲染不一致。
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
