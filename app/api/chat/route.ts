/**
 * Chat API Route
 * 
 * This route handles chat requests from the frontend.
 * Configuration is loaded from /lib/api-config.ts
 * 
 * To customize the API behavior, edit the api-config.ts file.
 */

import {
  consumeStream,
  convertToModelMessages,
  streamText,
  UIMessage,
} from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { SYSTEM_PROMPT, MODEL_NAME, MOCK_MODE, getMockResponse } from '@/lib/api-config'

export const maxDuration = 30

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  // Mock mode - return simulated response
  if (MOCK_MODE) {
    const lastUserMessage = messages
      .filter(m => m.role === 'user')
      .pop()
    
    const userText = lastUserMessage?.parts
      ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map(p => p.text)
      .join('') || ''
    
    const mockResponse = getMockResponse(userText)
    
    // Return as a simple streaming response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        // Simulate streaming by sending chunks
        const words = mockResponse.split('')
        for (let i = 0; i < words.length; i++) {
          await new Promise(resolve => setTimeout(resolve, 15))
          const chunk = `data: ${JSON.stringify({ type: 'text-delta', delta: words[i] })}\n\n`
          controller.enqueue(encoder.encode(chunk))
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  }

  // Real API call using OpenAI
  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })

  const result = streamText({
    model: openai(MODEL_NAME),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    abortSignal: req.signal,
  })

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    consumeSseStream: consumeStream,
  })
}
