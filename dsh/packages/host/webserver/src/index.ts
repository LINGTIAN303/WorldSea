/**
 * @deepseek-ai/dsh-host-webserver — node:http route registration — node:https
 * when `tls` names a certificate and key — with optional gzip, index injection,
 * and one fallback seat. It knows no harness concepts and serves no files; the
 * composing application owns dist serving. Electron uses file:// plus IPC
 * instead, and this package never prints the URL.
 * Route handlers retain direct response ownership.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse, Server } from 'node:http'
import { createServer as createSecureServer } from 'node:https'
import { isIP, type AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import type { Duplex } from 'node:stream'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import compressionMiddleware from 'compression'
import ipaddr from 'ipaddr.js'
import Negotiator from 'negotiator'
import { renderIndexInjections, type IndexInjection } from './injections.ts'

export { renderIndexInjections } from './injections.ts'
export type { IndexInjection, IndexInjectionPlacement } from './injections.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: WebServer
  }
  interface Events {
    /**
     * Collect the structured index injection table. Emitted on every index
     * render and every worker boot-payload request; listeners push their
     * current rows, so a row's data is read fresh at emit time.
     * @param table - Mutable row table; listeners append in activation order.
     * @mode emit
     */
    'webserver/index-inject'(table: IndexInjection[]): void
  }
}

/** Route match kind: 'exact' matches the pathname verbatim; 'prefix' p matches p and p/<anything>. */
export type WebRouteKind = 'exact' | 'prefix'

/**
 * How many recent dispatches the activity ring keeps.
 *
 * Sized so a crash report can show a short burst — a plugin looping on one route —
 * without turning the fatal diagnostic into a request log. Five covers
 * "open → poll → poll → the one that died" without dominating stderr.
 */
export const ACTIVITY_HISTORY = 5

/** The route a request just reached, kept as crash evidence rather than a live log. */
export interface WebRouteActivity {
  /** Registration path that matched, so a crash report can name the plugin's namespace. */
  readonly path: string
  /**
   * Plugin that registered the matched route, read from the registering
   * fiber's name at registration time. A supervisor names this instead of
   * guessing which plugin owns the path prefix. Absent for the fallback seat
   * and for routes registered outside a plugin fiber.
   */
  readonly plugin?: string
  /** Match kind of the entry that answered. */
  readonly kind: WebRouteKind
  /** Request method and pathname of the last dispatch. */
  readonly method: string
  /** Pathname as requested, before route matching. */
  readonly url: string
  /** Monotonic dispatch counter; a repeated route still advances it. */
  readonly at: number
}

