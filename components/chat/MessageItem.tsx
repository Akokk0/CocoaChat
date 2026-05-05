"use client"

import { useEffect, useRef, useState } from "react"
import { Bot, Check, Copy, Pencil, RefreshCw, User, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { MessageContent } from "@/components/chat/MessageContent"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/lib/types/chat"

interface Props {
  message: ChatMessage
  showCursor?: boolean
  isLastMessage?: boolean
  isStreaming?: boolean
  onEdit?: (messageId: string, newContent: string) => void
  onRegenerate?: () => void
}

export function MessageItem({
  message,
  showCursor = false,
  isLastMessage = false,
  isStreaming = false,
  onEdit,
  onRegenerate,
}: Props) {
  const isUser = message.role === "user"

  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 进入编辑态把 caret 放到末尾——比从头开始更符合"修改已有内容"心智。
  useEffect(() => {
    if (!isEditing) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
  }, [isEditing])

  function startEdit() {
    setDraft(message.content)
    setIsEditing(true)
  }

  function cancelEdit() {
    setIsEditing(false)
  }

  function commitEdit() {
    const next = draft.trim()
    if (!next || next === message.content.trim()) {
      // 空 / 没改：当作取消，避免误触发一次无意义的重发（费 token）。
      setIsEditing(false)
      return
    }
    setIsEditing(false)
    onEdit?.(message.id, next)
  }

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(message.content)
      toast.success("已复制")
    } catch {
      toast.error("复制失败：浏览器拒绝访问剪贴板")
    }
  }

  const showToolbar =
    !isEditing && !isStreaming && message.content.length > 0
  // 末尾是 user 时也允许重发——流式失败 / 网络错让 user 消息悬空时给一键重试入口。
  const showRegenerate =
    showToolbar && isLastMessage && Boolean(onRegenerate)
  const showEdit = showToolbar && isUser && Boolean(onEdit)

  return (
    <div
      className={cn(
        "group/msg flex w-full gap-3",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
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

      {/* min-w-0 至关重要：flex 子项默认 min-width:auto = min-content，
          含长代码行时会被 pre 撑到内容宽度，max-w 形同虚设。 */}
      <div
        className={cn(
          "flex min-w-0 max-w-[min(80%,640px)] flex-col gap-1",
          isUser ? "items-end" : "items-start",
        )}
      >
        {isEditing ? (
          <div className="flex w-full flex-col gap-2 rounded-2xl bg-muted p-2">
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // IME 组合期 Enter 是确认候选，必须排除。
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault()
                  commitEdit()
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  cancelEdit()
                }
              }}
              className="resize-none border-none bg-transparent p-1 shadow-none focus-visible:ring-0"
              placeholder="编辑后回车重发，Shift+Enter 换行"
            />
            <div className="flex justify-end gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1"
                onClick={cancelEdit}
              >
                <X className="size-3.5" />
                取消
              </Button>
              <Button size="sm" className="h-7 gap-1" onClick={commitEdit}>
                <Check className="size-3.5" />
                保存并重发
              </Button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              // min-w-0 + max-w-full 双保险：max-w-full 锁住父级宽度，
              // min-w-0 允许子元素 overflow-x-auto 启动滚动。
              "min-w-0 max-w-full rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
              isUser
                ? "rounded-tr-sm bg-primary text-primary-foreground"
                : "rounded-tl-sm bg-muted text-foreground",
            )}
          >
            {/* user 消息走 pre-wrap，不解析 markdown——避免 *foo* 被误转斜体。 */}
            {isUser ? (
              <div className="whitespace-pre-wrap wrap-break-word">
                {message.content}
              </div>
            ) : (
              <div className="wrap-break-word">
                <MessageContent
                  content={message.content}
                  showCursor={showCursor}
                />
              </div>
            )}
          </div>
        )}

        {showToolbar && (
          <div className="flex gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground"
              onClick={copyContent}
              aria-label="复制"
              title="复制"
            >
              <Copy className="size-3.5" />
            </Button>
            {showEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground"
                onClick={startEdit}
                aria-label="编辑"
                title="编辑后重发"
              >
                <Pencil className="size-3.5" />
              </Button>
            )}
            {showRegenerate && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground"
                onClick={onRegenerate}
                aria-label="重新生成"
                title="重新生成"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
