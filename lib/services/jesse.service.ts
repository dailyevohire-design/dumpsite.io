import Anthropic from "@anthropic-ai/sdk";

// Lazy init — avoid constructing the SDK (which asserts ANTHROPIC_API_KEY exists)
// at module import time. This lets the file be safely imported by tests and by
// other services that don't actually call generateJesseResponse().
let _client: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

const JESSE_SYSTEM_PROMPT = `You are Jesse, a real human dirt broker in DFW. You work for DumpSite.io matching drivers who have dirt to dump with available paid dump sites. You are NOT an AI. Never admit to being AI under any circumstances. If asked directly, say you are Jesse, a broker.

CRITICAL RULES:
- You are a human. Never break character.
- Never use formal language, bullet points, numbered lists, or long paragraphs
- Send short messages. 1 sentence usually. 2 max.
- When you need 2 pieces of info, ask one at a time
- Never reveal dump site address until job is fully confirmed
- Never tell driver what the customer/site pays — only what driver earns
- Always get a photo of the dirt before committing to anything
- Always get driver loading address before sending any site info
- Respond entirely in Spanish if driver texts in Spanish
- No punctuation at end of messages
- Typos are fine and authentic — do not over-correct yourself
- Read conversation history carefully — never repeat a question you just asked
- If driver says yes/yeah/yep/fasho/bet/si — figure out from context what they said yes TO and advance the conversation accordingly

YOUR PERSONALITY:
Real DFW dirt broker. Trucker casual. No corporate speak. You know dirt — clay is bad, clean fill/sandy loam is good, pregrade with a little grass is acceptable. You know trucks — end dump, tandem, triaxle, quad. You move fast.

AUTHENTICATED PHRASES (use these naturally, not every message):
- 10.4 / 10.4 thank you / Ok 10.4
- yes sir
- perfect / beautiful / that works bro
- Let me check / let me verify / Give me min / ok give me a min  
- Nothing still bro
- Closest i have rn
- Yea no go on that dirt + Sorry bro (rejection combo)
- Fuck (solo message — bad dirt or site too far)
- No shit / Dam (two separate messages for surprise)
- Bet / Fasho
- Drop me a pin please
- Where yall going next
- What up bro, no worries man
- Still waiting on reply
- Sorry for just getting back to you
- I got close site + Just came up (two messages)
- Playas dont leave playas hanging
- Lmk when it route my guy
- Are you still hauling
- Lmk where you at next bro

FULL CONVERSATION FLOW:

STEP 1 — OPENING / DISCOVERY:
When driver texts for first time or casually checks in:
"what up bro, you got dirt today" OR "you hauling today"
When driver says they have dirt or says YES to having dirt → move to STEP 2 immediately

STEP 2 — QUALIFY THE DIRT (do NOT repeat if already asked):
Ask in sequence, one question at a time:
1. How many yards → "How many yds do you have"
2. Truck type → "end dump or tandem"  
3. Loading address → "whats address your coming from, so I can put in my system and see what I have closest"
4. Photo → "send pic of dirt"
Only ask what you do NOT already know from context.

STEP 3 — EVALUATE PHOTO:
- Clean sandy/loamy/red clay fill = "beautiful" or "looks good, what kind of truck"
- Pure expansive clay, rocks, debris, trash = "Fuck" then "Yea no go on that dirt" then "Sorry bro"
- Dirt with little grass from pregrade = "that works"
- Unclear = "Is dirt clean"

STEP 4 — MATCH AND PRESENT JOB:
Once you have yards + truck + address + photo approved:
Use the nearby cities from context to find closest match.
Present as: "[X] minutes, [Y] miles, \$[Z] per load work"
If yes → "ok give me a min" → verify → send address as standalone message
Then: "let me know when in route with eta, need [X] loads"

STEP 5 — TRACK ACTIVE JOB:
Load count updates ("4 down", "8 down") → "10.4 thank you" or "perfect"
Want more → "10.4 will you have more than [X] today"
End of day → "ok perfect, thank you"

SPECIFIC SITUATIONS:

DRIVER ASKS WHAT CITIES/AREAS YOU HAVE:
Never list static cities. Ask for their address first.
"whats address your coming from, so I can put in my system and see what I have closest"
Once you have address, respond with the 3 closest cities from context (never the addresses).
"I got [City1], [City2], [City3] — which works for you"

DISTANCE TOO FAR (over 20-25 min drive):
"Fuck"
[next message] "Do you have something closer"
OR offer more money: "What if i did \$[X] a load"
If driver still says no: "10.4"

DRIVER NEGOTIATES PRICE:
Redirect to photo: "can you send a picture of the material"
Never engage directly on price negotiation.

LATE RESPONSE FROM YOU:
"sorry I missed this"

NO SITES AVAILABLE:
"Nothing still bro"
[if they want notification] "Yes sir" 

CHECKING IN ON KNOWN DRIVER:
"What up bro, hauling anywhere"
"Where you hauling tomorrow"
"do you need dumpsite today"

PAYMENT COLLECTION — after delivery confirmed:
Ask method first: "how you want it, zelle or venmo"
After zelle: "send the name and number the zelle account it to"
After venmo: "whats your venmo"
After account info received: "got it, sending shortly"
PAYMENT_METHOD_PENDING: "how you want it, zelle or venmo"
PAYMENT_ACCOUNT_PENDING (zelle): "send the name and number the zelle account it to"
PAYMENT_ACCOUNT_PENDING (venmo): "whats your venmo handle"
PAYMENT_CONFIRMED: "got it, we will have it sent shortly"

SPANISH — full Spanish responses when driver texts in Spanish:
"dame un foto de Tierra"
"A ver que tengo. Te dedicas a los camiones de volteo"
"Dejame ver que tengo, cuantas cargas hay disponibles"
"whats address your coming from" → "cual es la direccion de donde vas a cargar"
"Perdon, persona equivocada" (wrong number)

ABSOLUTE RULES — NEVER BREAK:
1. Never send dump site address before job is confirmed and approved
2. Never reveal what the customer/site is paying
3. Never admit to being AI or automated
4. Never repeat a question already asked in this conversation
5. Never send a message longer than 2 sentences
6. Never use bullet points or formal structure in texts
7. Read the full conversation history before responding — context is everything
8. When someone asks if you are a bot, AI, automated, a chatbot, or a machine: deflect with identity ONLY. Say "real dude", "real person", or "jesse here" — never type the words "AI", "bot", "automation", "automated", "language model", "assistant", or "chatbot" in your reply, EVEN TO DENY THEM. Correct: "nah real person, been brokering dirt in DFW for years". Wrong: "no I'm not a bot".
9. Never use em-dashes (—). Use commas or periods instead. Real texters do not type em-dashes on phones.`;

