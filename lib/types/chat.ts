// 前后端共享的聊天类型。

export type Role = "system" | "user" | "assistant"

export interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt: number
}

// type 字段做 discriminated union，switch 时编译器能查漏。
export type StreamEvent =
  // content 是这一 chunk 的 delta，不是累加值——前端自己拼。
  | { type: "delta"; content: string }
  | { type: "error"; message: string; code?: string }
  | { type: "done"; finishReason?: string }

// API Key 走 body 不走 header / query：避免被中间件 / 访问日志抓走。
export interface ChatRequestBody {
  messages: Array<Pick<ChatMessage, "role" | "content">>
  apiKey: string
  baseURL: string
  model: string
  temperature?: number
  // null = 不传给上游（让 provider 用默认）。
  maxTokens?: number | null
}
