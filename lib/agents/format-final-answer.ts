import type { FinalAgentAnswer, FinalCitation } from "@/lib/agents/types"

const EMPTY_ANSWER_TEXT = "暂未生成有效回答，请稍后重试。"
const DEFAULT_LONG_ANSWER_MAX_CHARS = 16000
const CONTINUATION_HINT = "如果需要，我可以继续展开后续内容。"
const MAX_QUOTE_CHARS = 90
// A final_answer that doesn't end on sentence-final punctuation is a strong
// signal the underlying LLM call hit its maxOutputTokens ceiling mid-sentence
// (see llm-agent-client.ts) rather than finishing naturally.
const SENTENCE_END_PATTERN = /[。！？…”』」）)\].!?]\s*$/
const MIN_LENGTH_FOR_TRUNCATION_CHECK = 40

export type ShowSourcesMode = "auto" | "always" | "never"

export interface FormatFinalAnswerOptions {
  compact?: boolean
  showSources?: ShowSourcesMode
  showConfidence?: boolean
  showKnowledgeStatus?: boolean
}

function looksTruncated(text: string) {
  const trimmed = (text ?? "").trim()
  if (trimmed.length < MIN_LENGTH_FOR_TRUNCATION_CHECK) {
    return false
  }
  return !SENTENCE_END_PATTERN.test(trimmed)
}

function readBoolean(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === "true") {
    return true
  }
  if (normalized === "false") {
    return false
  }
  return fallback
}

function readShowSources(value: string | undefined, fallback: ShowSourcesMode): ShowSourcesMode {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "auto" || normalized === "always" || normalized === "never") {
    return normalized
  }
  return fallback
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function resolveOptions(options?: FormatFinalAnswerOptions): Required<FormatFinalAnswerOptions> {
  return {
    compact: options?.compact ?? readBoolean(process.env.AGENT_COMPACT_ANSWER, true),
    showSources: options?.showSources ?? readShowSources(process.env.AGENT_SHOW_SOURCES, "never"),
    showConfidence: options?.showConfidence ?? readBoolean(process.env.AGENT_SHOW_CONFIDENCE, false),
    showKnowledgeStatus:
      options?.showKnowledgeStatus ?? readBoolean(process.env.AGENT_SHOW_KNOWLEDGE_STATUS, false),
  }
}

function maybeLimitPlainText(text: string) {
  const longAnswerEnabled = readBoolean(process.env.AGENT_ENABLE_LONG_ANSWER, true)
  if (longAnswerEnabled) {
    return text
  }

  const maxChars = readPositiveInteger(
    process.env.AGENT_LONG_ANSWER_MAX_CHARS,
    DEFAULT_LONG_ANSWER_MAX_CHARS,
  )

  if (text.length <= maxChars) {
    return text
  }

  return `${text.slice(0, maxChars).trim()}\n\n如果需要，我可以继续展开后续内容。`
}

function removeSourceArtifacts(text: string) {
  const sourceLinePattern =
    /(?:参考来源|引用来源|来源列表|citation|source_file|ocr_book|page_\d+\.txt|[A-Za-z]:\\|\/[^ \n\r\t]*(?:\.txt|\.pdf))/i
  const sourceBlockStartPattern = /^\s*(?:参考来源|引用来源|来源列表|citations?|sources?)\s*[:：]?/i
  const sourceListItemPattern =
    /^\s*(?:\d+[）).、]|[-*+])?\s*(?:ocr_book|source_file|page_\d+\.txt|[A-Za-z]:\\|\/[^ \n\r\t]*(?:\.txt|\.pdf))/i
  const lines = text.split("\n")
  const kept: string[] = []
  let skippingSourceBlock = false

  for (const line of lines) {
    if (sourceBlockStartPattern.test(line)) {
      skippingSourceBlock = true
      continue
    }

    if (skippingSourceBlock) {
      if (!line.trim()) {
        skippingSourceBlock = false
      }
      if (!line.trim() || sourceListItemPattern.test(line) || sourceLinePattern.test(line)) {
        continue
      }
      skippingSourceBlock = false
    }

    if (sourceLinePattern.test(line)) {
      continue
    }

    kept.push(line)
  }

  return kept.join("\n").trim()
}

