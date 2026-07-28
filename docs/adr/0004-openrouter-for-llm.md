# ADR 0004 — OpenRouter for every LLM call

- **Status:** accepted, 2026-07-15
- **Deciders:** Shreyas

## Context

The app needs LLM calls for chat, prescription vision, support-ticket
triage, and voice transcription. The natural options are direct
vendor APIs (Anthropic for Claude, Google for Gemini, OpenAI for
Whisper) or a router (OpenRouter, Portkey, LiteLLM).

## Decision

Route everything through OpenRouter with a single `OPENROUTER_API_KEY`.
The `MODEL` env var picks the chat model (default
`anthropic/claude-haiku-4.5`); voice transcription is hardcoded to
`google/gemini-2.5-flash` because Anthropic's models have no audio input.

## Consequences

- **Positive:** One API, one billing surface, one key to rotate. Swapping
  chat model is an env-var change with no code touch. Provider outages
  are usually confined to one route in OpenRouter's mesh.
- **Negative:** OpenRouter takes a ~5% margin. Latency has an extra hop
  (~50 ms). When something misbehaves — e.g. a provider silently
  changing structured-output behaviour — we're one abstraction layer
  removed from vendor support.
- **Reversible?** Yes, one file: `src/lib/openrouter.ts`. Swap
  `createOpenAI` for the vendor SDK, use a per-vendor key. But we'd
  lose the "swap models with one env change" magic.
