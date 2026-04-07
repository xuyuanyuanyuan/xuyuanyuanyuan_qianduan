"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { ChatSidebar } from "@/components/chat-sidebar"
import { PixelGroundWithInput } from "@/components/pixel-ground"
import { PixelAvatar } from "@/components/pixel-avatar"
import { Loader2, Menu, X, AlertCircle } from "lucide-react"
import {
  loadConversations,
  createConversation,
  updateConversation,
  deleteConversation,
  getConversation,
  saveCurrentChatId,
  getCurrentChatId,
  type Conversation,
  type Message,
} from "@/lib/conversation-store"
import { CHAT_API_URL } from "@/lib/api-config"

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const [localMessages, setLocalMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isInitialized, setIsInitialized] = useState(false)
  const inputBarRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Initialize useChat for API communication
  const { messages: aiMessages, sendMessage, status, setMessages: setAiMessages, error } = useChat({
    transport: new DefaultChatTransport({ api: CHAT_API_URL }),
  })

  const isLoading = status === "streaming" || status === "submitted"

  // Load conversations from localStorage on mount
  useEffect(() => {
    const stored = loadConversations()
    setConversations(stored)
    
    const currentId = getCurrentChatId()
    if (currentId) {
      const conversation = getConversation(currentId)
      if (conversation) {
        setCurrentChatId(currentId)
        setLocalMessages(conversation.messages)
      }
    }
    
    setIsInitialized(true)
  }, [])

  // Sync AI messages to local storage when streaming completes
  useEffect(() => {
    if (status === "ready" && aiMessages.length > 0 && currentChatId) {
      const conversation = getConversation(currentChatId)
      if (conversation) {
        // Convert AI messages to our format
        const newMessages: Message[] = aiMessages.map((m, i) => ({
          id: m.id || `msg-${i}`,
          role: m.role as "user" | "assistant",
          content: m.parts
            ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join("") || "",
          createdAt: Date.now(),
        }))
        
        // Update conversation in storage
        updateConversation(currentChatId, { messages: newMessages })
        setLocalMessages(newMessages)
        
        // Refresh conversations list
        setConversations(loadConversations())
      }
    }
  }, [status, aiMessages, currentChatId])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [localMessages, aiMessages, isLoading])

  // Handle new chat
  const handleNewChat = useCallback(() => {
    const newConversation = createConversation()
    setConversations(loadConversations())
    setCurrentChatId(newConversation.id)
    setLocalMessages([])
    setAiMessages([])
    setInput("")
  }, [setAiMessages])

  // Handle select chat
  const handleSelectChat = useCallback((id: string) => {
    const conversation = getConversation(id)
    if (conversation) {
      setCurrentChatId(id)
      saveCurrentChatId(id)
      setLocalMessages(conversation.messages)
      
      // Convert stored messages to AI SDK format for continuity
      const aiFormat = conversation.messages.map((m) => ({
        id: m.id,
        role: m.role,
        parts: [{ type: "text" as const, text: m.content }],
      }))
      setAiMessages(aiFormat)
    }
  }, [setAiMessages])

  // Handle delete chat
  const handleDeleteChat = useCallback((id: string) => {
    deleteConversation(id)
    setConversations(loadConversations())
    
    if (currentChatId === id) {
      const remaining = loadConversations()
      if (remaining.length > 0) {
        handleSelectChat(remaining[0].id)
      } else {
        setCurrentChatId(null)
        setLocalMessages([])
        setAiMessages([])
      }
    }
  }, [currentChatId, handleSelectChat, setAiMessages])

  // Handle submit message
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    
    // Create conversation if none exists
    let chatId = currentChatId
    if (!chatId) {
      const newConversation = createConversation()
      chatId = newConversation.id
      setCurrentChatId(chatId)
      setConversations(loadConversations())
    }

    // Add user message to local state immediately
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: input.trim(),
      createdAt: Date.now(),
    }
    
    setLocalMessages((prev) => [...prev, userMessage])
    
    // Save to storage
    const conversation = getConversation(chatId)
    if (conversation) {
      updateConversation(chatId, {
        messages: [...conversation.messages, userMessage],
      })
      setConversations(loadConversations())
    }
    
    // Send to AI
    sendMessage({ text: input.trim() })
    setInput("")
  }, [input, isLoading, currentChatId, sendMessage])

  // Get display messages - prioritize streaming AI messages, fallback to local
  const getDisplayMessages = () => {
    if (aiMessages.length > 0) {
      return aiMessages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.parts
          ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("") || "",
      }))
    }
    return localMessages
  }

  const displayMessages = getDisplayMessages()

  // Don't render until initialized to prevent hydration mismatch
  if (!isInitialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile sidebar toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-4 left-4 z-50 p-2 bg-sidebar text-sidebar-foreground rounded-lg lg:hidden"
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Sidebar */}
      <div
        className={`fixed lg:relative z-40 transition-transform duration-300 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <ChatSidebar
          conversations={conversations}
          currentChatId={currentChatId}
          onNewChat={handleNewChat}
          onSelectChat={handleSelectChat}
          onDeleteChat={handleDeleteChat}
        />
      </div>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-foreground/20 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden pixel-grid">
        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="max-w-4xl mx-auto space-y-5">
            {displayMessages.length === 0 ? (
              <div className="flex items-center justify-center min-h-[350px]">
                <div className="text-center px-4">
                  <div className="w-20 h-20 lg:w-24 lg:h-24 mx-auto mb-4">
                    <PixelAvatar type="robot" size={96} />
                  </div>
                  <h3 className="text-lg lg:text-xl font-bold text-foreground mb-3">
                    欢迎使用工程AI助手
                  </h3>
                  <p className="text-base text-muted-foreground max-w-md mx-auto leading-relaxed">
                    你好，我是工程智能助手。请描述你的问题，我会为你提供结构化分析与建议。
                  </p>
                </div>
              </div>
            ) : (
              displayMessages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-3 lg:gap-4 ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {/* AI avatar on left */}
                  {message.role === "assistant" && (
                    <div className="flex-shrink-0 self-start">
                      <PixelAvatar type="robot" size={44} />
                    </div>
                  )}
                  
                  {/* Message bubble */}
                  <div
                    className={`max-w-[75%] lg:max-w-[70%] p-3 lg:p-4 rounded-2xl ${
                      message.role === "user"
                        ? "bg-white text-foreground shadow-md border border-border/50"
                        : "bg-primary text-primary-foreground shadow-md"
                    }`}
                  >
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      {message.content}
                    </p>
                  </div>
                  
                  {/* User avatar on right */}
                  {message.role === "user" && (
                    <div className="flex-shrink-0 self-start">
                      <PixelAvatar type="user" size={44} />
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Loading indicator */}
            {isLoading && (
              <div className="flex gap-3 lg:gap-4 justify-start">
                <div className="flex-shrink-0 self-start">
                  <PixelAvatar type="robot" size={44} />
                </div>
                <div className="bg-primary text-primary-foreground rounded-2xl shadow-md p-3 lg:p-4">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">正在思考中...</span>
                  </div>
                </div>
              </div>
            )}

            {/* Error indicator */}
            {error && (
              <div className="flex gap-3 lg:gap-4 justify-start">
                <div className="flex-shrink-0 self-start">
                  <PixelAvatar type="robot" size={44} />
                </div>
                <div className="bg-destructive/10 text-destructive rounded-2xl shadow-md p-3 lg:p-4 border border-destructive/20">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm">
                      {error.message || "请求失败，请稍后重试"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Pixel Ground with integrated Input Bar */}
        <PixelGroundWithInput
          input={input}
          setInput={setInput}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          inputBarRef={inputBarRef}
        />
      </main>
    </div>
  )
}
