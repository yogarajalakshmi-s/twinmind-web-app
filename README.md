# TwinMind Live Suggestions Web App

This repository contains a Vite + React + TypeScript implementation of the TwinMind assignment.

## Current Status

First milestone completed:
- 3-column layout (mic/transcript, live suggestions, chat) modeled after the prototype
- Session state scaffolding for transcript chunks, suggestion batches, and chat history
- Settings modal with Groq API key input and editable prompt/context configuration
- JSON export for full session data
- Placeholder refresh/chat flows ready for API integration

## Run Locally

```bash
npm install
npm run dev
```

## Next Milestone

- Wire live microphone capture
- Whisper Large V3 transcription via Groq
- GPT-OSS 120B suggestions and detailed chat responses
- Auto-refresh loop and streaming chat
