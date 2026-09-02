import type { QueryRoute, QueryRoutingResult } from "@/lib/agents/types"

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
]

const TABLE_FIELD_KEYWORDS = [
  "桩号",
  "打桩记录",
  "施工记录",
  "停锤贯入度",
  "贯入度",
  "总锤击数",
  "锤击数",
  "阵击数",
  "终压力",
  "终压值",
  "入土深度",
  "设计桩长",
  "实际桩长",
  "桩顶标高",
  "桩底标高",
  "有效桩长",
  "施工班组",
  "机具编号",
  "设备编号",
  "完成桩数",
]

const DOCUMENT_SPEC_KEYWORDS = [
  "规范",
  "规程",
  "标准",
  "条文",
  "条款",
  "jgj",
  "gb",
  "jtg",
  "原理",
  "概念",
  "机理",
  "什么是",
  "怎么理解",
  "优缺点",
  "区别",
  "对比",
  "适用范围",
  "工艺流程",
  "检测方法",
  "注意事项",
  "声波透射",
  "钻芯",
  "静载试验",
  "低应变",
  "高应变",
  "水平荷载",
  "缺陷判断",
  "夹泥",
  "离析",
  "缩径",
  "断桩",
]

export function routeQuery(params: {
  question: string
  availableDatasetsCount: number
  selectedDatasetIds?: string[]
}): QueryRoutingResult {
  const normalized = params.question.trim().toLowerCase()

  const matchTableIntent = TABLE_INTENT_KEYWORDS.filter((keyword) =>
    normalized.includes(keyword.toLowerCase()),
  )
  const matchTableField = TABLE_FIELD_KEYWORDS.filter((keyword) =>
    normalized.includes(keyword.toLowerCase()),
  )
  const matchDocSpec = DOCUMENT_SPEC_KEYWORDS.filter((keyword) =>
    normalized.includes(keyword.toLowerCase()),
  )

  const hasTableIntent = matchTableIntent.length > 0
  const hasTableField = matchTableField.length > 0
  const hasDocSpec = matchDocSpec.length > 0
  const hasDatasets = params.availableDatasetsCount > 0

  if (params.selectedDatasetIds && params.selectedDatasetIds.length > 0 && (hasTableIntent || hasTableField)) {
    return {
      route: "table_qa",
      confidence: 0.95,
      reason: `用户已选定特定表格资产，且提问命中表格分析意图（${matchTableIntent.concat(matchTableField).join("、")}）。`,
      suggested_dataset_ids: params.selectedDatasetIds,
    }
  }

  if (hasTableIntent && (hasTableField || normalized.includes("桩") || normalized.includes("表"))) {
    if (hasDatasets) {
      return {
        route: "table_qa",
        confidence: 0.9,
        reason: `命中表格数据分析与字段查询意图（${matchTableIntent.concat(matchTableField).join("、")}），且当前存在可查询的表格资产。`,
      }
    }
    return {
      route: "table_qa_no_data",
      confidence: 0.85,
      reason: "提问属于表格施工数据统计与查询，但当前尚未上传或关联表格资产。",
    }
  }

  if (hasDocSpec && !hasTableIntent) {
    return {
      route: "document_rag",
      confidence: 0.9,
      reason: `提问命中规范条文、施工工艺、检测原理或理论概念（${matchDocSpec.join("、")}），路由至知识库 RAG 检索。`,
    }
  }

  if (hasDatasets && hasTableField && !hasDocSpec) {
    return {
      route: "table_qa",
      confidence: 0.8,
      reason: `提问包含打桩施工特定字段（${matchTableField.join("、")}），且存在表格资产。`,
    }
  }

  return {
    route: "document_rag",
    confidence: 0.7,
    reason: "未检测到明确的表格计算统计意图，默认采用工程知识库检索与通用工程推理。",
  }
}

