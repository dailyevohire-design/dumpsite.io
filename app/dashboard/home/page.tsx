'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DashboardHomeRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard') }, [])
  return (
    <div style={{background:'#0A0C0F',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:'#606670',fontFamily:'system-ui'}}>
      Loading...
    </div>
  )
}
