/**
 * IPC pipe carrier: serve the whole Web tree to a shell-owned client over a
 * named pipe (Windows) or a Unix domain socket.
 *
 * The deployment shape this exists for: a native shell spawns the Host with no
 * TCP listener, hands it a private pipe path, and speaks frames on that pipe
 * instead of HTTP. Each request is fed through the real webserver route table
 * (external-carrier mode), so routing, fences, authentication, and error
 * containment stay the same code the socket path runs; Gateway Remote streams
 * open through their in-process opener, so no WebSocket exists on this carrier.
 *
 * Frame format: `u32be(length) + u8(kind) + payload`. `J` frames carry JSON
 * control messages; `B` frames carry one body as `u32be(id) + bytes` and
 * always immediately follow the control frame that declared their length, in
 * the same write order.
 * @module @deepseek-ai/dsh-web-app/src/pipe-transport
 */

import { rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer as createNetServer, type Server, type Socket } from 'node:net'
import { Readable } from 'node:stream'

/** Protocol version carried in the opening hello frame. */
export const PIPE_TRANSPORT_VERSION = 1

const KIND_JSON = 0x4a
const KIND_BINARY = 0x42
const FRAME_HEADER_BYTES = 5

/**
 * Upper bound for one frame. Sized over the /api request-body cap
 * (`DEFAULT_MAX_REQUEST_BODY_BYTES`, 300 MiB) so a legitimate multipart upload
 * crosses in one body frame; the reader only allocates as bytes arrive, so a
 * forged length fails by mismatch instead of by allocation.
 */
const MAX_FRAME_BYTES = 320 * 1024 * 1024

/** Flow id shared by a request/stream and every frame that belongs to it. */
type FrameId = number

interface RequestFrame {
  readonly t: 'req'
  readonly id: FrameId
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly bodyLen?: number
}

interface StreamOpenFrame {
  readonly t: 'stream-open'
  readonly id: FrameId
  readonly endpoint: string
  readonly payload: unknown
}

interface StreamUplinkItemFrame {
  readonly t: 'stream-uplink-item'
  readonly id: FrameId
  readonly value?: unknown
}

interface StreamUplinkEndFrame {
  readonly t: 'stream-uplink-end'
  readonly id: FrameId
}

interface AbortFrame {
  readonly t: 'abort'
  readonly id: FrameId
}

type InboundFrame = RequestFrame | StreamOpenFrame | StreamUplinkItemFrame | StreamUplinkEndFrame | AbortFrame

/** Remote-stream failure in the stable Client-facing shape. */
export type PipeStreamFailure =
  | { readonly kind: 'remote'; readonly code: string; readonly message: string; readonly details: object }
  | { readonly kind: 'carrier'; readonly message: string }

interface HelloFrame {
  readonly t: 'hello'
  readonly version: number
  readonly carrier: 'worldsea-pipe'
}

interface ResponseFrame {
  readonly t: 'res'
  readonly id: FrameId
  readonly status: number
  readonly headers: Record<string, string>
  readonly bodyLen?: number
}

interface ResponseHeadFrame {
  readonly t: 'res-head'
  readonly id: FrameId
  readonly status: number
  readonly headers: Record<string, string>
}

interface ResponseChunkFrame {
  readonly t: 'res-chunk'
  readonly id: FrameId
  readonly chunkLen: number
}

interface ResponseEndFrame {
  readonly t: 'res-end'
  readonly id: FrameId
}

interface ResponseErrorFrame {
  readonly t: 'res-err'
  readonly id: FrameId
  readonly message: string
}

interface StreamItemFrame {
  readonly t: 'stream-item'
  readonly id: FrameId
  readonly value?: unknown
}

interface StreamEndFrame {
  readonly t: 'stream-end'
  readonly id: FrameId
}

interface StreamErrorFrame {
  readonly t: 'stream-error'
  readonly id: FrameId
  readonly failure: PipeStreamFailure
}

