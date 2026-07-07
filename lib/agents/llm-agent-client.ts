import "server-only"

import { generateText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"

import { getLLMConfigError, resolveLLMConfig } from "@/lib/llm-config"

// NOTE: this default (and the per-stage defaults below) is intentionally
// independent from LLM_MAX_TOKENS / llmConfig.defaultParameters.maxTokens.
// That value drives the plain /api/chat single-shot completion and is tuned
// much smaller (historically 1024). Reusing it here as a fallback silently
// capped every agent stage (knowledge/general/judge) far below what a long
// engineering answer needs, which was the root cause of mid-sentence
// truncation. Agent output length must only depend on AGENT_* env vars.
const DEFAULT_AGENT_MAX_OUTPUT_TOKENS = 8000
const DISABLED_LONG_ANSWER_MAX_TOKENS = 1400

export type AgentStage = "knowledge" | "general" | "judge"

const STAGE_ENV_KEYS: Record<AgentStage, string> = {
  knowledge: "AGENT_KNOWLEDGE_MAX_OUTPUT_TOKENS",
  general: "AGENT_GENERAL_MAX_OUTPUT_TOKENS",
  judge: "AGENT_JUDGE_MAX_OUTPUT_TOKENS",
}

const STAGE_DEFAULT_MAX_OUTPUT_TOKENS: Record<AgentStage, number> = {
  knowledge: 4000,
  general: 7000,
  judge: 8000,
}

function readPositiveInteger(value: string | number | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function readBoolean(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === "true") {
    return true
  }
  if (normalized === "false") {
    return false
  }
  return fallback
}

// Stage-specific budget precedence: AGENT_<STAGE>_MAX_OUTPUT_TOKENS ->
// AGENT_MAX_OUTPUT_TOKENS -> built-in stage default. The built-in defaults
// are already generous so Judge (the final synthesis step, most likely to
// run out of room) never silently falls back to a small number.
export function getStageMaxOutputTokens(stage: AgentStage): number {
  const globalFallback = readPositiveInteger(
    process.env.AGENT_MAX_OUTPUT_TOKENS,
    STAGE_DEFAULT_MAX_OUTPUT_TOKENS[stage],
  )
  return readPositiveInteger(process.env[STAGE_ENV_KEYS[stage]], globalFallback)
}

function resolveMaxOutputTokens(paramsMaxTokens: number | undefined) {
  const globalMaxTokens = readPositiveInteger(process.env.AGENT_MAX_OUTPUT_TOKENS, DEFAULT_AGENT_MAX_OUTPUT_TOKENS)
  const requestedMaxTokens = readPositiveInteger(paramsMaxTokens, globalMaxTokens)
  const longAnswerEnabled = readBoolean(process.env.AGENT_ENABLE_LONG_ANSWER, true)

  if (!longAnswerEnabled) {
    return Math.min(requestedMaxTokens, DISABLED_LONG_ANSWER_MAX_TOKENS)
  }

  return requestedMaxTokens
}

function extractJsonText(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    return fenced[1].trim()
  }

  const start = text.indexOf("{")
  if (start === -1) {
    return null
  }

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === "\\") {
      escaped = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) {
      continue
    }

    if (char === "{") {
      depth += 1
    } else if (char === "}") {
      depth -= 1
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  return null
}

export function parseAgentJson<T>(text: string): T | null {
  const jsonText = extractJsonText(text)
  if (!jsonText) {
    return null
  }

  try {
    return JSON.parse(jsonText) as T
  } catch {
    return null
  }
}

export async function generateAgentText(params: {
  system: string
  prompt: string
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}): Promise<string> {
  const llmConfig = resolveLLMConfig(process.env)

  if (llmConfig.mockMode) {
    throw new Error("Agent 模式需要可用的 LLM 配置，当前为 MOCK_MODE。")
  }

  const configError = getLLMConfigError(llmConfig)
  if (configError) {
    throw new Error(configError)
  }

  const openai = createOpenAI({
    apiKey: llmConfig.apiKey,
    ...(llmConfig.baseURL ? { baseURL: llmConfig.baseURL } : {}),
  })

  const model =
    llmConfig.provider === "deepseek"
      ? openai.chat(llmConfig.model)
      : openai(llmConfig.model)

  const result = await generateText({
    model,
    system: params.system,
    prompt: params.prompt,
    abortSignal: params.signal,
    temperature: params.temperature ?? llmConfig.defaultParameters.temperature ?? 0.2,
    maxOutputTokens: resolveMaxOutputTokens(params.maxTokens),
  })

  if (result.finishReason === "length") {
    console.warn(
      "Agent LLM output stopped due to maxOutputTokens limit (finishReason=length). " +
        "Consider raising AGENT_MAX_OUTPUT_TOKENS or the relevant AGENT_*_MAX_OUTPUT_TOKENS.",
    )
  }

  return result.text.trim()
}

export async function generateAgentJson<T>(params: {
  system: string
  prompt: string
  fallback: T
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}): Promise<T> {
  const text = await generateAgentText(params)
  return parseAgentJson<T>(text) ?? params.fallback
}
