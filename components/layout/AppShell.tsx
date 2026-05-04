"use client"

// 整个应用的 client 容器，管"移动端 drawer 开关"这一个跨组件状态。
//
// page.tsx 仍然是 server component（零 JS 体积）只渲染 <AppShell />，
// AppShell 内部把 server/client 边界往下推一层。这是 App Router 的常见模式：
// 根 layout 里 client state 越少越好，但**确实需要的**就单独抽一个 client wrapper。
//
// 桌面 / 移动两套 Sidebar 渲染：
//   - md+ ：常驻左侧（CSS 隐藏移动端）
//   - <md ：藏在 drawer 里，由 ChatView header 的汉堡按钮触发
// 同一个 Sidebar 组件复用——drawer 模式加 onItemClick={关drawer} 让用户点完
// 会话/新建后抽屉自动收起，不用手动关。

import { useState } from "react"

import { ChatView } from "@/components/layout/ChatView"
import { MobileDrawer } from "@/components/layout/MobileDrawer"
import { Sidebar } from "@/components/layout/Sidebar"

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      {/* 桌面端常驻 sidebar——w-64 在外层容器；Sidebar 内部 w-full 跟随。
          hidden md:flex 让它在 < md 完全消失，腾给 drawer。 */}
      <aside className="hidden w-64 shrink-0 md:flex">
        <Sidebar />
      </aside>

      {/* 移动端 drawer——桌面端不影响。drawer 关闭时 base-ui 会 unmount portal，
          没有渲染开销。 */}
      <MobileDrawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Sidebar onItemClick={() => setDrawerOpen(false)} />
      </MobileDrawer>

      <ChatView onMenuClick={() => setDrawerOpen(true)} />
    </div>
  )
}
