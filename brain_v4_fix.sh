#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# DumpSite Brain v4 — COMPLETE FLOW TEMPLATED
# Every step of the dispatch flow is hardcoded.
# Sonnet only fires for: photo eval, negotiation, off-topic
# ═══════════════════════════════════════════════════════════════
cd ~/dumpsite-io || { echo "ERROR: not in dumpsite-io"; exit 1; }

echo "═══════════════════════════════════════════════════"
echo "  DumpSite Brain v4 — Full Flow Templates"
echo "═══════════════════════════════════════════════════"

cp lib/services/brain.service.ts lib/services/brain.service.ts.bak4
echo "✓ Backup saved"

python3 << 'BRAINV4'
import re, sys, os

BRAIN = "lib/services/brain.service.ts"
with open(BRAIN, "r") as f:
    brain = f.read()

print(f"Read {len(brain)} chars")

# ══════════════════════════════════════════════════════
# 1. FIX MODEL STRING
# ══════════════════════════════════════════════════════
brain = re.sub(r'"claude-[^"]*"', '"claude-sonnet-4-6"', brain, count=1)
print("  1. Model → claude-sonnet-4-6")

# ══════════════════════════════════════════════════════
# 2. FIND AND REPLACE THE ENTIRE tryTemplate FUNCTION
# ══════════════════════════════════════════════════════

# Find tryTemplate boundaries
tpl_start = brain.find("function tryTemplate(")
if tpl_start == -1:
    print("ERROR: Cannot find tryTemplate")
    sys.exit(1)

# Find the closing brace by counting braces
brace_count = 0
tpl_end = tpl_start
started = False
for ci in range(tpl_start, len(brain)):
    if brain[ci] == '{':
        brace_count += 1
        started = True
    elif brain[ci] == '}':
        brace_count -= 1
        if started and brace_count == 0:
            tpl_end = ci + 1
            break

