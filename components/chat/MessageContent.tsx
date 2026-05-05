"use client"

// react-markdown 默认 XSS 安全：raw HTML 不渲染、javascript: 协议被剥；不开 rehype-raw。

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Components } from "react-markdown"

import { CodeBlock } from "@/components/chat/CodeBlock"

const components: Components = {
  // 透明掉 pre 让 CodeBlock 接管块级布局（CodeBlock 自带 div 容器）。
  pre: ({ children }) => <>{children}</>,

  code: ({ className, children, ...props }) => {
    const text = String(children ?? "")
    const match = /language-(\w+)/.exec(className ?? "")
    if (match) {
      return <CodeBlock lang={match[1]}>{text}</CodeBlock>
    }
    return (
      <code
        className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em]"
        {...props}
      >
        {children}
      </code>
    )
  },

  p: ({ children }) => <p className="leading-relaxed">{children}</p>,

  h1: ({ children }) => (
    <h1 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-3 mb-1.5 text-sm font-medium first:mt-0">{children}</h4>
  ),

  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,

  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 italic text-muted-foreground">
      {children}
    </blockquote>
  ),

  // rel=noopener 防 window.opener 攻击；noreferrer 不上传 Referer。
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),

  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,

  hr: () => <hr className="my-3 border-border" />,

  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  tr: ({ children }) => (
    <tr className="border-b border-border last:border-0">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-1.5 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="px-3 py-1.5">{children}</td>,
}

interface Props {
  content: string
  // 流式光标走最后一个 block 的 ::after 伪元素（globals.css 里 .streaming > *:last-child::after）——
  // 兄弟 span 会被块级元素挤到下一行。
  showCursor?: boolean
}

export function MessageContent({ content, showCursor }: Props) {
  return (
    <div
      className={
        showCursor
          ? "streaming text-sm [&>*+*]:mt-2"
          : "text-sm [&>*+*]:mt-2"
      }
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
