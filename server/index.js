/**
 * Local dev proxy for Groq so the browser never talks to Groq directly.
 * The user's API key is forwarded per request (Authorization or form/json field).
 */
import cors from 'cors'
import express from 'express'
import multer from 'multer'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const PORT = Number(process.env.PORT) || 8787
const GROQ_BASE = 'https://api.groq.com/openai/v1'

const WHISPER_MODEL = 'whisper-large-v3'
const CHAT_MODEL = 'openai/gpt-oss-120b'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
})

const app = express()
app.use(cors({ origin: true }))
app.use(express.json({ limit: '2mb' }))

function getApiKey(req) {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim()
  }
  const fromBody = req.body?.apiKey
  if (typeof fromBody === 'string' && fromBody.trim()) {
    return fromBody.trim()
  }
  return ''
}

/** @param {string} text */
function tryParseJsonObject(text) {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

const ALLOWED_KINDS = new Set(['question_to_ask', 'talking_point', 'fact_check', 'clarification'])

/** @param {unknown} value */
function normalizeKind(value) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (ALLOWED_KINDS.has(raw)) {
    return raw
  }
  const aliases = {
    question: 'question_to_ask',
    questiontoask: 'question_to_ask',
    ask: 'question_to_ask',
    talkingpoint: 'talking_point',
    factcheck: 'fact_check',
    fact_checking: 'fact_check',
    clarify: 'clarification',
    clarification_needed: 'clarification',
  }
  const mapped = aliases[raw]
  if (mapped && ALLOWED_KINDS.has(mapped)) {
    return mapped
  }
  return 'clarification'
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/transcribe', upload.single('file'), async (req, res) => {
  const apiKey = getApiKey(req)
  if (!apiKey) {
    res.status(401).json({ error: 'Missing Groq API key.' })
    return
  }
  if (!req.file?.buffer) {
    res.status(400).json({ error: 'Missing audio file field "file".' })
    return
  }

  const filename = req.file.originalname || 'audio.webm'
  const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'application/octet-stream' })
  const formData = new FormData()
  formData.set('model', WHISPER_MODEL)
  formData.set('file', blob, filename)

  try {
    const groqRes = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    })
    const text = await groqRes.text()
    if (!groqRes.ok) {
      res.status(groqRes.status).type('application/json').send(text)
      return
    }
    res.type('application/json').send(text)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transcription request failed.'
    res.status(502).json({ error: message })
  }
})

app.post('/api/suggestions', async (req, res) => {
  const apiKey = getApiKey(req)
  if (!apiKey) {
    res.status(401).json({ error: 'Missing Groq API key.' })
    return
  }

  const {
    transcriptContext = '',
    instructions = '',
    temperature = 0.35,
    maxTokens = 900,
  } = req.body ?? {}

  const system = [
    'You are TwinMind, a live meeting copilot.',
    'Return ONLY valid JSON (no markdown fences) with this exact shape:',
    '{"suggestions":[{"kind":"question_to_ask|talking_point|fact_check|clarification","preview":"..."}]}',
    'Rules:',
    '- Exactly 3 suggestions.',
    '- Each preview must be self-contained and useful without clicking (short, concrete, meeting-relevant).',
    '- Choose a helpful mix based on the transcript (questions, talking points, fact-checks, clarifications).',
    '- If the transcript is thin, infer likely next useful moves for a technical/business meeting.',
  ].join('\n')

  const user = [
    instructions?.trim() || 'Generate the next 3 live suggestions.',
    '',
    'Transcript context:',
    String(transcriptContext || '').trim() || '(empty)',
  ].join('\n')

  try {
    const groqRes = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        temperature: Number(temperature) || 0.35,
        max_tokens: Number(maxTokens) || 900,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    const rawText = await groqRes.text()
    if (!groqRes.ok) {
      res.status(groqRes.status).type('application/json').send(rawText)
      return
    }
    const payload = JSON.parse(rawText)
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      res.status(502).json({ error: 'Unexpected Groq response shape.' })
      return
    }
    const parsed = tryParseJsonObject(content)
    const list = parsed?.suggestions
    if (!Array.isArray(list) || list.length !== 3) {
      res.status(502).json({
        error: 'Model did not return exactly 3 suggestions as JSON.',
        raw: content,
      })
      return
    }
    const normalized = list.map((item, index) => {
      const preview = typeof item?.preview === 'string' ? item.preview.trim() : ''
      return {
        kind: normalizeKind(item?.kind),
        preview: preview || `Suggestion ${index + 1}: dig deeper based on the latest transcript.`,
      }
    })
    res.json({ suggestions: normalized })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Suggestion request failed.'
    res.status(502).json({ error: message })
  }
})

app.post('/api/chat', async (req, res) => {
  const apiKey = getApiKey(req)
  if (!apiKey) {
    res.status(401).json({ error: 'Missing Groq API key.' })
    return
  }

  const {
    messages = [],
    systemPrompt = '',
    transcriptContext = '',
    stream = false,
    temperature = 0.25,
    maxTokens = 2048,
  } = req.body ?? {}

  const system = [
    systemPrompt?.trim() || 'You are a helpful meeting copilot.',
    '',
    'Full transcript context:',
    String(transcriptContext || '').trim() || '(empty)',
  ].join('\n')

  const groqPayload = {
    model: CHAT_MODEL,
    temperature: Number(temperature) || 0.25,
    max_tokens: Number(maxTokens) || 2048,
    stream: Boolean(stream),
    messages: [{ role: 'system', content: system }, ...messages],
  }

  try {
    const groqRes = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(groqPayload),
    })

    if (!groqRes.ok) {
      const errText = await groqRes.text()
      res.status(groqRes.status).type('application/json').send(errText)
      return
    }

    if (!stream || !groqRes.body) {
      const text = await groqRes.text()
      res.type('application/json').send(text)
      return
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    const nodeStream = Readable.fromWeb(groqRes.body)
    await pipeline(nodeStream, res)
  } catch (err) {
    if (!res.headersSent) {
      const message = err instanceof Error ? err.message : 'Chat request failed.'
      res.status(502).json({ error: message })
    } else {
      res.end()
    }
  }
})

app.listen(PORT, () => {
  console.log(`TwinMind Groq proxy listening on http://localhost:${PORT}`)
})
