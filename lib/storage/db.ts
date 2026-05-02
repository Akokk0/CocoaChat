import { openDB, type DBSchema, type IDBPDatabase } from "idb"

// 数据库版本。
// 每次需要新建/修改 object store 时把它 +1，并在 upgrade 回调里追加分支。
// 分支一旦发版就不能再删——老设备会从 v1 一路跑到当前最新。
const DB_NAME = "cocoa-chat"
const DB_VERSION = 1

// idb 的 DBSchema 给整个数据库做类型标注：
// 之后调 db.get("settings", key) 时编译器知道 key 类型、value 类型。
export interface CocoaChatSchema extends DBSchema {
  settings: {
    key: string
    // value 是 zustand persist 写入的 StorageValue 形状（{ state, version }），
    // 我们这里不约束具体类型，让 store 那边强类型；这里 unknown 表示"由调用方保证"。
    value: unknown
  }
  // Stage 4 会扩展：
  // conversations: { key: string; value: Conversation; indexes: { byUpdatedAt: number } }
  // messages: { key: string; value: Message; indexes: { byConversation: string } }
}

// 单例：整个 app 共用一个连接。
// idb 的 openDB 内部会复用打开的句柄，但我们自己也保留 promise，
// 避免 React 多次渲染导致重复调用。
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
        if (oldVersion < 1) {
          db.createObjectStore("settings")
        }
      },
    })
  }
  return dbPromise
}
