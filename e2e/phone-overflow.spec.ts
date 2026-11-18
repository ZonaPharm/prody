import { expect, test, type Page } from '@playwright/test'

// Nothing in the app may scroll sideways on a phone (Владимир, 2026-11-17:
// "излиза много настрани и има странично скролиране").
//
// Every screen is opened at 320, 360 and 390 px wide. Two things fail it:
//   1. the page itself is wider than the screen (the whole page slides sideways);
//   2. a box inside it scrolls sideways (a table or a row that is too wide).
// Strips of pills or tabs that are meant to slide sideways carry the class
// `no-scrollbar` and are allowed.
//
// Runs against STAGING (playwright.config.ts refuses production) and needs
//   E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_SELLER_EMAIL, E2E_SELLER_PASSWORD.
// Without them these tests are skipped. They only read; nothing is changed.

const admin = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD }
const seller = { email: process.env.E2E_SELLER_EMAIL, password: process.env.E2E_SELLER_PASSWORD }

const WIDTHS = [320, 360, 390]

const ADMIN_PAGES = [
  '/dashboard', '/catalog', '/catalog/new', '/inventory', '/sales', '/reports', '/requests', '/tasks', '/labels',
  '/settings', '/settings?tab=users', '/settings?tab=stores', '/settings?tab=email',
  '/deliveries', '/deliveries/new', '/deliveries/labels', '/deliveries/low-stock', '/deliveries/orders',
  '/deliveries/problems', '/deliveries/trips', '/deliveries/work',
]
const SELLER_PAGES = [
  '/record-sale', '/my-sales', '/my-requests', '/my-requests?tab=low', '/my-shipments', '/my-tasks', '/seller-catalog',
]
// One page of each kind behind a list: the first link the list shows.
const DETAIL_LINKS: Array<[list: string, link: RegExp]> = [
  ['/catalog', /^\/catalog\/[0-9a-f-]{36}$/],
  ['/deliveries', /^\/deliveries\/[0-9a-f-]{36}$/],
  ['/deliveries/trips', /^\/deliveries\/trips\/[0-9a-f-]{36}$/],
]

async function signIn(page: Page, who: { email?: string; password?: string }) {
  await page.goto('/login')
  await page.getByPlaceholder('Имейл').fill(who.email!)
  await page.getByPlaceholder('Парола').fill(who.password!)
  await page.getByRole('button', { name: 'Вход' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
}

type Overflow = { pageWider: number; boxes: string[] }

/** How far the page reaches past the right edge, and which boxes scroll sideways. */
async function sidewaysScroll(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const root = document.documentElement
    const boxes: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (!/(auto|scroll)/.test(getComputedStyle(el).overflowX)) continue
      if (el.scrollWidth <= el.clientWidth + 1 || el.getBoundingClientRect().width === 0) continue
      if (el.closest('.no-scrollbar')) continue
      boxes.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)} „${(el.innerText || '').slice(0, 40)}“`)
    }
    return { pageWider: Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth, boxes }
  })
}

async function checkAllWidths(page: Page, path: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 780 })
    await page.goto(path, { waitUntil: 'networkidle' })
    const found = await sidewaysScroll(page)
    expect.soft(found.pageWider, `${path} at ${width}px: the page is wider than the screen`).toBeLessThanOrEqual(0)
    expect.soft(found.boxes, `${path} at ${width}px: a box scrolls sideways`).toEqual([])
  }
}

test.describe('no sideways scrolling on a phone', () => {
  test.use({ isMobile: true, hasTouch: true })

  test('admin screens', async ({ page }) => {
    test.skip(!admin.email || !admin.password, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set')
    test.setTimeout(600_000)
    await signIn(page, admin)

    const paths = [...ADMIN_PAGES]
    for (const [list, link] of DETAIL_LINKS) {
      await page.goto(list, { waitUntil: 'networkidle' })
      const hrefs = await page.$$eval('a[href]', as => as.map(a => a.getAttribute('href') ?? ''))
      const first = hrefs.find(h => link.test(h))
      if (first) paths.push(first)
    }
    for (const path of paths) await checkAllWidths(page, path)
  })

  test('seller screens', async ({ page }) => {
    test.skip(!seller.email || !seller.password, 'E2E_SELLER_EMAIL / E2E_SELLER_PASSWORD not set')
    test.setTimeout(300_000)
    await signIn(page, seller)

    const paths = [...SELLER_PAGES]
    await page.goto('/my-shipments', { waitUntil: 'networkidle' })
    const first = (await page.$$eval('a[href]', as => as.map(a => a.getAttribute('href') ?? '')))
      .find(h => /^\/my-shipments\/[0-9a-f-]{36}$/.test(h))
    if (first) paths.push(first)
    for (const path of paths) await checkAllWidths(page, path)
  })
})
