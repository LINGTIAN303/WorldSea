/**
 * mcpForm 纯函数单测：Headers 解析、表单校验、配置构建、摘要、分组。
 * 零 Vue / 零 IPC 依赖（类型导入在运行时擦除）。
 */
import { describe, it, expect } from 'vitest'
import {
  emptyMcpForm,
  parseHeaders,
  headersToText,
  splitArgs,
  validateMcpForm,
  isMcpFormValid,
  buildMcpConfig,
  describeConfig,
  transportLabel,
  groupOf,
  groupConnections,
  slugifyId,
  configToForm,
  stringifyConfigAsJson,
  stringifyFormAsJson,
  parseServerJson,
  type McpFormState,
} from '../mcpForm'
import type { MCPConnectionConfig, MCPConnectionState } from '@worldsea/agent-runtime'

function form(partial: Partial<McpFormState> = {}): McpFormState {
  return { ...emptyMcpForm(), ...partial }
}

function conn(config: Partial<MCPConnectionConfig>, status: MCPConnectionState['status'] = 'disconnected'): MCPConnectionState {
  return {
    id: config.id ?? 'mcp-1',
    config: {
      id: 'mcp-1',
      name: 'srv',
      transport: 'streamable-http',
      enabled: true,
      ...config,
    },
    status,
    tools: [],
  }
}

describe('parseHeaders / headersToText', () => {
  it('多行解析为元组，去除空白与空行', () => {
    expect(parseHeaders('Authorization: Bearer xxx\nX-API-Key: abc\n\n  ')).toEqual([
      ['Authorization', 'Bearer xxx'],
      ['X-API-Key', 'abc'],
    ])
  })
  it('值中含冒号时只按第一个冒号切分', () => {
    expect(parseHeaders('X-Url: http://localhost:9999/mcp')).toEqual([
      ['X-Url', 'http://localhost:9999/mcp'],
    ])
  })
  it('非法行（无冒号 / 冒号开头）被过滤', () => {
    expect(parseHeaders('not-a-header\nAuthorization: Bearer xxx\n: no-key')).toEqual([
      ['Authorization', 'Bearer xxx'],
    ])
  })
  it('空文本返回空数组', () => {
    expect(parseHeaders('')).toEqual([])
  })
  it('回填为多行文本', () => {
    expect(headersToText([['Authorization', 'Bearer xxx'], ['X-K', 'v']])).toBe(
      'Authorization: Bearer xxx\nX-K: v',
    )
    expect(headersToText()).toBe('')
    expect(headersToText([])).toBe('')
  })
})

describe('splitArgs', () => {
  it('按任意空白拆分并去除首尾空白', () => {
    expect(splitArgs('  -y   @scope/pkg   /tmp/a ')).toEqual(['-y', '@scope/pkg', '/tmp/a'])
  })
  it('空白字符串返回空数组', () => {
    expect(splitArgs('   ')).toEqual([])
  })
})

describe('validateMcpForm', () => {
  it('合法 HTTP 表单无错误', () => {
    const f = form({ name: 'web', url: 'http://localhost:3000/mcp' })
    expect(validateMcpForm(f)).toEqual({})
    expect(isMcpFormValid(f)).toBe(true)
  })
  it('名称为空报错', () => {
    expect(validateMcpForm(form({ url: 'http://x/y' })).name).toBeTruthy()
  })
  it('HTTP：URL 为空、非 http(s) 报错', () => {
    expect(validateMcpForm(form({ name: 'a' })).url).toBe('请输入服务器 URL')
    expect(validateMcpForm(form({ name: 'a', url: 'ftp://x' })).url).toMatch(/http/)
    expect(validateMcpForm(form({ name: 'a', url: 'http://' })).url).toBeTruthy()
  })
  it('stdio：command 为空报错，且不校验 URL', () => {
    const f = form({ name: 'a', transport: 'stdio' })
    const errs = validateMcpForm(f)
    expect(errs.command).toBe('请输入启动命令')
    expect(errs.url).toBeUndefined()
    expect(isMcpFormValid(form({ name: 'a', transport: 'stdio', command: 'npx' }))).toBe(true)
  })
  it('Headers 非法行定位到第几个非空行', () => {
    const f = form({
      name: 'a',
      url: 'http://x/y',
      headers: 'Authorization: Bearer xxx\nbadline',
    })
    expect(validateMcpForm(f).headers).toMatch(/第 2/)
  })
})

