import { describe, it, expect, beforeEach } from 'vitest'
import { encryptAddress, decryptAddress } from '@/lib/crypto'

describe('Address Encryption (AES-256-GCM)', () => {
  const testAddress = '1234 Oak Creek Lane, Fort Worth, TX 76104'

  it('encrypts and decrypts an address correctly', () => {
    const encrypted = encryptAddress(testAddress)
    const decrypted = decryptAddress(encrypted)
    expect(decrypted).toBe(testAddress)
  })

  it('produces different ciphertext each time (random IV)', () => {
    const enc1 = encryptAddress(testAddress)
    const enc2 = encryptAddress(testAddress)
    expect(enc1.encrypted).not.toBe(enc2.encrypted)
    expect(enc1.iv).not.toBe(enc2.iv)
  })

  it('returns encrypted, iv, and authTag fields', () => {
    const result = encryptAddress(testAddress)
    expect(result).toHaveProperty('encrypted')
    expect(result).toHaveProperty('iv')
    expect(result).toHaveProperty('authTag')
    expect(typeof result.encrypted).toBe('string')
  })

  it('throws when authTag is tampered with', () => {
    const enc = encryptAddress(testAddress)
    enc.authTag = Buffer.from('tampered').toString('base64')
    expect(() => decryptAddress(enc)).toThrow('Address decryption failed')
  })

  it('throws when encrypted data is tampered with', () => {
    const enc = encryptAddress(testAddress)
    enc.encrypted = Buffer.from('garbage data here!!').toString('base64')
    expect(() => decryptAddress(enc)).toThrow()
  })

  it('handles long addresses with special characters', () => {
    const longAddress = '5678 Ranch Road #2244, Suite B, Denton, TX 76207 — Gate: #4411'
    const encrypted = encryptAddress(longAddress)
    const decrypted = decryptAddress(encrypted)
    expect(decrypted).toBe(longAddress)
  })

  it('throws when ADDRESS_ENCRYPTION_KEY is missing', () => {
    const original = process.env.ADDRESS_ENCRYPTION_KEY
    delete process.env.ADDRESS_ENCRYPTION_KEY
    expect(() => encryptAddress('test')).toThrow('ADDRESS_ENCRYPTION_KEY')
    process.env.ADDRESS_ENCRYPTION_KEY = original!
  })

  it('throws when ADDRESS_ENCRYPTION_KEY is wrong length', () => {
    const original = process.env.ADDRESS_ENCRYPTION_KEY
    process.env.ADDRESS_ENCRYPTION_KEY = 'tooshort'
    expect(() => encryptAddress('test')).toThrow()
    process.env.ADDRESS_ENCRYPTION_KEY = original!
  })
})
