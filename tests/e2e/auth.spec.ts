import { test, expect } from '@playwright/test'

const DRIVER_EMAIL = process.env.TEST_DRIVER_EMAIL || 'test-driver@dumpsite.io'
const DRIVER_PASS  = process.env.TEST_DRIVER_PASS  || 'testpass123!'
const ADMIN_EMAIL  = process.env.TEST_ADMIN_EMAIL  || 'test-admin@dumpsite.io'
const ADMIN_PASS   = process.env.TEST_ADMIN_PASS   || 'adminpass123!'

test.describe('Authentication flows', () => {
  test('homepage loads correctly', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/DumpSite/)
    await expect(page.locator('text=Get paid')).toBeVisible()
    await expect(page.locator('text=Sign In')).toBeVisible()
  })

  test('hidden admin link is NOT present in homepage HTML', async ({ page }) => {
    await page.goto('/')
    // Old bug: invisible "." link pointed to /admin
    const adminLinks = page.locator('a[href="/admin"]')
    // Should not exist on public page
    const count = await adminLinks.count()
    const isHiddenLink = count > 0 && await adminLinks.first().evaluate(el => {
      const style = window.getComputedStyle(el)
      return style.color === 'rgb(10, 10, 10)' || el.textContent?.trim() === '.'
    })
    expect(isHiddenLink).toBe(false)
  })

  test('driver login redirects to /dashboard', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', DRIVER_EMAIL)
    await page.fill('input[type="password"]', DRIVER_PASS)
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/dashboard/)
  })

  test('admin login redirects to /admin', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', ADMIN_EMAIL)
    await page.fill('input[type="password"]', ADMIN_PASS)
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/admin/)
  })

  test('unauthenticated user redirected from /dashboard', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/login/)
  })

  test('unauthenticated user redirected from /admin', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/login/)
  })

  test('driver redirected from /admin to /dashboard', async ({ page }) => {
    // Log in as driver
    await page.goto('/login')
    await page.fill('input[type="email"]', DRIVER_EMAIL)
    await page.fill('input[type="password"]', DRIVER_PASS)
    await page.click('button[type="submit"]')
    await page.waitForURL(/dashboard/)

    // Try to access admin
    await page.goto('/admin')
    await expect(page).toHaveURL(/dashboard/) // bounced back
  })

  test('sign out clears session and redirects to homepage', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', DRIVER_EMAIL)
    await page.fill('input[type="password"]', DRIVER_PASS)
    await page.click('button[type="submit"]')
    await page.waitForURL(/dashboard/)

    await page.click('text=Sign Out')
    await expect(page).toHaveURL('/')

    // Cannot access dashboard after sign out
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/login/)
  })
})
