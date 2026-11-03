/**
 * The SSE bridge over the pipe carrier: one item per `data:` payload, frame
 * splitting across chunk boundaries, comment/event-line filtering, and the
 * endpoint-prefix routing that keeps Gateway streams and SSE responses apart.
 *
 * Exercised through the real carrier on a real pipe with a test-local client
 * codec, so the assertions cover the wire rather than the carrier's helpers.
 */

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  installPipeCarrier,
  PIPE_TRANSPORT_VERSION,
  readSseResponse,
  type PipeCarrier,
  type PipeCarrierOptions,
} from '../src/pipe-transport.ts'

const KIND_JSON = 0x4a

interface ControlFrame {
  readonly t: string
  readonly value?: unknown
  readonly failure?: unknown
}

function encodeJson(value: object): Buffer {
  const payload = Buffer.from(JSON.stringify(value), 'utf8')
  const head = Buffer.alloc(5)
  head.writeUInt32BE(payload.byteLength, 0)
  head.writeUInt8(KIND_JSON, 4)
  return Buffer.concat([head, payload])
}

/** Test-local frame reader: an independent codec, not the carrier's parser. */
class Reader {
  private buffer: Buffer = Buffer.alloc(0)
  private readonly queue: ControlFrame[] = []
  private wake: (() => void) | undefined
  private closed = false

  constructor(socket: Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.buffer = this.buffer.byteLength === 0 ? chunk : Buffer.concat([this.buffer, chunk])
      while (this.buffer.byteLength >= 5) {
        const length = this.buffer.readUInt32BE(0)
        const end = 5 + length
        if (this.buffer.byteLength < end) break
        const payload = this.buffer.subarray(5, end)
        this.buffer = this.buffer.subarray(end)
        this.queue.push(JSON.parse(payload.toString('utf8')) as ControlFrame)
        this.wake?.()
      }
    })
    socket.on('close', () => { this.closed = true; this.wake?.() })
  }

  async next(timeoutMs = 2000): Promise<ControlFrame> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const frame = this.queue.shift()
      if (frame !== undefined) return frame
      if (this.closed) throw new Error('pipe closed before the expected frame')
      if (Date.now() > deadline) throw new Error('timed out waiting for a frame')
      await new Promise<void>((resolve) => { this.wake = resolve; setTimeout(resolve, 25) })
    }
  }

  /** Read until `stream-end` / `stream-error`; returns the payloads seen before it. */
  async drain(): Promise<{ items: string[]; terminal: ControlFrame }> {
    const items: string[] = []
    for (;;) {
      const frame = await this.next()
      if (frame.t === 'stream-item') { items.push(String(frame.value)); continue }
      if (frame.t === 'stream-end' || frame.t === 'stream-error') return { items, terminal: frame }
    }
  }
}

/** SSE routes these tests assert on. */
function sseDispatch(req: IncomingMessage, res: ServerResponse): void {
  switch (req.url) {
    case '/sse/three':
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: one\n\n')
      // One frame split across two writes: the reader must accumulate.
      res.write('data: tw')
      res.write('o\n\n')
      res.write('data: three\n\n')
      res.end()
      return
    case '/sse/non-data':
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(': keep-alive\n\n')
      res.write('event: rebuilt\nid: 7\n\n')
      res.write('data: payload\n\n')
      res.end()
      return
    default:
      res.writeHead(404)
      res.end()
  }
}

const temporary: string[] = []
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { force: true, recursive: true })
})

function newPipePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sse-'))
  temporary.push(dir)
  return process.platform === 'win32' ? `\\\\.\\pipe\\sse-${randomUUID()}` : join(dir, 'sse.sock')
}

interface Harness {
  readonly reader: Reader
  /** Open one logical stream and return its id. */
  open(endpoint: string): Promise<number>
  close(): Promise<void>
}

async function start(overrides: Partial<PipeCarrierOptions> = {}): Promise<Harness> {
  const path = newPipePath()
  const carrier: PipeCarrier = await installPipeCarrier({
    path,
    dispatch: sseDispatch,
    openSseStream: (url, signal) => Promise.resolve(readSseResponse(url, sseDispatch, signal)),
    // SSE endpoints must never reach this opener; the assertion lives in the routing test.
    openStream: () => { throw new Error('gateway opener used for an sse endpoint') },
    streamFailure: (error) => ({ code: 'test', message: String(error), details: {} }),
    log: () => {},
    ...overrides,
  })
  const socket = connect(path)
  await once(socket, 'connect')
  const reader = new Reader(socket)
  // The carrier greets first; the client never sends hello.
  const hello = await reader.next()
  expect(hello.t).toBe('hello')
  let nextId = 1
  return {
    reader,
    open: async (endpoint) => {
      const id = nextId++
      socket.write(encodeJson({ t: 'stream-open', id, endpoint, payload: null }))
      return id
    },
    close: async () => { socket.destroy(); await carrier.close() },
  }
}

describe('sse stream over the pipe carrier', () => {
  it('splits data payloads across chunk boundaries and ends the stream', async () => {
    const harness = await start()
    try {
      await harness.open('sse:/sse/three')
      const { items, terminal } = await harness.reader.drain()
      expect(items).toEqual(['one', 'two', 'three'])
      expect(terminal.t).toBe('stream-end')
    } finally {
      await harness.close()
    }
  })

  it('ignores comment and event-name lines', async () => {
    const harness = await start()
    try {
      await harness.open('sse:/sse/non-data')
      const { items } = await harness.reader.drain()
      expect(items).toEqual(['payload'])
    } finally {
      await harness.close()
    }
  })

  it('ends without items when the route writes no data', async () => {
    const harness = await start()
    try {
      await harness.open('sse:/sse/absent')
      const { items, terminal } = await harness.reader.drain()
      expect(items).toEqual([])
      expect(terminal.t).toBe('stream-end')
    } finally {
      await harness.close()
    }
  })

  it('sends non-sse endpoints to the gateway opener', async () => {
    const harness = await start()
    try {
      await harness.open('gateway/something')
      const { terminal } = await harness.reader.drain()
      // The gateway opener throws on purpose: reaching it proves the prefix split.
      expect(terminal.t).toBe('stream-error')
      expect(JSON.stringify(terminal.failure)).toContain('gateway opener used')
    } finally {
      await harness.close()
    }
  })

  it('fails the stream when the carrier installed no sse opener', async () => {
    const harness = await start({ openSseStream: undefined })
    try {
      await harness.open('sse:/sse/three')
      const { terminal } = await harness.reader.drain()
      expect(terminal.t).toBe('stream-error')
      expect(JSON.stringify(terminal.failure)).toContain('openSseStream')
    } finally {
      await harness.close()
    }
  })
})
