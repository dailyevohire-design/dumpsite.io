import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

function getKey(): Buffer {
  const keyHex = process.env.ADDRESS_ENCRYPTION_KEY
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('ADDRESS_ENCRYPTION_KEY must be 64 hex characters')
  }
  return Buffer.from(keyHex, 'hex')
}

export interface EncryptedAddress {
  encrypted: string
  iv: string
  authTag: string
}

export function encryptAddress(plaintext: string): EncryptedAddress {
  const key = getKey()
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64')
  }
}

export function decryptAddress(data: EncryptedAddress): string {
  const key = getKey()
  const iv = Buffer.from(data.iv, 'base64')
  const authTag = Buffer.from(data.authTag, 'base64')
  const encryptedBuffer = Buffer.from(data.encrypted, 'base64')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  try {
    return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Address decryption failed - data may have been tampered with')
  }
}
