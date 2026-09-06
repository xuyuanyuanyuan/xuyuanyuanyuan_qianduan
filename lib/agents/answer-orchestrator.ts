import { judgeAndMergeAnswers } from "@/lib/agents/answer-judge-agent"
import { generateGeneralAnswer } from "@/lib/agents/general-answer-agent"
import { generateKnowledgeAnswer } from "@/lib/agents/knowledge-answer-agent"
import { analyzeQuery } from "@/lib/agents/query-analyzer"
import { routeQuery } from "@/lib/agents/query-router"
import { retrieveRagChunks } from "@/lib/agents/rag-client"
import { runTableAnswerAgent } from "@/lib/agents/table-answer-agent"
import { fetchTableDatasets } from "@/lib/agents/table-client"
import type {
  AgentOrchestratorResult,
  KnowledgeAnswer,
  RagRetrievalResult,
  TableDatasetSummary,
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
  datasetIds?: string[]
  signal?: AbortSignal
}): Promise<AgentOrchestratorResult> {
  const timeoutMs = readNumber(process.env.AGENT_TIMEOUT_MS, DEFAULT_AGENT_TIMEOUT_MS)
  const signal = buildSignal(params.signal, timeoutMs)

  // 1. Check table datasets in system
  let datasets: TableDatasetSummary[] = []
  try {
    datasets = await fetchTableDatasets({ signal })
  } catch (error) {
    if (process.env.AGENT_VERBOSE_LOGS === "true") {
      console.warn("Fetch table datasets warning in orchestrator:", error)
    }
  }

  // 2. Intelligent Routing Layer (LLM Semantic Intent Router)
  const routing = await routeQuery({
    question: params.question,
    availableDatasetsCount: datasets.length,
    selectedDatasetIds: params.datasetIds,
    availableDatasets: datasets,
    signal,
  })

  if (process.env.AGENT_VERBOSE_LOGS === "true") {
    console.log("Query Routing Decision:", {
      question: params.question,
      route: routing.route,
      confidence: routing.confidence,
      reason: routing.reason,
      availableTables: datasets.length,
    })
  }

  // 3. Dispatch to Table QA if routed to table_qa
  if (routing.route === "table_qa") {
    const tableAnswer = await runTableAnswerAgent({
      question: params.question,
      datasetIds: routing.suggested_dataset_ids ?? params.datasetIds,
      signal,
    })

    return {
      mode: "table_agent",
      route: "table_qa",
      analysis: {
        question_type: "table_query",
        needs_rag: false,
        needs_general_knowledge: false,
        keywords: [params.question],
        search_query: params.question,
        route: "table_qa",
      },
      final: tableAnswer,
    }
  }

  // 4. Handle table QA intent when no data is uploaded yet
  if (routing.route === "table_qa_no_data") {
    const guideText = [
      "您询问的问题属于打桩施工数据分析与统计，但当前系统中尚未上传或关联表格资产。",
      "请点击输入框左侧的“+”按钮上传包含桩号、施工日期、桩长、贯入度、锤击数等字段的 Excel/CSV 表格，系统将自动解析并为您执行精准的只读 SQL 计算与异常分析。",
    ].join("\n\n")

    return {
      mode: "table_agent",
      route: "table_qa_no_data",
      analysis: {
        question_type: "table_query",
        needs_rag: false,
        needs_general_knowledge: false,
        keywords: [params.question],
        search_query: params.question,
        route: "table_qa_no_data",
      },
      final: {
        final_answer: guideText,
        knowledge_anchor_summary: "未关联表格资产",
        engineering_reasoning: guideText,
        suggested_workflow: ["点击输入框左侧加号图标上传表格", "支持 .xlsx、.xls、.csv 格式", "上传后再次提问即可开始数据分析"],
        citations: [],
        missing_evidence: ["请先上传打桩记录表格"],
        confidence: 0.9,
        rag_used: false,
        general_used: false,
        warning: "未上传表格资产",
        route: "table_qa_no_data",
      },
    }
  }

  // 5. Document RAG Pipeline (Standard 5-Stage Orchestrator)
  const analysis = analyzeQuery(params.question)
  analysis.route = "document_rag"
  const topK = readNumber(process.env.AGENT_RAG_TOP_K, DEFAULT_AGENT_RAG_TOP_K)
  const enableGeneral = readBoolean(process.env.AGENT_ENABLE_GENERAL_ANSWER, true)
  const enableJudge = readBoolean(process.env.AGENT_ENABLE_JUDGE, true)
  const allowGeneralFallback = readBoolean(process.env.AGENT_ALLOW_GENERAL_FALLBACK, true)

  if (process.env.AGENT_VERBOSE_LOGS === "true") {
    console.log("Document RAG analysis:", {
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
  final.route = "document_rag"

  return {
    mode: "agent",
    route: "document_rag",
    analysis,
    rag,
    knowledge_answer: knowledgeAnswer,
    general_answer: generalAnswer,
    final,
  }
}
