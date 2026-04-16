import {
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai"

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

export function getMockResponse(userMessage: string): string {
  const normalizedMessage = userMessage.toLowerCase()

  if (normalizedMessage.includes("桩") || normalizedMessage.includes("桩基")) {
    return MOCK_RESPONSES["桩基"]
  }

  if (
    normalizedMessage.includes("裂缝") ||
    normalizedMessage.includes("裂纹")
  ) {
    return MOCK_RESPONSES["裂缝"]
  }

  if (
    normalizedMessage.includes("施工") ||
    normalizedMessage.includes("方案")
  ) {
    return MOCK_RESPONSES["施工"]
  }

  return MOCK_RESPONSES.default
}

function extractLastUserText(messages: UIMessage[]): string {
  const lastUserMessage = [...messages].reverse().find((message) => {
    return message.role === "user"
  })

  if (!lastUserMessage?.parts?.length) {
    return ""
  }

  return lastUserMessage.parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("")
}

export function createMockChatResponse(messages: UIMessage[]) {
  const mockText = getMockResponse(extractLastUserText(messages))
  const textPartId = `mock-text-${Date.now()}`

  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: ({ writer }) => {
      writer.write({ type: "start" })
      writer.write({ type: "text-start", id: textPartId })

      for (const char of mockText) {
        writer.write({ type: "text-delta", id: textPartId, delta: char })
      }

      writer.write({ type: "text-end", id: textPartId })
      writer.write({ type: "finish", finishReason: "stop" })
    },
    onError: () => "Mock 对话流生成失败。",
  })

  return createUIMessageStreamResponse({
    stream,
    consumeSseStream: consumeStream,
  })
}
