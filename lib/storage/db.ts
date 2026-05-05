import { openDB, type DBSchema, type IDBPDatabase } from "idb"

import type { ChatMessage } from "@/lib/types/chat"

// DB_VERSION 每次新增/修改 store 时 +1，并在 upgrade 里追加分支；
// 分支按版本递增顺序写——一旦发版不能删，老设备会从 v1 一路跑到当前。
const DB_NAME = "cocoa-chat"
const DB_VERSION = 2

// 正文（messages）放另一个 store 按 conversationId 索引——删/改单条只重写一条记录，
// 嵌套写法每次 append 都要重写整个数组。
export interface ConversationRecord {
  id: string
  title: string
  createdAt: number
  // 排序依据：最近一次"动过"（发消息、改标题、删消息）的时间戳。
  updatedAt: number
  systemPrompt?: string
}

// 内存 ChatMessage 不带 conversationId（只有当前会话进内存）；落盘必须挂外键。
export interface MessageRecord extends ChatMessage {
  conversationId: string
}

export interface CocoaChatSchema extends DBSchema {
  settings: {
    key: string
    // zustand persist 的 StorageValue 形状（{ state, version }），由调用方保证。
    value: unknown
  }
  conversations: {
    key: string
    value: ConversationRecord
    indexes: {
      // listConversations 用 cursor 'prev' 反向遍历拿"最近活跃在前"。
      byUpdatedAt: number
    }
  }
  messages: {
    key: string
    value: MessageRecord
    indexes: {
      // 按会话查 + 级联删除批量找 key 用。
      byConversation: string
    }
  }
}

let dbPromise: Promise<IDBPDatabase<CocoaChatSchema>> | null = null

export function getDB(): Promise<IDBPDatabase<CocoaChatSchema>> {
  // SSR 防御：Server Component 不小心 import 时给清晰报错。
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("getDB() called on server — only use it from client components"),
    )
  }
  if (!dbPromise) {
    dbPromise = openDB<CocoaChatSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("settings")
        }
        if (oldVersion < 2) {
          const conv = db.createObjectStore("conversations", { keyPath: "id" })
          conv.createIndex("byUpdatedAt", "updatedAt")

          const msg = db.createObjectStore("messages", { keyPath: "id" })
          msg.createIndex("byConversation", "conversationId")
        }
      },
    })
  }
  return dbPromise
}
