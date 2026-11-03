/**
 * The IPC pipe carrier over a real pipe: frame wire format, request dispatch
 * through the webserver seam, streaming responses, logical streams with
 * uplink/abort, and the protocol-violation fail-closed path. The client side
 * below is an independent codec implementation on purpose — it validates the
 * wire format instead of mirroring the carrier's own helpers.
 */

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { installPipeCarrier, PIPE_TRANSPORT_VERSION, type PipeCarrier, type PipeCarrierOptions } from '../src/pipe-transport.ts'

const KIND_JSON = 0x4a
const KIND_BINARY = 0x42

interface WireFrame {
  readonly kind: number
  readonly payload: Buffer
}

/** Test-local encoder: `u32be(length) + kind + payload`. */
function encode(kind: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(5)
  head.writeUInt32BE(payload.byteLength, 0)
  head.writeUInt8(kind, 4)
  return Buffer.concat([head, payload])
}

function jsonFrame(frame: object): Buffer {
  return encode(KIND_JSON, Buffer.from(JSON.stringify(frame), 'utf8'))
}

function binaryFrame(id: number, bytes: Buffer): Buffer {
  const payload = Buffer.alloc(4 + bytes.byteLength)
  payload.writeUInt32BE(id, 0)
  bytes.copy(payload, 4)
  return encode(KIND_BINARY, payload)
}

/** Test-local client: frame queue with timeouts, independent of the carrier. */
class PipeClient {
  private buffer: Buffer = Buffer.alloc(0)
  private readonly frames: WireFrame[] = []
  private wake: (() => void) | undefined
  private readonly closeWaiters: Array<() => void> = []
  private isClosed = false

  private constructor(private readonly socket: Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.buffer = this.buffer.byteLength === 0 ? chunk : Buffer.concat([this.buffer, chunk])
      while (this.buffer.byteLength >= 5) {
        const length = this.buffer.readUInt32BE(0)
        const end = 5 + length
        if (this.buffer.byteLength < end) break
        this.frames.push({
          kind: this.buffer.readUInt8(4),
          payload: Buffer.from(this.buffer.subarray(5, end)),
        })
        this.buffer = this.buffer.subarray(end)
      }
      this.wake?.()
      this.wake = undefined
    })
    socket.on('close', () => {
      this.isClosed = true
      this.wake?.()
      this.wake = undefined
      for (const waiter of this.closeWaiters.splice(0)) waiter()
    })
  }

  static async connect(path: string): Promise<PipeClient> {
    const socket = connect(path)
    await once(socket, 'connect')
    return new PipeClient(socket)
  }

  sendJson(frame: object): void {
    this.socket.write(jsonFrame(frame))
  }

  sendBinary(id: number, bytes: Buffer): void {
    this.socket.write(binaryFrame(id, bytes))
  }

  sendRaw(bytes: Buffer): void {
    this.socket.write(bytes)
  }

  /** Await the next frame; fails the test on timeout instead of hanging it. */
  async next(timeoutMs = 3000): Promise<WireFrame> {
    const deadline = Date.now() + timeoutMs
    while (this.frames.length === 0) {
      if (this.isClosed) throw new Error('pipe client: connection closed before a frame arrived')
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error('pipe client: timed out waiting for a frame')
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('pipe client: timed out waiting for a frame')) }, remaining)
        this.wake = () => { clearTimeout(timer); resolve() }
      })
    }
    return this.frames.shift() as WireFrame
  }

  async nextJson(timeoutMs = 3000): Promise<Record<string, unknown>> {
    const frame = await this.next(timeoutMs)
    if (frame.kind !== KIND_JSON) throw new Error(`expected a JSON frame, got kind ${String(frame.kind)}`)
    return JSON.parse(frame.payload.toString('utf8')) as Record<string, unknown>
  }

  /** Await connection close (server-side or own teardown). */
  async closed(timeoutMs = 3000): Promise<void> {
    if (this.isClosed) return
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('pipe client: timed out waiting for close')) }, timeoutMs)
      this.closeWaiters.push(() => { clearTimeout(timer); resolve() })
    })
  }

  close(): void {
    this.socket.destroy()
  }
}

/** The harness: one carrier over a real pipe plus its carrier-side fakes. */
const carriers: PipeCarrier[] = []
const clients: PipeClient[] = []
const directories: string[] = []

