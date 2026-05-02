"use client"

// Sidebar 是客户端组件：未来要点击切换会话、打开设置 Dialog，
// 这些都需要交互（onClick），server component 不能挂事件。

import { useState } from "react"
import { MessageSquarePlus, Settings, MessageCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ThemeToggle } from "@/components/theme-toggle"
import { SettingsDialog } from "@/components/settings/SettingsDialog"
import { cn } from "@/lib/utils"

// 占位会话数据。Stage 4 接 IndexedDB 后，这里改成从 Zustand store 读取。
const placeholderConversations = [
  { id: "1", title: "如何写一封简洁的辞职信", updatedAt: "刚刚" },
  { id: "2", title: "解释 React Server Components", updatedAt: "1 小时前" },
  { id: "3", title: "Python 装饰器入门", updatedAt: "昨天" },
]

export function Sidebar() {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* 顶部：Logo + 新建对话 */}
      <div className="flex flex-col gap-3 p-3">
        <div className="flex items-center gap-2 px-2 py-1">
          <div className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground text-sm font-semibold">
            C
          </div>
          <span className="font-semibold tracking-tight">CocoaChat</span>
        </div>
        <Button variant="outline" size="sm" className="justify-start gap-2">
          <MessageSquarePlus className="size-4" />
          新建对话
        </Button>
      </div>

      {/* 中间：会话列表（可滚动） */}
      <ScrollArea className="flex-1 px-2">
        <div className="flex flex-col gap-1 pb-2">
          <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
            历史会话
          </div>
          {placeholderConversations.map((c, i) => (
            <button
              key={c.id}
              className={cn(
                "group flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                i === 0 && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <div className="flex items-center gap-2 truncate">
                <MessageCircle className="size-3.5 shrink-0 opacity-60" />
                <span className="truncate">{c.title}</span>
              </div>
              <span className="pl-5 text-[10px] text-muted-foreground">
                {c.updatedAt}
              </span>
            </button>
          ))}
        </div>
      </ScrollArea>

      {/* 底部：设置入口 + 主题切换 */}
      <div className="flex items-center gap-1 border-t border-sidebar-border p-2">
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 justify-start gap-2"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="size-4" />
          设置
        </Button>
        <ThemeToggle />
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </aside>
  )
}
