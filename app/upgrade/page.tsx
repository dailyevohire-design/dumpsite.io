'use client'
import { useState, useEffect } from 'react'
import { createBrowserSupabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

const TIERS = [
  {
    slug: 'hauler',
    name: 'Hauler',
    price: 49,
    color: '#3A8AE8',
    perks: [
      'Up to 50 loads/month',
      'Priority dispatch — notified 30 min before Trial drivers',
      'Access to all DFW cities',
      'Dedicated support line',
    ]
  },
  {
    slug: 'pro',
    name: 'Pro',
    price: 99,
    color: '#F5A623',
    badge: 'MOST POPULAR',
    perks: [
      'Unlimited loads',
      'Priority dispatch — notified 15 min before Hauler drivers',
      '10% pay boost on every load',
      'Access to premium high-pay sites',
      'Weekly payout (vs monthly)',
    ]
  },
  {
    slug: 'elite',
    name: 'Elite',
    price: 199,
    color: '#8E44AD',
    perks: [
      'Unlimited loads',
      'First dispatch notification — beat everyone',
      '20% pay boost on every load',
      'Dedicated account manager',
      'Daily payout available',
      'Private high-volume site access',
    ]
  }
]

export default function UpgradePage() {
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const supabase = createBrowserSupabase()
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/login'); return }
      supabase.from('driver_profiles').select('*, tiers(name,slug)').eq('user_id', data.user.id).single().then(({ data: p }) => {
        setProfile(p)
        setLoading(false)
      })
    })
  }, [])

  if (loading) return <div style={{ background: '#0A0C0F', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#606670', fontFamily: 'system-ui' }}>Loading...</div>

  const currentTier = profile?.tiers?.slug || 'trial'

  return (
    <div style={{ background: '#0A0C0F', minHeight: '100vh', color: '#E8E3DC', fontFamily: 'system-ui,sans-serif', padding: '0 0 60px' }}>
      {/* Header */}
      <div style={{ background: '#080A0C', borderBottom: '1px solid #272B33', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'Georgia,serif', fontSize: '18px', fontWeight: '700', color: '#F0EDE8' }}>DUMPSITE<span style={{ color: '#F5A623' }}>.IO</span></span>
        <a href="/dashboard" style={{ color: '#606670', textDecoration: 'none', fontSize: '13px', border: '1px solid #272B33', padding: '7px 14px', borderRadius: '8px' }}>← Dashboard</a>
      </div>

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '40px 20px' }}>
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <h1 style={{ fontWeight: '900', fontSize: '36px', marginBottom: '8px' }}>Upgrade Your Plan</h1>
          <p style={{ color: '#606670', fontSize: '16px' }}>Get notified first. Earn more. Haul more.</p>
          {currentTier === 'trial' && (
            <div style={{ marginTop: '16px', background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.2)', borderRadius: '8px', padding: '10px 16px', display: 'inline-block', fontSize: '13px', color: '#F5A623', fontWeight: '700' }}>
              You're on the free Trial plan
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '20px', marginBottom: '48px' }}>
          {TIERS.map(tier => {
            const isCurrent = currentTier === tier.slug
            return (
              <div key={tier.slug} style={{ background: '#111316', border: `2px solid ${isCurrent ? tier.color : '#272B33'}`, borderRadius: '16px', padding: '28px', position: 'relative' }}>
                {tier.badge && (
                  <div style={{ position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)', background: '#F5A623', color: '#111', padding: '3px 14px', borderRadius: '20px', fontSize: '10px', fontWeight: '900', letterSpacing: '0.1em' }}>
                    {tier.badge}
                  </div>
                )}
                {isCurrent && (
                  <div style={{ position: 'absolute', top: '-12px', right: '20px', background: tier.color, color: '#fff', padding: '3px 12px', borderRadius: '20px', fontSize: '10px', fontWeight: '900' }}>
                    CURRENT
                  </div>
                )}
                <div style={{ color: tier.color, fontWeight: '900', fontSize: '20px', marginBottom: '4px' }}>{tier.name}</div>
                <div style={{ marginBottom: '20px' }}>
                  <span style={{ fontSize: '42px', fontWeight: '900', color: '#E8E3DC' }}>${tier.price}</span>
                  <span style={{ color: '#606670', fontSize: '13px' }}>/month</span>
                </div>
                <div style={{ marginBottom: '24px' }}>
                  {tier.perks.map((perk, i) => (
                    <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '10px', fontSize: '13px', color: '#A0A8B0' }}>
                      <span style={{ color: tier.color, flexShrink: 0 }}>✓</span>
                      {perk}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => {
                    // Stripe integration goes here
                    // For now, direct to contact
                    window.location.href = `mailto:support@dumpsite.io?subject=Upgrade to ${tier.name}&body=Hi, I'd like to upgrade my DumpSite.io account to the ${tier.name} plan. My email is ${profile?.email || ''}`
                  }}
                  disabled={isCurrent}
                  style={{ width: '100%', background: isCurrent ? '#1C1F24' : tier.color, color: isCurrent ? '#606670' : tier.slug === 'pro' ? '#111' : '#fff', border: 'none', padding: '13px', borderRadius: '10px', fontWeight: '800', fontSize: '14px', cursor: isCurrent ? 'not-allowed' : 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                >
                  {isCurrent ? 'Current Plan' : `Upgrade to ${tier.name}`}
                </button>
              </div>
            )
          })}
        </div>

        <div style={{ textAlign: 'center', color: '#606670', fontSize: '13px' }}>
          <p>Questions? Email <a href="mailto:support@dumpsite.io" style={{ color: '#F5A623', textDecoration: 'none' }}>support@dumpsite.io</a></p>
          <p style={{ marginTop: '8px' }}>All plans include access to the DumpSite.io driver dashboard and SMS delivery notifications.</p>
        </div>
      </div>
    </div>
  )
}