type OutboundFrame =
  | HelloFrame
  | ResponseFrame
  | ResponseHeadFrame
  | ResponseChunkFrame
  | ResponseEndFrame
  | ResponseErrorFrame
  | StreamItemFrame
  | StreamEndFrame
  | StreamErrorFrame

/** Carrier construction inputs. */
export interface PipeCarrierOptions {
  /**
   * Pipe path: `\\.\pipe\<name>` on Windows, a filesystem socket path
   * elsewhere. The composing shell owns naming; this carrier binds exactly it.
   */
  readonly path: string
  /** Route dispatch of the webserver in external-carrier mode (`WebServer.dispatch`). */
  readonly dispatch: (req: IncomingMessage, res: ServerResponse) => void
  /**
   * Direct Gateway Remote-stream opener; `uplink` carries the shell's items.
   * The shell owns the Host, so this is the in-process opener, not a socket.
   */
  readonly openStream: (
    endpoint: string,
    payload: unknown,
    uplink: AsyncIterable<unknown>,
    signal: AbortSignal,
  ) => Promise<AsyncIterable<unknown>>
  /** Convert a stream failure to the stable Client-facing fields. */
  readonly streamFailure: (error: unknown) => { readonly code: string; readonly message: string; readonly details: object }
  /** Diagnostics sink; defaults to the console. */
  readonly log?: (message: string) => void
}

/** The running carrier. */
export interface PipeCarrier {
  /** The bound pipe path. */
  readonly path: string
  /** Stop accepting connections and end every active one. */
  close(): Promise<void>
}

/**
 * Bind one pipe and serve frames until {@link PipeCarrier.close}.
 * @param options - Carrier inputs.
 * @returns The running carrier, once the pipe is bound.
 */
export async function installPipeCarrier(options: PipeCarrierOptions): Promise<PipeCarrier> {
  const log = options.log ?? ((message: string): void => { console.log(message) })
  // A filesystem socket cannot be rebound while its stale path exists; Windows
  // named pipes have no such path.
  if (process.platform !== 'win32') rmSync(options.path, { force: true })
  const sockets = new Set<Socket>()
  const server: Server = createNetServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => { sockets.delete(socket) })
    new PipeConnection(socket, options, log).start()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.path, () => {
      server.off('error', reject)
      resolve()
    })
  })
  server.on('error', (error: Error) => { log(`pipe-transport: server error: ${error.message}`) })
  log(`pipe-transport: listening on ${options.path}`)
  return {
    path: options.path,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => {
        server.close(() => { resolve() })
      })
      if (process.platform !== 'win32') rmSync(options.path, { force: true })
    },
  }
}

/** Serialize one frame: `u32be(length) + kind + payload`. */
function frameBytes(kind: number, payload: Uint8Array): Buffer {
  const head = Buffer.allocUnsafe(FRAME_HEADER_BYTES)
  head.writeUInt32BE(payload.byteLength, 0)
  head.writeUInt8(kind, FRAME_HEADER_BYTES - 1)
  return Buffer.concat([head, payload])
}

/** Prefix one body with its flow id for a binary frame. */
function withId(id: FrameId, bytes: Uint8Array): Buffer {
  const payload = Buffer.allocUnsafe(4 + bytes.byteLength)
  payload.writeUInt32BE(id, 0)
  payload.set(bytes, 4)
  return payload
}

/** One active request: its synthetic exchange, to abort on shell disconnect. */
interface ActiveRequest {
  abort(): void
}

/** One open logical stream's cancellation owner. */
interface ActiveStream {
  readonly controller: AbortController
}

/**
 * One pipe connection: frame reader, request dispatch, and stream lanes.
 * A shell may reconnect after a crash; each connection owns its own lanes and
 * tears every in-flight one down when it drops.
 */