describe('buildMcpConfig', () => {
  it('HTTP：带 headers 时写入，无 headers 时不含该键', () => {
    const withHeaders = buildMcpConfig(form({ name: 'web', url: 'http://localhost:3000/mcp', headers: 'K: v' }))
    expect(withHeaders.transport).toBe('streamable-http')
    expect(withHeaders.url).toBe('http://localhost:3000/mcp')
    expect(withHeaders.headers).toEqual([['K', 'v']])
    expect(withHeaders.enabled).toBe(true)
    expect(withHeaders.id).toMatch(/^mcp-\d+$/)

    const noHeaders = buildMcpConfig(form({ name: 'web', url: 'http://x/y' }))
    expect('headers' in noHeaders).toBe(false)
  })
  it('stdio：写 command 与拆分后的 args', () => {
    const cfg = buildMcpConfig(form({ name: 'fs', transport: 'stdio', command: 'npx', args: '-y server /tmp' }))
    expect(cfg).toMatchObject({ transport: 'stdio', command: 'npx', args: ['-y', 'server', '/tmp'] })
  })
  it('编辑态保留原 id 与传入的 enabled', () => {
    const cfg = buildMcpConfig(form({ name: 'new', url: 'http://x/y' }), { id: 'mcp-keep', enabled: false })
    expect(cfg.id).toBe('mcp-keep')
    expect(cfg.enabled).toBe(false)
  })
})

describe('describeConfig / transportLabel', () => {
  it('HTTP 返回 URL', () => {
    expect(describeConfig({ id: '1', name: 'a', transport: 'streamable-http', url: 'http://x/y', enabled: true })).toBe('http://x/y')
  })
  it('stdio 拼接命令与参数', () => {
    expect(describeConfig({ id: '1', name: 'a', transport: 'stdio', command: 'npx', args: ['-y', 'srv'], enabled: true })).toBe('npx -y srv')
  })
  it('传输标签', () => {
    expect(transportLabel('stdio')).toBe('stdio')
    expect(transportLabel('streamable-http')).toBe('HTTP')
    expect(transportLabel('sse')).toBe('HTTP')
  })
})

describe('groupOf / groupConnections', () => {
  it('启用且 connected → 已连接', () => {
    expect(groupOf(conn({ enabled: true }, 'connected'))).toBe('connected')
  })
  it('connecting（后端退避重连中）→ 连接中', () => {
    expect(groupOf(conn({ enabled: true }, 'connecting'))).toBe('connecting')
  })
  it('启用但 disconnected / error → 连接失败', () => {
    expect(groupOf(conn({ enabled: true }, 'disconnected'))).toBe('error')
    expect(groupOf(conn({ enabled: true }, 'error'))).toBe('error')
  })
  it('禁用优先落已禁用组（即使残留 connected）', () => {
    expect(groupOf(conn({ enabled: false }, 'connected'))).toBe('disabled')
  })
  it('groupConnections 按组归类且保持顺序', () => {
    const a = conn({ id: 'a', enabled: true }, 'connected')
    const b = conn({ id: 'b', enabled: true }, 'connecting')
    const c = conn({ id: 'c', enabled: true }, 'disconnected')
    const d = conn({ id: 'd', enabled: false }, 'disconnected')
    const g = groupConnections([a, b, c, d])
    expect(g.connected.map((x) => x.id)).toEqual(['a'])
    expect(g.connecting.map((x) => x.id)).toEqual(['b'])
    expect(g.error.map((x) => x.id)).toEqual(['c'])
    expect(g.disabled.map((x) => x.id)).toEqual(['d'])
  })
})

describe('slugifyId / configToForm', () => {
  it('名称转可读 id', () => {
    expect(slugifyId('My Server!')).toBe('mcp-my-server')
    expect(slugifyId('  ')).toBe('mcp-server')
  })
  it('配置回填表单（headers 给原值不脱敏）', () => {
    const cfg: MCPConnectionConfig = {
      id: 'x', name: 'X', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'], enabled: false,
    }
    const f = configToForm(cfg)
    expect(f).toMatchObject({ name: 'X', transport: 'stdio', command: 'npx', args: '-y pkg' })
  })
})

describe('stringifyConfigAsJson / stringifyFormAsJson', () => {
  it('stdio 输出 command/args，不含 url/headers', () => {
    const text = stringifyConfigAsJson({
      id: 'fs', name: 'FS', transport: 'stdio', command: 'npx', args: ['-y', 'srv'], enabled: true,
    })
    const obj = JSON.parse(text)
    expect(obj).toEqual({ id: 'fs', name: 'FS', transport: 'stdio', command: 'npx', args: ['-y', 'srv'], enabled: true })
    expect(text).not.toContain('url')
    expect(text).toContain('\n  ') // pretty 缩进
  })
  it('HTTP 无 headers 时不含该键；表单序列化 id 取 name slug', () => {
    const text = stringifyFormAsJson(form({ name: 'web', url: 'http://x/y' }))
    const obj = JSON.parse(text)
    expect(obj.id).toBe('mcp-web')
    expect(obj.transport).toBe('streamable-http')
    expect('headers' in obj).toBe(false)
  })
  it('headers 序列化为元组数组', () => {
    const text = stringifyFormAsJson(form({ name: 'web', url: 'http://x/y', headers: 'K: v' }))
    expect(JSON.parse(text).headers).toEqual([['K', 'v']])
  })
})

