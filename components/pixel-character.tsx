"use client"

import { useState, useEffect, useRef, useCallback } from "react"

interface PixelCharacterProps {
  inputBarRef?: React.RefObject<HTMLDivElement | null>
}

export function PixelCharacter({ inputBarRef }: PixelCharacterProps) {
  const [isJumping, setIsJumping] = useState(false)
  const [jumpPhase, setJumpPhase] = useState<"none" | "up" | "down">("none")
  const [frame, setFrame] = useState(0)
  const [positionX, setPositionX] = useState(10)
  const [positionY, setPositionY] = useState(0)
  const [direction, setDirection] = useState<"right" | "left">("right")
  const [isOnInputBar, setIsOnInputBar] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputBarBoundsRef = useRef({ left: 12, right: 88 })

  // Ground level: character feet touch grass top
  const GROUND_LEVEL = 24
  
  // Input bar height - character stands on top of input bar
  const INPUT_BAR_TOP = 92

  // Update input bar bounds based on actual DOM element
  useEffect(() => {
    const updateBounds = () => {
      if (inputBarRef?.current && containerRef.current) {
        const container = containerRef.current.parentElement
        if (container) {
          const containerRect = container.getBoundingClientRect()
          const inputRect = inputBarRef.current.getBoundingClientRect()
          
          // Calculate percentage positions with padding for visual alignment
          const padding = 2 // percent padding from edges
          const leftPercent = ((inputRect.left - containerRect.left) / containerRect.width) * 100 + padding
          const rightPercent = ((inputRect.right - containerRect.left) / containerRect.width) * 100 - padding
          
          inputBarBoundsRef.current = {
            left: Math.max(5, leftPercent),
            right: Math.min(95, rightPercent),
          }
        }
      }
    }

    updateBounds()
    window.addEventListener("resize", updateBounds)
    
    // Update after a short delay to ensure DOM is ready
    const timeout = setTimeout(updateBounds, 100)
    
    return () => {
      window.removeEventListener("resize", updateBounds)
      clearTimeout(timeout)
    }
  }, [inputBarRef])

  // Walking animation frames
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isJumping) {
        setFrame((prev) => (prev + 1) % 4)
      }
    }, 150)
    return () => clearInterval(interval)
  }, [isJumping])

  // Jump animation with proper arc
  const performJump = useCallback((targetY: number, onComplete: () => void) => {
    setIsJumping(true)
    const startY = positionY
    const peakY = Math.max(startY, targetY) + 25
    const duration = 350
    const startTime = Date.now()
    
    const animateJump = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      
      let currentY: number
      if (progress < 0.5) {
        const riseProgress = progress * 2
        currentY = startY + (peakY - startY) * Math.sin(riseProgress * Math.PI / 2)
        setJumpPhase("up")
      } else {
        const fallProgress = (progress - 0.5) * 2
        currentY = peakY - (peakY - targetY) * Math.sin(fallProgress * Math.PI / 2)
        setJumpPhase("down")
      }
      
      setPositionY(currentY)
      
      if (progress < 1) {
        requestAnimationFrame(animateJump)
      } else {
        setPositionY(targetY)
        setIsJumping(false)
        setJumpPhase("none")
        onComplete()
      }
    }
    
    requestAnimationFrame(animateJump)
  }, [positionY])

  // Horizontal movement and input bar interaction
  useEffect(() => {
    const moveInterval = setInterval(() => {
      if (isJumping) return
      
      const bounds = inputBarBoundsRef.current
      
      setPositionX((prev) => {
        const speed = 0.4
        let newPos = direction === "right" ? prev + speed : prev - speed
        
        // Check if approaching input bar from ground level
        if (!isOnInputBar) {
          const enteringFromLeft = direction === "right" && prev < bounds.left && newPos >= bounds.left
          const enteringFromRight = direction === "left" && prev > bounds.right && newPos <= bounds.right
          
          if (enteringFromLeft || enteringFromRight) {
            performJump(INPUT_BAR_TOP - GROUND_LEVEL, () => {
              setIsOnInputBar(true)
            })
            return prev
          }
        }
        
        // Check if leaving input bar - walk to the edge first
        if (isOnInputBar) {
          const leavingFromRight = direction === "right" && newPos >= bounds.right
          const leavingFromLeft = direction === "left" && newPos <= bounds.left
          
          if (leavingFromRight || leavingFromLeft) {
            performJump(0, () => {
              setIsOnInputBar(false)
            })
            return prev
          }
        }
        
        // Turn around at screen edges
        if (newPos >= 96) {
          setDirection("left")
          newPos = 96
        } else if (newPos <= 4) {
          setDirection("right")
          newPos = 4
        }
        
        return newPos
      })
    }, 50)
    
    return () => clearInterval(moveInterval)
  }, [direction, isJumping, isOnInputBar, performJump])

  const handleMouseEnter = () => {
    if (!isJumping) {
      const currentY = positionY
      performJump(currentY, () => {})
    }
  }

  const visualBottom = GROUND_LEVEL + positionY

  return (
    <div
      ref={containerRef}
      className="cursor-pointer select-none absolute"
      onMouseEnter={handleMouseEnter}
      style={{
        left: `${positionX}%`,
        bottom: `${visualBottom}px`,
        transform: `translateX(-50%) scaleX(${direction === "left" ? -1 : 1})`,
        zIndex: 30,
      }}
    >
      <div
        style={{
          animation: !isJumping ? "walk 0.4s steps(4) infinite" : "none",
          transform: jumpPhase === "up" ? "rotate(-5deg)" : jumpPhase === "down" ? "rotate(5deg)" : "none",
        }}
      >
        <svg
          width="32"
          height="42"
          viewBox="0 0 10 13"
          style={{ imageRendering: "pixelated" }}
        >
          {/* Safety helmet */}
          <rect x="2" y="0" width="6" height="1" fill="#f59e0b" />
          <rect x="1" y="1" width="8" height="2" fill="#f59e0b" />
          <rect x="3" y="1" width="4" height="1" fill="#fbbf24" />
          
          {/* Head */}
          <rect x="2" y="3" width="6" height="3" fill="#fcd9b8" />
          
          {/* Eyes */}
          <rect x="3" y="4" width="1" height="1" fill="#1e293b" />
          <rect x="6" y="4" width="1" height="1" fill="#1e293b" />
          
          {/* Body - work clothes */}
          <rect x="2" y="6" width="6" height="4" fill="#3b82f6" />
          <rect x="4" y="6" width="2" height="1" fill="#60a5fa" />
          
          {/* Arms */}
          <rect x="1" y="6" width="1" height="3" fill="#fcd9b8" />
          <rect x="8" y="6" width="1" height="3" fill="#fcd9b8" />
          
          {/* Legs - animated */}
          <rect
            x={frame === 0 ? 2 : frame === 2 ? 4 : 3}
            y="10"
            width="2"
            height="2"
            fill="#1e40af"
          />
          <rect
            x={frame === 0 ? 6 : frame === 2 ? 4 : 5}
            y="10"
            width="2"
            height="2"
            fill="#1e40af"
          />
          
          {/* Shoes */}
          <rect
            x={frame === 0 ? 1 : frame === 2 ? 3 : 2}
            y="12"
            width="3"
            height="1"
            fill="#374151"
          />
          <rect
            x={frame === 0 ? 6 : frame === 2 ? 4 : 5}
            y="12"
            width="3"
            height="1"
            fill="#374151"
          />
        </svg>
      </div>
    </div>
  )
}