afterEach(async () => {
  for (const client of clients.splice(0)) client.close()
  for (const carrier of carriers.splice(0)) await carrier.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function pipePath(): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\dsh-pipe-test-${randomUUID()}`
  const directory = mkdtempSync(join(tmpdir(), 'dsh-pipe-test-'))
  directories.push(directory)
  return join(directory, 'carrier.sock')
}

interface StreamCall {
  readonly endpoint: string
  readonly payload: unknown
  readonly uplink: AsyncIterable<unknown>
  readonly signal: AbortSignal
}

interface Harness {
  readonly path: string
  readonly streams: StreamCall[]
  readonly requests: Array<{ method: string; url: string; body: string }>
}

/** Start one carrier whose dispatch and stream opener are observable fakes. */
async function startHarness(routePrefixes?: () => readonly string[]): Promise<Harness> {
  const path = pipePath()
  const streams: StreamCall[] = []
  const requests: Array<{ method: string; url: string; body: string }> = []
  const dispatch = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = Buffer.concat(chunks).toString('utf8')
    const url = req.url ?? '/'
    requests.push({ method: req.method ?? 'GET', url, body })
    switch (url.split('?')[0]) {
      case '/echo': {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(`echo:${req.method ?? 'GET'}:${url}:${body}`)
        return
      }
      case '/streamed': {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.write('a')
        res.write('b')
        res.end('c')
        return
      }
      case '/destroy': {
        res.destroy()
        return
      }
      case '/boom': {
        throw new Error('handler exploded')
      }
      default: {
        res.statusCode = 404
        res.end()
      }
    }
  }
  const options: PipeCarrierOptions = {
    path,
    // Mirrors the composing application: the webserver's serve() contains a
    // throwing handler as an answer, so the carrier never sees a rejection.
    dispatch: (req, res) => {
      void dispatch(req, res).catch(() => {
        res.writeHead(400)
        res.end()
      })
    },
    openStream: async (endpoint, payload, uplink, signal) => {
      streams.push({ endpoint, payload, uplink, signal })
      if (endpoint === 'fail') throw new Error('stream exploded')
      if (endpoint === 'uplink-echo') {
        // Consumes the uplink first, then reports what the shell sent.
        return (async function* gen() {
          const received: unknown[] = []
          for await (const item of uplink) received.push(item)
          yield { received }
        })()
      }
      if (endpoint === 'never') {
        return (async function* gen() {
          await new Promise<void>((resolve) => {
            if (signal.aborted) { resolve(); return }
            signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
        })()
      }
      return (async function* gen() {
        for (const item of (payload as { items: unknown[] }).items) yield item
      })()
    },
    streamFailure: error => ({ code: 'gateway/protocol', message: String(error), details: {} }),
    ...(routePrefixes === undefined ? {} : { routePrefixes }),
    log: () => {},
  }
  const carrier = await installPipeCarrier(options)
  carriers.push(carrier)
  return { path, streams, requests }
}

async function connectClient(path: string): Promise<PipeClient> {
  const client = await PipeClient.connect(path)
  clients.push(client)
  return client
}

describe('pipe transport: framing and unary requests', () => {
  it('greets with the hello frame and answers a bodyless GET', async () => {
    const harness = await startHarness()
    const client = await connectClient(harness.path)
    const hello = await client.nextJson()
    // No routePrefixes reader supplied: the member is absent, not an empty list.
    expect(hello).toEqual({ t: 'hello', version: PIPE_TRANSPORT_VERSION, carrier: 'worldsea-pipe' })

    client.sendJson({ t: 'req', id: 7, method: 'GET', url: '/echo?x=1', headers: { host: '127.0.0.1' } })
    const head = await client.nextJson()
    expect(head['t']).toBe('res')
    expect(head['id']).toBe(7)
    expect(head['status']).toBe(200)
    expect(head['bodyLen']).toBe(Buffer.byteLength('echo:GET:/echo?x=1:'))
    const body = await client.next()
    expect(body.kind).toBe(KIND_BINARY)
    expect(body.payload.readUInt32BE(0)).toBe(7)
    expect(body.payload.subarray(4).toString('utf8')).toBe('echo:GET:/echo?x=1:')
  })

  it('carries the live prefix routes in the greeting, re-read per connection', async () => {
    // Stands in for the shell's path gate: it gates on what the host answers,
    // so a route a plugin registers while the server runs must appear on the
    // next connection without restarting the carrier.
    let table = ['/api']
    const harness = await startHarness(() => table)
    const first = await connectClient(harness.path)
    expect((await first.nextJson())['routePrefixes']).toEqual(['/api'])
    first.close()

    table = ['/api', '/some-plugin/api']
    const second = await connectClient(harness.path)
    expect((await second.nextJson())['routePrefixes']).toEqual(['/api', '/some-plugin/api'])
  })

  it('carries a request body in the declared binary frame', async () => {
    const harness = await startHarness()
    const client = await connectClient(harness.path)
    await client.nextJson()
    const payload = Buffer.from('{"hello":"世界"}', 'utf8')
    client.sendJson({ t: 'req', id: 8, method: 'POST', url: '/echo', headers: { host: '127.0.0.1' }, bodyLen: payload.byteLength })
    client.sendBinary(8, payload)
    const head = await client.nextJson()
    expect(head['status']).toBe(200)
    const body = await client.next()
    expect(body.payload.subarray(4).toString('utf8')).toBe('echo:POST:/echo:{"hello":"世界"}')
    expect(harness.requests[0]).toEqual({ method: 'POST', url: '/echo', body: '{"hello":"世界"}' })
  })

  it('streams a written response as head, chunk pairs, and end', async () => {
    const harness = await startHarness()
    const client = await connectClient(harness.path)
    await client.nextJson()
    client.sendJson({ t: 'req', id: 9, method: 'GET', url: '/streamed', headers: {} })
    expect(await client.nextJson()).toMatchObject({ t: 'res-head', id: 9, status: 200 })
    for (const expected of ['a', 'b', 'c']) {
      expect(await client.nextJson()).toEqual({ t: 'res-chunk', id: 9, chunkLen: 1 })
      const chunk = await client.next()
      expect(chunk.kind).toBe(KIND_BINARY)
      expect(chunk.payload.readUInt32BE(0)).toBe(9)
      expect(chunk.payload.subarray(4).toString('utf8')).toBe(expected)
    }
    expect(await client.nextJson()).toEqual({ t: 'res-end', id: 9 })
  })

  it('reports a destroyed response and a throwing handler through the carrier', async () => {
    const harness = await startHarness()
    const client = await connectClient(harness.path)
    await client.nextJson()
    client.sendJson({ t: 'req', id: 10, method: 'GET', url: '/destroy', headers: {} })
    expect((await client.nextJson())['t']).toBe('res-err')
    client.sendJson({ t: 'req', id: 11, method: 'GET', url: '/boom', headers: {} })
    // The webserver's error containment answers 400 for a throwing handler.
    expect(await client.nextJson()).toMatchObject({ t: 'res', id: 11, status: 400 })
  })
})

describe('pipe transport: logical streams', () => {
  it('carries downlink items, the uplink, and the normal end', async () => {
    const harness = await startHarness()
    const client = await connectClient(harness.path)
    await client.nextJson()
    client.sendJson({ t: 'stream-open', id: 20, endpoint: 'echo', payload: { items: [1, 'two', { three: 3 }] } })
    expect(await client.nextJson()).toEqual({ t: 'stream-item', id: 20, value: 1 })
    expect(await client.nextJson()).toEqual({ t: 'stream-item', id: 20, value: 'two' })
    expect(await client.nextJson()).toEqual({ t: 'stream-item', id: 20, value: { three: 3 } })
    expect(await client.nextJson()).toEqual({ t: 'stream-end', id: 20 })

    // The uplink is the shell's channel into the Host method: items and the
    // half-close cross while the stream is still open, and the opener reports
    // exactly what it read.
    client.sendJson({ t: 'stream-open', id: 21, endpoint: 'uplink-echo', payload: {} })
    client.sendJson({ t: 'stream-uplink-item', id: 21, value: 'up-1' })
    client.sendJson({ t: 'stream-uplink-item', id: 21 })
    client.sendJson({ t: 'stream-uplink-end', id: 21 })
    expect(await client.nextJson()).toEqual({ t: 'stream-item', id: 21, value: { received: ['up-1', null] } })
    expect(await client.nextJson()).toEqual({ t: 'stream-end', id: 21 })
  })

  it('turns an opener failure into a stream-error frame with the mapped fields', async () => {
    const harness = await startHarness()
    const client = await connectClient(harness.path)
    await client.nextJson()
    client.sendJson({ t: 'stream-open', id: 21, endpoint: 'fail', payload: {} })
    expect(await client.nextJson()).toEqual({
      t: 'stream-error',
      id: 21,
      failure: { kind: 'remote', code: 'gateway/protocol', message: 'Error: stream exploded', details: {} },
    })
  })

  it('aborts the opener\u2019s signal when the shell aborts the stream', async () => {
    const harness = await startHarness()
    const client = await connectClient(harness.path)
    await client.nextJson()
    client.sendJson({ t: 'stream-open', id: 22, endpoint: 'never', payload: {} })
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    client.sendJson({ t: 'abort', id: 22 })
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    expect((harness.streams[0] as StreamCall).signal.aborted).toBe(true)
  })
})

describe('pipe transport: fail-closed protocol handling', () => {
  it('closes the connection on a non-JSON control frame', async () => {
    const harness = await startHarness()
    const client = await connectClient(harness.path)
    await client.nextJson()
    client.sendRaw(encode(KIND_JSON, Buffer.from('not json', 'utf8')))
    await client.closed()
  })

  it('closes the connection on a body frame without its declaring control frame', async () => {
    const harness = await startHarness()
    const client = await connectClient(harness.path)
    await client.nextJson()
    client.sendBinary(3, Buffer.from('stray'))
    await client.closed()
  })

  it('closes the connection when a declared body mismatches its frame', async () => {
    const harness = await startHarness()
    const client = await connectClient(harness.path)
    await client.nextJson()
    client.sendJson({ t: 'req', id: 4, method: 'POST', url: '/echo', headers: {}, bodyLen: 99 })
    client.sendBinary(4, Buffer.from('short'))
    await client.closed()
  })

  it('closes the connection on an unknown control type', async () => {
    const harness = await startHarness()
    const client = await connectClient(harness.path)
    await client.nextJson()
    client.sendJson({ t: 'who-knows', id: 1 })
    await client.closed()
  })
})
