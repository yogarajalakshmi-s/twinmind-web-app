import { useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'

type SuggestionKind = 'question_to_ask' | 'talking_point' | 'fact_check' | 'clarification'

interface TranscriptChunk {
  id: string
  text: string
  createdAt: string
}

interface Suggestion {
  id: string
  kind: SuggestionKind
  preview: string
  createdAt: string
}

interface SuggestionBatch {
  id: string
  createdAt: string
  suggestions: Suggestion[]
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

interface AppSettings {
  groqApiKey: string
  refreshIntervalSeconds: number
  liveContextWindowChunks: number
  answerContextWindowChunks: number
  liveSuggestionPrompt: string
  detailedAnswerPrompt: string
  chatPrompt: string
}

const defaultSettings: AppSettings = {
  groqApiKey: '',
  refreshIntervalSeconds: 30,
  liveContextWindowChunks: 6,
  answerContextWindowChunks: 12,
  liveSuggestionPrompt:
    'Given recent meeting transcript context, produce exactly 3 concise and useful live suggestions that maximize utility in the next 30 seconds. Mix types intelligently (question to ask, talking point, fact-check, clarification).',
  detailedAnswerPrompt:
    'Given the selected suggestion and transcript context, write a practical, detailed answer with direct phrasing the user can use immediately.',
  chatPrompt:
    'You are a live meeting copilot. Respond with practical, context-aware guidance grounded in the transcript. Be concise but actionable.',
}

const seedTranscript: TranscriptChunk[] = [
  {
    id: 't-1',
    text: "We're talking about how to scale backend capacity to a million concurrent users.",
    createdAt: new Date().toISOString(),
  },
]

const seedSuggestions: Suggestion[] = [
  {
    id: 's-1',
    kind: 'question_to_ask',
    preview: "What's your current p99 latency on websocket round-trips?",
    createdAt: new Date().toISOString(),
  },
  {
    id: 's-2',
    kind: 'talking_point',
    preview: 'Discord sharding mode: 2,500 guilds per shard, about 150k concurrent users each.',
    createdAt: new Date().toISOString(),
  },
  {
    id: 's-3',
    kind: 'fact_check',
    preview: "Slack's 2024 outage was configuration-related; capacity planning was not the primary root cause.",
    createdAt: new Date().toISOString(),
  },
]

const nowIso = (): string => new Date().toISOString()

function App() {
  const idCounter = useRef(10)
  const [isRecording, setIsRecording] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [transcript, setTranscript] = useState<TranscriptChunk[]>(seedTranscript)
  const [suggestionBatches, setSuggestionBatches] = useState<SuggestionBatch[]>([
    { id: 'b-1', createdAt: nowIso(), suggestions: seedSuggestions },
  ])
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')

  const latestSuggestions = suggestionBatches[0]?.suggestions ?? []
  const transcriptText = useMemo(() => transcript.map((chunk) => chunk.text).join('\n'), [transcript])
  const nextId = (prefix: string): string => {
    idCounter.current += 1
    return `${prefix}-${idCounter.current}`
  }

  const simulateRefresh = (): void => {
    const chunkCount = transcript.length + 1
    const newChunk: TranscriptChunk = {
      id: `t-${chunkCount}`,
      createdAt: nowIso(),
      text: `Chunk ${chunkCount}: Placeholder transcript while API wiring is pending. Next commit will replace this with Whisper Large V3 audio chunks.`,
    }

    const newSuggestions: Suggestion[] = [
      {
        id: `s-${Date.now()}-1`,
        kind: 'question_to_ask',
        preview: `Ask for a concrete SLA tied to chunk ${chunkCount}.`,
        createdAt: nowIso(),
      },
      {
        id: `s-${Date.now()}-2`,
        kind: 'clarification',
        preview: 'Clarify expected recovery time objective during traffic spikes.',
        createdAt: nowIso(),
      },
      {
        id: `s-${Date.now()}-3`,
        kind: 'talking_point',
        preview: 'Propose phased load tests before full traffic migration.',
        createdAt: nowIso(),
      },
    ]

    setTranscript((prev) => [...prev, newChunk])
    setSuggestionBatches((prev) => [
      { id: `b-${Date.now()}`, createdAt: nowIso(), suggestions: newSuggestions },
      ...prev,
    ])
  }

  const askSuggestion = (suggestion: Suggestion): void => {
    const userMessage: ChatMessage = {
      id: nextId('m-user'),
      role: 'user',
      content: suggestion.preview,
      createdAt: nowIso(),
    }
    const assistantMessage: ChatMessage = {
      id: nextId('m-assistant'),
      role: 'assistant',
      content:
        'Detailed response placeholder. Next commit will connect this path to Groq GPT-OSS 120B using the on-click prompt and selected transcript context window.',
      createdAt: nowIso(),
    }
    setChatHistory((prev) => [...prev, userMessage, assistantMessage])
  }

  const onSubmitChat = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const value = chatInput.trim()
    if (!value) {
      return
    }
    const userMessage: ChatMessage = {
      id: nextId('m-user'),
      role: 'user',
      content: value,
      createdAt: nowIso(),
    }
    const assistantMessage: ChatMessage = {
      id: nextId('m-assistant'),
      role: 'assistant',
      content:
        'Chat response placeholder. This will be replaced with streamed GPT-OSS 120B responses in the next integration commit.',
      createdAt: nowIso(),
    }
    setChatHistory((prev) => [...prev, userMessage, assistantMessage])
    setChatInput('')
  }

  const exportSession = (): void => {
    const payload = {
      exportedAt: nowIso(),
      transcript,
      suggestionBatches,
      chatHistory,
      settings: {
        ...settings,
        groqApiKey: settings.groqApiKey ? '***redacted***' : '',
      },
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `twinmind-session-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>TwinMind Live Suggestions</h1>
        <div className="topbar-actions">
          <button onClick={() => setSettingsOpen(true)}>Settings</button>
          <button onClick={exportSession}>Export Session</button>
        </div>
      </header>

      <main className="columns">
        <section className="panel">
          <div className="panel-header">
            <h2>1. Mic & Transcript</h2>
            <button onClick={() => setIsRecording((value) => !value)}>
              {isRecording ? 'Stop Mic' : 'Start Mic'}
            </button>
          </div>
          <p className="panel-note">
            {isRecording
              ? `Recording active. Refreshing every ${settings.refreshIntervalSeconds}s.`
              : 'Mic paused. Click Start Mic to begin session.'}
          </p>
          <div className="list">
            {transcript.map((chunk) => (
              <article key={chunk.id} className="item">
                <time>{new Date(chunk.createdAt).toLocaleTimeString()}</time>
                <p>{chunk.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>2. Live Suggestions</h2>
            <button onClick={simulateRefresh}>Refresh</button>
          </div>
          <p className="panel-note">
            Exactly 3 suggestions per batch. Newest batch appears on top.
          </p>
          <div className="list">
            {latestSuggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                className="suggestion"
                onClick={() => askSuggestion(suggestion)}
              >
                <span>{suggestion.kind.replace('_', ' ')}</span>
                <strong>{suggestion.preview}</strong>
              </button>
            ))}
          </div>
          <div className="history">
            {suggestionBatches.slice(1).map((batch) => (
              <p key={batch.id}>
                Older batch at {new Date(batch.createdAt).toLocaleTimeString()} ({batch.suggestions.length}{' '}
                suggestions)
              </p>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>3. Chat</h2>
          </div>
          <p className="panel-note">One continuous chat thread for this session.</p>
          <div className="list">
            {chatHistory.map((message) => (
              <article key={message.id} className={`item ${message.role}`}>
                <time>{new Date(message.createdAt).toLocaleTimeString()}</time>
                <p>
                  <strong>{message.role === 'user' ? 'You' : 'Assistant'}:</strong> {message.content}
                </p>
              </article>
            ))}
          </div>
          <form onSubmit={onSubmitChat} className="chat-form">
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Type a question..."
            />
            <button type="submit">Send</button>
          </form>
        </section>
      </main>

      {settingsOpen && (
        <aside className="settings-drawer" role="dialog" aria-modal="true">
          <div className="settings-content">
            <div className="panel-header">
              <h2>Settings</h2>
              <button onClick={() => setSettingsOpen(false)}>Close</button>
            </div>
            <label>
              Groq API Key
              <input
                type="password"
                value={settings.groqApiKey}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, groqApiKey: event.target.value.trim() }))
                }
                placeholder="gsk_..."
              />
            </label>
            <label>
              Live Suggestion Prompt
              <textarea
                value={settings.liveSuggestionPrompt}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, liveSuggestionPrompt: event.target.value }))
                }
              />
            </label>
            <label>
              Detailed Answer Prompt
              <textarea
                value={settings.detailedAnswerPrompt}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, detailedAnswerPrompt: event.target.value }))
                }
              />
            </label>
            <label>
              Chat Prompt
              <textarea
                value={settings.chatPrompt}
                onChange={(event) => setSettings((prev) => ({ ...prev, chatPrompt: event.target.value }))}
              />
            </label>
            <label>
              Live Context Window (chunks)
              <input
                type="number"
                min={1}
                value={settings.liveContextWindowChunks}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    liveContextWindowChunks: Number(event.target.value) || 1,
                  }))
                }
              />
            </label>
            <label>
              Answer Context Window (chunks)
              <input
                type="number"
                min={1}
                value={settings.answerContextWindowChunks}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    answerContextWindowChunks: Number(event.target.value) || 1,
                  }))
                }
              />
            </label>
            <label>
              Refresh Interval (seconds)
              <input
                type="number"
                min={10}
                value={settings.refreshIntervalSeconds}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    refreshIntervalSeconds: Number(event.target.value) || 10,
                  }))
                }
              />
            </label>
            <div className="settings-preview">
              <h3>Transcript Context Preview</h3>
              <pre>{transcriptText || 'No transcript yet'}</pre>
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}

export default App
