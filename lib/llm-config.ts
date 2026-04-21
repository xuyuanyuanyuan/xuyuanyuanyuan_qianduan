export type LLMProvider = "mock" | "deepseek" | "openai_compatible"

type EnvSource = Record<string, string | undefined>

export interface LLMDefaultParameters {
  temperature?: number
  maxTokens?: number
  topP?: number
}

export interface ResolvedLLMConfig {
  mockMode: boolean
  provider: LLMProvider
  apiRoute: string
  apiKey: string
  baseURL?: string
  model: string
  timeoutMs: number
  defaultParameters: LLMDefaultParameters
}

export const CHAT_API_ROUTE = "/api/chat"
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat"
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"

export const DEFAULT_SYSTEM_PROMPT = `你是“九工天匠”桩基建造智能助手，专注于帮助用户解答各类工程技术问题。你的专业领域包括：
- 桩基工程检测与分析
- 混凝土裂缝诊断与处理
- 施工方案设计与优化
- 工程日报和进度管理
- 结构安全评估
- 建筑材料性能分析

请用专业但易懂的语言回答问题，必要时提供具体的技术参数和建议。回答应该结构清晰，条理分明。`

function readEnv(env: EnvSource, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim()
    if (value) {
      return value
    }
  }

  return undefined
}

function parseBoolean(value?: string): boolean | undefined {
  if (!value) return undefined

  const normalized = value.trim().toLowerCase()

  if (normalized === "true") return true
  if (normalized === "false") return false

  return undefined
}

function parseNumber(value?: string): number | undefined {
  if (!value) return undefined

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeProvider(value?: string): LLMProvider | undefined {
  if (!value) return undefined

  const normalized = value.trim().toLowerCase()

  if (
    normalized === "mock" ||
    normalized === "deepseek" ||
    normalized === "openai_compatible"
  ) {
    return normalized
  }

  return undefined
}

function getDefaultModel(provider: LLMProvider): string {
  return provider === "deepseek" ? DEFAULT_DEEPSEEK_MODEL : DEFAULT_OPENAI_MODEL
}

function getDefaultBaseURL(provider: LLMProvider): string | undefined {
  return provider === "deepseek" ? DEFAULT_DEEPSEEK_BASE_URL : undefined
}

export function resolveLLMConfig(env: EnvSource): ResolvedLLMConfig {
  const requestedProvider = normalizeProvider(readEnv(env, "LLM_PROVIDER"))
  const mockModeFromEnv = parseBoolean(env.MOCK_MODE)
  const apiKey = readEnv(env, "LLM_API_KEY", "OPENAI_API_KEY") ?? ""

  const provider =
    mockModeFromEnv === true || requestedProvider === "mock"
      ? "mock"
      : requestedProvider ?? (apiKey ? "openai_compatible" : "mock")

  const baseURL =
    provider === "mock"
      ? undefined
      : readEnv(env, "LLM_BASE_URL", "OPENAI_BASE_URL") ??
        getDefaultBaseURL(provider)

  const model =
    readEnv(env, "LLM_MODEL") ??
    (provider === "mock"
      ? getDefaultModel("openai_compatible")
      : getDefaultModel(provider))

  return {
    mockMode: provider === "mock",
    provider,
    apiRoute: CHAT_API_ROUTE,
    apiKey,
    baseURL,
    model,
    timeoutMs:
      parseNumber(readEnv(env, "LLM_TIMEOUT_MS")) ?? DEFAULT_REQUEST_TIMEOUT_MS,
    defaultParameters: {
      temperature: parseNumber(readEnv(env, "LLM_TEMPERATURE")),
      maxTokens: parseNumber(readEnv(env, "LLM_MAX_TOKENS")),
      topP: parseNumber(readEnv(env, "LLM_TOP_P")),
    },
  }
}

export function getLLMConfigError(config: ResolvedLLMConfig): string | null {
  if (config.mockMode) {
    return null
  }

  if (!config.apiKey) {
    return "LLM_API_KEY 未配置。请设置环境变量，或将 MOCK_MODE 设为 true。"
  }

  if (config.provider === "openai_compatible" && !config.model) {
    return "LLM_MODEL 未配置，无法调用 OpenAI 兼容接口。"
  }

  return null
}

export function getLLMConfigSummary(config: ResolvedLLMConfig) {
  return {
    mockMode: config.mockMode,
    provider: config.provider,
    apiRoute: config.apiRoute,
    baseURL: config.baseURL ?? "(official OpenAI)",
    model: config.model,
    timeoutMs: config.timeoutMs,
    hasApiKey: Boolean(config.apiKey),
    defaultParameters: config.defaultParameters,
  }
}
