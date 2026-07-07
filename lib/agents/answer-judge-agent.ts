import { generateAgentJson, getStageMaxOutputTokens } from "@/lib/agents/llm-agent-client"
import type {
  FinalAgentAnswer,
  GeneralAnswer,
  KnowledgeAnswer,
  QueryAnalysis,
} from "@/lib/agents/types"

function clampConfidence(value: unknown, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(0, Math.min(1, parsed))
}

function softenEngineeringText(text: string) {
  return text
    .replace(/（?如\s*(?:《[^》]*》)?\s*(?:JGJ|JTG|GB|TB|CECS|ASTM|AASHTO)[^）。.；;]*）?/gi, "（如现行相关规范）")
    .replace(/(?:JGJ|JTG\/?T?|GB|TB|CECS|ASTM|AASHTO)\s*[\w/.\-—]+/gi, "现行相关规范")
    .replace(/低频激振（[^）]*(?:Hz|kHz|赫兹)[^）]*）/gi, "低频激振")
    .replace(/(?:\d+(?:\.\d+)?\s*[-~—至]\s*\d+(?:\.\d+)?\s*(?:Hz|kHz|MPa|kPa|%|mm|cm|m|分钟|秒|赫兹|Rayl|MRayl))/gi, "需经规范或试验确认的参数范围")
    .replace(/(?:\d+(?:\.\d+)?\s*(?:Hz|kHz|MPa|kPa|%|mm|cm|m|分钟|秒|赫兹|Rayl|MRayl))/gi, "需经规范或试验确认的参数")
    .replace(/需经规范或试验确认的参数\s*[-~—至]\s*需经规范或试验确认的参数(?:Rayl|MRayl)?/gi, "需经规范或试验确认的参数范围")
    .replace(/（如需经规范或试验确认的参数[^）]*）/g, "（具体限值需依据规范或试验确认）")
    .replace(/如需经规范或试验确认的参数(?:或需经规范或试验确认的参数)+/g, "具体限值")
    .replace(/几十至几百赫兹/g, "需经规范或试验确认的频率范围")
    .replace(/成熟判据/g, "可参考的工程判断线索")
    .replace(/工程界公认/g, "工程实践中常见")
    .replace(/终极验证/g, "复核验证")
    .replace(/必须/g, "需在依据充分时")
    .replace(/建议选用/g, "可考虑采用")
    .replace(/应选用/g, "可考虑采用")
    .replace(/选用/g, "可考虑采用")
    .replace(/确定缺陷类型/g, "初步判断缺陷类型并结合现场复核")
}

function normalizeListItem(text: string) {
  return softenEngineeringText(text.replace(/^\s*(?:\d+[.)、]|[-*])\s*/, "").trim())
}

function asksMaterialSelection(question: string) {
  return /(?:材料|注浆|补强|加固|修复|浆液|选型)/.test(question)
}

function hasUsefulKnowledgeAnswer(answer?: KnowledgeAnswer) {
  if (!answer) {
    return false
  }
  return (
    answer.confidence >= 0.25 &&
    (answer.direct_evidence.length > 0 || answer.related_evidence.length > 0)
  )
}

function looksLikeRefusal(text: string) {
  return /(?:无法回答|不能回答|暂无充分依据|知识库中暂无充分依据|不具备回答条件|因此无法)/.test(text)
}

function computeConfidence(params: {
  knowledgeAnswer?: KnowledgeAnswer
  generalAnswer?: GeneralAnswer
  ragAvailable: boolean
}) {
  if (!params.ragAvailable) {
    return Math.min(params.generalAnswer?.confidence ?? 0.45, 0.55)
  }

  const directCount = params.knowledgeAnswer?.direct_evidence.length ?? 0
  const relatedCount = params.knowledgeAnswer?.related_evidence.length ?? 0
  const hasGeneral = Boolean(params.generalAnswer)

  if (directCount > 0 && hasGeneral) {
    return Math.min(Math.max(params.knowledgeAnswer?.confidence ?? 0.75, 0.75), 0.9)
  }

  if (directCount > 0) {
    return Math.min(Math.max(params.knowledgeAnswer?.confidence ?? 0.7, 0.65), 0.85)
  }

  if (relatedCount > 0) {
    return Math.min(
      Math.max(params.knowledgeAnswer?.confidence ?? 0.55, params.generalAnswer?.confidence ?? 0.55),
      0.75,
    )
  }

  return Math.min(Math.max(params.generalAnswer?.confidence ?? 0.45, 0.4), 0.65)
}

