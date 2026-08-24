import { NextResponse } from "next/server"

const RAG_API_URL = process.env.RAG_API_URL ?? "http://127.0.0.1:3001"

export async function GET() {
  try {
    const targetUrl = `${RAG_API_URL.replace(/\/+$/, "")}/tables/datasets`
    const response = await fetch(targetUrl, {
      method: "GET",
      cache: "no-store",
    })

    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json(
        { error: `获取表格列表失败 (${response.status}): ${errorText}` },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("List table datasets error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `获取表格资产异常：${error.message}`
            : "获取表格资产服务异常",
      },
      { status: 500 },
    )
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const datasetId = searchParams.get("id")

    if (!datasetId) {
      return NextResponse.json(
        { error: "缺少要删除的 dataset ID 参数。" },
        { status: 400 },
      )
    }

    const targetUrl = `${RAG_API_URL.replace(/\/+$/, "")}/tables/datasets/${encodeURIComponent(datasetId)}`
    const response = await fetch(targetUrl, {
      method: "DELETE",
    })

    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json(
        { error: `删除表格资产失败 (${response.status}): ${errorText}` },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("Delete table dataset error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `删除表格资产异常：${error.message}`
            : "删除表格资产服务异常",
      },
      { status: 500 },
    )
  }
}

