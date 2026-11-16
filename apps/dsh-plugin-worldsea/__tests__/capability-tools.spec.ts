// @vitest-environment node
/**
 * 能力桥工具（路径 A，2026-11-17）：`world_capability` / `world_capability_list`。
 *
 * 钉四件事：
 * 1. 端点 env 缺失 → fail loud（**不能**静默返回空，否则 Agent 会误判成「没有能力」）
 * 2. 正常路径 → 把 `{id, args}` POST 到端点并回 `result`
 * 3. 端点回 `{ok:false}` → 抛带错误码的异常（业务错误要能被 Agent 看见）
 * 4. `world_capability_list` 走 `__list` 动作（不经能力桥、不占能力 id）
 *
 * 驱动方式与 plugin-tools.spec 同：真实 apply + 伪造 ctx + 打桩 fetch。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as plugin from '../lib/index.js'

interface RegisteredTool {
  name: string
  execute: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<unknown>
}

function loadTools(): Map<string, RegisteredTool> {
  const registered = new Map<string, RegisteredTool>()
  ;(plugin.apply as (ctx: unknown, config?: Record<string, unknown>) => void)(
    { tools: { register: (tool: RegisteredTool) => registered.set(tool.name, tool) } },
    {},
  )
  return registered
}

const ENDPOINT = 'http://127.0.0.1:12345/capability'
const TOKEN = 'test-token'

let savedEndpoint: string | undefined
let savedToken: string | undefined

beforeEach(() => {
  savedEndpoint = process.env.WORLDSEA_CAP_ENDPOINT
  savedToken = process.env.WORLDSEA_CAP_TOKEN
  process.env.WORLDSEA_CAP_ENDPOINT = ENDPOINT
  process.env.WORLDSEA_CAP_TOKEN = TOKEN
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (savedEndpoint === undefined) delete process.env.WORLDSEA_CAP_ENDPOINT
  else process.env.WORLDSEA_CAP_ENDPOINT = savedEndpoint
  if (savedToken === undefined) delete process.env.WORLDSEA_CAP_TOKEN
  else process.env.WORLDSEA_CAP_TOKEN = savedToken
})

/** 打桩 fetch，返回一条 JSON 响应；同时记录收到的请求。 */
function stubFetch(body: unknown, status = 200): { url: string; init: RequestInit }[] {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    }
  })
  return calls
}

describe('world_capability（host 侧触发界面动作）', () => {
  it('端点 env 缺失时 fail loud（不静默返回空）', async () => {
    delete process.env.WORLDSEA_CAP_ENDPOINT
    const tools = loadTools()
    await expect(tools.get('world_capability')!.execute({ id: 'world.demo' }, {})).rejects.toThrow(
      /CAPABILITY_UNAVAILABLE/,
    )
  })

  it('正常路径：POST {id,args} 到端点并回 result', async () => {
    const calls = stubFetch({ ok: true, result: { opened: 'doc-1' } })
    const tools = loadTools()

    const result = await tools.get('world_capability')!.execute(
      { id: 'world.mindmap.doc.open', args: { docId: 'doc-1' } },
      {},
    )

    expect(result).toEqual({ opened: 'doc-1' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(ENDPOINT)
    // 令牌走头，且与 env 一致
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['x-worldsea-token']).toBe(TOKEN)
    // 请求体是 {id,args}
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      id: 'world.mindmap.doc.open',
      args: { docId: 'doc-1' },
    })
  })

  it('无 args 时请求体不带 args 字段', async () => {
    const calls = stubFetch({ ok: true, result: null })
    const tools = loadTools()
    await tools.get('world_capability')!.execute({ id: 'world.demo' }, {})
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ id: 'world.demo' })
  })

  it('端点回 ok:false 时抛带错误码的异常', async () => {
    stubFetch({ ok: false, error: 'CAPABILITY_FORBIDDEN: 不在 ACL' })
    const tools = loadTools()
    await expect(tools.get('world_capability')!.execute({ id: 'world.demo' }, {})).rejects.toThrow(
      /CAPABILITY_FORBIDDEN/,
    )
  })

  it('id 缺失时自查报错（不发请求）', async () => {
    const calls = stubFetch({ ok: true, result: null })
    const tools = loadTools()
    await expect(tools.get('world_capability')!.execute({}, {})).rejects.toThrow(/WORLDSEA_BAD_ARGS/)
    expect(calls).toHaveLength(0)
  })

  it('world_capability_list 走 __list 动作并回条目', async () => {
    const calls = stubFetch({ ok: true, result: [{ id: 'world.demo', summary: '示例' }] })
    const tools = loadTools()

    const result = await tools.get('world_capability_list')!.execute({}, {})

    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ id: '__list' })
    // listOutput 形状：{ items: [...] }（无 total 字段）
    expect(result).toMatchObject({ items: [{ id: 'world.demo', summary: '示例' }] })
  })
})
