/**
 * CP3 Tier 1 — Jesse output safety regex guard.
 *
 * Deterministic: no LLM calls, no network. Scans every canned fallback string
 * in jesse.service.ts for banned tokens ("AI", "bot", "automation", "language
 * model", "I'm an assistant", em-dash U+2014) and validates the banlist detector
 * that all other tiers (LLM-judge, adversarial) depend on.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { findBannedToken } from '../banlist'

describe('Jesse safety — banlist detector', () => {
  it('catches the word "AI" in isolation', () => {
    expect(findBannedToken('I am an AI')).not.toBeNull()
  })
  it('catches "bot" case-insensitive', () => {
    expect(findBannedToken("I'm a Bot")).not.toBeNull()
    expect(findBannedToken("not a bot bro")).not.toBeNull()
  })
  it('catches "language model"', () => {
    expect(findBannedToken('as a language model I cannot')).not.toBeNull()
  })
  it('catches "automation"', () => {
    expect(findBannedToken('This is automation')).not.toBeNull()
  })
  it('catches em-dash U+2014', () => {
    expect(findBannedToken('frisco 12 miles — 30 yds')).toBe('—')
  })
  it('passes clean trucker text', () => {
    expect(findBannedToken('10.4 thank you bro')).toBeNull()
    expect(findBannedToken('send pic of dirt')).toBeNull()
    expect(findBannedToken('what up bro, you got dirt today')).toBeNull()
  })
  it('does not flag unrelated capital letters', () => {
    expect(findBannedToken('SAID yes to haul')).toBeNull()
    expect(findBannedToken('RSVP by 5pm')).toBeNull()
  })
})

describe('Jesse source file — fallback responses', () => {
  const src = readFileSync(join(process.cwd(), 'lib/services/jesse.service.ts'), 'utf8')

  // Scope extraction to the fallbackResponse() map — lines like
  //   DISCOVERY: ["you got dirt today", "hauling today", ...],
  // Skip the AI-admission banlist and the authenticated-phrase prompt.
  const mapLineRe = /^\s*[A-Z_]+:\s*\[([^\]]+)\],?\s*$/gm
  const fallbackStrings: string[] = []
  let match: RegExpExecArray | null
  while ((match = mapLineRe.exec(src)) !== null) {
    const body = match[1]
    const strs = body.match(/"[^"]+"/g) || []
    for (const s of strs) fallbackStrings.push(s.slice(1, -1))
  }

  it('extracts at least 20 fallback strings', () => {
    expect(fallbackStrings.length).toBeGreaterThan(20)
  })

  it('no fallback string contains banned tokens', () => {
    const offenders = fallbackStrings
      .map(s => ({ s, hit: findBannedToken(s) }))
      .filter(x => x.hit !== null)
    if (offenders.length > 0) {
      console.error('OFFENDING FALLBACKS:', offenders)
    }
    expect(offenders).toEqual([])
  })

  it('AI-admission override string "nah this is jesse" is clean', () => {
    expect(findBannedToken('nah this is jesse')).toBeNull()
  })

  it('the banlist explicitly covered in the source guard', () => {
    // Jesse's guard at jesse.service.ts already banlists these variants
    expect(src).toContain('i am an ai')
    expect(src).toContain('language model')
    expect(src).toContain('anthropic')
    expect(src).toContain('claude')
  })
})

describe('Jesse source file — structure', () => {
  const src = readFileSync(join(process.cwd(), 'lib/services/jesse.service.ts'), 'utf8')
  it('uses claude-haiku model id (non-negotiable pinned)', () => {
    expect(src).toMatch(/claude-haiku-4-5/)
  })
  it('has max_tokens cap to prevent runaway responses', () => {
    expect(src).toMatch(/max_tokens:\s*\d+/)
  })
  it('Anthropic init is lazy (not module-level)', () => {
    expect(src).not.toMatch(/^const client = new Anthropic/m)
    expect(src).toMatch(/function getAnthropic/)
  })
})