function buildNaturalFallbackAnswer(question: string) {
  if (/泥沙|泥浆|沉渣|淤泥/.test(question)) {
    return [
      "泥沙或沉渣会影响桩基检测结果的稳定性和判读可靠性，重点影响桩端持力层判断、桩底沉渣厚度识别、成桩质量评价以及后续承载性能分析。",
      "现场上通常要关注三类问题：一是泥沙夹杂可能削弱桩端或桩侧混凝土质量，二是沉渣和泥皮可能造成检测信号异常或取芯样貌失真，三是孔底清理、泥浆指标和混凝土灌注连续性会直接影响缺陷形成概率。",
      "建议把检测数据与施工记录、成孔记录、清孔记录、混凝土灌注记录和现场复核结果一起判断。对异常部位不要只依赖单一检测结论，宜结合低应变、声波透射、钻芯或静载等方法进行交叉验证。具体判定标准和处理措施仍应结合设计文件、检测报告和现场条件确定。",
    ].join("\n\n")
  }

  if (/检测|低应变|声波|声测|静载|钻芯|完整性|桩基础检测/.test(question)) {
    return [
      "桩基检测的核心是确认桩身完整性、承载能力、几何尺寸、施工质量和使用安全性。实际工作中应先明确检测目的，再选择合适方法，避免把一种检测手段的结论直接扩大到所有质量问题。",
      "现场需要重点关注检测条件、设备校准、测点布置、施工记录、桩型和地层条件。低应变法适合快速筛查桩身完整性，但对复杂桩型、超长桩、大直径桩或桩底细小缺陷的识别能力有限；声波透射法更适合灌注桩内部缺陷分析；钻芯法能提供直观样品，但范围有限；静载试验更接近承载性能验证，但周期和成本较高。",
      "建议做法是：1）先核对设计文件、桩型、桩长、成桩工艺和地质条件；2）根据检测目的选择方法组合；3）关注异常信号与施工记录是否对应；4）对关键异常采用复测或多方法交叉验证；5）最终结论结合规范、检测报告和现场条件综合判断。",
    ].join("\n\n")
  }

  if (/桩基|桩基础|桩/.test(question)) {
    return [
      "桩基问题通常要从承载、变形、完整性和施工质量四个方面综合分析。简单说，既要看桩能不能可靠传力，也要看桩身是否完整、桩端和桩侧条件是否满足设计要求。",
      "工程判断时应关注桩型、桩长、桩径、持力层、地下水、施工工艺、混凝土灌注连续性以及检测方法适用性。对异常结果不要孤立判断，应结合施工记录、地勘资料、检测曲线和必要的复核手段。",
      "建议优先明确问题属于设计、施工、检测还是运营阶段，再选择相应的复核路径。涉及承载力、缺陷等级、补强处理或验收结论时，具体参数仍应结合设计文件、检测报告、现行规范和现场条件确定。",
    ].join("\n\n")
  }

  return [
    "这个问题可以从工程对象、现场条件、检测方法适用性、数据可靠性和复核验证几个方面综合判断。",
    "建议先明确问题背景和判断目标，再核对设计文件、施工记录、检测报告和现场条件。对关键结论应避免只依赖单一数据源，必要时通过复测或多方法交叉验证提高可靠性。",
    "涉及具体参数、验收结论或处理措施时，仍应结合现行规范、设计要求和现场试验结果确定。",
  ].join("\n\n")
}

function fallbackFinalAnswer(params: {
  question: string
  knowledgeAnswer?: KnowledgeAnswer
  generalAnswer?: GeneralAnswer
  ragAvailable: boolean
}): FinalAgentAnswer {
  const usefulKnowledge = hasUsefulKnowledgeAnswer(params.knowledgeAnswer)
  const generalText = params.generalAnswer?.answer ?? ""
  const direct = params.knowledgeAnswer?.direct_evidence ?? []
  const related = params.knowledgeAnswer?.related_evidence ?? []
  const citations = [...direct, ...related]
  const missingEvidence = params.knowledgeAnswer?.missing_info ?? []
  const confidence = computeConfidence(params)
  const hasDirect = direct.length > 0
  const hasRelated = related.length > 0
  const hasGeneral = Boolean(generalText.trim())
  const anchorSummary = usefulKnowledge
    ? params.knowledgeAnswer?.answer ?? "已提取到部分可用于工程分析的资料锚点。"
    : params.ragAvailable
      ? "已完成资料检索和问题分析。"
      : "已完成问题分析。"
  const finalAnswer = hasGeneral
    ? generalText
    : buildNaturalFallbackAnswer(params.question)
  const warning = !params.ragAvailable
    ? ""
    : hasDirect
      ? params.knowledgeAnswer?.limitations ?? ""
      : hasRelated
        ? ""
        : ""

  return {
    final_answer: finalAnswer,
    knowledge_anchor_summary: anchorSummary,
    engineering_reasoning:
      generalText ||
      finalAnswer,
    suggested_workflow: [],
    material_selection: [],
    citations,
    missing_evidence: missingEvidence.length
      ? missingEvidence
      : [],
    confidence,
    rag_used: params.ragAvailable && (hasDirect || hasRelated),
    general_used: Boolean(params.generalAnswer),
    warning,
    knowledge_based_answer: params.knowledgeAnswer?.answer,
    general_answer_summary: generalText,
  }
}

