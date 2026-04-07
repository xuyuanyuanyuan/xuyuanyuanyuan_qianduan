"use client"

import { Plus, MessageSquare, User, Trash2 } from "lucide-react"
import { PixelLogo } from "./pixel-avatar"
import type { Conversation } from "@/lib/conversation-store"

interface ChatSidebarProps {
  conversations: Conversation[]
  currentChatId: string | null
  onNewChat: () => void
  onSelectChat: (id: string) => void
  onDeleteChat: (id: string) => void
}

export function ChatSidebar({ 
  conversations,
  currentChatId,
  onNewChat, 
  onSelectChat, 
  onDeleteChat,
}: ChatSidebarProps) {
  return (
    <aside className="w-64 h-screen bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border/50">
      {/* Logo */}
      <div className="p-4 border-b border-sidebar-border/50">
        <div className="flex items-center gap-3">
          <PixelLogo size={40} />
          <div>
            <h1 className="text-base font-bold text-sidebar-foreground leading-tight">
              工程AI
            </h1>
            <p className="text-xs text-sidebar-foreground/60 mt-0.5">
              智能助手
            </p>
          </div>
        </div>
      </div>

      {/* New Chat Button */}
      <div className="p-3">
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2.5 bg-sidebar-accent/80 hover:bg-sidebar-primary hover:text-sidebar-primary-foreground transition-all rounded-xl"
        >
          <Plus size={16} />
          <span className="text-sm font-medium">新建对话</span>
        </button>
      </div>

      {/* Chat History */}
      <div className="flex-1 overflow-y-auto p-2">
        <p className="px-2 py-1 text-xs font-medium text-sidebar-foreground/50 tracking-wide">
          历史记录
        </p>
        <nav className="mt-2 space-y-0.5">
          {conversations.length === 0 ? (
            <p className="px-3 py-2 text-xs text-sidebar-foreground/40">
              暂无历史对话
            </p>
          ) : (
            conversations.map((chat) => (
              <div
                key={chat.id}
                className={`group flex items-center gap-2 px-3 py-2 text-left transition-all rounded-xl cursor-pointer ${
                  currentChatId === chat.id
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "hover:bg-sidebar-accent/60"
                }`}
                onClick={() => onSelectChat(chat.id)}
              >
                <MessageSquare size={14} className="flex-shrink-0" />
                <span className="text-sm truncate flex-1">{chat.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteChat(chat.id)
                  }}
                  className={`flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-opacity ${
                    currentChatId === chat.id
                      ? "hover:bg-sidebar-primary-foreground/20"
                      : "hover:bg-sidebar-accent"
                  }`}
                  title="删除对话"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </nav>
      </div>

      {/* User Info */}
      <div className="p-3 border-t border-sidebar-border/50">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-8 h-8 bg-sidebar-accent/80 flex items-center justify-center rounded-full">
            <User size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">工程师</p>
            <p className="text-[10px] text-sidebar-foreground/60">在线</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
