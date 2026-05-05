"use client"

import { useEffect } from "react"
import { ThemeProvider } from "next-themes"

import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { useChatStore } from "@/lib/store/chatStore"
import { useSettings } from "@/lib/store/settingsStore"

// 单点触发 store 从 IndexedDB hydrate——挂在全局唯一的 Providers 里避免重复 rehydrate 竞态。
function HydrateStores() {
  useEffect(() => {
    void useSettings.persist.rehydrate()
    void useChatStore.getState().hydrate()
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
