export type QuestionType =
  | "factual"
  | "procedural"
  | "engineering"
  | "comparison"
  | "open_ended"
  | "table_query"
  | "unknown"

export type QueryRoute = "table_qa" | "document_rag" | "table_qa_no_data"

export interface QueryRoutingResult {
  route: QueryRoute
  confidence: number
  reason: string
  suggested_dataset_ids?: string[]
  detected_pile?: string | null
  detected_metric?: string | null
}

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
  route?: QueryRoute
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
  route?: QueryRoute
  table_trace?: TableToolTraceItem[]
}

export interface AgentOrchestratorResult {
  mode: "agent" | "table_agent"
  route: QueryRoute
  analysis: QueryAnalysis
  rag?: RagRetrievalResult
  knowledge_answer?: KnowledgeAnswer
  general_answer?: GeneralAnswer
  final: FinalAgentAnswer
}

// Table QA related types
export interface TableColumnProfile {
  source_name: string
  sql_name: string
  dtype: string
  non_null_count: number
  null_count: number
  sample_values: string[]
  numeric_min?: number | null
  numeric_max?: number | null
  numeric_mean?: number | null
  business_role?: string | null
  unit?: string | null
  description?: string
  quality_flags: string[]
}

export interface TableSheetProfile {
  sheet_id: string
  sheet_name: string
  table_name: string
  row_count: number
  columns: TableColumnProfile[]
}

export interface TableDatasetSummary {
  dataset_id: string
  original_filename: string
  project_name?: string
  description: string
  raw_description?: string
  created_at: string
  sheet_count: number
  total_rows: number
}

export interface TableDatasetDetail extends TableDatasetSummary {
  stored_path?: string
  sheets: TableSheetProfile[]
  quality_report?: {
    total_sheets: number
    total_columns: number
    empty_columns: number
    has_warnings: boolean
  }
}

export interface TableQueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  row_count: number
  sql: string
}

export interface TableSampleRowsResult {
  sheet_id: string
  table_name?: string
  columns: string[]
  rows: Record<string, unknown>[]
  total_rows: number
}

export interface TableToolTraceItem {
  tool_name: string
  arguments: Record<string, unknown>
  result_preview: unknown
}

