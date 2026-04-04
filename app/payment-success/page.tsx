'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function PaymentContent() {
  const params = useSearchParams()
  const cancelled = params.get('cancelled')

  if (cancelled) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Payment Cancelled</h1>
        <p style={{ fontSize: '18px', color: '#666' }}>
          No worries. Text us back if you change your mind or want to go with standard delivery instead.
        </p>
      </div>
    )
  }

  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Payment Received</h1>
      <p style={{ fontSize: '18px', color: '#666' }}>
        You'll get a text confirmation shortly with your delivery details.
      </p>
    </div>
  )
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={
      <div style={{ textAlign: 'center', padding: '60px 20px', fontFamily: 'system-ui, sans-serif' }}>
        <p style={{ fontSize: '18px', color: '#666' }}>Loading...</p>
      </div>
    }>
      <PaymentContent />
    </Suspense>
  )
}
