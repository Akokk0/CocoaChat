"use client"

// AI 消息体的 Markdown 渲染。
//
// 设计要点：
//   - react-markdown 默认就 XSS 安全：raw HTML 默认不渲染，链接里 javascript: 协议会被剥
//   - 不开 rehype-raw（开了就会渲染 raw HTML，前端聊天场景下风险大）
//   - 代码块走 CodeBlock（Shiki 高亮 + 复制按钮）；内联代码走简单样式
//   - 流式期间也用同样组件——markdown 解析器对"半截 markdown"很宽容，
//     ` ```ts\nfoo` 这种没闭合的会被解析成"行内 + 普通文本"或最后一段被吞——
//     等下一个 chunk 来内容自动补全。
//
// 为什么不用 @tailwindcss/typography 的 prose：
//   多一个依赖、prose 默认色板和我们的 OKLCH 主题需要再 override 一遍——
//   markdown 元素就那么十来个，手写 components mapping 比拉巨型库直接。

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Components } from "react-markdown"

import { CodeBlock } from "@/components/chat/CodeBlock"

// react-markdown v10 的 components prop：
//   - 不再有 `inline` 字段；判定靠"是否在 <pre> 里"
//   - 我们用 className 上的 language-* 前缀作 block 信号
//   - pre 渲染成 fragment：让 code 自己接管 block 布局（CodeBlock 自带 div 容器）
const components: Components = {
  // 透明掉 pre 包装——CodeBlock 自带容器；inline code 也用不到 pre。
  pre: ({ children }) => <>{children}</>,

  code: ({ className, children, ...props }) => {
    const text = String(children ?? "")
    const match = /language-(\w+)/.exec(className ?? "")
    if (match) {
      // 块级代码块（``` ... ```）。lang 取捕获组。
      return <CodeBlock lang={match[1]}>{text}</CodeBlock>
    }
    // 内联代码（`foo`）。bg-muted 与气泡背景区分。
    return (
      <code
        className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em]"
        {...props}
      >
        {children}
      </code>
    )
  },

  // 段落：保留默认 leading + 适度上下边距。
  // first/last 去边距，避免气泡内首末段挤到边框。
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,

  // 标题。聊天里 h1 显得突兀——按 chat 场景缩小一档：h1 ≈ 设计稿 h3。
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

  // 列表。list-inside 让 marker 跟文本同列；外侧 padding 让多级缩进看得出层次。
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,

  // 引用：左边贴一道 border + 字色变 muted。
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 italic text-muted-foreground">
      {children}
    </blockquote>
  ),

  // 链接：primary 色 + underline。target=_blank 让外链不顶替本页。
  // rel=noopener 防止新页面 window.opener 攻击；noreferrer 不上传 Referer。
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

  // 强调：粗体 / 斜体。简单。
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,

  // 分隔线。
  hr: () => <hr className="my-3 border-border" />,

  // GFM 表格。带边框 + 横滚（窄屏不撑爆气泡）。
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
}

export function MessageContent({ content }: Props) {
  return (
    // text-sm 跟气泡基础字号同；leading 由各元素自管。
    // [&>*+*]:mt-2 让相邻块级元素之间均匀留白——比每个元素自管 margin 更稳。
    <div className="text-sm [&>*+*]:mt-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
