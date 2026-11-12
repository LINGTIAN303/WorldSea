/**
 * External-carrier mode of the webserver: nothing binds, `port` declares the
 * authority, and dispatched synthetic exchanges reach the same route table,
 * fallback seat, and error containment the socket path runs.
 */

import { createServer, type Server } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import HttpServer from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** The declared authority port: one that a probe just proved free. */
async function freePort(): Promise<number> {
  const probe: Server = createServer()
  await new Promise<void>((resolve) => { probe.listen(0, '127.0.0.1', () => { resolve() }) })
  const address = probe.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise<void>((resolve) => { probe.close(() => { resolve() }) })
  return port
}

/** Write one external-carrier composition and boot it through the real Loader. */
async function loadExternal(port: number): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-webserver-external-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    `    port: ${String(port)}`,
    '    external: true',
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

interface Dispatched {
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: string
}

/** Dispatch one synthetic request and collect the answer the handler writes. */
async function dispatched(
  server: { dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> },
  path: string,
): Promise<Dispatched> {
  const req = new Readable({ read() {} }) as unknown as IncomingMessage
  Object.assign(req, { url: path, method: 'GET', headers: { host: '127.0.0.1' } })
  const settled = Promise.withResolvers<Dispatched>()
  let status = 200
  let headers: Record<string, string> = {}
  const chunks: Buffer[] = []
  const res = {
    get headersSent(): boolean { return chunks.length > 0 },
    writeHead: (nextStatus: number, nextHeaders?: Record<string, string>) => {
      status = nextStatus
      if (nextHeaders !== undefined) headers = nextHeaders
    },
    write: (chunk: string | Uint8Array): boolean => { chunks.push(Buffer.from(chunk)); return true },
    end: (chunk?: string | Uint8Array): void => {
      if (chunk !== undefined) chunks.push(Buffer.from(chunk))
      settled.resolve({ status, headers, body: Buffer.concat(chunks).toString('utf8') })
    },
    destroy: (): void => { settled.reject(new Error('response destroyed')) },
    on: () => res,
    once: () => res,
    off: () => res,
  }
  void server.dispatch(req, res as unknown as ServerResponse)
  return await settled.promise
}

describe('webserver: external-carrier mode', () => {
  it('binds nothing and keeps the declared authority port', async () => {
    const declared = await freePort()
    const ctx = await loadExternal(declared)
    const server = ctx.webServer
    expect(server.port).toBe(declared)
    // The declared port is a display/trust authority only — the carrier proves
    // it by binding that same port itself.
    await new Promise<void>((resolve, reject) => {
      const probe = createServer()
      probe.once('error', reject)
      probe.listen(declared, '127.0.0.1', () => { probe.close(() => { resolve() }) })
    })
  })

  it('serves registered routes and the fallback seat through dispatch', async () => {
    const ctx = await loadExternal(await freePort())
    const server = ctx.webServer
    server.register({
      kind: 'exact',
      path: '/hello',
      handler: (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('hi')
      },
    })
    expect(await dispatched(server, '/hello')).toEqual({
      status: 200, headers: { 'content-type': 'text/plain' }, body: 'hi',
    })
    // No fallback seat yet: the unmatched path answers 404, never a hang.
    expect((await dispatched(server, '/missing')).status).toBe(404)
    server.registerFallback((_req, res) => {
      res.writeHead(200)
      res.end('fallback')
    })
    expect((await dispatched(server, '/missing')).body).toBe('fallback')
  })

  it('contains a throwing handler as a 400 answer instead of a process failure', async () => {
    const ctx = await loadExternal(await freePort())
    const server = ctx.webServer
    server.register({
      kind: 'exact',
      path: '/boom',
      handler: () => { throw new Error('handler exploded') },
    })
    expect((await dispatched(server, '/boom')).status).toBe(400)
  })

  it('lists the live prefix table, including routes registered after the read', async () => {
    const ctx = await loadExternal(await freePort())
    const server = ctx.webServer
    expect(server.listPrefixRoutes()).toEqual([])
    const disposePlugin = server.register({
      kind: 'prefix',
      path: '/some-plugin/api',
      handler: (_req, res) => { res.writeHead(200); res.end('ok') },
    })
    const disposeBuiltin = server.register({
      kind: 'prefix',
      path: '/api',
      handler: (_req, res) => { res.writeHead(200); res.end('ok') },
    })
    // Exact routes are a different table: this accessor is the prefix seat only.
    server.register({ kind: 'exact', path: '/exact-only', handler: (_req, res) => { res.writeHead(200); res.end('ok') } })
    expect(server.listPrefixRoutes()).toEqual(['/some-plugin/api', '/api'])
    // Disposal is what a plugin unload does; the reader must observe it.
    disposePlugin()
    expect(server.listPrefixRoutes()).toEqual(['/api'])
    disposeBuiltin()
    expect(server.listPrefixRoutes()).toEqual([])
  })

  it('disposes cleanly while nothing was ever bound', async () => {
    const ctx = await loadExternal(await freePort())
    await ctx.fiber.dispose()
    context = undefined
    expect(true).toBe(true)
  })
})
