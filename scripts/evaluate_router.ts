/**
 * Router Evaluation Benchmark (意图路由器完整性自动化评测脚本)
 *
 * 覆盖：
 * 1. 单点桩号查验 (单桩参数、各种口语与编号格式)
 * 2. 表格统计聚合 (平均值、极值排序、分组分布、异常排查)
 * 3. 规范条文与工程工法 (JGJ/GB规范、低应变/静载原理、病害缺陷机理)
 * 4. 无表格资产拦截 (table_qa_no_data)
 * 5. 实体提取准确率 (detected_pile, detected_metric)
 */

import { routeQuery } from "../lib/agents/query-router"
import type { QueryRoute, TableDatasetSummary } from "../lib/agents/types"

interface TestCase {
  id: number
  category: "单点点查" | "表格统计" | "规范与工艺RAG" | "无表格拦截"
  question: string
  availableDatasetsCount: number
  availableDatasets?: TableDatasetSummary[]
  expectedRoute: QueryRoute
  expectedPile?: string
  description: string
}

const MOCK_DATASET: TableDatasetSummary = {
  dataset_id: "ds_eval_001",
  original_filename: "2026年码头工程PHC管桩沉桩施工记录表.xlsx",
  description: "包含桩号、施工日期、设计桩长(m)、实际打入深度(m)、总锤击数(击)、停锤贯入度(mm/10击)、施工班组等字段的沉桩施工记录",
  created_at: new Date().toISOString(),
  sheet_count: 1,
  total_rows: 156,
}

