"use client"

// 主聊天区。
// 数据源分两块：
//   - chatStore：messages、currentId、isHydrated、当前会话的 systemPrompt（用于按钮高亮）
//   - useChatStream：isStreaming + sendMessage + stop + regenerate + editAndResend
// 这种"状态在 store / 行为在 hook"的拆分让组件本身只管渲染。

import { useState } from "react"
import { Bot, FileText, Menu } from "lucide-react"

import { ChatInput } from "@/components/chat/ChatInput"
import { ConversationSystemPromptDialog } from "@/components/chat/ConversationSystemPromptDialog"
import { MessageList } from "@/components/chat/MessageList"
import { Button } from "@/components/ui/button"
import { useChatStream } from "@/lib/hooks/useChatStream"
import { selectCurrentMessages, useChatStore } from "@/lib/store/chatStore"
import { useSettings } from "@/lib/store/settingsStore"
import { cn } from "@/lib/utils"

interface Props {
  // 移动端汉堡菜单点击——AppShell 用它打开 drawer。
  // 桌面端 drawer 永不打开，所以这个 callback 在桌面是 dead code（按钮也 hidden）。
  onMenuClick?: () => void
}

export function ChatView({ onMenuClick }: Props = {}) {
  const { isStreaming, sendMessage, stop, regenerate, editAndResend } =
    useChatStream()

  const [sysPromptOpen, setSysPromptOpen] = useState(false)

  // 字段级订阅。任何一个字段变化，本组件最少重渲染。
  // selectCurrentMessages 用 messagesByConv[currentId] 派生当前会话消息——
  // 切会话时自动跟随，无需额外的同步逻辑。
  const messages = useChatStore(selectCurrentMessages)
  const currentId = useChatStore((s) => s.currentId)
  const isHydrated = useChatStore((s) => s.isHydrated)
  // 当前会话是否设置了"会话级 system prompt"——按钮高亮用，直观告诉用户"这个会话有自己的 prompt"。
  const hasConvSystemPrompt = useChatStore((s) =>
    Boolean(
      s.currentId &&
        s.conversations
          .find((c) => c.id === s.currentId)
          ?.systemPrompt?.trim(),
    ),
  )

  const model = useSettings((s) => s.model)
  const hasApiKey = useSettings((s) => Boolean(s.apiKey))

  const isEmpty = messages.length === 0

  // 三种状态合并成一个判断：要展示欢迎页吗？
  // 1) 还没 hydrate 完——避免闪一下"欢迎页"再变成消息列表
  // 2) 没有当前会话（极端情况：用户删光所有会话）
  // 3) 当前会话但还没发过消息
  const showWelcome = !isHydrated || !currentId || isEmpty

  return (
    // overflow-hidden 兜底：万一某个内层 flex 配合没设置好（比如未来加了组件忘记 min-h-0），
    // 至少不会把整页撑出滚动条——本组件内部超出部分被裁掉，肉眼可见就能立刻发现。
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {/* 顶部条：（移动端）汉堡菜单 + 当前模型 + API Key 配置提示 + 会话系统提示入口
          移动端布局关键：所有 inline 元素必须 shrink-0，可压缩的（model 名）用 flex-1 + min-w-0 + truncate
          才能在 320px 视口里不溢出。flex 子项默认 min-width:auto = 内容宽度，不主动 min-w-0 它会撑爆父级。 */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 text-sm">
        {/* 汉堡菜单：仅 < md 显示。md+ 桌面端有常驻 sidebar，不需要它。 */}
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground md:hidden"
          onClick={onMenuClick}
          aria-label="打开会话列表"
        >
          <Menu className="size-4" />
        </Button>

        <Bot className="size-4 shrink-0 text-muted-foreground" />
        {/* model 名占据剩余空间，min-w-0 + truncate 让它可压缩——
            窄屏太长会出 "..."，比强行撑宽好得多 */}
        <span className="min-w-0 flex-1 truncate font-medium">
          {model || "未配置模型"}
        </span>

        {!hasApiKey && (
          // 警告：sm+ 文字版本；窄屏只显示一个红点提示（无文字、不撑宽）。
          // 用户在窄屏时打开 drawer 找设置按钮——欢迎页那段 hint 也会引导。
          <>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
              尚未配置 API Key —— 请打开「设置」
            </span>
            <span
              className="size-2 shrink-0 rounded-full bg-destructive sm:hidden"
              aria-label="尚未配置 API Key"
              title="尚未配置 API Key"
            />
          </>
        )}

        {/* 会话级 system prompt 入口：仅当选中了会话时显示。
            已设置过的会话用 primary 色提示——和 muted 形成对比，一眼能区分。 */}
        {currentId && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-7 shrink-0",
              hasConvSystemPrompt
                ? "text-primary"
                : "text-muted-foreground",
            )}
            onClick={() => setSysPromptOpen(true)}
            aria-label="会话系统提示"
            title={
              hasConvSystemPrompt
                ? "已设置会话系统提示"
                : "设置会话系统提示"
            }
          >
            <FileText className="size-4" />
          </Button>
        )}
      </header>

      <ConversationSystemPromptDialog
        open={sysPromptOpen}
        onOpenChange={setSysPromptOpen}
        conversationId={currentId}
      />

      {/* 中间：消息列表或欢迎页（互斥） */}
      {showWelcome ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              欢迎使用 CocoaChat
            </h1>
            <p className="text-sm text-muted-foreground">
              自带 API Key 的 AI 聊天客户端。聊天记录只存在你的浏览器里。
              <br />
              {!isHydrated
                ? "正在加载历史会话……"
                : !hasApiKey
                  ? "进入「设置」配置 API Key 后即可开始。"
                  : "直接在下方开始提问吧。"}
            </p>
          </div>
        </div>
      ) : (
        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          onEdit={editAndResend}
          onRegenerate={regenerate}
        />
      )}

      <ChatInput
        isStreaming={isStreaming}
        onSend={sendMessage}
        onStop={stop}
      />
    </main>
  )
}
