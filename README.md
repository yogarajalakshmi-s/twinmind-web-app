# TwinMind Live Suggestions Web App

Vite + React + TypeScript frontend with a small local **Express proxy** for Groq. The browser never calls Groq directly; your API key is sent to the proxy on each request and forwarded to Groq.

## Models (Groq)

- **Speech-to-text:** `whisper-large-v3` (`/v1/audio/transcriptions`)
- **Suggestions + chat:** `openai/gpt-oss-120b` (`/v1/chat/completions`)

Chat responses are **streamed** (SSE) through the proxy for faster time-to-first-token.

## Run locally

```bash
npm install
npm run dev
```

This runs the Vite dev server and the API proxy together. Open the URL Vite prints (usually `http://localhost:5173`).

1. Open **Settings** and paste your Groq API key.
2. **Start Mic** — audio is flushed on the interval you set (default 30s), transcribed, then a fresh batch of **3** suggestions is requested.
3. **Refresh** while recording forces an early flush (stop current segment → transcribe → suggestions). While idle, **Refresh** re-runs suggestions from the current transcript only.

**Note:** Groq’s Whisper docs recommend ~30s segments for best results; very short clips may fail or return empty text.

## Scripts

| Script            | Purpose                          |
| ----------------- | -------------------------------- |
| `npm run dev`     | Vite + proxy (default workflow)  |
| `npm run dev:client` | Vite only                     |
| `npm run dev:server` | Proxy only (`http://localhost:8787`) |
| `npm run build`   | Typecheck + production client bundle |
| `npm run lint`    | ESLint                           |

## Deployment note

`npm run build` produces static files only. For a public deployment you’ll need the proxy (or equivalent serverless routes) running alongside the frontend, with the same `/api/*` paths. A follow-up commit can add a host-specific layout (for example Vercel serverless handlers).

## Milestones

- **Commit 1:** Three-column UI, settings scaffolding, export.
- **Commit 2:** Groq integration (Whisper + GPT-OSS 120B), mic chunking, streaming chat, dev proxy.
