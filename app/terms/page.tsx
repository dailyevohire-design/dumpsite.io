import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Terms of Service' }

export default function TermsPage() {
  const s = { color: '#F0EDE8', fontFamily: 'system-ui, sans-serif', background: '#0A0A0A', minHeight: '100vh', padding: '40px 20px' }
  const h = { fontFamily: 'Georgia, serif', color: '#F0EDE8', marginBottom: '16px' }
  const p = { color: '#999', fontSize: '14px', lineHeight: '1.8', marginBottom: '16px' }
  return (
    <div style={s}>
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
        <a href="/" style={{ textDecoration: 'none' }}><span style={{ fontFamily: 'Georgia, serif', fontSize: '18px', fontWeight: '700', color: '#F0EDE8' }}>DUMPSITE<span style={{ color: '#F5A623' }}>.IO</span></span></a>
        <h1 style={{ ...h, fontSize: '32px', marginTop: '32px' }}>Terms of Service</h1>
        <p style={{ ...p, color: '#606670' }}>Last updated: March 22, 2026</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '32px' }}>1. Acceptance of Terms</h2>
        <p style={p}>By accessing or using DumpSite.io ("the Platform"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Platform. DumpSite.io is operated by DumpSite Technologies LLC ("we", "us", "our").</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>2. Platform Description</h2>
        <p style={p}>DumpSite.io is a logistics marketplace connecting dump truck drivers ("Drivers") with construction companies, excavation contractors, and property owners ("Clients") who need dirt, fill, or construction materials transported. We facilitate connections — we are not a trucking company, employer, or contractor.</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>3. User Accounts</h2>
        <p style={p}>You must provide accurate information when creating an account. You are responsible for maintaining the security of your account credentials. You must be at least 18 years old and legally authorized to operate commercial vehicles in the state of Texas (for Drivers). One account per person — duplicate accounts will be terminated.</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>4. Driver Obligations</h2>
        <p style={p}>Drivers agree to: (a) maintain valid commercial driver's licenses and insurance; (b) comply with all applicable federal, state, and local transportation laws; (c) deliver materials only to the designated addresses provided via the Platform; (d) upload accurate completion photos for every delivery; (e) not contact or transact with Clients outside the Platform; (f) not share delivery addresses or Client information with any third party. Violation of these obligations may result in immediate account termination and withheld payouts.</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>5. Prohibited Materials</h2>
        <p style={p}>The following materials are strictly prohibited from transport through the Platform: hazardous waste, contaminated soil, asbestos-containing materials, radioactive materials, medical waste, chemical waste, and any materials violating EPA or TCEQ regulations. Drivers who transport prohibited materials face immediate termination and may be reported to authorities.</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>6. Payment Terms</h2>
        <p style={p}>Driver compensation is set per load as displayed on each job listing. Payouts are processed after load completion and admin verification. We reserve the right to withhold payment pending investigation of disputed completions. Payment processing occurs weekly via ACH transfer. A valid W-9 and banking information are required before any payouts are processed. Platform fees and tier subscription charges are non-refundable.</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>7. Subscription Tiers</h2>
        <p style={p}>Paid tier subscriptions (Hauler, Pro, Elite) are billed monthly. You may cancel at any time — cancellation takes effect at the end of the current billing period. No refunds for partial months. Downgrading resets your dispatch priority immediately.</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>8. Dispute Resolution</h2>
        <p style={p}>Any disputes between Drivers and Clients will be mediated by DumpSite.io. Our decision is final regarding payment disputes. For disputes with DumpSite.io directly, you agree to binding arbitration in Dallas County, Texas, under AAA Commercial Arbitration Rules. Class action waiver applies.</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>9. Termination</h2>
        <p style={p}>We may suspend or terminate your account at any time for violation of these terms, fraudulent activity, safety concerns, or at our sole discretion. Upon termination, pending verified payouts will be processed within 30 days. Access to the Platform and all associated data will be revoked.</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>10. Limitation of Liability</h2>
        <p style={p}>DumpSite.io is not liable for any damages arising from the use of the Platform, including but not limited to property damage during transport, personal injury, or lost profits. Our maximum liability is limited to the fees paid to us in the 12 months preceding the claim. The Platform is provided "as is" without warranties of any kind.</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>11. Changes to Terms</h2>
        <p style={p}>We may update these terms at any time. Continued use of the Platform after changes constitutes acceptance. Material changes will be communicated via email or in-app notification.</p>

        <p style={{ ...p, marginTop: '40px', color: '#606670' }}>Questions? Contact us at support@dumpsite.io</p>
      </div>
    </div>
  )
}
