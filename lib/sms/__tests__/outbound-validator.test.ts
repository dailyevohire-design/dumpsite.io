import { describe, it, expect } from 'vitest'
import {
  validateOutbound,
  assertFallbackValid,
  FALLBACK_MESSAGE,
  BRACKET_ALLOWLIST,
} from '../outbound-validator'

describe('validateOutbound — hard blocks', () => {
  it('blocks bracket-prefixed state debug tags', () => {
    const cases = [
      '[RESCUE PHOTO_PENDING] hey jesse here',
      '[NO-SHOW 5] driver missing',
      '[APPROVAL REQUEST] needs review',
      '[STRANDED] driver off route',
      '  [PAYMENT] balance due',
    ]
    for (const body of cases) {
      const r = validateOutbound(body)
      expect(r.ok, `should block: ${body}`).toBe(false)
      if (!r.ok) expect(r.ruleName).toBe('BRACKET_PREFIX')
    }
  })

  it('allows [CONVERSATION RESET] sentinel via allowlist', () => {
    expect(validateOutbound('[CONVERSATION RESET]')).toEqual({ ok: true })
    expect(validateOutbound('  [CONVERSATION RESET]  ')).toEqual({ ok: true })
  })

  it('allows non-prefix brackets', () => {
    expect(validateOutbound('hey [john] when you arrive').ok).toBe(true)
    expect(validateOutbound('say [hi]').ok).toBe(true)
    expect(validateOutbound('drop pin: see [the spot]').ok).toBe(true)
  })

  it('blocks English persona leaks', () => {
    const cases = [
      'As an AI, I cannot help with that',
      "I'm an AI assistant",
      'I am a language model',
      "I don't have access to real-time data",
      'My training data shows',
      'I was trained on',
      "as an artificial intelligence i must say",
    ]
    for (const body of cases) {
      const r = validateOutbound(body)
      expect(r.ok, `should block: ${body}`).toBe(false)
      if (!r.ok) expect(r.ruleName).toBe('PERSONA_LEAK_EN')
    }
  })

  it('blocks Spanish persona leaks', () => {
    const cases = [
      'Soy una IA',
      'Soy un bot',
      'Soy un robot',
      'Como inteligencia artificial no puedo',
      'No tengo acceso en tiempo real',
      'Fui entrenado por',
    ]
    for (const body of cases) {
      const r = validateOutbound(body)
      expect(r.ok, `should block: ${body}`).toBe(false)
      if (!r.ok) expect(r.ruleName).toBe('PERSONA_LEAK_ES')
    }
  })

  it('blocks garbage output', () => {
    const cases = [
      'undefined',
      'value is undefined',
      'NaN miles to go',
      '[object Object]',
      '{"hello":"world"}',
      '[1,2,3]',
    ]
    for (const body of cases) {
      const r = validateOutbound(body)
      expect(r.ok, `should block: ${body}`).toBe(false)
      if (!r.ok) expect(r.ruleName).toBe('GARBAGE_OUTPUT')
    }
  })

  it('blocks unrendered template variables', () => {
    expect(validateOutbound('hi ${firstName}, your eta?').ok).toBe(false)
    expect(validateOutbound('hi {{name}}').ok).toBe(false)
  })

  it('blocks stack trace fragments', () => {
    const r = validateOutbound('something broke at handleConversation (brain.service.ts:266)')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.ruleName).toBe('STACK_TRACE_LEAK')
  })

  it('blocks error prefix lines', () => {
    const cases = [
      'TypeError: cannot read property of undefined',
      'Error: timeout',
      'ReferenceError: foo is not defined',
    ]
    for (const body of cases) {
      const r = validateOutbound(body)
      expect(r.ok, `should block: ${body}`).toBe(false)
      if (!r.ok) expect(r.ruleName).toBe('ERROR_PREFIX')
    }
  })

  it('blocks empty bodies', () => {
    expect(validateOutbound('').ok).toBe(false)
    expect(validateOutbound('   ').ok).toBe(false)
    expect(validateOutbound('\n\t').ok).toBe(false)
  })

  it('blocks oversized bodies', () => {
    const r = validateOutbound('a'.repeat(2000))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.ruleName).toBe('OVERSIZE_BODY')
  })

  it('handles non-string input defensively', () => {
    expect(validateOutbound(null as unknown as string).ok).toBe(false)
    expect(validateOutbound(undefined as unknown as string).ok).toBe(false)
    expect(validateOutbound(123 as unknown as string).ok).toBe(false)
  })
})

describe('validateOutbound — allows normal Jesse output', () => {
  it.each([
    'on my way',
    "10.4",
    'gimme 20 min',
    'pulling out now',
    'address sent',
    'I cannot help with that today',     // "cannot help" without persona qualifier
    'undefined yards in load',           // "undefined" inside larger sentence — still blocks (good)
    'driver name is Claude',             // explicitly allowed — no name-based rule
    'truck broke down, sec',
    "we're 5 min out",
    'load looks good',
  ])('allows: %s', (body) => {
    const r = validateOutbound(body)
    // Note: "undefined yards in load" SHOULD block — verify by separating the test
    if (body.includes('undefined') || body.includes('NaN')) {
      expect(r.ok).toBe(false)  // intentional — these words in outbound = bug
    } else {
      expect(r.ok, `should allow: ${body}`).toBe(true)
    }
  })
})

describe('validateOutbound — redactedBody truncation', () => {
  it('truncates redactedBody to 80 chars', () => {
    const longLeak = '[RESCUE ' + 'X'.repeat(200) + '] body'
    const r = validateOutbound(longLeak)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.redactedBody.length).toBeLessThanOrEqual(80)
    }
  })
})

describe('assertFallbackValid', () => {
  it('passes the production FALLBACK_MESSAGE', () => {
    expect(() => assertFallbackValid(FALLBACK_MESSAGE)).not.toThrow()
  })

  it('throws if fallback itself would fail validation', () => {
    expect(() => assertFallbackValid('')).toThrow(/OUTBOUND_VALIDATOR_BROKEN/)
    expect(() => assertFallbackValid('[RESCUE foo]')).toThrow(/OUTBOUND_VALIDATOR_BROKEN/)
    expect(() => assertFallbackValid('As an AI')).toThrow(/OUTBOUND_VALIDATOR_BROKEN/)
  })
})

describe('BRACKET_ALLOWLIST exports', () => {
  it('contains the conversation reset sentinel', () => {
    expect(BRACKET_ALLOWLIST.has('[CONVERSATION RESET]')).toBe(true)
  })
})
