// @vitest-environment jsdom

/**
 * 页面流桥（apps/tauri/src-tauri/src/dsh_stream_bridge.js）的行为测试：页面上唯一的「逻辑流 → 壳 IPC → 管道」入口，
 * 失败语义须与 dsh 客户端约定逐字一致（`dshRemoteStreamFailure` 标记决定域层重试/显式失败）——Rust 侧测试看不见它，
 * 故以 jsdom 载入同一份文件做行为断言；桩面 `__TAURI_INTERNALS__` 只提供 invoke + transformCallback（与真实运行时同形）。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(
  join(process.cwd(), 'apps/tauri/src-tauri/src/dsh_stream_bridge.js'),
  'utf8',
)

interface InvokeCall {
  readonly command: string
  readonly args: Record<string, unknown>
}

interface Bridge {
  readonly openStream: (
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
    uplink?: AsyncIterable<unknown>,
  ) => AsyncIterable<unknown>
}

let calls: InvokeCall[] = []
let callbacks: Array<(event: unknown) => void> = []
/** 流 id = cmd_stream_open 的返回值（取消/上行都用它）；channel id 另算（transformCallback）。 */
let nextStreamId = 1
const defaultOpen = () => Promise.resolve(nextStreamId++)
let openResult: () => Promise<unknown> = defaultOpen
let nextId = 1

/** 装桥（含 IPC 桩）；脚本自身幂等，重复 boot 只换桩。 */
function boot(): { bridge: Bridge; calls: InvokeCall[] } {
  calls = []
  callbacks = []
  nextId = 1
  nextStreamId = 1
  openResult = defaultOpen
  ;(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
    invoke: (command: string, args: Record<string, unknown>) => {
      calls.push({ command, args })
      if (command === 'cmd_stream_open') return openResult()
      return Promise.resolve(undefined)
    },
    transformCallback: (callback: (event: unknown) => void) => {
      callbacks.push(callback)
      return nextId++
    },
  }
  // 被测源码是本仓一等文件（Rust 侧同一份 include_str! 注入），非外部输入 → 直接求值
  new Function(SOURCE)()
  return { bridge: (globalThis as { __WORLDSEA_STREAM__: Bridge }).__WORLDSEA_STREAM__, calls }
}

/** 取最近一次 cmd_stream_open 里的 channel 串（经 JSON 往返，与真实 IPC 序列化同形）。 */
function channelOf(call: InvokeCall): { serialized: string; id: number } {
  const roundTrip = JSON.parse(JSON.stringify({ channel: call.args.channel })) as { channel: string }
  const match = /^__CHANNEL__:(\d+)$/u.exec(roundTrip.channel)
  if (match === null) throw new Error(`channel 形态不符：${roundTrip.channel}`)
  return { serialized: roundTrip.channel, id: Number(match[1]) }
}

/** 模拟宿主下行：按 id 找回调并投递一帧。 */
function deliver(id: number, message: unknown): void {
  const callback = callbacks[id - 1]
  if (callback === undefined) throw new Error(`无 id=${id} 的回调`)
  callback({ message, index: 0 })
}

async function collect(stream: AsyncIterable<unknown>, limit = 10): Promise<unknown[]> {
  const items: unknown[] = []
  for await (const item of stream) {
    items.push(item)
    if (items.length >= limit) break
  }
  return items
}

