import { judgeAndMergeAnswers } from "@/lib/agents/answer-judge-agent"
import { generateGeneralAnswer } from "@/lib/agents/general-answer-agent"
import { generateKnowledgeAnswer } from "@/lib/agents/knowledge-answer-agent"
import { analyzeQuery } from "@/lib/agents/query-analyzer"
import { retrieveRagChunks } from "@/lib/agents/rag-client"
import type {
  AgentOrchestratorResult,
  KnowledgeAnswer,
  RagRetrievalResult,
} from "@/lib/agents/types"

const DEFAULT_AGENT_TIMEOUT_MS = 60_000
const DEFAULT_AGENT_RAG_TOP_K = 5

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

function readNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function buildSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)

  if (!signal) {
    return timeoutSignal
  }

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeoutSignal])
  }

  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener("abort", abort, { once: true })
  timeoutSignal.addEventListener("abort", abort, { once: true })
  return controller.signal
}

function emptyRagResult(): RagRetrievalResult {
  return {
    rag_available: false,
    chunks: [],
    error: "问题分析判断当前请求不需要知识库检索。",
  }
}

function logAgentIssue(message: string, error: unknown) {
  if (process.env.AGENT_VERBOSE_LOGS === "true") {
    console.error(message, error)
  } else {
    console.error(message, error instanceof Error ? error.message : "unknown error")
  }
}

export async function runAgentOrchestrator(params: {
  question: string
  signal?: AbortSignal
}): Promise<AgentOrchestratorResult> {
  const timeoutMs = readNumber(process.env.AGENT_TIMEOUT_MS, DEFAULT_AGENT_TIMEOUT_MS)
  const signal = buildSignal(params.signal, timeoutMs)
  const analysis = analyzeQuery(params.question)
  const topK = readNumber(process.env.AGENT_RAG_TOP_K, DEFAULT_AGENT_RAG_TOP_K)
  const enableGeneral = readBoolean(process.env.AGENT_ENABLE_GENERAL_ANSWER, true)
  const enableJudge = readBoolean(process.env.AGENT_ENABLE_JUDGE, true)
  const allowGeneralFallback = readBoolean(process.env.AGENT_ALLOW_GENERAL_FALLBACK, true)

  if (process.env.AGENT_VERBOSE_LOGS === "true") {
    console.log("Agent analysis:", {
      questionType: analysis.question_type,
      needsRag: analysis.needs_rag,
      needsGeneralKnowledge: analysis.needs_general_knowledge,
      keywords: analysis.keywords,
    })
  }

  const ragPromise = analysis.needs_rag
    ? retrieveRagChunks({ query: analysis.search_query, topK, signal })
    : Promise.resolve(emptyRagResult())

  const rag = await ragPromise

  const knowledgePromise: Promise<KnowledgeAnswer | undefined> = analysis.needs_rag
    ? generateKnowledgeAnswer({
        question: params.question,
        chunks: rag.chunks,
        signal,
      }).catch((error) => {
        logAgentIssue("Knowledge answer agent failed:", error)
        return undefined
    })
    : Promise.resolve(undefined)

  const knowledgeAnswer = await knowledgePromise
  const hasKnowledgeAnchor = Boolean(
    knowledgeAnswer &&
      (knowledgeAnswer.direct_evidence.length > 0 || knowledgeAnswer.related_evidence.length > 0),
  )
  const shouldUseGeneral =
    enableGeneral &&
    (analysis.needs_general_knowledge || allowGeneralFallback) &&
    (allowGeneralFallback || hasKnowledgeAnchor)

  const generalAnswer =
    shouldUseGeneral
      ? await generateGeneralAnswer({
          question: params.question,
          analysis,
          knowledgeAnswer,
          signal,
        }).catch((error) => {
          logAgentIssue("General answer agent failed:", error)
          return undefined
        })
      : undefined

  const final = await judgeAndMergeAnswers({
    question: params.question,
    analysis,
    knowledgeAnswer,
    generalAnswer,
    ragAvailable: rag.rag_available,
    enableJudge,
    signal,
  })

  return {
    mode: "agent",
    analysis,
    rag,
    knowledge_answer: knowledgeAnswer,
    general_answer: generalAnswer,
    final,
  }
}
