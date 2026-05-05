"use client"

// 流式聊天的"行为编排器"。
//
// Stage 3：messages 还住在这里（useState）。
// Stage 4：搬到 chatStore，hook 只编排「fetch / abort / IDB 落盘时机」。
// Stage 5：抽 ensureReady + runStream，sendMessage / regenerate / editAndResend 三入口共用。
// Stage 6：abort controllers 改成 Map<convId, AbortController>——
//   每个会话独立的流式生命周期。用户在 A 会话发问、切到 B 会话，
//   A 的 stream 在后台继续往 store.messagesByConv[A] 写，UI 切回 A 时直接看到完整内容。
//   stop() 中止"当前会话"的流；其他会话的流不受影响。
//
// 关注点分离：
//   - chatStore 管"是什么状态"（按 convId 索引）
//   - useChatStream 管"什么时候做什么"（按 convId 维护 controller）
//   - 组件管"怎么渲染"（subscribe 当前会话）

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { streamChat } from "@/lib/ai/streamClient"
import { explainError, StreamError } from "@/lib/errors"
import { useChatStore } from "@/lib/store/chatStore"
import { useSettings } from "@/lib/store/settingsStore"
import type { ChatMessage } from "@/lib/types/chat"

export function useChatStream() {
  // 按 convId 维护的 controller 集合——多个会话可同时流式。
  // ref 而非 state：换它的值不需要触发重渲染；abort() 是命令式动作。
  const controllers = useRef<Map<string, AbortController>>(new Map())

  // hook 卸载时（路由切换 / 热更新 / 整页面销毁）兜底 abort 所有正在跑的流——
  // 避免后台 fetch 继续浪费用户配额，也避免 finally 里 setStreaming 在已卸载组件上调。
  useEffect(() => {
    const map = controllers.current
    return () => {
      for (const ctrl of map.values()) ctrl.abort()
      map.clear()
    }
  }, [])

  // 流式中的会话 id 集合——派生 isStreaming 用。
  // 必须是 state（不是 ref），UI 才能在流开始/结束时重渲染发送/停止按钮。
  const [streamingIds, setStreamingIds] = useState<Set<string>>(new Set())

  const setStreaming = useCallback((convId: string, on: boolean) => {
    setStreamingIds((prev) => {
      // 不变就不触发更新——避免下游不必要的重渲染。
      if (prev.has(convId) === on) return prev
      const next = new Set(prev)
      if (on) next.add(convId)
      else next.delete(convId)
      return next
    })
  }, [])

  // ---- 内部：跑一次流式请求 ----
  // 调用方负责保证 chatStore.messagesByConv[convId] 末尾就是要回复的 user 消息。
  // 本函数不 append user，只负责拼上下文 → 流式 → 落盘。
  // 抽出来后 sendMessage / regenerate / editAndResend 三处都共用同一条流水线，
  // 错误/中止/落盘语义只在这一处维护。
  const runStream = useCallback(
    async (conversationId: string) => {
      const settings = useSettings.getState()
      const chat = useChatStore.getState()

      // 系统提示优先级：会话级 > 全局。undefined 表示"未设置"。
      const conv = chat.conversations.find((c) => c.id === conversationId)
      const sysPrompt = (conv?.systemPrompt ?? settings.systemPrompt).trim()

      // 拼发给 /api/chat 的 messages：[system?] + 该会话所有消息。
      // 注意拿的是 messagesByConv[conversationId]，不是当前会话——
      // 即使用户在 sendMessage 之后立即切走会话，这里仍能读到 A 的对话历史。
      const convMessages = chat.messagesByConv[conversationId] ?? []
      const apiMessages: { role: ChatMessage["role"]; content: string }[] = []
      if (sysPrompt) apiMessages.push({ role: "system", content: sysPrompt })
      for (const m of convMessages) {
        apiMessages.push({ role: m.role, content: m.content })
      }

      // 占位 assistant 消息：流结束后才落盘——避免每个 token 一次 IDB 写。
      const assistantMessage = chat.appendAssistantPlaceholder(conversationId)

      const controller = new AbortController()
      controllers.current.set(conversationId, controller)
      setStreaming(conversationId, true)

      let receivedAnyContent = false

      // 流结束/中止/出错时统一收尾。三处都要做，抽成内联函数避免重复。
      const finishMessage = async () => {
        // 会话被删了就什么也别写——repository 那边记录都没了。
        const stillExists = useChatStore
          .getState()
          .conversations.some((c) => c.id === conversationId)
        if (!stillExists) return
        if (receivedAnyContent) {
          await useChatStore
            .getState()
            .persistAssistantMessage(conversationId, assistantMessage.id)
        } else {
          useChatStore
            .getState()
            .removeLastAssistantIfEmpty(conversationId, assistantMessage.id)
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
            // 热路径：只更新内存（按 convId 索引）。简历讲"流式 + 持久化"的写放大优化就指这里。
            useChatStore
              .getState()
              .updateAssistantContent(
                conversationId,
                assistantMessage.id,
                event.content,
              )
          } else if (event.type === "error") {
            // 把 stream 内 error event 抛成 StreamError——保留 code 让 explainError 分支。
            throw new StreamError(event.message, event.code)
          }
        }

        await finishMessage()
      } catch (err) {
        if (controller.signal.aborted) {
          await finishMessage()
        } else {
          const { title, hint } = explainError(err)
          toast.error(title, hint ? { description: hint } : undefined)
          await finishMessage()
        }
      } finally {
        controllers.current.delete(conversationId)
        setStreaming(conversationId, false)
      }
    },
    [setStreaming],
  )

  // 入口前置检查：API Key / Model / 防重入（按会话）。
  // 返回 false 时 toast 已弹，调用方直接 return 即可。
  const ensureReady = useCallback((conversationId: string): boolean => {
    // 按会话防重入：A 会话流式中再点发送会被忽略，但**不影响** B 会话同时也能发。
    if (controllers.current.has(conversationId)) return false
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

      // 没选会话也能直接打字——hook 帮建一个；createConversation 也会把它设为当前。
      const chat = useChatStore.getState()
      const conversationId =
        chat.currentId ?? (await chat.createConversation())

      if (!ensureReady(conversationId)) return

      // 写 user 消息（IDB + 顶 updatedAt + 必要时生成标题），完成后再发流。
      await useChatStore
        .getState()
        .appendUserMessage(conversationId, trimmed)
      await runStream(conversationId)
    },
    [ensureReady, runStream],
  )

  // 公开入口 2：重新生成最后一条回复。
  // 末尾是 assistant 时删掉重发；末尾是 user（流式失败留下的）时直接重发。
  const regenerate = useCallback(async () => {
    const chat = useChatStore.getState()
    const conversationId = chat.currentId
    if (!conversationId) return
    if (!ensureReady(conversationId)) return

    const messages = chat.messagesByConv[conversationId] ?? []
    const last = messages[messages.length - 1]
    if (!last) return
    if (last.role === "assistant") {
      await chat.removeMessage(conversationId, last.id)
    }
    await runStream(conversationId)
  }, [ensureReady, runStream])

  // 公开入口 3：编辑某条 user 消息后重发——之后所有消息会被截断。
  const editAndResend = useCallback(
    async (messageId: string, newContent: string) => {
      const trimmed = newContent.trim()
      if (!trimmed) return

      const chat = useChatStore.getState()
      const conversationId = chat.currentId
      if (!conversationId) return
      if (!ensureReady(conversationId)) return

      const messages = chat.messagesByConv[conversationId] ?? []
      const target = messages.find((m) => m.id === messageId)
      // 只允许编辑 user 消息——assistant 内容由模型生成。
      if (!target || target.role !== "user") return

      await chat.truncateFrom(conversationId, messageId)
      await useChatStore
        .getState()
        .appendUserMessage(conversationId, trimmed)
      await runStream(conversationId)
    },
    [ensureReady, runStream],
  )

  // 中止当前会话的流——其他会话的流不受影响。
  const stop = useCallback(() => {
    const currentId = useChatStore.getState().currentId
    if (!currentId) return
    controllers.current.get(currentId)?.abort()
  }, [])

  // 派生 isStreaming：当前会话是否在流式中。
  // 订阅 currentId 让 isStreaming 跟随会话切换更新；streamingIds 是 hook 内部 state，
  // 自然触发重渲染。
  const currentId = useChatStore((s) => s.currentId)
  const isStreaming = currentId ? streamingIds.has(currentId) : false

  return {
    isStreaming,
    sendMessage,
    regenerate,
    editAndResend,
    stop,
  }
}