/** One named route registration. */
export interface WebRoute {
  kind: WebRouteKind
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** One route table row: the registration plus who registered it. */
interface WebRouteEntry {
  readonly route: WebRoute
  /** Registering plugin's fiber name; absent when registered outside a plugin. */
  readonly plugin?: string
}

/**
 * Name of the plugin whose fiber is running, inherited from the nearest named
 * ancestor.
 * @param ctx - the registering context, rebound to the caller by cordis.
 * @returns the plugin name, or undefined when the root fiber is the registrant
 * (no plugin owns the route, so naming it would mislead a crash report).
 */
function callerPluginName(ctx: Context): string | undefined {
  const name = ctx.fiber?.name
  return name === undefined || name === '' || name === 'root' ? undefined : name
}

/** One exact-path HTTP upgrade registration. */
export interface WebUpgradeRoute {
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns protocol negotiation and the upgraded socket after dispatch. */
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}

/**
 * TLS material for the HTTPS listener: one certificate chain file and the
 * private key file it pairs with. Both hold PEM text and both resolve against
 * the process working directory.
 */
export interface TlsConfig {
  /** Certificate chain file, leaf certificate first, PEM, no passphrase. */
  certFile: string
  /** Private key file for the chain's leaf certificate; unencrypted PEM. */
  keyFile: string
}

/** Web server listen, TLS, and response-compression config. */
export interface Config {
  /**
   * Listen address: a concrete IPv4 or IPv6 literal of one local interface,
   * for example the container's own Pod address from `hostname -i`. A loopback
   * literal (any address in 127/8, `::1`, or a mapped form of either) keeps the
   * server on this machine; any other literal serves the network that address
   * belongs to, over plain HTTP unless `tls` is set. The unspecified address —
   * IPv4 any, IPv6 any, and the IPv4-mapped forms of IPv4 any — is rejected at
   * load: it would expose the port on every interface at once.
   */
  host: string
  /** Listen port; zero requests an OS-assigned port. */
  port: number
  /**
   * Serve HTTPS with this certificate and key instead of plain HTTP. Both files
   * are read once, before the listener binds: an unreadable or empty file,
   * invalid PEM, or a key that does not match the certificate rejects
   * initialization rather than falling back to HTTP. The material is never
   * re-read, so replacing a certificate takes a reload. Omitted or null listens
   * over plain HTTP.
   */
  tls?: TlsConfig
  /**
   * External-carrier mode: bind nothing. The composing application owns a
   * non-TCP carrier (a shell-owned IPC pipe) and feeds synthesized exchanges
   * through {@link WebServer.dispatch}; `port` then only declares the
   * authority URL display and trust fences are written against.
   * @default false
   */
  external?: boolean
  /** Response compression for socket-backed HTTP requests. @default 'none' */
  compression?: 'none' | 'gzip'
  /** Gzip DEFLATE level from 0 through 9. @default 1 */
  compressionLevel?: number
  /** Minimum known response length eligible for gzip; unknown-length streams are eligible. @default 1024 */
  compressionThresholdBytes?: number
}

const DEFAULT_COMPRESSION = 'none' as const
const DEFAULT_COMPRESSION_LEVEL = 1
const DEFAULT_COMPRESSION_THRESHOLD_BYTES = 1024

interface ResolvedConfig extends Config {
  compression: 'none' | 'gzip'
  compressionLevel: number
  compressionThresholdBytes: number
}

type NodeMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => void

/** Dotted-quad tail of the IPv6 mixed notation: `::0.0.0.1`, `1:2:3:4:5:6:127.0.0.1`. */
const IPV4_TAIL = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/**
 * Rewrite a dotted-quad tail as the two hex groups holding the same bytes.
 * ipaddr.js 2.5.0 reads an all-zero prefix plus a quad (`::0.0.0.1`) as the
 * IPv4-mapped form `::ffff:0:1`, while `getaddrinfo` — and so `listen` — reads
 * that tail as the low 32 bits of the address itself, which makes `::0.0.0.1`
 * the loopback literal `::1`. Parsing the rewritten text keeps the parsed value
 * equal to the value the socket binds.
 */
function withHexTail(host: string): string {
  const tail = IPV4_TAIL.exec(host)
  if (tail === null) return host
  const [, head = '', a = '', b = '', c = '', d = ''] = tail
  const high = ((Number(a) << 8) | Number(b)).toString(16)
  const low = ((Number(c) << 8) | Number(d)).toString(16)
  return `${head}${high}:${low}`
}

/**
 * Parse a concrete IP literal, normalizing IPv4-mapped IPv6 to IPv4.
 * `node:net` decides what a value must look like for `listen` to accept it, and
 * a trailing `%zone` (a local interface selector, never address text) comes off
 * before parsing; the value handed to `listen` keeps its zone.
 */
function parseIpLiteral(host: string): ipaddr.IPv4 | ipaddr.IPv6 | undefined {
  if (isIP(host) === 0) return undefined
  const zoneAt = host.indexOf('%')
  const parsed = ipaddr.parse(withHexTail(zoneAt === -1 ? host : host.slice(0, zoneAt)))
  return parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress() ? parsed.toIPv4Address() : parsed
}

/** Rejection for a bind address that is no concrete IP literal. */
function notLiteralError(value: string): Error {
  return new Error(`webserver: host ${JSON.stringify(value)} is not a concrete IPv4 or IPv6 address literal`)
}

/** ipaddr's IPv4 unspecified range covers all of 0/8; only the all-zero address binds every interface. */
function isWildcardAddress(parsed: ipaddr.IPv4 | ipaddr.IPv6): boolean {
  const parts = parsed instanceof ipaddr.IPv4 ? parsed.octets : parsed.parts
  return parts.every(part => part === 0)
}

/**
 * Whether a bind address requests every interface at once.
 * @param host - bind address from configuration.
 * @returns true for IPv4 any, IPv6 any, and an IPv4-mapped form of IPv4 any.
 */
export function isWildcardHost(host: string): boolean {
  const parsed = parseIpLiteral(host)
  return parsed !== undefined && isWildcardAddress(parsed)
}

/**
 * Whether a bind address names the local loopback authority.
 * @param host - bind address from configuration.
 * @returns true for any address in 127/8, `::1`, and their IPv4-mapped forms.
 */
export function isLoopbackHost(host: string): boolean {
  const parsed = parseIpLiteral(host)
  return parsed !== undefined && parsed.range() === 'loopback'
}

/**
 * Canonical text of the address a bind literal names: IPv4 and IPv4-mapped
 * literals read as dotted quad, every other literal as its compressed IPv6
 * value. The text names the address `listen` binds, so `::0.0.0.1` reads as
 * `::1`. A `%zone` selects an interface and never appears in the text.
 * @param host - concrete IPv4 or IPv6 literal, with or without a zone.
 * @returns the address text, ready to be a URL host.
 * @throws when `host` is no concrete IPv4 or IPv6 address literal.
 */
export function normalizeBindAddress(host: string): string {
  const parsed = parseIpLiteral(host)
  if (parsed === undefined) throw notLiteralError(host)
  return parsed.toString()
}

/**
 * The URL host form of a bind address. Loopback addresses use their canonical
 * text, so browsers treat them as local, trustworthy origins: a mapped literal
 * such as `::ffff:127.0.0.1` reads as `127.0.0.1`, and `::0.0.0.1` reads as
 * `::1`. A redundant loopback zone is dropped; other addresses keep their text,
 * and IPv6 text is bracketed.
 * @param host - concrete IPv4 or IPv6 bind literal.
 * @returns the URL host, or `undefined` when a non-loopback interface zone id makes the address inexpressible in a URL.
 */
export function bindUrlHost(host: string): string | undefined {
  const zoneAt = host.indexOf('%')
  const bare = zoneAt === -1 ? host : host.slice(0, zoneAt)
  if (!isLoopbackHost(bare) && zoneAt !== -1) return undefined
  const text = isLoopbackHost(bare) ? normalizeBindAddress(bare) : host
  return isIP(text) === 6 ? `[${text}]` : text
}

function createGzipMiddleware(config: ResolvedConfig): NodeMiddleware {
  // `compression` is typed for Express, but its runtime uses only the
  // node:http request and response members supplied here.
  const middleware = compressionMiddleware({
    level: config.compressionLevel,
    threshold: config.compressionThresholdBytes,
    filter(request, response) {
      if (response.getHeader('content-range') !== undefined) return false
      const contentType = response.getHeader('content-type')
      if (typeof contentType === 'string' && contentType.toLowerCase().startsWith('text/event-stream')) return false
      if (typeof contentType === 'string' && /^multipart\/form-data(?:;|$)/i.test(contentType)) return true
      return compressionMiddleware.filter(request, response)
    },
  }) as NodeMiddleware

  return (req, res, next) => {
    // The Web Worker tunnel has no socket and transfers identity bytes.
    if ((res as { socket?: unknown }).socket === undefined) {
      next()
      return
    }
    const encoding = new Negotiator(req).encoding(['gzip', 'identity'])
    const gzipRequest = Object.create(req) as IncomingMessage
    Object.defineProperty(gzipRequest, 'headers', {
      value: { ...req.headers, 'accept-encoding': encoding === 'gzip' ? 'gzip' : 'identity' },
    })
    middleware(gzipRequest, res, next)
  }
}

/**
 * Read one TLS material file for activation. The error names the config field
 * and the resolved path; empty content is rejected here because node:tls
 * silently accepts it, which would bind a listener that can never complete a
 * handshake.
 * @param field - the config field being read, for the diagnostic.
 * @param path - absolute path to read.
 * @returns the file's text.
 */
async function readTlsFile(field: 'certFile' | 'keyFile', path: string): Promise<string> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`webserver: cannot read tls.${field} ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (content.trim().length === 0) {
    throw new Error(`webserver: tls.${field} ${path} is empty`)
  }
  return content
}

/**
 * The browser HTTP carrier service. Activation loads any configured TLS
 * material, then listens immediately; a material or listen failure rejects
 * initialization, and the boot process reports the failed fiber. Route
 * registration order does not affect requests because configured named routes
 * must be distinct, and the fallback handler answers anything not yet claimed
 * during startup with 404 until its owner registers.
 */
export class WebServer extends Service {
  static Config: z<Config> = z.object({
    host: z.transform(z.string(), (value) => {
      const parsed = parseIpLiteral(value)
      if (parsed === undefined) throw notLiteralError(value)
      if (isWildcardAddress(parsed)) {
        throw new Error(`webserver: host ${JSON.stringify(value)} is an unspecified (wildcard) address, which is not supported: binding every interface would expose remote code execution to the network; bind one concrete IPv4 or IPv6 address of a local interface instead`)
      }
      return value
    }).required(),
    port: z.natural().max(65535).required(),
    // An omitted object must not become `{}` and fail the required pair fields.
    tls: z.object({
      certFile: z.string().required(),
      keyFile: z.string().required(),
    }).default(undefined as never),
    external: z.boolean().default(false),
    compression: z.union([z.const('none'), z.const('gzip')]).default(DEFAULT_COMPRESSION),
    compressionLevel: z.number().step(1).min(0).max(9).default(DEFAULT_COMPRESSION_LEVEL),
    compressionThresholdBytes: z.natural().default(DEFAULT_COMPRESSION_THRESHOLD_BYTES),
  })

  private readonly exact = new Map<string, WebRouteEntry>()
  private readonly prefixes = new Map<string, WebRouteEntry>()
  private readonly upgrades = new Map<string, WebUpgradeRoute>()
  private readonly upgradedSockets = new Set<Duplex>()
  /**
   * Last dispatched request and the route that answered it. Kept only so a
   * crash handler can report which plugin namespace was live when the process
   * died: a plugin route that throws leaves no other record, and the failing
   * call site is gone by the time the fatal handler runs.
   */
  private activity: WebRouteActivity | undefined
  private activitySeq = 0
  /**
   * Ring of recent dispatches, oldest first, capped at {@link ACTIVITY_HISTORY}.
   *
   * {@link activity} alone answers "what was live at the instant of death", which
   * can be an unrelated request that merely happened to be in flight. The ring
   * shows the sequence leading up to it, so a reader can tell a plugin hammering
   * one route from a single coincidental request.
   */
  private readonly activityHistory: WebRouteActivity[] = []
  /**
   * Raw connections of a TLS listener, held until they close. A TLS connection
   * joins closeAllConnections()'s table only once its handshake completes, so a
   * socket still handshaking — or one whose peer never sends a ClientHello —
   * would otherwise keep `close()` waiting on the TLS handshake timeout. Empty
   * for the plain listener, whose connections closeAllConnections() reaches.
   */
  private readonly tlsConnections = new Set<Duplex>()
  private readonly indexTaps: ((html: string) => string)[] = []
  private fallback: WebRoute['handler'] | undefined
  private server!: Server
  private listenedPort: number | undefined
  private readonly gzip: NodeMiddleware | undefined
  private readonly tlsConfig: TlsConfig | undefined

  constructor(ctx: Context, private config: Config) {
    super(ctx, 'webServer')
    const resolved = config as ResolvedConfig
    // Schemastery passes an explicit `tls: null` through; only a real object serves TLS.
    this.tlsConfig = resolved.tls ?? undefined
    this.gzip = resolved.compression === 'gzip' ? createGzipMiddleware(resolved) : undefined
  }

  /** The listening port (the OS-assigned value when config.port is 0), or `undefined` before `listen` binds. */
  get port(): number | undefined {
    return this.listenedPort
  }

  /** The configured bind address (one concrete local interface). */
  get host(): Config['host'] {
    return this.config.host
  }

  /**
   * The protocol the listener speaks: `'https:'` when `tls` is configured. The
   * value follows configuration, never a socket or a request header, so a
   * consumer reads it before any request and no proxy can change it.
   */
  get protocol(): 'http:' | 'https:' {
    return this.tlsConfig === undefined ? 'http:' : 'https:'
  }

  /**
   * The root URL local clients use to reach the bound listener: the protocol,
   * the {@link bindUrlHost} form of the bind address, and the listening port.
   * @returns the origin, for example `http://127.0.0.1:3080`.
   * @throws before `listen` binds a port, or when the bind address has no URL form.
   */
  getOrigin(): string {
    const host = bindUrlHost(this.config.host)
    if (host === undefined) {
      throw new Error(`webserver: bind address ${JSON.stringify(this.config.host)} carries an interface zone id, which no URL can express`)
    }
    if (this.listenedPort === undefined) throw new Error('webserver: origin read before the listener bound a port')
    return `${this.protocol}//${host}:${String(this.listenedPort)}`
  }

