import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import dns from 'node:dns'
import http from 'node:http'
import zlib from 'node:zlib'
import type { AddressInfo } from 'node:net'
import { WebError, checkUrl, decodeEntities, fetchImage, fetchPage, isPublicAddress, pageText, readPage, safeFetch } from './web'

describe('isPublicAddress', () => {
  it('public addresses pass', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '151.101.1.69', '2a00:1450:4001:80b::200e']) expect(isPublicAddress(ip), ip).toBe(true)
  })
  it('private, local and special addresses are refused', () => {
    for (const ip of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
      '224.0.0.1', '255.255.255.255', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
      '::ffff:169.254.169.254', '64:ff9b::a00:1', 'not-an-ip',
    ]) expect(isPublicAddress(ip), ip).toBe(false)
  })
})

describe('checkUrl', () => {
  it('a normal https link is fine', () => {
    expect(checkUrl('https://www.zonapharm.com/product/abc?x=1').hostname).toBe('www.zonapharm.com')
  })
  it('refuses other schemes, passwords, odd ports and inside addresses', () => {
    for (const bad of [
      'file:///etc/passwd', 'ftp://example.com/a', 'javascript:alert(1)', 'https://user:pw@example.com/',
      'https://example.com:8080/', 'http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.5/', 'http://intranet/', 'http://printer.local/', 'не е линк',
    ]) expect(() => checkUrl(bad), bad).toThrow(WebError)
  })
})

describe('readPage', () => {
  const html = `<!doctype html><html><head>
    <title>Магнезий B6 &amp; витамини | Аптека</title>
    <meta property="og:description" content="Хранителна добавка с магнезий.">
    <meta property="og:image" content="/img/mg-large.jpg">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"Product","name":"Магнезий B6","description":"<p>60 таблетки</p>","brand":{"name":"Valentis"},"gtin13":"3800123456789","image":["https://cdn.example.com/mg.jpg"],"offers":{"@type":"Offer","price":"12.90","priceCurrency":"EUR"}}]}</script>
    <script>var secret = "ignore";</script><style>.x{}</style>
    </head><body><nav>Меню</nav><h1>Магнезий B6</h1><p>Прием: по 1 таблетка.</p>
    <img src="/logo.svg"><img src="https://cdn.example.com/mg-2.jpg"><footer>Футър</footer></body></html>`
  const page = readPage(html, 'https://shop.example.com/p/mg')

  it('reads the product block, title and description', () => {
    expect(page.title).toBe('Магнезий B6 & витамини | Аптека')
    expect(page.description).toBe('Хранителна добавка с магнезий.')
    expect(page.product).toMatchObject({ name: 'Магнезий B6', description: '60 таблетки', brand: 'Valentis', gtin: '3800123456789', price: '12.90', currency: 'EUR' })
  })
  it('lists the pictures as full links, without logos', () => {
    expect(page.images).toEqual(['https://cdn.example.com/mg.jpg', 'https://shop.example.com/img/mg-large.jpg', 'https://cdn.example.com/mg-2.jpg'])
  })
  it('keeps the readable text, not scripts, menus or footers', () => {
    expect(page.text).toContain('Прием: по 1 таблетка.')
    expect(page.text).not.toContain('secret')
    expect(page.text).not.toContain('Меню')
    expect(page.text).not.toContain('Футър')
  })
  it('decodes entities and old Bulgarian charsets', () => {
    expect(decodeEntities('&#1052;&#x430;&quot;')).toBe('Ма"')
    const cp1251 = Buffer.from([0xcc, 0xe0, 0xe3]) // "Маг"
    expect(pageText(cp1251, 'text/html; charset=windows-1251')).toBe('Маг')
  })
})

describe('safeFetch', () => {
  let server: http.Server
  let base = ''
  // The test server is on 127.0.0.1; everything else inside stays refused.
  const testing = { allowAddress: (ip: string) => ip === '127.0.0.1' || isPublicAddress(ip), anyPort: true }
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/page') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip' })
        return res.end(zlib.gzipSync('<title>Тест</title><p>Здравей</p>'))
      }
      if (req.url === '/hop') { res.writeHead(302, { Location: '/page' }); return res.end() }
      if (req.url === '/inside') { res.writeHead(302, { Location: 'http://169.254.169.254/latest' }); return res.end() }
      if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); return res.end() }
      if (req.url === '/big') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('x'.repeat(5000)) }
      if (req.url === '/pic') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(Buffer.from([1, 2, 3])) }
      if (req.url === '/slow') return setTimeout(() => res.end('late'), 2000)
      res.writeHead(404); res.end()
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => { server.close() })
  afterEach(() => vi.restoreAllMocks())

  it('reads a page (gzip) and follows a redirect', async () => {
    const page = await fetchPage(`${base}/hop`, { testing })
    expect(page.title).toBe('Тест')
    expect(page.text).toContain('Здравей')
    expect(page.url).toBe(`${base}/page`)
  })
  it('a redirect to an inside address is refused', async () => {
    await expect(safeFetch(`${base}/inside`, { testing })).rejects.toThrow('вътрешен адрес')
  })
  it('endless redirects, too big, too slow and missing pages are refused', async () => {
    await expect(safeFetch(`${base}/loop`, { testing })).rejects.toThrow('пренасочва')
    await expect(safeFetch(`${base}/big`, { testing, maxBytes: 1000 })).rejects.toThrow('твърде голяма')
    await expect(safeFetch(`${base}/slow`, { testing, timeoutMs: 200 })).rejects.toThrow('навреме')
    await expect(safeFetch(`${base}/nope`, { testing })).rejects.toThrow('404')
  })
  it('a picture link gives the bytes; a page is not a picture', async () => {
    expect([...await fetchImage(`${base}/pic`, { testing })]).toEqual([1, 2, 3])
    await expect(fetchImage(`${base}/big`, { testing })).rejects.toThrow('не е към снимка')
  })
  it('a public-looking name that resolves inside is refused at connect time', async () => {
    vi.spyOn(dns, 'lookup').mockImplementation(((_h: string, _o: any, cb: any) => cb(null, [{ address: '127.0.0.1', family: 4 }])) as any)
    const port = (server.address() as AddressInfo).port
    await expect(safeFetch(`http://shop.example.com:${port}/page`, { testing: { allowAddress: isPublicAddress, anyPort: true } }))
      .rejects.toThrow('вътрешен адрес')
  })
})
