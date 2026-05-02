"use client"

// 整个 Stage 3 的"指挥中心"。
// 把流式 fetch、消息状态、AbortController、错误处理串成一个 React hook，
// UI 组件只看到 { messages, isStreaming, error, sendMessage, stop, reset } 六个东西。
//
// 这是简历最值得讲的文件之一——所谓"自研 hook 解耦 UI 与上游 API"指的就是它。

import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"

import { streamChat } from "@/lib/ai/streamClient"
import { useSettings } from "@/lib/store/settingsStore"
import type { ChatMessage } from "@/lib/types/chat"

function newId(): string {
  // crypto.randomUUID 在所有现代浏览器（含 Safari 15.4+）原生可用，
  // 不用为了一个 ID 引 nanoid / uuid 库。
  return crypto.randomUUID()
}

export function useChatStream() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ref 而不是 state：换它的值不需要触发重渲染，
  // 而且 abort() 是命令式动作，不属于"渲染依赖"的概念范畴。
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim()
      if (!trimmed) return
      // 防重入：流式中再点发送直接忽略。UI 那边按钮也会变 stop，所以正常情况走不到。
      if (abortRef.current) return

      // 直接读 store 当前值，不通过订阅。
      // 用订阅会让这个 hook 在每次 settings 变化时都重建 sendMessage，没必要——
      // 我们只在调用瞬间需要那一份 settings 快照。
      const settings = useSettings.getState()

      if (!settings.apiKey.trim()) {
        toast.error("请先在设置里配置 API Key")
        return
      }
      if (!settings.model.trim()) {
        toast.error("请先在设置里配置 Model")
        return
      }

      setError(null)

      // 1) 在内存里同时追加 user 和 assistant 占位。
      // 一次性 setMessages 比两次少一帧渲染，且语义清晰：「user 提问→AI 立即占位」。
      const userMessage: ChatMessage = {
        id: newId(),
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
      }
      const assistantMessage: ChatMessage = {
        id: newId(),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      }

      setMessages((prev) => [...prev, userMessage, assistantMessage])

      // 2) 构造发给 /api/chat 的 messages。
      // 注意我们读的是闭包里的 messages（即 setState 之前的值），
      // 这正是我们想要的「截至此刻的历史」——不包含刚 push 进去的 user/assistant 占位。
      // 然后手动追加 user 消息（assistant 占位不发，因为它 content 是空的）。
      const apiMessages: { role: ChatMessage["role"]; content: string }[] = []
      if (settings.systemPrompt.trim()) {
        apiMessages.push({ role: "system", content: settings.systemPrompt })
      }
      for (const m of messages) {
        apiMessages.push({ role: m.role, content: m.content })
      }
      apiMessages.push({
        role: userMessage.role,
        content: userMessage.content,
      })

      // 3) 启动 AbortController。
      // 这是整个 stop 链路的源头：abort() → fetch 中断 → 我方 route 收到 signal → 上游中断。
      const controller = new AbortController()
      abortRef.current = controller
      setIsStreaming(true)

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
            // 4) 把 delta 拼到 assistant 消息上。
            // 注意：这里用 functional setState（prev => ...），
            // 否则在快速连续 chunk 里读到的 messages 是闭包旧值，会丢字。
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessage.id
                  ? { ...m, content: m.content + event.content }
                  : m,
              ),
            )
          } else if (event.type === "error") {
            // 5) 上游/我方报错——把它转成 throw，让下面 catch 统一处理。
            throw new Error(event.message)
          }
          // event.type === "done" 暂时不需要处理；Stage 5 会用 finishReason。
        }
      } catch (err) {
        // 用户主动停止不算错——保留已收到的部分内容即可。
        if (controller.signal.aborted) {
          // 没收到任何字就停了：删掉空 assistant 占位，避免界面上挂个空气泡。
          setMessages((prev) =>
            prev[prev.length - 1]?.id === assistantMessage.id &&
            prev[prev.length - 1].content === ""
              ? prev.slice(0, -1)
              : prev,
          )
        } else {
          const msg = err instanceof Error ? err.message : "未知错误"
          setError(msg)
          toast.error(msg)
          // 出错时也清掉空占位，让用户能看到自己的提问还在
          setMessages((prev) =>
            prev[prev.length - 1]?.id === assistantMessage.id &&
            prev[prev.length - 1].content === ""
              ? prev.slice(0, -1)
              : prev,
          )
        }
      } finally {
        abortRef.current = null
        setIsStreaming(false)
      }
    },
    // 依赖 messages：每次历史变化都要重建闭包，否则发出去的 history 会落后一轮。
    [messages],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  // 清空当前对话（Stage 4 接 IndexedDB 后，会改成"切换会话"语义）。
  const reset = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setError(null)
  }, [])

  return { messages, isStreaming, error, sendMessage, stop, reset }
}
