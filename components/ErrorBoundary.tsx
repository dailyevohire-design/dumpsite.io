'use client'
import React from 'react'

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: any) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  componentDidCatch(error: Error, info: any) {
    console.error('ErrorBoundary caught:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{
          background:'#111316', border:'1px solid #272B33',
          borderRadius:'12px', padding:'32px', textAlign:'center',
          margin:'20px', fontFamily:'system-ui'
        }}>
          <div style={{fontSize:'32px', marginBottom:'12px'}}>⚠️</div>
          <div style={{fontWeight:'700', fontSize:'16px',
            color:'#E8E3DC', marginBottom:'8px'}}>
            Something went wrong
          </div>
          <div style={{fontSize:'13px', color:'#606670',
            marginBottom:'20px'}}>
            We have been notified and are fixing it.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              background:'#F5A623', color:'#111', border:'none',
              padding:'10px 24px', borderRadius:'8px',
              fontWeight:'700', cursor:'pointer', fontSize:'14px'
            }}
          >
            Reload Page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