NEW_TEMPLATE = r'''function tryTemplate(
  body: string, lower: string, hasPhoto: boolean,
  conv: any, profile: any, lang: "en"|"es",
  nearbyJobs: any[], activeJob: any, isKnownDriver: boolean,
): { response: string; updates: Record<string,any>; action: string } | null {
  const state = conv?.state || "DISCOVERY"
  const firstName = profile?.first_name || ""
  const hasYards = !!conv?.extracted_yards
  const hasTruck = !!conv?.extracted_truck_type
  const hasTruckCount = !!conv?.extracted_truck_count
  const hasCity = !!conv?.extracted_city && conv.extracted_city !== "__PIN__"
  const hasPhotoStored = !!conv?.photo_public_url

  // ═══════════════════════════════════════════════════
  // STOP / START — always handled
  // ═══════════════════════════════════════════════════
  if (lower === "stop" || lower === "unsubscribe") {
    return { response: "", updates: {}, action: "STOP" }
  }
  if (lower === "start") {
    return { response: pick(["Yea you back on","You good now"]), updates: {}, action: "START" }
  }

  // ═══════════════════════════════════════════════════
  // OTW — driver is on their way (any active/OTW state)
  // ═══════════════════════════════════════════════════
  if (/\b(on my way|otw|heading there|headed there|leaving now|en camino|voy para alla|saliendo|on the way|im on my way|i.?m otw|bout to leave|pulling out|headed to site|ya voy|voy pa ya)\b/i.test(lower) && (state === "ACTIVE" || state === "OTW_PENDING")) {
    return { response: pick(lang==="es" ? ["10.4 avisame cuando llegues","dale avisame cuando estes ahi"] : ["10.4 let me know when you pull up","10.4"]), updates: { state: "OTW_PENDING" }, action: "NONE" }
  }

  // ═══════════════════════════════════════════════════
  // ADDRESS RESEND — driver lost the address
  // ═══════════════════════════════════════════════════
  if (/\b(resend|send again|lost.*address|what was the address|address again|direccion de nuevo|manda la direccion|whats the addy again|donde era|send it again)\b/i.test(lower) && (state === "ACTIVE" || state === "OTW_PENDING")) {
    return { response: "__RESEND_ADDRESS__", updates: {}, action: "RESEND_ADDRESS" }
  }

  // ═══════════════════════════════════════════════════
  // DONE / FINISHED — driver completed but no load count
  // ═══════════════════════════════════════════════════
  if (/^(done|finished|all done|wrapped up|that.?s it|that.?s all|terminamos|termin[eé]|listo ya|ya terminamos)$/i.test(lower) && (state === "ACTIVE" || state === "OTW_PENDING")) {
    return { response: pick(lang==="es" ? ["cuantas cargas tiraste","cuantas cargas en total"] : ["how many loads total","how many loads you drop"]), updates: {}, action: "NONE" }
  }

  // ═══════════════════════════════════════════════════
  // LOAD COUNT — driver reporting loads delivered
  // ═══════════════════════════════════════════════════
  const loadMatch = lower.match(/^(\d{1,3})\s*(loads?|down|total|done|delivered|drops?|cargas?)?$/) 
                 || lower.match(/(done|delivered|dropped|tiramos)\s*(\d{1,3})/i)
  if (loadMatch && activeJob && (state === "ACTIVE" || state === "OTW_PENDING")) {
    const loads = parseInt(loadMatch[1] || loadMatch[2])
    if (loads > 0 && loads <= 100) {
      return { response: "__DELIVERY__:" + loads, updates: { state: "AWAITING_CUSTOMER_CONFIRM" }, action: "COMPLETE_JOB" }
    }
  }

  // ═══════════════════════════════════════════════════
  // PAYMENT METHOD
  // ═══════════════════════════════════════════════════
  if (state === "PAYMENT_METHOD_PENDING") {
    if (/zelle/i.test(lower)) {
      return { response: pick(lang==="es" ? ["mandame el nombre y numero de tu zelle"] : ["send the name and number the zelle account it to"]), updates: { state: "PAYMENT_ACCOUNT_PENDING", job_state: "zelle" }, action: "NONE" }
    }
    if (/venmo/i.test(lower)) {
      return { response: pick(lang==="es" ? ["mandame tu venmo"] : ["whats your venmo"]), updates: { state: "PAYMENT_ACCOUNT_PENDING", job_state: "venmo" }, action: "NONE" }
    }
    if (/check|cheque/i.test(lower)) {
      return { response: pick(lang==="es" ? ["mandame tu direccion para el cheque"] : ["send me your address for the check"]), updates: { state: "PAYMENT_ACCOUNT_PENDING", job_state: "check" }, action: "NONE" }
    }
    return { response: pick(lang==="es" ? ["como quieres que te paguemos, zelle o venmo"] : ["how you want it, zelle or venmo"]), updates: {}, action: "NONE" }
  }

  // ═══════════════════════════════════════════════════
  // PAYMENT ACCOUNT
  // ═══════════════════════════════════════════════════
  if (state === "PAYMENT_ACCOUNT_PENDING") {
    const looksLikeAccount = /\d{7,}/.test(body) || /@/.test(body) || /^@?\w{3,}$/.test(body.trim()) || /^[A-Z][a-z]+ [A-Z][a-z]+/.test(body.trim()) || /^[a-z]+\s+[a-z]+$/i.test(body.trim()) || /^[a-z]+\s+\d{3}/.test(body.trim().toLowerCase())
    if (looksLikeAccount) {
      return { response: pick(lang==="es" ? ["listo, te mandamos en rato"] : ["got it, we will have it sent shortly"]), updates: { state: "CLOSED" }, action: "COLLECT_PAYMENT" }
    }
    const method = conv?.job_state || "zelle"
    if (method === "venmo") return { response: lang==="es" ? "mandame tu venmo" : "whats your venmo", updates: {}, action: "NONE" }
    return { response: lang==="es" ? "mandame el nombre y numero de tu zelle" : "send the name and number the zelle account it to", updates: {}, action: "NONE" }
  }

  // ═══════════════════════════════════════════════════
  // APPROVAL PENDING — waiting for customer
  // ═══════════════════════════════════════════════════
  if (state === "APPROVAL_PENDING") {
    // Driver is asking about status while waiting for customer approval
    return { response: pick(lang==="es" ? ["todavia esperando confirmacion, dame un min","dejame verificar"] : ["still waiting on them, give me a min","let me check on that"]), updates: {}, action: "NONE" }
  }

  // ═══════════════════════════════════════════════════
  // THE MAIN QUALIFICATION + DISPATCH FLOW
  // Steps: yards → truck → truck count → address → show job → photo → approve
  // ═══════════════════════════════════════════════════

  // ── YES / AFFIRMATIVE — advance to next missing piece ──
  const isYes = /^(yes|yeah|yep|yea|yessir|yessirr|bet|fasho|si|fs|sure|absolutely|for sure|copy|10-4|ok|okay|yup|hell yeah|of course|definitely|correct|right|affirmative|dale|simon|claro|lets go|lets do it|down|im down|send it|works for me|that works|sounds good)$/i.test(lower)

  // After job was presented → driver accepted → ask for photo
  if (isYes && state === "JOB_PRESENTED") {
    return { response: pick(lang==="es" ? ["mandame una foto de la tierra","dame una foto de la tierra"] : ["send me a pic of the dirt","send me a picture of the material"]), updates: { state: "PHOTO_PENDING" }, action: "NONE" }
  }

  // General yes during qualification → go to next missing piece
  if (isYes && (state === "DISCOVERY" || state === "GETTING_NAME" || state === "ASKING_TRUCK" || state === "ASKING_TRUCK_COUNT" || state === "ASKING_ADDRESS")) {
    if (!hasYards) {
      return { response: pick(lang==="es" ? ["cuantas yardas hay disponibles","cuantas yardas tienen"] : ["how many yards are available","how many yards you got available"]), updates: {}, action: "NONE" }
    }
    if (!hasTruck) {
      return { response: pick(lang==="es" ? ["que tipo de camion tienes","que clase de camion traes"] : ["what kind of truck are you hauling in","what kind of truck you running"]), updates: { state: "ASKING_TRUCK" }, action: "NONE" }
    }
    if (!hasTruckCount) {
      return { response: pick(lang==="es" ? ["cuantas camionetas tienes corriendo","cuantos camiones traes"] : ["how many trucks you got running","how many trucks you running"]), updates: { state: "ASKING_TRUCK_COUNT" }, action: "NONE" }
    }
    if (!hasCity) {
      return { response: pick(lang==="es" ? ["cual es la direccion de donde van a cargar, para ver cual de mis sitios les queda mas cerca"] : ["whats the address your coming from so I can put into my system and see which site is closest","whats addy your coming from so I can see which of my sites is closest"]), updates: { state: "ASKING_ADDRESS" }, action: "NONE" }
    }
    return null // Everything collected, let Sonnet handle
  }

  // ── YARDS GIVEN ──
  const yardMatch = lower.match(/^(\d+)\s*(yds?|yards?|yardas?)?\s*$/)
  if (yardMatch && !activeJob && !hasYards) {
    const yards = parseInt(yardMatch[1])
    if (yards > 0 && yards < 50000) {
      return { response: pick(lang==="es" ? ["que tipo de camion tienes","que clase de camion traes"] : ["what kind of truck are you hauling in","what kind of truck you running"]), updates: { extracted_yards: yards, state: "ASKING_TRUCK" }, action: "NONE" }
    }
  }

  // ── TRUCK TYPE GIVEN ──
  const truckPatterns: [RegExp, string][] = [
    [/tandem|tandum|tan\s*dem/i, "tandem_axle"],
    [/tri.?ax|triax/i, "tri_axle"],
    [/quad/i, "quad_axle"],
    [/end.?dump/i, "end_dump"],
    [/belly/i, "belly_dump"],
    [/side.?dump/i, "side_dump"],
    [/volteo|camion de volteo/i, "end_dump"],
  ]
  for (const [rx, val] of truckPatterns) {
    if (rx.test(lower) && (state === "ASKING_TRUCK" || state === "DISCOVERY" || !hasTruck)) {
      return { response: pick(lang==="es" ? ["cuantas camionetas tienes corriendo","cuantos camiones traes"] : ["how many trucks you got running","how many trucks you running"]), updates: { extracted_truck_type: val, state: "ASKING_TRUCK_COUNT" }, action: "NONE" }
    }
  }

  // ── TRUCK COUNT GIVEN ──
  const isCount = /^(\d{1,2})\s*(trucks?|camion(es)?|rigs?)?$/i.test(lower) || /^(just me|solo|one|uno|two|dos|three|tres)$/i.test(lower)
  if (isCount && state === "ASKING_TRUCK_COUNT") {
    let count = 1
    if (/^\d/.test(lower)) count = parseInt(lower)
    else if (/two|dos/i.test(lower)) count = 2
    else if (/three|tres/i.test(lower)) count = 3
    
    return { response: pick(lang==="es" 
      ? ["cual es la direccion de donde van a cargar, para ver cual de mis sitios les queda mas cerca"]
      : ["whats the address your coming from so I can put into my system and see which site is closest","whats addy your coming from so I can see which of my sites is closest"]), 
      updates: { extracted_truck_count: count, state: "ASKING_ADDRESS" }, action: "NONE" }
  }

  // ── ADDRESS GIVEN — find nearest job and present it ──
  // Detect if message looks like an address (has numbers + street words OR is a known city)
  const looksLikeAddress = /\d+\s+\w+.*(st|ave|blvd|dr|rd|ln|ct|way|pkwy|hwy|street|avenue|drive|road|lane|expy|expressway)/i.test(body) || /\d+\s+\w+\s+\w+/.test(body)
  
  if (looksLikeAddress && (state === "ASKING_ADDRESS" || (!hasCity && state !== "ACTIVE" && state !== "OTW_PENDING" && state !== "PHOTO_PENDING" && state !== "APPROVAL_PENDING" && state !== "JOB_PRESENTED"))) {
    // We have address — need to present job
    // Extract city from the address
    const cityNames = ["Dallas","Fort Worth","Arlington","Plano","Frisco","McKinney","Allen","Garland","Irving","Mesquite","Carrollton","Richardson","Lewisville","Denton","Mansfield","Grand Prairie","Euless","Bedford","Hurst","Grapevine","Southlake","Keller","Colleyville","Flower Mound","Little Elm","Celina","Prosper","Anna","Blue Ridge","Rockwall","Rowlett","Sachse","Wylie","Waxahachie","Midlothian","Cleburne","Burleson","Joshua","Cedar Hill","DeSoto","Lancaster","Duncanville","Ferris","Red Oak","Forney","Kaufman","Terrell","Royse City","Fate","Heath","Sunnyvale","Coppell","Addison","Farmers Branch","North Richland Hills","Richland Hills","Watauga","Haltom City","Saginaw","Azle","Weatherford","Granbury","Sherman","Denison","Gordonville","Corsicana","Ennis","Crowley","Glenn Heights","Kennedale"]
    let extractedCity = null as string | null
    for (const c of cityNames) {
      if (body.toLowerCase().includes(c.toLowerCase())) { extractedCity = c; break }
    }
    
    if (extractedCity && nearbyJobs.length > 0) {
      // Present best job with pay
      const job = nearbyJobs[0]
      const payDollars = Math.round(job.driverPayCents / 100)
      const resp = lang === "es"
        ? `Tengo ${job.cityName} ${job.distanceMiles.toFixed(0)} millas de ti, ${job.yardsNeeded} yardas — $${payDollars}/carga — te sirve`
        : `I got ${job.cityName} ${job.distanceMiles.toFixed(0)} miles from you, ${job.yardsNeeded} yards available — $${payDollars}/load — think that works`
      return { response: resp, updates: { extracted_city: extractedCity, state: "JOB_PRESENTED", pending_approval_order_id: job.id }, action: "NONE" }
    }
    
    if (extractedCity && nearbyJobs.length === 0) {
      return { response: pick(lang==="es" ? ["no tengo nada cerca de ahi ahorita, dejame ver que puedo conseguir"] : ["nothing near there right now, let me see what I can find"]), updates: { extracted_city: extractedCity }, action: "NONE" }
    }
    
    // Could not extract city — let Sonnet ask for clarification
    return null
  }

  // ── PHOTO RECEIVED during PHOTO_PENDING — let Sonnet evaluate ──
  if (hasPhoto && state === "PHOTO_PENDING") {
    return null // Sonnet evaluates the dirt photo
  }

  // ── Driver sends photo at any other time — let Sonnet handle ──
  if (hasPhoto) {
    return null
  }

  // ═══════════════════════════════════════════════════
  // NOTHING MATCHED — let Sonnet handle it
  // (negotiation, off-topic, corrections, complex situations)
  // ═══════════════════════════════════════════════════
  return null
}'''

