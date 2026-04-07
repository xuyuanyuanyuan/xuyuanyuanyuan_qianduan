/**
 * ============================================================
 * API CONFIGURATION FILE
 * ============================================================
 * 
 * This is the ONLY file you need to modify to connect your own backend.
 * 
 * To use your own API:
 * 1. Set MOCK_MODE to false
 * 2. Configure API_BASE_URL to your backend server
 * 3. Adjust CHAT_ENDPOINT if your endpoint path differs
 * 4. Set your API_KEY in environment variable or directly here (not recommended for production)
 * 5. Modify headers/request format in the functions below if needed
 * 
 * ============================================================
 */

// ============ BASIC CONFIGURATION ============

/**
 * Set to true to use mock responses (no real API calls)
 * Set to false to use real backend API
 */
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() || ""

/**
 * Optional OpenAI-compatible base URL.
 * Leave empty to use official OpenAI endpoint.
 *
 * Examples:
 * - Official OpenAI: (empty)
 * - OpenRouter: "https://openrouter.ai/api/v1"
 * - OneAPI/New API gateways: "https://your-gateway.example.com/v1"
 */
export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL?.trim() || undefined

/**
 * Mock mode switch:
 * - Set MOCK_MODE=true / false in .env.local to force mode
 * - If not set, it auto-falls back to mock when API key is missing
 */
const MOCK_MODE_FROM_ENV = process.env.MOCK_MODE?.trim().toLowerCase()
export const MOCK_MODE =
  MOCK_MODE_FROM_ENV === "true"
    ? true
    : MOCK_MODE_FROM_ENV === "false"
      ? false
      : !OPENAI_API_KEY

/**
 * Base URL for your backend API
 * Examples:
 * - Local: "http://localhost:8000"
 * - Production: "https://api.yourcompany.com"
 * - Vercel AI SDK: "/api" (default, uses built-in route)
 */
export const API_BASE_URL = "/api"

/**
 * Chat endpoint path (appended to API_BASE_URL)
 * The full URL will be: API_BASE_URL + CHAT_ENDPOINT
 */
export const CHAT_ENDPOINT = "/chat"

/**
 * Full chat API URL (computed)
 */
export const CHAT_API_URL = `${API_BASE_URL}${CHAT_ENDPOINT}`

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT = 30000

/**
 * Model name to use (if your backend supports model selection)
 * Examples: "gpt-4o-mini", "gpt-4", "claude-3-sonnet", etc.
 */
export const MODEL_NAME = "gpt-4o-mini"

// ============ AUTHENTICATION ============

/**
 * API Key for authentication
 * IMPORTANT: For production, use environment variables instead!
 * Set via: process.env.OPENAI_API_KEY or your custom env var
 */
export const API_KEY = OPENAI_API_KEY

/**
 * Authorization header format
 * Common formats:
 * - "Bearer {key}" for most APIs
 * - "{key}" for simple API key auth
 * - Custom format for your backend
 */
export function getAuthHeader(key: string): string {
  return `Bearer ${key}`
}

// ============ REQUEST CONFIGURATION ============

/**
 * Default headers for API requests
 * Modify this if your backend requires different headers
 */
export function getRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  
  if (API_KEY) {
    headers["Authorization"] = getAuthHeader(API_KEY)
  }
  
  return headers
}

// ============ MOCK RESPONSES ============

/**
 * Mock responses for testing without a backend
 * Only used when MOCK_MODE is true
 */
export const MOCK_RESPONSES: Record<string, string> = {
  default: `感谢您的提问！作为工程智能助手，我可以帮助您分析以下方面：

1. **桩基检测**：提供桩身完整性、承载力、垂直度等指标分析
2. **裂缝诊断**：识别裂缝类型、分析成因、提供修复建议
3. **施工方案**：评估方案合理性、提供优化建议
4. **进度管理**：协助编制工程日报、跟踪项目进度

请详细描述您的具体问题，我会为您提供专业的分析和建议。`,
  
  桩基: `根据检测数据分析，该桩基的各项指标如下：

1. **桩身完整性**：I类桩，无明显缺陷
2. **承载力**：满足设计要求的1.2倍
3. **垂直度偏差**：0.3%，符合规范要求
4. **桩长偏差**：+50mm，在允许范围内

**综合评定**：该桩基符合验收标准，建议进入下一施工阶段。`,

  裂缝: `经过分析，该裂缝的诊断结果如下：

1. **裂缝类型**：表面干缩裂缝
2. **裂缝宽度**：0.15mm
3. **裂缝深度**：约5mm
4. **危害等级**：轻微

**处理建议**：
- 表面涂抹环氧树脂封闭
- 加强养护，保持湿润
- 定期观测裂缝发展情况`,

  施工: `施工方案评估结果：

**优点**：
1. 工序安排合理，符合施工规范
2. 安全措施到位，风险控制良好
3. 资源配置合理，进度可控

**建议优化**：
1. 建议增加雨季施工应急预案
2. 可考虑优化混凝土浇筑顺序
3. 建议加强质量检测频次

**总体评价**：方案可行，建议按优化建议完善后实施。`,
}

/**
 * Get mock response based on user input
 */
export function getMockResponse(userMessage: string): string {
  // Check for keywords and return appropriate mock response
  const lowerMessage = userMessage.toLowerCase()
  
  if (lowerMessage.includes("桩") || lowerMessage.includes("桩基")) {
    return MOCK_RESPONSES["桩基"]
  }
  if (lowerMessage.includes("裂缝") || lowerMessage.includes("裂纹")) {
    return MOCK_RESPONSES["裂缝"]
  }
  if (lowerMessage.includes("施工") || lowerMessage.includes("方案")) {
    return MOCK_RESPONSES["施工"]
  }
  
  return MOCK_RESPONSES["default"]
}

// ============ SYSTEM PROMPT ============

/**
 * System prompt for the AI assistant
 * Customize this to change the AI's behavior and expertise
 */
export const SYSTEM_PROMPT = `你是一个专业的工程智能助手，专注于帮助用户解答各类工程技术问题。你的专业领域包括：
- 桩基工程检测与分析
- 混凝土裂缝诊断与处理
- 施工方案设计与优化
- 工程日报和进度管理
- 结构安全评估
- 建筑材料性能分析

请用专业但易懂的语言回答问题，必要时提供具体的技术参数和建议。回答应该结构清晰，条理分明。`

// ============ EXPORT SUMMARY ============

/**
 * Configuration summary for debugging
 */
export const CONFIG_SUMMARY = {
  mockMode: MOCK_MODE,
  apiBaseUrl: API_BASE_URL,
  chatEndpoint: CHAT_ENDPOINT,
  fullChatUrl: CHAT_API_URL,
  timeout: REQUEST_TIMEOUT,
  modelName: MODEL_NAME,
  hasApiKey: !!OPENAI_API_KEY,
  openaiBaseUrl: OPENAI_BASE_URL || "(official OpenAI)",
}
