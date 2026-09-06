import { NextResponse } from "next/server"
import { updateTableColumns } from "@/lib/agents/table-client"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { dataset_id, sheet_id, columns, general_description } = body

    if (!dataset_id) {
      return NextResponse.json({ error: "缺少 dataset_id 参数" }, { status: 400 })
    }

    if (!Array.isArray(columns)) {
      return NextResponse.json({ error: "columns 必须为数组" }, { status: 400 })
    }

    const result = await updateTableColumns(
      dataset_id,
      sheet_id || "",
      columns,
      general_description,
    )

    return NextResponse.json(result)
  } catch (error) {
    console.error("Update table columns error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `保存字段描述失败：${error.message}`
            : "保存字段描述异常",
      },
      { status: 500 },
    )
  }
}
