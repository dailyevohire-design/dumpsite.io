// Twilio number health check.
//
// Compares every active sales_agents.twilio_number against the Twilio
// account's IncomingPhoneNumbers resource so that misconfigured agent
// numbers (Micah, John, future hires) are detected the moment they're
// added — instead of being discovered when a customer reply silently
// goes out from the wrong number.

import { createAdminSupabase } from "../supabase"

export interface AgentNumberHealth {
  agent_id: string
  agent_name: string
  twilio_number: string             // digits, e.g. "4695236420"
  e164: string                      // +14695236420
  owned_by_account: boolean
  sms_capable: boolean
  webhook_url: string | null        // sms_url from Twilio
  webhook_correct: boolean          // matches our expected customer-webhook URL
  in_messaging_service: boolean     // true if number is bound to a messaging service
  status: "ok" | "warn" | "broken"
  issues: string[]
}

interface TwilioIncomingNumber {
  sid: string
  phone_number: string              // E.164
  capabilities: { sms?: boolean; mms?: boolean; voice?: boolean }
  sms_url: string | null
  sms_application_sid: string | null
  // Twilio doesn't expose messaging service binding on this endpoint;
  // a number bound to a messaging service typically has empty sms_url.
}

function getTwilioAuth(): { sid: string; key: string; secret: string } {
  const rawSid = process.env.TWILIO_ACCOUNT_SID || ""
  const apiKey = process.env.TWILIO_API_KEY
  const apiSecret = process.env.TWILIO_API_SECRET
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (apiKey && apiSecret) return { sid: rawSid, key: apiKey, secret: apiSecret }
  return { sid: rawSid, key: rawSid, secret: authToken || "" }
}

async function listAccountNumbers(): Promise<TwilioIncomingNumber[]> {
  const { sid, key, secret } = getTwilioAuth()
  const auth = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64")
  const out: TwilioIncomingNumber[] = []
  // Page through (Twilio default page size 50)
  let url: string | null = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=100`
  while (url) {
    const resp: Response = await fetch(url, { headers: { Authorization: auth } })
    if (!resp.ok) {
      throw new Error(`Twilio IncomingPhoneNumbers fetch failed: ${resp.status} ${await resp.text()}`)
    }
    const data: any = await resp.json()
    for (const n of data.incoming_phone_numbers || []) {
      out.push({
        sid: n.sid,
        phone_number: n.phone_number,
        capabilities: n.capabilities || {},
        sms_url: n.sms_url || null,
        sms_application_sid: n.sms_application_sid || null,
      })
    }
    url = data.next_page_uri ? `https://api.twilio.com${data.next_page_uri}` : null
  }
  return out
}

function expectedWebhookUrl(): string {
  return process.env.TWILIO_CUSTOMER_WEBHOOK_URL
    || `${process.env.NEXT_PUBLIC_APP_URL || "https://dumpsite.io"}/api/sms/customer-webhook`
}

export async function checkAgentNumberHealth(): Promise<AgentNumberHealth[]> {
  const sb = createAdminSupabase()
  const { data: agents, error } = await sb
    .from("sales_agents")
    .select("id, name, twilio_number")
    .eq("active", true)
  if (error) throw new Error(`Failed to load sales_agents: ${error.message}`)
  if (!agents || agents.length === 0) return []

  const accountNumbers = await listAccountNumbers()
  const byE164 = new Map(accountNumbers.map(n => [n.phone_number, n]))
  const expectedHook = expectedWebhookUrl()

  return agents.map((a): AgentNumberHealth => {
    const e164 = `+1${a.twilio_number}`
    const issues: string[] = []
    const tn = byE164.get(e164)

    const owned = !!tn
    if (!owned) {
      issues.push(`Number ${e164} is NOT in this Twilio account. Either it belongs to a different account/subaccount, or sales_agents.twilio_number is wrong.`)
    }

    const smsCapable = !!tn?.capabilities?.sms
    if (owned && !smsCapable) {
      issues.push(`Number ${e164} does NOT have SMS capability enabled. Buy/upgrade in Twilio console.`)
    }

    const webhookUrl = tn?.sms_url || null
    // Twilio sometimes URL-encodes; normalize for comparison
    const normalizedExpected = expectedHook.replace(/\/$/, "")
    const normalizedActual = (webhookUrl || "").replace(/\/$/, "")
    const webhookCorrect = !!webhookUrl && (normalizedActual === normalizedExpected || normalizedActual.startsWith(normalizedExpected))
    if (owned && !webhookCorrect) {
      if (!webhookUrl) {
        issues.push(`Number ${e164} has no SMS webhook configured (likely bound to a Messaging Service). Either set sms_url to ${expectedHook}, or update the send path to use MessagingServiceSid.`)
      } else {
        issues.push(`Number ${e164} webhook is "${webhookUrl}" but should be "${expectedHook}".`)
      }
    }

    // Heuristic: if owned but webhook is null, the number is most likely
    // bound to a messaging service. Twilio's REST API for IncomingPhoneNumbers
    // doesn't directly expose messaging_service_sid here, so we infer.
    const inMessagingService = owned && !webhookUrl

    let status: "ok" | "warn" | "broken" = "ok"
    if (!owned || !smsCapable) status = "broken"
    else if (!webhookCorrect) status = "broken"
    else if (issues.length > 0) status = "warn"

    return {
      agent_id: a.id,
      agent_name: a.name,
      twilio_number: a.twilio_number,
      e164,
      owned_by_account: owned,
      sms_capable: smsCapable,
      webhook_url: webhookUrl,
      webhook_correct: webhookCorrect,
      in_messaging_service: inMessagingService,
      status,
      issues,
    }
  })
}
