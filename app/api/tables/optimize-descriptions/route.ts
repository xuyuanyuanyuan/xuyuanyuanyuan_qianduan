import { NextResponse } from "next/server"
import { fetchTableSchema, fetchTableSampleRows } from "@/lib/agents/table-client"
import { generateAgentJson } from "@/lib/agents/llm-agent-client"

interface OptimizeColumnsResult {
  general_description: string
  columns: Array<{
    sql_name: string
    source_name: string
    business_role: string
    unit: string
    description: string
  }>
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { dataset_id, sheet_id, user_hints, general_hint } = body

    if (!dataset_id) {
      return NextResponse.json({ error: "缺少 dataset_id 参数" }, { status: 400 })
    }

    const schema = await fetchTableSchema(dataset_id)
    if (!schema || !schema.sheets || schema.sheets.length === 0) {
      return NextResponse.json({ error: "未找到该表格的结构信息" }, { status: 404 })
    }

    const targetSheet = sheet_id
      ? schema.sheets.find((s) => s.sheet_id === sheet_id) || schema.sheets[0]
      : schema.sheets[0]

    // Fetch sample 3~5 rows of real data
    let sampleRows: Record<string, unknown>[] = []
    try {
      const sampleRes = await fetchTableSampleRows(dataset_id, targetSheet.sheet_id, 5)
      if (Array.isArray(sampleRes.rows)) {
        sampleRows = sampleRes.rows
      }
    } catch (err) {
      console.warn("Fetch sample rows failed, continuing with column definitions:", err)
    }

    const userHintsMap: Record<string, string> = user_hints || {}

    const columnsContext = targetSheet.columns.map((c) => ({
      sql_name: c.sql_name,
      source_name: c.source_name,
      dtype: c.dtype,
      current_role: c.business_role || "未识别",
      current_unit: c.unit || "无",
      user_hint: userHintsMap[c.sql_name] || userHintsMap[c.source_name] || "",
      sample_values: c.sample_values.slice(0, 3),
    }))

    const systemPrompt = `你是中船九院“九工天匠”打桩工程数据与结构画像专家。
你的任务：根据提供的打桩施工记录表格结构、小几行真实数据样本以及工程师填写的初步提示，为该表格的每一个字段生成专业、精准且易于大模型做 SQL 查询的字段画像（包括业务角色、物理单位以及清晰的中文描述）。

必须遵守：
1. 真实数据结合：深入观察提供的前几行真实数据（如桩号命名规律 PHC-xxx、贯入度数值范围、锤击数规律），据此推断最准确的工程含义与单位。
2. 尊重用户输入：如果工程师输入了字段提示（user_hint）或整体背景（general_hint），将其作为核心背景输入并在此基础上进行工程专业化完善和润色。
3. 业务角色 (business_role) 尽量使用标准打桩工程术语，如：桩号、施工日期、桩型、设计桩长、实际打入深度、总锤击数、停锤贯入度、终压力/终压值、标高、桩位偏位、施工班组、机具编号、地层信息等。
4. 单位 (unit) 需结合数据量纲，如：m, mm, mm/10击, kN, 击, 根, 或 "无"。
5. 字段描述 (description) 必须具体、清晰，说明字段的工程用途，例如：“实际沉桩入土深度，单位米。用于与设计桩长对比判断是否欠深或超深”。
6. 输出必须为标准 JSON 格式：
{
  "general_description": "润色后的表格整体工程背景说明",
  "columns": [
    {
      "sql_name": "col_1",
      "source_name": "原始列名",
      "business_role": "标准业务角色",
      "unit": "工程单位",
      "description": "专业字段描述"
    }
  ]
}
`

    const userPrompt = [
      `表格文件名: "${schema.original_filename}"`,
      `工作表名: "${targetSheet.sheet_name}" (共 ${targetSheet.row_count} 行)`,
      general_hint ? `工程师补充的全局背景说明: "${general_hint}"` : "",
      "",
      "【字段定义与工程师初步提示】:",
      JSON.stringify(columnsContext, null, 2),
      "",
      "【小几行真实数据样本（供观察具体数值特征）】:",
      JSON.stringify(sampleRows.slice(0, 5), null, 2),
      "",
      "请输出润色与优化后的 JSON：",
    ]
      .filter(Boolean)
      .join("\n")

    const fallback: OptimizeColumnsResult = {
      general_description: general_hint || schema.description,
      columns: targetSheet.columns.map((c) => ({
        sql_name: c.sql_name,
        source_name: c.source_name,
        business_role: c.business_role || "普通数据项",
        unit: c.unit || "无",
        description:
          userHintsMap[c.sql_name] ||
          userHintsMap[c.source_name] ||
          `${c.source_name}，打桩施工记录字段`,
      })),
    }

    const optimized = await generateAgentJson<OptimizeColumnsResult>({
      system: systemPrompt,
      prompt: userPrompt,
      fallback,
      temperature: 0.1,
    })

    return NextResponse.json({
      status: "ok",
      general_description: optimized.general_description,
      columns: optimized.columns,
      sample_rows: sampleRows,
    })
  } catch (error) {
    console.error("Optimize table descriptions error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `AI 优化字段描述失败：${error.message}`
            : "AI 优化字段描述异常",
      },
      { status: 500 },
    )
  }
}
