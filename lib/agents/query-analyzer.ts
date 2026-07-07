import type { QueryAnalysis, QuestionType } from "@/lib/agents/types"

const RAG_TERMS = [
  "规范",
  "标准",
  "流程",
  "制度",
  "资料",
  "文档",
  "pdf",
  "PDF",
  "页",
  "条款",
  "方案",
  "施工",
  "检测",
  "桩基",
  "桩基础",
  "工程",
  "生产",
  "安全",
  "项目",
  "质量",
  "验收",
  "设计",
  "声波透射法",
  "声测",
  "CSL",
  "PSD",
  "波幅",
  "声速",
  "芯样",
  "取芯",
  "渗透",
  "滴定",
  "注浆",
  "补强",
  "缩径",
  "夹泥",
  "离析",
  "缺陷",
  "水平荷载",
  "水平荷载桩",
  "低应变",
  "反射波",
  "大直径",
  "超长",
  "嵌岩桩",
  "桩底",
]

const GENERAL_TERMS = [
  "解释",
  "为什么",
  "怎么理解",
  "区别",
  "建议",
  "怎么看",
  "如何提升",
  "如何",
  "是什么",
  "原理",
  "优缺点",
]

const COMPARISON_TERMS = ["区别", "对比", "比较", "差异", "哪个更"]
const PROCEDURAL_TERMS = ["流程", "步骤", "怎么做", "如何", "方案", "施工", "审批"]

const QUERY_EXPANSIONS: Array<{ terms: string[]; expansions: string[] }> = [
  {
    terms: ["声波透射法", "CSL", "声测", "声速", "波幅", "PSD"],
    expansions: ["声波透射法", "声测管", "波幅", "声速", "PSD", "桩身完整性检测"],
  },
  {
    terms: ["芯样", "取芯", "渗透", "滴定", "泥皮"],
    expansions: ["钻芯法", "芯样", "泥皮", "渗透性", "桩身缺陷复核"],
  },
  {
    terms: ["缩径", "夹泥", "离析", "缺陷", "孔隙"],
    expansions: ["缩径", "夹泥", "粗骨料离析", "桩身缺陷", "混凝土质量"],
  },
  {
    terms: ["注浆", "补强", "材料", "水泥基", "超细水泥"],
    expansions: ["注浆补强", "补强材料", "水泥基材料", "超细水泥", "可灌性"],
  },
  {
    terms: ["承载力", "静载", "验收"],
    expansions: ["承载力", "静载试验", "验收", "设计要求"],
  },
  {
    terms: ["水平荷载", "水平荷载桩", "水平力", "水平位移"],
    expansions: ["水平荷载桩", "水平承载力", "水平位移", "桩身弯矩", "m法", "p-y曲线", "水平静载试验"],
  },
  {
    terms: ["低应变", "反射波", "大直径", "超长", "嵌岩桩", "桩底"],
    expansions: ["低应变反射波法", "应力波反射", "大直径桩", "超长桩", "嵌岩桩", "桩底反射", "桩身完整性"],
  },
]

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term))
}

function inferQuestionType(question: string): QuestionType {
  if (includesAny(question, COMPARISON_TERMS)) {
    return "comparison"
  }

  if (includesAny(question, PROCEDURAL_TERMS)) {
    return "procedural"
  }

  if (includesAny(question, ["工程", "桩基", "桩基础", "施工", "检测", "验收", "安全"])) {
    return "engineering"
  }

  if (includesAny(question, ["是什么", "定义", "含义", "多少", "哪些"])) {
    return "factual"
  }

  if (includesAny(question, ["建议", "怎么看", "为什么", "怎么理解"])) {
    return "open_ended"
  }

  return "unknown"
}

function extractKeywords(question: string): string[] {
  const normalized = question
    .replace(/[，。！？；：、,.!?;:()[\]{}"'“”‘’]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  const knownTerms = [...RAG_TERMS, ...GENERAL_TERMS]
    .filter((term) => question.includes(term))
    .map((term) => term.toLowerCase())

  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length >= 2)

  const cjkCandidates = Array.from(
    question.matchAll(/[\u4e00-\u9fff]{2,8}/g),
    (match) => match[0],
  ).filter((token) => token.length >= 2)

  return Array.from(new Set([...knownTerms, ...tokens, ...cjkCandidates])).slice(0, 8)
}

function buildSearchQuery(question: string, keywords: string[]) {
  const expansionTerms = QUERY_EXPANSIONS
    .filter((item) => item.terms.some((term) => question.includes(term)))
    .flatMap((item) => item.expansions)

  return Array.from(new Set([question, ...keywords, ...expansionTerms]))
    .filter(Boolean)
    .slice(0, 18)
    .join(" ")
}

export function analyzeQuery(question: string): QueryAnalysis {
  const trimmed = question.trim()
  const questionType = inferQuestionType(trimmed)
  const hasRagTerms = includesAny(trimmed, RAG_TERMS)
  const hasGeneralTerms = includesAny(trimmed, GENERAL_TERMS)
  const keywords = extractKeywords(trimmed)

  return {
    question_type: questionType,
    needs_rag: hasRagTerms || true,
    needs_general_knowledge: hasGeneralTerms || true,
    keywords,
    search_query: buildSearchQuery(trimmed, keywords),
  }
}
