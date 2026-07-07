export type QuestionType =
  | "factual"
  | "procedural"
  | "engineering"
  | "comparison"
  | "open_ended"
  | "unknown"

export interface RagChunk {
  content: string
  source?: string
  source_file?: string
  page?: number | string
  page_start?: number | string
  page_end?: number | string
  score?: number
  block_type?: string
  section_path?: string
  citation?: string
}

export interface QueryAnalysis {
  question_type: QuestionType
  needs_rag: boolean
  needs_general_knowledge: boolean
  keywords: string[]
  search_query: string
}

export interface RagRetrievalResult {
  rag_available: boolean
  chunks: RagChunk[]
  error?: string
}

export interface KnowledgeEvidence {
  source: string
  page?: string | number
  quote: string
  relevance?: string
}

export interface KnowledgeAnswer {
  answer: string
  direct_evidence: KnowledgeEvidence[]
  related_evidence: KnowledgeEvidence[]
  missing_info: string[]
  limitations: string
  confidence: number
  evidence?: KnowledgeEvidence[]
}

export interface GeneralAnswer {
  answer: string
  assumptions: string[]
  confidence: number
}

export interface FinalCitation {
  source: string
  page?: string | number
  quote?: string
  relevance?: string
}

export interface FinalAgentAnswer {
  final_answer: string
  knowledge_anchor_summary: string
  engineering_reasoning: string
  suggested_workflow: string[]
  material_selection?: string[]
  citations: FinalCitation[]
  missing_evidence: string[]
  confidence: number
  rag_used: boolean
  general_used: boolean
  warning: string
  knowledge_based_answer?: string
  general_answer_summary?: string
}

export interface AgentOrchestratorResult {
  mode: "agent"
  analysis: QueryAnalysis
  rag: RagRetrievalResult
  knowledge_answer?: KnowledgeAnswer
  general_answer?: GeneralAnswer
  final: FinalAgentAnswer
}
