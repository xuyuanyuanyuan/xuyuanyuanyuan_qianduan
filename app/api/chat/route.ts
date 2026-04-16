import { type UIMessage } from "ai"
import { createChatResponse } from "@/lib/llm-client"

export const maxDuration = 30

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

    return await createChatResponse(messages, req.signal)
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