  /**
   * Register a named route. Duplicate (kind, path) throws — route patterns are
   * a composition-level contract, so a collision is a misconfiguration.
   * @param route - kind, path, and the owning handler.
   * @returns the disposer removing the route.
   */
  register(route: WebRoute): () => void {
    const table = route.kind === 'exact' ? this.exact : this.prefixes
    if (table.has(route.path)) {
      throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
    }
    // Read the registering fiber's name here, while `this.ctx` still resolves to
    // the caller (cordis rebinds it through the caller's shadow context). The
    // name is what a crash report needs; matching it to a `moduleName` happens
    // in the reader, which owns the profile inventory.
    const plugin = callerPluginName(this.ctx)
    table.set(route.path, plugin === undefined ? { route } : { route, plugin })
    return () => { table.delete(route.path) }
  }

  /**
   * The currently registered prefix routes, in registration order. A carrier
   * that gates paths outside this process (a native shell proxying a page)
   * reads this to learn which namespaces this server actually answers, so it
   * need not keep a hand-written copy of a set that plugins change at runtime.
   * @returns every registered prefix path, live at call time.
   */
  listPrefixRoutes(): string[] {
    return [...this.prefixes.keys()]
  }

  /**
   * Register an exact-path HTTP upgrade route. Duplicate paths throw because
   * one socket can have only one protocol owner.
   * @param route - pathname and handler owning negotiation plus socket use.
   * @returns the disposer removing the route.
   */
  registerUpgrade(route: WebUpgradeRoute): () => void {
    if (this.upgrades.has(route.path)) {
      throw new Error(`webserver: duplicate upgrade route "${route.path}"`)
    }
    this.upgrades.set(route.path, route)
    return () => { this.upgrades.delete(route.path) }
  }

