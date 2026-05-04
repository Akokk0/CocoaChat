// 注意这个文件没有 "use client"。
// page.tsx 默认是 Server Component（在服务端渲染，零 JS 体积）。
// 真正的 client 边界在 AppShell——把"移动端 drawer 开关"这个共享 state
// 隔离在那里，page 本身不用变成 client。这是 App Router 的常见模式：
// 根 layout / page 越浅越好，client state 用专门的 wrapper 组件承载。

import { AppShell } from "@/components/layout/AppShell"

export default function Home() {
  return <AppShell />
}
