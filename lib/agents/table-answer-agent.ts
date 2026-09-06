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
      final_answer: "当前系统中暂无已上传或关联的打桩记录表格。请先点击左侧“+ 上传工程表格”或输入框左侧“+”号上传 Excel 或 CSV 文件。",
      knowledge_anchor_summary: "未找到可用表格资产",
      engineering_reasoning: "未找到表格资产",
      suggested_workflow: ["上传打桩记录表格", "确认表格包含桩号、施工日期、桩长、深度等数据"],
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
            description: detail.description,
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

  // Build schema descriptions including column descriptions and business roles
  const schemaDescriptions = schemas
    .map((s) => {
      const sheetTexts = s.sheets.map((sheet) => {
        const colList = sheet.columns
          .map((c) => {
            const descPart = c.description ? `, 字段描述="${c.description}"` : ""
            return `    - ${c.sql_name}: 原始列名="${c.source_name}", 业务角色="${c.business_role || "普通字段"}", 类型=${c.dtype}, 单位="${c.unit || "无"}"${descPart}, 样例值=[${c.sample_values.slice(0, 3).join(", ")}]`
          })
          .join("\n")
        return `  * 表名(table_name): "${sheet.table_name}" (工作表: "${sheet.sheet_name}", 共 ${sheet.row_count} 行)\n  * 字段画像与定义:\n${colList}`
      })
      return `【表格资产】ID: "${s.dataset_id}", 文件名: "${s.original_filename}"\n【整体说明】: ${s.description || "打桩施工记录数据表"}\n${sheetTexts.join("\n\n")}`
    })
    .join("\n\n--------------------\n\n")

  // SQL Planning Prompt with single-point query hardening
  const sqlSystemPrompt = `你是中船九院“九工天匠”打桩工程表格只读 SQL 规划专家。
你的任务：根据用户问题和提供的 DuckDB 表格 Schema，生成一条精准、只读的 DuckDB SQL 查询语句。

严格执行以下规划准则：
1. 只能编写 SELECT 或 WITH 开头的只读查询，严禁编写 INSERT/UPDATE/DELETE/DROP 等修改语句。
2. 表名必须使用 Schema 中给出的真实 table_name（如 "ds_xxx_s1"），字段名必须使用内部规范列名（如 col_1, col_2）。

3. 【关键：单点桩号查询（如"A1桩的桩长是多少"、"PHC-007打入多深"、"查某桩"）】:
   - 提取纯净的核心桩号（去掉中文“桩”、“号”后缀以及多余空格）。例如：“A1桩”提取为“A1”，“PHC-007桩”提取为“PHC-007”。
   - 在 DuckDB WHERE 条件中，**必须使用大小写不敏感或去横杠/空格模糊包含匹配**，防止用户输入与表格记录有微小格式差异：
     例如：WHERE UPPER(REPLACE(CAST(col_1 AS VARCHAR), ' ', '')) LIKE UPPER('%A1%')
     或者：WHERE UPPER(CAST(col_1 AS VARCHAR)) = UPPER('PHC-007') OR UPPER(REPLACE(CAST(col_1 AS VARCHAR), '-', '')) LIKE UPPER('%PHC007%')
   - 查询字段：单点查询必须同时查询【桩号列】以及【用户询问的指标列】（如设计桩长、实际打入深度、贯入度、锤击数等），推荐使用 SELECT * 或包含目标字段，并加上 LIMIT 10。

4. 【统计汇总与极值查询】:
   - 数值统计（如 AVG, SUM, MAX, MIN, 排序）需注意将文本列显式转换为数值：CAST(col_x AS DOUBLE)。
   - 排除空值与空白文本：WHERE col_x IS NOT NULL AND TRIM(CAST(col_x AS VARCHAR)) != ''。
   - 分组统计时使用 GROUP BY col_x，排序时加上 LIMIT。

5. 结果必须以严格纯 JSON 格式输出：
{
  "thought": "你的分析思路，特别指出识别出的桩号实体或统计指标与字段映射",
  "sql": "SELECT ... FROM ...",
  "dataset_id": "使用的 dataset_id"
}
`

  const sqlUserPrompt = `可用表格 Schema 与字段定义：\n${schemaDescriptions}\n\n用户问题：${params.question}\n\n请输出规划 JSON：`

  let sqlPlan: SqlPlanResult
  try {
    sqlPlan = await generateAgentJson<SqlPlanResult>({
      system: sqlSystemPrompt,
      prompt: sqlUserPrompt,
      fallback: {
        thought: "查询前20行数据记录",
        sql: `SELECT * FROM "${schemas[0].sheets[0]?.table_name || "table"}" LIMIT 20`,
        dataset_id: schemas[0].dataset_id,
      },
      temperature: 0.1,
      signal: params.signal,
    })
  } catch (err) {
    console.error("Generate SQL plan error:", err)
    sqlPlan = {
      thought: "默认查询",
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

  // =========================================================================
  // ZERO-ROW HARD GUARDRAIL (零行硬拦截防线：彻底杜绝单点查询查无此桩时胡编假数字)
  // =========================================================================
  if (queryResult && queryResult.row_count === 0) {
    // Check if the query had a WHERE clause filtering by pile or specific value
    const isFilteredQuery = /WHERE\s+/i.test(sqlPlan.sql)

    let samplePiles: string[] = []
    try {
      // Fetch actual pile samples from the table
      const samplePilesRes = await runTableSql(
        `SELECT DISTINCT col_1 FROM "${schemas[0].sheets[0]?.table_name}" WHERE col_1 IS NOT NULL AND TRIM(CAST(col_1 AS VARCHAR)) != '' LIMIT 8`,
        8,
        { signal: params.signal },
      )
      samplePiles = samplePilesRes.rows
        .map((r) => String(r.col_1 || ""))
        .filter(Boolean)
    } catch {
      samplePiles = []
    }

    const pileListText =
      samplePiles.length > 0
        ? `当前表格中包含的部分参考桩号为：【${samplePiles.join("、")}】`
        : "当前表格可能为空或未包含相关构件编号"

    const explanation = isFilteredQuery
      ? `【查询结果】在当前表格【${schemas[0].original_filename}】中未检索到符合条件的施工记录。\n\n【排查说明】\n1. 执行的筛选语句未匹配到任何数据行（查询返回 0 条记录）；\n2. ${pileListText}；\n3. 请核对您输入的桩号名称（大小写、编号前缀、横杠）是否与表格一致。`
      : `【查询结果】当前表格【${schemas[0].original_filename}】中未检索到有效数据记录。`

    return {
      final_answer: explanation,
      knowledge_anchor_summary: "未检索到匹配的记录 (0行数据)",
      engineering_reasoning: `SQL 查询：${sqlPlan.sql}，返回 0 行。触发零行硬拦截防线，坚决报错/提醒，严禁模型凭空捏造数值。`,
      suggested_workflow: ["核对桩号或筛选条件拼写", "检查已上传表格的数据范围"],
      citations: schemas.map((s) => ({
        source: s.original_filename,
        relevance: `打桩施工记录表 (${s.total_rows} 行)`,
      })),
      missing_evidence: ["未在表格中找到匹配的目标记录"],
      confidence: 0.95,
      rag_used: false,
      general_used: false,
      warning: "未匹配到数据行",
      route: "table_qa",
      table_trace: toolTrace,
    }
  }

  // =========================================================================
  // Synthesis of Non-Empty Results (严格基于真实行数据)
  // =========================================================================
  const synthesisSystemPrompt = `你是中船九院“九工天匠”打桩工程表格数据分析专家。
你的任务：基于实际执行的 SQL 查询结果和表格元数据，生成一篇严谨、客观、专业的数据分析回答。

必须绝对遵守：
1. 真实数据铁律：严格基于提供的 SQL 查询结果数据回答，严禁编造或推测任何数字、桩号或日期！
2. 单点桩号查询：
   - 必须精确提取该桩对应的各项指标（如设计桩长、实际打入深度、贯入度、锤击数、施工日期、班组等真实数值）。
   - 如果用户询问深度，若有设计桩长与实际打入深度，应一并对比说明是否达到设计深度。
3. 结构要求：
   第一部分【分析结论】：直接、清晰地给出用户所询问的数值、排序列表、汇总统计或单桩详细指标；
   第二部分【计算依据】：说明查询使用的数据集名称、Sheet 表名、字段映射关系以及执行的计算/匹配逻辑。
4. 请只输出纯文本，不要使用 Markdown 语法（不要使用 **加粗**、# 标题、代码块），使用中文分点。
`

  const queryRowsJson = queryResult
    ? JSON.stringify(queryResult.rows.slice(0, 50), null, 2)
    : "查询失败，未获取到数据行。"

  const synthesisPrompt = [
    `用户问题：${params.question}`,
    "",
    `表格 Schema 映射与字段定义：\n${schemaDescriptions}`,
    "",
    `执行的 SQL：${queryResult?.sql || sqlPlan.sql}`,
    `SQL 规划思路：${sqlPlan.thought}`,
    `查询返回行数：${queryResult?.row_count ?? 0}`,
    `真实查询数据结果：\n${queryRowsJson}`,
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
