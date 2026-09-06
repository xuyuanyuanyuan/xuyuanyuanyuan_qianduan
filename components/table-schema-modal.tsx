"use client"

import { useState, useEffect, useCallback } from "react"
import { Sparkles, Loader2, X, Check, Eye, Table as TableIcon, Info } from "lucide-react"
import type { TableDatasetDetail, TableColumnProfile } from "@/lib/agents/types"

interface TableSchemaModalProps {
  isOpen: boolean
  onClose: () => void
  datasetId: string | null
  onSaved?: (updated: TableDatasetDetail) => void
}

export function TableSchemaModal({
  isOpen,
  onClose,
  datasetId,
  onSaved,
}: TableSchemaModalProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [datasetDetail, setDatasetDetail] = useState<TableDatasetDetail | null>(null)
  const [sampleRows, setSampleRows] = useState<Record<string, unknown>[]>([])
  const [generalHint, setGeneralHint] = useState("")
  const [columnDescriptions, setColumnDescriptions] = useState<Record<string, string>>({})
  const [columnRoles, setColumnRoles] = useState<Record<string, string>>({})
  const [columnUnits, setColumnUnits] = useState<Record<string, string>>({})
  const [showSampleRows, setShowSampleRows] = useState(true)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const loadData = useCallback(async (id: string) => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/tables/datasets/${encodeURIComponent(id)}`)
      if (res.ok) {
        const data = await res.json()
        const detail: TableDatasetDetail = data.dataset
        setDatasetDetail(detail)
        setGeneralHint(detail.description || "")

        const descMap: Record<string, string> = {}
        const roleMap: Record<string, string> = {}
        const unitMap: Record<string, string> = {}

        const firstSheet = detail.sheets[0]
        if (firstSheet) {
          firstSheet.columns.forEach((col: TableColumnProfile) => {
            descMap[col.sql_name] = col.description || ""
            roleMap[col.sql_name] = col.business_role || ""
            unitMap[col.sql_name] = col.unit || ""
          })
        }
        setColumnDescriptions(descMap)
        setColumnRoles(roleMap)
        setColumnUnits(unitMap)

        if (firstSheet) {
          const sampleRes = await fetch(
            `/api/tables/datasets/${encodeURIComponent(id)}/sample-rows?sheet_id=${encodeURIComponent(firstSheet.sheet_id)}&limit=5`,
          )
          if (sampleRes.ok) {
            const sampleData = await sampleRes.json()
            if (Array.isArray(sampleData.rows)) {
              setSampleRows(sampleData.rows)
            }
          }
        }
      }
    } catch (err) {
      console.error("Load dataset schema error:", err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen && datasetId) {
      loadData(datasetId)
    } else {
      setDatasetDetail(null)
      setSampleRows([])
      setToastMessage(null)
    }
  }, [isOpen, datasetId, loadData])

  if (!isOpen || !datasetId) return null

  const targetSheet = datasetDetail?.sheets[0]

  const handleOptimizeWithLLM = async () => {
    if (!datasetDetail || !targetSheet) return
    setIsOptimizing(true)
    setToastMessage("AI 正在分析前几行真实样本并深度理解字段含义...")

    try {
      const res = await fetch("/api/tables/optimize-descriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_id: datasetDetail.dataset_id,
          sheet_id: targetSheet.sheet_id,
          general_hint: generalHint,
          user_hints: columnDescriptions,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `优化失败 (${res.status})`)
      }

      const data = await res.json()
      if (data.general_description) {
        setGeneralHint(data.general_description)
      }

      if (Array.isArray(data.columns)) {
        const newDescMap = { ...columnDescriptions }
        const newRoleMap = { ...columnRoles }
        const newUnitMap = { ...columnUnits }

        data.columns.forEach(
          (c: { sql_name: string; description: string; business_role: string; unit: string }) => {
            if (c.sql_name) {
              newDescMap[c.sql_name] = c.description
              if (c.business_role) newRoleMap[c.sql_name] = c.business_role
              if (c.unit) newUnitMap[c.sql_name] = c.unit
            }
          },
        )

        setColumnDescriptions(newDescMap)
        setColumnRoles(newRoleMap)
        setColumnUnits(newUnitMap)
      }

      if (Array.isArray(data.sample_rows) && data.sample_rows.length > 0) {
        setSampleRows(data.sample_rows)
      }

      setToastMessage("✨ AI 字段描述优化完成！请核对下方生成的字段含义。")
      setTimeout(() => setToastMessage(null), 4000)
    } catch (err) {
      console.error("AI optimize error:", err)
      setToastMessage(`优化失败: ${err instanceof Error ? err.message : "未知异常"}`)
      setTimeout(() => setToastMessage(null), 4000)
    } finally {
      setIsOptimizing(false)
    }
  }

  const handleSave = async () => {
    if (!datasetDetail || !targetSheet) return
    setIsSaving(true)
    try {
      const columnUpdates = targetSheet.columns.map((c) => ({
        sql_name: c.sql_name,
        source_name: c.source_name,
        description: columnDescriptions[c.sql_name] || "",
        business_role: columnRoles[c.sql_name] || c.business_role || "",
        unit: columnUnits[c.sql_name] || c.unit || "",
      }))

      const res = await fetch("/api/tables/columns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_id: datasetDetail.dataset_id,
          sheet_id: targetSheet.sheet_id,
          columns: columnUpdates,
          general_description: generalHint,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `保存失败 (${res.status})`)
      }

      const result = await res.json()
      if (result.dataset && onSaved) {
        onSaved(result.dataset)
      }
      onClose()
    } catch (err) {
      console.error("Save columns error:", err)
      setToastMessage(`保存失败: ${err instanceof Error ? err.message : "未知异常"}`)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-card text-card-foreground border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <TableIcon size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">
                工程数据表格画像与字段定义
              </h2>
              <p className="text-xs text-muted-foreground">
                {datasetDetail ? datasetDetail.original_filename : "正在载入表格元数据..."}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <Loader2 className="animate-spin text-primary" size={32} />
              <p className="text-sm">正在加载表格结构与字段信息...</p>
            </div>
          ) : !datasetDetail || !targetSheet ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              未找到表格详情，请重试或检查后台服务状态。
            </div>
          ) : (
            <>
              {/* Engineering Context & AI Optimize Row */}
              <div className="p-4 rounded-xl bg-accent/30 border border-accent/40 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <Info size={14} className="text-primary" />
                    表格工程背景说明（作为大模型精准理解施工数据的上下文背景）：
                  </label>
                  <button
                    type="button"
                    onClick={handleOptimizeWithLLM}
                    disabled={isOptimizing}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    {isOptimizing ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Sparkles size={13} />
                    )}
                    {isOptimizing ? "大模型正在观察数据与优化..." : "✨ AI 智能优化字段描述"}
                  </button>
                </div>
                <input
                  type="text"
                  value={generalHint}
                  onChange={(e) => setGeneralHint(e.target.value)}
                  placeholder="例如：宁波舟山港某重力式码头 PHC 管桩试打桩记录，包含桩长、入土深度与停锤贯入度"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-input bg-background text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
                />
                <p className="text-[11px] text-muted-foreground">
                  💡 提示：点击“AI 智能优化字段描述”会结合真实数据样本与上方说明，自动为每个字段推断最精准的工程角色、量纲单位和自然语言描述。
                </p>
              </div>

              {/* Real Sample Rows Preview Section */}
              {sampleRows.length > 0 && (
                <div className="border border-border rounded-xl overflow-hidden bg-card">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-muted/50 border-b border-border">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">
                        真实前几行数据透视 (前 {sampleRows.length} 行)
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono">
                        {targetSheet.sheet_name} · 共 {targetSheet.row_count} 行
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowSampleRows(!showSampleRows)}
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Eye size={12} />
                      {showSampleRows ? "折叠预览" : "展开预览"}
                    </button>
                  </div>
                  {showSampleRows && (
                    <div className="overflow-x-auto max-h-48">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-muted/80 border-b border-border">
                            {targetSheet.columns.map((c) => (
                              <th
                                key={c.sql_name}
                                className="px-3 py-2 font-medium text-muted-foreground whitespace-nowrap text-[11px]"
                              >
                                {c.source_name}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {sampleRows.map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-muted/30">
                              {targetSheet.columns.map((c) => (
                                <td
                                  key={c.sql_name}
                                  className="px-3 py-1.5 font-mono text-[11px] text-foreground/90 whitespace-nowrap"
                                >
                                  {row[c.sql_name] !== undefined && row[c.sql_name] !== null
                                    ? String(row[c.sql_name])
                                    : "-"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Column Descriptions List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    表格字段列表 ({targetSheet.columns.length} 个字段)
                  </h3>
                  <span className="text-[11px] text-muted-foreground">
                    支持手动编辑或输入简写提示后点击 AI 优化
                  </span>
                </div>

                <div className="space-y-2.5">
                  {targetSheet.columns.map((col) => (
                    <div
                      key={col.sql_name}
                      className="p-3.5 rounded-xl border border-border bg-card hover:border-border/80 transition-colors space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground">
                            {col.source_name}
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {col.sql_name}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-accent-foreground">
                            {col.dtype}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1 text-[11px]">
                            <span className="text-muted-foreground">单位:</span>
                            <input
                              type="text"
                              value={columnUnits[col.sql_name] || ""}
                              onChange={(e) =>
                                setColumnUnits({
                                  ...columnUnits,
                                  [col.sql_name]: e.target.value,
                                })
                              }
                              placeholder="m/mm/击/无"
                              className="w-20 px-2 py-0.5 text-xs rounded border border-input bg-background font-mono focus:outline-hidden"
                            />
                          </div>
                          <div className="flex items-center gap-1 text-[11px]">
                            <span className="text-muted-foreground">角色:</span>
                            <input
                              type="text"
                              value={columnRoles[col.sql_name] || ""}
                              onChange={(e) =>
                                setColumnRoles({
                                  ...columnRoles,
                                  [col.sql_name]: e.target.value,
                                })
                              }
                              placeholder="桩号/实际打入深度..."
                              className="w-28 px-2 py-0.5 text-xs rounded border border-input bg-background focus:outline-hidden"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Column Description input */}
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={columnDescriptions[col.sql_name] || ""}
                          onChange={(e) =>
                            setColumnDescriptions({
                              ...columnDescriptions,
                              [col.sql_name]: e.target.value,
                            })
                          }
                          placeholder={`填写“${col.source_name}”的业务含义，或输入初步提示交由大模型优化...`}
                          className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-input bg-background text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
                        />
                      </div>

                      {/* Sample values preview */}
                      {col.sample_values && col.sample_values.length > 0 && (
                        <div className="flex items-center gap-1.5 overflow-hidden text-[10px] text-muted-foreground">
                          <span>样本值:</span>
                          <div className="flex items-center gap-1 overflow-x-auto py-0.5">
                            {col.sample_values.slice(0, 4).map((val, idx) => (
                              <span
                                key={idx}
                                className="font-mono px-1.5 py-0.5 rounded bg-muted/60 text-foreground/80 whitespace-nowrap"
                              >
                                {val}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Toast alert message */}
        {toastMessage && (
          <div className="px-6 py-2 bg-primary/10 border-t border-primary/20 text-primary text-xs flex items-center justify-between">
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-muted/20">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isLoading || !datasetDetail}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
          >
            {isSaving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}
            {isSaving ? "正在保存..." : "确认并保存字段画像"}
          </button>
        </div>
      </div>
    </div>
  )
}
