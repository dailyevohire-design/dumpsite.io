import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
- First 140 characters: a hook. Front-load the condition/benefit.
- Structure: 2 short paragraphs + 3 bullet points + 1 trust/closing line.
- Include 1-2 local landmarks, nearby cities, or neighborhood references for relevance signal.
- Include a natural call-to-action.
- Mention load sizes and delivery (e.g., "10 yard minimum, dump truck or 18-wheeler access needed").
- DO NOT include: phone numbers, URLs, email addresses, payment app handles, external links.
- DO NOT say: "call now", "best price guaranteed", "#1", "TODAY ONLY", "limited time".
- Avoid fake urgency. Avoid keyword stuffing. Sound like a real local operator.
- Vary opening words across generations. Vary sentence structures. Vary vocabulary.

LOCATION AUTHENTICITY:
- The rep lives in the city/state provided. Reference local details that a local operator would actually mention.
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
  variationNote?: string;
}) {
  const ref = opts.references.length
    ? `REFERENCE EXAMPLES (past winning posts — match their voice, DO NOT copy):\n` +
      opts.references.map((r,i) => `  ${i+1}. TITLE: ${r.title}\n     DESC: ${r.description.slice(0,240)}...`).join("\n") + "\n\n"
    : "";
  const avoidList = opts.priorTitleHashes.length
    ? `Do not produce titles that match any of the following (these are already posted):\n${opts.priorTitleHashes.join(", ")}\n\n`
    : "";
  const variation = opts.variationNote ? `\nIMPORTANT: ${opts.variationNote}\n\n` : "";

  return `${ref}${avoidList}${variation}Generate ${opts.count} Facebook Marketplace listing${opts.count>1?"s":""} for:\n\nPRODUCT: ${opts.slotLabel} (${opts.slotMaterial})\nTYPICAL USE: ${opts.slotUseCase}\nLOCATION: ${opts.city}, ${opts.state}\nPRICE: $${opts.price}/yard\n\nEach variant must target a slightly different buyer intent or use case. Vary the hook, the local reference, and the CTA.\n\nReturn the JSON object now.`;
}

interface CallClaudeOpts {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxAttempts?: number;
}

