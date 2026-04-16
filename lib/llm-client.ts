import "server-only"

import {
  consumeStream,
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import {
  DEFAULT_SYSTEM_PROMPT,
  getLLMConfigError,
  resolveLLMConfig,
} from "@/lib/llm-config"
import { createMockChatResponse } from "@/lib/mock-chat"

function getRequestAbortSignal(requestSignal: AbortSignal, timeoutMs: number) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([requestSignal, timeoutSignal])
  }

  const controller = new AbortController()
  const abort = () => controller.abort()

  requestSignal.addEventListener("abort", abort, { once: true })
  timeoutSignal.addEventListener("abort", abort, { once: true })

  return controller.signal
}

export async function createChatResponse(
  messages: UIMessage[],
  requestSignal: AbortSignal,
): Promise<Response> {
  const llmConfig = resolveLLMConfig(process.env)

  if (llmConfig.mockMode) {
    return createMockChatResponse(messages)
  }

  const configError = getLLMConfigError(llmConfig)
  if (configError) {
    return Response.json({ error: configError }, { status: 500 })
  }

  const openai = createOpenAI({
    apiKey: llmConfig.apiKey,
    ...(llmConfig.baseURL ? { baseURL: llmConfig.baseURL } : {}),
  })

  const model =
    llmConfig.provider === "deepseek"
      ? openai.chat(llmConfig.model)
      : openai(llmConfig.model)

  const result = streamText({
    model,
    system: DEFAULT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    abortSignal: getRequestAbortSignal(requestSignal, llmConfig.timeoutMs),
    temperature: llmConfig.defaultParameters.temperature,
    maxOutputTokens: llmConfig.defaultParameters.maxTokens,
    topP: llmConfig.defaultParameters.topP,
  })

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    consumeSseStream: consumeStream,
    onError: (error) => {
      console.error("Chat stream error:", error)
      return "模型响应失败，请稍后重试。"
    },
  })
}