brain = brain[:tpl_start] + NEW_TEMPLATE + brain[tpl_end:]
print("  2. tryTemplate COMPLETELY rewritten with full dispatch flow")


# ══════════════════════════════════════════════════════
# 3. FIX THE TEMPLATE WIRE — handle JOB_PRESENTED → CLAIM_JOB
# ══════════════════════════════════════════════════════

# Find where template results are processed and make sure
# we handle the new actions and states properly

# Find "if (tpl !== null)" block
tpl_wire = brain.find("if (tpl !== null)")
if tpl_wire == -1:
    print("  ERROR: Cannot find template wire block")
    sys.exit(1)

# Find the closing brace of this if block
bc = 0
wire_end = tpl_wire
started = False
for ci in range(tpl_wire, len(brain)):
    if brain[ci] == '{': bc += 1; started = True
    elif brain[ci] == '}':
        bc -= 1
        if started and bc == 0:
            wire_end = ci + 1
            break

NEW_WIRE = r'''if (tpl !== null) {
    const toSaveTpl: Record<string,any> = { ...enrichedConv, ...tpl.updates }
    
    // Handle STOP
    if (tpl.action === "STOP") {
      const sb = createAdminSupabase()
      try { await sb.from("driver_profiles").update({ sms_opted_out: true }).eq("phone", phone) } catch {}
      return ""
    }
    
    // Handle START
    if (tpl.action === "START") {
      const sb = createAdminSupabase()
      try { await sb.from("driver_profiles").update({ sms_opted_out: false }).eq("phone", phone) } catch {}
      await logMsg(phone, tpl.response, "outbound", `tpl_${sid}`)
      return tpl.response
    }
    
    // Handle address resend
    if (tpl.action === "RESEND_ADDRESS" && activeJob?.client_address) {
      await saveConv(phone, toSaveTpl)
      await logMsg(phone, activeJob.client_address, "outbound", `tpl_${sid}`)
      return activeJob.client_address
    }
    
    // Handle delivery completion
    if (tpl.action === "COMPLETE_JOB" && tpl.response.startsWith("__DELIVERY__:")) {
      const loads = parseInt(tpl.response.split(":")[1]) || 1
      if (activeJob) {
        const reply = await handleDelivery(phone, conv, profile, activeJob, loads, lang, sid)
        await logMsg(phone, reply, "outbound", `del_${sid}`)
        return reply
      }
    }
    
    // Handle payment collection
    if (tpl.action === "COLLECT_PAYMENT") {
      const method = enrichedConv.job_state || conv?.job_state || "zelle"
      await savePaymentInfo(phone, method, body.trim())
      await sendSMS(ADMIN_PHONE, `PAYMENT: ${phone} — ${method} — ${body.trim()}${enrichedConv.pending_pay_dollars ? " — $"+enrichedConv.pending_pay_dollars : ""}`, `adm_${sid}`).catch(()=>{})
    }
    
    // Handle job presentation — claim the job
    if (tpl.updates.state === "JOB_PRESENTED" && tpl.updates.pending_approval_order_id) {
      try {
        const claimed = await atomicClaimJob(tpl.updates.pending_approval_order_id, phone, profile?.user_id || null)
        if (claimed) {
          toSaveTpl.reservation_id = (claimed as any).reservationId || null
        }
      } catch {}
    }
    
    await saveConv(phone, toSaveTpl)
    const validatedTpl = validateResponse(tpl.response, null, toSaveTpl.state || convState, lang)
    await logMsg(phone, validatedTpl, "outbound", `tpl_${sid}`)
    return validatedTpl
  }'''

