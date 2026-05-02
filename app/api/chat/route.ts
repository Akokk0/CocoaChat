// 流式聊天透传路由。
//
// 这是 BYOK 架构的核心：
//   1. 浏览器把 apiKey + messages 一起 POST 上来
//   2. 我们用这个 key 临时代发请求给上游（OpenAI / DeepSeek / Moonshot…）
//   3. 把上游的流式 chunk 实时转发回浏览器
//   4. 调用结束就忘掉一切——不写日志、不持久化、不缓存
//
// 关键安全约束：
//   - apiKey 走 body 不走 URL/header，避免被网关日志/proxy 记下
//   - 不能 console.log(body)——会把 key 打到 Vercel 日志
//   - 任何错误信息只回 message/code，不要把整个 err.stack 抛回前端

import OpenAI from "openai"

import type {
  ChatRequestBody,
  StreamEvent,
} from "@/lib/types/chat"

// Edge Runtime：冷启动毫秒级、低延迟、跑在离用户最近的 PoP。
// 流式场景对首字节延迟（TTFB）非常敏感，Edge 比 Node Runtime 快一档。
// 代价：不能用 Node 原生模块（fs / net 等），但我们用不上。
export const runtime = "edge"

// 强制每次都跑、不要被任何缓存层固化。
// Next 16 默认 POST 不缓存，但流式场景里显式声明更稳妥。
export const dynamic = "force-dynamic"

// ---- NDJSON 编码器 ----

// 一行一个 JSON 对象，行尾 "\n"。
// 用 TextEncoder（Web 原生）而不是 Buffer.from（Node 限定）——Edge Runtime 兼容。
const encoder = new TextEncoder()

function encodeEvent(event: StreamEvent): Uint8Array {
  return encoder.encode(JSON.stringify(event) + "\n")
}

// ---- POST ----

export async function POST(request: Request) {
  // 1) 解析 + 校验请求体。
  // 这一段失败用普通 JSON 响应回 400，不进入流式分支。
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
  if (!body.model?.trim()) {
    return Response.json({ error: "Missing model" }, { status: 400 })
  }

  // 2) 构造 OpenAI 客户端。
  // baseURL 让 BYOK 真正"开放"——同一份代码能打 OpenAI / DeepSeek / Moonshot / 本地 Ollama。
  const client = new OpenAI({
    apiKey: body.apiKey,
    baseURL: body.baseURL?.trim() || "https://api.openai.com/v1",
  })

  // 3) 构造下行流。
  // ReadableStream 的 start 回调是流被订阅时（i.e. response 开始发送时）触发，
  // 我们在里面跑 for-await 拉上游 chunk，每拿到一段就 enqueue 给浏览器。
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // 关键：把 request.signal 透传给上游 fetch。
        // 浏览器 abort → 我们的 connection 关闭 → request.signal.aborted 变 true
        // → openai SDK 的 fetch 收到 signal abort → 上游连接关闭、不再扣 token。
        // 没这一步的话，用户点了"停止"但服务端还在闷头读完整个回答，浪费配额。
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
          { signal: request.signal },
        )

        // 4) 转发 chunk。
        // OpenAI 兼容的 stream chunk 形如：
        //   { choices: [{ delta: { content: "..." }, finish_reason: null | "stop" | ... }] }
        // 我们只关心 delta.content 和 finish_reason。
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
        // 客户端中断（用户点停止 / 关页面）不算错误——静默关闭即可。
        if (request.signal.aborted) {
          try {
            controller.close()
          } catch {
            // 已经被 cancel() 关掉了，吞掉即可
          }
          return
        }

        // 上游错误：拆出 status + message 发给前端，方便区分 401（key 错）/ 429（限流）/ 5xx（上游挂）。
        const message =
          err instanceof Error ? err.message : "Upstream request failed"
        const status =
          err && typeof err === "object" && "status" in err
            ? String((err as { status: unknown }).status)
            : undefined

        try {
          controller.enqueue(
            encodeEvent({ type: "error", message, code: status }),
          )
          controller.close()
        } catch {
          // 流可能已经被关，忽略
        }
      }
    },

    // 浏览器 abort 时 ReadableStream 会触发 cancel。
    // 我们这里没什么要清理的——request.signal 已经把 cancellation 传给了上游。
    cancel() {},
  })

  // 5) 返回流式响应。
  return new Response(stream, {
    headers: {
      // application/x-ndjson 是 NDJSON 的事实标准 MIME
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      // 部分反向代理（nginx / Vercel Edge 前置层）会缓冲流式响应，
      // 这个非标准 header 是 nginx 的约定，告诉它"别 buffer"。Vercel 的 Edge 也尊重它。
      "X-Accel-Buffering": "no",
    },
  })
}
