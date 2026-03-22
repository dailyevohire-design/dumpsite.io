'use client'
import { useState, useEffect } from 'react'

export default function LiveStats() {
  const [stats, setStats] = useState({ avgPayDollars: 30, activeJobs: 47, citiesActive: 12 })
  const [animated, setAnimated] = useState(false)

  useEffect(() => {
    fetch('/api/public/stats')
      .then(r => r.json())
      .then(d => {
        if (d.activeJobs) setStats(d)
      })
      .catch(() => {})
    // Trigger animation after mount
    setTimeout(() => setAnimated(true), 100)
  }, [])

  return (
    <div className="stats-grid">
      <div className="stat-card" style={{background:'#111',border:'1px solid #1E1E1E',borderRadius:'8px',padding:'28px',display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
        <div className="stat-num" style={{fontSize:'52px',fontWeight:'300',color:'#F5A623',letterSpacing:'-2px',marginBottom:'4px',transition:'opacity 0.5s',opacity:animated?1:0}}>
          ${stats.avgPayDollars}
        </div>
        <div style={{fontSize:'11px',color:'#555',letterSpacing:'0.1em',fontFamily:'system-ui,sans-serif',textTransform:'uppercase'}}>Avg. per load delivered</div>
      </div>
      <div className="stats-bottom">
        <div className="stat-card" style={{background:'#111',border:'1px solid #1E1E1E',borderRadius:'8px',padding:'24px',display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
          <div className="stat-num" style={{fontSize:'38px',fontWeight:'300',color:'#27AE60',letterSpacing:'-1px',marginBottom:'4px',transition:'opacity 0.5s',opacity:animated?1:0}}>
            {stats.activeJobs}+
          </div>
          <div style={{fontSize:'11px',color:'#555',letterSpacing:'0.1em',fontFamily:'system-ui,sans-serif',textTransform:'uppercase'}}>Active jobs</div>
        </div>
        <div className="stat-card" style={{background:'#111',border:'1px solid #1E1E1E',borderRadius:'8px',padding:'24px',display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
          <div className="stat-num" style={{fontSize:'38px',fontWeight:'300',color:'#3A8AE8',letterSpacing:'-1px',marginBottom:'4px',transition:'opacity 0.5s',opacity:animated?1:0}}>
            {stats.citiesActive}
          </div>
          <div style={{fontSize:'11px',color:'#555',letterSpacing:'0.1em',fontFamily:'system-ui,sans-serif',textTransform:'uppercase'}}>Active cities</div>
        </div>
      </div>
    </div>
  )
}
