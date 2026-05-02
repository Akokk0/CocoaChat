"use client"

import { useState } from "react"
import { ArrowUp, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface Props {
  isStreaming: boolean
  onSend: (content: string) => void
  onStop: () => void
}

export function ChatInput({ isStreaming, onSend, onStop }: Props) {
  // 输入值是 ChatInput 的私事——父组件只关心"用户按下了发送"。
  // 把 input 状态留在内部，外部只通过 onSend 接收最终值，
  // 是「容器/展示」分离里"展示"的标准姿势。
  const [input, setInput] = useState("")

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setInput("") // 立即清空，让用户接着打下一条
  }

  return (
    <div className="border-t border-border bg-background px-4 py-4">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter 发送、Shift+Enter 换行——聊天 UI 的事实标准。
            // IME 输入法组合期间（拼音/日文）按 Enter 是确认候选，
            // e.nativeEvent.isComposing 在所有现代浏览器都可用，必须排除。
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder={
            isStreaming
              ? "AI 正在回答…（点右侧按钮可停止）"
              : "给 CocoaChat 发消息…（Shift+Enter 换行）"
          }
          rows={1}
          // 流式时锁住输入框：
          // - 防止用户连点回车开第二条请求（abortRef 那边也有一道，这是双保险）
          // - 视觉提示"现在不该输入"
          disabled={isStreaming}
          className="max-h-40 min-h-10 resize-none"
        />
        {isStreaming ? (
          <Button
            size="icon"
            variant="secondary"
            onClick={onStop}
            aria-label="停止生成"
          >
            <Square className="size-4 fill-current" />
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim()}
            aria-label="发送"
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
