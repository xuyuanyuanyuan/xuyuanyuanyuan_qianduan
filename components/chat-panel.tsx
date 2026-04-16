"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Loader2 } from "lucide-react"
import { PixelAvatar } from "./pixel-avatar"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
}

interface ChatPanelProps {
  messages: Message[]
  onSendMessage: (content: string) => void
  isLoading: boolean
}

export function ChatPanel({ messages, onSendMessage, isLoading }: ChatPanelProps) {
  const [input, setInput] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (input.trim() && !isLoading) {
      onSendMessage(input.trim())
      setInput("")
    }
  }

  return (
    <div className="flex-1 flex flex-col h-screen bg-background pixel-grid">
      {/* Header */}
      <header className="p-4 border-b-4 border-border bg-card">
        <h2 className="font-[family-name:var(--font-pixel)] text-sm text-foreground">
          工程智能对话
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          与AI助手进行工程问题交流
        </p>
      </header>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full min-h-[400px]">
              <div className="text-center">
                <div className="w-24 h-24 mx-auto mb-4">
                  <img
                    src="/cssc-logo.svg"
                    alt="CSSC 标志"
                    className="w-full h-full object-cover rounded-full"
                  />
                </div>
                <h3 className="font-[family-name:var(--font-pixel)] text-sm text-foreground mb-2">
                  欢迎使用cssc中船九院智能工程助手
                </h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  我可以帮助您解答桩基检测、裂缝分析、施工方案等各类工程问题
                </p>
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex items-start gap-3 ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {/* AI头像在左侧 */}
                {message.role === "assistant" && (
                  <div className="flex-shrink-0">
                    <img
                      src="/cssc-logo.svg"
                      alt="CSSC 标志"
                      className="w-12 h-12 rounded-full"
                    />
                  </div>
                )}
                
                {/* 消息气泡 */}
                <div
                  className={`max-w-[70%] p-4 rounded-lg shadow-md ${
                    message.role === "user"
                      ? "bg-card text-card-foreground border-2 border-border"
                      : "bg-primary text-primary-foreground"
                  }`}
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {message.content}
                  </p>
                </div>
                
                {/* 用户头像在右侧 */}
                {message.role === "user" && (
                  <div className="flex-shrink-0">
                    <PixelAvatar type="user" size={48} />
                  </div>
                )}
              </div>
            ))
          )}
          
          {isLoading && (
            <div className="flex items-start gap-3 justify-start">
              <div className="flex-shrink-0">
                <img
                  src="/cssc-logo.svg"
                  alt="CSSC 标志"
                  className="w-12 h-12 rounded-full"
                />
              </div>
              <div className="bg-primary text-primary-foreground p-4 rounded-lg shadow-md">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">正在思考中...</span>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="p-4 border-t-4 border-border bg-card">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="请输入你的工程问题……"
                className="w-full px-4 py-3 bg-input border-4 border-border text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary transition-colors rounded-lg"
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    handleSubmit(e)
                  }
                }}
              />
            </div>
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="px-6 py-3 bg-primary text-primary-foreground border-4 border-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 rounded-lg"
            >
              <Send size={18} />
              <span className="font-[family-name:var(--font-pixel)] text-[10px] hidden sm:inline">
                发送
              </span>
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 text-center">
            按 Enter 发送，Shift + Enter 换行
          </p>
        </form>
      </div>
    </div>
  )
}