  /**
   * Claim the fallback seat: the handler answering every request no named
   * route matches (the SPA dist server in the shipped Web composition). One
   * owner only — a second registration throws, because two fallbacks cannot
   * compose.
   * @param handler - owns the full response lifecycle of unmatched requests.
   * @returns the disposer releasing the seat.
   */
  registerFallback(handler: WebRoute['handler']): () => void {
    if (this.fallback !== undefined) {
      throw new Error('webserver: fallback already registered')
    }
    this.fallback = handler
    return () => { this.fallback = undefined }
  }

  /**
   * Register a raw-HTML index transform, the escape hatch for markup no
   * {@link IndexInjection} row expresses: {@link renderIndex} applies taps in
   * registration order after rendering the structured rows.
   * @param transform - pure html-to-html function.
   * @returns the disposer removing the transform.
   */
  tapIndex(transform: (html: string) => string): () => void {
    this.indexTaps.push(transform)
    return () => {
      const at = this.indexTaps.indexOf(transform)
      if (at !== -1) this.indexTaps.splice(at, 1)
    }
  }

  /** Listen; resolves once the socket is bound (rejection = FAILED fiber). */
  async [Service.init](): Promise<void> {
    const listener = (req: IncomingMessage, res: ServerResponse): void => {
      this.serve(req, res)
    }
    const tls = this.tlsConfig
    // Disposal waits for in-flight acquisition and closes any listener it produces.
    await this.ctx.effect(async () => {
      if (tls === undefined || this.config.external) {
        this.server = createServer(listener)
      } else {
        const certFile = resolve(tls.certFile)
        const keyFile = resolve(tls.keyFile)
        const [cert, key] = await Promise.all([
          readTlsFile('certFile', certFile),
          readTlsFile('keyFile', keyFile),
        ])
        try {
          this.server = createSecureServer({ cert, key }, listener)
        } catch (error) {
          throw new Error(`webserver: tls.certFile ${certFile} and tls.keyFile ${keyFile} are not a usable certificate and key pair: ${error instanceof Error ? error.message : String(error)}`)
        }
        this.server.on('connection', (socket) => {
          this.tlsConnections.add(socket)
          socket.once('close', () => { this.tlsConnections.delete(socket) })
        })
      }
      this.server.on('upgrade', (req, socket, head) => {
        const onError = (error: Error): void => {
          this.ctx.logger.warn(error)
          socket.destroy()
        }
        socket.on('error', onError)
        socket.once('close', () => {
          socket.off('error', onError)
          this.upgradedSockets.delete(socket)
        })
        let route: WebUpgradeRoute | undefined
        try {
          /* v8 ignore next -- node:http always sets url on server requests. */
          route = this.upgrades.get(new URL(req.url ?? '/', 'http://x').pathname)
        } catch (error) {
          this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
          socket.destroy()
          return
        }
        if (route === undefined) {
          socket.destroy()
          return
        }
        this.upgradedSockets.add(socket)
        try {
          Promise.resolve(route.handler(req, socket, head)).catch((error: unknown) => {
            this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
            socket.destroy()
          })
        } catch (error) {
          this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
          socket.destroy()
        }
      })

      if (this.config.external) {
        // External-carrier mode: nothing binds. The composing application owns a
        // non-TCP carrier (an IPC pipe) and feeds synthesized exchanges through
        // dispatch(); route registration, fences, and error semantics below the
        // serving path stay identical. `port` declares the authority URL display
        // and trust fences are written against, with no listener behind it.
        this.listenedPort = this.config.port
      } else {
        await new Promise<void>((resolve, reject) => {
          this.server.once('error', reject)
          this.server.listen(this.config.port, this.config.host, () => {
            this.server.off('error', reject)
            this.server.on('error', (err) => { this.ctx.logger.error(err) })
            this.listenedPort = (this.server.address() as AddressInfo).port
            resolve()
          })
        })
      }

      // Node does not include upgraded sockets in closeAllConnections(), and a TLS
      // connection joins that table only after its handshake. The service owns both
      // kinds with the other connections, so it tracks and destroys them explicitly.
      return async () => {
        const serverClosed = this.server.listening
          ? new Promise<void>((resolve) => {
            this.server.close(() => { resolve() })
          })
          : Promise.resolve()
        this.server.closeAllConnections()
        const socketsClosed = [...this.upgradedSockets, ...this.tlsConnections].map(socket => new Promise<void>((resolve) => {
          socket.once('close', () => { resolve() })
          socket.destroy()
        }))
        await Promise.all([serverClosed, ...socketsClosed])
      }
    }, 'webServer.listen')
  }
  /**
   * Serve one request through the registered tables with the process-safety
   * wrapper. The node:http callback and {@link dispatch} share this path, so
   * routing, error containment, and the gzip layer behave identically. A
   * synthesized response carries no socket, which the compression middleware
   * already treats as identity-transfer.
   */
  private serve(req: IncomingMessage, res: ServerResponse): void {
    const next = (): void => {
      void this.route(req, res).catch((err: unknown) => {
        this.ctx.logger.warn(err instanceof Error ? err : new Error(String(err)))
        if (res.headersSent) {
          res.destroy()
          return
        }
        res.writeHead(400)
        res.end()
      })
    }
    if (this.gzip === undefined) next()
    else this.gzip(req, res, next)
  }

