import {
  fetchTableDatasets,
  fetchTableSchema,
  runTableSql,
} from "@/lib/agents/table-client"
import type {
  FinalAgentAnswer,
  TableDatasetDetail,
  TableDatasetSummary,
  TableQueryResult,
  TableToolTraceItem,
} from "@/lib/agents/types"
import { generateAgentJson, generateAgentText } from "@/lib/agents/llm-agent-client"

interface SqlPlanResult {
  thought: string
  sql: string
  dataset_id?: string
  sheet_id?: string
}

export async function runTableAnswerAgent(params: {
  question: string
  datasetIds?: string[]
  signal?: AbortSignal
}): Promise<FinalAgentAnswer> {
  const toolTrace: TableToolTraceItem[] = []

  let datasets: TableDatasetSummary[] = []
  try {
    datasets = await fetchTableDatasets({ signal: params.signal })
  } catch (error) {
    console.error("Fetch table datasets error:", error)
  }

  if (params.datasetIds && params.datasetIds.length > 0) {
    const filterSet = new Set(params.datasetIds)
    const filtered = datasets.filter((d) => filterSet.has(d.dataset_id))
    if (filtered.length > 0) {
      datasets = filtered
    }
  }

  if (datasets.length === 0) {
    return {
      final_answer: "当前系统中暂无已上传或关联的打桩记录表格。请先点击左下角“+”号上传 Excel 或 CSV 文件。",
      knowledge_anchor_summary: "未找到可用表格资产",
      engineering_reasoning: "未找到表格资产",
      suggested_workflow: ["上传打桩记录表格", "确认表格包含桩号、施工日期、锤击数等数据"],
      citations: [],
      missing_evidence: ["缺少打桩记录表格"],
      confidence: 0.9,
      rag_used: false,
      general_used: false,
      warning: "未上传表格资产",
      route: "table_qa",
      table_trace: toolTrace,
    }
  }

  toolTrace.push({
    tool_name: "list_datasets",
    arguments: { count: datasets.length },
    result_preview: datasets.map((d) => ({
      id: d.dataset_id,
      name: d.original_filename,
      rows: d.total_rows,
    })),
  })

  const schemas: TableDatasetDetail[] = []
  for (const dataset of datasets.slice(0, 3)) {
    try {
      const detail = await fetchTableSchema(dataset.dataset_id, { signal: params.signal })
      if (detail) {
        schemas.push(detail)
        toolTrace.push({
          tool_name: "get_dataset_schema",
          arguments: { dataset_id: dataset.dataset_id },
          result_preview: {
            filename: detail.original_filename,
            sheets: detail.sheets.map((s) => ({
              table_name: s.table_name,
              sheet_name: s.sheet_name,
              columns_count: s.columns.length,
            })),
          },
        })
      }
    } catch (err) {
      console.warn("Fetch schema error for", dataset.dataset_id, err)
    }
  }

  if (schemas.length === 0) {
    return {
      final_answer: "无法读取表格结构信息，请确认后端表格服务正常运行并重新上传表格。",
      knowledge_anchor_summary: "获取表格结构失败",
      engineering_reasoning: "",
      suggested_workflow: [],
      citations: [],
      missing_evidence: [],
      confidence: 0.2,
      rag_used: false,
      general_used: false,
      warning: "表格服务异常",
      route: "table_qa",
      table_trace: toolTrace,
    }
  }

  const schemaDescriptions = schemas
    .map((s) => {
      const sheetTexts = s.sheets.map((sheet) => {
        const colList = sheet.columns
          .map(
            (c) =>
              `    - ${c.sql_name}: 原始列名="${c.source_name}", 类型=${c.dtype}, 业务角色=${c.business_role || "普通字段"}, 单位=${c.unit || "无"}, 样例值=[${c.sample_values.slice(0, 3).join(", ")}]`,
          )
          .join("\n")
        return `  * 表名(table_name): "${sheet.table_name}" (Sheet: "${sheet.sheet_name}", 共 ${sheet.row_count} 行)\n  * 字段定义:\n${colList}`
      })
      return `【数据集】ID: "${s.dataset_id}", 文件名: "${s.original_filename}"\n${sheetTexts.join("\n\n")}`
    })
    .join("\n\n--------------------\n\n")

  const sqlSystemPrompt = `你是打桩工程表格只读 SQL 规划专家。
你的任务：根据用户问题和提供的 DuckDB 表格 Schema，生成一条精准、只读的 DuckDB SQL 查询语句。

严格规则：
1. 只能编写 SELECT 或 WITH 开头的只读查询，严禁编写修改/删除语句。
2. 表名必须使用 Schema 中给出的真实 table_name（如 "ds_xxx_s1"），字段名必须使用内部列名（如 col_1, col_2）。
3. 数值统计（如 AVG, SUM, MAX, MIN, 排序）需注意将文本列转换为数值，如 CAST(col_4 AS DOUBLE)。
4. 如果筛选非空值，使用 WHERE col_x IS NOT NULL AND TRIM(CAST(col_x AS VARCHAR)) != ''。
5. 结果必须以纯 JSON 格式输出：
{
  "thought": "你的分析与字段映射思路",
  "sql": "SELECT ... FROM ...",
  "dataset_id": "使用的 dataset_id"
}
`

  const sqlUserPrompt = `可用表格 Schema：\n${schemaDescriptions}\n\n用户问题：${params.question}\n\n请输出规划 JSON：`

  let sqlPlan: SqlPlanResult
  try {
    sqlPlan = await generateAgentJson<SqlPlanResult>({
      system: sqlSystemPrompt,
      prompt: sqlUserPrompt,
      fallback: {
        thought: "直接查询前20行记录",
        sql: `SELECT * FROM "${schemas[0].sheets[0]?.table_name || "table"}" LIMIT 20`,
        dataset_id: schemas[0].dataset_id,
      },
      temperature: 0.1,
      signal: params.signal,
    })
  } catch (err) {
    console.error("Generate SQL plan error:", err)
    sqlPlan = {
      thought: "默认预览查询",
      sql: `SELECT * FROM "${schemas[0].sheets[0]?.table_name || "table"}" LIMIT 20`,
      dataset_id: schemas[0].dataset_id,
    }
  }

  let queryResult: TableQueryResult | null = null
  let queryError = ""

  try {
    queryResult = await runTableSql(sqlPlan.sql, 200, { signal: params.signal })
    toolTrace.push({
      tool_name: "query_sheet_sql",
      arguments: { sql: sqlPlan.sql, thought: sqlPlan.thought },
      result_preview: {
        row_count: queryResult.row_count,
        columns: queryResult.columns,
        sample_rows: queryResult.rows.slice(0, 5),
      },
    })
  } catch (err) {
    queryError = err instanceof Error ? err.message : "SQL 执行异常"
    console.warn("SQL Query failed, attempting fallback query:", queryError)

    try {
      const fallbackSql = `SELECT * FROM "${schemas[0].sheets[0]?.table_name}" LIMIT 50`
      queryResult = await runTableSql(fallbackSql, 50, { signal: params.signal })
      toolTrace.push({
        tool_name: "query_sheet_sql_retry",
        arguments: { sql: fallbackSql, error: queryError },
        result_preview: {
          row_count: queryResult.row_count,
          columns: queryResult.columns,
          sample_rows: queryResult.rows.slice(0, 5),
        },
      })
    } catch {
      queryResult = null
    }
  }

  const synthesisSystemPrompt = `你是”九工天匠”打桩工程表格数据分析专家。
你的任务：基于实际执行的 SQL 查询结果和表格元数据，生成一篇严谨、客观、专业的数据分析回答。

必须遵守：
1. 严格基于提供的查询结果数据回答，严禁编造任何数字、桩号或日期。
2. 结构要求：
   第一部分【分析结论】：直接、清晰地给出用户所询问的统计指标、排序列表、汇总结果或异常桩明细；
   第二部分【计算依据】：说明查询使用的数据集名称、Sheet 表名、字段映射关系以及执行的计算逻辑。
3. 请只输出纯文本，不要使用 Markdown 语法（不要使用 **加粗**、# 标题、代码块），使用中文分点。
`

  const queryRowsJson = queryResult
    ? JSON.stringify(queryResult.rows.slice(0, 50), null, 2)
    : "查询失败，未获取到数据行。"

  const synthesisPrompt = [
    `用户问题：${params.question}`,
    "",
    `表格 Schema 映射：\n${schemaDescriptions}`,
    "",
    `执行的 SQL：${queryResult?.sql || sqlPlan.sql}`,
    `SQL 规划思路：${sqlPlan.thought}`,
    `查询返回行数：${queryResult?.row_count ?? 0}`,
    `数据结果：\n${queryRowsJson}`,
    queryError ? `执行提示：${queryError}` : "",
    "",
    "请生成最终纯文本回答：",
  ]
    .filter(Boolean)
    .join("\n")

  try {
    const finalAnswerText = await generateAgentText({
      system: synthesisSystemPrompt,
      prompt: synthesisPrompt,
      temperature: 0.1,
      signal: params.signal,
    })

    return {
      final_answer: finalAnswerText.trim(),
      knowledge_anchor_summary: `已完成打桩数据分析 (返回 ${queryResult?.row_count ?? 0} 条计算结果)`,
      engineering_reasoning: finalAnswerText.trim(),
      suggested_workflow: [],
      citations: schemas.map((s) => ({
        source: s.original_filename,
        relevance: `打桩施工记录表 (${s.total_rows} 行)`,
      })),
      missing_evidence: [],
      confidence: 0.95,
      rag_used: false,
      general_used: false,
      warning: queryError ? `SQL执行降级提示：${queryError}` : "",
      route: "table_qa",
      table_trace: toolTrace,
    }
  } catch (err) {
    console.error("Synthesize table answer error:", err)
    return {
      final_answer: `已完成表格数据查询（执行 SQL：${sqlPlan.sql}，返回 ${queryResult?.row_count ?? 0} 条记录），但在整合输出时遇到异常。`,
      knowledge_anchor_summary: "表格查询已执行",
      engineering_reasoning: sqlPlan.thought,
      suggested_workflow: [],
      citations: [],
      missing_evidence: [],
      confidence: 0.7,
      rag_used: false,
      general_used: false,
      warning: "结果渲染异常",
      route: "table_qa",
      table_trace: toolTrace,
    }
  }
}

