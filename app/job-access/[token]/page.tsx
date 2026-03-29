import { createAdminSupabase } from '@/lib/supabase'

interface Props {
  params: Promise<{ token: string }>
}

export default async function JobAccessPage({ params }: Props) {
  const { token } = await params
  const supabase = createAdminSupabase()

  // Look up token by short_id
  const { data: tokenRow } = await supabase
    .from('job_access_tokens')
    .select('id, driver_id, expires_at, used_at, short_id, load_request_id')
    .eq('short_id', token)
    .single()

  if (!tokenRow) {
    return <ErrorPage message="This link is invalid or has expired." />
  }

  if (new Date(tokenRow.expires_at) < new Date()) {
    return <ErrorPage message="This link has expired. Text us for a new one." />
  }

  // Get load request and order
  const { data: load } = await supabase
    .from('load_requests')
    .select('id, dispatch_order_id, yards_estimated')
    .eq('id', tokenRow.load_request_id)
    .single()

  let order: any = null
  if (load?.dispatch_order_id) {
    const { data } = await supabase
      .from('dispatch_orders')
      .select('id, client_address, client_name, yards_needed, driver_pay_cents, notes, cities(name)')
      .eq('id', load.dispatch_order_id)
      .single()
    order = data
  }

  const { data: driverData } = await supabase
    .from('driver_profiles')
    .select('first_name, last_name, phone, truck_type')
    .eq('user_id', tokenRow.driver_id)
    .single()

  // Mark as used on first open
  if (!tokenRow.used_at) {
    await supabase
      .from('job_access_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', tokenRow.id)
  }

  const pay = order?.driver_pay_cents ? Math.round(order.driver_pay_cents / 100) : 45
  const city = (order?.cities as any)?.name || ''
  const address = order?.client_address || 'Address unavailable'

  return (
    <div style={{
      minHeight: '100vh',
      background: '#080604',
      color: '#f5f0e8',
      fontFamily: 'system-ui, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{ width: '100%', maxWidth: '420px' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            fontSize: '13px',
            letterSpacing: '0.15em',
            textTransform: 'uppercase' as const,
            color: '#4ade80',
            marginBottom: '8px',
            fontFamily: 'monospace',
          }}>
            Approved Job
          </div>
          <div style={{ fontSize: '28px', fontWeight: '800', color: '#f5f0e8' }}>
            DumpSite.io
          </div>
        </div>

        <div style={{
          background: '#1a1510',
          border: '1px solid rgba(196,165,90,0.25)',
          borderRadius: '12px',
          overflow: 'hidden',
          marginBottom: '20px',
        }}>
          <div style={{
            background: '#e07a28',
            padding: '12px 20px',
            fontSize: '13px',
            fontWeight: '700',
            letterSpacing: '0.05em',
            color: '#080604',
            fontFamily: 'monospace',
          }}>
            APPROVED — HEAD OVER NOW
          </div>
          <div style={{ padding: '20px' }}>
            <div style={{ fontSize: '11px', color: '#6b5c4a', fontFamily: 'monospace', letterSpacing: '0.1em', textTransform: 'uppercase' as const, marginBottom: '6px' }}>Delivery Address</div>
            <div style={{ fontSize: '20px', fontWeight: '700', color: '#f5f0e8', marginBottom: '4px', lineHeight: '1.3' }}>
              {address}
            </div>
            <div style={{ fontSize: '13px', color: '#c4a55a', marginBottom: '20px' }}>{city}</div>

            <a
              href={`https://maps.google.com/maps?q=${encodeURIComponent(address)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block',
                width: '100%',
                padding: '16px',
                background: '#e07a28',
                color: '#080604',
                textAlign: 'center' as const,
                fontWeight: '800',
                fontSize: '16px',
                letterSpacing: '0.05em',
                textDecoration: 'none',
                borderRadius: '6px',
                marginBottom: '12px',
              }}
            >
              Navigate Now
            </a>

            <a
              href={`https://maps.apple.com/maps?q=${encodeURIComponent(address)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block',
                width: '100%',
                padding: '14px',
                background: 'transparent',
                color: '#c4a55a',
                textAlign: 'center' as const,
                fontWeight: '600',
                fontSize: '14px',
                textDecoration: 'none',
                borderRadius: '6px',
                border: '1px solid rgba(196,165,90,0.25)',
              }}
            >
              Open in Apple Maps
            </a>
          </div>
        </div>

        <div style={{
          background: '#110e09',
          border: '1px solid rgba(196,165,90,0.12)',
          borderRadius: '8px',
          padding: '16px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '12px',
          marginBottom: '20px',
        }}>
          <div>
            <div style={{ fontSize: '10px', color: '#6b5c4a', fontFamily: 'monospace', letterSpacing: '0.1em', textTransform: 'uppercase' as const, marginBottom: '4px' }}>Yards</div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: '#f5f0e8' }}>{order?.yards_needed || '?'}</div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: '#6b5c4a', fontFamily: 'monospace', letterSpacing: '0.1em', textTransform: 'uppercase' as const, marginBottom: '4px' }}>Pay / Load</div>
            <div style={{ fontSize: '22px', fontWeight: '700', color: '#4ade80' }}>${pay}</div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: '#6b5c4a', fontFamily: 'monospace', letterSpacing: '0.1em', textTransform: 'uppercase' as const, marginBottom: '4px' }}>Driver</div>
            <div style={{ fontSize: '15px', fontWeight: '600', color: '#f5f0e8' }}>{driverData?.first_name} {driverData?.last_name}</div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: '#6b5c4a', fontFamily: 'monospace', letterSpacing: '0.1em', textTransform: 'uppercase' as const, marginBottom: '4px' }}>Truck</div>
            <div style={{ fontSize: '15px', fontWeight: '600', color: '#f5f0e8' }}>{(driverData?.truck_type || 'Dump Truck').replace(/_/g, ' ')}</div>
          </div>
        </div>

        {order?.notes && (
          <div style={{
            background: '#110e09',
            border: '1px solid rgba(196,165,90,0.12)',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '20px',
          }}>
            <div style={{ fontSize: '10px', color: '#6b5c4a', fontFamily: 'monospace', letterSpacing: '0.1em', textTransform: 'uppercase' as const, marginBottom: '8px' }}>Site Notes</div>
            <div style={{ fontSize: '14px', color: '#c4a55a', lineHeight: '1.6' }}>{order.notes}</div>
          </div>
        )}

        <div style={{
          textAlign: 'center' as const,
          padding: '16px',
          background: 'rgba(74,222,128,0.05)',
          border: '1px solid rgba(74,222,128,0.2)',
          borderRadius: '8px',
          fontSize: '14px',
          color: '#4ade80',
          fontFamily: 'monospace',
        }}>
          Once done delivering, text us how many loads you dropped
        </div>

        <div style={{ textAlign: 'center' as const, marginTop: '24px', fontSize: '11px', color: '#4a3f30', fontFamily: 'monospace' }}>
          This link is for {driverData?.first_name} only
        </div>
      </div>
    </div>
  )
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#080604',
      color: '#f5f0e8',
      fontFamily: 'system-ui, sans-serif',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      textAlign: 'center' as const,
    }}>
      <div>
        <div style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px' }}>Link Unavailable</div>
        <div style={{ fontSize: '14px', color: '#6b5c4a' }}>{message}</div>
      </div>
    </div>
  )
}
