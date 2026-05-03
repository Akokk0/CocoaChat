// IndexedDB 的"业务函数层"。
// 所有 IDB 调用集中在这里——store 那边只看到 createConversation / appendMessage 之类的语义函数。
// 这样将来要换实现（比如同步到云端、加 LRU 缓存），改这一个文件就够了。

import { getDB, type ConversationRecord, type MessageRecord } from "@/lib/storage/db"
import type { ChatMessage, Role } from "@/lib/types/chat"

function newId(): string {
  return crypto.randomUUID()
}

// ---- 会话 CRUD ----

export async function listConversations(): Promise<ConversationRecord[]> {
  const db = await getDB()
  // index.getAll() 默认按 key 升序返回。我们想要"最近的在前"，所以拿到后 reverse。
  // 数据量上千以前没必要上 cursor + 'prev'——一次性 getAll 简单且足够快。
  const rows = await db.getAllFromIndex("conversations", "byUpdatedAt")
  return rows.reverse()
}

export async function createConversation(input: {
  title?: string
  systemPrompt?: string
}): Promise<ConversationRecord> {
  const now = Date.now()
  const record: ConversationRecord = {
    id: newId(),
    title: input.title?.trim() || "新对话",
    createdAt: now,
    updatedAt: now,
    systemPrompt: input.systemPrompt,
  }
  const db = await getDB()
  await db.put("conversations", record)
  return record
}

export async function updateConversation(
  id: string,
  patch: Partial<Pick<ConversationRecord, "title" | "systemPrompt">>,
): Promise<ConversationRecord | null> {
  const db = await getDB()
  // 读 → 改 → 写，全在一个 readwrite 事务里——避免两个 tab 同时改时丢数据。
  const tx = db.transaction("conversations", "readwrite")
  const existing = await tx.store.get(id)
  if (!existing) {
    await tx.done
    return null
  }
  const updated: ConversationRecord = {
    ...existing,
    ...patch,
    updatedAt: Date.now(),
  }
  await tx.store.put(updated)
  await tx.done
  return updated
}

// 仅更新活跃时间戳。新发消息时调用，让会话排到最前面。
export async function touchConversation(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction("conversations", "readwrite")
  const existing = await tx.store.get(id)
  if (existing) {
    await tx.store.put({ ...existing, updatedAt: Date.now() })
  }
  await tx.done
}

// 级联删除：会话 + 它名下所有消息，原子操作。
export async function deleteConversation(id: string): Promise<void> {
  const db = await getDB()
  // 关键：两个 store 写入同一个事务里，要么全成要么全失败。
  // 事务跨 store 必须在 transaction([...]) 时一次性声明，事后不能扩。
  const tx = db.transaction(["conversations", "messages"], "readwrite")
  // 1) 找出所有相关 message 的 key
  const msgKeys = await tx
    .objectStore("messages")
    .index("byConversation")
    .getAllKeys(id)
  // 2) 批量删 message + 删会话本身
  await Promise.all([
    ...msgKeys.map((k) => tx.objectStore("messages").delete(k)),
    tx.objectStore("conversations").delete(id),
  ])
  await tx.done
}

// ---- 消息 CRUD ----

export async function listMessagesByConversation(
  conversationId: string,
): Promise<ChatMessage[]> {
  const db = await getDB()
  const rows = await db.getAllFromIndex(
    "messages",
    "byConversation",
    conversationId,
  )
  // index.getAll 不保证顺序——我们按 createdAt 升序排（同毫秒时按 id 兜底稳定性）。
  rows.sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt - b.createdAt,
  )
  // 落盘字段比内存字段多一个 conversationId，显式构造内存形态。
  // 比 destructure-and-rest 模式让 lint 更舒服，且字段意图一目了然。
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
  }))
}

export async function appendMessage(
  conversationId: string,
  message: Omit<ChatMessage, "id" | "createdAt"> & {
    id?: string
    createdAt?: number
  },
): Promise<ChatMessage> {
  const record: MessageRecord = {
    id: message.id ?? newId(),
    conversationId,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt ?? Date.now(),
  }
  const db = await getDB()
  // 同事务里把会话的 updatedAt 顶到当前——保证 Sidebar 排序立刻生效。
  const tx = db.transaction(["messages", "conversations"], "readwrite")
  await tx.objectStore("messages").put(record)
  const conv = await tx.objectStore("conversations").get(conversationId)
  if (conv) {
    await tx
      .objectStore("conversations")
      .put({ ...conv, updatedAt: record.createdAt })
  }
  await tx.done
  return {
    id: record.id,
    role: record.role,
    content: record.content,
    createdAt: record.createdAt,
  }
}

// 整条覆盖一条消息（最常见用法：流式结束时把内存里拼好的 assistant 内容落盘）。
export async function putMessage(
  conversationId: string,
  message: ChatMessage,
): Promise<void> {
  const record: MessageRecord = { ...message, conversationId }
  const db = await getDB()
  await db.put("messages", record)
}

// 删除指定消息之后（含它本身）所有 createdAt >= 该时刻的消息——Stage 5 编辑/重发时用。
// 这里先放工具函数，Stage 4 还不调。
export async function deleteMessagesFrom(
  conversationId: string,
  fromCreatedAt: number,
): Promise<void> {
  const db = await getDB()
  const tx = db.transaction("messages", "readwrite")
  const all = await tx.store.index("byConversation").getAll(conversationId)
  await Promise.all(
    all
      .filter((m) => m.createdAt >= fromCreatedAt)
      .map((m) => tx.store.delete(m.id)),
  )
  await tx.done
}

// ---- 标题自动生成 ----

// 第一条 user 消息进来后调一次：截前 30 字作为会话标题。
// 中文里 String.length 是 UTF-16 code unit 数，对 BMP 字符（含常用汉字）= 字数。
// emoji 这种代理对会算 2，体验上略短，但不影响功能——以后真的需要再用 Intl.Segmenter。
export function deriveTitle(firstUserContent: string): string {
  const trimmed = firstUserContent.trim().replace(/\s+/g, " ")
  if (!trimmed) return "新对话"
  return trimmed.length > 30 ? trimmed.slice(0, 30) + "…" : trimmed
}

// ---- 类型再导出（方便 store 一处 import）----

export type { ConversationRecord, MessageRecord }
export type { Role }
