"use client"

// 单条消息渲染。
// Stage 5 给它加了三件事：
//   1) 复制按钮（user / assistant 都有）
//   2) 编辑按钮（仅 user）——点击后内嵌 textarea 改写内容，确认会触发"截断 + 重发"
//   3) 重新生成按钮（仅当本条是最后一条 assistant、且非流式时）
//
// 所有"做什么"都通过 onEdit / onRegenerate 回调上抛，本组件只管渲染——
// 让它好测、好替换；将来要把按钮换成 dropdown 也只动这里。

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
  // 流式光标只在"正在写的最后一条 assistant 消息"上闪。
  showCursor?: boolean
  // 是否是消息列表里"最后一条"——影响重发按钮显隐。
  isLastMessage?: boolean
  // 流式期间隐藏所有操作按钮——避免用户在写到一半时点编辑/重发。
  isStreaming?: boolean
  // user 消息编辑确认时调用。父层做"截断 + 重发"。
  onEdit?: (messageId: string, newContent: string) => void
  // 最后一条 assistant 消息的"重新生成"。
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

  // 编辑态：仅对 user 消息开放。
  // 草稿状态本地存——退出编辑（取消/保存）后释放。
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 进入编辑态时把光标聚焦并把游标放到最后——比起从头开始更符合"修改已有内容"心智。
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

  // 操作按钮何时显示：
  //   - 编辑态本身就是另一种 UI，不显示常规工具条
  //   - 流式期间隐藏，免得用户中途点
  //   - 没内容（assistant 占位）也不显示
  const showToolbar =
    !isEditing && !isStreaming && message.content.length > 0
  const showRegenerate =
    showToolbar && !isUser && isLastMessage && Boolean(onRegenerate)
  const showEdit = showToolbar && isUser && Boolean(onEdit)

  return (
    <div
      className={cn(
        // group 让子元素能用 group-hover: 控制工具条显隐
        "group/msg flex w-full gap-3",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      {/* 头像 */}
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

      {/* 气泡 + 工具条堆叠在同一列。
          flex flex-col 让工具条贴在气泡正下方。
          items-end / items-start 控制工具条相对气泡左右对齐。
          min-w-0 至关重要：作为外层 flex-row 的子项，默认 min-width:auto = min-content，
          含长代码行 (pre 不可换行) 时会被撑到内容宽度——max-w 形同虚设。
          min-w-0 覆盖默认值，让这个列容器可以收缩到 0~max-w 之间，
          气泡内的 pre 才能真正触发自己的 overflow-x-auto 内部滚动。 */}
      <div
        className={cn(
          "flex min-w-0 max-w-[min(80%,640px)] flex-col gap-1",
          isUser ? "items-end" : "items-start",
        )}
      >
        {/* 气泡或编辑框，二选一 */}
        {isEditing ? (
          // 编辑态：宽度撑满气泡列，textarea 自适应行高（field-sizing-content 已在组件内）。
          <div className="flex w-full flex-col gap-2 rounded-2xl bg-muted p-2">
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter 保存、Shift+Enter 换行——和 ChatInput 保持一致。
                // Escape 取消，符合大多数 IDE/编辑器的肌肉记忆。
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
              // min-w-0 + max-w-full 双保险：列容器 items-end/start 让气泡按内容宽度收缩，
              // 但 pre 的 min-content 仍可能撑大它——max-w-full 锁住父级宽度，
              // min-w-0 允许子元素的 overflow-x-auto 启动滚动。
              "min-w-0 max-w-full rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
              isUser
                ? "rounded-tr-sm bg-primary text-primary-foreground"
                : "rounded-tl-sm bg-muted text-foreground",
            )}
          >
            {/* user 消息：whitespace-pre-wrap 保留换行和多空格——
                普通用户输入很少写 markdown，强行解析反而把 *foo* 变斜体会让人困惑。
                assistant 消息：走 MessageContent（react-markdown + Shiki 高亮）。
                光标贴在内容尾部——markdown 模式下放在外层不影响代码块渲染。 */}
            {isUser ? (
              <div className="whitespace-pre-wrap wrap-break-word">
                {message.content}
              </div>
            ) : (
              <div className="wrap-break-word">
                <MessageContent content={message.content} />
                {showCursor && (
                  <span
                    className="ml-0.5 inline-block animate-pulse font-mono"
                    aria-hidden
                  >
                    ▍
                  </span>
                )}
              </div>
            )}
            {/* user 也想要光标？目前只有 assistant 流式——user 不需要。 */}
          </div>
        )}

        {/* 工具条：hover 出现，固定占位但默认透明——避免出现/消失时撑动布局。 */}
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
