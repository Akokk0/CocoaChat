// 浏览器侧的流式客户端：把 fetch 拿到的 ReadableStream 解析成 NDJSON 事件流。
//
// 设计成 async generator 的好处：
//   - 调用方写 `for await (const ev of streamChat(...))` 比 callback 风格清爽
//   - 调用方 break / return / throw 时，generator 的 try-finally 一定会跑——
//     这是我们清理连接（reader.cancel）的唯一可靠时机
//   - 天然背压：消费者处理慢，生产者就阻塞，不会爆内存

import type { ChatRequestBody, StreamEvent } from "@/lib/types/chat"

interface StreamOptions {
  // AbortSignal 串联整条链路：UI → fetch → 我方 route → openai SDK → 上游。
  // 调用方传一个 AbortController.signal 进来即可；abort 时整条链一起断。
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

  // 流还没开始（HTTP 头阶段）就出错——我方 route 的 400/500 走这里。
  // 这一段我们用普通 JSON 响应，所以可以一次性读完。
  if (!response.ok) {
    let message = `HTTP ${response.status} ${response.statusText}`.trim()
    try {
      const data = (await response.json()) as { error?: string }
      if (data?.error) message = data.error
    } catch {
      // 响应不是 JSON（比如 502 网关 HTML），保留通用消息
    }
    throw new Error(message)
  }

  // 理论上 fetch 对流式 GET/POST 一定有 body；多一层防御以防 polyfill / 老浏览器作妖。
  if (!response.body) {
    throw new Error("Response has no body — streaming not supported here")
  }

  const reader = response.body.getReader()
  // stream:true 是关键。一个 UTF-8 中文字符 3 字节，可能正好被 TCP 切在中间——
  // decoder 没开 stream 模式会直接抛 "decoding failed"，开了它会把不完整的尾巴留到下次 decode。
  const decoder = new TextDecoder("utf-8")
  let buffer = ""
  // 区分"流自然结束"vs"调用方提前退出 / 抛错"——决定 finally 里要 cancel 还是只 releaseLock。
  // 关键：对已经 done 的 reader 再 cancel() 会朝 server 发 RST，
  // Next dev server 会把它当 ECONNRESET 冒成 uncaughtException——只是日志噪音，但很烦。
  let exhausted = false

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        exhausted = true
        // 流结束。decode() 不传参 = flush，把 decoder 内部缓冲清出来。
        buffer += decoder.decode()
        const tail = buffer.trim()
        if (tail) {
          // 服务器最后一行可能没补 \n（合法 NDJSON 也允许末尾不带换行），手动收尾。
          yield safeParse(tail)
        }
        return
      }

      buffer += decoder.decode(value, { stream: true })

      // 把缓冲里所有完整的行（以 \n 结尾）逐条吐出。
      // 不能 split("\n") 一次性切——一个 chunk 可能横跨多个行，也可能切在某行中间。
      let nlIdx: number
      while ((nlIdx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nlIdx).trim()
        buffer = buffer.slice(nlIdx + 1)
        if (!line) continue // 忽略心跳空行（如果未来加）
        yield safeParse(line)
      }
    }
  } finally {
    if (exhausted) {
      // 已经读到 done——stream 自然关闭。只解锁，不 cancel——避免对已关连接再发关闭信号。
      reader.releaseLock()
    } else {
      // 调用方 break / 抛异常 / abort 进入这里。主动 cancel 把 cancel 信号推给上游，
      // 让 fetch 真的断开（进而 server 的 request.signal.aborted=true）。
      await reader.cancel().catch(() => {
        /* 已经关掉的 stream 再 cancel 会抛，吞掉即可 */
      })
    }
  }
}

// 把 NDJSON 解析的失败包装成有上下文的错误，方便排查协议不一致。
function safeParse(line: string): StreamEvent {
  try {
    return JSON.parse(line) as StreamEvent
  } catch (err) {
    throw new Error(
      `Invalid NDJSON line from /api/chat: ${line.slice(0, 80)}${
        line.length > 80 ? "…" : ""
      }`,
      { cause: err },
    )
  }
}
