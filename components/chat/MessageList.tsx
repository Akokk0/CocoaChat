"use client"

import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"

import { ScrollArea } from "@/components/ui/scroll-area"
import { MessageItem } from "@/components/chat/MessageItem"
import { useChatStore } from "@/lib/store/chatStore"
import type { ChatMessage } from "@/lib/types/chat"

interface Props {
  messages: ChatMessage[]
  isStreaming: boolean
  onEdit?: (messageId: string, newContent: string) => void
  onRegenerate?: () => void
}

export function MessageList({
  messages,
  isStreaming,
  onEdit,
  onRegenerate,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // 取最后一条 content.length 作为流式增量信号——只看 length 漏流式增长，看整个 messages 引用每帧都变。
  const last = messages[messages.length - 1]
  const lastLen = last?.content.length ?? 0

  // 切会话用 instant 直接定位，同会话内增量用 smooth；用 currentId 而非 firstId
  // 才能正确识别"A→B→A"这种 length 涨但 firstId 不变的跳转。
  const currentId = useChatStore((s) => s.currentId)
  const prevConvIdRef = useRef<string | null>(null)

  useEffect(() => {
    const conversationChanged = prevConvIdRef.current !== currentId
    bottomRef.current?.scrollIntoView({
      behavior: conversationChanged ? "instant" : "smooth",
      block: "end",
    })
    prevConvIdRef.current = currentId
  }, [messages.length, lastLen, currentId])

  // render-phase setState 派生 prev props——只让"刚 append 的最后一条"跑入场动画，
  // 切会话一次涨 N 条不会瀑布；同时绕开 React 19 的 react-hooks/refs 与 set-state-in-effect 两条 lint。
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [prevLen, setPrevLen] = useState(0)
  const [justAppendedOne, setJustAppendedOne] = useState(false)
  if (messages.length !== prevLen) {
    setPrevLen(messages.length)
    setJustAppendedOne(messages.length - prevLen === 1)
  }

  const reduceMotion = useReducedMotion()

  return (
    // min-h-0：flex item 默认 min-height:auto = 内容高度，会把 main 撑到几千像素并连累 row 兄弟。
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1
          const showCursor =
            isStreaming && isLast && m.role === "assistant"
          const animateIn = isLast && justAppendedOne && !reduceMotion
          return (
            <motion.div
              key={m.id}
              // initial={false} 跳过入场——非新增直接秒出现，避免切会话瀑布。
              initial={animateIn ? { opacity: 0, y: 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <MessageItem
                message={m}
                showCursor={showCursor}
                isLastMessage={isLast}
                isStreaming={isStreaming}
                onEdit={onEdit}
                onRegenerate={onRegenerate}
              />
            </motion.div>
          )
        })}
        <div ref={bottomRef} aria-hidden />
      </div>
    </ScrollArea>
  )
}
