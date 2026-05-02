"use client"

import { useEffect, useRef } from "react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { MessageItem } from "@/components/chat/MessageItem"
import type { ChatMessage } from "@/lib/types/chat"

interface Props {
  messages: ChatMessage[]
  isStreaming: boolean
}

export function MessageList({ messages, isStreaming }: Props) {
  // 滚动到底锚点：在列表尾巴放一个空 div，每次有新内容就把它 scrollIntoView。
  // 比手动算 scrollTop = scrollHeight 更稳，浏览器自己处理浮点边界。
  const bottomRef = useRef<HTMLDivElement>(null)

  // 依赖：消息条数 + 最后一条 content 长度。
  // 只看 messages.length 不够——流式时长度不变但 content 在涨；
  // 看整个 messages 数组又会因为引用每次都变导致 effect 频繁触发，性能不必要。
  // 取最后一条的 content.length 是个折中：既反映流式增量，又是 O(1) 比较。
  const last = messages[messages.length - 1]
  const lastLen = last?.content.length ?? 0

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages.length, lastLen])

  // 空状态：直接给 ChatView 处理欢迎页，这里只在有消息时渲染列表。
  // 但保留组件作为"消息列表"的单一入口，避免 ChatView 既管欢迎页又管列表。
  return (
    <ScrollArea className="flex-1">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        {messages.map((m, i) => {
          // 光标只显示在"正在被流式写入的最后一条 assistant 消息"上。
          const isLast = i === messages.length - 1
          const showCursor =
            isStreaming && isLast && m.role === "assistant"
          return (
            <MessageItem key={m.id} message={m} showCursor={showCursor} />
          )
        })}
        <div ref={bottomRef} aria-hidden />
      </div>
    </ScrollArea>
  )
}
