// 前后端共享的聊天类型。
// 放在 lib/types 下而不是某个具体模块里，是为了避免循环引用：
// route.ts、streamClient.ts、useChatStream.ts、MessageList.tsx 都要 import 它。

// ---- 消息 ----

// OpenAI 兼容的角色集合。"system" 通常只出现一次（在最前面）。
export type Role = "system" | "user" | "assistant"

// 一条消息的内存表示。
// id 用 crypto.randomUUID()——浏览器原生、不用引第三方。
// createdAt 是 epoch 毫秒，方便排序和增量更新（不用 Date 对象，序列化友好）。
export interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt: number
}

// ---- 服务端发往浏览器的 NDJSON 事件 ----

// 类型化事件 + 区分性字段（type）= TypeScript discriminated union。
// 用 switch (event.type) 做穷尽检查时编译器能帮你查漏。
export type StreamEvent =
  // 文本增量。content 是这一 chunk 的 delta，不是累加值——前端自己拼。
  | { type: "delta"; content: string }
  // 上游或我方错误。message 是给用户看的文案，code 是给开发者排错用的标签。
  | { type: "error"; message: string; code?: string }
  // 正常结束。finishReason 透传上游（"stop" / "length" / "content_filter" 等）。
  | { type: "done"; finishReason?: string }

// ---- 浏览器发往 /api/chat 的请求体 ----

// API Key 走 body 不走 header：
//   1. 服务端只是透传，不该把它当鉴权凭证写进访问日志（headers 更容易被中间件抓走）
//   2. body 里和 messages 同生共灭，语义更清晰
export interface ChatRequestBody {
  messages: Array<Pick<ChatMessage, "role" | "content">>
  apiKey: string
  baseURL: string
  model: string
  temperature?: number
  // null 表示不传给上游（让 provider 用默认）。和 settingsStore 保持一致。
  maxTokens?: number | null
}
