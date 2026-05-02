"use client"

// 这是一个"客户端包装器"模式：
// Next.js App Router 默认所有组件都在服务端渲染（RSC）。
// next-themes、TooltipProvider、Sonner Toaster 都依赖浏览器 API（localStorage、Portal），
// 必须跑在客户端。我们用 "use client" 把这一层切换成客户端组件，
// 但 RootLayout 仍是服务端组件——这样首屏 HTML 还是服务端生成的，性能更好。

import { ThemeProvider } from "next-themes"

import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider delay={200}>
        {children}
        <Toaster richColors position="top-right" />
      </TooltipProvider>
    </ThemeProvider>
  )
}
