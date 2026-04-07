"use client"

import { PixelCharacter } from "./pixel-character"
import { Send, Loader2, Plus, Mic } from "lucide-react"
import { useRef, useEffect } from "react"

interface PixelGroundWithInputProps {
  input: string
  setInput: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
  isLoading: boolean
  inputBarRef?: React.RefObject<HTMLDivElement | null>
}

export function PixelGroundWithInput({ 
  input, 
  setInput, 
  onSubmit, 
  isLoading,
  inputBarRef,
}: PixelGroundWithInputProps) {
  const localInputBarRef = useRef<HTMLDivElement>(null)
  const effectiveRef = inputBarRef || localInputBarRef
  
  return (
    <div className="relative h-32 flex-shrink-0 overflow-visible">
      {/* Floating Input Bar - positioned above ground, acts as platform */}
      <div className="absolute inset-x-0 bottom-[56px] z-20 px-4">
        <form onSubmit={onSubmit} className="max-w-xl mx-auto">
          <div 
            ref={effectiveRef}
            className="flex items-center gap-1.5 bg-white/95 backdrop-blur-sm rounded-full px-2 py-1 shadow-lg border border-border/40 hover:shadow-xl transition-shadow"
          >
            {/* 添加按钮 */}
            <button
              type="button"
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
              title="添加附件"
            >
              <Plus size={16} />
            </button>
            
            {/* 输入框 */}
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="请输入你的工程问题……"
              className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/60 text-sm py-1 px-1 focus:outline-none min-w-0"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  onSubmit(e)
                }
              }}
            />
            
            {/* 麦克风按钮 */}
            <button
              type="button"
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
              title="语音输入"
            >
              <Mic size={14} />
            </button>
            
            {/* 发送按钮 */}
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
      
      {/* Ground blocks */}
      <div className="absolute bottom-0 left-0 right-0 h-6">
        {/* Grass layer */}
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
            )`
          }}
        />
        
        {/* Dirt layer */}
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
            )`
          }}
        />
      </div>
      
      {/* Character walking area - no overlay, just character */}
      <PixelCharacter inputBarRef={effectiveRef} />
      
      {/* Decorative pixel elements */}
      <div className="absolute bottom-6 left-[8%]">
        <PixelFlower />
      </div>
      <div className="absolute bottom-6 left-[92%]">
        <PixelFlower color="yellow" />
      </div>
    </div>
  )
}

// Keep the old component for backwards compatibility
export function PixelGround() {
  return (
    <div className="relative h-24 overflow-visible">
      {/* Ground blocks */}
      <div className="absolute bottom-0 left-0 right-0 h-6">
        {/* Grass layer */}
        <div 
          className="absolute top-0 left-0 right-0 h-2"
          style={{
            backgroundColor: "var(--pixel-grass)",
          }}
        />
        
        {/* Dirt layer */}
        <div 
          className="absolute top-2 left-0 right-0 h-4"
          style={{
            backgroundColor: "var(--pixel-dirt)",
          }}
        />
      </div>
      
      {/* Character walking area */}
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
    pink: "#f472b6"
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
