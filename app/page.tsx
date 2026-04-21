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
import { CHAT_API_ROUTE } from "@/lib/llm-config"
import {
  BRAND_WELCOME_MESSAGE,
  BRANDING_ASSETS,
} from "@/lib/branding"

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const [localMessages, setLocalMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isInitialized, setIsInitialized] = useState(false)
  const inputBarRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const {
    messages: aiMessages,
    sendMessage,
    status,
    setMessages: setAiMessages,
    error,
  } = useChat({
    transport: new DefaultChatTransport({ api: CHAT_API_ROUTE }),
  })

  const isLoading = status === "streaming" || status === "submitted"

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

  useEffect(() => {
    if (status === "ready" && aiMessages.length > 0 && currentChatId) {
      const conversation = getConversation(currentChatId)
      if (conversation) {
        const newMessages: Message[] = aiMessages.map((message, index) => ({
          id: message.id || `msg-${index}`,
          role: message.role as "user" | "assistant",
          content:
            message.parts
              ?.filter(
                (part): part is { type: "text"; text: string } =>
                  part.type === "text",
              )
              .map((part) => part.text)
              .join("") || "",
          createdAt: Date.now(),
        }))

        updateConversation(currentChatId, { messages: newMessages })
        setLocalMessages(newMessages)
        setConversations(loadConversations())
      }
    }
  }, [status, aiMessages, currentChatId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [localMessages, aiMessages, isLoading])

  const handleNewChat = useCallback(() => {
    const newConversation = createConversation()
    setConversations(loadConversations())
    setCurrentChatId(newConversation.id)
    setLocalMessages([])
    setAiMessages([])
    setInput("")
  }, [setAiMessages])

  const handleSelectChat = useCallback((id: string) => {
    const conversation = getConversation(id)
    if (conversation) {
      setCurrentChatId(id)
      saveCurrentChatId(id)
      setLocalMessages(conversation.messages)

      const aiFormat = conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        parts: [{ type: "text" as const, text: message.content }],
      }))
      setAiMessages(aiFormat)
    }
  }, [setAiMessages])

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

  const handleSubmit = useCallback((event: React.FormEvent) => {
    event.preventDefault()
    if (!input.trim() || isLoading) return

    let chatId = currentChatId
    if (!chatId) {
      const newConversation = createConversation()
      chatId = newConversation.id
      setCurrentChatId(chatId)
      setConversations(loadConversations())
    }

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: input.trim(),
      createdAt: Date.now(),
    }

    setLocalMessages((prev) => [...prev, userMessage])

    const conversation = getConversation(chatId)
    if (conversation) {
      updateConversation(chatId, {
        messages: [...conversation.messages, userMessage],
      })
      setConversations(loadConversations())
    }

    sendMessage({ text: input.trim() })
    setInput("")
  }, [input, isLoading, currentChatId, sendMessage])

  const stripReferenceBlock = (content: string) => {
    const marker = "参考来源："
    const start = content.indexOf(marker)
    if (start === -1) {
      return { content, reference: "" }
    }

    return {
      content: content.slice(0, start).trim(),
      reference: content.slice(start).trim(),
    }
  }

  const getDisplayMessages = () => {
    if (aiMessages.length > 0) {
      return aiMessages.map((message) => ({
        id: message.id,
        role: message.role as "user" | "assistant",
        content:
          message.parts
            ?.filter(
              (part): part is { type: "text"; text: string } =>
                part.type === "text",
            )
            .map((part) => part.text)
            .join("") || "",
      }))
    }
    return localMessages
  }

  const displayMessages = getDisplayMessages()

  if (!isInitialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-4 left-4 z-50 p-2 bg-sidebar text-sidebar-foreground rounded-lg lg:hidden"
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

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

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-foreground/20 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="flex-1 flex flex-col h-screen overflow-hidden pixel-grid">
        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="max-w-4xl mx-auto space-y-5">
            {displayMessages.length === 0 ? (
              <div className="flex items-center justify-center min-h-[350px]">
                <div className="text-center px-4">
                  <div className="mx-auto mb-5 flex w-full max-w-[560px] items-center justify-center gap-8">
                    <img
                      src={BRANDING_ASSETS.fullBrandLogo}
                      alt="九工天匠完整品牌标识"
                      className="h-[220px] w-auto max-w-[440px] object-contain"
                    />
                    <img
                      src={BRANDING_ASSETS.welcomeBanner}
                      alt="九工天匠欢迎图"
                      className="h-[190px] w-auto max-w-[320px] object-contain self-center"
                    />
                  </div>
                  <p className="text-xl lg:text-[1.75rem] font-bold text-foreground leading-[1.1] whitespace-nowrap">
                    {BRAND_WELCOME_MESSAGE}
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
                  {message.role === "assistant" && (
                    <div className="flex-shrink-0 self-start">
                      <PixelAvatar type="robot" size={44} />
                    </div>
                  )}

                  <div
                    className={`max-w-[75%] lg:max-w-[70%] p-3 lg:p-4 rounded-2xl ${
                      message.role === "user"
                        ? "bg-white text-foreground shadow-md border border-border/50"
                        : "bg-primary text-primary-foreground shadow-md"
                    }`}
                  >
                    {message.role === "assistant" ? (
                      (() => {
                        const { content, reference } = stripReferenceBlock(
                          message.content,
                        )
                        return (
                          <>
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">
                              {content}
                            </p>
                            {reference ? (
                              <div className="mt-3 rounded-2xl bg-white/10 px-3 py-2 text-xs text-muted-foreground">
                                {reference.split("\n").map((line, index) => (
                                  <p key={index} className="leading-relaxed">
                                    {line}
                                  </p>
                                ))}
                              </div>
                            ) : null}
                          </>
                        )
                      })()
                    ) : (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {message.content}
                      </p>
                    )}
                  </div>

                  {message.role === "user" && (
                    <div className="flex-shrink-0 self-start">
                      <PixelAvatar type="user" size={44} />
                    </div>
                  )}
                </div>
              ))
            )}

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
