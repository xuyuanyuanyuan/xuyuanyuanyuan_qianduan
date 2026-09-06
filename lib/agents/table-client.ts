import type {
  TableDatasetDetail,
  TableDatasetSummary,
  TableQueryResult,
  TableSampleRowsResult,
} from "@/lib/agents/types"

const RAG_API_URL = process.env.RAG_API_URL ?? "http://127.0.0.1:3001"

export async function fetchTableDatasets(params?: {
  signal?: AbortSignal
}): Promise<TableDatasetSummary[]> {
  const url = `${RAG_API_URL.replace(/\/+$/, "")}/tables/datasets`
  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    signal: params?.signal,
    cache: "no-store",
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(`获取表格列表失败 (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  return Array.isArray(data.datasets) ? (data.datasets as TableDatasetSummary[]) : []
}

export async function fetchTableSchema(
  datasetId: string,
  params?: { signal?: AbortSignal },
): Promise<TableDatasetDetail | null> {
  const url = `${RAG_API_URL.replace(/\/+$/, "")}/tables/datasets/${encodeURIComponent(datasetId)}`
  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    signal: params?.signal,
    cache: "no-store",
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(`获取表格 Schema 失败 (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  return data.dataset as TableDatasetDetail
}

export async function runTableSql(
  sql: string,
  limit = 200,
  params?: { signal?: AbortSignal },
): Promise<TableQueryResult> {
  const url = `${RAG_API_URL.replace(/\/+$/, "")}/tables/query`
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, limit }),
    signal: params?.signal,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(`SQL 查询执行失败 (${response.status}): ${errorText}`)
  }

  return (await response.json()) as TableQueryResult
}

export async function previewTableSheet(
  datasetId: string,
  sheetId: string,
  limit = 20,
  params?: { signal?: AbortSignal },
): Promise<TableQueryResult> {
  const url = `${RAG_API_URL.replace(/\/+$/, "")}/tables/preview`
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_id: datasetId, sheet_id: sheetId, limit }),
    signal: params?.signal,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(`预览 Sheet 失败 (${response.status}): ${errorText}`)
  }

  return (await response.json()) as TableQueryResult
}

export async function deleteTableDataset(
  datasetId: string,
  params?: { signal?: AbortSignal },
): Promise<boolean> {
  const url = `${RAG_API_URL.replace(/\/+$/, "")}/tables/datasets/${encodeURIComponent(datasetId)}`
  const response = await fetch(url, {
    method: "DELETE",
    signal: params?.signal,
  })

  return response.ok
}

export async function fetchTableSampleRows(
  datasetId: string,
  sheetId?: string,
  limit = 5,
  params?: { signal?: AbortSignal },
): Promise<TableSampleRowsResult> {
  const query = new URLSearchParams({ limit: String(limit) })
  if (sheetId) query.set("sheet_id", sheetId)
  const url = `${RAG_API_URL.replace(/\/+$/, "")}/tables/datasets/${encodeURIComponent(datasetId)}/sample-rows?${query.toString()}`
  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    signal: params?.signal,
    cache: "no-store",
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(`获取样本数据失败 (${response.status}): ${errorText}`)
  }

  return (await response.json()) as TableSampleRowsResult
}

export async function updateTableColumns(
  datasetId: string,
  sheetId: string,
  columns: Array<{
    sql_name: string
    source_name?: string
    description?: string
    business_role?: string
    unit?: string
  }>,
  generalDescription?: string,
  params?: { signal?: AbortSignal },
): Promise<{ status: string; dataset: TableDatasetDetail }> {
  const url = `${RAG_API_URL.replace(/\/+$/, "")}/tables/datasets/${encodeURIComponent(datasetId)}/columns`
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sheet_id: sheetId,
      columns,
      general_description: generalDescription,
    }),
    signal: params?.signal,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(`更新列画像失败 (${response.status}): ${errorText}`)
  }

  return (await response.json()) as { status: string; dataset: TableDatasetDetail }
}

