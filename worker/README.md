# Server-side AI gateway

The browser must never contain model-provider secrets.

Target architecture:

Browser → server-side gateway → model API

Suggested structured operations:
- `/session/next`
- `/question/generate`
- `/answer/evaluate`
- `/resource/curate`
- `/benchmark/evaluate`

Validate inputs, apply the versioned prompts in `/prompts`, and return structured JSON. This directory intentionally contains no credentials.
