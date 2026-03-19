import { test, expect } from '@playwright/test'

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'test-admin@dumpsite.io'
const ADMIN_PASS  = process.env.TEST_ADMIN_PASS  || 'adminpass123!'

test.describe('Admin dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', ADMIN_EMAIL)
    await page.fill('input[type="password"]', ADMIN_PASS)
    await page.click('button[type="submit"]')
    await page.waitForURL(/admin/)
  })

  test('shows load request tabs: pending, approved, rejected, completed', async ({ page }) => {
    await expect(page.locator('button:has-text("pending")')).toBeVisible()
    await expect(page.locator('button:has-text("approved")')).toBeVisible()
    await expect(page.locator('button:has-text("rejected")')).toBeVisible()
    await expect(page.locator('button:has-text("completed")')).toBeVisible()
  })

  test('reject button requires a reason', async ({ page }) => {
    const pendingLoad = page.locator('[data-testid="load-card"]').first()
    if (await pendingLoad.isVisible()) {
      await pendingLoad.locator('text=Reject').click()
      // Try to confirm without a reason
      await pendingLoad.locator('text=Confirm Reject').click()
      await expect(page.locator('text=Please enter a rejection reason')).toBeVisible()
    }
  })

  test('approve shows success message', async ({ page }) => {
    const pendingLoad = page.locator('[data-testid="load-card"]').first()
    if (await pendingLoad.isVisible()) {
      await pendingLoad.locator('text=Approve').click()
      await expect(page.locator('text=Approved')).toBeVisible({ timeout: 15000 })
    }
  })

  test('API /api/admin/loads returns 401 without auth', async ({ request }) => {
    const res = await request.get('/api/admin/loads')
    expect(res.status()).toBe(401)
  })

  test('API /api/admin/dispatch returns 401 without auth', async ({ request }) => {
    const res = await request.get('/api/admin/dispatch')
    expect(res.status()).toBe(401)
  })
})
