import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { Providers } from "@/components/providers"

// next/font 在构建时下载并自托管字体，不会运行时打 Google 的请求，
// 既避免了 GDPR 问题也消除了第三方字体闪烁（FOIT/FOUT）。
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

// 简历项目分享出去（推到群、发推、收进 Notion）时会展示 OG/Twitter 卡片。
// 不补这一块，链接预览只有一个光秃秃的 URL；补上之后会显示标题 + 描述 +（可选）图片。
// applicationName / authors / themeColor 这些次要字段也顺手填上，让被搜到时更完整。
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

// Next 16 推荐把 viewport 从 metadata 拆出来单独导出。
// themeColor 让移动端浏览器地址栏跟随 light/dark 主题——颜色取自 globals.css 的 --background。
// width / initialScale 显式声明（不写 Next 也会注入默认值），但加上后行为更可预期。
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
    // suppressHydrationWarning：next-themes 在挂载前不知道用户偏好暗/亮，
    // 服务端渲染会和客户端首次渲染产生 className 差异，必须抑制这个警告。
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
