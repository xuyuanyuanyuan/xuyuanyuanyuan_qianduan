import type { QueryRoute, QueryRoutingResult, TableDatasetSummary } from "@/lib/agents/types"
import { generateAgentJson } from "@/lib/agents/llm-agent-client"

interface LlmRoutingPayload {
  route: QueryRoute
  confidence: number
  reason: string
  detected_pile?: string | null
  detected_metric?: string | null
}

const SPEC_FAST_PATH_REGEX =
  /(?:jgj\s*\d+|gb\s*\d+|jtg\s*\d+|规范第\s*\d+(?:\.\d+)*\s*条|规程第\s*\d+(?:\.\d+)*\s*条)/i

// Fallback heuristic classification keywords
const TABLE_INTENT_KEYWORDS = [
  "统计",
  "汇总",
  "查询",
  "计算",
  "平均",
  "最大",
  "最小",
  "总计",
  "总数",
  "总共",
  "共有",
  "排序",
  "前10",
  "前5",
  "前十",
  "前五",
  "前几",
  "最高",
  "最低",
  "最深",
  "最浅",
  "大于",
  "小于",
  "等于",
  "占比",
  "分布",
  "异常",
  "超标",
  "偏差",
  "筛选",
  "找出",
  "列出",
  "哪些桩",
  "哪个桩",
  "几根",
  "多少根",
  "多少米",
  "多少击",
  "打入多深",
  "多深",
  "多长",
  "是多少",
  "为多少",
  "具体是",
  "查一下",
  "看下",
  "看一下",
  "表格",
  "表里",
  "表中",
  "当前表",
  "上传的表",
  "excel",
  "csv",
  "sheet",
  "字段",
  "列名",
  "sql",
  "施工记录",
  "打桩记录",
  "单桩",
  "这根桩",
  "某桩",
  "号桩",
  "桩长",
  "入土深度",
  "贯入度",
  "锤击数",
]

const TABLE_FIELD_KEYWORDS = [
  "桩长",
  "设计桩长",
  "打入深度",
  "实际深度",
  "入土深度",
  "入土",
  "贯入度",
  "停锤贯入度",
  "锤击数",
  "总锤击数",
  "总击数",
  "最后贯入度",
  "桩径",
  "直径",
  "壁厚",
  "桩顶标高",
  "桩尖标高",
  "偏位",
  "偏差",
  "压桩力",
  "终压力",
  "终压值",
  "施工日期",
  "完成日期",
  "施工班组",
  "机具编号",
  "桩机编号",
  "桩位编号",
  "桩号",
  "地层",
  "土层",
  "持力层",
  "欠深",
  "超深",
  "沉桩",
]

const DOC_SPEC_KEYWORDS = [
  "规范",
  "规程",
  "标准",
  "jgj",
  "gb",
  "jtg",
  "条文",
  "强制性条文",
  "验收规范",
  "施工规范",
  "技术规范",
  "设计规范",
  "声测法",
  "低应变",
  "高应变",
  "静载试验",
  "自平衡",
  "钻芯法",
  "反射波法",
  "完整性类别",
  "ⅰ类桩",
  "ⅱ类桩",
  "ⅲ类桩",
  "ⅳ类桩",
  "断桩",
  "缩径",
  "扩径",
  "离析",
  "泥皮",
  "沉渣",
  "蜂窝",
  "孔洞",
  "夹泥",
  "沉管灌注桩",
  "泥浆护壁",
  "钻孔灌注桩",
  "预应力管桩",
  "钢管桩",
  "沉降量",
  "极限承载力",
  "特征值",
  "安全等级",
  "设计原则",
  "构造要求",
  "工法",
  "工艺流程",
]

/**
 * Regex and pattern matching to extract clean pile entities from natural language queries.
 * Examples:
 *   "A1桩的桩长是多少？" -> "A1"
 *   "PHC-007实际打入多深？" -> "PHC-007"
 *   "查一下04号桩的贯入度" -> "04"
 *   "帮我看下3#桩的总锤击数" -> "3"
 *   "看一下Z-12桩的设计桩长" -> "Z-12"
 *   "试桩01的终压力是多少" -> "01"
 */