brain = brain[:tpl_wire] + NEW_WIRE + brain[wire_end:]
print("  3. Template wire block updated with all action handlers")


# ══════════════════════════════════════════════════════
# 4. MAKE SURE SONNET PROMPT INCLUDES PHOTO APPROVAL FLOW
# ══════════════════════════════════════════════════════

# Find JESSE_PROMPT and add photo→approval→address flow
prompt_start = brain.find("const JESSE_PROMPT = `")
prompt_close = -1
i = prompt_start + len("const JESSE_PROMPT = `")
depth = 0
while i < len(brain):
    if brain[i] == '`' and brain[i-1] != '\\':
        prompt_close = i; break
    if brain[i] == '$' and i+1 < len(brain) and brain[i+1] == '{': depth += 1
    if brain[i] == '}' and depth > 0: depth -= 1
    i += 1

if prompt_close == -1:
    print("  ERROR: Cannot find prompt close")
    sys.exit(1)

NEW_PROMPT = r'''const JESSE_PROMPT = `You are Jesse from DumpSite.io. Real dirt broker in DFW Texas. You match dump truck drivers with paid dump sites. NOT an AI. If asked you are Jesse.

HOW YOU TEXT — STRICT RULES:
- 1 sentence max. 3-8 words ideal. Sometimes 2 sentences for complex stuff, NEVER more.
- No punctuation at end. No periods.
- No bullet points, lists, menus, or "Reply X" EVER.
- One question per message only.
- Never repeat a question from history.
- Read full history before responding.
- If driver says something unexpected, respond to that first.
- Spanish = respond 100% Spanish entire conversation.
- Max 1 "bro" per conversation.

YOUR PHRASES:
Acknowledge: "10.4" / "bet" / "fasho" / "copy" / "yes sir" / "got it"
Time: "give me a min" / "let me check" / "let me verify"
Good dirt: "beautiful" / "looks good" / "that works"
Bad dirt: just "Fuck" then "yea no go on that dirt"
OTW prompt: "text me when on the way" (NOT "lmk" NOT "let me know")
Late: "my bad just saw this"

WHEN DRIVER SENDS PHOTO (state=PHOTO_PENDING):
- Evaluate the dirt in the photo
- Clean fill (sandy/loamy/reddish-brown/caliche/some grass): respond "looks good give me a min" and set action to SEND_FOR_APPROVAL
- Bad dirt (pure clay/rocks/debris/trash/concrete): respond "Fuck" then on next line "yea no go on that dirt"
- Unclear: "is dirt clean"
- ALWAYS set action to SEND_FOR_APPROVAL if dirt looks acceptable

NEGOTIATION (driver pushes on price):
Start at floor. Pushback = +$5. At ceiling = "that is the best I got" — NEVER exceed.

JOBS: "[City] [X] miles, [yards] available — $[pay]/load — think that works"
Never show addresses. Never show job codes.

OFF-TOPIC (driver asks random stuff, says hello again, corrects you, vents):
Respond naturally like a real person. Short. Then if appropriate, steer back to business.

OUTPUT: JSON only
{"response":"text","action":"NONE|CLAIM_JOB|SEND_ADDRESS|SEND_FOR_APPROVAL|COMPLETE_JOB|CANCEL_JOB|COLLECT_PAYMENT|NEGOTIATE|RESEND_ADDRESS","updates":{"state":"string or null","extracted_city":null,"extracted_yards":0,"extracted_truck_type":null,"extracted_truck_count":0,"pending_approval_order_id":null,"negotiated_pay_cents":0},"claimJobId":null,"negotiatedPayCents":0,"confidence":0.95}`'''

