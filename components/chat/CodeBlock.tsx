"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { highlightCode } from "@/lib/shiki"
import { cn } from "@/lib/utils"

interface Props {
  children: string
  lang?: string
}

export function CodeBlock({ children, lang }: Props) {
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // children 末尾可能带 \n（markdown 解析副产物）；不动原始 children 以便复制原文。
  const code = children.replace(/\n$/, "")

  useEffect(() => {
    let cancelled = false
    highlightCode(code, lang)
      .then((output) => {
        if (!cancelled) setHtml(output)
      })
      .catch(() => {
        if (!cancelled) setHtml(null)
      })
    return () => {
      // 流式期间 children 在涨；cancelled flag 阻止旧高亮覆盖新内容。
      cancelled = true
    }
  }, [code, lang])

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(() => {
        setCopied(false)
        copiedTimerRef.current = null
      }, 2000)
    } catch {
      toast.error("复制失败：浏览器拒绝访问剪贴板")
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-muted/40 text-sm">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-3 text-xs">
        <span className="font-mono text-muted-foreground">
          {lang || "text"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground"
          onClick={handleCopy}
          aria-label={copied ? "已复制" : "复制代码"}
          title={copied ? "已复制" : "复制代码"}
        >
          {copied ? (
            <Check className="size-3.5 text-primary" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </Button>
      </div>

      {html ? (
        <div
          className={cn(
            "[&_pre]:overflow-x-auto [&_pre]:bg-transparent [&_pre]:p-3 [&_pre]:text-[13px] [&_pre]:leading-relaxed",
          )}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed font-mono">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
