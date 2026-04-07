import {
  consumeStream,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import {
  SYSTEM_PROMPT,
  MODEL_NAME,
  MOCK_MODE,
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  getMockResponse,
} from "@/lib/api-config"

export const maxDuration = 30

function extractLastUserText(messages: UIMessage[]): string {
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")
  if (!lastUserMessage?.parts?.length) return ""

  return lastUserMessage.parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("")
}

function createMockStreamResponse(messages: UIMessage[]) {
  const mockText = getMockResponse(extractLastUserText(messages))
  const textPartId = `mock-text-${Date.now()}`

  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: ({ writer }) => {
      writer.write({ type: "start" })
      writer.write({ type: "text-start", id: textPartId })

      for (const char of mockText) {
        writer.write({ type: "text-delta", id: textPartId, delta: char })
      }

      writer.write({ type: "text-end", id: textPartId })
      writer.write({ type: "finish", finishReason: "stop" })
    },
    onError: () => "Mock 对话流生成失败。",
  })

  return createUIMessageStreamResponse({
    stream,
    consumeSseStream: consumeStream,
  })
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const messages = Array.isArray(body?.messages)
      ? (body.messages as UIMessage[])
      : []

    if (messages.length === 0) {
      return Response.json(
        { error: "请求体缺少有效的 messages 数组。" },
        { status: 400 },
      )
    }

    if (MOCK_MODE) {
      return createMockStreamResponse(messages)
    }

    if (!OPENAI_API_KEY) {
      return Response.json(
        {
          error:
            "OPENAI_API_KEY 未配置。请设置环境变量，或将 MOCK_MODE 设为 true。",
        },
        { status: 500 },
      )
    }

    const openai = createOpenAI({
      apiKey: OPENAI_API_KEY,
      ...(OPENAI_BASE_URL ? { baseURL: OPENAI_BASE_URL } : {}),
    })

    const result = streamText({
      model: openai(MODEL_NAME),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      abortSignal: req.signal,
    })

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      consumeSseStream: consumeStream,
      onError: (error) => {
        console.error("Chat stream error:", error)
        return "模型响应失败，请稍后重试。"
      },
    })
  } catch (error) {
    console.error("Chat route error:", error)
    return Response.json(
      {
        error:
          error instanceof Error
            ? `聊天接口异常：${error.message}`
            : "聊天接口异常，请稍后重试。",
      },
      { status: 500 },
    )
  }
}
