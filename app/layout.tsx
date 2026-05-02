import type { Metadata } from "next"
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

export const metadata: Metadata = {
  title: "CocoaChat",
  description: "BYOK AI chat — your keys, your data, all on-device",
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
