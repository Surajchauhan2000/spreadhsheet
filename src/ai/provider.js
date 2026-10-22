// ─────────────────────────────────────────────────────────────
//  LLM provider abstraction.
//
//  The app never talks to a model directly — it talks to a
//  `provider`. A provider is any object with:
//
//      complete({ system, user, history }) => Promise<{ text, provider }>
//
//  `text` is the raw model output. You are expected to extract and
//  validate JSON from it yourself: models wrap JSON in prose, in code
//  fences, or return something that is not JSON at all.
//
//  Two providers ship with the repo:
//    • mock  — deterministic, offline, answers the prompts listed in
//              fixtures/ai-eval/*.json. Used by graders. The default.
//    • http  — YOURS. Call any LLM API you like (Anthropic, OpenAI,
//              Gemini, Ollama, …) with plain fetch(). Read the endpoint,
//              key and model from the VITE_AI_* env vars (.env.example).
//
//  Do not hard-code a vendor anywhere else: everything outside this
//  file must behave identically with either provider.
// ─────────────────────────────────────────────────────────────
import { createMockProvider } from './mockProvider.js'

/**
 * @typedef {{ role: 'user' | 'assistant', content: string }} ChatTurn
 * @typedef {{ system: string, user: string, history?: ChatTurn[] }} CompletionRequest
 * @typedef {{ text: string, provider: string }} CompletionResponse
 * @typedef {{ name: string, complete: (req: CompletionRequest) => Promise<CompletionResponse> }} Provider
 */

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}

/** @returns {Provider} */
/** @returns {Provider} Any OpenAI-compatible chat-completions endpoint (OpenAI, Gemini's compat endpoint, Groq, OpenRouter, Ollama...). */
export function createHttpProvider(config = {}) {
    const endpoint = config.endpoint ?? env.VITE_AI_ENDPOINT
    const apiKey = config.apiKey ?? env.VITE_AI_API_KEY
    const model = config.model ?? env.VITE_AI_MODEL

    return {
        name: 'http',
        async complete({ system, user, history = [] }) {
            if (!endpoint || !model) {
                throw new Error('HTTP provider is not configured: set VITE_AI_ENDPOINT and VITE_AI_MODEL (and VITE_AI_API_KEY) in .env.local, then restart the dev server')
            }
            const messages = [
                { role: 'system', content: system },
                ...history.map(({ role, content }) => ({ role, content })),
                { role: 'user', content: user },
            ]
            let res
            try {
                res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
                    body: JSON.stringify({ model, messages, temperature: 0 }),
                })
            } catch (e) {
                throw new Error(`Network error: could not reach the AI endpoint (${e.message})`)
            }
            if (!res.ok) {
                const body = (await res.text().catch(() => '')).slice(0, 300)
                if (res.status === 401 || res.status === 403) throw new Error(`Authentication failed (${res.status}): check VITE_AI_API_KEY. ${body}`)
                if (res.status === 429) throw new Error(`Rate limited (429): wait a moment and retry. ${body}`)
                throw new Error(`AI provider error ${res.status}: ${body}`)
            }
            let data
            try {
                data = await res.json()
            } catch {
                throw new Error('The AI endpoint returned a response that is not JSON')
            }
            const text = data?.choices?.[0]?.message?.content
            if (typeof text !== 'string' || text === '') throw new Error('The AI endpoint returned no message content')
            return { text, provider: 'http' }
        },
    }
}

/**
 * Pick a provider from VITE_AI_PROVIDER. Unknown values fall back to mock
 * so the app always boots.
 * @returns {Provider}
 */
export function createProvider(kind = env.VITE_AI_PROVIDER || 'mock') {
    if (kind === 'http') return createHttpProvider()
    return createMockProvider()
}
