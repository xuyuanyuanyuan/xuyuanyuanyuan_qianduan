import { NextResponse } from "next/server"

const RAG_API_URL = process.env.RAG_API_URL ?? "http://127.0.0.1:3001"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const targetUrl = `${RAG_API_URL.replace(/\/+$/, "")}/tables/datasets/${encodeURIComponent(id)}`
    const response = await fetch(targetUrl, {
      method: "GET",
      cache: "no-store",
    })

    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json(
        { error: `获取表格详情失败 (${response.status}): ${errorText}` },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("Get table dataset detail error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `获取表格详情异常：${error.message}`
            : "获取表格详情服务异常",
      },
      { status: 500 },
    )
  }
}