const TEST_CASES: TestCase[] = [
  // 1. 单点点查 (必须命中 table_qa，且精准提取纯净桩号)
  {
    id: 1,
    category: "单点点查",
    question: "A1桩的桩长是多少？",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "table_qa",
    expectedPile: "A1",
    description: "最典型的单点桩长查询（此前曾报答错的问题提问）",
  },
  {
    id: 2,
    category: "单点点查",
    question: "PHC-007实际打入多深？",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "table_qa",
    expectedPile: "PHC-007",
    description: "带标准PHC前缀与横杠的桩号实际深度查询",
  },
  {
    id: 3,
    category: "单点点查",
    question: "查一下04号桩的贯入度是多少",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "table_qa",
    expectedPile: "04",
    description: "口语化查一下+号桩后缀+贯入度指标",
  },
  {
    id: 4,
    category: "单点点查",
    question: "帮我看下3#桩的总锤击数是多少击？",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "table_qa",
    expectedPile: "3",
    description: "#号命名风格的单点锤击数查询",
  },
  {
    id: 5,
    category: "单点点查",
    question: "看一下Z-12桩的设计桩长和施工班组",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "table_qa",
    expectedPile: "Z-12",
    description: "字母前缀桩号+多参数查验",
  },
  {
    id: 6,
    category: "单点点查",
    question: "试桩01的终压力是多少kN",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "table_qa",
    expectedPile: "01",
    description: "试桩前缀的静压终压力查询",
  },

  // 2. 表格统计聚合 (必须命中 table_qa)
  {
    id: 7,
    category: "表格统计",
    question: "所有桩的平均打入深度是多少米？",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "table_qa",
    description: "全表平均值指标聚合计算",
  },
  {
    id: 8,
    category: "表格统计",
    question: "今天一共打了多少根桩？",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "table_qa",
    description: "施工进度与完工总桩数汇总",
  },
  {
    id: 9,
    category: "表格统计",
    question: "统计一下各个施工班组完成的桩数分布",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "table_qa",
    description: "按施工班组 Group By 分组汇总",
  },
  {
    id: 10,
    category: "表格统计",
    question: "找出停锤贯入度大于25mm的异常桩",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "table_qa",
    description: "施工质量条件筛选与异常值过滤",
  },
  {
    id: 11,
    category: "表格统计",
    question: "实际打入深度最深的前5根桩是哪些？",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "table_qa",
    description: "极值排序与 Top 5 查询",
  },
  {
    id: 12,
    category: "表格统计",
    question: "有哪些桩出现了实际深度小于设计深度的欠深情况？",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "table_qa",
    description: "双字段列对比（欠深计算）排查",
  },
  {
    id: 13,
    category: "表格统计",
    question: "帮我汇总一下当前表格中的总锤击数总计和平均贯入度",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "table_qa",
    description: "多列统计汇总指标同时计算",
  },

  // 3. 规范与工艺 RAG (必须命中 document_rag)
  {
    id: 14,
    category: "规范与工艺RAG",
    question: "JGJ94-2008规范第6.3条关于锤击沉桩停锤控制标准的规定是什么？",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "document_rag",
    description: "精准命中 JGJ 规范条文（触发 Fast-Path 或 RAG）",
  },
  {
    id: 15,
    category: "规范与工艺RAG",
    question: "GB50202中关于先张法预应力管桩接桩焊接质量的检验要求",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "document_rag",
    description: "国标验收规范条款问答",
  },
  {
    id: 16,
    category: "规范与工艺RAG",
    question: "低应变反射波法检测桩身完整性的基本原理是什么？",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "document_rag",
    description: "桩基无损检测理论与工艺原理",
  },
  {
    id: 17,
    category: "规范与工艺RAG",
    question: "高应变动力试桩与静载试验在确定单桩极限承载力时的区别与优缺点",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "document_rag",
    description: "不同桩基检测工法对比分析",
  },
  {
    id: 18,
    category: "规范与工艺RAG",
    question: "钻孔灌注桩施工过程中发生断桩和夹泥的常见原因及预防措施",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "document_rag",
    description: "施工质量病害与缺陷成因机理",
  },
  {
    id: 19,
    category: "规范与工艺RAG",
    question: "规范里对管桩沉桩停锤贯入度有什么标准要求？",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "document_rag",
    description: "混淆测试：同时包含“规范”与“贯入度”，应识别为规范问答而非表格查数",
  },
  {
    id: 20,
    category: "规范与工艺RAG",
    question: "什么是预应力管桩的挤土效应？在群桩施工中如何防止挤土位移？",
    availableDatasetsCount: 1,
    availableDatasets: [MOCK_DATASET],
    expectedRoute: "document_rag",
    description: "地基基础理论与沉桩施工技术措施",
  },

  // 4. 无表格资产拦截 (必须命中 table_qa_no_data)
  {
    id: 21,
    category: "无表格拦截",
    question: "A1桩的桩长是多少？",
    availableDatasetsCount: 0,
    availableDatasets: [],
    expectedRoute: "table_qa_no_data",
    description: "单点桩长提问但系统无表格资产，必须分流至引导上传",
  },
  {
    id: 22,
    category: "无表格拦截",
    question: "统计当前打桩记录的平均打入深度",
    availableDatasetsCount: 0,
    availableDatasets: [],
    expectedRoute: "table_qa_no_data",
    description: "统计提问但系统无表格资产，引导上传",
  },
  {
    id: 23,
    category: "无表格拦截",
    question: "查一下PHC-005桩的停锤贯入度",
    availableDatasetsCount: 0,
    availableDatasets: [],
    expectedRoute: "table_qa_no_data",
    description: "带桩号具体查询但无表格资产",
  },
  {
    id: 24,
    category: "无表格拦截",
    question: "今天各个施工班组完成的桩数是多少根？",
    availableDatasetsCount: 0,
    availableDatasets: [],
    expectedRoute: "table_qa_no_data",
    description: "班组进度统计提问但无表格资产",
  },
]

