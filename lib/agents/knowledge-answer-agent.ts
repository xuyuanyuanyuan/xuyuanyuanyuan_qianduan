import { generateAgentJson, getStageMaxOutputTokens } from "@/lib/agents/llm-agent-client"
import type { KnowledgeAnswer, RagChunk } from "@/lib/agents/types"

const MAX_CONTEXT_CHUNKS = 5
const MAX_CHUNK_CHARS = 1000

function clampConfidence(value: unknown, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(0, Math.min(1, parsed))
}

function chunkSource(chunk: RagChunk) {
  return chunk.source_file || chunk.source || "unknown"
}

function chunkPage(chunk: RagChunk) {
  return chunk.page_start ?? chunk.page ?? ""
}

function shortQuote(text: string, limit = 80) {
  const clean = text.replace(/\s+/g, " ").trim()
  return clean.length <= limit ? clean : `${clean.slice(0, limit)}...`
}

function buildContext(chunks: RagChunk[]) {
  return chunks
    .slice(0, MAX_CONTEXT_CHUNKS)
    .map((chunk, index) => {
      const content = chunk.content.replace(/\s+/g, " ").trim().slice(0, MAX_CHUNK_CHARS)
      return [
        `【资料${index + 1}】`,
        `来源：${chunkSource(chunk)}`,
        `页码：${chunkPage(chunk) || "未知"}`,
        `内容：${content}`,
      ].join("\n")
    })
    .join("\n\n")
}

function fallbackKnowledgeAnswer(chunks: RagChunk[], limitations?: string): KnowledgeAnswer {
  const selected = chunks.slice(0, 3)
  const related = selected.map((chunk) => ({
    source: chunkSource(chunk),
    page: chunkPage(chunk),
    quote: shortQuote(chunk.content),
    relevance: "检索结果与问题主题存在术语或工程对象层面的相关性，但不能单独形成完整判据。",
  }))
  const answer = selected.length
    ? `已提取到 ${selected.length} 条与问题相关的资料锚点，可作为后续工程分析的事实边界。`
    : ""

  return {
    answer,
    direct_evidence: [],
    related_evidence: related,
    evidence: related,
    missing_info: selected.length
      ? [
          "知识库缺少该问题的直接资料或完整判据。",
          "知识库缺少可直接引用的规范条文、参数阈值或现场判定条件。",
        ]
      : ["知识库未检索到与该问题直接相关的资料"],
    limitations:
      limitations ||
      (selected.length
        ? "资料锚点只能覆盖问题中的部分内容，关键结论仍需要结合规范、设计文件、检测报告和现场条件核验。"
        : "缺少可用资料锚点，关键结论仍需要结合规范、设计文件、检测报告和现场条件核验。"),
    confidence: selected.length ? 0.45 : 0.1,
  }
}

function normalizeKnowledgeAnswer(value: KnowledgeAnswer, chunks: RagChunk[]): KnowledgeAnswer {
  const fallback = fallbackKnowledgeAnswer(chunks)
  const directEvidence = Array.isArray(value.direct_evidence)
    ? value.direct_evidence
        .filter((item) => item && typeof item.source === "string" && typeof item.quote === "string")
        .slice(0, 5)
        .map((item) => ({
          source: item.source,
          page: item.page,
          quote: shortQuote(item.quote),
          relevance: typeof item.relevance === "string" ? item.relevance : "可直接支持问题中的部分判断。",
        }))
    : []
  const relatedEvidence = Array.isArray(value.related_evidence)
    ? value.related_evidence
        .filter((item) => item && typeof item.source === "string" && typeof item.quote === "string")
        .slice(0, 5)
        .map((item) => ({
          source: item.source,
          page: item.page,
          quote: shortQuote(item.quote),
          relevance: typeof item.relevance === "string" ? item.relevance : "与问题存在相关资料锚点。",
        }))
    : fallback.related_evidence
  const evidence = directEvidence.length || relatedEvidence.length
    ? [...directEvidence, ...relatedEvidence]
    : fallback.evidence

  return {
    answer: typeof value.answer === "string" && value.answer.trim() ? value.answer.trim() : fallback.answer,
    direct_evidence: directEvidence,
    related_evidence: relatedEvidence,
    evidence,
    missing_info: Array.isArray(value.missing_info)
      ? value.missing_info.filter((item) => typeof item === "string" && item.trim()).slice(0, 8)
      : fallback.missing_info,
    limitations:
      typeof value.limitations === "string" ? value.limitations : fallback.limitations,
    confidence: clampConfidence(value.confidence, fallback.confidence),
  }
}

export async function generateKnowledgeAnswer(params: {
  question: string
  chunks: RagChunk[]
  signal?: AbortSignal
}): Promise<KnowledgeAnswer> {
  if (params.chunks.length === 0) {
    return {
      answer: "",
      direct_evidence: [],
      related_evidence: [],
      evidence: [],
      missing_info: ["缺少可直接用于该问题判断的资料锚点"],
      limitations: "缺少可用资料锚点，关键结论仍需要结合规范、设计文件、检测报告和现场条件核验。",
      confidence: 0.1,
    }
  }

  const fallback = fallbackKnowledgeAnswer(params.chunks)

  const system = [
    "你是企业知识库锚点提取代理。",
    "你的任务不是完整作答，而是从给定知识库片段中提取可用于回答用户问题的事实锚点。",
    "请区分 direct_evidence 与 related_evidence：direct_evidence 能直接支持问题中的判断；related_evidence 只是相关术语、工程对象、章节、检测方法、材料名称或背景信息。",
    "即使不能完整回答，也要输出 partial evidence 和 missing_info。",
    "不要把资料状态写成面向用户的拒答；你只负责提取可用锚点和缺失信息。",
    "如果片段有内容但不能直接回答，answer 应写成“已提取到相关资料锚点，可用于后续工程分析”，不要写“因此无法回答”。",
    "不要使用模型自身知识补全企业内部事实，不要编造判据、阈值、规范编号或 source/page。",
    "answer 应概括知识库锚点能支持什么、不能支持什么，用自然语句说明即可，不要写成审计报告，不要给每条要点都强行加小标题。",
    "quote 不要太长，每条证据控制在 80 字以内。",
    "不要使用 Markdown 语法，不要使用 **加粗**、# 标题、代码块或表格。",
    "只输出 JSON，不要输出 Markdown 或额外解释。",
  ].join("\n")

  const prompt = [
    `用户问题：${params.question}`,
    "",
    "知识库片段：",
    buildContext(params.chunks),
    "",
    "请输出 JSON：",
    '{"answer":"...","direct_evidence":[{"source":"...","page":"...","quote":"...","relevance":"..."}],"related_evidence":[{"source":"...","page":"...","quote":"...","relevance":"..."}],"missing_info":["..."],"limitations":"...","confidence":0.0}',
  ].join("\n")

  try {
    const answer = await generateAgentJson<KnowledgeAnswer>({
      system,
      prompt,
      fallback,
      temperature: 0.1,
      maxTokens: getStageMaxOutputTokens("knowledge"),
      signal: params.signal,
    })
    return normalizeKnowledgeAnswer(answer, params.chunks)
  } catch (error) {
    return fallbackKnowledgeAnswer(
      params.chunks,
      error instanceof Error ? `知识库回答代理调用失败：${error.message}` : "知识库回答代理调用失败。",
    )
  }
}