  /** Match one request against the named tables, then the fallback seat. */
  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    /* v8 ignore next -- `?? '/'` arm: node:http always sets url on server
    requests; the field is only optional on the client-side IncomingMessage type */
    const rawPath = new URL(req.url ?? '/', 'http://x').pathname
    const matched = this.match(rawPath)
    // Recorded before the handler runs: a handler that throws leaves the
    // route as the only surviving evidence of which plugin was live.
    const entry: WebRouteActivity = {
      path: matched?.route.path ?? '',
      ...matched?.plugin === undefined ? {} : { plugin: matched.plugin },
      kind: matched?.route.kind ?? 'exact',
      method: req.method ?? '',
      url: rawPath,
      at: ++this.activitySeq,
    }
    this.activity = entry
    this.activityHistory.push(entry)
    if (this.activityHistory.length > ACTIVITY_HISTORY) this.activityHistory.shift()
    if (matched !== undefined) {
      await matched.route.handler(req, res)
      return
    }
    const fallback = this.fallback
    if (fallback === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    await fallback(req, res)
  }

  /**
   * The route that answered the most recent dispatch.
   * @returns the last matched route and request, or undefined before any request.
   */
  lastActivity(): WebRouteActivity | undefined {
    return this.activity
  }

  /**
   * Recent dispatches, oldest first, at most {@link ACTIVITY_HISTORY} of them.
   *
   * A crash report reads this to show the sequence rather than one instant: the
   * last request can be unrelated traffic that merely overlapped the failure.
   * @returns the retained dispatches; empty before any request.
   */
  recentActivity(): readonly WebRouteActivity[] {
    return this.activityHistory
  }

