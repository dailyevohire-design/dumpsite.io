import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ============================================================
// generate_rep_posts
// AI content generator for rep Facebook Marketplace listings.
// Embeds FB Marketplace algorithm rules (from the user's research
// doc) directly in the Claude system prompt. Pairs each generated
// post with a fresh unused photo via claim_fresh_photo RPC, runs
// a title-hash uniqueness check against the rep's last 30 days,
// and inserts rows into public.rep_posts.
//
// REQUIRED ENV VARS:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   ANTHROPIC_API_KEY         (set this in Edge Function Secrets)
//
// OPTIONAL ENV VARS:
//   MODEL                     (default: claude-sonnet-4-6)
//
// Request body:
//   { rep_id, keyword_slot, city, state?, count?, base_date?, territory?, zone_miles? }
// ============================================================

interface GenerateRequest {
  rep_id: string;
  keyword_slot: string;
  city: string;
  state?: string;
  count?: number;
  base_date?: string;
  territory?: "suburban" | "urban" | "rural";
  zone_miles?: number;
}

const KEYWORD_SLOTS = [
  "fill_dirt","clean_fill","clean_dirt","select_fill",
  "structural_fill","topsoil","screened_dirt","bulk_dirt"
];

const SLOT_DESCRIPTORS: Record<string, {label:string; useCase:string; material:string}> = {
  fill_dirt:       {label:"Fill Dirt",        useCase:"backfill, grading, elevation changes",       material:"general fill dirt, unscreened"},
  clean_fill:      {label:"Clean Fill",       useCase:"backfill without organic material or debris",material:"clean fill dirt, no trash/concrete/roots"},
  clean_dirt:      {label:"Clean Dirt",       useCase:"landscape fill, basic backfill",             material:"clean dirt without rocks or roots"},
  select_fill:     {label:"Select Fill",      useCase:"structural compaction under slabs/pads",     material:"select fill, engineered for compaction"},
  structural_fill: {label:"Structural Fill",  useCase:"load-bearing pads, foundation prep",         material:"structural fill, engineered specification"},
  topsoil:         {label:"Topsoil",          useCase:"lawns, gardens, sod preparation, raised beds", material:"dark, screened topsoil, garden-ready"},
  screened_dirt:   {label:"Screened Dirt",    useCase:"landscape beds, tree wells, raised planters",material:"screened clean dirt, rock-free"},
  bulk_dirt:       {label:"Bulk Dirt",        useCase:"large fill projects, major grading",         material:"bulk fill dirt, truck-load quantities"},
};

const SYSTEM_PROMPT = `You are an expert Facebook Marketplace listing copywriter for a local dirt / fill delivery company. You write listings that pass FB Marketplace's 2026 anti-spam filters AND win on the algorithm's recency, relevance, and engagement scoring.

YOU MUST FOLLOW THESE RULES EXACTLY:

TITLE RULES:
- 50 to 70 characters (strict). Never under 50 or over 75.
- Title Case. Never ALL CAPS.
- No emojis. No special characters beyond | - , & .
- Include the product type (fill dirt, topsoil, etc.) AND city name AND state abbreviation.
- Pattern: [Modifier] [Product Term] [Feature] | [City] [State]
- Integrate 3-5 primary keywords naturally (not stuffed).
- Avoid these spam-trigger words: NOW, LOWEST, GUARANTEED, CHEAPEST, BEST PRICE, #1.
- Each title must be structurally different from the others you generate in the same batch.

DESCRIPTION RULES:
- 200 to 300 words total.
- First 140 characters: a hook. Front-load the condition/benefit ("Clean screened topsoil delivered by the yard to Mansfield homeowners and landscapers...").
- Structure: 2 short paragraphs + 3 bullet points + 1 trust/closing line.
- Include 1-2 local landmarks, nearby cities, or neighborhood references for relevance signal.
- Include a natural call-to-action ("Text with your address for same-day quote").
- Mention load sizes and delivery (e.g., "10 yard minimum, dump truck or 18-wheeler access needed").
- DO NOT include: phone numbers, URLs, email addresses, payment app handles, external links.
- DO NOT say: "call now", "best price guaranteed", "#1", "TODAY ONLY", "limited time".
- Avoid fake urgency. Avoid keyword stuffing. Sound like a real local operator, not an ad agency.
- Vary opening words across generations. Vary sentence structures. Vary vocabulary (dirt / material / fill).

LOCATION AUTHENTICITY:
- The rep lives in the city/state provided. Reference local details (neighborhoods, school districts, highway numbers, adjacent cities) that a local operator would actually mention.
- Never claim "serving all of Texas" or "nationwide". Stay local.

OUTPUT FORMAT:
- Respond with a single JSON object. No prose before or after. No markdown.
- Schema: { "listings": [{"title": string, "description": string, "post_location": string}] }
- post_location is the city/state string shown in the FB listing (e.g. "Mansfield, TX").
- Generate exactly the number of variants requested. Each must be materially different from the others.
`;