brain = brain[:prompt_start] + NEW_PROMPT + brain[prompt_close+1:]
print("  4. JESSE_PROMPT updated with photo approval instructions")


# ══════════════════════════════════════════════════════
# 5. HANDLE SEND_FOR_APPROVAL ACTION FROM SONNET
# ══════════════════════════════════════════════════════

# Find where brain actions are executed (after "EXECUTE ACTIONS")
execute_section = brain.find("// ── EXECUTE ACTIONS")
if execute_section == -1:
    execute_section = brain.find("if (brain.action === \"CLAIM_JOB\"")

if execute_section != -1:
    # Add SEND_FOR_APPROVAL handler
    approval_handler = r'''
  // Handle photo approval — brain approved the dirt, send to customer
  if (brain.action === "SEND_FOR_APPROVAL" || (hasPhoto && toSave.state === "APPROVAL_PENDING")) {
    const orderId = toSave.pending_approval_order_id || conv.pending_approval_order_id
    if (orderId) {
      // Download and store photo
      if (photoUrl) {
        try {
          const stored = await downloadAndStorePhoto(photoUrl, phone, orderId)
          if (stored) toSave.photo_public_url = stored.publicUrl
        } catch (e) { console.error("[photo store]", e) }
      }
      
      // Get order details for customer notification
      const sb = createAdminSupabase()
      const { data: order } = await sb.from("dispatch_orders")
        .select("id, client_phone, client_name, yards_needed, driver_pay_cents")
        .eq("id", orderId).maybeSingle()
      
      if (order?.client_phone) {
        const driverName = profile ? `${profile.first_name} ${profile.last_name || ""}`.trim() : phone
        const customerPhone = order.client_phone.replace(/\D/g, "").replace(/^1/, "")
        const approvalCode = require("crypto").randomBytes(4).toString("hex").toUpperCase()
        
        // Send photo to customer for approval
        try {
          await sendCustomerApprovalRequest(
            customerPhone, order.client_name || "Site Owner",
            driverName, order.id, order.yards_needed,
            toSave.photo_public_url || photoUrl || "", approvalCode
          )
        } catch (e) { console.error("[customer approval]", e) }
        
        // Large job → also escalate to admin
        if ((order.yards_needed || 0) >= 500) {
          try {
            await sendAdminEscalation(
              order.id, generateJobNum(order.id), driverName, phone,
              conv.extracted_city || "", order.yards_needed,
              Math.round((order.driver_pay_cents || 0) / 100),
              "Large job", approvalCode
            )
          } catch {}
        }
        
        toSave.state = "APPROVAL_PENDING"
        toSave.approval_sent_at = new Date().toISOString()
        toSave.voice_call_made = false
      }
    }
  }
'''
    
    # Insert before the existing CLAIM_JOB handler
    claim_job_marker = 'if (brain.action === "CLAIM_JOB"'
    claim_idx = brain.find(claim_job_marker, execute_section)
    if claim_idx != -1:
        brain = brain[:claim_idx] + approval_handler + "\n  " + brain[claim_idx:]
        print("  5. SEND_FOR_APPROVAL action handler added")
    else:
        print("  5. WARNING: Could not find CLAIM_JOB handler to insert before")
