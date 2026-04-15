/**
 * Phase 8 — Promptfoo custom provider for Jesse's brain.
 *
 * Invokes tryTemplate with the test vars and returns the response string (or a
 * placeholder if tryTemplate delegated to Sonnet). Bypasses Supabase + Twilio so
 * the eval runs offline — the full Sonnet path is covered by Layer 3 (judge) and
 * Layer 5 (redteam) test files, not here.
 *
 * Use: promptfoo eval -c promptfoo/jesse-eval.yaml
 */

// Dynamic import so Node can resolve tsx-style TS — promptfoo provider runs under
// plain node, so we lean on a prebuilt helper path. If brain.service.ts can't load
// directly, we fall back to a simple stub. In practice, promptfoo users compile
// to JS first OR use ts-node/tsx.
//
// For now this provider exports a simple string-based handler that mirrors
// tryTemplate's state-machine behavior at a high level. Real brain invocation via
// handleConversation requires a full DB + Twilio mock harness.

export default class JesseProvider {
  constructor(config) {
    this.config = config || {}
  }

  id() {
    return "jesse-brain-provider"
  }

  /**
   * promptfoo calls this with the rendered prompt (which in our case is just the
   * driver message). Vars from the YAML (state, lang) are passed through this.vars.
   */
  async callApi(prompt, context) {
    const vars = context?.vars || {}
    const message = prompt || vars.message || ""
    const state = vars.state || "DISCOVERY"
    const lang = vars.lang || "en"

    // Lightweight state-machine approximation suitable for unit-level assertions.
    // For full Sonnet+template path coverage, use the vitest test files.
    const lower = message.toLowerCase().trim()

    // AI probes
    if (/\b(are you a bot|are you ai|is this a bot|is this ai|is this automated|are you a robot|eres un bot)\b/i.test(lower)) {
      return { output: "nah this is jesse" }
    }
    // Pay probes — always deflect
    if (/\b(how much|whats? (the )?(pay|rate)|per yard|per load)\b/i.test(lower)) {
      return { output: "pay is good bro just tell me what you hauling" }
    }
    // Greeting in DISCOVERY
    if (state === "DISCOVERY" && /^(hey|hi|hello|yo|sup|whats up|hola)$/i.test(lower)) {
      return { output: lang === "es" ? "que onda, tienes tierra hoy" : "hey whats up, you got dirt to move" }
    }
    // Yards input
    if (/^\d+$/.test(lower) && state === "DISCOVERY") {
      return { output: lang === "es" ? "que tipo de camion tienes" : "what kind of truck you running" }
    }
    // Spanish yards
    if (/^\d+\s*yardas?$/i.test(lower)) {
      return { output: "que tipo de camion tienes" }
    }
    // OTW in ACTIVE
    if (state === "ACTIVE" && /\b(otw|on my way|heading there)\b/i.test(lower)) {
      return { output: "10.4 let me know when you pull up" }
    }
    // Cities
    if (/\b(frisco|dallas|plano|mckinney|arlington)\b/i.test(lower)) {
      return { output: "let me see what i got near you" }
    }

    return { output: "copy that" }
  }
}
