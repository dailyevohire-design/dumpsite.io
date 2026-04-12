// Pure helper extracted from customer-brain.service so it's unit-testable
// without booting the Anthropic/Twilio clients at module load.
//
// Common non-name words that the patterns below can accidentally capture.
// Checked against EVERY captured token, not the joined string, so two-word
// captures like "really tired" are rejected on "really".
//
// CRITICAL: this list MUST be comprehensive. A single missed stopword causes
// the bot to greet the customer with a non-name like "Do 10 yards of fill
// dirt..." which is embarrassing and breaks trust. Err on the side of
// blocking — real first names that collide with English stopwords are very
// rare (Al, Ed, Bo) and the customer can re-state if needed.
const NAME_BLOCKLIST = /^(hey|hi|hello|good|this|that|just|still|also|really|very|much|some|more|been|your|have|has|had|need|needs|needing|want|wants|wanting|fill|dirt|sand|topsoil|clean|cheap|free|best|nice|great|here|there|tired|busy|done|sure|maybe|fine|ok|okay|yes|no|not|from|with|about|looking|checking|interested|inquiring|texting|calling|do|does|did|doing|done|go|goes|going|went|gone|is|are|was|were|be|being|will|would|could|should|may|might|must|can|cant|wont|am|you|your|yours|me|my|mine|we|our|ours|us|they|their|them|he|him|his|she|her|hers|it|its|of|or|to|at|on|in|by|as|an|a|the|and|but|so|if|then|when|where|how|what|why|who|which|like|even|only|ever|never|always|please|thanks|thank|tho|though|stuff|thing|things|guys|guy|y|ya|yall|yo|um|uh|hmm|huh|ahh|aww|sup|whats|whatup|wassup|let|lets|gonna|wanna|gotta|kinda|sorta|prob|probably|definitely|tomorrow|today|tonight|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|hola|gracias|si|sí|no|tierra|terreno|paisajismo|césped|cesped|pasto|jardín|jardin|yardas|yarda|para|por|el|la|los|las|que|de|en|un|una|mi|tu|su|nuestro|necesito|quiero|busco|estoy|interesado|interesada|buenos|buenas|días|dias)$/i

export function extractCustomerName(body: string): string | null {
  // "I'm Mike", "this is José", "Its John"
  // "John from fb", "Mike here", "José texting about dirt"
  // "me llamo Carlos", "me llamó Anthony" (the accented verb form is common in
  // SMS — customers reach for the past tense "[someone] called me Anthony" but
  // they mean "I'm Anthony"), "soy Carlos", "mi nombre es Carlos"
  //
  // CRITICAL: "hey" / "hi" / "hello" / "hola" / "thanks" / "gracias" are NOT
  // self-introductions — they're vocatives (the customer addressing Sarah by
  // agent name). "Hey John, need 10 yards" must NOT capture John as the
  // customer name. That bug shipped Tim's order as "John" on 2026-04-11.
  const m = body.match(/(?:i'm|im|i am|this is|it's|its|my name is|name's|names|me\s+llam[oó]|mi\s+nombre\s+es|soy)\s+([\p{L}][\p{L}]+)/iu)
    || body.match(/^([\p{L}][\p{L}]+)\s+(?:from|here|checking|looking|interested|wanting|needing|inquiring|texting|calling)\b/iu)
  if (m) {
    const candidate = m[1].trim()
    const tokens = candidate.split(/\s+/)
    if (tokens.some(t => NAME_BLOCKLIST.test(t))) return null
    return candidate
  }
  // ── BARE NAME FALLBACK ──
  // Customer was asked for their name and replied with just a name — possibly
  // a multi-word Latino full name like "Antony Andrés alemán peña". Accept up
  // to 5 letter-only tokens, no digits, none in the blocklist. Capitalization
  // is intentionally NOT required because customers text in lowercase.
  const trimmed = body.trim()
  if (trimmed.length < 2 || trimmed.length > 60) return null
  if (/\d/.test(trimmed)) return null
  if (!/^[\p{L}\s'.-]+$/u.test(trimmed)) return null
  const tokens = trimmed.split(/\s+/)
  if (tokens.length < 1 || tokens.length > 5) return null
  if (tokens.some(t => NAME_BLOCKLIST.test(t))) return null
  if (tokens[0].length < 2) return null
  return trimmed
}
