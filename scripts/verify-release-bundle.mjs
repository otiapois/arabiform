import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const project = fileURLToPath(new URL('../', import.meta.url))
const dist = join(project, 'dist')
const localHost = 'arabiform.example'
const arabicRoute = '/ar/pdf-mail-merge'
const routes = ['/', '/arabic-pdf-form-filler', arabicRoute, '/preserve-leading-zeros-pdf', '/privacy-and-proof']
const fontLicenses = ['public/fonts/NotoNaskhArabic-OFL.txt', 'public/fonts/NotoSans-OFL.txt']

function requireCheck(condition, message) {
  if (!condition) throw new Error(message)
}

// Read start tags in the HTML emitted by prerender, including quoted attribute values.
function tags(html, name) {
  const pattern = new RegExp("<" + name + "(?=\\s|/?>)(?:[^>\"']|\"[^\"]*\"|'[^']*')*>", 'gi')
  return [...html.matchAll(pattern)].map(([tag]) => new Map(
    [...tag.matchAll(/\s+([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g)]
      .map(([, key, double, single, bare]) => [key.toLowerCase(), double ?? single ?? bare ?? '']),
  ))
}

function checkRoute(html, route, site, titles, descriptions) {
  const title = [...html.matchAll(/<title>\s*([^<]+?)\s*<\/title>/gi)].map(([, value]) => value.trim())
  const description = tags(html, 'meta').filter(tag => tag.get('name')?.toLowerCase() === 'description')
    .map(tag => tag.get('content')?.trim())
  const canonical = tags(html, 'link').filter(tag => tag.get('rel')?.toLowerCase() === 'canonical')
  requireCheck(title.length === 1 && title[0] && !titles.has(title[0]), route + ' needs a unique title')
  requireCheck(description.length === 1 && description[0] && !descriptions.has(description[0]), route + ' needs a unique description')
  requireCheck(canonical.length === 1 && canonical[0].get('href') === site.origin + route, route + ' has an unexpected canonical')
  titles.add(title[0])
  descriptions.add(description[0])
  requireCheck(!tags(html, 'form').some(tag => tag.has('name')), route + ' contains a named form')
  if (route === arabicRoute) {
    const [document] = tags(html, 'html')
    requireCheck(document?.get('lang') === 'ar' && document.get('dir') === 'rtl', route + ' requires lang="ar" and dir="rtl"')
  }
  const schemas = [...html.matchAll(/(<script\b[^>]*>)\s*([\s\S]*?)<\/script>/gi)]
    .filter(([, tag]) => tags(tag, 'script')[0]?.get('type') === 'application/ld+json')
    .map(([, , json]) => {
      try {
        return JSON.parse(json)
      } catch {
        throw new Error(route + ' contains invalid JSON-LD')
      }
    })
  const faq = schemas.filter(schema => schema?.['@type'] === 'FAQPage')
  const application = schemas.filter(schema => schema?.['@type'] === 'SoftwareApplication')
  requireCheck(faq.length === 1 && Array.isArray(faq[0].mainEntity) && faq[0].mainEntity.length > 0,
    route + ' needs one FAQPage with questions')
  requireCheck(application.length === 1 && application[0].name && application[0].url === site.href,
    route + ' needs one SoftwareApplication with the configured origin')
  requireCheck([...faq, ...application].every(schema => schema['@context'] === 'https://schema.org'),
    route + ' has an unexpected JSON-LD context')
}

function entrySize(html, route) {
  const assets = new Set([
    ...tags(html, 'script').filter(tag => tag.get('type') === 'module').map(tag => tag.get('src')),
    ...tags(html, 'link').filter(tag => tag.get('rel') === 'modulepreload').map(tag => tag.get('href')),
  ])
  requireCheck(assets.size > 0, route + ' needs a local entry script')
  let raw = 0
  let gzip = 0
  for (const asset of assets) {
    requireCheck(asset && /^\/assets\/[\w.-]+\.m?js$/.test(asset), route + ' has a non-local entry script')
    const bytes = readFileSync(join(dist, asset.slice(1)))
    raw += bytes.length
    gzip += gzipSync(bytes).length
  }
  return { raw, gzip }
}

function checkHeaders() {
  const [scope, ...rows] = readFileSync(join(dist, '_headers'), 'utf8').trim().split(/\r?\n/)
  requireCheck(scope === '/*', '_headers must include the global route rule')
  const headers = new Map()
  for (const row of rows.filter(line => line.trim())) {
    const match = /^\s+([\w-]+):\s*(.+)$/.exec(row)
    requireCheck(match && !headers.has(match[1].toLowerCase()), '_headers contains an invalid or repeated header')
    headers.set(match[1].toLowerCase(), match[2].trim())
  }
  const policy = headers.get('content-security-policy') ?? ''
  const directives = policy.split(';').map(value => value.trim().split(/\s+/)).filter(([key]) => key)
  for (const [name, sources] of [['default-src', "'self'"], ['connect-src', "'none'"], ['worker-src', "'self'"], ['form-action', "'none'"]]) {
    const matches = directives.filter(([key]) => key.toLowerCase() === name)
    requireCheck(matches.length === 1 && matches[0].slice(1).join(' ') === sources, '_headers requires ' + name + ' ' + sources)
  }
  requireCheck(headers.get('x-content-type-options') === 'nosniff', '_headers requires X-Content-Type-Options: nosniff')
  requireCheck(headers.get('referrer-policy') === 'no-referrer', '_headers requires Referrer-Policy: no-referrer')
}

function checkLicensesAndCi() {
  const notices = readFileSync(join(project, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  requireCheck(notices.includes('## Bundled fonts') && notices.includes('## JavaScript and CSS'), 'Third-party notices are incomplete')
  for (const path of ['LICENSE', 'THIRD_PARTY_NOTICES.md', ...fontLicenses]) {
    const bytes = readFileSync(join(project, path))
    requireCheck(readFileSync(join(dist, path)).equals(bytes), 'dist/' + path + ' does not match the source')
    if (path === 'LICENSE') {
      const text = bytes.toString('utf8')
      requireCheck(text.includes('MIT License') && text.includes('Permission is hereby granted') &&
        text.includes('THE SOFTWARE IS PROVIDED "AS IS"'), 'LICENSE is missing MIT terms')
    } else if (fontLicenses.includes(path)) {
      const digest = createHash('sha256').update(bytes).digest('hex')
      requireCheck(/SIL OPEN FONT LICENSE Version 1\.1/.test(bytes.toString('utf8')) &&
        notices.includes('(' + path + ')') && notices.includes(digest), path + ' does not match the OFL notice')
    }
  }
  const workflow = readFileSync(join(project, '.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n')
  requireCheck(/^name: +\S/m.test(workflow) && /^on:/m.test(workflow) && /^jobs:/m.test(workflow) &&
    /^ +runs-on: +\S/m.test(workflow) && /^ +steps:/m.test(workflow) &&
    /^([ ]+)- run: npm run build[ ]*\n\1- run: npm run verify:release[ ]*$/m.test(workflow),
  '.github/workflows/ci.yml needs a build job with verify:release immediately after build')
}

function parseOrigin(value, label) {
  const message = label + ' must be an HTTP(S) origin without credentials, path, query, or fragment'
  requireCheck(!/[\s\x00-\x1f\x7f]/.test(value) && /^https?:\/\/[^/?#@\\]+\/?$/i.test(value) && URL.canParse(value), message)
  const site = new URL(value)
  requireCheck(site.href === site.origin + '/', message)
  return site
}

function verifyRelease() {
  const [flag, origin, ...extra] = process.argv.slice(2)
  const strict = flag === '--strict-origin'
  requireCheck((flag === undefined || strict) && extra.length === 0,
    'Usage: npm run verify:release [-- --strict-origin [ORIGIN]]')
  const envOrigin = process.env.SITE_URL
  requireCheck(!strict || origin !== undefined || envOrigin !== undefined, '--strict-origin requires SITE_URL or an explicit origin')
  const configuredSite = envOrigin === undefined ? undefined : parseOrigin(envOrigin, 'SITE_URL')
  const site = origin === undefined ? configuredSite ?? new URL('https://' + localHost) : parseOrigin(origin, '--strict-origin origin')
  requireCheck(!configuredSite || site.origin === configuredSite.origin, '--strict-origin origin does not match SITE_URL')
  requireCheck(!strict || !site.hostname.includes(localHost), '--strict-origin requires a non-placeholder origin')
  const read = path => {
    const source = readFileSync(join(dist, path), 'utf8')
    requireCheck(!strict || !source.toLowerCase().includes(localHost), 'dist/' + path + ' contains the ' + localHost + ' placeholder')
    return source
  }
  const pages = routes.map(route => (route === '/' ? '' : route.slice(1) + '/') + 'index.html')
  const actual = readdirSync(dist, { recursive: true, encoding: 'utf8' })
    .filter(path => /\.html$/i.test(path)).map(path => path.split(sep).join('/'))
  requireCheck(actual.length === pages.length && pages.every(path => actual.includes(path)),
    'dist must contain exactly the five ArabiForm HTML routes')
  const titles = new Set()
  const descriptions = new Set()
  const sizes = []
  for (const [index, route] of routes.entries()) {
    const html = read(pages[index]).replace(/<!--[\s\S]*?-->/g, '')
    checkRoute(html, route, site, titles, descriptions)
    sizes.push({ route, ...entrySize(html, route) })
  }
  const sitemap = read('sitemap.xml')
  const urls = [...sitemap.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(([, value]) => value)
  requireCheck(/<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/.test(sitemap) &&
    sitemap.includes('</urlset>') && [...sitemap.matchAll(/<url>/g)].length === routes.length &&
    urls.length === routes.length && routes.every(route => urls.includes(site.origin + route)),
  'sitemap.xml must list the five canonical URLs')
  const sitemaps = [...read('robots.txt').matchAll(/^Sitemap:[ \t]*(\S+)[ \t]*\r?$/gim)].map(([, value]) => value)
  requireCheck(sitemaps.length === 1 && sitemaps[0] === site.origin + '/sitemap.xml', 'robots.txt must point to the canonical sitemap')
  checkHeaders()
  checkLicensesAndCi()
  console.log('Verified five routes, sitemap, response headers, notices and CI for ' + site.origin + (strict ? ' (strict origin)' : ''))
  for (const { route, raw, gzip } of sizes) {
    requireCheck(raw < 268_000 && gzip < 83_500, route + ' entry JS exceeds its budget: ' + raw + ' raw / ' + gzip + ' gzip bytes')
  }
  console.log('Largest entry JS: ' + Math.max(...sizes.map(size => size.raw)) + ' raw / ' +
    Math.max(...sizes.map(size => size.gzip)) + ' gzip bytes')
}

try {
  verifyRelease()
} catch (error) {
  console.error('Release verification failed: ' + error.message)
  process.exitCode = 1
}