function confidenceCeiling(answer: FinalAgentAnswer) {
  if (answer.warning.includes("知识库服务暂不可用")) {
    return 0.55
  }

  if (answer.citations.length === 0 && answer.general_used) {
    return 0.65
  }

  const allRelated = answer.citations.length > 0 && answer.citations.every((item) => {
    const relevance = item.relevance ?? ""
    return /(?:相关|不能直接|不能单独|背景|线索|锚点)/.test(relevance)
  })

  if (allRelated) {
    return 0.75
  }

  return 0.9
}

function normalizeFinalAnswer(value: FinalAgentAnswer, fallback: FinalAgentAnswer, question: string): FinalAgentAnswer {
  const suggestedWorkflow = Array.isArray(value.suggested_workflow)
    ? value.suggested_workflow.filter((item) => typeof item === "string" && item.trim()).slice(0, 8)
    : fallback.suggested_workflow
  const materialSelection = Array.isArray(value.material_selection)
    ? value.material_selection.filter((item) => typeof item === "string" && item.trim()).slice(0, 6)
    : fallback.material_selection ?? []
  const normalizedMaterialSelection = asksMaterialSelection(question) ? materialSelection : []
  const missingEvidence = Array.isArray(value.missing_evidence)
    ? value.missing_evidence.filter((item) => typeof item === "string" && item.trim()).slice(0, 8)
    : fallback.missing_evidence

  const normalized: FinalAgentAnswer = {
    final_answer:
      typeof value.final_answer === "string" && value.final_answer.trim()
        ? softenEngineeringText(value.final_answer.trim())
        : fallback.final_answer,
    knowledge_anchor_summary:
      typeof value.knowledge_anchor_summary === "string" && value.knowledge_anchor_summary.trim()
        ? value.knowledge_anchor_summary.trim()
        : fallback.knowledge_anchor_summary,
    engineering_reasoning:
      typeof value.engineering_reasoning === "string" && value.engineering_reasoning.trim()
        ? softenEngineeringText(value.engineering_reasoning.trim())
        : fallback.engineering_reasoning,
    suggested_workflow: suggestedWorkflow.map(normalizeListItem),
    material_selection: normalizedMaterialSelection.map(normalizeListItem),
    citations: Array.isArray(value.citations)
      ? value.citations
          .filter((item) => item && typeof item.source === "string")
          .slice(0, 6)
          .map((item) => ({
            source: item.source,
            page: item.page,
            quote: typeof item.quote === "string" ? item.quote : undefined,
            relevance: typeof item.relevance === "string" ? item.relevance : undefined,
          }))
      : fallback.citations,
    missing_evidence: missingEvidence,
    confidence: clampConfidence(value.confidence, fallback.confidence),
    rag_used: typeof value.rag_used === "boolean" ? value.rag_used : fallback.rag_used,
    general_used:
      typeof value.general_used === "boolean" ? value.general_used : fallback.general_used,
    warning: typeof value.warning === "string" ? value.warning : fallback.warning,
    knowledge_based_answer:
      typeof value.knowledge_based_answer === "string"
        ? value.knowledge_based_answer
        : fallback.knowledge_based_answer,
    general_answer_summary:
      typeof value.general_answer_summary === "string"
        ? value.general_answer_summary
        : fallback.general_answer_summary,
  }

  if (looksLikeRefusal(normalized.final_answer) && fallback.general_answer_summary) {
    normalized.final_answer = fallback.final_answer
    normalized.engineering_reasoning = fallback.engineering_reasoning
  }

  normalized.confidence = Math.min(normalized.confidence, confidenceCeiling(normalized))
  return normalized
}

