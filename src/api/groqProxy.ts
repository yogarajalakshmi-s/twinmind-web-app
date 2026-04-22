import type { ChatMessage, SuggestionKind } from '../types/meeting'

async function readErrorMessage(response: Response): Promise<string> {
  const raw = await response.text()
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string }
    if (typeof parsed.error === 'string') {
      return parsed.error
    }
    if (parsed.error && typeof parsed.error === 'object' && 'message' in parsed.error) {
      return String(parsed.error.message ?? raw)
    }
    if (typeof parsed.message === 'string') {
      return parsed.message
    }
  } catch {
    /* ignore */
  }
  return raw || `${response.status} ${response.statusText}`
}

/** Confirms the local proxy is up, then checks the Groq API key. */
export async function verifyGroqSetup(apiKey: string): Promise<void> {
  const health = await fetch('/api/health')
  if (!health.ok) {
    throw new Error(
      'Cannot reach the local API proxy. Run `npm run dev` so Vite and the server on port 8787 both start.',
    )
  }

  const response = await fetch('/api/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }
}

export async function transcribeSegment(blob: Blob, apiKey: string): Promise<string> {
  const body = new FormData()
  body.set('file', blob, 'segment.webm')
  body.set('apiKey', apiKey)

  const response = await fetch('/api/transcribe', {
    method: 'POST',
    body,
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const payload = (await response.json()) as { text?: string }
  return String(payload.text ?? '').trim()
}

function isSuggestionKind(value: unknown): value is SuggestionKind {
  return (
    value === 'question_to_ask' ||
    value === 'talking_point' ||
    value === 'fact_check' ||
    value === 'clarification'
  )
}

export async function fetchSuggestionBatch(
  apiKey: string,
  transcriptContext: string,
  instructions: string,
): Promise<Array<{ kind: SuggestionKind; preview: string }>> {
  const response = await fetch('/api/suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      transcriptContext,
      instructions,
    }),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const payload = (await response.json()) as {
    suggestions?: Array<{ kind?: unknown; preview?: unknown }>
  }

  const list = payload.suggestions
  if (!Array.isArray(list) || list.length !== 3) {
    throw new Error('Suggestion service returned an unexpected payload.')
  }

  return list.map((item, index) => {
    const preview = typeof item.preview === 'string' ? item.preview.trim() : ''
    const kind = isSuggestionKind(item.kind) ? item.kind : 'clarification'
    return {
      kind,
      preview: preview || `Suggestion ${index + 1}: press the team for a concrete next step.`,
    }
  })
}

export async function streamChatCompletion(options: {
  apiKey: string
  systemPrompt: string
  transcriptContext: string
  messages: Pick<ChatMessage, 'role' | 'content'>[]
  onDelta: (text: string) => void
}): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: options.apiKey,
      systemPrompt: options.systemPrompt,
      transcriptContext: options.transcriptContext,
      messages: options.messages,
      stream: true,
    }),
  })

  if (!response.ok || !response.body) {
    throw new Error(await readErrorMessage(response))
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })

    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      const line = part
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('data:'))

      if (!line) {
        continue
      }

      const data = line.replace(/^data:\s*/, '').trim()
      if (!data || data === '[DONE]') {
        continue
      }

      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>
        }
        const delta = json.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta.length > 0) {
          options.onDelta(delta)
        }
      } catch {
        /* ignore partial JSON chunks */
      }
    }
  }
}
