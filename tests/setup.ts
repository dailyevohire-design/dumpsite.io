import '@testing-library/jest-dom'
import { vi, beforeAll, afterAll, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Auto cleanup after each test
afterEach(() => cleanup())

// ── Mock environment variables ──────────────────────────────────────────────
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
process.env.TWILIO_ACCOUNT_SID = 'ACtest123'
process.env.TWILIO_API_KEY = 'SKtest123'
process.env.TWILIO_API_SECRET = 'test-secret'
process.env.TWILIO_FROM_NUMBER = '+18005551234'
process.env.ADMIN_PHONE = '+15125551234'
process.env.ZAPIER_WEBHOOK_SECRET = 'test-zapier-secret'
process.env.ADDRESS_ENCRYPTION_KEY = 'a'.repeat(64) // 64 hex chars
process.env.NEXT_PUBLIC_APP_URL = 'https://dumpsite.io'

// ── Mock Next.js navigation ─────────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}))

// ── Mock Supabase ───────────────────────────────────────────────────────────
export const mockSupabase = {
  auth: {
    getUser: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
  },
  from: vi.fn(() => mockSupabase),
  select: vi.fn(() => mockSupabase),
  insert: vi.fn(() => mockSupabase),
  update: vi.fn(() => mockSupabase),
  upsert: vi.fn(() => mockSupabase),
  delete: vi.fn(() => mockSupabase),
  eq: vi.fn(() => mockSupabase),
  neq: vi.fn(() => mockSupabase),
  in: vi.fn(() => mockSupabase),
  gte: vi.fn(() => mockSupabase),
  ilike: vi.fn(() => mockSupabase),
  order: vi.fn(() => mockSupabase),
  limit: vi.fn(() => mockSupabase),
  range: vi.fn(() => mockSupabase),
  single: vi.fn(() => mockSupabase),
  maybeSingle: vi.fn(() => mockSupabase),
  storage: {
    from: vi.fn(() => ({
      upload: vi.fn(),
      getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://test.storage.co/photo.jpg' } })),
    })),
  },
}

vi.mock('@/lib/supabase', () => ({
  createBrowserSupabase: vi.fn(() => mockSupabase),
  createAdminSupabase: vi.fn(() => mockSupabase),
}))

vi.mock('@/lib/supabase.server', () => ({
  createServerSupabase: vi.fn(async () => mockSupabase),
}))

// ── Mock SMS ────────────────────────────────────────────────────────────────
vi.mock('@/lib/sms', () => ({
  sendApprovalSMS: vi.fn().mockResolvedValue({ success: true }),
  sendRejectionSMS: vi.fn().mockResolvedValue({ success: true }),
  sendDispatchSMS: vi.fn().mockResolvedValue({ success: true }),
  sendAdminAlert: vi.fn().mockResolvedValue({ success: true }),
  batchDispatchSMS: vi.fn().mockResolvedValue({ sent: 5, failed: 0 }),
}))
