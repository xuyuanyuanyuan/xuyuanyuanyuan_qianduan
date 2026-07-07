import { type UIMessage } from "ai"
import { runAgentOrchestrator } from "@/lib/agents/answer-orchestrator"
import { formatFinalAnswer } from "@/lib/agents/format-final-answer"
import { createChatResponse } from "@/lib/llm-client"
import { createStaticChatResponse } from "@/lib/mock-chat"

const RAG_API_URL = process.env.RAG_API_URL ?? "http://localhost:3001"
const RAG_TOP_K = Number(process.env.RAG_TOP_K ?? 3)
const ENABLE_VERBOSE_RAG_LOGS = process.env.ENABLE_VERBOSE_RAG_LOGS === "true"
const ANSWER_MODE = process.env.ANSWER_MODE ?? "rag"

type RagSearchResult = {
  content: string
  source: string
  page: number
  score?: number
}

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
  retrieverResults: RagSearchResult[] | null,
  ragError: string | null,
) {
  const basePrompt = `你是”九工天匠”桩基建造智能助手。请优先使用知识库内容回答用户问题；知识库没有直接依据时，仍应基于通用工程知识给出谨慎回答，并明确区分知识库依据与通用知识补充。不要伪造知识库引用、规范条文、页码或具体参数。请只输出纯文本，不要使用 Markdown 语法（不要输出 **加粗**、# 标题、代码块或表格)，需要分点时使用中文编号或换行。`

  if (ragError) {
    return `${basePrompt}\n知识库检索暂不可用：${ragError}\n请继续基于通用工程知识回答用户问题，并说明“知识库检索暂不可用，以下为通用工程知识补充，关键结论需结合现行规范、设计文件、检测报告和现场资料核验”。`
  }

  if (!retrieverResults || retrieverResults.length === 0) {
    return `${basePrompt}\n当前没有检索到有效的知识库内容。请明确说明“知识库未检索到该问题的直接依据”，然后继续用通用工程知识回答用户问题。不要说“因此无法回答”；涉及具体规范条文、设计参数、检测结论或施工参数时，提醒用户结合现行规范、设计文件、检测报告和现场资料核验。`
  }

  const fragments = retrieverResults
    .map(
      (item, index) =>
        `${index + 1}. 来源: ${item.source}, 页码: ${item.page}, 内容: ${item.content}`,
    )
    .join("\n")

  return `${basePrompt}\n下面是与用户问题相关的知识库片段：\n${fragments}\n\n请优先依据以上内容回答问题。若片段只提供相关锚点而不足以直接回答，应说明“知识库仅检索到相关资料锚点”，再结合通用工程知识补充说明。不要说“因此无法回答”，不要把通用知识伪装成知识库结论。`
}

async function fetchRagResults(query: string, topK: number) {
  if (ENABLE_VERBOSE_RAG_LOGS) {
    console.log("Calling RAG service at:", RAG_API_URL)
  }
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
  if (ENABLE_VERBOSE_RAG_LOGS) {
    console.log("RAG results count:", Array.isArray(data.results) ? data.results.length : 0)
  }
  return Array.isArray(data.results) ? (data.results as RagSearchResult[]) : []
}

// Matches /api/chat-agent: the agent branch below can legitimately take
// 30s+ (three sequential LLM calls), so 30s was cutting it off mid-flight.
export const maxDuration = 60

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

    if (ENABLE_VERBOSE_RAG_LOGS) {
      console.log("User question length:", lastUserQuery.length)
    }

    if (ANSWER_MODE === "agent") {
      try {
        const result = await runAgentOrchestrator({
          question: lastUserQuery,
          signal: req.signal,
        })
        return createStaticChatResponse(messages, formatFinalAnswer(result.final))
      } catch (error) {
        console.error(
          "Agent answer failed, falling back to legacy RAG chat:",
          error instanceof Error ? error.message : error,
        )
      }
    }

    let ragResults: RagSearchResult[] | null = null
    let ragError: string | null = null

    try {
      ragResults = await fetchRagResults(lastUserQuery, RAG_TOP_K)
    } catch (error) {
      console.error("RAG fetch error:", error)
      ragError =
        error instanceof Error ? error.message : "RAG 检索服务异常。"
    }

    const context =
      ragResults && ragResults.length > 0
        ? ragResults.map((result) => result.content).join("\n\n")
        : ""
    const systemPrompt = buildRagSystemPrompt(lastUserQuery, ragResults, ragError)
    if (ENABLE_VERBOSE_RAG_LOGS) {
      console.log("RAG context length:", context.length)
      console.log("System prompt length:", systemPrompt.length)
    }

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
