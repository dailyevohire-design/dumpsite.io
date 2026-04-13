export interface AgentConfig {
  id: string              // unique agent ID e.g. 'micah', 'carlos'
  name: string            // display name
  personalPhone: string   // their real cell — gets SMS notifications
  twilioNumber: string    // their assigned Twilio number (Sarah's number)
  market: string          // 'DFW', 'Denver', etc
  role: 'manager' | 'agent'
  managerId?: string      // for agents: points to their manager's id
  commissionPct: number   // 10 for agents, 5 for manager override
  active: boolean
}

// ============================================================
// ADD NEW AGENTS HERE — one block per agent
// When hiring: add their entry, give them their twilioNumber,
// deploy. Nothing else changes.
// ============================================================
//
// RULE: twilioNumber = the Twilio number customers TEXT to
// reach this agent. Sarah's brain replies FROM this same
// number. All customer comms for this agent come from
// their twilioNumber. Never share numbers between agents.
//
export const AGENTS: AgentConfig[] = [
  {
    id: 'main',
    name: 'Main',
    personalPhone: process.env.ADMIN_PHONE ?? '',
    // Must match CUSTOMER_FROM in customer-brain.service.ts:
    // process.env.CUSTOMER_TWILIO_NUMBER || process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ""
    twilioNumber: process.env.CUSTOMER_TWILIO_NUMBER || process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || '',
    market: 'DFW',
    role: 'manager',
    commissionPct: 5,
    active: true,
  },
  {
    id: 'micah',
    name: 'Micah',
    personalPhone: '+13034098337',
    twilioNumber: '+14695236420',
    market: 'DFW',
    role: 'manager',
    commissionPct: 5,
    active: true,
  },
  // NEW AGENT TEMPLATE — copy this block for each new hire:
  // {
  //   id: 'firstname',
  //   name: 'First Last',
  //   personalPhone: '+1XXXXXXXXXX',  // agent's real cell for notifications
  //   twilioNumber: '+1XXXXXXXXXX',   // their assigned Twilio/Sarah number
  //   market: 'DFW',
  //   role: 'agent',
  //   managerId: 'micah',             // their manager's id
  //   commissionPct: 10,
  //   active: true,
  // },
  // IMPORTANT: After adding, go to Twilio console and
  // point this number's webhook to:
  // https://[your-domain]/api/sms/customer-webhook
  // HTTP POST — without this step the number won't work
]

export function getAgentByTwilioNumber(twilioNumber: string): AgentConfig | undefined {
  return AGENTS.find(a => a.twilioNumber === twilioNumber && a.active)
}

export function getManagerOf(agent: AgentConfig): AgentConfig | undefined {
  if (!agent.managerId) return undefined
  return AGENTS.find(a => a.id === agent.managerId && a.active)
}

export function calcCommissions(orderAmountDollars: number, agent: AgentConfig): {
  agentCommission: number
  managerCommission: number
  agentName: string
  managerName: string
} {
  const agentComm = agent.role === 'agent'
    ? Math.round(orderAmountDollars * (agent.commissionPct / 100) * 100) / 100
    : 0
  const manager = getManagerOf(agent)
  const managerComm = manager
    ? Math.round(orderAmountDollars * (manager.commissionPct / 100) * 100) / 100
    : 0
  return {
    agentCommission: agentComm,
    managerCommission: managerComm,
    agentName: agent.name,
    managerName: manager?.name ?? '',
  }
}

export function validateAgentNumbers(): void {
  const numbers = AGENTS
    .filter(a => a.active && a.twilioNumber)
    .map(a => a.twilioNumber)
  const duplicates = numbers.filter(
    (n, i) => numbers.indexOf(n) !== i
  )
  if (duplicates.length > 0) {
    console.error(
      '[rep-config] DUPLICATE TWILIO NUMBERS DETECTED:',
      duplicates,
      '— each agent must have a unique number'
    )
  }
}
