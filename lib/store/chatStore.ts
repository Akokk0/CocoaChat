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
  putMessageAndTouch,
  updateConversation as repoUpdateConversation,
  type ConversationRecord,
} from "@/lib/storage/repository"
import type { ChatMessage } from "@/lib/types/chat"

interface ChatState {
  conversations: ConversationRecord[]
  currentId: string | null
  messagesByConv: Record<string, ChatMessage[]>
  hydratedConvIds: Set<string>
  isHydrated: boolean
}

interface ChatActions {
  hydrate: () => Promise<void>

  createConversation: () => Promise<string>
  selectConversation: (id: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>

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

const INITIAL: ChatState = {
  conversations: [],
  currentId: null,
  messagesByConv: {},
  hydratedConvIds: new Set(),
  isHydrated: false,
}

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

// 按 id 去重合并、按 updatedAt 降序。
// hydrate 期间用户可能新建会话——内存版本要优先于 IDB 读出的旧值。
function mergeConversations(
  inMemory: ConversationRecord[],
  fromDb: ConversationRecord[],
): ConversationRecord[] {
  const map = new Map<string, ConversationRecord>()
  for (const c of fromDb) map.set(c.id, c)
  for (const c of inMemory) map.set(c.id, c)
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export const useChatStore = create<Store>()((set, get) => ({
  ...INITIAL,

  // hydrate 走两次 await IDB——其间用户可能 createConversation / 触发 streaming /
  // 改 currentId。functional set 合并而非替换，避免 stomp 这些进行中的内存状态。
  async hydrate() {
    if (get().isHydrated) return
    const conversations = await listConversations()
    if (conversations.length === 0) {
      set((s) => ({
        conversations: mergeConversations(s.conversations, conversations),
        isHydrated: true,
      }))
      return
    }
    const first = conversations[0]
    const messages = await listMessagesByConversation(first.id)
    set((s) => {
      const merged = mergeConversations(s.conversations, conversations)
      const currentId = s.currentId ?? first.id
      const messagesByConv = { ...s.messagesByConv }
      const existing = messagesByConv[first.id]
      if (existing && existing.length > 0) {
        // 内存里已有内容（可能是 streaming 占位），按 id 去重 merge——不能直接覆盖。
        const seen = new Set(messages.map((m) => m.id))
        messagesByConv[first.id] = [
          ...messages,
          ...existing.filter((m) => !seen.has(m.id)),
        ]
      } else {
        messagesByConv[first.id] = messages
      }
      return {
        conversations: merged,
        currentId,
        messagesByConv,
        hydratedConvIds: new Set([...s.hydratedConvIds, first.id]),
        isHydrated: true,
      }
    })
  },

  async createConversation() {
    const record = await repoCreateConversation({ title: "新对话" })
    set((s) => ({
      conversations: [record, ...s.conversations],
      currentId: record.id,
      messagesByConv: { ...s.messagesByConv, [record.id]: [] },
      hydratedConvIds: new Set([...s.hydratedConvIds, record.id]),
    }))
    return record.id
  },

  async selectConversation(id) {
    if (get().currentId === id) return
    set({ currentId: id })
    if (!get().hydratedConvIds.has(id)) {
      const messages = await listMessagesByConversation(id)
      // 二次去重：读 IDB 期间 streaming 可能已经往这个 conv 写了 placeholder。
      set((s) => {
        const existing = s.messagesByConv[id]
        if (!existing || existing.length === 0) {
          return {
            ...withMessages(s, id, messages),
            hydratedConvIds: new Set([...s.hydratedConvIds, id]),
          }
        }
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
      const next = conversations[0]
      return {
        conversations,
        messagesByConv: restMessages,
        hydratedConvIds: newHydrated,
        currentId: next?.id ?? null,
      }
    })
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

  async appendUserMessage(conversationId, content) {
    const message = await appendMessage(conversationId, {
      role: "user",
      content,
    })

    const existing = get().messagesByConv[conversationId] ?? []
    const isFirstUserMessage = !existing.some((m) => m.role === "user")
    let titlePatch: ConversationRecord | null = null
    if (isFirstUserMessage) {
      titlePatch = await repoUpdateConversation(conversationId, {
        title: deriveTitle(content),
      })
    }

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

  // 不依赖 currentId——用户切走会话后流式继续往原 conv 写，切回来仍能看到。
  appendAssistantPlaceholder(conversationId) {
    const placeholder: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    }
    set((s) => ({
      ...withMessages(s, conversationId, [
        ...(s.messagesByConv[conversationId] ?? []),
        placeholder,
      ]),
    }))
    return placeholder
  },

  updateAssistantContent(conversationId, id, delta) {
    set((s) => {
      const existing = s.messagesByConv[conversationId]
      if (!existing) return s
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

  // 单事务写消息 + 顶 updatedAt——拆两次会出现"消息落盘但时间戳没更"的不一致。
  async persistAssistantMessage(conversationId, id) {
    const messages = get().messagesByConv[conversationId]
    if (!messages) return
    const message = messages.find((m) => m.id === id)
    if (!message) return
    await putMessageAndTouch(conversationId, message)
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

  // 先 IDB 后内存——IDB 失败时让 caller 看到错误，避免"内存没了但 hydrate 又冒出"。
  async removeMessage(conversationId, id) {
    await repoDeleteMessage(id)
    set((s) => ({
      ...withMessages(
        s,
        conversationId,
        (s.messagesByConv[conversationId] ?? []).filter((m) => m.id !== id),
      ),
    }))
  },

  async truncateFrom(conversationId, messageId) {
    const messages = get().messagesByConv[conversationId]
    if (!messages) return
    const idx = messages.findIndex((m) => m.id === messageId)
    if (idx < 0) return
    const toDelete = messages.slice(idx).map((m) => m.id)
    await repoDeleteMessages(toDelete)
    set((s) => ({
      ...withMessages(s, conversationId, messages.slice(0, idx)),
    }))
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

export const selectCurrentConversation = (s: Store) =>
  s.conversations.find((c) => c.id === s.currentId) ?? null

// 引用稳定的常量——selector 每次返回新数组会让 zustand === 比较失败、触发 infinite loop。
const EMPTY_MESSAGES: ChatMessage[] = []

export const selectCurrentMessages = (s: Store): ChatMessage[] => {
  if (!s.currentId) return EMPTY_MESSAGES
  return s.messagesByConv[s.currentId] ?? EMPTY_MESSAGES
}