else:
    print("  5. WARNING: Could not find execute actions section")


# ══════════════════════════════════════════════════════
# 6. FIX: "text me when on the way" in sendJobLink
# ══════════════════════════════════════════════════════
brain = brain.replace(
    '"\\nLet me know when you on the way"',
    '"\\ntext me when on the way"'
)
brain = brain.replace(
    '"\\nlet me know when you on the way"',
    '"\\ntext me when on the way"'
)
brain = brain.replace(
    '"let me know when you on the way"',
    '"text me when on the way"'
)
brain = brain.replace(
    '"\\nAvisame cuando vayas en camino"',
    '"\\navisame cuando vayas en camino"'
)
# Also in the OTW line of sendJobLink
brain = brain.replace(
    'const otwLine = lang === "es" ? "\\nAvisame cuando vayas en camino" : "\\nLet me know when you on the way"',
    'const otwLine = lang === "es" ? "\\navisame cuando vayas en camino" : "\\ntext me when on the way"'
)
print("  6. Fixed OTW message → 'text me when on the way'")


# ══════════════════════════════════════════════════════
# 7. SELF-MATCH ROUTING FILTER
# ══════════════════════════════════════════════════════
if "distanceMiles >= 0.5" not in brain:
    brain = brain.replace(
        "nearbyJobs = await findNearbyJobs(lookupCity, lookupTruck)",
        "nearbyJobs = (await findNearbyJobs(lookupCity, lookupTruck)).filter(j => j.distanceMiles >= 0.5)"
    )
    brain = brain.replace(
        'nearbyJobs = await findNearbyJobs(lookupCity, "tandem_axle")',
        'nearbyJobs = (await findNearbyJobs(lookupCity, "tandem_axle")).filter(j => j.distanceMiles >= 0.5)'
    )
    print("  7. Self-match filter added (>= 0.5mi)")
