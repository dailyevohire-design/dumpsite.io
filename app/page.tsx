import Link from 'next/link'

export default function Home() {
  return (
    <main style={{minHeight:'100vh',background:'#0A0C0F',color:'#E8E3DC',fontFamily:'system-ui,sans-serif',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'20px'}}>
      <div style={{textAlign:'center',maxWidth:'640px'}}>
        <img src="/logo.png" alt="DumpSite.io" style={{width:'220px',marginBottom:'24px'}}/>
        <h1 style={{fontSize:'42px',fontWeight:'900',marginBottom:'10px',lineHeight:'1.1'}}>Get Paid to Dump</h1>
        <p style={{fontSize:'18px',color:'#F5A623',fontWeight:'700',marginBottom:'8px'}}>Stop paying to dump. Start getting paid to haul.</p>
        <p style={{fontSize:'15px',color:'#606670',marginBottom:'40px',lineHeight:'1.6'}}>The DFW dirt logistics platform. Submit a load, get the address by SMS, deliver and get paid.</p>
        <div style={{display:'flex',gap:'12px',justifyContent:'center',flexWrap:'wrap',marginBottom:'48px'}}>
          <Link href="/signup" style={{background:'#F5A623',color:'#111',padding:'14px 36px',borderRadius:'10px',textDecoration:'none',fontWeight:'800',fontSize:'16px',textTransform:'uppercase',letterSpacing:'0.05em'}}>Driver Sign Up — Free</Link>
          <Link href="/login" style={{background:'transparent',color:'#E8E3DC',padding:'14px 32px',borderRadius:'10px',textDecoration:'none',fontWeight:'700',fontSize:'16px',border:'1px solid #272B33'}}>Sign In</Link>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'16px',marginBottom:'40px'}}>
          {[['$30','Per Dump Truck','#F5A623'],['47+','Active Orders','#27AE60'],['DFW','Coverage Area','#3A8AE8']].map(([val,label,color])=>(
            <div key={label} style={{background:'#111316',border:'1px solid #272B33',borderRadius:'12px',padding:'18px'}}>
              <div style={{fontSize:'32px',fontWeight:'900',color:color,marginBottom:'4px'}}>{val}</div>
              <div style={{fontSize:'12px',color:'#606670'}}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'12px',marginBottom:'40px'}}>
          {[['🚛',"Need a dumpsite? Don't see one listed?",'Submit a dumpsite request form'],['📱','Get address by SMS','We approve and send location'],['💰','Deliver and get paid','$20-$35 per load delivered']].map(([icon,title,desc])=>(
            <div key={title as string} style={{background:'#111316',border:'1px solid #272B33',borderRadius:'10px',padding:'14px',textAlign:'left'}}>
              <div style={{fontSize:'24px',marginBottom:'8px'}}>{icon}</div>
              <div style={{fontWeight:'700',fontSize:'13px',marginBottom:'4px'}}>{title}</div>
              <div style={{fontSize:'11px',color:'#606670',lineHeight:'1.5'}}>{desc}</div>
            </div>
          ))}
        </div>
        <div><Link href="/admin" style={{fontSize:'11px',color:'#1a1a1a',textDecoration:'none'}}>Admin</Link></div>
      </div>
    </main>
  )
}
