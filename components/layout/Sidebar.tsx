"use client"

// Sidebar 是客户端组件：未来要点击切换会话、打开设置 Dialog，
// 这些都需要交互（onClick），server component 不能挂事件。

import { useState } from "react"
import {
  MessageSquarePlus,
  Settings,
  MessageCircle,
  Pencil,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ThemeToggle } from "@/components/theme-toggle"
import { SettingsDialog } from "@/components/settings/SettingsDialog"
import { useChatStore } from "@/lib/store/chatStore"
import { cn } from "@/lib/utils"

// 把毫秒时间戳渲染成"刚刚 / 5 分钟前 / 昨天 / MM-DD"。
// 不用 dayjs 之类的库——一个 if-else 就够，体积小。
function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return "刚刚"
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 2 * day) return "昨天"
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${mm}-${dd}`
}

export function Sidebar() {
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 订阅按字段拆分：每个 useChatStore 调用只关心一个值，
  // 任意一个不变化时这一行就不会引起重渲染。
  const conversations = useChatStore((s) => s.conversations)
  const currentId = useChatStore((s) => s.currentId)
  const isHydrated = useChatStore((s) => s.isHydrated)

  // actions 是稳定引用（Zustand 保证），可以一次性解构出来用。
  const createConversation = useChatStore((s) => s.createConversation)
  const selectConversation = useChatStore((s) => s.selectConversation)
  const deleteConversation = useChatStore((s) => s.deleteConversation)
  const renameConversation = useChatStore((s) => s.renameConversation)

  async function handleNew() {
    try {
      await createConversation()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建会话失败")
    }
  }

  async function handleDelete(id: string, title: string) {
    if (!window.confirm(`删除"${title}"？该会话的所有消息会一起删除。`)) return
    try {
      await deleteConversation(id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    }
  }

  async function handleRename(id: string, current: string) {
    // 简单粗暴用 prompt——Stage 6 再换内联编辑。
    const next = window.prompt("重命名会话", current)
    if (next == null) return
    const trimmed = next.trim()
    if (!trimmed || trimmed === current) return
    try {
      await renameConversation(id, trimmed)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "重命名失败")
    }
  }

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
        <Button
          variant="outline"
          size="sm"
          className="justify-start gap-2"
          onClick={handleNew}
        >
          <MessageSquarePlus className="size-4" />
          新建对话
        </Button>
      </div>

      {/* 中间：会话列表（可滚动）。min-h-0 见 MessageList 注释——同样原因。 */}
      <ScrollArea className="min-h-0 flex-1 px-2">
        <div className="flex flex-col gap-1 pb-2">
          <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
            历史会话
          </div>

          {/* 三种状态：未 hydrate / 空 / 有数据 */}
          {!isHydrated ? (
            <div className="px-2 py-4 text-xs text-muted-foreground">
              加载中…
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-2 py-4 text-xs text-muted-foreground">
              还没有会话——点上方「新建对话」开始。
            </div>
          ) : (
            conversations.map((c) => {
              const active = c.id === currentId
              return (
                <div
                  key={c.id}
                  className={cn(
                    // group 让子元素能用 group-hover: 控制显隐
                    "group relative flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    active && "bg-sidebar-accent text-sidebar-accent-foreground",
                  )}
                >
                  {/* 整行点击切换会话——button 包整行让点击区域大 */}
                  <button
                    type="button"
                    onClick={() => selectConversation(c.id)}
                    className="flex flex-col gap-0.5 text-left"
                  >
                    <div className="flex items-center gap-2 truncate pr-12">
                      <MessageCircle className="size-3.5 shrink-0 opacity-60" />
                      <span className="truncate">{c.title}</span>
                    </div>
                    <span className="pl-5 text-[10px] text-muted-foreground">
                      {formatRelative(c.updatedAt)}
                    </span>
                  </button>

                  {/* hover 出现的两个操作按钮，绝对定位到右侧避免影响布局 */}
                  <div className="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRename(c.id, c.title)
                      }}
                      aria-label="重命名"
                      title="重命名"
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(c.id, c.title)
                      }}
                      aria-label="删除"
                      title="删除"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              )
            })
          )}
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
