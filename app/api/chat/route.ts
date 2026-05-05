// 流式聊天透传路由（BYOK）：浏览器把 apiKey + messages POST 上来，
// 用这个 key 临时代发上游、转发流式 chunk，结束就忘——不写日志、不持久化、不缓存。
//
// 安全约束：
//   - apiKey 走 body 不走 URL/header，避免被网关日志/proxy 记下
//   - 不能 console.log(body)——会把 key 打到 Vercel 日志
//   - 错误信息只回 message/code，不回整个 err.stack

import OpenAI from "openai"

import type {
  ChatRequestBody,
  StreamEvent,
} from "@/lib/types/chat"

// Node Runtime：Edge polyfill + OpenAI SDK 长连接 fetch 在流式结束后会冒
// `Error: aborted / ECONNRESET` 的 uncaughtException（dev 噪音）。
// Node 同样支持 ReadableStream 流式，prod 是 Vercel Node Serverless Function。

// 流式场景显式声明，避免被任何缓存层固化。
export const dynamic = "force-dynamic"

// BYOK 下攻击我方 API 收益为零（自己烧自己的 key），但仍设上限早 400 拦下畸形请求。
const MAX_MESSAGES = 200
const MAX_CONTENT_LEN = 100_000

const encoder = new TextEncoder()

function encodeEvent(event: StreamEvent): Uint8Array {
  return encoder.encode(JSON.stringify(event) + "\n")
}

export async function POST(request: Request) {
  let body: ChatRequestBody
  try {
    body = (await request.json()) as ChatRequestBody
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body.apiKey?.trim()) {
    return Response.json({ error: "Missing API key" }, { status: 400 })
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json(
      { error: "messages must be a non-empty array" },
      { status: 400 },
    )
  }
  if (body.messages.length > MAX_MESSAGES) {
    return Response.json(
      { error: `messages too long (max ${MAX_MESSAGES})` },
      { status: 400 },
    )
  }
  if (!body.model?.trim()) {
    return Response.json({ error: "Missing model" }, { status: 400 })
  }
  // 早查 role/content，避免 SDK 把错误包装得很模糊。
  const ALLOWED_ROLES = new Set(["system", "user", "assistant"])
  for (let i = 0; i < body.messages.length; i++) {
    const m = body.messages[i] as { role?: unknown; content?: unknown }
    if (typeof m.role !== "string" || !ALLOWED_ROLES.has(m.role)) {
      return Response.json(
        { error: `messages[${i}].role must be 'system' | 'user' | 'assistant'` },
        { status: 400 },
      )
    }
    if (typeof m.content !== "string") {
      return Response.json(
        { error: `messages[${i}].content must be a string` },
        { status: 400 },
      )
    }
    if (m.content.length > MAX_CONTENT_LEN) {
      return Response.json(
        { error: `messages[${i}].content too long (max ${MAX_CONTENT_LEN} chars)` },
        { status: 400 },
      )
    }
  }

  // baseURL 让 BYOK 真开放：同一份代码能打 OpenAI / DeepSeek / Moonshot / 本地 Ollama。
  const client = new OpenAI({
    apiKey: body.apiKey,
    baseURL: body.baseURL?.trim() || "https://api.openai.com/v1",
  })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 自持 AbortController 而非直接传 request.signal：流自然结束后，client 后续断开
      // （keep-alive 池清理）会再次触发 request.signal.abort，戳到 SDK 已完成的 fetch
      // 上被 undici 翻成 'aborted' / ECONNRESET，由 SDK 不再 await 而冒 uncaughtException。
      const upstreamCtrl = new AbortController()
      const forwardAbort = () => upstreamCtrl.abort()
      // 用户主动 stop / 关页面：把 abort 转发给 SDK，断上游、不再扣 token。
      request.signal.addEventListener("abort", forwardAbort, { once: true })

      try {
        const upstream = await client.chat.completions.create(
          {
            model: body.model,
            messages: body.messages,
            stream: true,
            ...(typeof body.temperature === "number" && {
              temperature: body.temperature,
            }),
            ...(body.maxTokens != null && { max_tokens: body.maxTokens }),
          },
          { signal: upstreamCtrl.signal },
        )

        for await (const chunk of upstream) {
          const choice = chunk.choices?.[0]
          if (!choice) continue

          const delta = choice.delta?.content
          if (delta) {
            controller.enqueue(encodeEvent({ type: "delta", content: delta }))
          }

          if (choice.finish_reason) {
            controller.enqueue(
              encodeEvent({
                type: "done",
                finishReason: choice.finish_reason,
              }),
            )
          }
        }

        controller.close()
      } catch (err) {
        // 客户端中断（用户停止 / 关页面）不算错误。
        if (request.signal.aborted) {
          try {
            controller.close()
          } catch {
            // 已被 cancel() 关掉
          }
          return
        }

        // code 优先级：SDK 的 .code（'invalid_api_key' 等语义标签）> .status（HTTP 字符串）。
        // explainError 两种 code 都识别。
        const message =
          err instanceof Error ? err.message : "Upstream request failed"
        let code: string | undefined
        if (err && typeof err === "object") {
          const e = err as { code?: unknown; status?: unknown }
          if (typeof e.code === "string" && e.code.length > 0) {
            code = e.code
          } else if (typeof e.status === "number") {
            code = String(e.status)
          }
        }

        try {
          controller.enqueue(
            encodeEvent({ type: "error", message, code }),
          )
          controller.close()
        } catch {
          // 流可能已关
        }
      } finally {
        // 卸下 listener：流已收尾，迟到的 abort 戳到 keep-alive socket 会冒 ECONNRESET。
        request.signal.removeEventListener("abort", forwardAbort)
      }
    },

    cancel() {},
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      // nginx 约定（Vercel Edge 也尊重）：禁用反代缓冲，保证流式实时下发。
      "X-Accel-Buffering": "no",
    },
  })
}
