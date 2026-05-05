"use client"

// 应用的 client 容器：把 server/client 边界从 page.tsx 推到这里，承载移动端 drawer 开关状态。
// 桌面常驻 / 移动 drawer 两种形态共用 Sidebar 组件，drawer 模式靠 onItemClick 让点击后自动收起。

import { useState } from "react"

import { ChatView } from "@/components/layout/ChatView"
import { MobileDrawer } from "@/components/layout/MobileDrawer"
import { Sidebar } from "@/components/layout/Sidebar"

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <aside className="hidden w-64 shrink-0 md:flex">
        <Sidebar />
      </aside>

      <MobileDrawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Sidebar onItemClick={() => setDrawerOpen(false)} />
      </MobileDrawer>

      <ChatView onMenuClick={() => setDrawerOpen(true)} />
    </div>
  )
}
