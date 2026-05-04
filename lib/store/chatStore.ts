import { create } from "zustand"

import {
  appendMessage,
  createConversation as repoCreateConversation,
  deleteConversation as repoDeleteConversation,
  deleteMessage as repoDeleteMessage,
  deleteMessages as repoDeleteMessages,
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
// 所有 UI 组件订阅这里；所有 IDB 写入由 actions 触发。
//
// Stage 6 改造（messagesByConv）：
// 之前 messages: ChatMessage[] 只装"当前会话"的——切走会话时旧会话的流式内容
// 没地方写、丢失。现在按会话 id 索引：messagesByConv: Record<convId, ChatMessage[]>。
// 用户在 A 会话发问、切到 B 会话，A 的 stream 继续往 messagesByConv[A] 写；
// 切回 A 时直接从内存看到完整内容——不需要再读 IDB，也没有"消息穿越到错的会话"问题。
//
// hydratedConvIds 跟踪"哪些会话的 messages 已加载到内存"——切到一个新会话时
// 才真正去读 IDB，避免一次性把所有历史会话都加载进内存。

// ---- 类型 ----

interface ChatState {
  // 全部会话（已按 updatedAt 降序）。删/改/新建后由对应 action 维护。
  conversations: ConversationRecord[]
  // 当前选中的会话 id；null = 还没选/没有任何会话。
  currentId: string | null
  // 按会话 id 索引的内存消息缓存。只有 hydratedConvIds 里的才在这里。
  messagesByConv: Record<string, ChatMessage[]>
  // 哪些会话的 messages 已经从 IDB 拉进内存。
  // 用 Set 而不是 boolean Map——批量传入更顺手，相等性判断也方便。
  hydratedConvIds: Set<string>
  // hydrate 完成标志（针对 conversations 列表本身，不针对单个会话的 messages）。
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
  // 所有 action 都接受 conversationId——不再依赖 currentId，让流式能在后台跨会话进行。
  appendUserMessage: (
    conversationId: string,
    content: string,
  ) => Promise<ChatMessage>
  appendAssistantPlaceholder: (conversationId: string) => ChatMessage
  updateAssistantContent: (
    conversationId: string,
    id: string,
    delta: string,
  ) => void
  persistAssistantMessage: (
    conversationId: string,
    id: string,
  ) => Promise<void>
  removeLastAssistantIfEmpty: (conversationId: string, id: string) => void
  removeMessage: (conversationId: string, id: string) => Promise<void>
  truncateFrom: (conversationId: string, messageId: string) => Promise<void>
  setConversationSystemPrompt: (
    conversationId: string,
    prompt: string,
  ) => Promise<void>
}

type Store = ChatState & ChatActions

// ---- 初始状态 ----

const INITIAL: ChatState = {
  conversations: [],
  currentId: null,
  messagesByConv: {},
  hydratedConvIds: new Set(),
  isHydrated: false,
}

// 工具：immutable 替换某 conv 的 messages。
function withMessages(
  state: ChatState,
  conversationId: string,
  next: ChatMessage[],
): Pick<ChatState, "messagesByConv"> {
  return {
    messagesByConv: {
      ...state.messagesByConv,
      [conversationId]: next,
    },
  }
}

// ---- Store ----

export const useChatStore = create<Store>()((set, get) => ({
  ...INITIAL,

  // 应用启动时调一次。读会话列表，若有则自动选中最新那条并加载它的消息。
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
      messagesByConv: { [first.id]: messages },
      hydratedConvIds: new Set([first.id]),
      isHydrated: true,
    })
  },

  async createConversation() {
    const record = await repoCreateConversation({ title: "新对话" })
    set((s) => ({
      conversations: [record, ...s.conversations],
      currentId: record.id,
      // 新会话内存里直接给个空数组——避免后续 append 时还要 ensure。
      messagesByConv: { ...s.messagesByConv, [record.id]: [] },
      hydratedConvIds: new Set([...s.hydratedConvIds, record.id]),
    }))
    return record.id
  },

  async selectConversation(id) {
    if (get().currentId === id) return
    // 立刻切 UI——messages 用上一次缓存（即使可能是空，UI 显示会从骨架/空开始）。
    // 后台读 IDB 把 messages 填进 messagesByConv[id]——避免点击会话时的等待感。
    set({ currentId: id })
    if (!get().hydratedConvIds.has(id)) {
      const messages = await listMessagesByConversation(id)
      // 二次检查：在我们读 IDB 期间，可能 streaming 已经往这个 conv 写了 placeholder。
      // 不要直接覆盖——把 IDB 读出的历史和已存在的内存合并（按 id 去重 + 按 createdAt 排）。
      set((s) => {
        const existing = s.messagesByConv[id]
        if (!existing || existing.length === 0) {
          return {
            ...withMessages(s, id, messages),
            hydratedConvIds: new Set([...s.hydratedConvIds, id]),
          }
        }
        // existing 里可能有 streaming 占位，IDB 读不出来——保留它们。
        // 简单 merge：以 id 去重，IDB 的优先（更权威），internal 的补在末尾。
        const seen = new Set(messages.map((m) => m.id))
        const tail = existing.filter((m) => !seen.has(m.id))
        const merged = [...messages, ...tail]
        return {
          ...withMessages(s, id, merged),
          hydratedConvIds: new Set([...s.hydratedConvIds, id]),
        }
      })
    }
  },

  async deleteConversation(id) {
    await repoDeleteConversation(id)
    set((s) => {
      const conversations = s.conversations.filter((c) => c.id !== id)
      // 显式构造新对象，比 destructure-and-rest 让 lint 更舒服。
      const restMessages = { ...s.messagesByConv }
      delete restMessages[id]
      const newHydrated = new Set(s.hydratedConvIds)
      newHydrated.delete(id)
      if (s.currentId !== id) {
        return {
          conversations,
          messagesByConv: restMessages,
          hydratedConvIds: newHydrated,
        }
      }
      // 删的就是当前会话——挑剩下的最新一条接管，否则归零。
      const next = conversations[0]
      return {
        conversations,
        messagesByConv: restMessages,
        hydratedConvIds: newHydrated,
        currentId: next?.id ?? null,
      }
    })
    // 切到新选中会话的消息（如果有，且未加载）。
    const after = get()
    const newCurrentId = after.currentId
    if (newCurrentId && !after.hydratedConvIds.has(newCurrentId)) {
      const messages = await listMessagesByConversation(newCurrentId)
      set((s) => ({
        ...withMessages(s, newCurrentId, messages),
        hydratedConvIds: new Set([...s.hydratedConvIds, newCurrentId]),
      }))
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

    // 2) 标题自动生成：当前会话之前没有任何 user 消息时，把这条 user 内容作为标题。
    //    用 messagesByConv[conversationId] 判断（不再依赖 currentId）——
    //    切走会话也照常工作。
    const existing = get().messagesByConv[conversationId] ?? []
    const isFirstUserMessage = !existing.some((m) => m.role === "user")
    let titlePatch: ConversationRecord | null = null
    if (isFirstUserMessage) {
      titlePatch = await repoUpdateConversation(conversationId, {
        title: deriveTitle(content),
      })
    }

    // 3) 同步内存：messagesByConv[convId] 加新消息；conversations 更新 updatedAt。
    set((s) => ({
      ...withMessages(s, conversationId, [
        ...(s.messagesByConv[conversationId] ?? []),
        message,
      ]),
      conversations: s.conversations
        .map((c) => {
          if (c.id !== conversationId) return c
          return titlePatch ?? { ...c, updatedAt: message.createdAt }
        })
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
    // 注意：不再判断 currentId === conversationId。哪怕用户切走了会话，
    // placeholder 仍然写到 messagesByConv[conversationId]——切回来能立刻看到流式内容。
    set((s) => ({
      ...withMessages(s, conversationId, [
        ...(s.messagesByConv[conversationId] ?? []),
        placeholder,
      ]),
    }))
    return placeholder
  },

  updateAssistantContent(conversationId, id, delta) {
    // 流式热路径：避免 immer / 复杂选择器，最朴素的 map 即可。
    set((s) => {
      const existing = s.messagesByConv[conversationId]
      if (!existing) return s // 会话已被删——丢弃这次 update
      return {
        ...withMessages(
          s,
          conversationId,
          existing.map((m) =>
            m.id === id ? { ...m, content: m.content + delta } : m,
          ),
        ),
      }
    })
  },

  async persistAssistantMessage(conversationId, id) {
    // 从内存找出最终内容，一次写盘。
    const messages = get().messagesByConv[conversationId]
    if (!messages) return // 会话已被删
    const message = messages.find((m) => m.id === id)
    if (!message) return // 用户可能已经删掉这条——容忍
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

  removeLastAssistantIfEmpty(conversationId, id) {
    set((s) => {
      const existing = s.messagesByConv[conversationId]
      if (!existing) return s
      const last = existing[existing.length - 1]
      if (!last || last.id !== id || last.content !== "") return s
      return { ...withMessages(s, conversationId, existing.slice(0, -1)) }
    })
  },

  // ---- Stage 5：编辑 / 重发 ----

  async removeMessage(conversationId, id) {
    set((s) => ({
      ...withMessages(
        s,
        conversationId,
        (s.messagesByConv[conversationId] ?? []).filter((m) => m.id !== id),
      ),
    }))
    await repoDeleteMessage(id)
  },

  async truncateFrom(conversationId, messageId) {
    const messages = get().messagesByConv[conversationId]
    if (!messages) return
    const idx = messages.findIndex((m) => m.id === messageId)
    if (idx < 0) return
    const toDelete = messages.slice(idx).map((m) => m.id)
    set((s) => ({
      ...withMessages(s, conversationId, messages.slice(0, idx)),
    }))
    await repoDeleteMessages(toDelete)
  },

  async setConversationSystemPrompt(conversationId, prompt) {
    const trimmed = prompt.trim()
    const updated = await repoUpdateConversation(conversationId, {
      systemPrompt: trimmed || undefined,
    })
    if (!updated) return
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? updated : c,
      ),
    }))
  },
}))

// ---- 选择器 ----

export const selectCurrentConversation = (s: Store) =>
  s.conversations.find((c) => c.id === s.currentId) ?? null

// 共享的"空 messages"常量——selector 每次返回新数组会让 zustand 的 ===
// 比较永远失败，触发 useSyncExternalStore 报"infinite loop"。
// 引用稳定的常量是规避方法：null currentId / 未加载会话都返回同一个。
const EMPTY_MESSAGES: ChatMessage[] = []

// 当前会话的 messages（替代旧的 s.messages）。
// 注意：如果 currentId 切到一个还没 hydrate 的会话，返回稳定的 EMPTY_MESSAGES。
// hydrate 完成后 selector 重新派生，列表自动出现。
export const selectCurrentMessages = (s: Store): ChatMessage[] => {
  if (!s.currentId) return EMPTY_MESSAGES
  return s.messagesByConv[s.currentId] ?? EMPTY_MESSAGES
}
