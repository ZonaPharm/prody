import { expect, test, type Page } from '@playwright/test'

// Доставки, phase 3, the whole path end to end against STAGING
// (playwright.config.ts refuses production). Four roles, played by two test
// accounts: the admin enters, receives, labels, packs and signs as the driver
// (with their own password); the seller ticks the shipment in the store.
//   E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_SELLER_EMAIL, E2E_SELLER_PASSWORD
// Without them the test is skipped.
//
// What stays in staging afterwards: a product "E2E курс …" with its units in
// the stores (shipped stock cannot be cancelled, only corrected), and the
// trip in the log. Other ready stock that staging already had for these stores
// rides along on the same trip, as it would in real life.

const admin = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD }
const seller = { email: process.env.E2E_SELLER_EMAIL, password: process.env.E2E_SELLER_PASSWORD }

async function signIn(page: Page, who: { email?: string; password?: string }) {
  await page.goto('/login')
  await page.getByPlaceholder('Имейл').fill(who.email!)
  await page.getByPlaceholder('Парола').fill(who.password!)
  await page.getByRole('button', { name: 'Вход' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
}

async function signOut(page: Page) {
  await page.context().clearCookies()
}

/** Tick every row of the checklist on screen, one by one (there is no "tick all"). */
async function tickAll(page: Page, rowTestId: string) {
  const boxes = page.getByTestId(rowTestId).locator('input[type="checkbox"]')
  const n = await boxes.count()
  for (let i = 0; i < n; i++) await boxes.nth(i).check()
}

async function sign(page: Page) {
  await page.getByRole('button', { name: 'Подписвам' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Подписвам' }).click()
}

test.describe('Доставки, фаза 3', () => {
  test('a seller cannot reach labelling, trips or problems, neither the pages nor the API', async ({ page }) => {
    test.skip(!seller.email || !seller.password, 'E2E_SELLER_EMAIL / E2E_SELLER_PASSWORD not set')
    await signIn(page, seller)
    for (const path of ['/deliveries/labels', '/deliveries/trips', '/deliveries/problems']) {
      await page.goto(path)
      await expect(page).not.toHaveURL(new RegExp(path))
    }
    expect((await page.request.post('/api/deliveries/ready', { data: { rows: [] } })).status()).toBe(403)
    expect((await page.request.post('/api/deliveries/trips', { data: { store_ids: [] } })).status()).toBe(403)
    await page.goto('/my-shipments')
    await expect(page.getByRole('heading', { name: 'Пратки' })).toBeVisible()
  })

  test('delivery -> label -> trip -> pack -> driver -> store checklist', async ({ page }) => {
    test.skip(!admin.email || !admin.password || !seller.email || !seller.password, 'E2E accounts not set')
    test.setTimeout(300_000)
    const name = `E2E курс ${Date.now()}`

    // 1. Enter a delivery of 40 with a new product, spread equally over the stores.
    await signIn(page, admin)
    await page.goto('/deliveries/new')
    await page.getByRole('button', { name: 'Нов продукт' }).click()
    await page.getByLabel('Име').fill(name)
    await page.getByLabel('Продажна цена (€)').fill('4,90')
    await page.getByRole('button', { name: 'Създай и добави' }).click()
    const line = page.getByTestId('delivery-line').filter({ hasText: name })
    await line.getByLabel('Бройки на ред 1').fill('40')
    await line.getByLabel('Доставна цена на ред 1').fill('1,20')
    await line.getByRole('button', { name: 'Равно по всички' }).click()
    await expect(page.getByText(/Запазено \d/)).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Запиши доставката' }).click()
    await page.getByRole('button', { name: 'Запиши', exact: true }).click()
    await expect(page.getByRole('heading', { name: /^Д-\d{6}$/ })).toBeVisible({ timeout: 15_000 })

    // 2. Receive all 40 into Офис.
    await page.getByRole('link', { name: 'Получаване' }).click()
    await page.getByLabel(`Получено: ${name}`).check()
    await sign(page)
    await expect(page.getByText('В работа').first()).toBeVisible({ timeout: 15_000 })

    // 3. Label: tick every store row of this product.
    await page.goto('/deliveries/labels')
    await page.getByPlaceholder('Търсене на продукт').fill(name)
    await tickAll(page, 'label-row')
    await sign(page)
    await expect(page.getByText(/Готови \d+ бр\./)).toBeVisible({ timeout: 15_000 })

    // 4. A trip to every store with something ready.
    await page.goto('/deliveries/trips')
    const storeBoxes = page.locator('section').filter({ hasText: 'Нов курс' }).locator('input[type="checkbox"]')
    for (let i = 0; i < (await storeBoxes.count()); i++) await storeBoxes.nth(i).check()
    await page.getByRole('button', { name: /^Направи курс/ }).click()
    await expect(page.getByRole('heading', { name: /^Курс К-\d{6}$/ })).toBeVisible({ timeout: 15_000 })
    const tripUrl = page.url()

    // 5. Pack every shipment: tick each line, one box, sign.
    let userName = ''
    while (await page.getByRole('link', { name: 'Опаковай' }).count()) {
      await page.getByRole('link', { name: 'Опаковай' }).first().click()
      await expect(page.getByRole('heading', { name: /^Опаковане/ })).toBeVisible()
      userName ||= ((await page.locator('.fixed.bottom-0 .font-medium').first().textContent()) ?? '').split(' · ')[0]
      await tickAll(page, 'shipment-row')
      await page.getByLabel('Брой кашони').fill('1')
      await sign(page)
      await page.waitForURL(tripUrl, { timeout: 15_000 })
    }

    // 6. The driver (here the admin account) signs with their own password; the trip leaves.
    await page.getByRole('button', { name: 'Шофьорът подписва' }).click()
    await page.getByLabel('Шофьор').selectOption({ label: userName })
    await page.getByLabel('Парола на шофьора').fill(admin.password!)
    await page.getByRole('button', { name: 'Подписвам и тръгвам' }).click()
    await expect(page.getByText('Тръгнал').first()).toBeVisible({ timeout: 20_000 })

    // 7. The seller ticks their shipment.
    await signOut(page)
    await signIn(page, seller)
    await page.goto('/my-shipments')
    await page.getByTestId('waiting-shipment').first().click()
    await expect(page.getByText(name)).toBeVisible()
    await tickAll(page, 'shipment-row')
    await sign(page)
    await page.waitForURL(/\/my-shipments$/, { timeout: 15_000 })

    // 8. Back as admin: the shipment of the seller's store reads "Приета".
    await signOut(page)
    await signIn(page, admin)
    await page.goto(tripUrl)
    await expect(page.getByText('Приета').first()).toBeVisible()
  })
})