class PipeConnection {
  private readonly requests = new Map<FrameId, ActiveRequest>()
  private readonly streams = new Map<FrameId, ActiveStream>()
  private readonly uplinks = new Map<FrameId, Uplink>()
  private readonly parser = new FrameParser()
  /** A request control frame holding until its declared body frame arrives. */
  private heldRequest: RequestFrame | undefined
  /** A control frame declared a body; the next binary frame must match it. */
  private pendingBody: { readonly id: FrameId; readonly length: number } | undefined
  private failed = false

  constructor(
    private readonly socket: Socket,
    private readonly options: PipeCarrierOptions,
    private readonly log: (message: string) => void,
  ) {}

  start(): void {
    this.socket.on('data', (chunk: Buffer) => { this.consume(chunk) })
    this.socket.on('error', (error: Error) => { this.log(`pipe-transport: connection error: ${error.message}`) })
    this.socket.on('close', () => { this.teardown() })
    this.send({ t: 'hello', version: PIPE_TRANSPORT_VERSION, carrier: 'worldsea-pipe' })
  }

  /** Tear down every in-flight lane; the shell reconnects or reports failure. */
  private teardown(): void {
    for (const request of this.requests.values()) request.abort()
    this.requests.clear()
    for (const stream of this.streams.values()) stream.controller.abort(new Error('pipe-transport: connection closed'))
    this.streams.clear()
    for (const uplink of this.uplinks.values()) uplink.close()
    this.uplinks.clear()
  }

  /** A protocol violation makes the byte stream ambiguous: fail loudly, once. */
  private violate(reason: string): void {
    if (this.failed) return
    this.failed = true
    this.log(`pipe-transport: protocol violation (${reason}); closing the connection`)
    this.socket.destroy()
  }

  private consume(chunk: Buffer): void {
    let frames: Array<{ kind: number; payload: Buffer }>
    try {
      frames = this.parser.push(chunk)
    } catch (error) {
      this.violate(error instanceof Error ? error.message : String(error))
      return
    }
    for (const frame of frames) {
      if (this.failed) return
      this.accept(frame)
    }
  }

  private accept(frame: { kind: number; payload: Buffer }): void {
    if (frame.kind === KIND_BINARY) {
      this.acceptBody(frame.payload)
      return
    }
    if (frame.kind !== KIND_JSON) {
      this.violate(`unknown frame kind ${String(frame.kind)}`)
      return
    }
    let inbound: InboundFrame
    try {
      inbound = parseInboundFrame(frame.payload.toString('utf8'))
    } catch (error) {
      this.violate(error instanceof Error ? error.message : String(error))
      return
    }
    this.acceptControl(inbound)
  }

  private acceptControl(frame: InboundFrame): void {
    switch (frame.t) {
      case 'req': {
        if (frame.bodyLen === undefined || frame.bodyLen === 0) {
          this.dispatchRequest(frame, undefined)
          return
        }
        this.pendingBody = { id: frame.id, length: frame.bodyLen }
        this.heldRequest = frame
        return
      }
      case 'stream-open': {
        this.uplinks.set(frame.id, new Uplink())
        void this.serveStream(frame)
        return
      }
      case 'stream-uplink-item': {
        this.uplinks.get(frame.id)?.push(frame.value)
        return
      }
      case 'stream-uplink-end': {
        this.uplinks.get(frame.id)?.end()
        return
      }
      case 'abort': {
        this.requests.get(frame.id)?.abort()
        this.requests.delete(frame.id)
        this.streams.get(frame.id)?.controller.abort(new Error('pipe-transport: shell aborted the stream'))
        this.streams.delete(frame.id)
        this.uplinks.get(frame.id)?.close()
        this.uplinks.delete(frame.id)
        return
      }
    }
  }

