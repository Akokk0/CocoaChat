"use client"

import { Bot, User } from "lucide-react"

import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/lib/types/chat"

interface Props {
  message: ChatMessage
  // 流式光标只在"正在写的最后一条 assistant 消息"上闪。
  // 把判断逻辑放父组件、这里只接收一个 bool，符合「容器组件 vs 展示组件」的分工。
  showCursor?: boolean
}

export function MessageItem({ message, showCursor = false }: Props) {
  const isUser = message.role === "user"

  return (
    <div
      className={cn(
        "flex w-full gap-3",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      {/* 头像/角色图标 */}
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>

      {/* 消息气泡 */}
      <div
        className={cn(
          "max-w-[min(80%,640px)] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "rounded-tr-sm bg-primary text-primary-foreground"
            : "rounded-tl-sm bg-muted text-foreground",
        )}
      >
        {/* whitespace-pre-wrap：保留换行和多空格但不溢出。
            Stage 6 会换成 react-markdown 渲染。 */}
        <div className="whitespace-pre-wrap break-words">
          {message.content}
          {/* 流式光标：用 ▍ 字符 + 自定义 keyframe 闪烁。
              放在文字后面而不是单独 div，这样换行时光标自然贴在最后一个字旁边。 */}
          {showCursor && (
            <span
              className="ml-0.5 inline-block animate-pulse font-mono"
              aria-hidden
            >
              ▍
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
