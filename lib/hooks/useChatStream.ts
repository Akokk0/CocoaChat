"use client"

// 流式聊天的"行为编排器"。
// Stage 3：messages 还住在这里（useState）。
// Stage 4：messages 搬到 chatStore——hook 只负责把
// 「fetch / abort / 错误处理 / IDB 落盘时机」串起来。
// Stage 5：把 sendMessage 的流程拆成 ensureReady + runStream，
//        让 regenerate / editAndResend 也能复用同一段流式逻辑。
//
// 关注点分离：
//   - chatStore 管"是什么状态"
//   - useChatStream 管"什么时候做什么"
//   - 组件管"怎么渲染"

import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"

import { streamChat } from "@/lib/ai/streamClient"
import { useChatStore } from "@/lib/store/chatStore"
import { useSettings } from "@/lib/store/settingsStore"
import type { ChatMessage } from "@/lib/types/chat"

export function useChatStream() {
  // 流式过程自身的瞬时状态——不属于"持久数据"，留在 hook 里。
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ref 而非 state：换它的值不需要触发重渲染；abort() 是命令式动作。
  const abortRef = useRef<AbortController | null>(null)

  // ---- 内部：跑一次流式请求 ----
  // 调用方负责保证 chatStore.messages 末尾就是要回复的 user 消息——
  // 本函数不 append user，只负责拼上下文 → 流式 → 落盘。
  // 抽出来后 sendMessage / regenerate / editAndResend 三处都共用同一条流水线，
  // 错误/中止/落盘语义只在这一处维护。
  const runStream = useCallback(async (conversationId: string) => {
    const settings = useSettings.getState()
    const chat = useChatStore.getState()

    // 系统提示优先级：会话级 > 全局。
    // 会话级 systemPrompt 在 chatStore 里以 undefined 表示"未设置"——
    // 用 ?? 优先取它，没有再 fallback 全局。
    const conv = chat.conversations.find((c) => c.id === conversationId)
    const sysPrompt = (conv?.systemPrompt ?? settings.systemPrompt).trim()

    // 拼发给 /api/chat 的 messages：[system?] + 当前会话所有消息。
    // 注意：这里读 chat.messages 是顶部 snapshot 的拷贝。在调用 runStream
    // 之前调用方已经把 user / 截断逻辑跑完，messages 已经定型。
    const apiMessages: { role: ChatMessage["role"]; content: string }[] = []
    if (sysPrompt) apiMessages.push({ role: "system", content: sysPrompt })
    for (const m of chat.messages) {
      apiMessages.push({ role: m.role, content: m.content })
    }

    // 占位 assistant 消息：纯内存，流结束后才落盘——避免每个 token 一次 IDB 写。
    const assistantMessage = chat.appendAssistantPlaceholder(conversationId)

    // AbortController：整条 stop 链路的源头。
    // 浏览器 abort → 服务器 request.signal.aborted → openai SDK fetch 关闭 → 上游不再扣 token。
    const controller = new AbortController()
    abortRef.current = controller
    setIsStreaming(true)

    let receivedAnyContent = false

    // 流结束/中止/出错时统一收尾：把已收的内容落盘，没收到则擦掉空占位。
    // 三处都要做这件事，抽成内联函数避免重复。
    const finishMessage = async () => {
      if (receivedAnyContent) {
        await useChatStore
          .getState()
          .persistAssistantMessage(conversationId, assistantMessage.id)
      } else {
        useChatStore.getState().removeLastAssistantIfEmpty(assistantMessage.id)
      }
    }

    try {
      for await (const event of streamChat(
        {
          messages: apiMessages,
          apiKey: settings.apiKey,
          baseURL: settings.baseURL,
          model: settings.model,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
        },
        { signal: controller.signal },
      )) {
        if (event.type === "delta") {
          receivedAnyContent = receivedAnyContent || event.content.length > 0
          // 热路径：只更新内存。简历讲"流式 + 持久化"的写放大优化就指这里。
          useChatStore
            .getState()
            .updateAssistantContent(assistantMessage.id, event.content)
        } else if (event.type === "error") {
          throw new Error(event.message)
        }
        // event.type === "done" 暂不处理；若要展示 finishReason 在这里加。
      }

      await finishMessage()
    } catch (err) {
      if (controller.signal.aborted) {
        // 用户主动停止：不算错——保留已收到的内容。
        await finishMessage()
      } else {
        const msg = err instanceof Error ? err.message : "未知错误"
        setError(msg)
        toast.error(msg)
        // 出错也保留半截内容（如果有）——比直接抹掉对用户更友好，能看到 AI 写到哪儿了。
        await finishMessage()
      }
    } finally {
      abortRef.current = null
      setIsStreaming(false)
    }
  }, [])

  // 入口前置检查：API Key / Model / 防重入。
  // 返回 false 时 toast 已弹，调用方直接 return 即可。
  const ensureReady = useCallback((): boolean => {
    if (abortRef.current) return false // 流式中再触发任何入口都直接忽略
    const s = useSettings.getState()
    if (!s.apiKey.trim()) {
      toast.error("请先在设置里配置 API Key")
      return false
    }
    if (!s.model.trim()) {
      toast.error("请先在设置里配置 Model")
      return false
    }
    return true
  }, [])

  // 公开入口 1：发新消息。
  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim()
      if (!trimmed) return
      if (!ensureReady()) return
      setError(null)

      // 没选会话也能直接打字——hook 帮建一个。
      const chat = useChatStore.getState()
      const conversationId =
        chat.currentId ?? (await chat.createConversation())

      // 写 user 消息（IDB + 顶 updatedAt + 必要时生成标题），完成后再发流。
      await useChatStore
        .getState()
        .appendUserMessage(conversationId, trimmed)
      await runStream(conversationId)
    },
    [ensureReady, runStream],
  )

  // 公开入口 2：重新生成最后一条 assistant 回复。
  // UI 上只有当 messages 末尾是 assistant、且非流式时显示按钮——这里再做一次防御性判断。
  const regenerate = useCallback(async () => {
    if (!ensureReady()) return
    setError(null)

    const chat = useChatStore.getState()
    const conversationId = chat.currentId
    if (!conversationId) return

    const last = chat.messages[chat.messages.length - 1]
    if (!last) return
    // 末尾不是 assistant 也允许重发——可能上次流式失败把空占位删了，
    // 此时末尾就是 user，正好可以直接重跑（不需要先删任何东西）。
    if (last.role === "assistant") {
      await chat.removeMessage(last.id)
    }

    await runStream(conversationId)
  }, [ensureReady, runStream])

  // 公开入口 3：编辑某条 user 消息后重发——之后所有消息（含本身）会被截掉。
  // 走"截断 + 当作新消息发"的路子：实现简单，新消息有新 id/createdAt，
  // 不会出现"用户消息内容是新的但 createdAt 是旧的"这种半新半旧状态。
  const editAndResend = useCallback(
    async (messageId: string, newContent: string) => {
      const trimmed = newContent.trim()
      if (!trimmed) return
      if (!ensureReady()) return
      setError(null)

      const chat = useChatStore.getState()
      const conversationId = chat.currentId
      if (!conversationId) return

      const target = chat.messages.find((m) => m.id === messageId)
      // 只允许编辑 user 消息——assistant 内容由模型生成，编辑没意义；
      // 想改 assistant 表达？走重新生成。
      if (!target || target.role !== "user") return

      await chat.truncateFrom(messageId)
      await useChatStore.getState().appendUserMessage(conversationId, trimmed)
      await runStream(conversationId)
    },
    [ensureReady, runStream],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return {
    isStreaming,
    error,
    sendMessage,
    regenerate,
    editAndResend,
    stop,
  }
}
