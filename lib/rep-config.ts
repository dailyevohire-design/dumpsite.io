import { createAdminSupabase } from './supabase'

export interface AgentConfig {
  id: string              // UUID from sales_agents table
  name: string            // display name
  personalPhone: string   // their real cell — gets SMS notifications
  twilioNumber: string    // their assigned Twilio number (Sarah's number)
  market: string          // 'DFW', 'Denver', etc
  role: 'manager' | 'agent'
  managerId?: string      // for agents: points to their manager's id
  commissionPct: number   // percentage (e.g. 10)
  active: boolean
}

// ============================================================
// DB-BACKED AGENT LOOKUP — cached 5 minutes, same pattern as
// customer-brain.service.ts loadAgents(). No more hardcoded
// arrays — add agents in Supabase, they work immediately.
// ============================================================

let agentCache: { agents: AgentConfig[]; loadedAt: number } = { agents: [], loadedAt: 0 }
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function loadAgents(): Promise<AgentConfig[]> {
  if (Date.now() - agentCache.loadedAt < CACHE_TTL && agentCache.agents.length > 0) {
    return agentCache.agents
  }
  try {
    const sb = createAdminSupabase()
    const { data, error } = await sb
      .from('sales_agents')
      .select('id, name, twilio_number, personal_number, commission_rate, market')
      .eq('active', true)
    if (error) {
      console.error('[rep-config] Failed to load agents from DB:', error.message)
      return agentCache.agents // Return stale cache on error
    }
    const agents: AgentConfig[] = (data || []).map(row => ({
      id: row.id,
      name: row.name,
      personalPhone: row.personal_number ? `+1${row.personal_number.replace(/\D/g, '')}` : '',
      twilioNumber: `+1${(row.twilio_number || '').replace(/\D/g, '')}`,
      market: row.market || 'DFW',
      // Micah is manager, everyone else is agent
      role: row.name?.toLowerCase().includes('micah') ? 'manager' as const : 'agent' as const,
      managerId: row.name?.toLowerCase().includes('micah') ? undefined : 'micah',
      commissionPct: Math.round((row.commission_rate || 0.10) * 100),
      active: true,
    }))

    // Also add the "main" agent for the default customer number
    const mainTwilio = process.env.CUSTOMER_TWILIO_NUMBER || process.env.TWILIO_FROM_NUMBER_2 || process.env.TWILIO_FROM_NUMBER || ''
    const adminPhone = process.env.ADMIN_PHONE || ''
    if (mainTwilio) {
      agents.push({
        id: 'main',
        name: 'Main',
        personalPhone: adminPhone ? `+1${adminPhone.replace(/\D/g, '')}` : '',
        twilioNumber: mainTwilio,
        market: 'DFW',
        role: 'manager',
        commissionPct: 5,
        active: true,
      })
    }

    agentCache = { agents, loadedAt: Date.now() }
    return agents
  } catch (e) {
    console.error('[rep-config] Exception loading agents:', (e as any)?.message)
    return agentCache.agents
  }
}

export async function getAgentByTwilioNumber(twilioNumber: string): Promise<AgentConfig | undefined> {
  const agents = await loadAgents()
  const normalized = twilioNumber.replace(/\D/g, '')
  return agents.find(a => {
    const aN = a.twilioNumber.replace(/\D/g, '')
    return aN === normalized && a.active
  })
}

export async function getManagerOf(agent: AgentConfig): Promise<AgentConfig | undefined> {
  if (!agent.managerId) return undefined
  const agents = await loadAgents()
  // Find micah by name match (managerId is 'micah')
  return agents.find(a => a.name.toLowerCase().includes(agent.managerId!) && a.active)
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
  // Manager commission is calculated separately when we have the manager object
  return {
    agentCommission: agentComm,
    managerCommission: 0, // Caller should use getManagerOf + calcManagerCommission
    agentName: agent.name,
    managerName: '',
  }
}

export async function calcCommissionsWithManager(orderAmountDollars: number, agent: AgentConfig): Promise<{
  agentCommission: number
  managerCommission: number
  agentName: string
  managerName: string
}> {
  const agentComm = agent.role === 'agent'
    ? Math.round(orderAmountDollars * (agent.commissionPct / 100) * 100) / 100
    : 0
  const manager = await getManagerOf(agent)
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

export async function validateAgentNumbers(): Promise<void> {
  const agents = await loadAgents()
  const numbers = agents
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