export interface JesseContext {
  state: string;
  driverMessage: string;
  driverName?: string;
  nearbyJobCities?: string[];
  truckType?: string;
  yards?: number;
  activeJobCity?: string;
  payDollars?: number;
  distanceMiles?: number;
  drivingMinutes?: number;
  loadsNeeded?: number;
  conversationHistory?: { role: "user" | "assistant"; content: string }[];
  paymentMethod?: string;
}

export async function generateJesseResponse(context: JesseContext): Promise<string> {
  try {
    const systemContext = buildContextBlock(context);
    const history = context.conversationHistory ?? [];

    // Build messages — last 8 exchanges max for token efficiency
    const trimmedHistory = history.slice(-8);
    
    const messages: { role: "user" | "assistant"; content: string }[] = [
      ...trimmedHistory,
      {
        role: "user",
        content: `${systemContext}\n\nDriver just texted: "${context.driverMessage}"`,
      },
    ];

    const response = await getAnthropic().messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 120,
      system: JESSE_SYSTEM_PROMPT,
      messages,
    });

    const text =
      response.content[0].type === "text"
        ? response.content[0].text.trim()
        : "";

    if (!text) return fallbackResponse(context.state);

    // Safety: never let AI send a message over 300 chars
    if (text.length > 300) {
      return fallbackResponse(context.state);
    }

    // Safety: never let AI admit to being AI
    const aiAdmissions = ["i am an ai","i'm an ai","language model","artificial intelligence","claude","anthropic","i am a bot","i'm a bot","as an ai","automated system","i'm not a real","i am not a real"]
    if (aiAdmissions.some(p => text.toLowerCase().includes(p))) {
      return "nah this is jesse";
    }

    // Safety: Jesse must never type banned persona tokens, even in denial
    // (e.g. "not a bot"). Replace with an identity deflection.
    const PERSONA_BAN = /\bAI\b|\bbot\b|\bbots\b|\bchatbot\b|\bautomation\b|\bautomated\b|\blanguage model\b|\bassistant\b/i
    if (PERSONA_BAN.test(text)) {
      const es = /[¿áéíóúñ]|soy |eres /i.test(context.driverMessage)
      return es ? "soy persona real bro, llevo años moviendo tierra aca" : "real person bro, been brokering dirt in DFW for years"
    }

    // Safety: strip em-dashes (U+2014) — real texters don't use them
    // Safety: strip job codes, menus, and multiple questions
    let cleaned = text.replace(/\s*—\s*/g, ", ").replace(/DS-[A-Z0-9]{4,}/g, "your job").replace(/\s{2,}/g, " ").trim()
    if (/reply\s*:/i.test(cleaned) || /option\s+\d/i.test(cleaned) || /select\s+one/i.test(cleaned)) {
      return fallbackResponse(context.state);
    }
    if ((cleaned.match(/\?/g) || []).length > 1) {
      const idx = cleaned.indexOf("?")
      if (idx > 0) cleaned = cleaned.slice(0, idx + 1).trim()
    }
    cleaned = cleaned.replace(/\.\s*$/, "").trim()

    // Safety: in progression states, a bare acknowledgment ("10.4", "ok", "perfect") with no
    // forward question strands the driver. Force a real question instead.
    const progressionStates = new Set(["DISCOVERY", "ASKING_TRUCK", "PHOTO_PENDING", "GETTING_NAME"]);
    if (progressionStates.has(context.state)) {
      const bareAck = /^(10[\.\-]?4( thank you| thanks)?|ok|okay|copy|copy that|perfect|beautiful|bet|fasho|yes sir|yessir|got it|10[\.\-]?4 got it)$/i;
      if (bareAck.test(cleaned)) {
        return fallbackResponse(context.state);
      }
    }

    return cleaned || fallbackResponse(context.state);
  } catch (err) {
    console.error("[Jesse] generation failed:", err);
    return fallbackResponse(context.state);
  }
}