describe('parseServerJson', () => {
  it('语法错误给出明确提示', () => {
    const r = parseServerJson('{ not json')
    expect(r.config).toBeNull()
    expect(r.errors[0]).toMatch(/语法错误/)
  })
  it('非对象（数组/字符串/null）报错', () => {
    expect(parseServerJson('["a"]').errors.length).toBeGreaterThan(0)
    expect(parseServerJson('"http://x"').errors.length).toBeGreaterThan(0)
  })
  it('裸 HTTP 对象解析成功，enabled 默认 true', () => {
    const r = parseServerJson(JSON.stringify({ name: 'web', transport: 'streamable-http', url: 'http://x/y' }))
    expect(r.errors).toEqual([])
    expect(r.config).toMatchObject({ name: 'web', transport: 'streamable-http', url: 'http://x/y', enabled: true })
    expect(r.config?.id).toMatch(/^mcp-\d+$/)
  })
  it('stdio 对象解析成功', () => {
    const r = parseServerJson(JSON.stringify({ id: 'fs', name: 'FS', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'] }))
    expect(r.config).toMatchObject({ id: 'fs', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'] })
  })
  it('mcpServers 包裹：键名作 id，多键取首并提示', () => {
    const one = parseServerJson(JSON.stringify({ mcpServers: { 'my-srv': { name: 'My', transport: 'stdio', command: 'x' } } }))
    expect(one.config?.id).toBe('my-srv')
    const two = parseServerJson(JSON.stringify({ mcpServers: {
      a: { name: 'A', transport: 'stdio', command: 'x' },
      b: { name: 'B', transport: 'stdio', command: 'y' },
    } }))
    expect(two.config?.id).toBe('a')
    expect(two.warnings.join()).toMatch(/第一个/)
    expect(two.errors).toEqual([])
  })
  it('mcpServers 非对象 / 空对象报错', () => {
    expect(parseServerJson(JSON.stringify({ mcpServers: [] })).errors.length).toBeGreaterThan(0)
    expect(parseServerJson(JSON.stringify({ mcpServers: {} })).errors.length).toBeGreaterThan(0)
  })
  it('headers 对象形态归一化为元组数组', () => {
    const r = parseServerJson(JSON.stringify({ name: 'w', transport: 'http', url: 'http://x/y', headers: { Authorization: 'Bearer t' } }))
    expect(r.config?.headers).toEqual([['Authorization', 'Bearer t']])
  })
  it('headers 坏数组 / 坏对象报错', () => {
    expect(parseServerJson('{"name":"w","transport":"stdio","command":"c","headers":[["k"]]}').errors.join()).toMatch(/headers/)
    expect(parseServerJson('{"name":"w","transport":"stdio","command":"c","headers":{"k":1}}').errors.join()).toMatch(/headers/)
  })
  it('transport 别名 http → streamable-http；非法值报错', () => {
    expect(parseServerJson('{"name":"w","transport":"http","url":"http://x/y"}').config?.transport).toBe('streamable-http')
    expect(parseServerJson('{"name":"w","transport":"ws","url":"http://x/y"}').errors.join()).toMatch(/transport/)
  })
  it('兼容 type 字段（Claude Code 风格）', () => {
    const r = parseServerJson('{"name":"w","type":"stdio","command":"c"}')
    expect(r.config?.transport).toBe('stdio')
  })
  it('args 字符串按空白拆分；非字符串数组报错', () => {
    expect(parseServerJson('{"name":"w","transport":"stdio","command":"c","args":"-y pkg"}').config?.args).toEqual(['-y', 'pkg'])
    expect(parseServerJson('{"name":"w","transport":"stdio","command":"c","args":[1,2]}').errors.join()).toMatch(/args/)
  })
  it('缺 name / 缺 url / 缺 command 报错', () => {
    expect(parseServerJson('{"transport":"stdio","command":"c"}').errors.join()).toMatch(/name/)
    expect(parseServerJson('{"name":"w","transport":"streamable-http"}').errors.join()).toMatch(/URL/)
    expect(parseServerJson('{"name":"w","transport":"stdio"}').errors.join()).toMatch(/命令/)
  })
  it('enabled=false 保留', () => {
    const r = parseServerJson('{"name":"w","transport":"stdio","command":"c","enabled":false}')
    expect(r.config?.enabled).toBe(false)
  })
  it('round-trip：序列化后解析字段等价', () => {
    const f = form({ name: 'web', url: 'http://x/y', headers: 'K: v' })
    const text = stringifyFormAsJson(f, { id: 'mcp-web' })
    const r = parseServerJson(text)
    expect(r.config).toEqual(buildMcpConfig(f, { id: 'mcp-web' }))
  })
})
