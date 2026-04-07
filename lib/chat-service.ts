/**
 * Chat Service - Handles API communication
 * 
 * This service uses the configuration from api-config.ts
 * It supports both real API calls and mock mode for testing
 */

import {
  MOCK_MODE,
  CHAT_API_URL,
  REQUEST_TIMEOUT,
  getMockResponse,
} from "./api-config"

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

export interface ChatResponse {
  success: boolean
  message?: string
  error?: string
}

/**
 * Send a chat message and get a response
 * 
 * If MOCK_MODE is enabled, returns a mock response
 * Otherwise, calls the real API
 */
export async function sendChatMessage(
  messages: ChatMessage[],
  onStream?: (chunk: string) => void
): Promise<ChatResponse> {
  // Mock mode - return fake response after a delay
  if (MOCK_MODE) {
    return new Promise((resolve) => {
      const lastUserMessage = messages.filter(m => m.role === "user").pop()
      const mockResponse = getMockResponse(lastUserMessage?.content || "")
      
      // Simulate streaming with delay
      if (onStream) {
        const words = mockResponse.split("")
        let index = 0
        const streamInterval = setInterval(() => {
          if (index < words.length) {
            onStream(words[index])
            index++
          } else {
            clearInterval(streamInterval)
            resolve({ success: true, message: mockResponse })
          }
        }, 20)
      } else {
        setTimeout(() => {
          resolve({ success: true, message: mockResponse })
        }, 1000)
      }
    })
  }

  // Real API call
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

    // Format messages for the AI SDK useChat transport
    const formattedMessages = messages.map((m, i) => ({
      id: `msg-${i}`,
      role: m.role,
      parts: [{ type: "text" as const, text: m.content }],
    }))

    const response = await fetch(CHAT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages: formattedMessages }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `API请求失败: ${response.status} - ${errorText}`,
      }
    }

    // Handle streaming response
    if (response.body && onStream) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let fullContent = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        
        // Parse SSE format
        const lines = chunk.split("\n")
        for (const line of lines) {
          if (line.startsWith("data:")) {
            const data = line.slice(5).trim()
            if (data === "[DONE]") continue
            
            try {
              const parsed = JSON.parse(data)
              if (parsed.type === "text-delta" && parsed.delta) {
                fullContent += parsed.delta
                onStream(parsed.delta)
              }
            } catch {
              // Not JSON, might be raw text
              if (data && data !== "[DONE]") {
                fullContent += data
                onStream(data)
              }
            }
          }
        }
      }

      return { success: true, message: fullContent }
    }

    // Non-streaming response
    const data = await response.json()
    return { success: true, message: data.message || data.content || "" }
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return { success: false, error: "请求超时，请稍后重试" }
      }
      return { success: false, error: `请求失败: ${error.message}` }
    }
    return { success: false, error: "未知错误" }
  }
}

/**
 * Check if the API is available
 */
export async function checkApiHealth(): Promise<boolean> {
  if (MOCK_MODE) return true

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(CHAT_API_URL, {
      method: "OPTIONS",
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    return response.ok || response.status === 405 // 405 = method not allowed, but endpoint exists
  } catch {
    return false
  }
}