describe('页面流桥：openStream 钩子', () => {
  it('开流经 cmd_stream_open；channel 为 __CHANNEL__:<transformCallback id>', async () => {
    const { bridge } = boot()
    const stream = bridge.openStream('$events', { args: {} })
    const pending = collect(stream)
    await Promise.resolve()
    const open = calls.find(call => call.command === 'cmd_stream_open')
    expect(open).toBeDefined()
    expect(open?.args.endpoint).toBe('$events')
    expect(open?.args.payload).toEqual({ args: {} })
    const channel = channelOf(open as InvokeCall)
    // 交付态：id 必须是 transformCallback 注册的回调位（宿主 runCallback 用它投递）
    expect(channel.id).toBeGreaterThanOrEqual(1)
    deliver(channel.id, { type: 'item', value: 'first' })
    deliver(channel.id, { type: 'end' })
    expect(await pending).toEqual(['first'])
  })

  it('下行按序产出；end 终态结束迭代', async () => {
    const { bridge } = boot()
    const stream = bridge.openStream('echo', null)
    const pending = collect(stream)
    await Promise.resolve()
    const channel = channelOf(calls.find(call => call.command === 'cmd_stream_open') as InvokeCall)
    deliver(channel.id, { type: 'item', value: 1 })
    deliver(channel.id, { type: 'item', value: 2 })
    deliver(channel.id, { type: 'end' })
    expect(await pending).toEqual([1, 2])
  })

  it('远端失败 → 抛出错误带 dshRemoteStreamFailure（remote：code/details）', async () => {
    const { bridge } = boot()
    const stream = bridge.openStream('bad', null)
    const pending = collect(stream).catch((error: unknown) => error)
    await Promise.resolve()
    const channel = channelOf(calls.find(call => call.command === 'cmd_stream_open') as InvokeCall)
    deliver(channel.id, {
      type: 'error',
      failure: { kind: 'remote', code: 'gateway/protocol', message: 'boom', details: { endpoint: 'bad' } },
    })
    const error = (await pending) as Error & { dshRemoteStreamFailure?: unknown }
    expect(error.message).toBe('boom')
    expect(error.dshRemoteStreamFailure).toEqual({
      kind: 'remote', code: 'gateway/protocol', details: { endpoint: 'bad' },
    })
  })

  it('开流失败（invoke 拒绝）→ carrier 标记（域层可区分重试语义）', async () => {
    const { bridge } = boot()
    openResult = () => Promise.reject(new Error('bridge not ready'))
    const error = (await collect(bridge.openStream('x', null)).catch(reason => reason)) as Error & {
      dshRemoteStreamFailure?: unknown
    }
    expect(String(error.message)).toContain('bridge not ready')
    expect(error.dshRemoteStreamFailure).toEqual({ kind: 'carrier' })
    openResult = defaultOpen
  })

  it('AbortSignal 触发 → cmd_stream_cancel', async () => {
    const { bridge } = boot()
    const controller = new AbortController()
    const pending = collect(bridge.openStream('never', null, controller.signal)).catch(() => [])
    await Promise.resolve()
    const channel = channelOf(calls.find(call => call.command === 'cmd_stream_open') as InvokeCall)
    controller.abort(new Error('stop'))
    await pending
    expect(calls.some(call => call.command === 'cmd_stream_cancel' && call.args.id === channel.id - 0)).toBe(true)
  })

  it('消费方提前退出（迭代器 return）→ cmd_stream_cancel（不泄漏宿主侧流）', async () => {
    const { bridge } = boot()
    const stream = bridge.openStream('never', null)[Symbol.asyncIterator]()
    const first = stream.next()
    await Promise.resolve()
    const channel = channelOf(calls.find(call => call.command === 'cmd_stream_open') as InvokeCall)
    deliver(channel.id, { type: 'item', value: 'a' })
    await first
    await stream.return?.()
    // 取消是异步投递
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls.some(call => call.command === 'cmd_stream_cancel')).toBe(true)
  })

  it('上行泵：送入项逐条 cmd_stream_send，末了 cmd_stream_end', async () => {
    const { bridge } = boot()
    const uplink = (async function* () {
      yield { k: 1 }
      yield { k: 2 }
    })()
    const stream = bridge.openStream('echo', null, undefined, uplink)
    const pending = collect(stream)
    await new Promise(resolve => setTimeout(resolve, 0))
    const channel = channelOf(calls.find(call => call.command === 'cmd_stream_open') as InvokeCall)
    deliver(channel.id, { type: 'end' })
    await pending
    const sent = calls.filter(call => call.command === 'cmd_stream_send').map(call => call.args.value)
    expect(sent).toEqual([{ k: 1 }, { k: 2 }])
    expect(calls.some(call => call.command === 'cmd_stream_end')).toBe(true)
  })

  it('重复注入是 no-op（桥对象保持首个实例）', () => {
    const first = boot().bridge
    ;(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = undefined
    new Function(SOURCE)()
    expect((globalThis as { __WORLDSEA_STREAM__: Bridge }).__WORLDSEA_STREAM__).toBe(first)
  })

  it('已 abort 的 signal → 立刻拒绝（不开流）', async () => {
    const { bridge } = boot()
    const controller = new AbortController()
    controller.abort(new Error('already'))
    const error = await collect(bridge.openStream('x', null, controller.signal)).catch(reason => reason)
    expect(String((error as Error).message)).toContain('already')
    expect(calls.some(call => call.command === 'cmd_stream_open')).toBe(false)
  })

  // 页重载泄漏防回归：旧页已开的流必须随文档卸载被取消
  // （否则壳持续向失效 callback id 投递：`Couldn't find callback id` 刷屏 + 每次刷新叠加一套流）。
  it('页面卸载（pagehide）→ 批量取消本页未完成流', async () => {
    const { bridge } = boot()
    const first = collect(bridge.openStream('a', null))
    await new Promise(resolve => setTimeout(resolve, 0))
    const second = collect(bridge.openStream('b', null))
    await new Promise(resolve => setTimeout(resolve, 0))
    // boot 重置后两条流各占一个流 id（桩递增：1、2）
    expect(calls.filter(call => call.command === 'cmd_stream_open')).toHaveLength(2)
    window.dispatchEvent(new Event('pagehide'))
    await new Promise(resolve => setTimeout(resolve, 0))
    const cancelled = calls.filter(call => call.command === 'cmd_stream_cancel').map(call => call.args.id)
    expect(cancelled).toEqual(expect.arrayContaining([1, 2]))
    void first
    void second
  })

  it('已终态（end）的流：pagehide 不再重复取消', async () => {
    const { bridge } = boot()
    const pending = collect(bridge.openStream('done', null))
    await Promise.resolve()
    const channel = channelOf(calls.find(call => call.command === 'cmd_stream_open') as InvokeCall)
    deliver(channel.id, { type: 'item', value: 'x' })
    deliver(channel.id, { type: 'end' })
    expect(await pending).toEqual(['x'])
    window.dispatchEvent(new Event('pagehide'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls.some(call => call.command === 'cmd_stream_cancel' && call.args.id === channel.id)).toBe(false)
  })
})