async function callClaudeWithRetry(opts: CallClaudeOpts): Promise<{text: string; attempts: number}> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY env var not set on this Edge Function");
  const model = Deno.env.get("MODEL") || "claude-sonnet-4-6";
  const maxAttempts = opts.maxAttempts ?? 3;
  const backoffsMs = [0, 2000, 5000];

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (backoffsMs[attempt - 1]) await new Promise(r => setTimeout(r, backoffsMs[attempt - 1]));
    try {
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
          temperature: opts.temperature ?? 0.8,
          system: opts.systemPrompt,
          messages: [{role:"user", content: opts.userPrompt}],
        }),
      });

      if (resp.status >= 500 || resp.status === 429) {
        lastErr = new Error(`Anthropic ${resp.status}: retryable`);
        continue;
      }
      if (!resp.ok) {
        const errText = await resp.text();
        const err = new Error(`Anthropic ${resp.status} (non-retryable): ${errText.slice(0, 500)}`);
        (err as any).nonRetryable = true;
        (err as any).status = resp.status;
        throw err;
      }
      const data = await resp.json();
      const text = data?.content?.[0]?.text;
      if (!text || typeof text !== "string") {
        lastErr = new Error("Anthropic returned no text content");
        continue;
      }
      return { text, attempts: attempt };
    } catch (e: any) {
      if (e?.nonRetryable) throw e;
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error("Anthropic call failed after retries");
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

async function logAlert(
  supa: any,
  rep_id: string,
  alert_type: string,
  severity: "info"|"warning"|"critical",
  payload: Record<string, unknown>
) {
  try {
    await supa.from("rep_content_alerts").insert({ rep_id, alert_type, severity, payload });
  } catch { /* alerting must never throw */ }
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
      error: `Rep ${rep_id} lives in ${rep.home_state.toUpperCase()}, cannot post in ${state}.`,
    }), {status: 400});
  }

  const {data: refs} = await supa
    .from("post_reference_examples")
    .select("example_title, example_description")
    .eq("is_active", true)
    .or(`keyword_slot.eq.${keyword_slot},keyword_slot.is.null`)
    .limit(3);
  const references = (refs ?? []).map((r: any) => ({title:r.example_title, description:r.example_description}));

  const {data: recentPosts} = await supa
    .from("rep_posts").select("title, title_hash")
    .eq("rep_id", rep_id)
    .gte("created_at", new Date(Date.now() - 30*24*60*60*1000).toISOString())
    .limit(50);
  const priorTitleHashes = (recentPosts ?? []).map((p: any) => p.title_hash).filter(Boolean) as string[];

  const {data: priceData} = await supa.rpc("price_for_keyword_slot", {p_keyword_slot: keyword_slot, p_zone_miles: zone_miles});
  const price = Number(priceData ?? 12);
  const {data: slotData} = await supa.rpc("pick_schedule_slots", {
    p_count: count,
    p_base_date: base_date ?? new Date().toISOString().slice(0,10),
    p_territory: territory,
  });
  const scheduleSlots: string[] = Array.isArray(slotData) ? slotData : [];

  const slotInfo = SLOT_DESCRIPTORS[keyword_slot];

  const created: Array<{id:string; title:string; scheduled_for:string; photo_url:string; attempts:number}> = [];
  const skipped: Array<{title:string; reason:string; attempts:number}> = [];
  let anthropicAttempts = 0;

  // Phase 1: initial generation with retry
  let generated: {listings: Array<{title:string; description:string; post_location:string}>};
  try {
    const result = await callClaudeWithRetry({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt({
        count, slotLabel: slotInfo.label, slotUseCase: slotInfo.useCase, slotMaterial: slotInfo.material,
        city, state, price, priorTitleHashes, references,
      }),
      temperature: 0.8,
    });
    anthropicAttempts += result.attempts;
    generated = extractJson(result.text);
    if (!Array.isArray(generated?.listings)) throw new Error("Response missing listings array");
  } catch (err: any) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const alertType = err?.nonRetryable ? "anthropic_4xx" : (errMsg.includes("retryable") ? "anthropic_5xx_after_retry" : "malformed_response");
    await logAlert(supa, rep_id, alertType, "critical", { error: errMsg, city, state, keyword_slot });
    return new Response(JSON.stringify({error:`Claude generation failed: ${errMsg}`, alert_logged: alertType}),{status:500});
  }

  // Phase 2: per-listing processing with regeneration on collision
  for (let i = 0; i < generated.listings.length; i++) {
    let listing = generated.listings[i];
    let listingAttempts = 1;
    let resolved = false;

    for (let regen = 0; regen <= 2 && !resolved; regen++) {
      if (regen > 0) {
        // Regenerate this single listing with higher temperature + variation note
        try {
          const result = await callClaudeWithRetry({
            systemPrompt: SYSTEM_PROMPT,
            userPrompt: buildUserPrompt({
              count: 1,
              slotLabel: slotInfo.label, slotUseCase: slotInfo.useCase, slotMaterial: slotInfo.material,
              city, state, price, priorTitleHashes, references,
              variationNote: "Produce a creative variation that differs structurally from typical patterns. Use uncommon but accurate vocabulary, vary the hook, and reference a different local landmark or buyer persona than usual.",
            }),
            temperature: 0.95,
          });
          anthropicAttempts += result.attempts;
          const regen_obj = extractJson(result.text);
          if (Array.isArray(regen_obj?.listings) && regen_obj.listings[0]?.title) {
            listing = regen_obj.listings[0];
            listingAttempts++;
          } else {
            break;
          }
        } catch {
          break;
        }
      }

      // Validate
      if (!listing.title || !listing.description) {
        skipped.push({title: listing.title ?? "(empty)", reason: "missing_fields", attempts: listingAttempts});
        await logAlert(supa, rep_id, "malformed_response", "warning", { reason: "missing_fields", city, state });
        resolved = true;
        break;
      }
      if (listing.title.length < 10 || listing.title.length > 120) {
        skipped.push({title: listing.title, reason: `title_length_${listing.title.length}`, attempts: listingAttempts});
        await logAlert(supa, rep_id, "malformed_response", "warning", { reason: "title_length", length: listing.title.length, city, state });
        resolved = true;
        break;
      }

      // Dedup check
      const titleHash = await md5Hex(listing.title);
      if (priorTitleHashes.includes(titleHash)) {
        if (regen >= 2) {
          skipped.push({title: listing.title, reason: "dedup_collision_after_retry", attempts: listingAttempts});
          await logAlert(supa, rep_id, "dedup_collision_after_retry", "warning", { title: listing.title, city, state, keyword_slot });
          resolved = true;
        }
        continue; // try regen
      }

      // Photo claim
      const {data: photo, error: photoErr} = await supa.rpc("claim_fresh_photo", {p_rep_id: rep_id, p_media_type: "photo"}).single();
      if (photoErr || !photo) {
        skipped.push({title: listing.title, reason: `no_fresh_photo: ${photoErr?.message ?? "unknown"}`, attempts: listingAttempts});
        await logAlert(supa, rep_id, "no_fresh_photo", "critical", { error: photoErr?.message ?? "unknown", rep_id });
        resolved = true;
        break;
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
        generation_attempts: listingAttempts,
      }).select("id, scheduled_for").single();

      if (insErr || !inserted) {
        skipped.push({title: listing.title, reason: `insert_failed: ${insErr?.message ?? "unknown"}`, attempts: listingAttempts});
        await logAlert(supa, rep_id, "generation_failed", "critical", { reason: "insert_failed", error: insErr?.message ?? "unknown", title: listing.title });
        resolved = true;
        break;
      }

      created.push({
        id: inserted.id,
        title: listing.title,
        scheduled_for: inserted.scheduled_for,
        photo_url: (photo as any).public_url,
        attempts: listingAttempts,
      });
      priorTitleHashes.push(titleHash);
      resolved = true;
    }
  }

  return new Response(JSON.stringify({
    ok: true, rep_id, city, state, keyword_slot,
    requested: count, created_count: created.length, skipped_count: skipped.length,
    anthropic_attempts: anthropicAttempts,
    created, skipped, elapsed_ms: Date.now() - start,
  }), {
    status: 200,
    headers: {"Content-Type":"application/json"},
  });
});
