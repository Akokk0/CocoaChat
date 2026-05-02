"use client"

// 这是一个"客户端包装器"模式：
// Next.js App Router 默认所有组件都在服务端渲染（RSC）。
// next-themes、TooltipProvider、Sonner Toaster 都依赖浏览器 API（localStorage、Portal），
// 必须跑在客户端。我们用 "use client" 把这一层切换成客户端组件，
// 但 RootLayout 仍是服务端组件——这样首屏 HTML 还是服务端生成的，性能更好。

import { useEffect } from "react"
import { ThemeProvider } from "next-themes"

import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { useSettings } from "@/lib/store/settingsStore"

// 单点触发 store 从 IndexedDB hydrate。
// 必须在组件 mount 后跑（确保已经在客户端），且只跑一次（空依赖数组）。
// 放在 Providers 这种全局唯一组件里，避免多组件重复 rehydrate 的竞态。
function HydrateStores() {
  useEffect(() => {
    void useSettings.persist.rehydrate()
  }, [])
  return null
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider delay={200}>
        <HydrateStores />
        {children}
        <Toaster richColors position="top-right" />
      </TooltipProvider>
    </ThemeProvider>
  )
}
