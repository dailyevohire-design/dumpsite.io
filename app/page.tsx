import Link from 'next/link'

export default function Home() {
  return (
    <main style={{minHeight:'100vh',background:'#0A0A0A',color:'#F0EDE8',fontFamily:'"Georgia",serif',overflowX:'hidden'}}>

      {/* Nav */}
      <nav style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'24px 48px',borderBottom:'1px solid #1A1A1A'}}>
        <span style={{fontFamily:'"Georgia",serif',fontSize:'18px',fontWeight:'700',letterSpacing:'0.02em',color:'#F0EDE8'}}>
          DUMPSITE<span style={{color:'#F5A623'}}>.IO</span>
        </span>
        <div style={{display:'flex',gap:'12px',alignItems:'center'}}>
          <Link href="/login" style={{color:'#888',textDecoration:'none',fontSize:'14px',letterSpacing:'0.05em'}}>SIGN IN</Link>
          <Link href="/signup" style={{background:'#F5A623',color:'#0A0A0A',textDecoration:'none',fontSize:'13px',fontWeight:'700',letterSpacing:'0.08em',padding:'10px 22px',borderRadius:'4px'}}>GET STARTED</Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={{padding:'100px 48px 80px',maxWidth:'1100px',margin:'0 auto'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'80px',alignItems:'center'}}>
          <div>
            <p style={{fontSize:'11px',letterSpacing:'0.2em',color:'#F5A623',fontFamily:'system-ui,sans-serif',marginBottom:'20px',textTransform:'uppercase'}}>Dallas - Fort Worth</p>
            <h1 style={{fontSize:'clamp(42px,5vw,72px)',fontWeight:'400',lineHeight:'1.05',marginBottom:'28px',color:'#F0EDE8'}}>
              Get paid<br/>
              <em style={{fontStyle:'italic',color:'#888'}}>every time</em><br/>
              you dump.
            </h1>
            <p style={{fontSize:'16px',color:'#666',lineHeight:'1.7',marginBottom:'40px',fontFamily:'system-ui,sans-serif',maxWidth:'400px'}}>
              We connect dump truck drivers with active job sites across DFW. Submit a load, get the address by SMS, deliver and get paid same day.
            </p>
            <Link href="/signup" style={{display:'inline-block',background:'#F5A623',color:'#0A0A0A',textDecoration:'none',fontSize:'13px',fontWeight:'800',letterSpacing:'0.1em',padding:'16px 36px',borderRadius:'4px',textTransform:'uppercase'}}>
              Driver Sign Up - Free
            </Link>
          </div>
          <div style={{display:'grid',gridTemplateRows:'1fr 1fr',gap:'2px',height:'320px'}}>
            <div style={{background:'#111',border:'1px solid #1E1E1E',borderRadius:'8px',padding:'32px',display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
              <div style={{fontSize:'52px',fontWeight:'300',color:'#F5A623',letterSpacing:'-2px',marginBottom:'4px'}}>$30</div>
              <div style={{fontSize:'12px',color:'#555',letterSpacing:'0.1em',fontFamily:'system-ui,sans-serif',textTransform:'uppercase'}}>Avg. per load delivered</div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'2px'}}>
              <div style={{background:'#111',border:'1px solid #1E1E1E',borderRadius:'8px',padding:'24px',display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
                <div style={{fontSize:'38px',fontWeight:'300',color:'#27AE60',letterSpacing:'-1px',marginBottom:'4px'}}>47+</div>
                <div style={{fontSize:'11px',color:'#555',letterSpacing:'0.1em',fontFamily:'system-ui,sans-serif',textTransform:'uppercase'}}>Active jobs</div>
              </div>
              <div style={{background:'#111',border:'1px solid #1E1E1E',borderRadius:'8px',padding:'24px',display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
                <div style={{fontSize:'38px',fontWeight:'300',color:'#3A8AE8',letterSpacing:'-1px',marginBottom:'4px'}}>DFW</div>
                <div style={{fontSize:'11px',color:'#555',letterSpacing:'0.1em',fontFamily:'system-ui,sans-serif',textTransform:'uppercase'}}>Coverage area</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div style={{borderTop:'1px solid #1A1A1A',maxWidth:'1100px',margin:'0 auto'}}/>

      {/* How it works */}
      <section style={{padding:'80px 48px',maxWidth:'1100px',margin:'0 auto'}}>
        <p style={{fontSize:'11px',letterSpacing:'0.2em',color:'#F5A623',fontFamily:'system-ui,sans-serif',marginBottom:'12px',textTransform:'uppercase'}}>The process</p>
        <h2 style={{fontSize:'36px',fontWeight:'400',color:'#F0EDE8',marginBottom:'56px'}}>Three steps to your first paycheck.</h2>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1px',background:'#1A1A1A',border:'1px solid #1A1A1A',borderRadius:'8px',overflow:'hidden'}}>
          {[
            ['01','Create your account','Sign up as a driver in under two minutes. No fees, no paperwork, no commitments.'],
            ['02','Confirm your email','Check your inbox for a confirmation from DumpSite.io and verify your account to get access.'],
            ['03','Start taking jobs','Browse active dump sites across DFW, submit your load, and receive the delivery address by SMS.']
          ].map(([num,title,desc])=>(
            <div key={num} style={{background:'#0A0A0A',padding:'40px 32px'}}>
              <div style={{fontSize:'11px',color:'#F5A623',letterSpacing:'0.15em',fontFamily:'system-ui,sans-serif',marginBottom:'24px',textTransform:'uppercase'}}>{num}</div>
              <div style={{fontSize:'18px',color:'#F0EDE8',marginBottom:'12px',fontWeight:'400',lineHeight:'1.3'}}>{title}</div>
              <div style={{fontSize:'13px',color:'#555',lineHeight:'1.7',fontFamily:'system-ui,sans-serif'}}>{desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Divider */}
      <div style={{borderTop:'1px solid #1A1A1A',maxWidth:'1100px',margin:'0 auto'}}/>

      {/* Bottom CTA */}
      <section style={{padding:'80px 48px',maxWidth:'1100px',margin:'0 auto',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>
          <h3 style={{fontSize:'28px',fontWeight:'400',color:'#F0EDE8',marginBottom:'8px'}}>Ready to start hauling?</h3>
          <p style={{fontSize:'14px',color:'#555',fontFamily:'system-ui,sans-serif'}}>Join hundreds of DFW drivers already getting paid to dump.</p>
        </div>
        <Link href="/signup" style={{display:'inline-block',background:'#F5A623',color:'#0A0A0A',textDecoration:'none',fontSize:'13px',fontWeight:'800',letterSpacing:'0.1em',padding:'16px 36px',borderRadius:'4px',textTransform:'uppercase',whiteSpace:'nowrap'}}>
          Sign Up Free
        </Link>
      </section>

      {/* Footer */}
      <footer style={{borderTop:'1px solid #1A1A1A',padding:'24px 48px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontSize:'12px',color:'#333',fontFamily:'system-ui,sans-serif'}}>2025 DumpSite.io. All rights reserved.</span>
        <Link href="/admin" style={{fontSize:'11px',color:'#1A1A1A',textDecoration:'none'}}>.</Link>
      </footer>

    </main>
  )
}
