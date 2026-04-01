import type Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import OpenAI from 'openai'

type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam
type BetaContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam
type BetaToolUseBlock = Anthropic.Beta.Messages.BetaToolUseBlock
type BetaMessage = Anthropic.Beta.Messages.BetaMessage
type BetaRawMessageStreamEvent = Anthropic.Beta.Messages.BetaRawMessageStreamEvent
type BetaMessageStreamParams = Anthropic.Beta.Messages.BetaMessageCreateParams & { stream: true }
type BetaMessageCreateParams = Anthropic.Beta.Messages.BetaMessageCreateParams
type BetaStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null
type MessageParam = OpenAI.ChatCompletionMessageParam
type ChatTool = OpenAI.ChatCompletionTool

// ─── Message Conversion (Anthropic → OpenAI) ───────────────────────────────

function extractTextFromContentBlocks(
  content: string | BetaContentBlockParam[],
): string {
  if (typeof content === 'string') return content
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block)
    } else if (block.type === 'text') {
      parts.push((block as { type: 'text'; text: string }).text)
    }
  }
  return parts.join('')
}

function convertImageBlockToOpenAI(
  block: { type: 'image'; source: { type: string; media_type: string; data: string } },
): OpenAI.ChatCompletionContentPartImage {
  return {
    type: 'image_url',
    image_url: {
      url: `data:${block.source.media_type};base64,${block.source.data}`,
    },
  }
}

function convertUserContentToOpenAI(
  content: string | BetaContentBlockParam[],
): string | OpenAI.ChatCompletionContentPart[] {
  if (typeof content === 'string') return content

  const hasComplexContent = content.some(
    b => typeof b === 'object' && b.type !== 'text' && b.type !== 'tool_result',
  )

  if (!hasComplexContent) {
    return extractTextFromContentBlocks(content)
  }

  const parts: OpenAI.ChatCompletionContentPart[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push({ type: 'text', text: block })
    } else if (block.type === 'text') {
      parts.push({ type: 'text', text: (block as { text: string }).text })
    } else if (block.type === 'image') {
      parts.push(convertImageBlockToOpenAI(block as Parameters<typeof convertImageBlockToOpenAI>[0]))
    }
  }
  return parts.length > 0 ? parts : ''
}

function convertToolResultBlocks(
  content: BetaContentBlockParam[],
): MessageParam[] {
  const messages: MessageParam[] = []
  for (const block of content) {
    if (typeof block !== 'object') continue
    if (block.type === 'tool_result') {
      const tr = block as {
        type: 'tool_result'
        tool_use_id: string
        content?: string | BetaContentBlockParam[]
        is_error?: boolean
      }
      let text = ''
      if (typeof tr.content === 'string') {
        text = tr.content
      } else if (Array.isArray(tr.content)) {
        text = extractTextFromContentBlocks(tr.content)
      }
      if (tr.is_error) {
        text = `[ERROR] ${text}`
      }
      messages.push({
        role: 'tool' as const,
        tool_call_id: tr.tool_use_id,
        content: text,
      })
    }
  }
  return messages
}

export function convertMessagesToOpenAI(
  messages: BetaMessageParam[],
  system?: string | Anthropic.Beta.Messages.BetaTextBlockParam[],
): MessageParam[] {
  const result: MessageParam[] = []

  if (system) {
    const systemText = typeof system === 'string'
      ? system
      : system.map(b => b.text).join('\n')
    if (systemText) {
      result.push({ role: 'system', content: systemText })
    }
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'user', content: msg.content })
        continue
      }

      const toolResults = convertToolResultBlocks(msg.content as BetaContentBlockParam[])
      const nonToolContent = (msg.content as BetaContentBlockParam[]).filter(
        b => typeof b === 'string' || (typeof b === 'object' && b.type !== 'tool_result'),
      )

      if (toolResults.length > 0) {
        result.push(...toolResults)
      }
      if (nonToolContent.length > 0) {
        const converted = convertUserContentToOpenAI(nonToolContent)
        if (converted && (typeof converted === 'string' ? converted.length > 0 : converted.length > 0)) {
          result.push({ role: 'user', content: converted })
        }
      }
    } else if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'assistant', content: msg.content })
        continue
      }

      const blocks = msg.content as BetaContentBlockParam[]
      const textParts: string[] = []
      const toolCalls: OpenAI.ChatCompletionMessageParam[] = []
      const toolCallEntries: {
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }[] = []

      for (const block of blocks) {
        if (typeof block === 'string') {
          textParts.push(block)
        } else if (block.type === 'text') {
          textParts.push((block as { text: string }).text)
        } else if (block.type === 'tool_use') {
          const tu = block as {
            type: 'tool_use'
            id: string
            name: string
            input: unknown
          }
          toolCallEntries.push({
            id: tu.id,
            type: 'function',
            function: {
              name: tu.name,
              arguments: typeof tu.input === 'string'
                ? tu.input
                : JSON.stringify(tu.input),
            },
          })
        }
        // Skip thinking, redacted_thinking, and other Anthropic-specific blocks
      }

      if (toolCallEntries.length > 0) {
        result.push({
          role: 'assistant',
          content: textParts.join('') || null,
          tool_calls: toolCallEntries,
        } as OpenAI.ChatCompletionAssistantMessageParam)
      } else {
        result.push({
          role: 'assistant',
          content: textParts.join('') || '',
        })
      }
    }
  }

  return result
}