function removeInternalStatusText(text: string) {
  return text
    .replace(/知识库(?:未|没有|暂未|不)(?:检索到|提供|包含|具备|找到)[^。！？\n]*(?:[。！？]|\n|$)/g, "")
    .replace(/(?:由于|因为)?知识库(?:没有|未|暂无|不具备)[^。！？\n]*(?:[。！？]|\n|$)/g, "")
    .replace(/(?:未引用知识库|未找到直接引用依据|未找到直接依据|未引用直接依据)[^。！？\n]*(?:[。！？]|\n|$)/g, "")
    .replace(/(?:以下|以上)?为(?:模型)?通用工程知识(?:说明|补充|回答|分析)?[，。；：:\s]*/g, "")
    .replace(/通用模型回答[^。！？\n]*(?:[。！？]|\n|$)/g, "")
    .replace(/知识库服务暂不可用[^。！？\n]*(?:[。！？]|\n|$)/g, "")
    .replace(/参考来源\s*[:：][\s\S]*$/g, "")
    .replace(/置信度\s*[:：]\s*\d+%?/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// Defense-in-depth: agent prompts already instruct the model not to use
// Markdown, but long answers are the case most likely to drift, so strip
// common Markdown syntax down to plain text without touching normal Chinese
// punctuation (fullwidth ** / ##, etc. are never touched, only ASCII markup).
function sanitizeMarkdownForPlainText(value: string | undefined | null) {
  const withoutSourceArtifacts = removeSourceArtifacts(value ?? "")
  const withoutInternalStatus = removeInternalStatusText(withoutSourceArtifacts)

  return withoutInternalStatus
    .replace(/\r\n/g, "\n")
    // Fenced code blocks: drop the ``` fences but keep the content itself so
    // no information is silently lost if the model ignores the no-code-block rule.
    .replace(/```[^\n]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
}

function numberedLines(items: string[]) {
  return items
    .map((item) => sanitizeMarkdownForPlainText(item))
    .filter(Boolean)
    .map((item, index) => `${index + 1}）${item}`)
    .join("\n")
}

function section(title: string, body: string) {
  const cleanBody = sanitizeMarkdownForPlainText(body)
  return cleanBody ? `${title}：\n${cleanBody}` : ""
}

function isSubstantiallySame(a: string, b: string) {
  const left = sanitizeMarkdownForPlainText(a)
  const right = sanitizeMarkdownForPlainText(b)
  if (!left || !right) {
    return false
  }
  const sampleLeft = left.slice(0, 140)
  const sampleRight = right.slice(0, 140)
  return left === right || left.includes(sampleRight) || right.includes(sampleLeft)
}

// Citation quotes come from an LLM and aren't length-bounded by construction;
// cap them here so OCR noise or a verbose paraphrase never dominates the reply.
function condenseQuote(quote: string | undefined) {
  if (!quote) {
    return ""
  }
  const clean = sanitizeMarkdownForPlainText(quote).replace(/\s+/g, " ").trim()
  if (!clean) {
    return ""
  }
  return clean.length <= MAX_QUOTE_CHARS ? clean : `${clean.slice(0, MAX_QUOTE_CHARS).trim()}……`
}

function buildCitationLines(citations: FinalCitation[]) {
  return citations
    .filter((item) => item.source)
    .map((item, index) => {
      const page = item.page === undefined || item.page === null || item.page === "" ? "" : `，第 ${item.page} 页`
      const quote = condenseQuote(item.quote)
      return `${index + 1}）${item.source}${page}${quote ? `：${quote}` : ""}`
    })
}

export function formatFinalAnswerPlainText(
  answer: FinalAgentAnswer,
  options?: FormatFinalAnswerOptions,
): string {
  const resolved = resolveOptions(options)

  const citationLines = buildCitationLines(answer.citations)
  const hasCitations = citationLines.length > 0
  const showSourcesBlock = resolved.showSources !== "never" && hasCitations

  const mainText = sanitizeMarkdownForPlainText(answer.final_answer) || EMPTY_ANSWER_TEXT
  const sections: string[] = []

  if (resolved.compact) {
    sections.push(mainText)
  } else {
    sections.push(section("直接结论", mainText))

    const reasoning = answer.engineering_reasoning || ""
    if (reasoning && !isSubstantiallySame(mainText, reasoning)) {
      sections.push(section("原因分析", reasoning))
    }

    const actions = [...(answer.suggested_workflow ?? []), ...(answer.material_selection ?? [])]
    if (actions.length > 0) {
      sections.push(section("建议做法", numberedLines(actions)))
    }

    if (answer.missing_evidence.length > 0) {
      sections.push(section("注意事项", numberedLines(answer.missing_evidence)))
    }
  }

  if (resolved.showKnowledgeStatus && answer.warning) {
    sections.push(answer.warning)
  }

  if (showSourcesBlock) {
    sections.push(`参考来源：\n${citationLines.join("\n")}`)
  }

  if (resolved.showConfidence) {
    sections.push(`置信度：${Math.round(answer.confidence * 100)}%`)
  }

  if (looksTruncated(answer.final_answer)) {
    sections.push(CONTINUATION_HINT)
  }

  return maybeLimitPlainText(sections.filter(Boolean).join("\n\n").trim() || EMPTY_ANSWER_TEXT)
}

export function formatFinalAnswer(
  answer: FinalAgentAnswer,
  options?: FormatFinalAnswerOptions,
): string {
  return formatFinalAnswerPlainText(answer, options)
}