async function runEvaluation() {
  console.log("==========================================================================")
  console.log("    九工天匠 · 大模型语义路由器 (Query Router) 完整性评测基准测试          ")
  console.log("==========================================================================")
  console.log(`总评测样本数: ${TEST_CASES.length}`)
  console.log("评测维度: [1. 路由分流准确率] [2. 单点实体提取准确率] [3. 无数据拦截完备性]\n")

  let passedCount = 0
  let entityCheckedCount = 0
  let entityPassedCount = 0
  const categoryStats: Record<string, { total: number; passed: number }> = {}

  const results: Array<{
    id: number
    category: string
    question: string
    expected: QueryRoute
    actual: QueryRoute
    status: "PASS" | "FAIL"
    confidence: number
    reason: string
    detectedPile?: string | null
    expectedPile?: string
  }> = []

  const startTime = Date.now()

  for (const tc of TEST_CASES) {
    if (!categoryStats[tc.category]) {
      categoryStats[tc.category] = { total: 0, passed: 0 }
    }
    categoryStats[tc.category].total += 1

    const res = await routeQuery({
      question: tc.question,
      availableDatasetsCount: tc.availableDatasetsCount,
      availableDatasets: tc.availableDatasets,
    })

    const isRouteMatch = res.route === tc.expectedRoute
    let isEntityMatch = true

    if (tc.expectedPile) {
      entityCheckedCount += 1
      const detected = (res.detected_pile || "").trim().toUpperCase()
      const expected = tc.expectedPile.trim().toUpperCase()
      isEntityMatch = detected === expected || detected.includes(expected)
      if (isEntityMatch) {
        entityPassedCount += 1
      }
    }

    const isPass = isRouteMatch && isEntityMatch
    if (isPass) {
      passedCount += 1
      categoryStats[tc.category].passed += 1
    }

    results.push({
      id: tc.id,
      category: tc.category,
      question: tc.question,
      expected: tc.expectedRoute,
      actual: res.route,
      status: isPass ? "PASS" : "FAIL",
      confidence: res.confidence,
      reason: res.reason,
      detectedPile: res.detected_pile,
      expectedPile: tc.expectedPile,
    })

    const icon = isPass ? "✅ [PASS]" : "❌ [FAIL]"
    console.log(
      `${icon} 用例 #${tc.id.toString().padStart(2, "0")} [${tc.category}] "${tc.question}"`,
    )
    console.log(`     预期: ${tc.expectedRoute} | 实际: ${res.route} (置信度: ${res.confidence})`)
    if (tc.expectedPile) {
      console.log(
        `     实体识别 -> 预期桩号: "${tc.expectedPile}" | 实际提取: "${res.detected_pile || "未提取"}"`,
      )
    }
    console.log(`     判定依据: ${res.reason}\n`)
  }

  const durationMs = Date.now() - startTime
  const overallAccuracy = ((passedCount / TEST_CASES.length) * 100).toFixed(1)
  const entityAccuracy =
    entityCheckedCount > 0
      ? ((entityPassedCount / entityCheckedCount) * 100).toFixed(1)
      : "100.0"

  console.log("==========================================================================")
  console.log("                           评测结果统计报告                                ")
  console.log("==========================================================================")
  console.log(`总耗时: ${(durationMs / 1000).toFixed(2)} 秒 (平均每题 ${(durationMs / TEST_CASES.length).toFixed(0)} ms)`)
  console.log(`综合准确率 (Overall Accuracy): ${passedCount} / ${TEST_CASES.length} (${overallAccuracy}%)`)
  console.log(`单点桩号实体提取准确率 (Entity Accuracy): ${entityPassedCount} / ${entityCheckedCount} (${entityAccuracy}%)\n`)

  console.log("各分类维度达标情况:")
  for (const [cat, stat] of Object.entries(categoryStats)) {
    const rate = ((stat.passed / stat.total) * 100).toFixed(1)
    const bar = "█".repeat(Math.round(stat.passed / stat.total * 10))
    console.log(`  - [${cat.padEnd(8, " ")}]: ${stat.passed}/${stat.total} (${rate}%) ${bar}`)
  }

  console.log("==========================================================================")
  if (passedCount === TEST_CASES.length) {
    console.log("🎉 全部 24 项评测用例 100% 满分通过！大模型语义路由器与实体识别已达到工业级稳定性。")
  } else {
    console.warn(`⚠️ 存在 ${TEST_CASES.length - passedCount} 项未通过用例，请检查上述详情。`)
  }
  console.log("==========================================================================")

  return {
    total: TEST_CASES.length,
    passed: passedCount,
    accuracy: overallAccuracy,
    entityAccuracy,
    results,
  }
}

runEvaluation().catch((err) => {
  console.error("Evaluation runtime failed:", err)
  process.exit(1)
})