  private acceptBody(payload: Buffer): void {
    const pending = this.pendingBody
    this.pendingBody = undefined
    const frame = this.heldRequest
    this.heldRequest = undefined
    if (pending === undefined || frame === undefined) {
      this.violate('binary frame without a declaring control frame')
      return
    }
    if (payload.byteLength < 4) {
      this.violate('binary frame carries no id')
      return
    }
    const id = payload.readUInt32BE(0)
    const body = payload.subarray(4)
    if (id !== pending.id || body.byteLength !== pending.length) {
      this.violate(`binary frame mismatch for id ${String(pending.id)}`)
      return
    }
    this.dispatchRequest(frame, Buffer.from(body))
  }

  private dispatchRequest(frame: RequestFrame, body: Buffer | undefined): void {
    const exchange = createSyntheticExchange(frame, body, this.sinkFor(frame.id))
    this.requests.set(frame.id, exchange)
    this.options.dispatch(exchange.req, exchange.res)
  }

  private sinkFor(id: FrameId): ResponseSink {
    const requests = this.requests
    return {
      head: (status, headers) => { this.send({ t: 'res-head', id, status, headers }) },
      chunk: (bytes) => { this.send({ t: 'res-chunk', id, chunkLen: bytes.byteLength }, withId(id, bytes)) },
      end: (payload) => {
        if (payload === undefined) {
          this.send({ t: 'res-end', id })
        } else if (payload.body === undefined) {
          this.send({ t: 'res', id, status: payload.status, headers: payload.headers })
        } else {
          this.send({
            t: 'res', id, status: payload.status, headers: payload.headers, bodyLen: payload.body.byteLength,
          }, withId(id, payload.body))
        }
        requests.delete(id)
      },
      fail: (message) => {
        this.send({ t: 'res-err', id, message })
        requests.delete(id)
      },
    }
  }

  private async serveStream(frame: StreamOpenFrame): Promise<void> {
    const uplink = this.uplinks.get(frame.id)
    if (uplink === undefined) return
    const controller = new AbortController()
    this.streams.set(frame.id, { controller })
    try {
      const source = await this.options.openStream(frame.endpoint, frame.payload, uplink, controller.signal)
      for await (const value of source) {
        if (controller.signal.aborted) return
        this.send({ t: 'stream-item', id: frame.id, value })
      }
      if (!controller.signal.aborted) this.send({ t: 'stream-end', id: frame.id })
    } catch (error) {
      if (!controller.signal.aborted) {
        this.send({
          t: 'stream-error',
          id: frame.id,
          failure: { kind: 'remote', ...this.options.streamFailure(error) },
        })
      }
    } finally {
      this.streams.delete(frame.id)
      this.uplinks.delete(frame.id)
      uplink.close()
    }
  }

  private send(frame: OutboundFrame, binary?: Uint8Array): void {
    if (this.failed) return
    this.socket.write(frameBytes(KIND_JSON, Buffer.from(JSON.stringify(frame), 'utf8')))
    if (binary !== undefined) this.socket.write(frameBytes(KIND_BINARY, binary))
  }
}

/** Incremental frame reader over one connection. */
class FrameParser {
  private buffer: Buffer = Buffer.alloc(0)

  /**
   * Feed one socket chunk; returns every complete frame it completed.
   * @param chunk - bytes read from the pipe.
   * @throws When the stream is not a sequence of frames this protocol defines.
   */
  push(chunk: Buffer): Array<{ kind: number; payload: Buffer }> {
    this.buffer = this.buffer.byteLength === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    const frames: Array<{ kind: number; payload: Buffer }> = []
    while (this.buffer.byteLength >= FRAME_HEADER_BYTES) {
      const length = this.buffer.readUInt32BE(0)
      if (length > MAX_FRAME_BYTES) throw new Error(`frame length ${String(length)} exceeds the carrier bound`)
      const end = FRAME_HEADER_BYTES + length
      if (this.buffer.byteLength < end) break
      frames.push({
        kind: this.buffer.readUInt8(FRAME_HEADER_BYTES - 1),
        // Copied out: the parser's buffer is replaced as later chunks arrive.
        payload: Buffer.from(this.buffer.subarray(FRAME_HEADER_BYTES, end)),
      })
      this.buffer = this.buffer.subarray(end)
    }
    return frames
  }
}

