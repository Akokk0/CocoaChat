"use client"

import { useState } from "react"
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
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { useSettings } from "@/lib/store/settingsStore"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// 外层只管 Dialog 挂载与否；内容拆给 SettingsForm 子组件，
// 用 `{open && <Form />}` conditional render 让"打开 dialog 时草稿同步成最新 store 值"
// 通过新挂载实现——比 useEffect 同步 setState 更符合 React 19 心智，也避开 lint 警告。
export function SettingsDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>
            API Key 仅保存在本浏览器（IndexedDB），不会上传到服务器。
          </DialogDescription>
        </DialogHeader>

        {open && <SettingsForm onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

interface FormProps {
  onClose: () => void
}

function SettingsForm({ onClose }: FormProps) {
  // useState 的 lazy initializer 只在组件挂载时跑一次。
  // 我们在父级靠 conditional render 保证「每次 dialog 打开都是新挂载」，
  // 所以这一次就足够拿到 hydrate 后的最新 store 值——不需要 effect 同步。
  // 直接读 getState()（不订阅）：编辑期间 store 不会从外部被改，订阅没意义。
  const [draft, setDraft] = useState(() => {
    const s = useSettings.getState()
    return {
      apiKey: s.apiKey,
      baseURL: s.baseURL,
      model: s.model,
      systemPrompt: s.systemPrompt,
      temperature: s.temperature,
      // maxTokens 用 string 装——number input 空值会变 NaN，string 简单很多。
      maxTokens: s.maxTokens === null ? "" : String(s.maxTokens),
    }
  })
  const [showKey, setShowKey] = useState(false)

  // setSettings 是 zustand 的稳定引用，订阅它不会引起重渲染。
  const setSettings = useSettings((s) => s.setSettings)

  const handleSave = () => {
    // maxTokens：空串 / 非法 → null（让 provider 默认）；正整数 → 直接用。
    const mt = draft.maxTokens.trim()
    let parsedMaxTokens: number | null = null
    if (mt) {
      const n = Number(mt)
      if (Number.isFinite(n) && n > 0) {
        parsedMaxTokens = Math.floor(n)
      } else {
        toast.error("Max Tokens 需要正整数，留空表示不限制")
        return
      }
    }

    setSettings({
      apiKey: draft.apiKey.trim(),
      // 空字符串时回退默认，免得用户清空了 baseURL 又没补
      baseURL: draft.baseURL.trim() || "https://api.openai.com/v1",
      model: draft.model.trim() || "gpt-4o-mini",
      systemPrompt: draft.systemPrompt, // 不 trim——允许用户写以空格起头的 prompt
      temperature: draft.temperature,
      maxTokens: parsedMaxTokens,
    })
    toast.success("设置已保存")
    onClose()
  }

  return (
    <>
      {/* max-h + overflow-y：参数多了 dialog 会很高，这里给个最大高度让内部滚动 */}
      <div className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1">
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

        {/* System Prompt（全局默认）。
            单条会话可以在 ChatView header 里覆盖——本字段是"没覆盖时的兜底"。 */}
        <div className="grid gap-1.5">
          <label htmlFor="systemPrompt" className="text-xs font-medium">
            System Prompt（全局默认）
          </label>
          <Textarea
            id="systemPrompt"
            placeholder="例如：你是一个简洁的代码助手，只回答与编程相关的问题。"
            value={draft.systemPrompt}
            onChange={(e) =>
              setDraft((d) => ({ ...d, systemPrompt: e.target.value }))
            }
            rows={3}
            className="text-sm"
          />
          <p className="text-xs text-muted-foreground">
            对所有新会话生效。每个会话也可单独覆盖。
          </p>
        </div>

        {/* Temperature slider。
            base-ui 的 Slider 用 value 数组，单 thumb 传 [num]。 */}
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="temperature" className="text-xs font-medium">
              Temperature
            </label>
            <span className="font-mono text-xs text-muted-foreground">
              {draft.temperature.toFixed(2)}
            </span>
          </div>
          <Slider
            id="temperature"
            value={[draft.temperature]}
            onValueChange={(v) =>
              setDraft((d) => ({
                ...d,
                // base-ui 的 onValueChange 对单 thumb 也回数组——取第一个。
                temperature: Array.isArray(v) ? v[0] : v,
              }))
            }
            min={0}
            max={2}
            step={0.1}
          />
          <p className="text-xs text-muted-foreground">
            越低越确定（适合代码 / 翻译），越高越发散（适合创意）。
          </p>
        </div>

        {/* Max Tokens。
            留空 = 不传 max_tokens 给 provider，由它使用默认值。 */}
        <div className="grid gap-1.5">
          <label htmlFor="maxTokens" className="text-xs font-medium">
            Max Tokens
          </label>
          <Input
            id="maxTokens"
            type="text"
            inputMode="numeric"
            placeholder="留空 = 不限制"
            value={draft.maxTokens}
            onChange={(e) =>
              setDraft((d) => ({ ...d, maxTokens: e.target.value }))
            }
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            单次回复最大长度。不知道填多少就留空。
          </p>
        </div>
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline">取消</Button>} />
        <Button onClick={handleSave}>保存</Button>
      </DialogFooter>
    </>
  )
}
