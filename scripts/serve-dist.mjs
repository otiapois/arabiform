import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const port = Number(process.argv[2] ?? 4173)
const [pattern, ...headerLines] = (await readFile(join(dist, '_headers'), 'utf8')).trim().split(/\r?\n/)
if (pattern !== '/*') throw new Error('The first _headers rule must apply to every route')

const headers = Object.fromEntries(headerLines.map((line) => {
  const colon = line.indexOf(':')
  return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()]
}))

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, headers).end()
    return
  }

  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
    const target = resolve(dist, `.${pathname}`)
    const localPath = relative(dist, target)
    if (localPath.startsWith('..') || isAbsolute(localPath) || localPath === '_headers') {
      response.writeHead(404, headers).end()
      return
    }

    const file = (await stat(target)).isDirectory() ? join(target, 'index.html') : target
    const bytes = await readFile(file)
    response.writeHead(200, {
      ...headers,
      'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
      'Content-Length': bytes.length,
    }).end(request.method === 'HEAD' ? undefined : bytes)
  } catch (error) {
    const status = error instanceof URIError ? 400
      : error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500
    response.writeHead(status, headers).end()
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`ArabiForm preview: http://127.0.0.1:${port}`)
})
