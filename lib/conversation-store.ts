/**
 * Conversation State Management with localStorage Persistence
 */

import { DEFAULT_CHAT_TITLE } from "@/lib/branding"

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: number
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = "engineering-ai-conversations"
const CURRENT_CHAT_KEY = "engineering-ai-current-chat"

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Generate a title from the first user message
 */
export function generateTitle(firstMessage: string): string {
  // Take first 20 characters or until first newline
  const title = firstMessage.split("\n")[0].slice(0, 20)
  return title.length < firstMessage.length ? `${title}...` : title
}

/**
 * Load all conversations from localStorage
 */
export function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return []
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return []
    
    const conversations = JSON.parse(stored) as Conversation[]
    // Sort by updatedAt descending (most recent first)
    return conversations.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch (error) {
    console.error("Failed to load conversations:", error)
    return []
  }
}

/**
 * Save all conversations to localStorage
 */
export function saveConversations(conversations: Conversation[]): void {
  if (typeof window === "undefined") return
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
  } catch (error) {
    console.error("Failed to save conversations:", error)
  }
}

/**
 * Get a single conversation by ID
 */
export function getConversation(id: string): Conversation | null {
  const conversations = loadConversations()
  return conversations.find(c => c.id === id) || null
}

/**
 * Create a new conversation
 */
export function createConversation(): Conversation {
  const now = Date.now()
  const conversation: Conversation = {
    id: generateId(),
    title: DEFAULT_CHAT_TITLE,
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
  
  const conversations = loadConversations()
  conversations.unshift(conversation)
  saveConversations(conversations)
  saveCurrentChatId(conversation.id)
  
  return conversation
}

/**
 * Update a conversation
 */
export function updateConversation(
  id: string, 
  updates: Partial<Pick<Conversation, "title" | "messages">>
): Conversation | null {
  const conversations = loadConversations()
  const index = conversations.findIndex(c => c.id === id)
  
  if (index === -1) return null
  
  const conversation = conversations[index]
  const updated: Conversation = {
    ...conversation,
    ...updates,
    updatedAt: Date.now(),
  }
  
  // Auto-generate title from first user message if title is default
  if (updated.title === DEFAULT_CHAT_TITLE && updated.messages.length > 0) {
    const firstUserMessage = updated.messages.find(m => m.role === "user")
    if (firstUserMessage) {
      updated.title = generateTitle(firstUserMessage.content)
    }
  }
  
  conversations[index] = updated
  saveConversations(conversations)
  
  return updated
}

/**
 * Delete a conversation
 */
export function deleteConversation(id: string): void {
  const conversations = loadConversations()
  const filtered = conversations.filter(c => c.id !== id)
  saveConversations(filtered)
  
  // If deleted conversation was current, clear current chat
  if (getCurrentChatId() === id) {
    saveCurrentChatId(null)
  }
}

/**
 * Add a message to a conversation
 */
export function addMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string
): Message | null {
  const conversation = getConversation(conversationId)
  if (!conversation) return null
  
  const message: Message = {
    id: generateId(),
    role,
    content,
    createdAt: Date.now(),
  }
  
  updateConversation(conversationId, {
    messages: [...conversation.messages, message],
  })
  
  return message
}

/**
 * Update the last assistant message (for streaming)
 */
export function updateLastAssistantMessage(
  conversationId: string,
  content: string
): void {
  const conversation = getConversation(conversationId)
  if (!conversation) return
  
  const messages = [...conversation.messages]
  const lastIndex = messages.length - 1
  
  if (lastIndex >= 0 && messages[lastIndex].role === "assistant") {
    messages[lastIndex] = {
      ...messages[lastIndex],
      content,
    }
    updateConversation(conversationId, { messages })
  }
}

/**
 * Save current chat ID
 */
export function saveCurrentChatId(id: string | null): void {
  if (typeof window === "undefined") return
  
  if (id) {
    localStorage.setItem(CURRENT_CHAT_KEY, id)
  } else {
    localStorage.removeItem(CURRENT_CHAT_KEY)
  }
}

/**
 * Get current chat ID
 */
export function getCurrentChatId(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(CURRENT_CHAT_KEY)
}

/**
 * Get or create current conversation
 */
export function getOrCreateCurrentConversation(): Conversation {
  const currentId = getCurrentChatId()
  
  if (currentId) {
    const conversation = getConversation(currentId)
    if (conversation) return conversation
  }
  
  // No current conversation, create one
  return createConversation()
}

/**
 * Clear all conversations (for testing/reset)
 */
export function clearAllConversations(): void {
  if (typeof window === "undefined") return
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(CURRENT_CHAT_KEY)
}
