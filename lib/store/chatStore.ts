import { create } from "zustand"

import {
  appendMessage,
  createConversation as repoCreateConversation,
  deleteConversation as repoDeleteConversation,
  deriveTitle,
  listConversations,
  listMessagesByConversation,
  putMessage,
  touchConversation,
  updateConversation as repoUpdateConversation,
  type ConversationRecord,
} from "@/lib/storage/repository"
import type { ChatMessage } from "@/lib/types/chat"

// chatStore 的角色：UI 单数据源 + IDB 的内存镜像。
// 所有 UI 组件订阅这里；所有 IDB 写入由 actions 触发（绕开它直接 import repository 的代码就脱离了真理来源）。

// ---- 类型 ----

interface ChatState {
  // 全部会话（已按 updatedAt 降序）。删/改/新建后由对应 action 维护。
  conversations: ConversationRecord[]
  // 当前选中的会话 id；null = 还没选/没有任何会话。
  currentId: string | null
  // 当前会话的消息（仅当前一个会话的——切走时整体替换）。
  messages: ChatMessage[]
  // hydrate 完成标志。UI 用它显示骨架屏 / 避免空列表抖动。
  isHydrated: boolean
}

interface ChatActions {
  // ---- 生命周期 ----
  hydrate: () => Promise<void>

  // ---- 会话 ----
  createConversation: () => Promise<string> // 返回新建会话 id
  selectConversation: (id: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>

  // ---- 消息（给 useChatStream 用） ----
  // 返回值是新插入的 ChatMessage，hook 拿它的 id 做后续 update。
  appendUserMessage: (conversationId: string, content: string) => Promise<ChatMessage>
  // 流式开始前在内存里加一条空 assistant；不写 IDB，等流结束再落盘。
  appendAssistantPlaceholder: (conversationId: string) => ChatMessage
  // 流式期间只更新内存，性能关键路径，纯 set。
  updateAssistantContent: (id: string, delta: string) => void
  // 流式结束时一次性把 assistant 内容落盘。
  persistAssistantMessage: (conversationId: string, id: string) => Promise<void>
  // abort/error 回退：删掉末尾那条空 assistant 占位。
  removeLastAssistantIfEmpty: (id: string) => void
  // 清当前会话内存（不删 IDB）——切会话/重置 UI 用。
  clearCurrentMessages: () => void
}

type Store = ChatState & ChatActions

// ---- 初始状态 ----

const INITIAL: ChatState = {
  conversations: [],
  currentId: null,
  messages: [],
  isHydrated: false,
}

// ---- Store ----

export const useChatStore = create<Store>()((set, get) => ({
  ...INITIAL,

  // 应用启动时调一次。读会话列表，若有则自动选中最新那条并加载它的消息。
  // 这样用户重开浏览器能直接接着上次最近活跃的会话——比"必须自己点一下"友好得多。
  async hydrate() {
    if (get().isHydrated) return
    const conversations = await listConversations()
    if (conversations.length === 0) {
      set({ conversations, isHydrated: true })
      return
    }
    const first = conversations[0]
    const messages = await listMessagesByConversation(first.id)
    set({
      conversations,
      currentId: first.id,
      messages,
      isHydrated: true,
    })
  },

  async createConversation() {
    const record = await repoCreateConversation({ title: "新对话" })
    set((s) => ({
      // 新会话进列表头（updatedAt 最新）
      conversations: [record, ...s.conversations],
      currentId: record.id,
      messages: [],
    }))
    return record.id
  },

  async selectConversation(id) {
    if (get().currentId === id) return // 点的就是当前——避免无效 IDB 读
    const messages = await listMessagesByConversation(id)
    set({ currentId: id, messages })
  },

  async deleteConversation(id) {
    await repoDeleteConversation(id)
    set((s) => {
      const conversations = s.conversations.filter((c) => c.id !== id)
      // 删的就是当前会话——挑剩下的最新一条接管，否则归零。
      if (s.currentId !== id) return { conversations }
      const next = conversations[0]
      return next
        ? { conversations, currentId: next.id, messages: [] /* 异步加载在外面接 */ }
        : { conversations, currentId: null, messages: [] }
    })
    // 切到新选中会话的消息（如果有）。放在 set 之外避免 setState 里 await。
    const after = get()
    if (after.currentId && after.messages.length === 0) {
      const messages = await listMessagesByConversation(after.currentId)
      set({ messages })
    }
  },

  async renameConversation(id, title) {
    const trimmed = title.trim() || "新对话"
    const updated = await repoUpdateConversation(id, { title: trimmed })
    if (!updated) return
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? updated : c)),
    }))
  },

  // ---- 消息 actions ----

  async appendUserMessage(conversationId, content) {
    // 1) 写消息（同事务里把会话 updatedAt 顶起来）
    const message = await appendMessage(conversationId, {
      role: "user",
      content,
    })

    // 2) 标题自动生成：当前会话之前没有任何消息时，把这条 user 内容作为标题。
    //    从内存里判断，避免再读一次 IDB。
    const state = get()
    const isFirstUserMessage =
      state.currentId === conversationId &&
      !state.messages.some((m) => m.role === "user")
    let titlePatch: ConversationRecord | null = null
    if (isFirstUserMessage) {
      titlePatch = await repoUpdateConversation(conversationId, {
        title: deriveTitle(content),
      })
    }

    // 3) 同步内存：messages 加上新消息；conversations 更新 updatedAt（让 Sidebar 排序刷新），
    //    若改了标题也合并进去。
    set((s) => ({
      messages: [...s.messages, message],
      conversations: s.conversations
        .map((c) => {
          if (c.id !== conversationId) return c
          return titlePatch ?? { ...c, updatedAt: message.createdAt }
        })
        // 重排：刚动过的那条提到最前。
        .sort((a, b) => b.updatedAt - a.updatedAt),
    }))
    return message
  },

  appendAssistantPlaceholder(conversationId) {
    const placeholder: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    }
    set((s) => {
      // 仅在 placeholder 属于当前会话时写入 messages（防极端时序：流式中切走会话）。
      if (s.currentId !== conversationId) return s
      return { messages: [...s.messages, placeholder] }
    })
    return placeholder
  },

  updateAssistantContent(id, delta) {
    // 流式热路径——避免 immer / 复杂选择器，最朴素的 map 即可。
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + delta } : m,
      ),
    }))
  },

  async persistAssistantMessage(conversationId, id) {
    // 从内存找出最终内容，一次写盘。
    const message = get().messages.find((m) => m.id === id)
    if (!message) return // 用户可能已经切走会话/删掉这条——容忍
    await putMessage(conversationId, message)
    // 顺手把会话 updatedAt 顶起来，确保流式结束后 Sidebar 排序也刷新。
    await touchConversation(conversationId)
    set((s) => ({
      conversations: s.conversations
        .map((c) =>
          c.id === conversationId ? { ...c, updatedAt: message.createdAt } : c,
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
    }))
  },

  removeLastAssistantIfEmpty(id) {
    set((s) => {
      const last = s.messages[s.messages.length - 1]
      if (!last || last.id !== id || last.content !== "") return s
      return { messages: s.messages.slice(0, -1) }
    })
  },

  clearCurrentMessages() {
    set({ messages: [] })
  },
}))

// ---- 选择器 ----

// 用法：const conv = useChatStore(selectCurrentConversation)
// 比 (s) => s.conversations.find(c => c.id === s.currentId) 这种内联函数好——
// 内联每次渲染都是新引用，会让 Zustand 的 shallow 比较失效。
export const selectCurrentConversation = (s: Store) =>
  s.conversations.find((c) => c.id === s.currentId) ?? null