/** Validate one inbound JSON frame; throws with the reason on any violation. */
function parseInboundFrame(text: string): InboundFrame {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('control frame is not JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('control frame is not an object')
  const frame = parsed as Record<string, unknown>
  const id = frame['id']
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0 || id > 0xffffffff) {
    throw new Error('control frame has no usable numeric id')
  }
  switch (frame['t']) {
    case 'req': {
      const method = frame['method']
      const url = frame['url']
      const headers = frame['headers']
      if (typeof method !== 'string' || typeof url !== 'string') throw new Error('request frame needs a method and url')
      if (typeof headers !== 'object' || headers === null) throw new Error('request frame needs a headers object')
      const normalized: Record<string, string> = {}
      for (const [key, value] of Object.entries(headers)) {
        if (typeof value !== 'string') throw new Error('request frame headers must be strings')
        normalized[key.toLowerCase()] = value
      }
      const bodyLen = frame['bodyLen']
      if (bodyLen !== undefined && (typeof bodyLen !== 'number' || !Number.isSafeInteger(bodyLen) || bodyLen < 0)) {
        throw new Error('request frame bodyLen must be a non-negative integer')
      }
      return {
        t: 'req', id, method, url, headers: normalized,
        ...bodyLen === undefined ? {} : { bodyLen },
      }
    }
    case 'stream-open': {
      const endpoint = frame['endpoint']
      if (typeof endpoint !== 'string' || endpoint.length === 0) {
        throw new Error('stream-open frame needs a non-empty endpoint')
      }
      return { t: 'stream-open', id, endpoint, payload: frame['payload'] }
    }
    case 'stream-uplink-item':
      return { t: 'stream-uplink-item', id, value: frame['value'] }
    case 'stream-uplink-end':
      return { t: 'stream-uplink-end', id }
    case 'abort':
      return { t: 'abort', id }
    default:
      throw new Error(`unknown control frame type ${JSON.stringify(frame['t'])}`)
  }
}

/** Where one synthetic response writes its frames. */
interface ResponseSink {
  head(status: number, headers: Record<string, string>): void
  chunk(bytes: Uint8Array): void
  end(payload?: { readonly status: number; readonly headers: Record<string, string>; readonly body?: Uint8Array }): void
  fail(message: string): void
}

/** The pair a route handler consumes, plus abort control for the carrier. */
interface SyntheticExchange {
  readonly req: IncomingMessage
  readonly res: ServerResponse
  abort(): void
}

/**
 * Build the request/response pair for one carried request. The member set is
 * exactly what the composed route handlers read (the /api bridge, the static
 * fallback, and the app routes); anything else stays absent so a new consumer
 * fails loud instead of silently reading a stub.
 * @param frame - validated request frame.
 * @param body - the declared body bytes, when present.
 * @param sink - frame emitter for the response.
 * @returns The exchange handed to the webserver dispatch.
 */
