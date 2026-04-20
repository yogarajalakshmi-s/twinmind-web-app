export type SuggestionKind = 'question_to_ask' | 'talking_point' | 'fact_check' | 'clarification'

export interface TranscriptChunk {
  id: string
  text: string
  createdAt: string
}

export interface Suggestion {
  id: string
  kind: SuggestionKind
  preview: string
  createdAt: string
}

export interface SuggestionBatch {
  id: string
  createdAt: string
  suggestions: Suggestion[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface AppSettings {
  groqApiKey: string
  refreshIntervalSeconds: number
  liveContextWindowChunks: number
  answerContextWindowChunks: number
  liveSuggestionPrompt: string
  detailedAnswerPrompt: string
  chatPrompt: string
}
