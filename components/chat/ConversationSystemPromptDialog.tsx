"use client"

// 会话级 system prompt：非空覆盖全局，留空回退；规则在 useChatStream.runStream 实现。

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

// 拆 inner 子组件 + conditional render，让 useState lazy init 一次性拿最新 store 值。
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
  const globalSystemPrompt = useSettings((s) => s.systemPrompt)

  const [draft, setDraft] = useState(() => {
    const conv = useChatStore
      .getState()
      .conversations.find((c) => c.id === conversationId)
    return conv?.systemPrompt ?? ""
  })

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

        <div className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">
          <div className="mb-1 font-medium">全局默认</div>
          <div className="whitespace-pre-wrap font-mono">
            {globalSystemPrompt.trim() || "（未设置）"}
          </div>
        </div>
      </div>

      <DialogFooter className="flex-row justify-between sm:justify-between">
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