function createSyntheticExchange(
  frame: RequestFrame,
  body: Buffer | undefined,
  sink: ResponseSink,
): SyntheticExchange {
  // A real Readable, not an iterator-shaped stand-in: the /api bridge and the
  // file-upload route hand `Readable.toWeb(req)` downstream, and a plain
  // object would fail that conversion.
  const req = new Readable({ read() {} }) as Readable & {
    url?: string
    method?: string
    headers: Record<string, string>
  }
  req.url = frame.url
  req.method = frame.method
  req.headers = { ...frame.headers }
  req.push(body ?? null)
  req.push(null)

  let status = 200
  let headers: Record<string, string> = {}
  let streaming = false
  let finished = false
  let destroyed = false
  const listeners = new Map<string, Set<() => void>>()

  const emit = (event: string): void => {
    for (const callback of [...(listeners.get(event) ?? [])]) callback()
  }

  const res: Record<string, unknown> = {
    get statusCode(): number { return status },
    set statusCode(next: number) { status = next },
    get headersSent(): boolean { return streaming },
    get writableEnded(): boolean { return finished },
    get destroyed(): boolean { return destroyed },
    writeHead: (nextStatus: number, ...rest: unknown[]): unknown => {
      status = nextStatus
      // Node signature: writeHead(status[, statusMessage][, headers]).
      for (const argument of rest) {
        if (typeof argument !== 'object' || argument === null) continue
        headers = {}
        for (const [key, value] of Object.entries(argument as Record<string, string | number>)) {
          headers[key.toLowerCase()] = String(value)
        }
      }
      return res
    },
    setHeader: (name: string, value: string | number): unknown => {
      headers[name.toLowerCase()] = String(value)
      return res
    },
    write: (chunk: string | Uint8Array): boolean => {
      if (finished || destroyed) return false
      if (!streaming) {
        streaming = true
        sink.head(status, headers)
      }
      sink.chunk(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk)
      return true
    },
    end: (chunk?: string | Uint8Array): unknown => {
      if (finished) return res
      finished = true
      const bytes = chunk === undefined
        ? undefined
        : typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
      if (streaming) {
        if (bytes !== undefined) sink.chunk(bytes)
        sink.end()
      } else if (bytes === undefined) {
        sink.end({ status, headers })
      } else {
        sink.end({ status, headers, body: bytes })
      }
      emit('finish')
      emit('close')
      return res
    },
    destroy: (): void => {
      if (finished) return
      destroyed = true
      finished = true
      sink.fail(`response destroyed for ${frame.method} ${frame.url}`)
      emit('close')
    },
    on: (event: string, callback: () => void): unknown => {
      const set = listeners.get(event) ?? new Set<() => void>()
      set.add(callback)
      listeners.set(event, set)
      return res
    },
    off: (event: string, callback: () => void): unknown => {
      listeners.get(event)?.delete(callback)
      return res
    },
  }
  res['once'] = res['on']

  return {
    req: req as unknown as IncomingMessage,
    res: res as unknown as ServerResponse,
    abort: (): void => {
      if (finished) return
      destroyed = true
      finished = true
      emit('close')
    },
  }
}

const UPLINK_DONE: IteratorReturnResult<undefined> = { value: undefined, done: true }

/**
 * Uplink items of one logical stream, read once by the Host method as its
 * `uplink`. The shell may push before or after the opener resolves; the queue
 * buffers, and reading ends when the shell half-closes or the lane tears down.
 */
class Uplink implements AsyncIterable<unknown>, AsyncIterator<unknown> {
  private readonly items: Array<{ readonly value: unknown }> = []
  private ended = false
  private closed = false
  private wake: (() => void) | undefined

  push(value: unknown): void {
    if (this.ended || this.closed) return
    this.items.push({ value })
    this.signal()
  }

  /** Shell half-close; buffered items still drain. */
  end(): void {
    if (this.ended) return
    this.ended = true
    this.signal()
  }

  /** Lane teardown: drop buffered items and end the consumer's next read. */
  close(): void {
    this.closed = true
    this.items.length = 0
    this.signal()
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return this
  }

  async next(): Promise<IteratorResult<unknown>> {
    while (true) {
      if (this.closed) return UPLINK_DONE
      const entry = this.items.shift()
      if (entry !== undefined) return { value: entry.value, done: false }
      if (this.ended) return UPLINK_DONE
      if (this.wake !== undefined) throw new Error('pipe-transport: stream uplink has one pending read')
      await new Promise<void>((resolve) => { this.wake = resolve })
    }
  }

  /** The consumer stopped reading: buffered and later items are dropped. */
  return(): Promise<IteratorResult<unknown>> {
    this.closed = true
    this.items.length = 0
    return Promise.resolve(UPLINK_DONE)
  }

  private signal(): void {
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }
}
