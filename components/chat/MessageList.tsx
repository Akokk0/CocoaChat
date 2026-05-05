"use client"

import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"

import { ScrollArea } from "@/components/ui/scroll-area"
import { MessageItem } from "@/components/chat/MessageItem"
import { useChatStore } from "@/lib/store/chatStore"
import type { ChatMessage } from "@/lib/types/chat"

interface Props {
  messages: ChatMessage[]
  isStreaming: boolean
  // Stage 5 加：把"编辑某条 user 消息"和"重发最后 assistant"的回调透传给每条 item。
  // 列表组件本身不知道两件事的语义，只负责把 item 装进容器并接线。
  onEdit?: (messageId: string, newContent: string) => void
  onRegenerate?: () => void
}

export function MessageList({
  messages,
  isStreaming,
  onEdit,
  onRegenerate,
}: Props) {
  // 滚动到底锚点：在列表尾巴放一个空 div，每次有新内容就把它 scrollIntoView。
  // 比手动算 scrollTop = scrollHeight 更稳，浏览器自己处理浮点边界。
  const bottomRef = useRef<HTMLDivElement>(null)

  // 依赖：消息条数 + 最后一条 content 长度。
  // 只看 messages.length 不够——流式时长度不变但 content 在涨；
  // 看整个 messages 数组又会因为引用每次都变导致 effect 频繁触发，性能不必要。
  // 取最后一条的 content.length 是个折中：既反映流式增量，又是 O(1) 比较。
  const last = messages[messages.length - 1]
  const lastLen = last?.content.length ?? 0

  // 区分两种滚动语义：
  //   - "跳转"：首次挂载、切会话——内容整批换，应该瞬时定位到底（smooth 会从上慢慢滚下来）
  //   - "追加"：流式新字、新消息发进来——同一会话内增量，smooth 看起来自然
  // 之前用 messages[0].id 判断，但"用户在 A 流式中切到 B → 切回 A"时 firstId 没变、
  // 只是 length 涨了，会被误判成"追加"，从中间慢慢 smooth 滚到底——体验不佳。
  // 改用 currentId：会话身份才是真正的"跳转"信号。
  const currentId = useChatStore((s) => s.currentId)
  const prevConvIdRef = useRef<string | null>(null)

  useEffect(() => {
    const conversationChanged = prevConvIdRef.current !== currentId
    bottomRef.current?.scrollIntoView({
      // "instant" 在主流浏览器都支持；"auto" 是更老的等价回退（多数引擎也是瞬时）。
      behavior: conversationChanged ? "instant" : "smooth",
      block: "end",
    })
    prevConvIdRef.current = currentId
  }, [messages.length, lastLen, currentId])

  // ---- 入场动画判定 ----
  //
  // 目标：只让"刚 append 的最后一条"跑入场动画——
  //   - 切会话 / 首次 hydrate：一次涨 N 条，全部 instant（避免 N 条瀑布）
  //   - sendMessage 时新增 user → 1 条入场
  //   - appendAssistantPlaceholder → 1 条入场（之后流式更新不再触发动画）
  //
  // 实现：用 React 官方推荐的"render 阶段条件 setState 派生 prev props"模式——
  //   https://react.dev/reference/react/useState#storing-information-from-previous-renders
  // 每次 messages.length 变化时同步两个 state：上次长度 + 是否"刚增 1"。
  // React 在 render 期间检测到 setState 会丢弃当前输出立刻重渲染，第二次渲染
  // 走稳定分支输出真正的 UI——比 useEffect+setState 少一次 commit，
  // 也避开 React 19 的 react-hooks/refs（禁止 render 读 ref）和
  // react-hooks/set-state-in-effect 两条 lint。
  const [prevLen, setPrevLen] = useState(0)
  const [justAppendedOne, setJustAppendedOne] = useState(false)
  if (messages.length !== prevLen) {
    setPrevLen(messages.length)
    setJustAppendedOne(messages.length - prevLen === 1)
  }

  // 尊重操作系统/浏览器的"减少动画"偏好——比如部分用户晕动症会勾选这个。
  // useReducedMotion 是 framer 提供的 hook，订阅 prefers-reduced-motion media query。
  const reduceMotion = useReducedMotion()

  // 空状态：直接给 ChatView 处理欢迎页，这里只在有消息时渲染列表。
  // 但保留组件作为"消息列表"的单一入口，避免 ChatView 既管欢迎页又管列表。
  return (
    // min-h-0 是关键：flex item 默认 min-height:auto = 内容高度，
    // 会把外层 main 撑到几千像素高，导致 row 兄弟（Sidebar）跟着 stretch、
    // 整个页面出现长滚动条。min-h-0 允许它收缩到 < 内容，flex-1 才真正生效。
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        {messages.map((m, i) => {
          // 光标只显示在"正在被流式写入的最后一条 assistant 消息"上。
          const isLast = i === messages.length - 1
          const showCursor =
            isStreaming && isLast && m.role === "assistant"
          // 该不该跑入场动画：必须是"刚 append 的那一条"，且用户没设 reduce motion。
          const animateIn = isLast && justAppendedOne && !reduceMotion
          return (
            <motion.div
              key={m.id}
              // initial=false 直接跳过入场——不是新增的就秒出现，避免切会话瀑布。
              // initial 给对象时 framer 会从该状态过渡到 animate；false 表示"已经在 animate 状态"。
              initial={animateIn ? { opacity: 0, y: 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <MessageItem
                message={m}
                showCursor={showCursor}
                isLastMessage={isLast}
                isStreaming={isStreaming}
                onEdit={onEdit}
                onRegenerate={onRegenerate}
              />
            </motion.div>
          )
        })}
        <div ref={bottomRef} aria-hidden />
      </div>
    </ScrollArea>
  )
}
