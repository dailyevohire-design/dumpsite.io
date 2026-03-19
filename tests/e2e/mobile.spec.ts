import { test, expect, devices } from '@playwright/test'

// Mobile-specific tests — critical because drivers use phones in the field
test.describe('Mobile UI — Pixel 7 (Android truck driver device)', () => {
  test.use({ ...devices['Pixel 7'] })

  test('homepage is readable on mobile', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('text=Get paid')).toBeVisible()
    // Nav should not overflow
    const nav = page.locator('nav')
    const navBox = await nav.boundingBox()
    expect(navBox?.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  })

  test('login form is usable on mobile', async ({ page }) => {
    await page.goto('/login')
    const emailInput = page.locator('input[type="email"]')
    const passInput = page.locator('input[type="password"]')
    await expect(emailInput).toBeVisible()
    await expect(passInput).toBeVisible()
    // Inputs should be full width and not clipped
    const box = await emailInput.boundingBox()
    expect(box?.width).toBeGreaterThan(200)
  })

  test('photo upload area is tappable size (min 44px)', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', process.env.TEST_DRIVER_EMAIL || '')
    await page.fill('input[type="password"]', process.env.TEST_DRIVER_PASS || '')
    await page.click('button[type="submit"]')
    await page.waitForURL(/dashboard/)

    const jobCard = page.locator('[data-testid="job-card"]').first()
    if (await jobCard.isVisible()) {
      await jobCard.click()
      const uploadArea = page.locator('text=Tap to take photo or upload').locator('..')
      const box = await uploadArea.boundingBox()
      expect(box?.height).toBeGreaterThanOrEqual(44) // minimum tap target
    }
  })

  test('tab bar buttons are tappable on mobile', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', process.env.TEST_DRIVER_EMAIL || '')
    await page.fill('input[type="password"]', process.env.TEST_DRIVER_PASS || '')
    await page.click('button[type="submit"]')
    await page.waitForURL(/dashboard/)

    const tabs = page.locator('button:has-text("My Loads")')
    const box = await tabs.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
  })

  test('admin panel is readable on mobile', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', process.env.TEST_ADMIN_EMAIL || '')
    await page.fill('input[type="password"]', process.env.TEST_ADMIN_PASS || '')
    await page.click('button[type="submit"]')
    await page.waitForURL(/admin/)
    // Approve/Reject buttons should be visible
    await expect(page.locator('text=DUMPSITE')).toBeVisible()
  })
})

test.describe('Mobile UI — iPhone 14 (Safari)', () => {
  test.use({ ...devices['iPhone 14'] })

  test('date input works on iOS Safari', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', process.env.TEST_DRIVER_EMAIL || '')
    await page.fill('input[type="password"]', process.env.TEST_DRIVER_PASS || '')
    await page.click('button[type="submit"]')
    await page.waitForURL(/dashboard/)

    const jobCard = page.locator('[data-testid="job-card"]').first()
    if (await jobCard.isVisible()) {
      await jobCard.click()
      const dateInput = page.locator('input[type="date"]')
      await expect(dateInput).toBeVisible()
      // iOS date inputs should not be broken
      const isDisabled = await dateInput.isDisabled()
      expect(isDisabled).toBe(false)
    }
  })
})
