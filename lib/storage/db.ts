import { openDB, type DBSchema, type IDBPDatabase } from "idb"

import type { ChatMessage } from "@/lib/types/chat"

// 数据库版本。
// 每次需要新建/修改 object store 时把它 +1，并在 upgrade 回调里追加分支。
// 分支一旦发版就不能再删——老设备会从 v1 一路跑到当前最新。
const DB_NAME = "cocoa-chat"
const DB_VERSION = 2

// ---- 业务实体（落盘形态） ----

// 会话元数据。正文（messages）放另一个 store，按 conversationId 索引取出。
// 这样删一条消息只重写一条记录；嵌套写法每次 append 都要重写整个数组。
export interface ConversationRecord {
  id: string
  title: string
  createdAt: number
  // 排序依据：最近一次"动过"（发消息、改标题、删消息）的时间戳。
  updatedAt: number
  // 单会话覆盖系统提示。Stage 5 用，Stage 4 先放着。
  systemPrompt?: string
}

// 消息记录 = ChatMessage + 所属会话外键。
// 内存里的 ChatMessage 不带 conversationId（只有当前会话的消息会进内存）；
// 落盘时必须挂上外键，否则按会话查不出来。
export interface MessageRecord extends ChatMessage {
  conversationId: string
}

// ---- DBSchema：给整个数据库做类型标注 ----

// 之后调 db.get("conversations", id) 时编译器知道返回 ConversationRecord，
// db.transaction(["messages"], "readwrite") 时也知道 store 名只有这几种合法值。
export interface CocoaChatSchema extends DBSchema {
  settings: {
    key: string
    // value 是 zustand persist 写入的 StorageValue 形状（{ state, version }），
    // 让 store 那边强类型；这里 unknown 表示"由调用方保证"。
    value: unknown
  }
  conversations: {
    key: string // = ConversationRecord.id
    value: ConversationRecord
    indexes: {
      // 列表按"最近活跃"降序时用。IDB 的 cursor 默认升序，
      // 我们 listConversations 时用 'prev' 方向反着遍历即可。
      byUpdatedAt: number
    }
  }
  messages: {
    key: string // = MessageRecord.id
    value: MessageRecord
    indexes: {
      // "给我会话 X 的所有消息"用这个；级联删除时也用它批量找 key。
      byConversation: string
    }
  }
}

// ---- 单例连接 ----

// 整个 app 共用一个连接。idb 的 openDB 内部会复用句柄，
// 但我们自己也保留 promise，避免 React 多次渲染导致重复调用。
let dbPromise: Promise<IDBPDatabase<CocoaChatSchema>> | null = null

export function getDB(): Promise<IDBPDatabase<CocoaChatSchema>> {
  // SSR 防御：服务器端没有 indexedDB 全局对象。
  // 任何 Server Component 不小心 import 这个模块会触发它，给清晰报错。
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("getDB() called on server — only use it from client components"),
    )
  }
  if (!dbPromise) {
    dbPromise = openDB<CocoaChatSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // 渐进式 schema 迁移。每个 if 块只对应一次版本提升。
        // 关键：分支按版本递增顺序写——一个从 v0 装新版的设备会依次跑 <1 和 <2。
        if (oldVersion < 1) {
          db.createObjectStore("settings")
        }
        if (oldVersion < 2) {
          // conversations：keyPath="id" 表示主键就是 record.id，put 时不用单独传 key。
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
