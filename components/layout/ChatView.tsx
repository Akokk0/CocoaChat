"use client"

// 主聊天区。
// 组合三块：顶部状态条 + 中间消息列表（或欢迎页）+ 底部输入框。
// 所有聊天状态都来自 useChatStream，这个 hook 把 fetch / abort / 错误处理都封装好了。

import { Bot } from "lucide-react"

import { ChatInput } from "@/components/chat/ChatInput"
import { MessageList } from "@/components/chat/MessageList"
import { useChatStream } from "@/lib/hooks/useChatStream"
import { useSettings } from "@/lib/store/settingsStore"

export function ChatView() {
  const { messages, isStreaming, sendMessage, stop } = useChatStream()
  // 只订阅需要的两个字段，避免无关字段（temperature 之类）变化触发重渲染。
  const model = useSettings((s) => s.model)
  const hasApiKey = useSettings((s) => Boolean(s.apiKey))

  const isEmpty = messages.length === 0

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col">
      {/* 顶部条：当前模型 + API Key 配置提示 */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 text-sm">
        <Bot className="size-4 text-muted-foreground" />
        <span className="font-medium">{model || "未配置模型"}</span>
        {!hasApiKey && (
          <span className="ml-auto text-xs text-muted-foreground">
            尚未配置 API Key —— 请打开「设置」
          </span>
        )}
      </header>

      {/* 中间：消息列表或欢迎页（互斥） */}
      {isEmpty ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              欢迎使用 CocoaChat
            </h1>
            <p className="text-sm text-muted-foreground">
              自带 API Key 的 AI 聊天客户端。聊天记录只存在你的浏览器里。
              <br />
              {hasApiKey
                ? "直接在下方开始提问吧。"
                : "进入「设置」配置 API Key 后即可开始。"}
            </p>
          </div>
        </div>
      ) : (
        <MessageList messages={messages} isStreaming={isStreaming} />
      )}

      <ChatInput
        isStreaming={isStreaming}
        onSend={sendMessage}
        onStop={stop}
      />
    </main>
  )
}
