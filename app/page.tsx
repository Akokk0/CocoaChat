// 注意这个文件没有 "use client"。
// page.tsx 默认是 Server Component（在服务端渲染，零 JS 体积）。
// 我们只把真正需要交互的子组件标记为 "use client"。
// 这是 App Router 的核心心智模型：组件树根部尽量是 server，叶子才 client。

import { Sidebar } from "@/components/layout/Sidebar"
import { ChatView } from "@/components/layout/ChatView"

export default function Home() {
  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <Sidebar />
      <ChatView />
    </div>
  )
}
