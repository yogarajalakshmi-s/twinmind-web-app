import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  fetchSuggestionBatch,
  streamChatCompletion,
  transcribeSegment,
  verifyGroqSetup,
} from './api/groqProxy'
import type {
  AppSettings,
  ChatMessage,
  Suggestion,
  SuggestionBatch,
  TranscriptChunk,
} from './types/meeting'

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

const nowIso = (): string => new Date().toISOString()

function App() {
  const transcriptEndRef = useRef<HTMLDivElement | null>(null)
  const settingsRef = useRef(defaultSettings)
  const transcriptRef = useRef<TranscriptChunk[]>([])
  const chatHistoryRef = useRef<ChatMessage[]>([])

  const liveRecorderRef = useRef<MediaRecorder | null>(null)
  const segmentStartedAtRef = useRef(0)
  const stillRecordingRef = useRef(false)

  const [isRecording, setIsRecording] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [transcript, setTranscript] = useState<TranscriptChunk[]>([])
  const [suggestionBatches, setSuggestionBatches] = useState<SuggestionBatch[]>([])
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null)
  const [connectionTest, setConnectionTest] = useState<{
    status: 'idle' | 'running' | 'success' | 'failed'
    message: string
  }>({ status: 'idle', message: '' })

  const idCounter = useRef(0)
  const nextId = (prefix: string): string => {
    idCounter.current += 1
    return `${prefix}-${idCounter.current}`
  }

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    transcriptRef.current = transcript
  }, [transcript])

  useEffect(() => {
    chatHistoryRef.current = chatHistory
  }, [chatHistory])

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [transcript])

  useEffect(() => {
    if (!isRecording) {
      return
    }

    const intervalMs = Math.max(10, settings.refreshIntervalSeconds) * 1000

    const updateCountdown = (): void => {
      const startedAt = segmentStartedAtRef.current
      if (!startedAt) {
        return
      }
      const elapsed = Date.now() - startedAt
      const remainingMs = intervalMs - (elapsed % intervalMs)
      setCountdownSeconds(Math.max(0, Math.ceil(remainingMs / 1000)))
    }

    const id = window.setInterval(updateCountdown, 500)
    return () => window.clearInterval(id)
  }, [isRecording, settings.refreshIntervalSeconds])

  const runTranscribeAndSuggest = useCallback(async (audioBlob: Blob | null) => {
    const currentSettings = settingsRef.current
    if (!currentSettings.groqApiKey) {
      setError('Add your Groq API key in Settings.')
      return
    }

    setBusy(true)
    setError(null)

    try {
      let transcripts = transcriptRef.current

      if (audioBlob && audioBlob.size > 0) {
        const text = await transcribeSegment(audioBlob, currentSettings.groqApiKey)
        if (text) {
          const chunk: TranscriptChunk = {
            id: crypto.randomUUID(),
            text,
            createdAt: nowIso(),
          }
          transcripts = [...transcripts, chunk]
          transcriptRef.current = transcripts
          setTranscript(transcripts)
        }
      }

      const context = transcripts
        .slice(-currentSettings.liveContextWindowChunks)
        .map((chunk) => chunk.text)
        .join('\n')

      const rows = await fetchSuggestionBatch(
        currentSettings.groqApiKey,
        context,
        currentSettings.liveSuggestionPrompt,
      )

      const batch = {
        id: crypto.randomUUID(),
        createdAt: nowIso(),
        suggestions: rows.map((row) => ({
          id: crypto.randomUUID(),
          kind: row.kind,
          preview: row.preview,
          createdAt: nowIso(),
        })),
      }

      setSuggestionBatches((previous) => [batch, ...previous])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Refresh failed.'
      setError(message)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (!isRecording) {
      stillRecordingRef.current = false
      return
    }

    stillRecordingRef.current = true
    let stream: MediaStream | null = null
    let intervalId: number | null = null
    let cancelled = false

    const intervalMs = Math.max(10, settings.refreshIntervalSeconds) * 1000

    const startSegment = (): void => {
      if (!stream || cancelled) {
        return
      }

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : undefined

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      const chunks: BlobPart[] = []

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
        }
      })

      recorder.addEventListener('stop', () => {
        void (async () => {
          const blob = new Blob(chunks, { type: recorder.mimeType })
          try {
            if (blob.size > 0) {
              await runTranscribeAndSuggest(blob)
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Recording segment failed.'
            setError(message)
          } finally {
            if (stillRecordingRef.current && stream && !cancelled) {
              segmentStartedAtRef.current = Date.now()
              startSegment()
            }
          }
        })()
      })

      liveRecorderRef.current = recorder
      segmentStartedAtRef.current = Date.now()
      recorder.start()
    }

    const stopSegment = (): void => {
      if (liveRecorderRef.current && liveRecorderRef.current.state === 'recording') {
        liveRecorderRef.current.stop()
      }
    }

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        setError('Microphone permission is required to record.')
        setIsRecording(false)
        return
      }

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      startSegment()
      intervalId = window.setInterval(stopSegment, intervalMs)
    })()

    return () => {
      cancelled = true
      stillRecordingRef.current = false
      if (intervalId !== null) {
        window.clearInterval(intervalId)
      }
      stopSegment()
      stream?.getTracks().forEach((track) => track.stop())
      liveRecorderRef.current = null
    }
  }, [isRecording, settings.refreshIntervalSeconds, runTranscribeAndSuggest])

  const onManualRefresh = async (): Promise<void> => {
    if (busy) {
      return
    }
    if (isRecording) {
      if (liveRecorderRef.current && liveRecorderRef.current.state === 'recording') {
        liveRecorderRef.current.stop()
      }
      return
    }
    await runTranscribeAndSuggest(null)
  }

  const appendAssistantMessage = useCallback((assistantId: string, delta: string) => {
    setChatHistory((previous) =>
      previous.map((message) =>
        message.id === assistantId ? { ...message, content: message.content + delta } : message,
      ),
    )
  }, [])

  const runChat = useCallback(
    async (userText: string, mode: 'chat' | 'detail', suggestion?: Suggestion) => {
      const currentSettings = settingsRef.current
      if (!currentSettings.groqApiKey) {
        setError('Add your Groq API key in Settings.')
        return
      }

      const trimmed = userText.trim()
      if (!trimmed) {
        return
      }

      const userMessage: ChatMessage = {
        id: nextId('m-user'),
        role: 'user',
        content: trimmed,
        createdAt: nowIso(),
      }

      const assistantMessage: ChatMessage = {
        id: nextId('m-assistant'),
        role: 'assistant',
        content: '',
        createdAt: nowIso(),
      }

      setChatHistory((previous) => [...previous, userMessage, assistantMessage])
      setError(null)

      const transcriptContext = transcriptRef.current
        .slice(-currentSettings.answerContextWindowChunks)
        .map((chunk) => `[${chunk.createdAt}] ${chunk.text}`)
        .join('\n')

      const history = [...chatHistoryRef.current, userMessage]
      const messages = history.map((message) => ({
        role: message.role,
        content:
          mode === 'detail' && suggestion && message.id === userMessage.id
            ? `Suggestion type: ${suggestion.kind.replace(/_/g, ' ')}\n${message.content}`
            : message.content,
      }))

      const systemPrompt =
        mode === 'detail' ? currentSettings.detailedAnswerPrompt : currentSettings.chatPrompt

      setBusy(true)
      try {
        await streamChatCompletion({
          apiKey: currentSettings.groqApiKey,
          systemPrompt,
          transcriptContext,
          messages,
          onDelta: (delta) => appendAssistantMessage(assistantMessage.id, delta),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Chat request failed.'
        setError(message)
        setChatHistory((previous) =>
          previous.map((msg) =>
            msg.id === assistantMessage.id ? { ...msg, content: `Error: ${message}` } : msg,
          ),
        )
      } finally {
        setBusy(false)
      }
    },
    [appendAssistantMessage],
  )

  const askSuggestion = (suggestion: Suggestion): void => {
    const label = suggestion.kind.replace(/_/g, ' ')
    void runChat(`[${label}] ${suggestion.preview}`, 'detail', suggestion)
  }

  const onSubmitChat = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const value = chatInput.trim()
    if (!value) {
      return
    }
    void runChat(value, 'chat')
    setChatInput('')
  }

  const onTestConnection = async (): Promise<void> => {
    const key = settings.groqApiKey.trim()
    if (!key) {
      setConnectionTest({
        status: 'failed',
        message: 'Paste your Groq API key above first.',
      })
      return
    }
    setConnectionTest({ status: 'running', message: 'Checking local proxy and Groq…' })
    try {
      await verifyGroqSetup(key)
      setConnectionTest({
        status: 'success',
        message: 'Proxy is up and Groq accepted your API key.',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection test failed.'
      setConnectionTest({ status: 'failed', message })
    }
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

  const latestSuggestions = suggestionBatches[0]?.suggestions ?? []
  const transcriptText = useMemo(() => transcript.map((chunk) => chunk.text).join('\n'), [transcript])

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>TwinMind Live Suggestions</h1>
        <div className="topbar-actions">
          <button type="button" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
          <button type="button" onClick={exportSession}>
            Export Session
          </button>
        </div>
      </header>

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      <main className="columns">
        <section className="panel">
          <div className="panel-header">
            <h2>1. Mic &amp; Transcript</h2>
            <button type="button" onClick={() => setIsRecording((value) => !value)}>
              {isRecording ? 'Stop Mic' : 'Start Mic'}
            </button>
          </div>
          <p className="panel-note">
            {isRecording
              ? `Recording active. Flushing audio about every ${settings.refreshIntervalSeconds}s to Whisper Large V3.${
                  countdownSeconds !== null ? ` Next flush in ~${countdownSeconds}s.` : ''
                }`
              : 'Mic paused. Start recording to append transcript chunks automatically.'}
          </p>
          <div className="list transcript-list">
            {transcript.length === 0 && <p className="empty-hint">No transcript yet.</p>}
            {transcript.map((chunk) => (
              <article key={chunk.id} className="item">
                <time>{new Date(chunk.createdAt).toLocaleTimeString()}</time>
                <p>{chunk.text}</p>
              </article>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>2. Live Suggestions</h2>
            <button type="button" onClick={() => void onManualRefresh()} disabled={busy}>
              {busy ? 'Working…' : 'Refresh'}
            </button>
          </div>
          <p className="panel-note">
            Each refresh asks GPT-OSS 120B for exactly 3 suggestions using your live prompt and transcript
            window. New batches stack on top.
            {isRecording && countdownSeconds !== null && (
              <span className="countdown"> Auto-flush in ~{countdownSeconds}s.</span>
            )}
          </p>
          <div className="list">
            {latestSuggestions.length === 0 && (
              <p className="empty-hint">No suggestions yet. Refresh once your key is set.</p>
            )}
            {latestSuggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                className="suggestion"
                onClick={() => askSuggestion(suggestion)}
                disabled={busy}
              >
                <span>{suggestion.kind.replace(/_/g, ' ')}</span>
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
          <p className="panel-note">Streaming answers use GPT-OSS 120B with your chat prompt and transcript.</p>
          <div className="list chat-list">
            {chatHistory.length === 0 && (
              <p className="empty-hint">Click a suggestion or type a question to start.</p>
            )}
            {chatHistory.map((message) => (
              <article key={message.id} className={`item ${message.role}`}>
                <time>{new Date(message.createdAt).toLocaleTimeString()}</time>
                <p>
                  <strong>{message.role === 'user' ? 'You' : 'Assistant'}:</strong>{' '}
                  {message.content || (message.role === 'assistant' && busy ? '…' : '')}
                </p>
              </article>
            ))}
          </div>
          <form onSubmit={onSubmitChat} className="chat-form">
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Type a question..."
              disabled={busy}
            />
            <button type="submit" disabled={busy}>
              Send
            </button>
          </form>
        </section>
      </main>

      {settingsOpen && (
        <aside className="settings-drawer" role="dialog" aria-modal="true">
          <div className="settings-content">
            <div className="panel-header">
              <h2>Settings</h2>
              <button type="button" onClick={() => setSettingsOpen(false)}>
                Close
              </button>
            </div>
            <label>
              Groq API Key
              <input
                type="password"
                value={settings.groqApiKey}
                onChange={(event) =>
                  setSettings((previous) => ({ ...previous, groqApiKey: event.target.value.trim() }))
                }
                placeholder="gsk_..."
              />
            </label>
            <p className="settings-hint">
              Paste your key here only. Do not put API keys in source code, <code>.env</code> committed to GitHub, or
              the TwinMind README—this assignment expects the user to supply their own key at runtime.
            </p>
            <div className="settings-test-row">
              <button
                type="button"
                onClick={() => void onTestConnection()}
                disabled={connectionTest.status === 'running'}
              >
                {connectionTest.status === 'running' ? 'Testing…' : 'Test connection'}
              </button>
              {connectionTest.status !== 'idle' && (
                <p
                  className={
                    connectionTest.status === 'success'
                      ? 'settings-test-msg success'
                      : connectionTest.status === 'failed'
                        ? 'settings-test-msg error'
                        : 'settings-test-msg'
                  }
                  role="status"
                >
                  {connectionTest.message}
                </p>
              )}
            </div>
            <label>
              Live Suggestion Prompt
              <textarea
                value={settings.liveSuggestionPrompt}
                onChange={(event) =>
                  setSettings((previous) => ({ ...previous, liveSuggestionPrompt: event.target.value }))
                }
              />
            </label>
            <label>
              Detailed Answer Prompt
              <textarea
                value={settings.detailedAnswerPrompt}
                onChange={(event) =>
                  setSettings((previous) => ({ ...previous, detailedAnswerPrompt: event.target.value }))
                }
              />
            </label>
            <label>
              Chat Prompt
              <textarea
                value={settings.chatPrompt}
                onChange={(event) => setSettings((previous) => ({ ...previous, chatPrompt: event.target.value }))}
              />
            </label>
            <label>
              Live Context Window (chunks)
              <input
                type="number"
                min={1}
                value={settings.liveContextWindowChunks}
                onChange={(event) =>
                  setSettings((previous) => ({
                    ...previous,
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
                  setSettings((previous) => ({
                    ...previous,
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
                  setSettings((previous) => ({
                    ...previous,
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