export async function judgeAndMergeAnswers(params: {
  question: string
  analysis: QueryAnalysis
  knowledgeAnswer?: KnowledgeAnswer
  generalAnswer?: GeneralAnswer
  ragAvailable: boolean
  enableJudge?: boolean
  signal?: AbortSignal
}): Promise<FinalAgentAnswer> {
  const fallback = fallbackFinalAnswer(params)

  if (params.enableJudge === false) {
    return fallback
  }

  const system = [
    "你是专业工程问答助手，不是报告生成器。",
    "你会收到两个内部材料：1. 资料锚点；2. 工程补充推理。它们只用于内部融合，不要向普通用户解释材料来自哪里。",
    "不要机械拼接两个回答，必须生成一篇自然、专业的工程答案。",
    "final_answer 应根据用户问题自然组织，不要机械套模板：问题简单就直接回答；问题复杂再自然分段说明（例如先说结论，再说原因，再说建议），不要每次都罗列“知识库情况、通用工程知识补充、仍需确认、置信度”等固定板块。",
    "如果有相关资料内容，即使不是完整依据，也要自然融入回答，不要单独开一段介绍检索情况。",
    "不允许先大段拒答再大段通用回答。",
    "如果 knowledgeAnswer.direct_evidence 为空但 generalAnswer 有内容，final_answer 必须主要采用 generalAnswer.answer，不能写成无法回答。",
    "final_answer 不要出现“知识库未检索到直接依据”“未引用知识库”“以下为通用工程知识”“通用模型回答”“参考来源”“置信度”等内部状态表达。",
    "不允许伪造引用，也不要在正文展示引用路径、文件名、page_xxx、source_file 或 ocr_book。",
    "如果两者冲突，明确说明冲突，并优先知识库。",
    "如果存在 related_evidence，只需把有价值的信息自然融入答案，不要说明证据等级。",
    "不要虚构 ASTM、JGJ、规范编号、参数阈值、材料参数。",
    "不要输出 JGJ、JTG、GB、ASTM 等具体规范编号，除非知识库引用或用户问题明确给出。",
    "不要编造具体数值，例如时间、压力、百分比、强度或阈值，除非知识库或用户问题提供。",
    "不要编造频率范围、设备参数、压力参数、强度参数、百分比等具体数值；需要时写“需依据规范或现场试验确定”。",
    "如果需要数值，只能说需依据规范或现场试验确定。",
    "material_selection 只有在用户明确询问材料、注浆、补强、加固或修复选型时才输出；其他问题必须为空数组。",
    "不要说“成熟判据”“工程界公认”“必须”“终极验证”等缺少依据的绝对表述。",
    "引用只放在 citations 字段里，final_answer 正文不要展示引用来源、文件地址或原文列表。",
    "final_answer 不要显示置信度或百分比，置信度只写在 confidence 字段供系统使用，除非系统明确要求展示。",
    "输出内容应适合纯文本展示，不要使用 Markdown 语法，不要使用 **加粗**、# 标题、代码块或表格。",
    "可以给出工程思路，但要标注为建议。",
    "置信度规则：直接知识库证据且通用推理一致为0.75-0.9；有相关知识库锚点为0.55-0.75；无知识库直接依据但通用回答完整为0.4-0.65；RAG不可用不超过0.55；涉及具体规范条文或参数但无引用不超过0.6。",
    "只输出 JSON，不要输出 Markdown 或额外解释。",
  ].join("\n")

  const prompt = [
    `用户问题：${params.question}`,
    `问题分析：${JSON.stringify(params.analysis)}`,
    `RAG 是否可用：${params.ragAvailable}`,
    "",
    `知识库回答：${JSON.stringify(params.knowledgeAnswer ?? null)}`,
    "",
    `通用回答：${JSON.stringify(params.generalAnswer ?? null)}`,
    "",
    "请输出 JSON：",
    '{"final_answer":"...","knowledge_anchor_summary":"...","engineering_reasoning":"...","suggested_workflow":["..."],"material_selection":["..."],"citations":[{"source":"...","page":"...","quote":"...","relevance":"..."}],"missing_evidence":["..."],"confidence":0.0,"rag_used":true,"general_used":true,"warning":""}',
  ].join("\n")

  try {
    const answer = await generateAgentJson<FinalAgentAnswer>({
      system,
      prompt,
      fallback,
      temperature: 0.1,
      maxTokens: getStageMaxOutputTokens("judge"),
      signal: params.signal,
    })
    return normalizeFinalAnswer(answer, fallback, params.question)
  } catch {
    return fallback
  }
}
