import { expect, test, type Page } from '@playwright/test'

// Доставки, phase 2, end to end against STAGING (playwright.config.ts refuses
// production). Needs a test admin and a test seller in staging:
//   E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_SELLER_EMAIL, E2E_SELLER_PASSWORD
// Without them these tests are skipped.
//
// The admin creates a product from the delivery itself, so the run does not
// depend on what staging holds. At the end the delivery is cancelled, which
// takes the received units out of Офис again; the product stays (inactive
// products cannot be created from here), named "E2E доставка …".

const admin = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD }
const seller = { email: process.env.E2E_SELLER_EMAIL, password: process.env.E2E_SELLER_PASSWORD }

async function signIn(page: Page, who: { email?: string; password?: string }) {
  await page.goto('/login')
  await page.getByPlaceholder('Имейл').fill(who.email!)
  await page.getByPlaceholder('Парола').fill(who.password!)
  await page.getByRole('button', { name: 'Вход' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
}

test.describe('Доставки', () => {
  test('a seller cannot reach the deliveries, neither the page nor the API', async ({ page }) => {
    test.skip(!seller.email || !seller.password, 'E2E_SELLER_EMAIL / E2E_SELLER_PASSWORD not set')
    await signIn(page, seller)

    await page.goto('/deliveries')
    await expect(page).not.toHaveURL(/\/deliveries/)

    const res = await page.request.post('/api/deliveries/draft', { data: { draft: { items: [] } } })
    expect(res.status()).toBe(403)
  })

  test('enter a delivery with a new product, save it, receive it into Офис, read the log', async ({ page }) => {
    test.skip(!admin.email || !admin.password, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set')
    test.setTimeout(180_000)
    const name = `E2E доставка ${Date.now()}`

    await signIn(page, admin)
    await page.goto('/deliveries')
    await expect(page.getByRole('heading', { name: 'Доставки' })).toBeVisible()
    await page.getByRole('link', { name: 'Нова доставка' }).click()

    // New product from inside the delivery.
    await page.getByRole('button', { name: 'Нов продукт' }).click()
    await page.getByLabel('Име').fill(name)
    await page.getByLabel('Продажна цена (€)').fill('9,90')
    await page.getByRole('button', { name: 'Създай и добави' }).click()

    const line = page.getByTestId('delivery-line').filter({ hasText: name })
    await expect(line).toBeVisible()
    await line.getByLabel('Бройки на ред 1').fill('10')
    await line.getByLabel('Доставна цена на ред 1').fill('2,50')
    await line.getByLabel(/^План за /).first().fill('4')

    // Autosave turns the draft into a row and moves the URL to it.
    await expect(page.getByText(/Запазено \d/)).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/\/deliveries\/[0-9a-f-]{36}$/)

    await page.getByRole('button', { name: 'Запиши доставката' }).click()
    await page.getByRole('button', { name: 'Запиши', exact: true }).click()

    await expect(page.getByRole('heading', { name: /^Д-\d{6}$/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Очаква се').first()).toBeVisible()

    // Receive: tick the row and sign.
    await page.getByRole('link', { name: 'Получаване' }).click()
    await page.getByLabel(`Получено: ${name}`).check()
    await expect(page.getByText('1 ред, 10 бр.')).toBeVisible()
    await page.getByRole('button', { name: 'Подписвам' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Подписвам' }).click()

    await expect(page.getByText('В работа').first()).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /^Дневник/ }).click()
    await expect(page.getByText(`Получени 10 бр. „${name}“`)).toBeVisible()
    await expect(page.getByText(/Записана като Д-\d{6}, 1 ред/)).toBeVisible()

    // Clean up: cancel takes the 10 units out of Офис again.
    await page.getByRole('button', { name: 'Откажи' }).click()
    await page.getByLabel('Причина за отказа').fill('E2E тест')
    await page.getByRole('button', { name: 'Откажи доставката' }).click()
    await expect(page.getByText('Отказана').first()).toBeVisible({ timeout: 15_000 })
  })
})
