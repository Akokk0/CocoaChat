"use client"

// ChatView 也是客户端组件——发送按钮、textarea 输入都需要交互。

import { useState } from "react"
import { ArrowUp, Bot } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"

export function ChatView() {
  // 当前输入框的内容。受控组件——React 状态作为唯一数据源。
  const [input, setInput] = useState("")

  // Stage 1 还没接 LLM，发送按钮先打印到 console。
  const handleSend = () => {
    if (!input.trim()) return
    console.log("[占位] 用户消息:", input)
    setInput("")
  }

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col">
      {/* 顶部条：未来显示会话标题、模型名 */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 text-sm">
        <Bot className="size-4 text-muted-foreground" />
        <span className="text-muted-foreground">未配置模型</span>
      </header>

      {/* 消息列表（占位）*/}
      <ScrollArea className="flex-1">
        <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-3 px-4 py-12 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            欢迎使用 CocoaChat
          </h1>
          <p className="max-w-md text-sm text-muted-foreground">
            自带 API Key 的 AI 聊天客户端。聊天记录只存在你的浏览器里。
            <br />
            进入「设置」配置 API Key 后即可开始。
          </p>
        </div>
      </ScrollArea>

      {/* 底部输入区 */}
      <div className="border-t border-border bg-background px-4 py-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter 发送、Shift+Enter 换行——是聊天 UI 的事实标准。
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="给 CocoaChat 发消息…（Shift+Enter 换行）"
            rows={1}
            className="max-h-40 min-h-10 resize-none"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim()}
            aria-label="发送"
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
    </main>
  )
}
