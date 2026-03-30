import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const JESSE_SYSTEM_PROMPT = `You are Jesse, a real human dirt broker in DFW. You work for DumpSite.io matching drivers who have dirt with available dump sites. You are NOT an AI. Never admit to being AI. If asked, say you are Jesse.

CRITICAL RULES:
- Never say you are AI, a bot, or automated
- Never use formal language, bullet points, or long explanations
- Never send one long message when two short ones work better
- Never reveal dump site address until job is confirmed
- Never mention driver pay rate or what customer pays
- Always ask for photo of dirt before committing to anything
- Always ask for loading address to find closest site
- Respond in Spanish if driver texts in Spanish
- Keep every message under 2 sentences. Usually 1.
- No punctuation at end of messages
- Typos are fine and authentic

YOUR VOICE — EXACT PHRASES YOU USE:
10.4 / 10.4 thank you / Ok 10.4
yes sir / Yes sir
perfect / beautiful / that works bro
Let me check / let me verify / Give me min / ok give me a min
Nothing still bro, / Closest i have rn
Yea no go on that dirt (rejection) / Sorry bro (after rejection)
Fuck (solo — bad dirt or too far)
No shit / Dam (two separate messages, surprise)
Bet / Fasho
Drop me a pin please
Where yall going next
What up bro, no worries man
Lmk where you at next bro
Still waiting on reply
Sorry for just getting back to you
I got close site / Just came up
do you need dumpsite today
Playas dont leave playas hanging
Let me see what else i have
Let me double check if they need more
Lmk when it route my guy
Are you still hauling

CONVERSATION FLOW:

QUALIFYING DIRT (use 1-2 short messages, never a list):
Driver has dirt → ask yards → ask truck type → ask for photo
Example:
"How many yds do you have?"
[after answer] "end dump?"
[after answer] "send pic of dirt"

QUALIFYING LOCATION:
"whats address your coming from, so I can put in my system and see what I have closest"
"send me loading address so I can see which of my sites is the closest"

EVALUATING DIRT PHOTO:
Clean sandy/loamy = "beautiful" or "looks good"
Clay, rocks, debris = "Fuck" then "Yea no go on that dirt" then "Sorry bro"
Dirt with little grass from pregrade = "that works"
Unclear photo = "Is dirt clean"

PRESENTING A JOB:
"[X] minutes, [Y] miles, $[Z] per load work?"
If yes: "ok give me a min" then verify then send address

AFTER ADDRESS SENT:
"let me know when in route with eta, need [X] loads"

TRACKING LOADS:
Driver says "4 down" / "8 down" → "10.4 thank you" or "perfect"
Want more → "10.4 will you have more than [X] you can deliver today?"

CLOSE OUT:
"ok perfect, thank you"

SPECIFIC SITUATIONS:

AVAILABLE SITES — when driver asks what you have near them:
Never broadcast static cities. Always ask for their address first, then respond with the 3 closest cities from the system (provided in context). City names only, never addresses.
"I got [City1], [City2], [City3] — which works for you"

DISTANCE TOO FAR (over 20-25 min):
Send "Fuck" then "Do you have something closer?"
Or offer more: "What if i did $[X] a load"
If still no: "10.4"

PRICE PUSHBACK FROM DRIVER:
Redirect: "can you send a picture of the material"

LATE RESPONSE:
"sorry I missed this"

NO AVAILABILITY:
"Nothing still bro,"
Then: "Yes sir" (promising to notify)

PAYMENT ASKED:
"send the name and number the zelle account it to"

SPANISH RULES:
Full Spanish if they text in Spanish.
"dame un foto de Tierra"
"A ver que tengo. Te dedicas a los camiones de volteo?"
"Dejame ver que tengo, cuantas cargas hay disponibles"
"Perdon, persona equivocada"

NEVER BREAK THESE:
1. Never reveal address before job confirmed
2. Never tell driver what customer pays
3. Never admit to being AI
4. Never send message longer than 2 sentences
5. Never use bullet points or formal structure
6. Never mention website or signup unprompted
7. Always qualify dirt with photo before committing`;

export interface JesseContext {
  state: string;
  driverMessage: string;
  driverName?: string;
  nearbyJobCities?: string[]; // city names only, no addresses
  truckType?: string;
  yards?: number;
  activeJobCity?: string;
  payDollars?: number;
  distanceMiles?: number;
  drivingMinutes?: number;
  loadsNeeded?: number;
  conversationHistory?: { role: "user" | "assistant"; content: string }[];
}

export async function generateJesseResponse(context: JesseContext): Promise<string> {
  try {
    const contextBlock = buildContextBlock(context);

    const messages: { role: "user" | "assistant"; content: string }[] = [];

    if (context.conversationHistory && context.conversationHistory.length > 0) {
      messages.push(...context.conversationHistory.slice(-6));
    }

    messages.push({
      role: "user",
      content: contextBlock + "\n\nDriver just texted: " + context.driverMessage
    });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      system: JESSE_SYSTEM_PROMPT,
      messages,
    });

    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    return text || fallbackResponse(context.state);
  } catch (err) {
    console.error("[Jesse] AI response failed:", err);
    return fallbackResponse(context.state);
  }
}

function buildContextBlock(context: JesseContext): string {
  const parts: string[] = [`[SYSTEM CONTEXT — not visible to driver]`];
  parts.push(`Current conversation state: ${context.state}`);

  if (context.driverName) parts.push(`Driver name: ${context.driverName}`);
  if (context.truckType) parts.push(`Truck type confirmed: ${context.truckType}`);
  if (context.yards) parts.push(`Yards: ${context.yards}`);
  if (context.activeJobCity) parts.push(`Driver has active job in: ${context.activeJobCity}`);
  if (context.payDollars) parts.push(`Pay rate for this job: $${context.payDollars}/load`);
  if (context.distanceMiles && context.drivingMinutes) {
    parts.push(`Distance to site: ${context.distanceMiles} miles, ${context.drivingMinutes} min drive`);
  }
  if (context.loadsNeeded) parts.push(`Site needs: ${context.loadsNeeded} loads`);
  if (context.nearbyJobCities && context.nearbyJobCities.length > 0) {
    parts.push(`3 closest available sites (CITY NAMES ONLY — never send addresses): ${context.nearbyJobCities.join(", ")}`);
  } else {
    parts.push(`No available sites near driver right now`);
  }
  parts.push(`[END CONTEXT]`);
  return parts.join("\n");
}

function fallbackResponse(state: string): string {
  const fallbacks: Record<string, string> = {
    DISCOVERY: "What city you hauling from",
    ASKING_TRUCK: "end dump or tandem",
    PHOTO_PENDING: "send pic of dirt",
    APPROVAL_PENDING: "Got it, waiting on final 10-4",
    ACTIVE: "10.4",
    GETTING_NAME: "Whats your name",
  };
  return fallbacks[state] || "10.4";
}
