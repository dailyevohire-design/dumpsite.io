// Pure access-type classifier extracted from customer-brain so it can be
// unit-tested without booting Anthropic. Keep in sync with the inline logic
// in customer-brain.service.ts (the brain reproduces it for now to avoid a
// large refactor; the rules below are the canonical reference).
//
// Per the truck-access rule: dump trucks go EVERYWHERE. Only 18-wheelers
// need access. So when in doubt the safe default is dump_truck_only — that
// option never blocks a delivery.

export type AccessType = "dump_truck_and_18wheeler" | "dump_truck_only"

export function classifyAccess(body: string, lastOutbound: string): AccessType | null {
  const lower = (body || "").toLowerCase()
  const lastOut = (lastOutbound || "").toLowerCase()

  const justAskedAccess = /\b(18.?wheeler|18 wheeler|big truck|big rig|semi|standard dump|regular dump|dump truck|access|fit|wider road|turn around|wider street|narrow|tight street)\b/i.test(lastOut)
  const mentions18Wheeler = /\b(18.?wheeler|18 wheeler|semi|big truck|big rig|tractor.?trailer|wheeler)\b/i.test(lower)
  const mentionsDumpTruckSpec = /\b(dump truck|dump trucks|regular truck|regular trucks|standard truck|standard trucks|tandem|triaxle|tri.?axle|quad axle|smaller truck|small truck|smaller trucks|small trucks|just dump|just standard|just the dump|just the standard|just regular|small ones|regular ones|standard ones|the dump ones)\b/i.test(lower)
  const isYes = /^(yes|yeah|yep|sure|ok|okay|si|dale|absolutely|definitely|perfect|ready)\b/i.test(lower) || /\b(lets do it|let's do it|sounds good|go ahead|book it|schedule it|set it up|do it|im down|i'm down|im in|i'm in|lets go|let's go|sure thing|sounds great|sounds perfect|that works|works for me|go for it|lock it in)\b/i.test(lower)
  const isNo = /^(no|nah|nope|pass|never mind|not now|not interested)\b/i.test(lower)
  const positiveSignal = isYes || /\b(sure|yep|yeah|of course|definitely|absolutely|they can|it can|room|plenty|wide|wide open|open|no problem|no issue|no big deal|no sweat|fits|can fit|will fit|works|fine|easy|big enough|enough room|huge|large)\b/i.test(lower)
  // "no" is excluded when it's followed by problem/issue/big deal/sweat —
  // those are positive idioms, not denials. Same goes for "not a problem".
  const negativeSignal = isNo || /\bno(?!\s+(problem|issue|big\s+deal|sweat|doubt))\b/i.test(lower) || /\b(nope|nah|cant|can.?t|wont|won.?t|cannot|wont fit|won.?t fit|cant fit|can.?t fit|too tight|too narrow|too small|narrow|tight|small|skinny|residential|driveway|alley)\b/i.test(lower)

  if (mentions18Wheeler && positiveSignal && !negativeSignal) return "dump_truck_and_18wheeler"
  if (mentions18Wheeler && negativeSignal) return "dump_truck_only"
  if (mentionsDumpTruckSpec) return "dump_truck_only"
  if (positiveSignal && !mentions18Wheeler) return "dump_truck_and_18wheeler"
  if (negativeSignal) return "dump_truck_only"
  if (justAskedAccess) return "dump_truck_only" // safe inclusive default
  return null
}
