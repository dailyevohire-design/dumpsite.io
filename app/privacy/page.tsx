import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'Privacy Policy' }

export default function PrivacyPage() {
  const s = { color: '#F0EDE8', fontFamily: 'system-ui, sans-serif', background: '#0A0A0A', minHeight: '100vh', padding: '40px 20px' }
  const h = { fontFamily: 'Georgia, serif', color: '#F0EDE8', marginBottom: '16px' }
  const p = { color: '#999', fontSize: '14px', lineHeight: '1.8', marginBottom: '16px' }
  return (
    <div style={s}>
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
        <a href="/" style={{ textDecoration: 'none' }}><span style={{ fontFamily: 'Georgia, serif', fontSize: '18px', fontWeight: '700', color: '#F0EDE8' }}>DUMPSITE<span style={{ color: '#F5A623' }}>.IO</span></span></a>
        <h1 style={{ ...h, fontSize: '32px', marginTop: '32px' }}>Privacy Policy</h1>
        <p style={{ ...p, color: '#606670' }}>Last updated: March 22, 2026</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '32px' }}>1. Information We Collect</h2>
        <p style={p}><strong style={{ color: '#F0EDE8' }}>Account Information:</strong> Name, email address, phone number, company name, truck type, and number of trucks. <br/><strong style={{ color: '#F0EDE8' }}>Financial Information:</strong> Bank account details (routing number, account number) for payout processing. This data is encrypted at rest using AES-256-GCM encryption. <br/><strong style={{ color: '#F0EDE8' }}>Location Data:</strong> GPS coordinates collected during active job tracking to verify delivery completion. Location is only tracked after you accept a job and grant permission. <br/><strong style={{ color: '#F0EDE8' }}>Photos:</strong> Dirt/material photos submitted with load requests and completion photos verifying delivery. <br/><strong style={{ color: '#F0EDE8' }}>Usage Data:</strong> Pages visited, features used, device information, and IP address for analytics and security.</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>2. How We Use Your Information</h2>
        <p style={p}>We use your information to: (a) operate and improve the Platform; (b) match drivers with available jobs; (c) process payments and payouts; (d) verify job completions via GPS and photo evidence; (e) send job notifications via SMS and email; (f) prevent fraud and enforce our Terms of Service; (g) comply with legal obligations including tax reporting (1099 forms).</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>3. Information Sharing</h2>
        <p style={p}>We share information with: (a) <strong style={{ color: '#F0EDE8' }}>Twilio</strong> — for SMS delivery of job notifications and approval messages; (b) <strong style={{ color: '#F0EDE8' }}>Supabase</strong> — our database and authentication provider; (c) <strong style={{ color: '#F0EDE8' }}>Vercel</strong> — our hosting provider; (d) <strong style={{ color: '#F0EDE8' }}>Sentry</strong> — for error monitoring; (e) <strong style={{ color: '#F0EDE8' }}>Resend</strong> — for email delivery. We never sell your personal information. Delivery addresses are shared only with approved drivers via secure, time-limited links — never displayed in the application UI.</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>4. Data Security</h2>
        <p style={p}>All sensitive data (banking information, delivery addresses) is encrypted at rest using AES-256-GCM. All data in transit is protected by TLS 1.3. Access to sensitive data is restricted by role-based access controls. We conduct regular security audits. API keys and service credentials are stored in encrypted environment variables, never in source code.</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>5. GPS and Location Data</h2>
        <p style={p}>Location tracking occurs only during active job sessions — from the moment you accept a job until completion. GPS coordinates are recorded every 20 seconds during tracking. This data is used to: verify you arrived at the delivery site, calculate distance and ETA, and provide proof of delivery. Location data is retained for 90 days after job completion, then automatically purged.</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>6. Data Retention</h2>
        <p style={p}>Account information is retained for the life of your account plus 7 years (tax compliance). Financial records are retained for 7 years per IRS requirements. GPS tracking data is retained for 90 days. Photos are retained for 1 year. You may request early deletion of non-legally-required data by contacting support.</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>7. Your Rights</h2>
        <p style={p}><strong style={{ color: '#F0EDE8' }}>Access:</strong> You can view all your personal data in the Account section. <br/><strong style={{ color: '#F0EDE8' }}>Correction:</strong> Update your profile information at any time. <br/><strong style={{ color: '#F0EDE8' }}>Deletion:</strong> Request account deletion by emailing support@dumpsite.io. We will delete your account and non-legally-required data within 30 days. <br/><strong style={{ color: '#F0EDE8' }}>Portability:</strong> Request a copy of your data in machine-readable format. <br/><strong style={{ color: '#F0EDE8' }}>Opt-out:</strong> Reply STOP to any SMS to unsubscribe from text notifications.</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>8. California Privacy Rights (CCPA)</h2>
        <p style={p}>California residents have the right to: know what personal information is collected, request deletion, opt-out of the sale of personal information (we do not sell data), and not be discriminated against for exercising these rights. To exercise CCPA rights, email privacy@dumpsite.io.</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>9. Children's Privacy</h2>
        <p style={p}>The Platform is not intended for users under 18 years of age. We do not knowingly collect information from minors.</p>

        <h2 style={{ ...h, fontSize: '20px', marginTop: '24px' }}>10. Changes to This Policy</h2>
        <p style={p}>We may update this Privacy Policy periodically. Material changes will be communicated via email. Your continued use of the Platform after changes constitutes acceptance.</p>

        <p style={{ ...p, marginTop: '40px', color: '#606670' }}>Privacy questions? Contact privacy@dumpsite.io</p>
      </div>
    </div>
  )
}
