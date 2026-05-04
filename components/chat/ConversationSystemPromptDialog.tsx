"use client"

// 会话级 system prompt 编辑 Dialog。
// 优先级语义：
//   - 字段非空 → 本会话用这条 system，覆盖全局
//   - 字段为空 → 沿用 settingsStore 里的全局 systemPrompt
// 这两条规则在 useChatStream.runStream 里实现（`conv.systemPrompt ?? settings.systemPrompt`）。

import { useState } from "react"

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useChatStore } from "@/lib/store/chatStore"
import { useSettings } from "@/lib/store/settingsStore"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversationId: string | null
}

// 同 SettingsDialog：拆 inner 子组件 + conditional render，
// 让 useState 的 lazy init 拿一次最新 store 值即可——避免在 effect 里 setState 触发 cascading rerender。
export function ConversationSystemPromptDialog({
  open,
  onOpenChange,
  conversationId,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>会话系统提示</DialogTitle>
          <DialogDescription>
            仅对当前会话生效；留空则使用全局默认。
          </DialogDescription>
        </DialogHeader>

        {open && conversationId && (
          <PromptForm
            conversationId={conversationId}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

interface FormProps {
  conversationId: string
  onClose: () => void
}

function PromptForm({ conversationId, onClose }: FormProps) {
  const setConversationSystemPrompt = useChatStore(
    (s) => s.setConversationSystemPrompt,
  )
  // 全局 systemPrompt 给个对照——用户能直观看到"留空"会回退到什么。
  const globalSystemPrompt = useSettings((s) => s.systemPrompt)

  // 挂载时（即 dialog 打开时）取一次该会话的当前 systemPrompt——以后由 draft 自治。
  const [draft, setDraft] = useState(() => {
    const conv = useChatStore
      .getState()
      .conversations.find((c) => c.id === conversationId)
    return conv?.systemPrompt ?? ""
  })

  // 是否已经覆盖（影响"使用全局默认"按钮 disabled 状态）。
  // 也是从 store 当下值取——和 draft 解耦：用户在编辑期间不会改变"是否已覆盖"的事实。
  const hasOverride = Boolean(
    useChatStore
      .getState()
      .conversations.find((c) => c.id === conversationId)
      ?.systemPrompt?.trim(),
  )

  const handleSave = async () => {
    await setConversationSystemPrompt(conversationId, draft)
    onClose()
  }

  const handleClear = async () => {
    // 清空 = 解除覆盖，回退到全局。
    await setConversationSystemPrompt(conversationId, "")
    onClose()
  }

  return (
    <>
      <div className="grid gap-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="例如：你是中英翻译助手。请把用户消息直接翻译成英文，不要解释。"
          rows={5}
          className="text-sm"
        />

        {/* 当字段为空时给一段提示，告诉用户"会回退到这条全局" */}
        <div className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">
          <div className="mb-1 font-medium">全局默认</div>
          <div className="whitespace-pre-wrap font-mono">
            {globalSystemPrompt.trim() || "（未设置）"}
          </div>
        </div>
      </div>

      <DialogFooter className="flex-row justify-between sm:justify-between">
        {/* 左侧：清除覆盖（即清空字段并保存） */}
        <Button
          type="button"
          variant="ghost"
          onClick={handleClear}
          disabled={!hasOverride}
        >
          使用全局默认
        </Button>
        <div className="flex gap-2">
          <DialogClose render={<Button variant="outline">取消</Button>} />
          <Button onClick={handleSave}>保存</Button>
        </div>
      </DialogFooter>
    </>
  )
}