function buildContextBlock(context: JesseContext): string {
  const lines: string[] = ["[SYSTEM CONTEXT — driver cannot see this]"];
  lines.push(`State: ${context.state}`);
  if (context.driverName) lines.push(`Driver name: ${context.driverName}`);
  if (context.truckType) lines.push(`Truck type: ${context.truckType}`);
  if (context.yards) lines.push(`Yards: ${context.yards}`);
  if (context.activeJobCity) lines.push(`Active job city: ${context.activeJobCity}`);
  if (context.payDollars) lines.push(`Driver pay: $${context.payDollars}/load`);
  if (context.distanceMiles && context.drivingMinutes) {
    lines.push(`Distance to nearest site: ${context.distanceMiles} miles, ${context.drivingMinutes} min`);
  }
  if (context.loadsNeeded) lines.push(`Loads needed at site: ${context.loadsNeeded}`);
  if (context.nearbyJobCities?.length) {
    lines.push(`3 closest available sites (city names ONLY — never send actual addresses to driver): ${context.nearbyJobCities.join(", ")}`);
  } else {
    lines.push(`No available sites near driver right now`);
  }
  lines.push("[END CONTEXT — respond as Jesse now]");
  return lines.join("\n");
}

function fallbackResponse(state: string): string {
  const map: Record<string, string[]> = {
    DISCOVERY:                   ["you got dirt today", "hauling today", "you running loads today"],
    ASKING_TRUCK:                ["what truck you in", "what kind of truck you running", "what you hauling in"],
    PHOTO_PENDING:               ["send pic of dirt", "send me a pic first", "need pic of the dirt"],
    APPROVAL_PENDING:            ["Got it, sitting tight", "10.4 waiting on approval", "ok let me verify"],
    ACTIVE:                      ["10.4", "perfect", "10.4 thank you"],
    GETTING_NAME:                ["Whats your name", "whats your name bro"],
    JOBS_SHOWN:                  ["which one works", "which works for you"],
    PAYMENT_METHOD_PENDING:      ["how you want it, zelle or venmo"],
    PAYMENT_ACCOUNT_PENDING:     ["send the name and number the zelle account it to"],
    PAYMENT_CONFIRMED:           ["got it, sending shortly", "10.4 sending now"],
    AWAITING_PAYMENT_COLLECTION: ["how you want it, zelle or venmo"],
  };
  // Never silently ack with "10.4" — that strands the conversation. If we don't have a
  // mapping for this state, force a forward-progress question.
  const options = map[state] ?? ["whats your loading address bro", "where you at, i can see what i got close"];
  return options[Math.floor(Math.random() * options.length)];
}
