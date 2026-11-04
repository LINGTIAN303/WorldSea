/**
 * The synthetic response must satisfy the Node destination contract that
 * `Readable.pipe()` relies on. A plugin route that pipes a file stream into
 * `res` (wallpaper media, pet assets) previously crashed the Host outright with
 * `dest.removeListener is not a function`: the synthetic response exposed
 * `on`/`off` but no `removeListener`, and Node unbinds its own `close`/`finish`
 * handlers through it once the destination finishes.
 *
 * Exercised through the real carrier on a real pipe, so the assertion covers
 * the wire result of a real `pipe()`, not a hand-called helper.
 */

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { installPipeCarrier, type PipeCarrier } from '../src/pipe-transport.ts'

const KIND_JSON = 0x4a
const KIND_BINARY = 0x42

function encodeJson(value: object): Buffer {
  const payload = Buffer.from(JSON.stringify(value), 'utf8')
  const head = Buffer.alloc(5)
  head.writeUInt32BE(payload.byteLength, 0)
  head.writeUInt8(KIND_JSON, 4)
  return Buffer.concat([head, payload])
}

interface Frame {
  readonly t: string
  readonly chunkLen?: number
  readonly message?: string
}

/** Test-local client: control frames plus the body bytes of each chunk frame. */
class Client {
  private buffer: Buffer = Buffer.alloc(0)
  private readonly frames: Frame[] = []
  private readonly bodies: Buffer[] = []
  private wake: (() => void) | undefined

  constructor(readonly socket: Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.buffer = this.buffer.byteLength === 0 ? chunk : Buffer.concat([this.buffer, chunk])
      while (this.buffer.byteLength >= 5) {
        const length = this.buffer.readUInt32BE(0)
        const kind = this.buffer.readUInt8(4)
        const end = 5 + length
        if (this.buffer.byteLength < end) break
        const payload = Buffer.from(this.buffer.subarray(5, end))
        this.buffer = this.buffer.subarray(end)
        if (kind === KIND_BINARY) { this.bodies.push(payload); continue }
        if (kind !== KIND_JSON) continue
        try { this.frames.push(JSON.parse(payload.toString('utf8')) as Frame) } catch { /* not ours */ }
      }
      const wake = this.wake
      this.wake = undefined
      wake?.()
    })
  }

  async next(): Promise<Frame> {
    for (;;) {
      const frame = this.frames.shift()
      if (frame !== undefined) return frame
      await new Promise<void>((resolve) => { this.wake = resolve })
    }
  }

  /** Read until the response settles, returning the terminal frame and body bytes. */
  async drain(): Promise<{ readonly body: Buffer; readonly terminal: Frame }> {
    let terminal = await this.next()
    while (terminal.t === 'res-head' || terminal.t === 'res-chunk') terminal = await this.next()
    return { body: Buffer.concat(this.bodies), terminal }
  }
}

const temporary: string[] = []
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { force: true, recursive: true })
})

function newPipePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pipe-'))
  temporary.push(dir)
  return process.platform === 'win32' ? `\\\\.\\pipe\\pipe-${randomUUID()}` : join(dir, 'pipe.sock')
}

/** The route shape that crashed: set headers, then pipe a real readable and let `pipe` end it. */
function pipingDispatch(req: unknown, res: unknown): void {
  const request = req as { method?: string }
  const response = res as {
    statusCode: number
    setHeader(name: string, value: string): void
    end(chunk?: string): void
  }
  if (request.method !== 'GET') {
    response.statusCode = 405
    response.end()
    return
  }
  response.statusCode = 200
  response.setHeader('content-type', 'video/mp4')
  // The crash reproduced here: `pipe` binds `finish`/`close` on the destination
  // and unbinds through `removeListener` once the destination ends.
  Readable.from([Buffer.from('media-bytes')]).pipe(res as never)
}

async function start(dispatch: (req: unknown, res: unknown) => void): Promise<{ client: Client; carrier: PipeCarrier }> {
  const path = newPipePath()
  const carrier = await installPipeCarrier({
    path,
    dispatch,
    openStream: () => { throw new Error('gateway opener must not run for a unary request') },
    streamFailure: error => ({ code: 'test', message: String(error), details: {} }),
    log: () => {},
  })
  const socket = connect(path)
  await once(socket, 'connect')
  const client = new Client(socket)
  await client.next() // hello
  return { client, carrier }
}

describe('synthetic response satisfies the pipe destination contract', () => {
  it('completes a request whose route pipes a readable into the response', async () => {
    const { client, carrier } = await start(pipingDispatch)
    try {
      client.socket.write(encodeJson({ t: 'req', id: 1, method: 'GET', url: '/media/one', headers: { accept: '*/*' } }))
      const { body, terminal } = await client.drain()
      // Before the fix this surfaced as a protocol violation (the Host threw);
      // a clean end frame proves `pipe` ran to completion against the response.
      expect(terminal.t).toBe('res-end')
      // Binary body frames carry a u32be flow id ahead of the bytes.
      expect(body.subarray(4).toString('utf8')).toBe('media-bytes')
    } finally {
      await carrier.close()
    }
  })

  it('does not leak the pipe close handler onto later frames', async () => {
    const { client, carrier } = await start(pipingDispatch)
    try {
      client.socket.write(encodeJson({ t: 'req', id: 1, method: 'GET', url: '/media/a', headers: {} }))
      expect((await client.drain()).terminal.t).toBe('res-end')
      client.socket.write(encodeJson({ t: 'req', id: 2, method: 'GET', url: '/media/b', headers: {} }))
      expect((await client.drain()).terminal.t).toBe('res-end')
    } finally {
      await carrier.close()
    }
  })
})
