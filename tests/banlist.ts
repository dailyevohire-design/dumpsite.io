/**
 * Shared banlist for Jesse output across all three test tiers.
 * Imported by Tier 1 (vitest), Tier 2 (LLM-judge), and Tier 3 (adversarial).
 *
 * U+2014 is the em-dash — Sarah/Jesse must never emit one.
 */

export const BANNED_TOKENS: RegExp[] = [
  /\bAI\b/,
  /\bbot\b/i,
  /\bautomation\b/i,
  /\blanguage model\b/i,
  /\bi'?m an assistant\b/i,
  /\bi am an? ?assistant\b/i,
  /—/,
]

export function findBannedToken(text: string): string | null {
  for (const re of BANNED_TOKENS) {
    const m = text.match(re)
    if (m) return m[0]
  }
  return null
}
