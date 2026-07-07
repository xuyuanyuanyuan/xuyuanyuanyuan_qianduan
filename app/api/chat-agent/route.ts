import { type UIMessage } from "ai"

import { runAgentOrchestrator } from "@/lib/agents/answer-orchestrator"
import { formatFinalAnswerPlainText } from "@/lib/agents/format-final-answer"

export const maxDuration = 60

const AGENT_VERBOSE_LOGS = process.env.AGENT_VERBOSE_LOGS === "true"
const EMPTY_ANSWER_TEXT = "暂未生成有效回答，请稍后重试。"
const SERVICE_BUSY_TEXT = "抱歉，智能问答服务暂时不可用，请稍后再试。"
const CONTINUE_WITHOUT_CONTEXT_TEXT =
  "当前暂未保存上一轮完整上下文，请重新输入要展开的问题，或把需要继续分析的主题补充完整。"

type QuestionContext = {
  question: string | null
  previousQuestion: string | null
}

function textResponse(content: string, status = 200) {
  const body = typeof content === "string" && content.trim() ? content.trim() : EMPTY_ANSWER_TEXT
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}

function isContinuationRequest(question: string) {
  return /^(继续|继续上一条|展开|详细展开|接着说|继续说|请继续)$/i.test(question.trim())
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

function getPreviousUserQuestion(messages: UIMessage[]): string | null {
  let seenLastUser = false

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role !== "user") {
      continue
    }

    const text = extractTextFromMessage(messages[i])
    if (!text) {
      continue
    }

    if (!seenLastUser) {
      seenLastUser = true
      continue
    }

    return text
  }

  return null
}

async function readQuestionContext(req: Request): Promise<QuestionContext> {
  const body = await req.json().catch(() => null)

  if (Array.isArray(body?.messages)) {
    const messages = body.messages as UIMessage[]
    return {
      question: getLastUserQuestion(messages),
      previousQuestion: getPreviousUserQuestion(messages),
    }
  }

  if (typeof body?.text === "string" && body.text.trim()) {
    return {
      question: body.text.trim(),
      previousQuestion: null,
    }
  }

  if (typeof body?.input === "string" && body.input.trim()) {
    return {
      question: body.input.trim(),
      previousQuestion: null,
    }
  }

  return {
    question: null,
    previousQuestion: null,
  }
}

export async function POST(req: Request) {
  try {
    const { question, previousQuestion } = await readQuestionContext(req)

    if (!question) {
      return textResponse("请输入有效问题后再试。")
    }

    if (isContinuationRequest(question)) {
      if (!previousQuestion) {
        return textResponse(CONTINUE_WITHOUT_CONTEXT_TEXT)
      }

      const continuationQuestion = [
        "请继续展开上一轮问题，补充更多细节，并保持纯文本格式。",
        `上一轮问题：${previousQuestion}`,
      ].join("\n")

      const result = await runAgentOrchestrator({
        question: continuationQuestion,
        signal: req.signal,
      })

      return textResponse(formatFinalAnswerPlainText(result.final))
    }

    if (AGENT_VERBOSE_LOGS) {
      console.log("Agent request question length:", question.length)
    }

    const result = await runAgentOrchestrator({
      question,
      signal: req.signal,
    })
    const plainText = formatFinalAnswerPlainText(result.final)

    return textResponse(plainText)
  } catch (error) {
    if (AGENT_VERBOSE_LOGS) {
      console.error("Chat agent route error:", error instanceof Error ? error.message : error)
    }

    return textResponse(SERVICE_BUSY_TEXT)
  }
}