// ─── Tool Conversion (Anthropic → OpenAI) ───────────────────────────────────

export function convertToolsToOpenAI(
  tools?: BetaMessageCreateParams['tools'],
): ChatTool[] | undefined {
  if (!tools || tools.length === 0) return undefined

  return tools
    .filter(t => {
      const toolType = (t as { type?: string }).type
      return !toolType || toolType === 'custom' || toolType === 'function'
    })
    .map(tool => {
      const t = tool as {
        name: string
        description?: string
        input_schema?: Record<string, unknown>
      }
      return {
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.input_schema || { type: 'object', properties: {} },
        },
      }
    })
}

// ─── Stop Reason Mapping ─────────────────────────────────────────────────────

function mapFinishReason(reason: string | null | undefined): BetaStopReason {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'end_turn'
    default:
      return 'end_turn'
  }
}

// ─── Non-Streaming Response Conversion (OpenAI → Anthropic) ──────────────────

export function convertResponseToAnthropic(
  response: OpenAI.ChatCompletion,
  model: string,
): BetaMessage {
  const choice = response.choices[0]
  if (!choice) {
    return {
      id: response.id || `msg_${randomUUID()}`,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    } as unknown as BetaMessage
  }

  const content: (Anthropic.Beta.Messages.BetaTextBlock | BetaToolUseBlock)[] = []

  if (choice.message.content) {
    content.push({
      type: 'text',
      text: choice.message.content,
    } as Anthropic.Beta.Messages.BetaTextBlock)
  }

  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let parsedInput: Record<string, unknown> = {}
      try {
        parsedInput = JSON.parse(tc.function.arguments || '{}')
      } catch {
        parsedInput = { _raw: tc.function.arguments }
      }
      content.push({
        type: 'tool_use',
        id: tc.id || `toolu_${randomUUID()}`,
        name: tc.function.name,
        input: parsedInput,
      } as BetaToolUseBlock)
    }
  }

  return {
    id: response.id || `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    content,
    model,
    stop_reason: mapFinishReason(choice.finish_reason),
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
    },
  } as unknown as BetaMessage
}

// ─── Streaming Conversion (OpenAI → Anthropic) ──────────────────────────────

async function* convertStreamToAnthropic(
  stream: AsyncIterable<OpenAI.ChatCompletionChunk>,
  model: string,
): AsyncIterable<BetaRawMessageStreamEvent> {
  const messageId = `msg_${randomUUID()}`
  let contentIndex = 0
  let currentBlockType: 'text' | 'tool_use' | null = null
  let inputTokens = 0
  let outputTokens = 0

  // Track tool call state: OpenAI streams tool_calls with indices
  const activeToolCalls = new Map<number, {
    anthropicIndex: number
    id: string
    name: string
    argumentsSoFar: string
  }>()

  // Emit message_start
  yield {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  } as unknown as BetaRawMessageStreamEvent

  let hasStartedTextBlock = false

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0]
    if (!choice) {
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens
        outputTokens = chunk.usage.completion_tokens ?? outputTokens
      }
      continue
    }

    const delta = choice.delta

    // Handle text content
    if (delta?.content) {
      if (!hasStartedTextBlock) {
        yield {
          type: 'content_block_start',
          index: contentIndex,
          content_block: { type: 'text', text: '' },
        } as unknown as BetaRawMessageStreamEvent
        currentBlockType = 'text'
        hasStartedTextBlock = true
      }

      yield {
        type: 'content_block_delta',
        index: contentIndex,
        delta: { type: 'text_delta', text: delta.content },
      } as unknown as BetaRawMessageStreamEvent
    }

    // Handle tool calls
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const tcIndex = tc.index ?? 0

        if (!activeToolCalls.has(tcIndex)) {
          // Close previous text block if open
          if (hasStartedTextBlock && currentBlockType === 'text') {
            yield {
              type: 'content_block_stop',
              index: contentIndex,
            } as unknown as BetaRawMessageStreamEvent
            contentIndex++
            hasStartedTextBlock = false
          }

          const toolId = tc.id || `toolu_${randomUUID()}`
          const toolName = tc.function?.name || ''

          activeToolCalls.set(tcIndex, {
            anthropicIndex: contentIndex,
            id: toolId,
            name: toolName,
            argumentsSoFar: '',
          })

          yield {
            type: 'content_block_start',
            index: contentIndex,
            content_block: {
              type: 'tool_use',
              id: toolId,
              name: toolName,
              input: '',
            },
          } as unknown as BetaRawMessageStreamEvent

          currentBlockType = 'tool_use'
        }

        const toolState = activeToolCalls.get(tcIndex)!

        // Update name if provided in subsequent chunks
        if (tc.function?.name && !toolState.name) {
          toolState.name = tc.function.name
        }

        if (tc.function?.arguments) {
          toolState.argumentsSoFar += tc.function.arguments
          yield {
            type: 'content_block_delta',
            index: toolState.anthropicIndex,
            delta: {
              type: 'input_json_delta',
              partial_json: tc.function.arguments,
            },
          } as unknown as BetaRawMessageStreamEvent
        }
      }
    }

    // Handle finish
    if (choice.finish_reason) {
      // Close any open text block
      if (hasStartedTextBlock && currentBlockType === 'text') {
        yield {
          type: 'content_block_stop',
          index: contentIndex,
        } as unknown as BetaRawMessageStreamEvent
        contentIndex++
        hasStartedTextBlock = false
      }

      // Close all open tool blocks
      for (const [, toolState] of activeToolCalls) {
        yield {
          type: 'content_block_stop',
          index: toolState.anthropicIndex,
        } as unknown as BetaRawMessageStreamEvent
        contentIndex = Math.max(contentIndex, toolState.anthropicIndex + 1)
      }
      activeToolCalls.clear()

      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens
        outputTokens = chunk.usage.completion_tokens ?? outputTokens
      }

      yield {
        type: 'message_delta',
        delta: { stop_reason: mapFinishReason(choice.finish_reason) },
        usage: { output_tokens: outputTokens },
      } as unknown as BetaRawMessageStreamEvent
    }
  }

  // Safety: close any blocks still open when stream ends without finish_reason
  if (hasStartedTextBlock && currentBlockType === 'text') {
    yield {
      type: 'content_block_stop',
      index: contentIndex,
    } as unknown as BetaRawMessageStreamEvent
  }
  for (const [, toolState] of activeToolCalls) {
    yield {
      type: 'content_block_stop',
      index: toolState.anthropicIndex,
    } as unknown as BetaRawMessageStreamEvent
  }
}

// ─── Thinking → reasoning_effort ─────────────────────────────────────────────

function mapThinkingToReasoningEffort(
  thinking?: BetaMessageCreateParams['thinking'],
): string | undefined {
  if (!thinking || thinking.type === 'disabled') return undefined
  if (thinking.type === 'enabled') {
    const budget = thinking.budget_tokens
    if (budget <= 2048) return 'low'
    if (budget <= 8192) return 'medium'
    return 'high'
  }
  return undefined
}

// ─── Adapter Factory ─────────────────────────────────────────────────────────

export interface OpenAIAdapterConfig {
  apiKey: string
  baseURL: string
  defaultHeaders?: Record<string, string>
  timeout?: number
}

export function createOpenAIAdapter(config: OpenAIAdapterConfig): Anthropic {
  const openai = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeout ?? 600_000,
    defaultHeaders: config.defaultHeaders,
  })

  const adapter = {
    beta: {
      messages: {
        create(
          params: BetaMessageCreateParams & { stream?: boolean },
          options?: { signal?: AbortSignal; timeout?: number; headers?: Record<string, string> },
        ): unknown {
          const openaiMessages = convertMessagesToOpenAI(
            params.messages as BetaMessageParam[],
            params.system as string | Anthropic.Beta.Messages.BetaTextBlockParam[] | undefined,
          )
          const openaiTools = convertToolsToOpenAI(params.tools)
          const reasoningEffort = mapThinkingToReasoningEffort(params.thinking)

          const requestBody: OpenAI.ChatCompletionCreateParams = {
            model: params.model,
            messages: openaiMessages,
            max_tokens: params.max_tokens ?? undefined,
            ...(params.temperature !== undefined && { temperature: params.temperature }),
            ...(openaiTools && openaiTools.length > 0 && { tools: openaiTools }),
            ...(reasoningEffort && { reasoning_effort: reasoningEffort } as Record<string, unknown>),
            stream: !!params.stream,
            ...(params.stream && { stream_options: { include_usage: true } }),
          }

          if (params.stream) {
            return createStreamingResponse(openai, requestBody, params.model, options)
          }

          return createNonStreamingResponse(openai, requestBody, params.model, options)
        },

        countTokens(
          params: { messages: BetaMessageParam[]; system?: string | Anthropic.Beta.Messages.BetaTextBlockParam[] } & Record<string, unknown>,
        ): Promise<{ input_tokens: number }> {
          const openaiMessages = convertMessagesToOpenAI(
            params.messages,
            params.system as string | Anthropic.Beta.Messages.BetaTextBlockParam[] | undefined,
          )
          let charCount = 0
          for (const msg of openaiMessages) {
            if (typeof msg.content === 'string') {
              charCount += msg.content.length
            } else if (Array.isArray(msg.content)) {
              for (const part of msg.content as { text?: string }[]) {
                if (part.text) charCount += part.text.length
              }
            }
          }
          // Rough estimate: ~4 chars per token
          return Promise.resolve({ input_tokens: Math.ceil(charCount / 4) })
        },
      },
    },
  }

  return adapter as unknown as Anthropic
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function createNonStreamingResponse(
  openai: OpenAI,
  requestBody: OpenAI.ChatCompletionCreateParams,
  model: string,
  options?: { signal?: AbortSignal; timeout?: number },
): Promise<BetaMessage> {
  const response = await openai.chat.completions.create(
    { ...requestBody, stream: false },
    {
      signal: options?.signal,
      timeout: options?.timeout,
    },
  )
  return convertResponseToAnthropic(response as OpenAI.ChatCompletion, model)
}

function createStreamingResponse(
  openai: OpenAI,
  requestBody: OpenAI.ChatCompletionCreateParams,
  model: string,
  options?: { signal?: AbortSignal; timeout?: number; headers?: Record<string, string> },
) {
  // Return an object that mimics anthropic.beta.messages.create({stream:true})
  // which has a .withResponse() method
  const streamPromise = openai.chat.completions.create(
    { ...requestBody, stream: true },
    {
      signal: options?.signal,
      timeout: options?.timeout,
    },
  ) as Promise<AsyncIterable<OpenAI.ChatCompletionChunk>>

  const result = streamPromise.then(stream => {
    const anthropicStream = convertStreamToAnthropic(stream, model)
    return anthropicStream
  })

  // The Anthropic SDK returns an object with [Symbol.asyncIterator] and .withResponse()
  // We need to mimic both interfaces
  const proxy = {
    [Symbol.asyncIterator]: async function* () {
      const stream = await result
      yield* stream
    },

    withResponse: async () => {
      const stream = await result
      return {
        data: {
          [Symbol.asyncIterator]: async function* () {
            yield* stream
          },
        },
        response: new Response(null, { status: 200 }),
        request_id: `req_openai_${randomUUID()}`,
      }
    },

    // Some callers might await the stream directly
    then: (
      resolve: (value: unknown) => void,
      reject: (reason: unknown) => void,
    ) => result.then(resolve, reject),
  }

  return proxy
}
