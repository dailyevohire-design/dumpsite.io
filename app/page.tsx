import Link from 'next/link'
import LiveStats from '@/components/LiveStats'

export default function Home() {
  return (
    <main style={{minHeight:'100vh',background:'#0A0A0A',color:'#F0EDE8',fontFamily:'"Georgia",serif'}}>
      <style>{`
        .nav{display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-bottom:1px solid #1A1A1A;}
        .hero{padding:60px 24px 48px;max-width:1100px;margin:0 auto;}
        .hero-grid{display:grid;grid-template-columns:1fr 1fr;gap:60px;align-items:center;}
        .stats-grid{display:grid;grid-template-rows:1fr 1fr;gap:2px;height:280px;}
        .stats-bottom{display:grid;grid-template-columns:1fr 1fr;gap:2px;}
        .section{padding:60px 24px;max-width:1100px;margin:0 auto;}
        .steps-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#1A1A1A;border:1px solid #1A1A1A;border-radius:8px;overflow:hidden;}
        .step{background:#0A0A0A;padding:36px 28px;}
        .cta-row{padding:60px 24px;max-width:1100px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;gap:24px;}
        .cta-btn{display:inline-block;background:#F5A623;color:#0A0A0A;text-decoration:none;font-size:13px;font-weight:800;letter-spacing:0.1em;padding:16px 32px;border-radius:4px;text-transform:uppercase;white-space:nowrap;}
        .divider{border-top:1px solid #1A1A1A;max-width:1100px;margin:0 auto;}
        @media(max-width:768px){
          .nav{padding:16px 20px;}
          .hero{padding:40px 20px 36px;}
          .hero-grid{grid-template-columns:1fr;gap:36px;}
          .stats-grid{height:auto;gap:8px;}
          .stats-bottom{gap:8px;}
          .stat-card{padding:20px!important;}
          .stat-num{font-size:36px!important;}
          .section{padding:48px 20px;}
          .steps-grid{grid-template-columns:1fr;gap:1px;}
          .step{padding:28px 24px;}
          .cta-row{flex-direction:column;text-align:center;padding:48px 20px;}
          .cta-btn{width:100%;text-align:center;box-sizing:border-box;}
          h1{font-size:42px!important;}
          .hero-p{font-size:15px!important;}
          .hero-cta{width:100%;text-align:center;box-sizing:border-box;display:block!important;}
        }
      `}</style>

      {/* Nav */}
      <nav className="nav">
        <span style={{fontFamily:'"Georgia",serif',fontSize:'18px',fontWeight:'700',letterSpacing:'0.02em',color:'#F0EDE8'}}>
          DUMPSITE<span style={{color:'#F5A623'}}>.IO</span>
        </span>
        <div style={{display:'flex',gap:'12px',alignItems:'center'}}>
          <Link href="/signup" style={{color:'#888',textDecoration:'none',fontSize:'13px',letterSpacing:'0.05em'}}>GET STARTED</Link>
          <Link href="/login" style={{background:'#F5A623',color:'#0A0A0A',textDecoration:'none',fontSize:'13px',fontWeight:'700',letterSpacing:'0.08em',padding:'10px 18px',borderRadius:'4px'}}>SIGN IN</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="hero">
        <div className="hero-grid">
          <div>
            <p style={{fontSize:'11px',letterSpacing:'0.2em',color:'#F5A623',fontFamily:'system-ui,sans-serif',marginBottom:'20px',textTransform:'uppercase'}}>Dallas - Fort Worth</p>
            <h1 style={{fontSize:'clamp(42px,5vw,72px)',fontWeight:'400',lineHeight:'1.05',marginBottom:'24px',color:'#F0EDE8',margin:'0 0 24px 0'}}>
              Get paid<br/>
              <em style={{fontStyle:'italic',color:'#888'}}>every time</em><br/>
              you dump.
            </h1>
            <p className="hero-p" style={{fontSize:'16px',color:'#666',lineHeight:'1.7',marginBottom:'36px',fontFamily:'system-ui,sans-serif'}}>
              We connect dump truck drivers with active job sites across DFW. Submit a load, get the address by SMS, deliver and get paid same day.
            </p>
            <Link href="/signup" className="hero-cta" style={{display:'inline-block',background:'#F5A623',color:'#0A0A0A',textDecoration:'none',fontSize:'13px',fontWeight:'800',letterSpacing:'0.1em',padding:'16px 32px',borderRadius:'4px',textTransform:'uppercase'}}>
              Driver Sign Up — Free
            </Link>
          </div>
          <LiveStats />
        </div>
      </section>

      <div className="divider"/>

      {/* How it works */}
      <section className="section">
        <p style={{fontSize:'11px',letterSpacing:'0.2em',color:'#F5A623',fontFamily:'system-ui,sans-serif',marginBottom:'12px',textTransform:'uppercase'}}>The process</p>
        <h2 style={{fontSize:'clamp(28px,4vw,36px)',fontWeight:'400',color:'#F0EDE8',marginBottom:'48px'}}>Three steps to your first paycheck.</h2>
        <div className="steps-grid">
          {[
            ['01','Create your account','Sign up as a driver in under two minutes. No fees, no paperwork, no commitments.'],
            ['02','Confirm your email','Check your inbox for a confirmation from DumpSite.io and verify your account to get access.'],
            ['03','Start taking jobs','Browse active dump sites across DFW, submit your load, and receive the delivery address by SMS.']
          ].map(([num,title,desc])=>(
            <div key={num} className="step">
              <div style={{fontSize:'11px',color:'#F5A623',letterSpacing:'0.15em',fontFamily:'system-ui,sans-serif',marginBottom:'20px',textTransform:'uppercase'}}>{num}</div>
              <div style={{fontSize:'18px',color:'#F0EDE8',marginBottom:'10px',fontWeight:'400',lineHeight:'1.3'}}>{title}</div>
              <div style={{fontSize:'13px',color:'#555',lineHeight:'1.7',fontFamily:'system-ui,sans-serif'}}>{desc}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="divider"/>

      {/* CTA */}
      <div className="cta-row">
        <div>
          <h3 style={{fontSize:'clamp(22px,3vw,28px)',fontWeight:'400',color:'#F0EDE8',marginBottom:'8px'}}>Ready to start hauling?</h3>
          <p style={{fontSize:'14px',color:'#555',fontFamily:'system-ui,sans-serif',margin:0}}>Join hundreds of DFW drivers already getting paid to dump.</p>
        </div>
        <Link href="/signup" className="cta-btn">Sign Up Free</Link>
      </div>

      {/* Footer */}
      <footer style={{borderTop:'1px solid #1A1A1A',padding:'20px 24px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontSize:'12px',color:'#333',fontFamily:'system-ui,sans-serif'}}>2025 DumpSite.io. All rights reserved.</span>
        <Link href="/admin" style={{fontSize:'11px',color:'#0A0A0A',textDecoration:'none'}}>.</Link>
      </footer>
    </main>
  )
}
