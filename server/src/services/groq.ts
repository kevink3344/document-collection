/**
 * Groq API client service.
 *
 * Responsibilities:
 *  - Typed request / response wrappers
 *  - Per-request timeout (15 s)
 *  - 1 automatic retry with 500 ms back-off
 *  - Hard token cap per request
 *  - Per-user rate limiting (in-memory, max 10 calls / hour)
 *
 * The API key is read from process.env at call time and is never logged.
 */

// ── Constants ────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 15_000
const MAX_RETRIES = 1
const RETRY_DELAY_MS = 500

/** Hard cap on tokens the model may generate per request. */
export const GROQ_MAX_TOKENS = 1_024

/** Maximum allowed "days" value for a reports summary request. */
export const GROQ_MAX_DATE_RANGE_DAYS = 90

/** Max AI summary calls a single user may make per hour. */
const RATE_LIMIT_PER_HOUR = 10

// ── Types ────────────────────────────────────────────────────────────────────

export interface GroqMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface GroqApiResponse {
  choices: {
    message: { content: string }
    finish_reason: string
  }[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface GroqResult {
  content: string
  finishReason: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

// ── Rate limiter ─────────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number
  windowStart: number
}

const rateLimitStore = new Map<string | number, RateLimitEntry>()

/**
 * Returns true if the user is allowed to make another request.
 * Increments the counter when allowed.
 */
export function checkRateLimit(userId: string | number): boolean {
  const now = Date.now()
  const windowMs = 60 * 60 * 1_000

  const entry = rateLimitStore.get(userId)

  if (!entry || now - entry.windowStart > windowMs) {
    rateLimitStore.set(userId, { count: 1, windowStart: now })
    return true
  }

  if (entry.count >= RATE_LIMIT_PER_HOUR) {
    return false
  }

  entry.count += 1
  return true
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function getGroqConfig(): { url: string; key: string; model: string } {
  const url = process.env.GROQ_API_URL
  const key = process.env.GROQ_API_KEY
  const model = process.env.GROQ_MODEL

  if (!url || !key || !model) {
    throw new Error('Groq is not configured. Set GROQ_API_URL, GROQ_API_KEY, and GROQ_MODEL.')
  }

  return { url, key, model }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Sends a chat completion request to Groq.
 * Retries once on transient failures (network errors / 5xx).
 * Never includes the API key in logs or thrown error messages.
 */
export async function callGroq(
  messages: GroqMessage[],
  maxTokens: number = GROQ_MAX_TOKENS,
): Promise<GroqResult> {
  const { url, key, model } = getGroqConfig()

  const body = JSON.stringify({
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.3,
    response_format: { type: 'json_object' },
  })

  let lastError: Error = new Error('Groq request failed')

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await delay(RETRY_DELAY_MS * attempt)

    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body,
        },
        TIMEOUT_MS,
      )

      // Client errors (4xx) are not retried
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`Groq API returned ${response.status} — check model name and key.`)
      }

      if (!response.ok) {
        // 5xx — eligible for retry
        lastError = new Error(`Groq API returned ${response.status}`)
        continue
      }

      const data = (await response.json()) as GroqApiResponse
      const choice = data.choices?.[0]

      if (!choice?.message?.content) {
        throw new Error('Groq returned an empty response.')
      }

      return {
        content: choice.message.content,
        finishReason: choice.finish_reason ?? 'unknown',
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new Error('Groq request timed out.')
        continue
      }
      // Re-throw non-retryable errors immediately
      if (err instanceof Error && !err.message.startsWith('Groq API returned 5')) {
        throw err
      }
      if (err instanceof Error) lastError = err
    }
  }

  throw lastError
}
