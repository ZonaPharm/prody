import { expect, test } from '@playwright/test'

// Checks that need no account: what an anonymous visitor can and cannot reach.

test('the login page shows the sign-in form', async ({ page }) => {
  await page.goto('/login')

  await expect(page.getByPlaceholder('Имейл')).toBeVisible()
  await expect(page.getByPlaceholder('Парола')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Вход' })).toBeVisible()
})

for (const path of ['/dashboard', '/record-sale', '/settings', '/sales']) {
  test(`an anonymous visitor to ${path} is sent to the login page`, async ({ page }) => {
    await page.goto(path)

    await expect(page).toHaveURL(/\/login$/)
  })
}

// The backup stayed dead for 117 nights because this route never got past
// authentication. It has to be reachable without a session (Vercel's cron
// caller has none) yet refuse anyone without the secret.
test('the backup job turns away a request without the secret', async ({ request }) => {
  const res = await request.get('/api/cron/backup', { maxRedirects: 0 })

  expect(res.status()).toBe(401)
})
