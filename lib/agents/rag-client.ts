import type { RagChunk, RagRetrievalResult } from "@/lib/agents/types"

const DEFAULT_RAG_API_URL = "http://localhost:3001"
const DEFAULT_AGENT_RAG_TOP_K = 5
const AGENT_VERBOSE_LOGS = process.env.AGENT_VERBOSE_LOGS === "true"

function readTopK(value: string | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AGENT_RAG_TOP_K
}

function buildCitation(chunk: RagChunk) {
  const source = chunk.source_file || chunk.source || "unknown"
  const page = chunk.page_start ?? chunk.page
  return page === undefined || page === null ? source : `${source} 第 ${page} 页`
}

function normalizeChunk(raw: unknown): RagChunk | null {
  if (!raw || typeof raw !== "object") {
    return null
  }

  const item = raw as Record<string, unknown>
  const content = typeof item.content === "string"
    ? item.content
    : typeof item.document === "string"
      ? item.document
      : ""

  if (!content.trim()) {
    return null
  }

  const chunk: RagChunk = {
    content,
    source: typeof item.source === "string" ? item.source : undefined,
    source_file: typeof item.source_file === "string" ? item.source_file : undefined,
    page: typeof item.page === "number" || typeof item.page === "string" ? item.page : undefined,
    page_start:
      typeof item.page_start === "number" || typeof item.page_start === "string"
        ? item.page_start
        : undefined,
    page_end:
      typeof item.page_end === "number" || typeof item.page_end === "string"
        ? item.page_end
        : undefined,
    score: typeof item.score === "number" ? item.score : undefined,
    block_type: typeof item.block_type === "string" ? item.block_type : undefined,
    section_path: typeof item.section_path === "string" ? item.section_path : undefined,
  }

  return {
    ...chunk,
    citation: buildCitation(chunk),
  }
}

export async function retrieveRagChunks(params: {
  query: string
  topK?: number
  signal?: AbortSignal
}): Promise<RagRetrievalResult> {
  const ragApiUrl = process.env.RAG_API_URL ?? DEFAULT_RAG_API_URL
  const topK = params.topK ?? readTopK(process.env.AGENT_RAG_TOP_K)
  const url = `${ragApiUrl.replace(/\/+$/, "")}/search`

  try {
    if (AGENT_VERBOSE_LOGS) {
      console.log("Agent RAG request:", { url, topK, queryLength: params.query.length })
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: params.query, top_k: topK }),
      signal: params.signal,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      return {
        rag_available: false,
        chunks: [],
        error: `RAG 服务返回 ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      }
    }

    const data = await response.json().catch(() => null)
    const rawResults = Array.isArray(data?.results) ? data.results : []
    const chunks = rawResults
      .map((item: unknown) => normalizeChunk(item))
      .filter((item: RagChunk | null): item is RagChunk => item !== null)

    if (AGENT_VERBOSE_LOGS) {
      console.log("Agent RAG results count:", chunks.length)
    }

    return {
      rag_available: true,
      chunks,
    }
  } catch (error) {
    return {
      rag_available: false,
      chunks: [],
      error: error instanceof Error ? error.message : "RAG 检索服务异常。",
    }
  }
}

