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
  const [input, setInput] = useState("")

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setInput("")
  }

  return (
    <div className="border-t border-border bg-background px-4 py-4">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // IME 组合期（拼音/日文）按 Enter 是确认候选——必须用 isComposing 排除。
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
          disabled={isStreaming}
          // min-w-0 让 flex 子项可收缩——textarea 默认 min-width 由 cols 派生，否则窄屏溢出。
          className="max-h-40 min-h-10 min-w-0 flex-1 resize-none"
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
