import { NextResponse } from "next/server"

const RAG_API_URL = process.env.RAG_API_URL ?? "http://127.0.0.1:3001"

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get("file")

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "请上传有效的 Excel 或 CSV 文件。" },
        { status: 400 },
      )
    }

    const targetUrl = `${RAG_API_URL.replace(/\/+$/, "")}/tables/upload`
    const backendFormData = new FormData()
    backendFormData.append("file", file, (file as File).name || "table.xlsx")

    const description = formData.get("description")
    if (typeof description === "string") {
      backendFormData.append("description", description)
    }

    const projectName = formData.get("project_name")
    if (typeof projectName === "string") {
      backendFormData.append("project_name", projectName)
    }

    const response = await fetch(targetUrl, {
      method: "POST",
      body: backendFormData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json(
        { error: `后端服务入库失败 (${response.status}): ${errorText}` },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("Table upload proxy error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `表格上传异常：${error.message}`
            : "表格上传服务异常，请稍后重试。",
      },
      { status: 500 },
    )
  }
}

