// @vitest-environment jsdom

/**
 * SSE 桥（apps/tauri/src-tauri/src/dsh_sse_bridge.js）的行为测试。
 *
 * 两条断言来自真实事故与真实集成点，Rust 侧测试都看不见：
 *
 * 1. **fetch 必须分流**。`__DSH_TRANSPORT__.fetch` 在 dsh 客户端里的类型是 `RpcFetch`
 *    （`client/connection/src/client/rpc.ts`：`(input, init) => Promise<Response>`），
 *    它是**所有一元 RPC 的通用请求钩子**——网关方法、插件清单、Agent 预设、市场状态全走它。
 *    桥最初无条件接管它，导致整页大面积 `Failed to fetch`（模型/插件/预设/市场全部加载失败）。
 *    故非 SSE 请求必须原样交回原生 `fetch`，这条是回归防线。
 * 2. **SSE 命中后 body 是原始 SSE 文本**：`client-hmr` 用
 *    `response.body.pipeThrough(TextDecoderStream).pipeThrough(EventSourceParserStream)`
 *    消费，故必须含 `data: ` 前缀与空行分隔。
 *
 * jsdom 里 `Response`/`ReadableStream`/`TextEncoder` 齐备；IPC 桩只提供 invoke + transformCallback。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const SOURCE = readFileSync(
  join(process.cwd(), 'apps/tauri/src-tauri/src/dsh_sse_bridge.js'),
  'utf8',
)

interface InvokeCall {
  readonly command: string
  readonly args: Record<string, unknown>
}

interface SseBridge {
  readonly sse: (path: string, signal?: AbortSignal) => AsyncIterable<string>
  readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
}

let calls: InvokeCall[] = []
let callbacks: Array<(event: unknown) => void> = []
let nextId = 1
/** Payloads the fake shell pushes down the SSE stream, then ends. */
let pushedItems: string[] = []
let nativeFetch: ReturnType<typeof vi.fn>

/**
 * Boot the bridge over IPC stubs. The script is idempotent (`__WORLDSEA_SSE__`
 * guards re-entry), so a fresh realm per test comes from clearing the global.
 */
function boot(): SseBridge {
  calls = []
  callbacks = []
  nextId = 1
  pushedItems = []
  delete (globalThis as { __WORLDSEA_SSE__?: unknown }).__WORLDSEA_SSE__
  nativeFetch = vi.fn(() => Promise.resolve(new Response('native-ok', { status: 200 })))
  ;(globalThis as { fetch?: unknown }).fetch = nativeFetch
  const internals = {
    invoke: (command: string, args: Record<string, unknown>) => {
      calls.push({ command, args })
      if (command !== 'cmd_sse_open') return Promise.resolve(undefined)
      // Push the configured payloads on the next macrotask, then end.
      const channel = args['channel'] as { toJSON: () => string }
      const channelId = Number(channel.toJSON().replace('__CHANNEL__:', ''))
      const emit = callbacks[channelId - 1]
      setTimeout(() => {
        for (const value of pushedItems) emit?.({ message: { type: 'item', value } })
        emit?.({ message: { type: 'end' } })
      }, 0)
      return Promise.resolve(7)
    },
    transformCallback: (callback: (event: unknown) => void) => {
      callbacks.push(callback)
      return nextId++
    },
  }
  ;(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = internals
  // The bridge is a first-party file injected verbatim by the shell; evaluating it is intended.
  new Function(SOURCE)()
  return (globalThis as { __WORLDSEA_SSE__?: SseBridge }).__WORLDSEA_SSE__ as SseBridge
}

describe('SSE bridge fetch contract', () => {
  let bridge: SseBridge

  beforeEach(() => {
    bridge = boot()
  })

  it('hands non-SSE requests to the native fetch unchanged', async () => {
    const init: RequestInit = { method: 'POST', headers: { 'content-type': 'application/json' } }
    const response = await bridge.fetch('api/llm/listProviders', init)
    expect(nativeFetch).toHaveBeenCalledTimes(1)
    expect(nativeFetch).toHaveBeenCalledWith('api/llm/listProviders', init)
    expect(await response.text()).toBe('native-ok')
    // The SSE lane must not have been opened for an RPC.
    expect(calls.some((call) => call.command === 'cmd_sse_open')).toBe(false)
  })

  it('treats a request without an accept header as non-SSE', async () => {
    await bridge.fetch('plugins/some-bundle.js')
    expect(nativeFetch).toHaveBeenCalledTimes(1)
    expect(calls.some((call) => call.command === 'cmd_sse_open')).toBe(false)
  })

  it('reads accept from a Headers instance too', async () => {
    await bridge.fetch('api/anything', { headers: new Headers({ accept: 'application/json' }) })
    expect(nativeFetch).toHaveBeenCalledTimes(1)
  })

  it('matches the accept header case-insensitively', async () => {
    pushedItems = ['{"n":1}']
    await bridge.fetch('plugins/events', { headers: { Accept: 'text/event-stream' } })
    expect(nativeFetch).not.toHaveBeenCalled()
  })
})

describe('SSE bridge stream contract', () => {
  let bridge: SseBridge

  beforeEach(() => {
    bridge = boot()
  })

  it('serves an SSE request as a Response with the event-stream content type', async () => {
    pushedItems = ['{"type":"graph"}']
    const response = await bridge.fetch('plugins/events', {
      headers: { accept: 'text/event-stream' },
    })
    expect(nativeFetch).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.body).not.toBeNull()
  })

  it('wraps each payload as raw SSE text so the parser pipeline can consume it', async () => {
    pushedItems = ['first', 'second']
    const response = await bridge.fetch('plugins/events', {
      headers: { accept: 'text/event-stream' },
    })
    const text = await response.text()
    expect(text).toBe('data: first\n\ndata: second\n\n')
  })

  it('normalises the document-relative route the HMR client passes', async () => {
    pushedItems = ['x']
    // The HMR client passes `plugins/events` (no leading slash); the shell command
    // rejects anything that is not document-relative with a leading slash.
    await bridge.fetch('plugins/events', { headers: { accept: 'text/event-stream' } })
    const open = calls.find((call) => call.command === 'cmd_sse_open')
    expect(open).toBeDefined()
    expect(open?.args['path']).toBe('/plugins/events')
  })

  it('yields one item per data payload on the iterator face', async () => {
    pushedItems = ['a', 'b', 'c']
    const collected: string[] = []
    for await (const item of bridge.sse('/plugins/events')) collected.push(item)
    expect(collected).toEqual(['a', 'b', 'c'])
  })
})
