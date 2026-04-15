/**
 * Anthropic SDK mock factory.
 *
 * brain.service.ts instantiates `new Anthropic()` at module load (no API key required —
 * SDK reads ANTHROPIC_API_KEY lazily at call time). But we mock the SDK to avoid real
 * network calls and to let tests control the response.
 *
 * Usage:
 *   vi.mock('@anthropic-ai/sdk', () => ({ default: makeAnthropicMock(() => ({ ... })) }))
 */

import { vi } from "vitest"

export interface AnthropicResponse {
  // What Jesse's brain expects: JSON string as the text content
  response: string
  action?: string
  updates?: Record<string, any>
  claimJobId?: string | null
  negotiatedPayCents?: number
  confidence?: number
}

export function makeAnthropicJSON(resp: AnthropicResponse): string {
  return JSON.stringify({
    response: resp.response,
    action: resp.action ?? "NONE",
    updates: resp.updates ?? {},
    claimJobId: resp.claimJobId ?? null,
    negotiatedPayCents: resp.negotiatedPayCents ?? 0,
    confidence: resp.confidence ?? 0.9,
  })
}

/**
 * Returns a constructor-like class suitable for `default` export of @anthropic-ai/sdk.
 * `handler(msgOpts)` is called for each messages.create call and should return the raw
 * text content (typically a JSON string matching BrainOutput).
 */
export function makeAnthropicMock(handler: (msgOpts: any) => string | Promise<string>) {
  return class MockAnthropic {
    messages = {
      create: vi.fn(async (opts: any) => {
        const text = await handler(opts)
        return {
          content: [{ type: "text", text }],
        }
      }),
    }
  }
}

/** Mock that always throws — for chaos tests. */
export function makeAnthropicThrowMock(err: Error = new Error("API timeout")) {
  return class MockAnthropic {
    messages = {
      create: vi.fn(async () => {
        throw err
      }),
    }
  }
}
