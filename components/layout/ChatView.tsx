"use client"

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
  // 移动端汉堡按钮点击；桌面端按钮 hidden 不会触发。
  onMenuClick?: () => void
}

export function ChatView({ onMenuClick }: Props = {}) {
  const { isStreaming, sendMessage, stop, regenerate, editAndResend } =
    useChatStream()

  const [sysPromptOpen, setSysPromptOpen] = useState(false)

  const messages = useChatStore(selectCurrentMessages)
  const currentId = useChatStore((s) => s.currentId)
  const isHydrated = useChatStore((s) => s.isHydrated)
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

  // 未 hydrate / 没有当前会话 / 当前会话无消息——任一成立都展示欢迎页。
  const showWelcome = !isHydrated || !currentId || isEmpty

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {/* header 移动端布局：固定项 shrink-0，可伸缩的 model 名 flex-1 + min-w-0 + truncate
          才能在窄屏不撑破父级（flex 子项默认 min-width:auto）。 */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 text-sm">
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
        <span className="min-w-0 flex-1 truncate font-medium">
          {model || "未配置模型"}
        </span>

        {!hasApiKey && (
          // sm+ 文字提示；窄屏退化成红点（不撑宽）。
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
