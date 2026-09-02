"use client"

import { useState } from "react"
import { Plus, MessageSquare, Trash2, Table, Check, Layers } from "lucide-react"
import type { Conversation } from "@/lib/conversation-store"
import { PixelAvatar } from "@/components/pixel-avatar"
import {
  BRAND_NAME,
  BRAND_SUBTITLE,
  BRANDING_ASSETS,
} from "@/lib/branding"
import type { TableDatasetSummary } from "@/lib/agents/types"

interface ChatSidebarProps {
  conversations: Conversation[]
  currentChatId: string | null
  onNewChat: () => void
  onSelectChat: (id: string) => void
  onDeleteChat: (id: string) => void
  tableDatasets?: TableDatasetSummary[]
  activeTableId?: string | null
  onSelectTable?: (dataset: TableDatasetSummary) => void
  onDeleteTable?: (datasetId: string) => void
  onTriggerUpload?: () => void
}

export function ChatSidebar({
  conversations,
  currentChatId,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  tableDatasets = [],
  activeTableId,
  onSelectTable,
  onDeleteTable,
  onTriggerUpload,
}: ChatSidebarProps) {
  const [activeTab, setActiveTab] = useState<"chats" | "tables">("chats")

  return (
    <aside className="w-64 h-screen bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border/50">
      <div className="p-4 border-b border-sidebar-border/50">
        <div className="flex items-center gap-3">
          <img
            src={BRANDING_ASSETS.logoMain}
            alt={`${BRAND_NAME} 标识`}
            className="w-10 h-10 rounded object-contain bg-white p-1"
          />
          <div>
            <h1 className="text-base font-bold text-sidebar-foreground leading-tight">
              {BRAND_NAME}
            </h1>
            <p className="text-xs text-sidebar-foreground/60 mt-0.5">
              {BRAND_SUBTITLE}
            </p>
          </div>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="p-3 pb-1">
        <div className="grid grid-cols-2 gap-1 p-1 bg-sidebar-accent/40 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab("chats")}
            className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-lg transition-all ${
              activeTab === "chats"
                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                : "text-sidebar-foreground/70 hover:text-sidebar-foreground"
            }`}
          >
            <MessageSquare size={13} />
            <span>对话记录</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("tables")}
            className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-lg transition-all ${
              activeTab === "tables"
                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                : "text-sidebar-foreground/70 hover:text-sidebar-foreground"
            }`}
          >
            <Table size={13} />
            <span>表格资产 ({tableDatasets.length})</span>
          </button>
        </div>
      </div>

      <div className="p-3 pt-2">
        {activeTab === "chats" ? (
          <button
            onClick={onNewChat}
            className="w-full flex items-center gap-2 px-3 py-2 bg-sidebar-accent/80 text-white hover:bg-sidebar-primary hover:text-white transition-all rounded-xl shadow-sm"
          >
            <Plus size={16} />
            <span className="text-sm font-medium">新建对话</span>
          </button>
        ) : (
          <button
            onClick={onTriggerUpload}
            className="w-full flex items-center gap-2 px-3 py-2 bg-sidebar-accent/80 text-white hover:bg-sidebar-primary hover:text-white transition-all rounded-xl shadow-sm"
          >
            <Plus size={16} />
            <span className="text-sm font-medium">上传工程表格</span>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === "chats" ? (
          <>
            <p className="px-2 py-1 text-xs font-medium text-sidebar-foreground/50 tracking-wide">
              历史记录
            </p>
            <nav className="mt-1 space-y-0.5">
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
                      onClick={(event) => {
                        event.stopPropagation()
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
          </>
        ) : (
          <>
            <p className="px-2 py-1 text-xs font-medium text-sidebar-foreground/50 tracking-wide">
              已注册表格 ({tableDatasets.length})
            </p>
            <nav className="mt-1 space-y-1">
              {tableDatasets.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-sidebar-foreground/40 leading-relaxed">
                  暂无表格资产
                  <br />
                  点击上方按钮上传 Excel/CSV
                </div>
              ) : (
                tableDatasets.map((table) => {
                  const isSelected = activeTableId === table.dataset_id
                  return (
                    <div
                      key={table.dataset_id}
                      onClick={() => onSelectTable?.(table)}
                      className={`group flex items-start gap-2 px-2.5 py-2 text-left transition-all rounded-xl cursor-pointer border ${
                        isSelected
                          ? "bg-sidebar-primary/20 border-sidebar-primary text-sidebar-foreground"
                          : "hover:bg-sidebar-accent/60 border-transparent text-sidebar-foreground/80"
                      }`}
                    >
                      <div className="p-1 rounded bg-primary/10 text-primary mt-0.5 flex-shrink-0">
                        {isSelected ? <Check size={12} /> : <Table size={12} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate leading-tight">
                          {table.original_filename}
                        </p>
                        <div className="flex items-center gap-1.5 text-[10px] text-sidebar-foreground/50 mt-1">
                          <span className="flex items-center gap-0.5">
                            <Layers size={10} />
                            {table.sheet_count} sheet
                          </span>
                          <span>·</span>
                          <span>{table.total_rows} 行</span>
                        </div>
                      </div>
                      {onDeleteTable ? (
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            onDeleteTable(table.dataset_id)
                          }}
                          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-sidebar-accent text-sidebar-foreground/60 hover:text-destructive"
                          title="删除表格资产"
                        >
                          <Trash2 size={12} />
                        </button>
                      ) : null}
                    </div>
                  )
                })
              )}
            </nav>
          </>
        )}
      </div>

      <div className="p-3 border-t border-sidebar-border/50">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-10 h-10 flex items-center justify-center">
            <PixelAvatar type="robot" size={40} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">工程专家助手</p>
            <p className="text-[10px] text-sidebar-foreground/60">
              {tableDatasets.length > 0 ? `已挂载 ${tableDatasets.length} 个表格分析库` : "知识库 & 表格智能体在线"}
            </p>
          </div>
        </div>
      </div>
    </aside>
  )
}
