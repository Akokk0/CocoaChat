"use client"

// 代码块——围绕 Shiki dual-theme HTML 输出 + 顶栏的语言标签 + 复制按钮。
//
// 流式注意：assistant 边写边吐，children 会在每个 chunk 后变长。
// 我们 useEffect 的 deps 包含 children——每次内容变就异步重高亮。
// Shiki 单次高亮 < 5ms 一般，性能没压力；不做 throttle。
//
// fallback：highlighter 还没 ready（首次加载几百毫秒）或高亮失败时，
// 显示纯 <pre> + 单色样式——内容立刻可读，不会闪空。

import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { highlightCode } from "@/lib/shiki"
import { cn } from "@/lib/utils"

interface Props {
  // react-markdown 给 code 组件的 children 是字符串（可能尾部带个 \n）。
  children: string
  // ```ts 之类的语言标记；可能为空（纯 ```）。
  lang?: string
  // 内联代码（`foo` 这种）和块级代码同享 <code> 元素，但渲染完全不同。
  // 内联代码不进 CodeBlock——MessageContent 里走另外一个分支。
}

export function CodeBlock({ children, lang }: Props) {
  // 高亮后的 HTML。null = 还没好；fallback 渲染纯文本。
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // 「已复制」状态自动复位的定时器——挂载时存 ref，卸载时清掉，
  // 避免 timer fire 在已卸载组件上 setState（React 会发警告，且白白浪费一次渲染调度）。
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // children 可能末尾有个 \n（markdown 解析的副产物），高亮前去掉。
  // 不动原始 children——复制功能要给用户复制原文。
  const code = children.replace(/\n$/, "")

  useEffect(() => {
    let cancelled = false
    highlightCode(code, lang)
      .then((output) => {
        if (!cancelled) setHtml(output)
      })
      .catch(() => {
        // 高亮失败（极少见——比如 wasm 加载失败）静默 fallback。
        if (!cancelled) setHtml(null)
      })
    return () => {
      // 流式中 children 在涨——上一轮的 highlight 还没回来下一轮就发起了。
      // cancelled 标志阻止旧结果覆盖新结果（避免"内容回滚"）。
      cancelled = true
    }
  }, [code, lang])

  // 卸载时清掉「已复制」复位定时器——避免 fire 在已卸载组件上。
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      // 2s 后回到 Copy 图标——给用户视觉反馈"操作成功"。
      // 上一次没复位完就再次点击：先清旧定时器，避免提前重置。
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
      {/* 顶栏：语言标签 + 复制按钮。
          h-8 + flex shrink-0 让它不会被代码块压扁。 */}
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

      {/* 高亮主体。
          html ready：dangerouslySetInnerHTML 嵌入 Shiki 的 <pre><code>...</code></pre>。
          html 未 ready / 失败：fallback 渲染原文。
          注意 dangerouslySetInnerHTML 安全性：Shiki 输出的 HTML 是它自己生成的、
          只含 <pre><code><span style=...>，没有用户注入的 raw HTML，安全。 */}
      {html ? (
        <div
          className={cn(
            // shiki 输出的 <pre> 自带 background；我们再叠一层 padding + 滚动。
            // 用 :where() 选择器降低优先级，方便后续覆盖。
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