function buildUserPrompt(opts: {
  count: number;
  slotLabel: string;
  slotUseCase: string;
  slotMaterial: string;
  city: string;
  state: string;
  price: number;
  priorTitleHashes: string[];
  references: Array<{title:string; description:string}>;
}) {
  const ref = opts.references.length
    ? `REFERENCE EXAMPLES (past winning posts — match their voice, DO NOT copy):\n` +
      opts.references.map((r,i) => `  ${i+1}. TITLE: ${r.title}\n     DESC: ${r.description.slice(0,240)}...`).join("\n") + "\n\n"
    : "";
  const avoidList = opts.priorTitleHashes.length
    ? `Do not produce titles that match any of the following (these are already posted):\n${opts.priorTitleHashes.join(", ")}\n\n`
    : "";

  return `${ref}${avoidList}Generate ${opts.count} Facebook Marketplace listing${opts.count>1?"s":""} for:\n\nPRODUCT: ${opts.slotLabel} (${opts.slotMaterial})\nTYPICAL USE: ${opts.slotUseCase}\nLOCATION: ${opts.city}, ${opts.state}\nPRICE: $${opts.price}/yard\n\nEach variant must target a slightly different buyer intent or use case. For example, one might target homeowners, another landscapers, another small contractors. Vary the hook, the local reference, and the CTA.\n\nReturn the JSON object now.`;
}

