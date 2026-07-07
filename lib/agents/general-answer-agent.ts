import { generateAgentText, getStageMaxOutputTokens, parseAgentJson } from "@/lib/agents/llm-agent-client"
import type { GeneralAnswer, KnowledgeAnswer, QueryAnalysis } from "@/lib/agents/types"

function clampConfidence(value: unknown, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(0, Math.min(1, parsed))
}

function normalizeGeneralAnswer(value: GeneralAnswer, fallbackAnswer: string): GeneralAnswer {
  return {
    answer:
      typeof value.answer === "string" && value.answer.trim()
        ? value.answer.trim()
        : fallbackAnswer,
    assumptions: Array.isArray(value.assumptions)
      ? value.assumptions.filter((item) => typeof item === "string").slice(0, 5)
      : [],
    confidence: clampConfidence(value.confidence, 0.5),
  }
}

function unescapeJsonString(value: string) {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string
  } catch {
    return value
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
  }
}

function extractAnswerFromMalformedJson(text: string) {
  const match = text.match(/"answer"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"assumptions"|"\s*,\s*"confidence"|"\s*})/)
  if (!match?.[1]) {
    return ""
  }

  return unescapeJsonString(match[1]).trim()
}

function cleanFallbackAnswer(text: string) {
  const extracted = extractAnswerFromMalformedJson(text)
  if (extracted) {
    return extracted
  }

  return text
    .replace(/^\s*\{\s*"answer"\s*:\s*/i, "")
    .replace(/"assumptions"\s*:\s*\[[\s\S]*$/i, "")
    .replace(/"confidence"\s*:\s*[\d.]+[\s\S]*$/i, "")
    .replace(/^\s*"|"\s*$/g, "")
    .replace(/\\n/g, "\n")
    .trim()
}

export async function generateGeneralAnswer(params: {
  question: string
  analysis: QueryAnalysis
  knowledgeAnswer?: KnowledgeAnswer
  signal?: AbortSignal
}): Promise<GeneralAnswer> {
  const directAnchors = params.knowledgeAnswer?.direct_evidence ?? []
  const relatedAnchors = params.knowledgeAnswer?.related_evidence ?? []
  const missingInfo = params.knowledgeAnswer?.missing_info ?? []
  const anchorSummary = [
    directAnchors.length
      ? `直接锚点：${directAnchors
          .map((item) => `${item.source}${item.page ? ` 第${item.page}页` : ""}：${item.quote}`)
          .join("；")}`
      : "直接锚点：无",
    relatedAnchors.length
      ? `相关锚点：${relatedAnchors
          .slice(0, 5)
          .map((item) => `${item.source}${item.page ? ` 第${item.page}页` : ""}：${item.quote}`)
          .join("；")}`
      : "相关锚点：无",
    missingInfo.length ? `知识库缺口：${missingInfo.join("；")}` : "知识库缺口：未明确",
  ].join("\n")

  const system = [
    "你是工程领域通用知识回答代理。",
    "你需要基于工程专业知识直接回答用户问题，语言自然、简洁、像专业工程助手。",
    "如果存在资料锚点，优先围绕锚点展开；如果锚点不足，也要直接给出工程分析、适用范围、局限性和核验建议。",
    "不要向普通用户展示资料命中状态、知识库状态或模型来源边界。",
    "不要声称没有依据，不要把回答写成检索报告，也不要把通用分析伪装成引用依据。",
    "不得虚构具体规范条文、页码、强制性数值、试验标准编号、阈值或材料参数。",
    "不要输出 JGJ、JTG、GB、ASTM 等具体规范编号，除非知识库锚点或用户问题明确给出。",
    "不要编造频率范围、压力、强度、百分比、时间等具体数值；需要数值时写“需依据规范或现场试验确定”。",
    "如果提到 PSD 导数、声波透射法、芯样渗透、注浆材料等方法，必须标注为“通用工程分析建议”，除非知识库有直接依据。",
    "不要使用“成熟判据”“工程界公认”“必须”等绝对化表述，除非知识库明确支持。",
    "对不确定内容使用“通常”“一般”“可能”“可考虑”“建议结合”“可作为辅助判断”等谨慎表达。",
    "涉及具体设计、验算、施工参数、检测结论时，必须提醒以现行规范、设计文件、检测报告和现场试验为准。",
    "工程问题要尽量覆盖定义、机理、影响因素、适用范围、局限性、常见分析/检测方法和工程应用场景，但要像专业老师自然讲解，不要写成审计报告。",
    "问题简单就直接说清楚；问题复杂再自然分段说明，不要每次都机械套用固定的“结论摘要/详细解释/建议流程/注意事项”标题，也不要给每一个小点都强行加标题。",
    "不要使用 Markdown 语法，不要使用 **加粗**、# 标题、代码块或表格。",
    "生成的是补充推理，不是最终答案。",
    "回答要专业、谨慎、简洁，不要过度啰嗦。",
    "只输出 JSON，不要输出 Markdown 或额外解释。",
  ].join("\n")

  const prompt = [
    `问题类型：${params.analysis.question_type}`,
    `用户问题：${params.question}`,
    "",
    "知识库锚点：",
    anchorSummary,
    "",
    "写作要求：",
    "1. 先直接回答用户问题，不要解释资料命中状态。",
    "2. 不要出现“知识库未检索到直接依据”“以下为通用工程知识”“未引用知识库”“通用模型回答”等表达。",
    "3. 不要伪造引用，不要编造规范条文、页码、规范编号或具体参数。",
    "4. 关键结论可提示结合规范、图纸、检测报告或现场资料核验。",
    "",
    "请输出 JSON：",
    '{"answer":"...","assumptions":[],"confidence":0.0}',
  ].join("\n")

  const text = await generateAgentText({
    system,
    prompt,
    temperature: 0.2,
    maxTokens: getStageMaxOutputTokens("general"),
    signal: params.signal,
  })

  const parsed = parseAgentJson<GeneralAnswer>(text)
  if (parsed) {
    return normalizeGeneralAnswer(parsed, text)
  }

  return {
    answer: cleanFallbackAnswer(text),
    assumptions: ["模型未返回结构化 JSON，已将原始通用回答作为补充。"],
    confidence: 0.45,
  }
}