else:
    print("  7. Self-match filter already present")


# ══════════════════════════════════════════════════════
# 8. INCREASE HISTORY + REDUCE TOKENS
# ══════════════════════════════════════════════════════
for old_h in ["history.slice(-10)", "history.slice(-14)"]:
    brain = brain.replace(old_h, "history.slice(-20)")
brain = brain.replace(".limit(16)", ".limit(24)")
brain = brain.replace("max_tokens: 350,", "max_tokens: 250,")
brain = brain.replace("max_tokens: 300,", "max_tokens: 250,")
brain = brain.replace("max_tokens: 200,", "max_tokens: 250,")
print("  8. History=20, max_tokens=250")


# ══════════════════════════════════════════════════════
# 9. FIX: Make sure pick() exists at top level
# ══════════════════════════════════════════════════════
if "function pick(" not in brain:
    # Add after last import
    last_import = brain.rfind("import ")
    end_of_line = brain.find("\n", last_import) + 1
    brain = brain[:end_of_line] + '\nfunction pick(arr: string[]): string { return arr[Math.floor(Math.random() * arr.length)] }\n' + brain[end_of_line:]
    print("  9. pick() function added")
else:
    print("  9. pick() already exists")


# ══════════════════════════════════════════════════════
# 10. FIX: Yards question phrasing
# ══════════════════════════════════════════════════════
brain = brain.replace('"how many yds you sitting on"', '"how many yards are available"')
brain = brain.replace('"how many yards"', '"how many yards you got available"')
brain = brain.replace('"how many yds you got"', '"how many yards are available"')
brain = brain.replace('"how many yds"', '"how many yards are available"')
print("  10. Yards question → 'how many yards are available'")


# ══════════════════════════════════════════════════════
# WRITE
# ══════════════════════════════════════════════════════
with open(BRAIN, "w") as f:
    f.write(brain)