async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY env var not set on this Edge Function");
  const model = Deno.env.get("MODEL") || "claude-sonnet-4-6";

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0.8,
      system: systemPrompt,
      messages: [{role:"user", content:userPrompt}],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${errText}`);
  }
  const data = await resp.json();
  const text = data?.content?.[0]?.text;
  if (!text || typeof text !== "string") throw new Error("Anthropic returned no text content");
  return text;
}

function extractJson(raw: string): any {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned);
}

async function md5Hex(s: string): Promise<string> {
  const normalized = s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(buf)).slice(0,16).map(b=>b.toString(16).padStart(2,"0")).join("");
}

Deno.serve(async (req: Request) => {
  const start = Date.now();
  if (req.method !== "POST") return new Response(JSON.stringify({error:"POST only"}),{status:405});

  let body: GenerateRequest;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({error:"Invalid JSON"}),{status:400}); }

  const {
    rep_id, keyword_slot, city,
    state = "TX", count = 1, base_date,
    territory = "suburban", zone_miles = 15,
  } = body;

  if (!rep_id || !keyword_slot || !city) {
    return new Response(JSON.stringify({error:"rep_id, keyword_slot, city are required"}),{status:400});
  }
  if (!KEYWORD_SLOTS.includes(keyword_slot)) {
    return new Response(JSON.stringify({error:`Invalid keyword_slot. Must be one of: ${KEYWORD_SLOTS.join(", ")}`}),{status:400});
  }
  if (count < 1 || count > 20) {
    return new Response(JSON.stringify({error:"count must be 1-20"}),{status:400});
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {auth:{persistSession:false}},
  );

  const {data: rep, error: repErr} = await supa.from("sales_reps").select("id, name, home_state, is_active").eq("id", rep_id).maybeSingle();
  if (repErr || !rep) return new Response(JSON.stringify({error:`Rep ${rep_id} not found`}),{status:404});
  if (!rep.is_active) return new Response(JSON.stringify({error:`Rep ${rep_id} is inactive`}),{status:400});
  if (rep.home_state && rep.home_state.toLowerCase() !== state.toLowerCase()) {
    return new Response(JSON.stringify({
      error: `Rep ${rep_id} lives in ${rep.home_state.toUpperCase()}, cannot post in ${state}. Cross-state blocked.`,
    }), {status: 400});
  }

  const {data: refs} = await supa
    .from("post_reference_examples")
    .select("example_title, example_description")
    .eq("is_active", true)
    .or(`keyword_slot.eq.${keyword_slot},keyword_slot.is.null`)
    .limit(3);
  const references = (refs ?? []).map(r => ({title:r.example_title, description:r.example_description}));

  const {data: recentPosts} = await supa
    .from("rep_posts").select("title, title_hash")
    .eq("rep_id", rep_id)
    .gte("created_at", new Date(Date.now() - 30*24*60*60*1000).toISOString())
    .limit(50);
  const priorTitleHashes = (recentPosts ?? []).map(p => p.title_hash).filter(Boolean) as string[];

  const {data: priceData} = await supa.rpc("price_for_keyword_slot", {p_keyword_slot: keyword_slot, p_zone_miles: zone_miles});
  const price = Number(priceData ?? 12);
  const {data: slotData} = await supa.rpc("pick_schedule_slots", {
    p_count: count,
    p_base_date: base_date ?? new Date().toISOString().slice(0,10),
    p_territory: territory,
  });
  const scheduleSlots: string[] = Array.isArray(slotData) ? slotData : [];

  const slotInfo = SLOT_DESCRIPTORS[keyword_slot];
  const userPrompt = buildUserPrompt({
    count,
    slotLabel: slotInfo.label,
    slotUseCase: slotInfo.useCase,
    slotMaterial: slotInfo.material,
    city, state, price,
    priorTitleHashes, references,
  });

  let generated: {listings: Array<{title:string; description:string; post_location:string}>};
  try {
    const raw = await callClaude(SYSTEM_PROMPT, userPrompt);
    generated = extractJson(raw);
    if (!Array.isArray(generated?.listings)) throw new Error("Response missing listings array");
  } catch (err) {
    return new Response(JSON.stringify({error:`Claude generation failed: ${err instanceof Error ? err.message : String(err)}`}),{status:500});
  }

  const created: Array<{id:string; title:string; scheduled_for:string; photo_url:string}> = [];
  const skipped: Array<{title:string; reason:string}> = [];

  for (let i = 0; i < generated.listings.length; i++) {
    const listing = generated.listings[i];
    if (!listing.title || !listing.description) {
      skipped.push({title: listing.title ?? "(empty)", reason: "missing_fields"});
      continue;
    }
    if (listing.title.length < 10 || listing.title.length > 120) {
      skipped.push({title: listing.title, reason: `title_length_${listing.title.length}`});
      continue;
    }

    const titleHash = await md5Hex(listing.title);
    if (priorTitleHashes.includes(titleHash)) {
      skipped.push({title: listing.title, reason: "duplicate_title"});
      continue;
    }

    const {data: photo, error: photoErr} = await supa.rpc("claim_fresh_photo", {p_rep_id: rep_id, p_media_type: "photo"}).single();
    if (photoErr || !photo) {
      skipped.push({title: listing.title, reason: `no_fresh_photo: ${photoErr?.message ?? "unknown"}`});
      continue;
    }

    const scheduledFor = scheduleSlots[i] ?? new Date(Date.now() + (i+1)*3600000).toISOString();

    const {data: inserted, error: insErr} = await supa.from("rep_posts").insert({
      rep_id,
      scheduled_for: scheduledFor,
      city,
      state: state.toLowerCase(),
      title: listing.title,
      description: listing.description,
      price,
      post_location: listing.post_location || `${city}, ${state.toUpperCase()}`,
      keyword_slot,
      primary_photo_id: (photo as any).media_id,
      photo_ids: [(photo as any).media_id],
      title_hash: titleHash,
      status: "queued",
      generated_by: "ai_generated",
    }).select("id, scheduled_for").single();

    if (insErr || !inserted) {
      skipped.push({title: listing.title, reason: `insert_failed: ${insErr?.message ?? "unknown"}`});
      continue;
    }

    created.push({
      id: inserted.id,
      title: listing.title,
      scheduled_for: inserted.scheduled_for,
      photo_url: (photo as any).public_url,
    });
    priorTitleHashes.push(titleHash);
  }

  return new Response(JSON.stringify({
    ok: true, rep_id, city, state, keyword_slot,
    requested: count, created_count: created.length, skipped_count: skipped.length,
    created, skipped, elapsed_ms: Date.now() - start,
  }), {
    status: 200,
    headers: {"Content-Type":"application/json"},
  });
});
