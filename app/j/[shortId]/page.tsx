'use client'
import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

// Short URL redirect: /j/abc123 -> /job-access/abc123
export default function ShortLinkRedirect() {
  const { shortId } = useParams<{ shortId: string }>()
  const router = useRouter()

  useEffect(() => {
    if (shortId) router.replace(`/job-access/${shortId}`)
  }, [shortId, router])

  return (
    <div style={{ background: '#0A0C0F', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#606670', fontFamily: 'system-ui' }}>
      Loading your job...
    </div>
  )
}
