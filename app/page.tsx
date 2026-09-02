"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { ChatSidebar } from "@/components/chat-sidebar"
import { PixelGroundWithInput, type ActiveTableInfo } from "@/components/pixel-ground"
import { PixelAvatar } from "@/components/pixel-avatar"
import { Loader2, Menu, X, AlertCircle, Sparkles, Table as TableIcon } from "lucide-react"
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
import type { TableDatasetSummary } from "@/lib/agents/types"

const EMPTY_ASSISTANT_MESSAGE = "暂未生成有效回答，请稍后重试。"
const LOADING_MESSAGES = [
  "正在分析问题与意图...",
  "正在智能路由并检索知识/表格...",
  "正在执行计算与工程推理...",
  "正在整理并生成回答...",
]

const QUICK_PROMPT_PRESETS = [
  { label: "表格统计", text: "按施工日期统计每天完成的桩数。", type: "table" },
  { label: "极值查询", text: "找出总锤击数最高的前 10 根桩。", type: "table" },
  { label: "方法对比", text: "桩基声波透射法和低应变法有什么区别？", type: "doc" },
  { label: "工程建议", text: "泥沙或沉渣对桩基检测有哪些影响？", type: "doc" },
]

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const [localMessages, setLocalMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isInitialized, setIsInitialized] = useState(false)
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0)

  // Table Asset States
  const [tableDatasets, setTableDatasets] = useState<TableDatasetSummary[]>([])
  const [activeTable, setActiveTable] = useState<ActiveTableInfo | null>(null)
  const [isUploadingTable, setIsUploadingTable] = useState(false)
  const [tableToast, setTableToast] = useState<string | null>(null)

  const inputBarRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const hiddenUploadInputRef = useRef<HTMLInputElement>(null)

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

  // Fetch Table Datasets
  const loadTableDatasets = useCallback(async () => {
    try {
      const res = await fetch("/api/tables/datasets")
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.datasets)) {
          setTableDatasets(data.datasets)
          // If active table was deleted, clear it
          if (activeTable && !data.datasets.some((d: TableDatasetSummary) => d.dataset_id === activeTable.dataset_id)) {
            setActiveTable(null)
          }
        }
      }
    } catch (err) {
      console.error("Load table datasets error:", err)
    }
  }, [activeTable])

  useEffect(() => {
    loadTableDatasets()
  }, [loadTableDatasets])

  useEffect(() => {
    if (!isLoading) {
      setLoadingMessageIndex(0)
      return
    }

    const timer = window.setInterval(() => {
      setLoadingMessageIndex((index) => (index + 1) % LOADING_MESSAGES.length)
    }, 2600)

    return () => window.clearInterval(timer)
  }, [isLoading])

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

  // Table Upload & Management Handlers
  const handleUploadTable = async (file: File) => {
    setIsUploadingTable(true)
    setTableToast("正在上传并入库表格数据...")
    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch("/api/tables/upload", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `上传失败: ${res.status}`)
      }

      const result = await res.json()
      const dataset = result.dataset
      await loadTableDatasets()

      if (dataset) {
        const totalRows = sumRows(dataset.sheets)
        setActiveTable({
          dataset_id: dataset.dataset_id,
          filename: dataset.original_filename || file.name,
          total_rows: totalRows,
        })
        setTableToast(`表格 "${file.name}" 上传成功，已关联为当前分析表`)
        setTimeout(() => setTableToast(null), 4000)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "表格上传异常"
      setTableToast(`上传失败: ${msg}`)
      setTimeout(() => setTableToast(null), 5000)
    } finally {
      setIsUploadingTable(false)
    }
  }

  const handleDeleteTable = async (datasetId: string) => {
    try {
      const res = await fetch(`/api/tables/datasets?id=${encodeURIComponent(datasetId)}`, {
        method: "DELETE",
      })
      if (res.ok) {
        if (activeTable?.dataset_id === datasetId) {
          setActiveTable(null)
        }
        await loadTableDatasets()
      }
    } catch (err) {
      console.error("Delete table dataset error:", err)
    }
  }

  const handleSelectTableAsset = (dataset: TableDatasetSummary) => {
    setActiveTable({
      dataset_id: dataset.dataset_id,
      filename: dataset.original_filename,
      total_rows: dataset.total_rows,
    })
    setTableToast(`已切换当前分析表格为: ${dataset.original_filename}`)
    setTimeout(() => setTableToast(null), 3000)
  }

  const sumRows = (sheets: Array<{ row_count?: number }> | undefined) => {
    if (!Array.isArray(sheets)) return 0
    return sheets.reduce((sum, s) => sum + (s.row_count || 0), 0)
  }

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
      reference: "",
    }
  }

  const safeMessageContent = (content: unknown, role: "user" | "assistant") => {
    if (typeof content === "string" && content.trim()) {
      return content
    }
    return role === "assistant" ? EMPTY_ASSISTANT_MESSAGE : ""
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
  const latestMessageHasAssistantText = (() => {
    for (let index = displayMessages.length - 1; index >= 0; index -= 1) {
      const message = displayMessages[index]
      if (message.role === "user") {
        return false
      }
      if (message.role === "assistant") {
        return Boolean(message.content?.trim())
      }
    }
    return false
  })()
  const showLoadingIndicator = isLoading && !latestMessageHasAssistantText

  if (!isInitialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <input
        ref={hiddenUploadInputRef}
        type="file"
        accept=".xlsx,.xlsm,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleUploadTable(file)
          if (hiddenUploadInputRef.current) hiddenUploadInputRef.current.value = ""
        }}
      />

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
          tableDatasets={tableDatasets}
          activeTableId={activeTable?.dataset_id}
          onSelectTable={handleSelectTableAsset}
          onDeleteTable={handleDeleteTable}
          onTriggerUpload={() => hiddenUploadInputRef.current?.click()}
        />
      </div>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-foreground/20 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="flex-1 flex flex-col h-screen overflow-hidden pixel-grid">
        {/* Table Notification Toast */}
        {tableToast ? (
          <div className="bg-primary text-primary-foreground px-4 py-2 text-xs text-center flex items-center justify-center gap-2 shadow-sm animate-in fade-in slide-in-from-top">
            <Sparkles size={14} />
            <span>{tableToast}</span>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="max-w-4xl mx-auto space-y-5">
            {displayMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[420px]">
                <div className="text-center px-4 max-w-2xl">
                  <div className="mx-auto mb-5 flex w-full max-w-[560px] items-center justify-center gap-8">
                    <img
                      src={BRANDING_ASSETS.fullBrandLogo}
                      alt="九工天匠完整品牌标识"
                      className="h-[200px] w-auto max-w-[420px] object-contain"
                    />
                    <img
                      src={BRANDING_ASSETS.welcomeBanner}
                      alt="九工天匠欢迎图"
                      className="h-[170px] w-auto max-w-[300px] object-contain self-center"
                    />
                  </div>
                  <p className="text-xl lg:text-[1.65rem] font-bold text-foreground leading-[1.2]">
                    {BRAND_WELCOME_MESSAGE}
                  </p>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                    支持桩基工程规范与检测理论问答，已接入工程施工表格数据分析智能体。
                  </p>

                  {/* Preset Questions */}
                  <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                    {QUICK_PROMPT_PRESETS.map((preset, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => setInput(preset.text)}
                        className="flex items-start gap-2 p-2.5 bg-white/80 hover:bg-white border border-border/60 hover:border-primary/40 rounded-xl text-xs transition-all shadow-xs group"
                      >
                        <span className="p-1 rounded bg-primary/10 text-primary flex-shrink-0 mt-0.5">
                          {preset.type === "table" ? <TableIcon size={12} /> : <Sparkles size={12} />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground group-hover:text-primary transition-colors">
                            {preset.text}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {preset.type === "table" ? "触发表格智能问答路由" : "触发工程知识库 RAG 检索"}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
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
                    className={`max-w-[80%] lg:max-w-[75%] p-3.5 lg:p-4 rounded-2xl ${
                      message.role === "user"
                        ? "bg-white text-foreground shadow-md border border-border/50"
                        : "bg-primary text-primary-foreground shadow-md"
                    }`}
                  >
                    {message.role === "assistant" ? (
                      (() => {
                        const { content, reference } = stripReferenceBlock(
                          safeMessageContent(message.content, "assistant"),
                        )
                        return (
                          <>
                            <p className="text-base leading-7 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                              {content}
                            </p>
                            {reference ? (
                              <div className="mt-3 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs text-blue-50">
                                {reference.split("\n").map((line, index) => (
                                  <p key={index} className="leading-relaxed break-words text-blue-50 [overflow-wrap:anywhere]">
                                    {line}
                                  </p>
                                ))}
                              </div>
                            ) : null}
                          </>
                        )
                      })()
                    ) : (
                      <p className="text-base leading-7 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                        {safeMessageContent(message.content, "user")}
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

            {showLoadingIndicator && (
              <div className="flex gap-3 lg:gap-4 justify-start">
                <div className="flex-shrink-0 self-start">
                  <PixelAvatar type="robot" size={44} />
                </div>
                <div className="bg-primary text-primary-foreground rounded-2xl shadow-md p-3 lg:p-4">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">{LOADING_MESSAGES[loadingMessageIndex]}</span>
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
          activeTable={activeTable}
          onRemoveActiveTable={() => setActiveTable(null)}
          onUploadTable={handleUploadTable}
          isUploadingTable={isUploadingTable}
        />
      </main>
    </div>
  )
}
