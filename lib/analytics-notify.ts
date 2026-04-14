import { getAgentByTwilioNumber, getManagerOf, calcCommissionsWithManager, AgentConfig } from './rep-config'

interface OrderNotifyParams {
  fromNumber: string       // Sarah's Twilio number that handled this order
  customerName: string
  yards: number
  material: string
  city: string
  amountDollars: number
  eventType: 'order_placed' | 'order_delivered'
  orderId?: string
}

// ── 1. SMS notification to agent + manager ──────────────────
async function sendAgentSMS(toPhone: string, message: string): Promise<void> {
  try {
    // Use Twilio REST directly — do not use Sarah's number as From
    // Use TWILIO_FROM_NUMBER_2 (Jesse's number / admin number) as sender
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(
          `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
        ).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: process.env.TWILIO_FROM_NUMBER_2 ?? '',
        To: toPhone,
        Body: message,
      }).toString(),
    })
  } catch (err) {
    console.error('[agent-sms] failed to notify:', toPhone, err)
  }
}

// ── 2. POST to dashboard server ─────────────────────────────
async function postToDashboard(params: OrderNotifyParams, agent: AgentConfig, managerName: string, commissions: { agentCommission: number; managerCommission: number }): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const bodyText = [
      `New order received: ${params.customerName}`,
      `${params.yards}yds ${params.material}`,
      `to ${params.city}`,
      `$${params.amountDollars}`
    ].join('/ ')

    await fetch('https://dumpsite-server.onrender.com/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Dashboard-Secret': process.env.DASHBOARD_WEBHOOK_SECRET ?? '',
        'X-Agent-Id': agent.id,
        'X-Agent-Name': agent.name,
        'X-Manager-Name': managerName,
        'X-Market': agent.market,
      },
      body: new URLSearchParams({
        From: params.fromNumber,
        Body: bodyText,
        AgentId: agent.id,
        AgentName: agent.name,
        ManagerName: managerName,
        Market: agent.market,
        EventType: params.eventType,
        OrderId: params.orderId ?? '',
        AgentCommission: String(commissions.agentCommission),
        ManagerCommission: String(commissions.managerCommission),
        AmountDollars: String(params.amountDollars),
      }).toString(),
      signal: controller.signal,
    })
    console.log(`[dashboard] POST sent — agent: ${agent.name} | $${params.amountDollars}`)
  } catch (err) {
    console.error('[dashboard] POST failed (non-fatal):', err)
  } finally {
    clearTimeout(timeout)
  }
}

// ── 3. Main export — FIRE AND FORGET ────────────────────────
export function notifyRepDashboard(params: OrderNotifyParams): void {
  void (async () => {
    try {
      const agent = await getAgentByTwilioNumber(params.fromNumber)
      if (!agent) {
        console.warn('[analytics] no agent found for number:', params.fromNumber)
        // Still POST to dashboard even if agent unknown
        const unknownAgent: AgentConfig = {
          id: 'unknown', name: 'Unknown', personalPhone: '',
          twilioNumber: params.fromNumber, market: 'Unknown',
          role: 'agent', commissionPct: 0, active: true,
        }
        await postToDashboard(params, unknownAgent, '', { agentCommission: 0, managerCommission: 0 })
        return
      }

      const manager = await getManagerOf(agent)
      const commissions = await calcCommissionsWithManager(params.amountDollars, agent)

      // Build notification messages
      const isDelivery = params.eventType === 'order_delivered'

      const agentMsg = isDelivery
        ? `DELIVERED: ${params.customerName} | ${params.yards}yds ${params.material} to ${params.city} | Your commission: $${commissions.agentCommission}`
        : `New order: ${params.customerName} | ${params.yards}yds ${params.material} to ${params.city} | $${params.amountDollars} | Your commission: $${commissions.agentCommission}`

      const managerMsg = isDelivery
        ? `DELIVERED via ${agent.name}: ${params.customerName} | ${params.yards}yds to ${params.city} | Your override: $${commissions.managerCommission}`
        : `New order via ${agent.name}: ${params.customerName} | ${params.yards}yds ${params.material} to ${params.city} | $${params.amountDollars} | Your override: $${commissions.managerCommission}`

      // Fire all three in parallel — none blocks the others
      await Promise.allSettled([
        // Agent SMS (only if they have a personal phone)
        agent.personalPhone
          ? sendAgentSMS(agent.personalPhone, agentMsg)
          : Promise.resolve(),
        // Manager SMS (only if agent has a manager and different from agent)
        manager && manager.personalPhone && manager.id !== agent.id
          ? sendAgentSMS(manager.personalPhone, managerMsg)
          : Promise.resolve(),
        // Dashboard POST
        postToDashboard(params, agent, commissions.managerName, commissions),
      ])
    } catch (err) {
      console.error('[analytics] top-level error (non-fatal):', err)
    }
  })()
}
