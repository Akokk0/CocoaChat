"use client"

// 主聊天区。
// 数据源分两块：
//   - chatStore：messages、currentId、isHydrated
//   - useChatStream：isStreaming + sendMessage + stop（流式编排）
// 这种"状态在 store / 行为在 hook"的拆分让组件本身只管渲染。

import { Bot } from "lucide-react"

import { ChatInput } from "@/components/chat/ChatInput"
import { MessageList } from "@/components/chat/MessageList"
import { useChatStream } from "@/lib/hooks/useChatStream"
import { useChatStore } from "@/lib/store/chatStore"
import { useSettings } from "@/lib/store/settingsStore"

export function ChatView() {
  const { isStreaming, sendMessage, stop } = useChatStream()

  // 字段级订阅。任何一个字段变化，本组件最少重渲染。
  const messages = useChatStore((s) => s.messages)
  const currentId = useChatStore((s) => s.currentId)
  const isHydrated = useChatStore((s) => s.isHydrated)

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
