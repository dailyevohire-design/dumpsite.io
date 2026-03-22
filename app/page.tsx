import Link from 'next/link'
import LiveStats from '@/components/LiveStats'

const CITIES = ['Arlington','Azle','Bonham','Carrollton','Carthage','Cedar Hill','Cleburne','Colleyville','Covington','Dallas','Denison','Denton','DeSoto','Everman','Ferris','Fort Worth','Garland','Godley','Gordonville','Grand Prairie','Haslet','Hillsboro','Houston','Hutchins','Hutto','Irving','Joshua','Justin','Kaufman','Lake Worth','Little Elm','Mabank','Mansfield','Matador','McKinney','Mesquite','Midlothian','Plano','Ponder','Princeton','Rockwall','Terrell','Venus']

export default function Home() {
  return (
    <main style={{minHeight:'100vh',background:'#0A0A0A',color:'#F0EDE8',fontFamily:'"Georgia",serif'}}>
      <style>{`
        .fade-in{opacity:0;transform:translateY(20px);animation:fadeUp .6s ease forwards}
        @keyframes fadeUp{to{opacity:1;transform:translateY(0)}}
        .fade-d1{animation-delay:.1s}.fade-d2{animation-delay:.2s}.fade-d3{animation-delay:.3s}.fade-d4{animation-delay:.4s}
        @media(max-width:768px){.hero-split{grid-template-columns:1fr!important}.tier-grid{grid-template-columns:1fr 1fr!important}.proof-grid{grid-template-columns:1fr!important}.steps-2col{grid-template-columns:1fr!important}.city-tags{justify-content:center!important}.cta-split{grid-template-columns:1fr!important}.footer-links{flex-direction:column;align-items:center;gap:16px!important}}
      `}</style>

      {/* Nav */}
      <nav style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'16px 24px',borderBottom:'1px solid #1A1A1A',position:'sticky',top:0,background:'#0A0A0A',zIndex:50}}>
        <span style={{fontSize:'18px',fontWeight:'700',letterSpacing:'0.02em'}}>DUMPSITE<span style={{color:'#F5A623'}}>.IO</span></span>
        <div style={{display:'flex',gap:'12px',alignItems:'center',fontFamily:'system-ui'}}>
          <Link href="/dumpsite-request" style={{color:'#888',textDecoration:'none',fontSize:'13px'}}>POST A JOB</Link>
          <Link href="/signup" style={{color:'#888',textDecoration:'none',fontSize:'13px'}}>SIGN UP</Link>
          <Link href="/login" style={{background:'#F5A623',color:'#0A0A0A',textDecoration:'none',fontSize:'13px',fontWeight:'700',padding:'10px 18px',borderRadius:'4px'}}>SIGN IN</Link>
        </div>
      </nav>

      {/* S1: Hero Split */}
      <section style={{maxWidth:'1100px',margin:'0 auto',padding:'60px 24px'}}>
        <div className="hero-split fade-in" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'40px'}}>
          <div style={{borderRight:'1px solid #1A1A1A',paddingRight:'40px'}}>
            <p style={{fontSize:'11px',letterSpacing:'0.2em',color:'#F5A623',fontFamily:'system-ui',textTransform:'uppercase',marginBottom:'16px'}}>For Drivers</p>
            <h1 style={{fontSize:'clamp(32px,4vw,52px)',fontWeight:'400',lineHeight:'1.1',marginBottom:'20px'}}>Get Paid to Dump.<br/><em style={{fontStyle:'italic',color:'#888'}}>Every Load.</em></h1>
            <p style={{fontSize:'15px',color:'#666',lineHeight:'1.7',marginBottom:'28px',fontFamily:'system-ui'}}>$35–$55 per load. DFW's fastest growing driver network.</p>
            <Link href="/signup" style={{display:'inline-block',background:'#F5A623',color:'#0A0A0A',textDecoration:'none',fontSize:'13px',fontWeight:'800',letterSpacing:'0.1em',padding:'16px 32px',borderRadius:'4px',textTransform:'uppercase',fontFamily:'system-ui'}}>Start Hauling — It's Free</Link>
            <p style={{fontSize:'12px',color:'#555',marginTop:'14px',fontFamily:'system-ui'}}>Join 200+ DFW drivers already on the platform</p>
          </div>
          <div>
            <p style={{fontSize:'11px',letterSpacing:'0.2em',color:'#3A8AE8',fontFamily:'system-ui',textTransform:'uppercase',marginBottom:'16px'}}>For Contractors</p>
            <h1 style={{fontSize:'clamp(32px,4vw,52px)',fontWeight:'400',lineHeight:'1.1',marginBottom:'20px'}}>Need Dirt Gone?<br/><em style={{fontStyle:'italic',color:'#888'}}>We Handle It.</em></h1>
            <p style={{fontSize:'15px',color:'#666',lineHeight:'1.7',marginBottom:'28px',fontFamily:'system-ui'}}>Post a job in 60 seconds. Drivers dispatched within the hour.</p>
            <Link href="/dumpsite-request" style={{display:'inline-block',background:'#3A8AE8',color:'#fff',textDecoration:'none',fontSize:'13px',fontWeight:'800',letterSpacing:'0.1em',padding:'16px 32px',borderRadius:'4px',textTransform:'uppercase',fontFamily:'system-ui'}}>Post a Job</Link>
            <p style={{fontSize:'12px',color:'#555',marginTop:'14px',fontFamily:'system-ui'}}>Trusted by excavation companies across DFW</p>
          </div>
        </div>
      </section>

      {/* S2: Live Stats Bar */}
      <section style={{background:'#111',borderTop:'1px solid #1A1A1A',borderBottom:'1px solid #1A1A1A'}}>
        <div style={{maxWidth:'1100px',margin:'0 auto',padding:'24px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'16px'}}>
            <div style={{width:'8px',height:'8px',borderRadius:'50%',background:'#27AE60',boxShadow:'0 0 8px rgba(39,174,96,0.5)',animation:'pulse 2s infinite'}} />
            <span style={{fontSize:'10px',letterSpacing:'0.15em',color:'#606670',fontFamily:'system-ui',textTransform:'uppercase',fontWeight:'700'}}>Live Market Data</span>
          </div>
          <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
          <LiveStats />
        </div>
      </section>

      {/* S3: How It Works */}
      <section className="fade-in fade-d1" style={{maxWidth:'1100px',margin:'0 auto',padding:'60px 24px'}}>
        <p style={{fontSize:'11px',letterSpacing:'0.2em',color:'#F5A623',fontFamily:'system-ui',textTransform:'uppercase',marginBottom:'12px'}}>How It Works</p>
        <h2 style={{fontSize:'32px',fontWeight:'400',marginBottom:'40px'}}>Simple for everyone.</h2>
        <div className="steps-2col" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'40px'}}>
          <div>
            <h3 style={{fontSize:'14px',color:'#F5A623',fontFamily:'system-ui',fontWeight:'700',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:'20px'}}>For Drivers</h3>
            {['Create free account (2 minutes)','See available jobs in your city','Submit your load with a photo','Get the delivery address by SMS','Deliver and get paid'].map((s,i)=>(
              <div key={i} style={{display:'flex',gap:'14px',marginBottom:'16px',fontFamily:'system-ui'}}>
                <div style={{width:'28px',height:'28px',borderRadius:'50%',border:'1px solid #F5A623',color:'#F5A623',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'12px',fontWeight:'700',flexShrink:0}}>{i+1}</div>
                <p style={{fontSize:'14px',color:'#999',lineHeight:'1.6',paddingTop:'4px'}}>{s}</p>
              </div>
            ))}
          </div>
          <div>
            <h3 style={{fontSize:'14px',color:'#3A8AE8',fontFamily:'system-ui',fontWeight:'700',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:'20px'}}>For Contractors</h3>
            {['Post your job with address and material details','We dispatch verified drivers immediately','Track deliveries in real time','Receive completion photos as proof','Pay per load — no monthly fees'].map((s,i)=>(
              <div key={i} style={{display:'flex',gap:'14px',marginBottom:'16px',fontFamily:'system-ui'}}>
                <div style={{width:'28px',height:'28px',borderRadius:'50%',border:'1px solid #3A8AE8',color:'#3A8AE8',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'12px',fontWeight:'700',flexShrink:0}}>{i+1}</div>
                <p style={{fontSize:'14px',color:'#999',lineHeight:'1.6',paddingTop:'4px'}}>{s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div style={{borderTop:'1px solid #1A1A1A',maxWidth:'1100px',margin:'0 auto'}}/>

      {/* S4: Why DumpSite.io */}
      <section className="fade-in fade-d2" style={{maxWidth:'1100px',margin:'0 auto',padding:'60px 24px'}}>
        <p style={{fontSize:'11px',letterSpacing:'0.2em',color:'#F5A623',fontFamily:'system-ui',textTransform:'uppercase',marginBottom:'12px'}}>Why DumpSite.io</p>
        <h2 style={{fontSize:'32px',fontWeight:'400',marginBottom:'40px'}}>Built for the way dirt moves.</h2>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1px',background:'#1A1A1A',border:'1px solid #1A1A1A',borderRadius:'8px',overflow:'hidden'}}>
          {[
            {t:'Speed',d:'Jobs dispatched within 60 minutes of posting. Elite drivers notified first.',c:'#F5A623'},
            {t:'Trust',d:'Every driver verified. Every load photo-documented. Full audit trail.',c:'#27AE60'},
            {t:'Scale',d:'Starting DFW. Expanding nationally. The infrastructure for dirt movement.',c:'#3A8AE8'},
          ].map(f=>(
            <div key={f.t} style={{background:'#0A0A0A',padding:'36px 28px'}}>
              <div style={{width:'40px',height:'3px',background:f.c,marginBottom:'20px',borderRadius:'2px'}}/>
              <h3 style={{fontSize:'20px',fontWeight:'400',marginBottom:'12px'}}>{f.t}</h3>
              <p style={{fontSize:'14px',color:'#666',lineHeight:'1.7',fontFamily:'system-ui'}}>{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <div style={{borderTop:'1px solid #1A1A1A',maxWidth:'1100px',margin:'0 auto'}}/>

      {/* S5: Tier Cards */}
      <section className="fade-in fade-d3" style={{maxWidth:'1100px',margin:'0 auto',padding:'60px 24px'}}>
        <p style={{fontSize:'11px',letterSpacing:'0.2em',color:'#F5A623',fontFamily:'system-ui',textTransform:'uppercase',marginBottom:'12px'}}>Driver Tiers</p>
        <h2 style={{fontSize:'32px',fontWeight:'400',marginBottom:'40px'}}>Choose your level.</h2>
        <div className="tier-grid" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'12px'}}>
          {[
            {name:'Trial',price:'Free',color:'#27AE60',features:['3 loads to try','Standard dispatch','SMS notifications'],cta:'Start Free'},
            {name:'Hauler',price:'$49/mo',color:'#3A8AE8',features:['20 loads/month','Standard dispatch','SMS + email alerts'],cta:'Get Started'},
            {name:'Pro',price:'$99/mo',color:'#F5A623',features:['Unlimited loads','Priority dispatch','Faster SMS','Dedicated support'],cta:'Go Pro',popular:true},
            {name:'Elite',price:'$199/mo',color:'#8E44AD',features:['First access to every job','Highest pay rates','Dedicated support','VIP dispatch'],cta:'Go Elite'},
          ].map(t=>(
            <div key={t.name} style={{background:'#111',border:`1px solid ${t.popular?t.color:'#1A1A1A'}`,borderRadius:'10px',padding:'28px 20px',position:'relative'}}>
              {t.popular&&<div style={{position:'absolute',top:'-10px',left:'50%',transform:'translateX(-50%)',background:t.color,color:'#0A0A0A',fontSize:'10px',fontWeight:'800',padding:'3px 12px',borderRadius:'4px',fontFamily:'system-ui',textTransform:'uppercase',letterSpacing:'0.05em'}}>Most Popular</div>}
              <div style={{width:'10px',height:'10px',borderRadius:'50%',background:t.color,marginBottom:'16px'}}/>
              <h3 style={{fontSize:'18px',fontWeight:'400',marginBottom:'4px'}}>{t.name}</h3>
              <div style={{fontSize:'28px',fontWeight:'300',color:t.color,marginBottom:'20px',fontFamily:'system-ui'}}>{t.price}</div>
              {t.features.map(f=><p key={f} style={{fontSize:'13px',color:'#888',marginBottom:'8px',fontFamily:'system-ui'}}>✓ {f}</p>)}
              <Link href="/signup" style={{display:'block',textAlign:'center',marginTop:'20px',padding:'12px',borderRadius:'6px',textDecoration:'none',fontWeight:'700',fontSize:'13px',fontFamily:'system-ui',background:t.popular?t.color:'transparent',color:t.popular?'#0A0A0A':'#888',border:`1px solid ${t.popular?t.color:'#333'}`}}>{t.cta}</Link>
            </div>
          ))}
        </div>
      </section>

      <div style={{borderTop:'1px solid #1A1A1A',maxWidth:'1100px',margin:'0 auto'}}/>

      {/* S6: Social Proof */}
      <section className="fade-in fade-d4" style={{maxWidth:'1100px',margin:'0 auto',padding:'60px 24px'}}>
        <p style={{fontSize:'11px',letterSpacing:'0.2em',color:'#F5A623',fontFamily:'system-ui',textTransform:'uppercase',marginBottom:'12px'}}>Drivers Love Us</p>
        <h2 style={{fontSize:'32px',fontWeight:'400',marginBottom:'40px'}}>Real drivers. Real earnings.</h2>
        <div className="proof-grid" style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'16px'}}>
          {[
            {name:'Marcus T.',city:'Dallas',quote:'Made $1,200 my first week. Best platform I\'ve used.',stars:5},
            {name:'DeShawn R.',city:'Fort Worth',quote:'Jobs come straight to my phone. I don\'t chase work anymore.',stars:5},
            {name:'Carlos M.',city:'Arlington',quote:'Upgraded to Pro after my first load. Worth every penny.',stars:5},
          ].map(r=>(
            <div key={r.name} style={{background:'#111',border:'1px solid #1A1A1A',borderRadius:'10px',padding:'28px'}}>
              <div style={{color:'#F5A623',fontSize:'16px',marginBottom:'14px'}}>{'★'.repeat(r.stars)}</div>
              <p style={{fontSize:'14px',color:'#999',lineHeight:'1.7',marginBottom:'16px',fontFamily:'system-ui',fontStyle:'italic'}}>"{r.quote}"</p>
              <p style={{fontSize:'13px',fontWeight:'600',fontFamily:'system-ui'}}>{r.name}</p>
              <p style={{fontSize:'12px',color:'#555',fontFamily:'system-ui'}}>{r.city}</p>
            </div>
          ))}
        </div>
      </section>

      <div style={{borderTop:'1px solid #1A1A1A',maxWidth:'1100px',margin:'0 auto'}}/>

      {/* S7: City Coverage */}
      <section style={{maxWidth:'1100px',margin:'0 auto',padding:'60px 24px'}}>
        <p style={{fontSize:'11px',letterSpacing:'0.2em',color:'#F5A623',fontFamily:'system-ui',textTransform:'uppercase',marginBottom:'12px'}}>Coverage</p>
        <h2 style={{fontSize:'32px',fontWeight:'400',marginBottom:'8px'}}>Operating Across 40+ DFW Cities</h2>
        <p style={{fontSize:'14px',color:'#666',marginBottom:'32px',fontFamily:'system-ui'}}>Expanding to Houston, Austin, and San Antonio in 2025</p>
        <div className="city-tags" style={{display:'flex',flexWrap:'wrap',gap:'8px'}}>
          {CITIES.map(c=>(
            <span key={c} style={{background:'#111',border:'1px solid #1A1A1A',borderRadius:'6px',padding:'6px 14px',fontSize:'12px',color:'#888',fontFamily:'system-ui'}}>📍 {c}</span>
          ))}
        </div>
      </section>

      <div style={{borderTop:'1px solid #1A1A1A',maxWidth:'1100px',margin:'0 auto'}}/>

      {/* S8: Contractor CTA */}
      <section style={{background:'#111',borderTop:'1px solid #1A1A1A',borderBottom:'1px solid #1A1A1A',padding:'60px 24px'}}>
        <div style={{maxWidth:'700px',margin:'0 auto',textAlign:'center'}}>
          <h2 style={{fontSize:'28px',fontWeight:'400',marginBottom:'12px'}}>Have a construction site that needs dirt removed?</h2>
          <p style={{fontSize:'15px',color:'#888',marginBottom:'32px',fontFamily:'system-ui'}}>We have verified drivers ready in your city today.</p>
          <Link href="/dumpsite-request" style={{display:'inline-block',background:'#F5A623',color:'#0A0A0A',textDecoration:'none',fontSize:'14px',fontWeight:'800',letterSpacing:'0.08em',padding:'16px 40px',borderRadius:'4px',textTransform:'uppercase',fontFamily:'system-ui'}}>Get Drivers Now</Link>
        </div>
      </section>

      {/* S9: Footer */}
      <footer style={{maxWidth:'1100px',margin:'0 auto',padding:'40px 24px'}}>
        <div className="footer-links" style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontFamily:'system-ui',fontSize:'13px',color:'#555',flexWrap:'wrap',gap:'20px'}}>
          <div style={{display:'flex',gap:'24px'}}>
            <Link href="/signup" style={{color:'#888',textDecoration:'none'}}>Driver Signup</Link>
            <Link href="/dumpsite-request" style={{color:'#888',textDecoration:'none'}}>Post a Job</Link>
            <Link href="/terms" style={{color:'#888',textDecoration:'none'}}>Terms</Link>
            <Link href="/privacy" style={{color:'#888',textDecoration:'none'}}>Privacy</Link>
          </div>
          <p>© 2025 DumpSite.io — All rights reserved.</p>
        </div>
      </footer>
    </main>
  )
}
