import { create } from "zustand"
import { persist, type PersistStorage } from "zustand/middleware"

import { getDB } from "@/lib/storage/db"

// ---- 类型 ----

// State：纯数据，会被持久化。
export interface SettingsState {
  apiKey: string
  baseURL: string
  model: string
  systemPrompt: string
  temperature: number
  // null 表示"不显式限制 max_tokens"——让 provider 用默认值。
  maxTokens: number | null
}

// Actions：行为，不持久化。
interface SettingsActions {
  setSettings: (updates: Partial<SettingsState>) => void
  reset: () => void
}

type Store = SettingsState & SettingsActions

// ---- 默认值 ----

const DEFAULTS: SettingsState = {
  apiKey: "",
  baseURL: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  systemPrompt: "",
  temperature: 0.7,
  maxTokens: null,
}

// ---- IndexedDB Storage Adapter ----

// PersistStorage<S> 是 Zustand 内部约定的接口：
//   getItem -> StorageValue<S> | null     形状是 { state: S, version: number }
//   setItem -> 把 StorageValue<S> 存起来
// 跟 localStorage 不一样，IDB 原生支持结构化克隆，
// 所以我们直接存对象，不需要 JSON.stringify。
const STORAGE_KEY = "user-settings"

const idbStorage: PersistStorage<SettingsState> = {
  async getItem(name) {
    try {
      const db = await getDB()
      const value = await db.get("settings", name)
      // value 已经是结构化克隆出的对象（或 undefined）
      return (value as ReturnType<PersistStorage<SettingsState>["getItem"]>) ?? null
    } catch (err) {
      // 私密浏览模式 / 浏览器禁用 IDB 时，降级为内存 store（不报错，只是不持久化）
      console.warn("[settings] IndexedDB read failed:", err)
      return null
    }
  },
  async setItem(name, value) {
    try {
      const db = await getDB()
      await db.put("settings", value, name)
    } catch (err) {
      console.warn("[settings] IndexedDB write failed:", err)
    }
  },
  async removeItem(name) {
    try {
      const db = await getDB()
      await db.delete("settings", name)
    } catch (err) {
      console.warn("[settings] IndexedDB delete failed:", err)
    }
  },
}

// ---- Store ----

export const useSettings = create<Store>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setSettings: (updates) => set(updates),
      reset: () => set(DEFAULTS),
    }),
    {
      name: STORAGE_KEY,
      storage: idbStorage,
      // 关键：禁用自动 hydrate。
      // 我们在 Providers 里显式触发，避开 SSR 阶段（服务器没有 indexedDB）。
      skipHydration: true,
      // 持久化时只挑数据字段，过滤掉 actions（函数无法结构化克隆）。
      partialize: (state) => ({
        apiKey: state.apiKey,
        baseURL: state.baseURL,
        model: state.model,
        systemPrompt: state.systemPrompt,
        temperature: state.temperature,
        maxTokens: state.maxTokens,
      }),
    },
  ),
)

// 便捷选择器（避免组件订阅整个 store 导致不必要的重渲染）。
// 用法：const apiKey = useSettings(selectApiKey)
export const selectApiKey = (s: Store) => s.apiKey
export const selectModel = (s: Store) => s.model
