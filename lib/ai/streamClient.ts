// 浏览器侧流式客户端：把 fetch 拿到的 ReadableStream 解析成 NDJSON 事件流。

import { StreamError } from "@/lib/errors"
import type { ChatRequestBody, StreamEvent } from "@/lib/types/chat"

interface StreamOptions {
  signal?: AbortSignal
}

export async function* streamChat(
  body: ChatRequestBody,
  options: StreamOptions = {},
): AsyncGenerator<StreamEvent, void, unknown> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  })

  if (!response.ok) {
    let message = `HTTP ${response.status} ${response.statusText}`.trim()
    try {
      const data = (await response.json()) as { error?: string }
      if (data?.error) message = data.error
    } catch {
      // 响应不是 JSON（如 502 网关 HTML），保留通用消息
    }
    // HTTP 阶段错误带 status 字符串作为 code——hook 层据此分支（401/429/5xx）。
    throw new StreamError(message, String(response.status))
  }

  // 防御 polyfill / 老浏览器 fetch 没有 body 的边角情况。
  if (!response.body) {
    throw new StreamError("Response has no body — streaming not supported here")
  }

  const reader = response.body.getReader()
  // stream:true 关键：UTF-8 多字节字符可能被 TCP 切在中间，开 stream 模式会把不完整尾巴留到下次 decode。
  const decoder = new TextDecoder("utf-8")
  let buffer = ""
  // 区分"流自然结束"vs"调用方提前退出"——决定 finally 里 cancel 还是只 releaseLock。
  // 对已经 done 的 reader 再 cancel() 会朝 server 发 RST，Next dev server 会冒成 ECONNRESET 噪音。
  let exhausted = false

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        exhausted = true
        // decode() 不传参 = flush，把 decoder 内部缓冲清出来。
        buffer += decoder.decode()
        const tail = buffer.trim()
        if (tail) {
          // NDJSON 末尾允许不带换行，手动收尾。
          yield safeParse(tail)
        }
        return
      }

      buffer += decoder.decode(value, { stream: true })

      // 一个 chunk 可能横跨多行也可能切在某行中间，逐 \n 切而非 split。
      let nlIdx: number
      while ((nlIdx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nlIdx).trim()
        buffer = buffer.slice(nlIdx + 1)
        if (!line) continue
        yield safeParse(line)
      }
    }
  } finally {
    if (exhausted) {
      reader.releaseLock()
    } else {
      // 调用方 break / 抛异常 / abort：主动 cancel 把信号推给上游真正断开 fetch。
      await reader.cancel().catch(() => {
        /* 已关闭的 stream 再 cancel 会抛，吞掉 */
      })
    }
  }
}

// 运行时 type guard：协议变化 / 中间代理篡改 / 服务端 bug 时立刻抛错，
// 避免畸形对象冒进流式管线引发 NaN 累加 / undefined 访问。
function isStreamEvent(value: unknown): value is StreamEvent {
  if (!value || typeof value !== "object") return false
  const ev = value as Record<string, unknown>
  switch (ev.type) {
    case "delta":
      return typeof ev.content === "string"
    case "error":
      return (
        typeof ev.message === "string" &&
        (ev.code === undefined || typeof ev.code === "string")
      )
    case "done":
      return ev.finishReason === undefined || typeof ev.finishReason === "string"
    default:
      return false
  }
}

// 把 NDJSON 解析失败包装成有上下文的错误，方便排查协议不一致。
function safeParse(line: string): StreamEvent {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch (err) {
    throw new Error(
      `Invalid NDJSON line from /api/chat: ${line.slice(0, 80)}${
        line.length > 80 ? "…" : ""
      }`,
      { cause: err },
    )
  }
  // JSON 合法但形状不对——同样要抛，避免静默忽略。
  if (!isStreamEvent(parsed)) {
    throw new Error(
      `Unexpected event shape from /api/chat: ${line.slice(0, 80)}${
        line.length > 80 ? "…" : ""
      }`,
    )
  }
  return parsed
}
