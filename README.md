# TwinMind Live Suggestions [[Link](https://twinmind-web-app.vercel.app/)]

A live meeting copilot that listens to your mic, transcribes what's being said,
and surfaces 3 useful suggestions every 30 seconds - questions to ask, talking
points, fact-checks, or clarifications based on the conversation.

## Stack

- React + TypeScript (Vite)
- Express proxy server (so your Groq API key never touches the browser)
- Whisper Large V3 for transcription
- GPT-OSS 120B for suggestions and chat

## Setup

```bash
npm install
npm run dev
```

Open http://localhost:5173, go to Settings, and paste your Groq API key.
The key is saved in your browser so you won't need to re-enter it.

## How to use it

1. Click **Start Mic** - it starts recording and will automatically transcribe
   and generate suggestions every 30 seconds.
2. Watch the **Live Suggestions** column - 3 new cards appear each cycle.
   Click any card to get a detailed answer in the chat panel.
3. Hit **Refresh** any time to force an early update without waiting.
4. You can also type questions directly in the chat panel on the right.
5. When you're done, click **Export Session** to download everything:
   transcript, all suggestion batches and the full chat as a JSON file.

## Prompt strategy

Suggestions are generated with the last 6 transcript chunks as context
(configurable in Settings). The model is asked to return exactly 3 suggestions
as structured JSON, with a mix of types chosen based on what's most useful
at that moment in the conversation.

Clicking a suggestion sends it to a separate, longer-form prompt with the last
12 transcript chunks for more context, so the detailed answer is grounded in
the full conversation so far.

Both prompts are editable in Settings if you want to experiment.

## Tradeoffs

- 30-second audio chunks work best with Whisper: shorter clips sometimes
  return empty text, so the default interval is intentional.
- The proxy adds a small hop but keeps the API key out of the browser entirely.
- Chat responses stream token by token for faster perceived latency.

## Deployment

Deployed on Vercel. The Express proxy runs as a serverless function via
`vercel.json` routing `/api/*` to `server/index.js`.
