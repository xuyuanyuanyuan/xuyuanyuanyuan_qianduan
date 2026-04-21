import { type UIMessage } from "ai"
import { createChatResponse } from "@/lib/llm-client"

const RAG_API_URL = process.env.RAG_API_URL ?? "http://localhost:8001"
const RAG_TOP_K = Number(process.env.RAG_TOP_K ?? 3)

function extractTextFromPart(part: unknown): string {
  if (typeof part === "string") {
    return part
  }

  if (!part || typeof part !== "object") {
    return ""
  }

  if ("text" in part && typeof (part as { text?: unknown }).text === "string") {
    return (part as { text: string }).text
  }

  if ("content" in part) {
    const content = (part as { content: unknown }).content
    if (typeof content === "string") {
      return content
    }
    if (Array.isArray(content)) {
      return content.map((item) => extractTextFromPart(item)).join("")
    }
  }

  return ""
}

function extractTextFromMessage(message: UIMessage): string | null {
  const anyMessage = message as unknown as { content?: unknown; parts?: unknown }

  if (anyMessage.parts && Array.isArray(anyMessage.parts)) {
    const text = anyMessage.parts
      .map((part) => extractTextFromPart(part))
      .join("")
      .trim()
    if (text) {
      return text
    }
  }

  if (anyMessage.content) {
    const text = extractTextFromPart(anyMessage.content)
    if (text) {
      return text
    }
  }

  return null
}

function getLastUserQuestion(messages: UIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role !== "user") {
      continue
    }

    const text = extractTextFromMessage(messages[i])
    if (text) {
      return text
    }
  }
  return null
}

function buildRagSystemPrompt(
  query: string,
  retrieverResults: Array<{ content: string; source: string; page: number }> | null,
  ragError: string | null,
) {
  const basePrompt = `你是“九工天匠”桩基建造智能助手。请严格使用以下知识库内容回答用户问题，不要编造工程事实。`

  if (ragError) {
    return `${basePrompt}\n知识库检索暂不可用：${ragError}\n请继续尝试回答用户的问题，并在回答中说明“知识库检索暂不可用”。`
  }

  if (!retrieverResults || retrieverResults.length === 0) {
    return `${basePrompt}\n当前没有检索到有效的知识库内容。请明确说“知识库中暂无充分依据”，并避免编造工程事实。`
  }

  const fragments = retrieverResults
    .map(
      (item, index) =>
        `${index + 1}. 来源: ${item.source}, 页码: ${item.page}, 内容: ${item.content}`,
    )
    .join("\n")

  return `${basePrompt}\n下面是与用户问题相关的知识库片段：\n${fragments}\n\n请优先依据以上内容回答问题。如果知识库没有足够信息，要明确说“知识库中暂无充分依据”。不要编造工程事实。`
}

async function fetchRagResults(query: string, topK: number) {
  console.log("Calling RAG service at:", RAG_API_URL)
  const url = `${RAG_API_URL.replace(/\/+$/, "")}/search`
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, top_k: topK }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`RAG 服务返回 ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  console.log("RAG response:", data)
  return Array.isArray(data.results) ? data.results : []
}

export const maxDuration = 30

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    let messages: UIMessage[] = []

    if (Array.isArray(body?.messages)) {
      messages = body.messages as UIMessage[]
    } else if (typeof body?.text === "string" && body.text.trim()) {
      messages = [
        {
          id: `user-${Date.now()}`,
          role: "user",
          parts: [{ type: "text", text: body.text.trim() }],
        } as unknown as UIMessage,
      ]
    } else if (typeof body?.input === "string" && body.input.trim()) {
      messages = [
        {
          id: `user-${Date.now()}`,
          role: "user",
          parts: [{ type: "text", text: body.input.trim() }],
        } as unknown as UIMessage,
      ]
    }

    if (messages.length === 0) {
      return Response.json(
        { error: "请求体缺少有效的 messages 数组。" },
        { status: 400 },
      )
    }

    const lastUserQuery = getLastUserQuestion(messages)
    if (!lastUserQuery) {
      return Response.json(
        { error: "未找到最后一条用户问题。" },
        { status: 400 },
      )
    }

    console.log("User question:", lastUserQuery)

    let ragResults = null
    let ragError: string | null = null

    try {
      ragResults = await fetchRagResults(lastUserQuery, RAG_TOP_K)
      console.log("RAG results count:", ragResults?.length || 0)
    } catch (error) {
      console.error("RAG fetch error:", error)
      ragError =
        error instanceof Error ? error.message : "RAG 检索服务异常。"
    }

    const context = ragResults && ragResults.length > 0 ? ragResults.map(r => r.content).join("\n\n") : ""
    console.log("RAG context preview:", context.substring(0, 100) + "...")
    const systemPrompt = buildRagSystemPrompt(lastUserQuery, ragResults, ragError)
    console.log("Final system prompt preview:", systemPrompt.substring(0, 200) + "...")

    return await createChatResponse(messages, req.signal, systemPrompt)
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
