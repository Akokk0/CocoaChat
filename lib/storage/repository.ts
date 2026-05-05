// IDB 的业务函数层——store 那边只看到语义函数，将来换实现改这一处即可。

import { getDB, type ConversationRecord, type MessageRecord } from "@/lib/storage/db"
import type { ChatMessage, Role } from "@/lib/types/chat"

function newId(): string {
  return crypto.randomUUID()
}

export async function listConversations(): Promise<ConversationRecord[]> {
  const db = await getDB()
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
  // 单事务读改写——避免两 tab 同改丢数据。
  // 故意不动 updatedAt：updatedAt 只在"消息层活动"里推；改标题/系统提示属于元数据，
  // 不应让会话排到列表顶部（之前误设 Date.now() 导致重命名后顺序突变）。
  const tx = db.transaction("conversations", "readwrite")
  const existing = await tx.store.get(id)
  if (!existing) {
    await tx.done
    return null
  }
  const updated: ConversationRecord = {
    ...existing,
    ...patch,
  }
  await tx.store.put(updated)
  await tx.done
  return updated
}

// 仅更新活跃时间戳，让会话排到最前面。
export async function touchConversation(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction("conversations", "readwrite")
  const existing = await tx.store.get(id)
  if (existing) {
    await tx.store.put({ ...existing, updatedAt: Date.now() })
  }
  await tx.done
}

// 级联删除：会话 + 名下所有消息，单事务原子（跨 store 必须在 transaction([...]) 一次声明）。
export async function deleteConversation(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(["conversations", "messages"], "readwrite")
  const msgKeys = await tx
    .objectStore("messages")
    .index("byConversation")
    .getAllKeys(id)
  await Promise.all([
    ...msgKeys.map((k) => tx.objectStore("messages").delete(k)),
    tx.objectStore("conversations").delete(id),
  ])
  await tx.done
}

export async function listMessagesByConversation(
  conversationId: string,
): Promise<ChatMessage[]> {
  const db = await getDB()
  const rows = await db.getAllFromIndex(
    "messages",
    "byConversation",
    conversationId,
  )
  // index.getAll 不保证顺序——按 createdAt 升序，同毫秒按 id 兜底稳定性。
  rows.sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt - b.createdAt,
  )
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
  // 单事务写消息 + 顶 updatedAt——保证 Sidebar 排序立刻生效。
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

export async function putMessage(
  conversationId: string,
  message: ChatMessage,
): Promise<void> {
  const record: MessageRecord = { ...message, conversationId }
  const db = await getDB()
  await db.put("messages", record)
}

// 单事务写消息 + 顶 updatedAt——拆两次会出现"消息落盘但时间戳没更"的不一致。
export async function putMessageAndTouch(
  conversationId: string,
  message: ChatMessage,
): Promise<void> {
  const record: MessageRecord = { ...message, conversationId }
  const db = await getDB()
  const tx = db.transaction(["messages", "conversations"], "readwrite")
  await tx.objectStore("messages").put(record)
  const conv = await tx.objectStore("conversations").get(conversationId)
  if (conv) {
    await tx
      .objectStore("conversations")
      .put({ ...conv, updatedAt: message.createdAt })
  }
  await tx.done
}

export async function deleteMessage(id: string): Promise<void> {
  const db = await getDB()
  await db.delete("messages", id)
}

// 按 id 而非 createdAt 阈值：上层从内存数组拿到要删的 id，不依赖时间戳单调
// （同毫秒多条消息会出错）。
export async function deleteMessages(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const db = await getDB()
  const tx = db.transaction("messages", "readwrite")
  await Promise.all(ids.map((id) => tx.store.delete(id)))
  await tx.done
}

// 第一条 user 消息进来后调一次：截前 30 字作为会话标题。
export function deriveTitle(firstUserContent: string): string {
  const trimmed = firstUserContent.trim().replace(/\s+/g, " ")
  if (!trimmed) return "新对话"
  return trimmed.length > 30 ? trimmed.slice(0, 30) + "…" : trimmed
}

export type { ConversationRecord, MessageRecord }
export type { Role }
