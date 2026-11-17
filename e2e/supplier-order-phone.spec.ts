import { expect, test, type Page } from '@playwright/test'

// "Нова поръчка" on a phone: the page must never scroll sideways.
// Runs against STAGING as the admin (E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD);
// skipped without them. It only fills the form in the browser and never
// saves, so it leaves nothing behind in the database.

const admin = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD }

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByPlaceholder('Имейл').fill(admin.email!)
  await page.getByPlaceholder('Парола').fill(admin.password!)
  await page.getByRole('button', { name: 'Вход' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
}

async function expectNoSideScroll(page: Page, where: string) {
  const { page: pw, view } = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    view: document.documentElement.clientWidth,
  }))
  expect(pw, `${where}: страницата е по-широка от екрана`).toBeLessThanOrEqual(view)
}

for (const width of [320, 390]) {
  test(`нова поръчка на телефон ${width}px: без странично скролиране`, async ({ browser }) => {
    test.skip(!admin.email || !admin.password, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set')
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await signIn(page)

    await page.goto('/deliveries/orders/new')
    await expect(page.getByRole('heading', { name: /Нова поръчка|Поръчка/ }).first()).toBeVisible()
    await expectNoSideScroll(page, 'стъпка 1 (доставчик)')

    // Step 2: the first supplier, then up to two of its usual products.
    await page.getByRole('region', { name: 'Доставчик' }).locator('li button').first().click()
    await expect(page.getByTestId('order-step-products')).toBeVisible()
    await expectNoSideScroll(page, 'стъпка 2 (празна)')

    const usual = page.getByRole('button', { name: /^Добави / })
    const n = Math.min(await usual.count(), 2)
    for (let i = 0; i < n; i++) await usual.nth(i).click()
    if (n > 0) {
      await expectNoSideScroll(page, 'стъпка 2 (с продукти)')
      const plan = page.getByRole('button', { name: /^Разпределение на/ })
      if (await plan.count()) {
        await plan.first().click()
        await expectNoSideScroll(page, 'стъпка 2 (отворено разпределение)')
      }
    }
    await ctx.close()
  })
}
