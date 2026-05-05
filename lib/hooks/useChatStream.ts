"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { streamChat } from "@/lib/ai/streamClient"
import { explainError, StreamError } from "@/lib/errors"
import { useChatStore } from "@/lib/store/chatStore"
import { useSettings } from "@/lib/store/settingsStore"
import type { ChatMessage } from "@/lib/types/chat"

export function useChatStream() {
  // 按 convId 维护 controller——多会话可同时流式，stop 只中止当前会话。
  // ref 而非 state：abort 是命令式动作，换值不需要重渲染。
  const controllers = useRef<Map<string, AbortController>>(new Map())

  // 卸载兜底 abort：避免后台 fetch 浪费配额，也避免 finally 里在已卸载组件上 setStreaming。
  useEffect(() => {
    const map = controllers.current
    return () => {
      for (const ctrl of map.values()) ctrl.abort()
      map.clear()
    }
  }, [])

  const [streamingIds, setStreamingIds] = useState<Set<string>>(new Set())

  const setStreaming = useCallback((convId: string, on: boolean) => {
    setStreamingIds((prev) => {
      // 不变就返回原引用，避免下游重渲染。
      if (prev.has(convId) === on) return prev
      const next = new Set(prev)
      if (on) next.add(convId)
      else next.delete(convId)
      return next
    })
  }, [])

  // 调用方负责让 messagesByConv[convId] 末尾就是要回复的 user 消息——本函数只拼上下文 → 流式 → 落盘。
  const runStream = useCallback(
    async (conversationId: string) => {
      const settings = useSettings.getState()
      const chat = useChatStore.getState()

      // 系统提示优先级：会话级 > 全局。
      const conv = chat.conversations.find((c) => c.id === conversationId)
      const sysPrompt = (conv?.systemPrompt ?? settings.systemPrompt).trim()

      // 拿 messagesByConv[conversationId] 而非"当前会话"——切走会话后流仍能继续往原 conv 写。
      const convMessages = chat.messagesByConv[conversationId] ?? []
      const apiMessages: { role: ChatMessage["role"]; content: string }[] = []
      if (sysPrompt) apiMessages.push({ role: "system", content: sysPrompt })
      for (const m of convMessages) {
        apiMessages.push({ role: m.role, content: m.content })
      }

      // 占位 assistant：流结束后才落盘，避免每个 token 一次 IDB 写。
      const assistantMessage = chat.appendAssistantPlaceholder(conversationId)

      const controller = new AbortController()
      controllers.current.set(conversationId, controller)
      setStreaming(conversationId, true)

      let receivedAnyContent = false

      const finishMessage = async () => {
        // 会话被删了就别写——repository 那边记录都没了。
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
            // 热路径：只更内存，不落盘。
            useChatStore
              .getState()
              .updateAssistantContent(
                conversationId,
                assistantMessage.id,
                event.content,
              )
          } else if (event.type === "error") {
            // stream 内 error event 抛成 StreamError——保留 code 让 explainError 分支。
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

  // 前置检查 + 按会话防重入：A 流式中再点发送被忽略，但不影响 B 同时发。
  const ensureReady = useCallback((conversationId: string): boolean => {
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

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim()
      if (!trimmed) return

      // 没选会话也能直接打字——hook 帮建一个。
      const chat = useChatStore.getState()
      const conversationId =
        chat.currentId ?? (await chat.createConversation())

      if (!ensureReady(conversationId)) return

      await useChatStore
        .getState()
        .appendUserMessage(conversationId, trimmed)
      await runStream(conversationId)
    },
    [ensureReady, runStream],
  )

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
      // 只允许编辑 user 消息。
      if (!target || target.role !== "user") return

      await chat.truncateFrom(conversationId, messageId)
      await useChatStore
        .getState()
        .appendUserMessage(conversationId, trimmed)
      await runStream(conversationId)
    },
    [ensureReady, runStream],
  )

  // 只中止当前会话的流。
  const stop = useCallback(() => {
    const currentId = useChatStore.getState().currentId
    if (!currentId) return
    controllers.current.get(currentId)?.abort()
  }, [])

  // 订阅 currentId 让 isStreaming 跟随会话切换更新。
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
