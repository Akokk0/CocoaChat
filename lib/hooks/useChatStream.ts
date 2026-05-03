"use client"

// 流式聊天的"行为编排器"。
// Stage 3：messages 还住在这里（useState）。
// Stage 4：messages 已搬到 chatStore——这个 hook 只负责把
// 「fetch / abort / 错误处理 / IDB 落盘时机」这些过程串起来。
//
// 关注点分离：
//   - chatStore 管"是什么状态"
//   - useChatStream 管"什么时候做什么"
//   - 组件管"怎么渲染"
// 三层互不重叠，每层都能单独读懂。

import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"

import { streamChat } from "@/lib/ai/streamClient"
import { useChatStore } from "@/lib/store/chatStore"
import { useSettings } from "@/lib/store/settingsStore"
import type { ChatMessage } from "@/lib/types/chat"

export function useChatStream() {
  // 这两个是流式过程自身的瞬时状态，不属于 chatStore 的"持久数据"范畴，
  // 留在 hook 里更合适（每个使用方独立流式上下文）。
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ref 而不是 state：换它的值不需要触发重渲染，
  // 而且 abort() 是命令式动作，不属于"渲染依赖"的概念范畴。
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(async (content: string) => {
    const trimmed = content.trim()
    if (!trimmed) return
    // 防重入：流式中再点发送直接忽略。UI 那边按钮也会变 stop。
    if (abortRef.current) return

    // 直接读 store 当前值，不通过订阅。
    // 用订阅会让这个 hook 在每次 settings/chat 变化时都重建 sendMessage，没必要。
    const settings = useSettings.getState()
    const chat = useChatStore.getState()

    if (!settings.apiKey.trim()) {
      toast.error("请先在设置里配置 API Key")
      return
    }
    if (!settings.model.trim()) {
      toast.error("请先在设置里配置 Model")
      return
    }

    setError(null)

    // 1) 确保有一个会话装这条消息。
    //    用户没点过"新建对话"也能直接打字——hook 帮他建。
    const conversationId = chat.currentId ?? (await chat.createConversation())

    // 2) 写 user 消息（同步到 IDB + 顶起 updatedAt + 必要时生成标题）。
    //    要在请求发出前完成——刷新即不丢。
    await chat.appendUserMessage(conversationId, trimmed)

    // 3) 构造发给 /api/chat 的 messages 列表。
    //    用 store 此刻的 messages（已经包含 userMessage），过滤出本次要发的。
    //    注意这里 getState() 是同步读，拿到的就是 step 2 之后的最新值。
    const apiMessages: { role: ChatMessage["role"]; content: string }[] = []
    if (settings.systemPrompt.trim()) {
      apiMessages.push({ role: "system", content: settings.systemPrompt })
    }
    for (const m of useChatStore.getState().messages) {
      apiMessages.push({ role: m.role, content: m.content })
    }

    // 4) 在内存里加一条空 assistant 占位。这条**故意**不写 IDB，
    //    避免流式期间几百次写入。流结束/中断时再一次性 putMessage。
    const assistantMessage = useChatStore
      .getState()
      .appendAssistantPlaceholder(conversationId)

    // 5) AbortController：整条 stop 链路的源头。
    const controller = new AbortController()
    abortRef.current = controller
    setIsStreaming(true)

    let receivedAnyContent = false

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
        // event.type === "done" 暂时不处理；Stage 5 会用 finishReason。
      }

      // 6) 流自然结束——把 assistant 最终内容一次性落盘。
      if (receivedAnyContent) {
        await useChatStore
          .getState()
          .persistAssistantMessage(conversationId, assistantMessage.id)
      } else {
        // 上游一个字都没吐就 close（少见但合法）——清掉空占位避免界面挂个空气泡。
        useChatStore.getState().removeLastAssistantIfEmpty(assistantMessage.id)
      }
    } catch (err) {
      const aborted = controller.signal.aborted
      if (aborted) {
        // 用户主动停止：保留已收到的内容（不算错），把它落盘；什么都没收到则丢弃占位。
        if (receivedAnyContent) {
          await useChatStore
            .getState()
            .persistAssistantMessage(conversationId, assistantMessage.id)
        } else {
          useChatStore.getState().removeLastAssistantIfEmpty(assistantMessage.id)
        }
      } else {
        const msg = err instanceof Error ? err.message : "未知错误"
        setError(msg)
        toast.error(msg)
        // 出错：丢弃空占位（已经收到部分内容的话也保留——用户能看到 AI 写到哪儿了）。
        if (receivedAnyContent) {
          await useChatStore
            .getState()
            .persistAssistantMessage(conversationId, assistantMessage.id)
        } else {
          useChatStore.getState().removeLastAssistantIfEmpty(assistantMessage.id)
        }
      }
    } finally {
      abortRef.current = null
      setIsStreaming(false)
    }
  }, [])

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { isStreaming, error, sendMessage, stop }
}
