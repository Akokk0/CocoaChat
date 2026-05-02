"use client"

import { useEffect, useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { toast } from "sonner"

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
import { Input } from "@/components/ui/input"
import { useSettings } from "@/lib/store/settingsStore"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: Props) {
  // 取当前 store 值。这里订阅整个 store，
  // 但因为 Dialog 平时不渲染（only 当 open=true），开销可接受。
  const apiKey = useSettings((s) => s.apiKey)
  const baseURL = useSettings((s) => s.baseURL)
  const model = useSettings((s) => s.model)
  const setSettings = useSettings((s) => s.setSettings)

  // 草稿状态：编辑期间不直接改 store，点保存才提交。
  // 这样支持"取消"语义，也避免每次按键都打一次 IndexedDB 写。
  const [draft, setDraft] = useState({ apiKey, baseURL, model })
  const [showKey, setShowKey] = useState(false)

  // 每次打开 Dialog 时把草稿同步成当前 store 值。
  // 重要：避免 hydrate 完后，store 已经是新值但草稿还停留在 SSR 时的空值。
  useEffect(() => {
    if (open) {
      setDraft({ apiKey, baseURL, model })
      setShowKey(false)
    }
  }, [open, apiKey, baseURL, model])

  const handleSave = () => {
    setSettings({
      apiKey: draft.apiKey.trim(),
      // 空字符串时回退默认，免得用户清空了 baseURL 又没补
      baseURL: draft.baseURL.trim() || "https://api.openai.com/v1",
      model: draft.model.trim() || "gpt-4o-mini",
    })
    toast.success("设置已保存")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>
            API Key 仅保存在本浏览器（IndexedDB），不会上传到服务器。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* API Key */}
          <div className="grid gap-1.5">
            <label htmlFor="apiKey" className="text-xs font-medium">
              API Key
            </label>
            <div className="flex gap-1.5">
              <Input
                id="apiKey"
                type={showKey ? "text" : "password"}
                placeholder="sk-..."
                value={draft.apiKey}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, apiKey: e.target.value }))
                }
                // 不让浏览器把 API Key 记到自动填充里
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
              >
                {showKey ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Base URL */}
          <div className="grid gap-1.5">
            <label htmlFor="baseURL" className="text-xs font-medium">
              Base URL
            </label>
            <Input
              id="baseURL"
              placeholder="https://api.openai.com/v1"
              value={draft.baseURL}
              onChange={(e) =>
                setDraft((d) => ({ ...d, baseURL: e.target.value }))
              }
              spellCheck={false}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              改成 DeepSeek / Moonshot / Ollama 等 OpenAI 兼容端点即可。
            </p>
          </div>

          {/* Model */}
          <div className="grid gap-1.5">
            <label htmlFor="model" className="text-xs font-medium">
              Model
            </label>
            <Input
              id="model"
              placeholder="gpt-4o-mini"
              value={draft.model}
              onChange={(e) =>
                setDraft((d) => ({ ...d, model: e.target.value }))
              }
              spellCheck={false}
              className="font-mono"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">取消</Button>} />
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