  /**
   * Serve one externally carried request (external-carrier mode). The carrier
   * builds the request/response pair — the synthesizer is the carrier's, since
   * it decides which members exist — and calls this instead of reaching a
   * socket; everything downstream is {@link serve}.
   * @param req - synthesized request carrying url, method, headers, and body.
   * @param res - synthesized response the carrier owns to completion.
   */
  dispatch(req: IncomingMessage, res: ServerResponse): void {
    this.serve(req, res)
  }

  /** Longest-prefix-wins over the prefix table after an exact-table miss. */
  private match(pathname: string): WebRouteEntry | undefined {
    const exact = this.exact.get(pathname)
    if (exact !== undefined) return exact
    let best: WebRouteEntry | undefined
    for (const [prefix, entry] of this.prefixes) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
      if (best === undefined || prefix.length > best.route.path.length) best = entry
    }
    return best
  }

  /**
   * Run an index.html body through the registered taps in registration order
   * — called by the fallback owner on every index response it renders.
   * @param html - the raw index.html body.
   * @returns the transformed body.
   */
  applyIndexTaps(html: string): string {
    let out = html
    for (const transform of this.indexTaps) out = transform(out)
    return out
  }

  /**
   * Gather the structured injection table: one `webserver/index-inject` emit,
   * every subscriber pushes its current rows. Fresh per call, so subscribers
   * read live state (module graph, theme preference) at emit time.
   * @returns rows in subscriber activation order.
   */
  collectIndexInjections(): IndexInjection[] {
    const table: IndexInjection[] = []
    this.ctx.emit('webserver/index-inject', table)
    return table
  }

  /**
   * Render one index.html body: the structured injection table first, then
   * the raw `tapIndex` transforms over the result.
   * @param html - the raw index.html body.
   * @returns the transformed body.
   */
  renderIndex(html: string): string {
    return this.applyIndexTaps(renderIndexInjections(html, this.collectIndexInjections()))
  }
}

export default WebServer