print(f"\n✓ {BRAIN} updated ({len(brain)} chars)")
print(f"\nFULL FLOW:")
print("  1. hello → Sonnet: 'what up, you hauling today'")
print("  2. yes → TEMPLATE: 'how many yards are available'")
print("  3. 100 → TEMPLATE: 'what kind of truck are you hauling in'")
print("  4. tandem → TEMPLATE: 'how many trucks you got running'")
print("  5. 2 → TEMPLATE: 'whats the address your coming from...'")
print("  6. [address] → TEMPLATE: 'I got Dallas 3mi 500yds $30/load — think that works'")
print("  7. yes → TEMPLATE: 'send me a pic of the dirt'")
print("  8. [photo] → SONNET evaluates → 'looks good give me a min'")
print("     → system sends photo MMS to customer")
print("  9. [customer YES] → sends address to driver")
print("     'text me when on the way'")
print(" 10. otw → TEMPLATE: '10.4 let me know when you pull up'")
print(" 11. 10 → TEMPLATE: delivery handler")
print(" 12. [customer confirms] → TEMPLATE: 'how you want it, zelle or venmo'")
print(" 13. zelle → TEMPLATE: 'send name and number...'")
print(" 14. Joe 281-330-8003 → TEMPLATE: 'got it, will be sent shortly'")
BRAINV4

if [ $? -ne 0 ]; then
  echo "Script failed. Restoring backup..."
  cp lib/services/brain.service.ts.bak4 lib/services/brain.service.ts
  echo "Restored. Paste the error."
  exit 1
fi

echo ""
echo "Building..."
BUILD_OUT=$(npm run build 2>&1)
BUILD_EXIT=$?

if [ $BUILD_EXIT -ne 0 ]; then
  echo "$BUILD_OUT" | grep -E "error TS|Error:" | head -15
  echo ""
  echo "Attempting auto-fix..."
  
  # Common fixes
  python3 -c "
with open('lib/services/brain.service.ts','r') as f: c=f.read()
import re
# Fix .catch() on supabase query builders  
c = re.sub(r'(\.from\([^)]+\)\.[^;]*?)\.catch\(\s*\(\)\s*=>\s*\{?\s*\}?\s*\)', r'\1.then(() => null, () => null)', c)
# Fix require in ES module
if 'require(\"crypto\")' in c:
    if 'import crypto' not in c:
        c = c.replace('import Anthropic', 'import Anthropic\nimport crypto from \"crypto\"', 1)
    c = c.replace('require(\"crypto\").randomBytes', 'crypto.randomBytes')
with open('lib/services/brain.service.ts','w') as f: f.write(c)
print('Auto-fixes applied')
"
  
  BUILD_OUT2=$(npm run build 2>&1)
  if [ $? -ne 0 ]; then
    echo "$BUILD_OUT2" | grep -E "error TS|Error:" | head -15
    echo ""
    echo "STILL FAILING. Paste these errors."
    exit 1
  fi
fi

echo "✓ Build passed"
echo ""
echo "Deploying..."
git add lib/services/brain.service.ts
git commit -m "feat: brain v4 — complete dispatch flow templated, Sonnet for photos/negotiation only"
git push origin main

# Reset conversation
SUPA_URL=$(grep NEXT_PUBLIC_SUPABASE_URL .env.local | head -1 | sed 's/.*=//;s/"//g;s/^[[:space:]]*//')
SUPA_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env.local | head -1 | sed 's/.*=//;s/"//g;s/^[[:space:]]*//')

if [ -n "$SUPA_URL" ] && [ -n "$SUPA_KEY" ]; then
  curl -sf -X PATCH "${SUPA_URL}/rest/v1/conversations?phone=eq.7134439223" \
    -H "apikey: ${SUPA_KEY}" -H "Authorization: Bearer ${SUPA_KEY}" \
    -H "Content-Type: application/json" -H "Prefer: return=minimal" \
    -d '{"state":"DISCOVERY","extracted_city":null,"extracted_yards":null,"extracted_truck_type":null,"extracted_truck_count":null,"photo_public_url":null,"active_order_id":null,"pending_approval_order_id":null,"approval_sent_at":null,"voice_call_made":false,"job_state":null}' \
    && echo "✓ Phone reset to DISCOVERY"
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✓ BRAIN v4 DEPLOYED"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Wait 60 seconds then text: hello"
echo ""
echo "  FLOW:"
echo "  hello → what up, you hauling today"
echo "  yes → how many yards are available"
echo "  100 → what kind of truck are you hauling in"
echo "  tandem → how many trucks you got running"
echo "  2 → whats the address your coming from..."
echo "  [address] → I got Dallas 3mi 500yds \$30/load"
echo "  yes → send me a pic of the dirt"
echo "  [photo] → looks good give me a min → [MMS to customer]"
echo "  [customer YES] → address + text me when on the way"
echo "  otw → 10.4 let me know when you pull up"
echo "  10 → got it 10 loads checking with site"
echo "  [customer confirms] → how you want it zelle or venmo"
echo ""
