import { NextResponse } from "next/server"

const RAG_API_URL = process.env.RAG_API_URL ?? "http://127.0.0.1:3001"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const sheetId = searchParams.get("sheet_id") || ""
    const limit = searchParams.get("limit") || "5"

    const query = new URLSearchParams({ limit })
    if (sheetId) query.set("sheet_id", sheetId)

    const targetUrl = `${RAG_API_URL.replace(/\/+$/, "")}/tables/datasets/${encodeURIComponent(id)}/sample-rows?${query.toString()}`
    const response = await fetch(targetUrl, {
      method: "GET",
      cache: "no-store",
    })

    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json(
        { error: `获取样本数据失败 (${response.status}): ${errorText}` },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("Get sample rows error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `获取样本数据异常：${error.message}`
            : "获取样本数据服务异常",
      },
      { status: 500 },
    )
  }
}

