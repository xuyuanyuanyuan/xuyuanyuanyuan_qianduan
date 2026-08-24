"use client"

import { PixelCharacter } from "./pixel-character"
import { Send, Loader2, Plus, Mic, Table, X } from "lucide-react"
import { useRef } from "react"
import { CHAT_INPUT_PLACEHOLDER } from "@/lib/branding"

export interface ActiveTableInfo {
  dataset_id: string
  filename: string
  total_rows: number
}

interface PixelGroundWithInputProps {
  input: string
  setInput: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
  isLoading: boolean
  inputBarRef?: React.RefObject<HTMLDivElement | null>
  activeTable?: ActiveTableInfo | null
  onRemoveActiveTable?: () => void
  onUploadTable?: (file: File) => Promise<void>
  isUploadingTable?: boolean
}

export function PixelGroundWithInput({
  input,
  setInput,
  onSubmit,
  isLoading,
  inputBarRef,
  activeTable,
  onRemoveActiveTable,
  onUploadTable,
  isUploadingTable,
}: PixelGroundWithInputProps) {
  const localInputBarRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const effectiveRef = inputBarRef || localInputBarRef

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && onUploadTable) {
      onUploadTable(file)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  return (
    <div className="relative h-32 flex-shrink-0 overflow-visible">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xlsm,.xls,.csv"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="absolute inset-x-0 bottom-[56px] z-20 px-4">
        <form onSubmit={onSubmit} className="max-w-xl mx-auto flex flex-col gap-1.5">
          {/* Active Table Pill */}
          {activeTable ? (
            <div className="self-start flex items-center gap-1.5 bg-primary/10 border border-primary/25 text-primary text-xs px-2.5 py-1 rounded-full shadow-sm">
              <Table size={12} className="text-primary flex-shrink-0" />
              <span className="font-medium truncate max-w-[240px]">
                {activeTable.filename}
              </span>
              <span className="text-primary/70">({activeTable.total_rows} 行)</span>
              {onRemoveActiveTable ? (
                <button
                  type="button"
                  onClick={onRemoveActiveTable}
                  className="ml-0.5 hover:bg-primary/20 rounded-full p-0.5 transition-colors"
                  title="取消关联此表格"
                >
                  <X size={10} />
                </button>
              ) : null}
            </div>
          ) : isUploadingTable ? (
            <div className="self-start flex items-center gap-1.5 bg-muted border border-border text-muted-foreground text-xs px-2.5 py-1 rounded-full shadow-sm">
              <Loader2 size={12} className="animate-spin text-primary" />
              <span>正在上传并解析表格数据...</span>
            </div>
          ) : null}

          <div
            ref={effectiveRef}
            className="flex items-center gap-1.5 bg-white/95 backdrop-blur-sm rounded-full px-2 py-1 shadow-lg border border-border/40 hover:shadow-xl transition-shadow"
          >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingTable}
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all disabled:opacity-50"
              title="上传打桩记录表格 (.xlsx, .csv)"
            >
              {isUploadingTable ? (
                <Loader2 size={14} className="animate-spin text-primary" />
              ) : (
                <Plus size={16} />
              )}
            </button>

            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={activeTable ? "问一个关于该表格的数据问题（如统计每日完成桩数）..." : CHAT_INPUT_PLACEHOLDER}
              className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/60 text-sm py-1 px-1 focus:outline-none min-w-0"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  onSubmit(event)
                }
              }}
            />

            <button
              type="button"
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
              title="语音输入"
            >
              <Mic size={14} />
            </button>

            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              title="发送消息"
            >
              {isLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={12} />
              )}
            </button>
          </div>
        </form>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-6">
        <div
          className="absolute top-0 left-0 right-0 h-2"
          style={{
            backgroundColor: "var(--pixel-grass)",
            backgroundImage: `repeating-linear-gradient(
              90deg,
              var(--pixel-grass) 0px,
              var(--pixel-grass) 15px,
              oklch(0.55 0.16 140) 15px,
              oklch(0.55 0.16 140) 16px
            )`,
          }}
        />

        <div
          className="absolute top-2 left-0 right-0 h-4"
          style={{
            backgroundColor: "var(--pixel-dirt)",
            backgroundImage: `repeating-linear-gradient(
              90deg,
              var(--pixel-dirt) 0px,
              var(--pixel-dirt) 15px,
              oklch(0.45 0.08 60) 15px,
              oklch(0.45 0.08 60) 16px
            ),
            repeating-linear-gradient(
              0deg,
              var(--pixel-dirt) 0px,
              var(--pixel-dirt) 7px,
              oklch(0.45 0.08 60) 7px,
              oklch(0.45 0.08 60) 8px
            )`,
          }}
        />
      </div>

      <PixelCharacter inputBarRef={effectiveRef} />

      <div className="absolute bottom-6 left-[8%]">
        <PixelFlower />
      </div>
      <div className="absolute bottom-6 left-[92%]">
        <PixelFlower color="yellow" />
      </div>
    </div>
  )
}

export function PixelGround() {
  return (
    <div className="relative h-24 overflow-visible">
      <div className="absolute bottom-0 left-0 right-0 h-6">
        <div
          className="absolute top-0 left-0 right-0 h-2"
          style={{
            backgroundColor: "var(--pixel-grass)",
          }}
        />

        <div
          className="absolute top-2 left-0 right-0 h-4"
          style={{
            backgroundColor: "var(--pixel-dirt)",
          }}
        />
      </div>

      <div className="absolute inset-x-0 bottom-0 h-24">
        <PixelCharacter />
      </div>
    </div>
  )
}

function PixelFlower({ color = "red" }: { color?: "red" | "yellow" | "pink" }) {
  const colors = {
    red: "#ef4444",
    yellow: "#fbbf24",
    pink: "#f472b6",
  }

  return (
    <svg width="8" height="12" viewBox="0 0 3 4" style={{ imageRendering: "pixelated" }}>
      <rect x="1" y="0" width="1" height="1" fill={colors[color]} />
      <rect x="0" y="1" width="1" height="1" fill={colors[color]} />
      <rect x="2" y="1" width="1" height="1" fill={colors[color]} />
      <rect x="1" y="1" width="1" height="1" fill="#fde047" />
      <rect x="1" y="2" width="1" height="2" fill="#22c55e" />
    </svg>
  )
}
