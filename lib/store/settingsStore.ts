import { create } from "zustand"
import { persist, type PersistStorage } from "zustand/middleware"

import { getDB } from "@/lib/storage/db"

export interface SettingsState {
  apiKey: string
  baseURL: string
  model: string
  systemPrompt: string
  temperature: number
  // null = 不显式限制 max_tokens，让 provider 用默认值。
  maxTokens: number | null
}

interface SettingsActions {
  setSettings: (updates: Partial<SettingsState>) => void
  reset: () => void
}

type Store = SettingsState & SettingsActions

const DEFAULTS: SettingsState = {
  apiKey: "",
  baseURL: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  systemPrompt: "",
  temperature: 0.7,
  maxTokens: null,
}

// IDB 原生支持结构化克隆——直接存对象，不需要 JSON.stringify。
const STORAGE_KEY = "user-settings"

const idbStorage: PersistStorage<SettingsState> = {
  async getItem(name) {
    try {
      const db = await getDB()
      const value = await db.get("settings", name)
      return (value as ReturnType<PersistStorage<SettingsState>["getItem"]>) ?? null
    } catch (err) {
      // 私密浏览 / 浏览器禁用 IDB 时降级为内存 store（不报错，仅不持久化）。
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
      // 禁用自动 hydrate：在 Providers 显式触发，避开 SSR（服务器没有 indexedDB）。
      skipHydration: true,
      // 只挑数据字段，过滤 actions（函数无法结构化克隆）。
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

export const selectApiKey = (s: Store) => s.apiKey
export const selectModel = (s: Store) => s.model