export function extractPileEntity(question: string): string | null {
  const normalized = question.trim()

  // 1. Matches: PHC-007, PHC_01, PHC001
  const phcMatch = normalized.match(/(?:phc\s*[-_]?\s*([a-z0-9]+(?:-[a-z0-9]+)?))/i)
  if (phcMatch) {
    return phcMatch[0].replace(/\s+/g, "").toUpperCase()
  }

  // 2. Matches: 试桩01, 试桩-01
  const testPileMatch = normalized.match(/试桩\s*[-#]?\s*([a-z0-9]+)/i)
  if (testPileMatch) {
    return testPileMatch[1].toUpperCase()
  }

  // 3. Matches: 3#桩, 3号桩, 04号桩, A1桩, Z-12桩, 12-1桩
  const generalPileMatch = normalized.match(/([a-z]?\d{1,4}[a-z]?|\d+-\d+|[a-z]-\d+)\s*(?:#|号)?\s*桩/i)
  if (generalPileMatch) {
    return generalPileMatch[1].toUpperCase()
  }

  // 4. Matches: 桩号为A1, 桩号是PHC-001, 桩号: 04
  const idMatch = normalized.match(/桩号(?:\s*为|\s*是|\s*[:：])?\s*([a-z0-9_-]+)/i)
  if (idMatch) {
    return idMatch[1].toUpperCase()
  }

  return null
}

/**
 * Heuristic fallback router for resilience when LLM call fails
 */
function heuristicFallback(params: {
  question: string
  availableDatasetsCount: number
  selectedDatasetIds?: string[]
}): QueryRoutingResult {
  const normalized = params.question.toLowerCase().trim()

  const matchTableIntent = TABLE_INTENT_KEYWORDS.filter((kw) => normalized.includes(kw))
  const matchTableField = TABLE_FIELD_KEYWORDS.filter((kw) => normalized.includes(kw))
  const matchDocSpec = DOC_SPEC_KEYWORDS.filter((kw) => normalized.includes(kw))

  const detectedPile = extractPileEntity(params.question)
  const hasSpecificPileEntity = Boolean(detectedPile)
  const hasDatasets = params.availableDatasetsCount > 0

  // 1. Fast specification / technical theory precedence:
  // If question mentions engineering standards, testing principles, or quality defects,
  // AND doesn't query a specific pile in the table, AND doesn't explicitly ask for table stats ("统计/计算/表格/排序"):
  const isExplicitTableDataQuery =
    /(?:表格|表里|表中|excel|csv|sheet|上传的表|平均|统计|总计|排序|前\d+|前十|前五|哪个班组|几根|多少根)/i.test(
      normalized,
    )
  if (matchDocSpec.length > 0 && !hasSpecificPileEntity && !isExplicitTableDataQuery) {
    return {
      route: "document_rag",
      confidence: 0.9,
      reason: `规则识别：提问涉及工程规范、检测原理或理论分析（${matchDocSpec.slice(0, 3).join("、")}），分流至知识库 RAG。`,
    }
  }

  // 2. If question contains specific pile entity (e.g. "A1桩", "PHC-007")
  if (hasSpecificPileEntity) {
    return {
      route: hasDatasets ? "table_qa" : "table_qa_no_data",
      confidence: 0.92,
      reason: `规则识别：检测到单桩实体“${detectedPile}”查询。`,
      detected_pile: detectedPile,
    }
  }

  // 3. If user has active datasets or selected dataset
  if (
    params.selectedDatasetIds &&
    params.selectedDatasetIds.length > 0 &&
    (matchTableIntent.length > 0 || matchTableField.length > 0)
  ) {
    return {
      route: "table_qa",
      confidence: 0.9,
      reason: "规则兜底：用户已选择特定表格，且命中表格字段或计算意图。",
      suggested_dataset_ids: params.selectedDatasetIds,
    }
  }

  // 4. General table calculations or statistics
  if (matchTableIntent.length > 0 && (matchTableField.length > 0 || normalized.includes("桩"))) {
    return {
      route: hasDatasets ? "table_qa" : "table_qa_no_data",
      confidence: 0.88,
      reason: "规则识别：提问命中施工数据统计或查询意图。",
    }
  }

  return {
    route: "document_rag",
    confidence: 0.75,
    reason: "规则兜底：未匹配到表格施工特征，默认采用知识库 RAG 检索。",
  }
}

/**
 * LLM-based Semantic Intent Router (大模型语义路由器)
 */
export async function routeQuery(params: {
  question: string
  availableDatasetsCount: number
  selectedDatasetIds?: string[]
  availableDatasets?: TableDatasetSummary[]
  signal?: AbortSignal
}): Promise<QueryRoutingResult> {
  const question = params.question.trim()

  // 1. Fast Path: Explicit specification code query with specific article/clause
  if (SPEC_FAST_PATH_REGEX.test(question)) {
    return {
      route: "document_rag",
      confidence: 0.98,
      reason: "命中明确的规范规程条文引用，极速直通知识库 RAG 检索。",
    }
  }

  // 2. Format available datasets context for LLM
  const datasetDescriptions = (params.availableDatasets || [])
    .slice(0, 5)
    .map(
      (d) =>
        `- 表格: "${d.original_filename}" (ID: ${d.dataset_id}, 共 ${d.total_rows} 行数据, 说明: ${d.description || "打桩记录"})`,
    )
    .join("\n")

  const routerSystemPrompt = `你是中船九院“九工天匠”智能意图路由器（LLM Semantic Intent Router）。
你的核心任务：深度理解工程师的自然语言提问（包括口语、倒装句、工程简写、具体单点桩号查验、进度统计），精准判断该问题应当分流到哪个专业执行子系统：

【分流路线说明 (route)】：
1. "table_qa":
   - 触发条件：用户提问涉及具体的工程施工记录、现场打桩数据、单桩具体参数（如“A1桩的桩长是多少”、“PHC-007实际打入多深”、“查一下04桩的贯入度”、“哪根桩欠深了”）；
   - 或者涉及施工表格的数据统计、每天打桩进度、总桩数汇总、极值排序对比、班组对比或施工质量异常排查；
   - 并且当前系统中有可用的表格数据资产（availableDatasetsCount > 0）。
2. "table_qa_no_data":
   - 触发条件：用户提问明显是要查询或统计现场施工表格数据或单桩施工参数，但当前系统中没有任何已上传的表格资产（availableDatasetsCount == 0）。
3. "document_rag":
   - 触发条件：用户提问涉及工程规范标准条文（JGJ、GB、JTG等）、施工工艺工法原理、桩基检测技术（声测法、低应变法、高应变法、静载试验、钻芯检测等）、缺陷与质量病害成因机理（断桩、缩径、夹泥、离析）、检测理论对比等技术规范知识。

【关键：单点点查识别】
只要用户询问了具体某根桩的信息（例如“A1桩的桩长”、“查007桩”），必须精准识别为 table_qa 并提取出纯净桩号（去除“桩”、“号”等字符，如 "A1"、"PHC-007"）！

【严格输出标准 JSON 格式】：
{
  "route": "table_qa" | "document_rag" | "table_qa_no_data",
  "confidence": 0.0 ~ 1.0,
  "reason": "你的深度语义分析与分流理由",
  "detected_pile": "若识别出具体桩号实体则填入纯净桩号（如'A1'、'PHC-007'），否则填 null",
  "detected_metric": "若识别出具体询问的指标（如'实际打入深度'、'停锤贯入度'）则填入，否则填 null"
}
`

  const routerUserPrompt = [
    `系统当前可用表格数量: ${params.availableDatasetsCount}`,
    params.selectedDatasetIds && params.selectedDatasetIds.length > 0
      ? `用户主动选定的表格 ID: ${params.selectedDatasetIds.join(", ")}`
      : "用户未指定特定表格",
    "",
    datasetDescriptions
      ? `【系统中已加载的施工表格资产】:\n${datasetDescriptions}`
      : "【系统当前无已加载表格】",
    "",
    `【用户提问】: "${question}"`,
    "",
    "请深入分析用户语义意图，输出分流决策 JSON：",
  ]
    .filter(Boolean)
    .join("\n")

  try {
    const fallbackDecision = heuristicFallback(params)
    const llmDecision = await generateAgentJson<LlmRoutingPayload>({
      system: routerSystemPrompt,
      prompt: routerUserPrompt,
      fallback: {
        route: fallbackDecision.route,
        confidence: fallbackDecision.confidence,
        reason: fallbackDecision.reason,
      },
      temperature: 0.0,
      signal: params.signal,
    })

    // Safety constraint: If LLM chose table_qa but availableDatasetsCount is 0, coerce to table_qa_no_data
    let finalRoute = llmDecision.route
    if (finalRoute === "table_qa" && params.availableDatasetsCount === 0) {
      finalRoute = "table_qa_no_data"
    }

    return {
      route: finalRoute,
      confidence: llmDecision.confidence ?? 0.95,
      reason: `[LLM语义路由] ${llmDecision.reason}`,
      suggested_dataset_ids: params.selectedDatasetIds,
      detected_pile: llmDecision.detected_pile || extractPileEntity(params.question),
      detected_metric: llmDecision.detected_metric,
    }
  } catch (error) {
    if (process.env.AGENT_VERBOSE_LOGS === "true") {
      console.warn("LLM router call failed, using heuristic fallback:", error)
    }
    return heuristicFallback(params)
  }
}
