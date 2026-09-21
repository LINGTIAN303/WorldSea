/**
 * MCP 卡表单 / 分组纯函数（零 Vue 依赖，便于 vitest 单测）
 *
 * 职责：表单状态、Headers 多行解析、字段校验、配置构建、列表分组、摘要描述。
 * 设计背景与约束见 docs/plans/2026-09-17-MCP卡UI优化.md
 */
import type { MCPConnectionConfig, MCPConnectionState } from '@worldsea/agent-runtime'

/** 表单传输选项（legacy sse 已弃用，不单列，统一归 HTTP/SSE = streamable-http） */
export const MCP_TRANSPORT_OPTIONS: Array<{ value: MCPConnectionConfig['transport']; label: string }> = [
  { value: 'streamable-http', label: 'HTTP/SSE' },
  { value: 'stdio', label: 'stdio（本地命令）' },
]

export interface McpFormState {
  name: string
  transport: MCPConnectionConfig['transport']
  url: string
  command: string
  args: string
  headers: string
}

export function emptyMcpForm(): McpFormState {
  return { name: '', transport: 'streamable-http', url: '', command: '', args: '', headers: '' }
}

/**
 * Headers 多行文本 → 元组数组：每行 `Key: Value`。
 * 空行忽略；不含冒号的非法行忽略（格式错误由 validateMcpForm 报错提示）。
 */
export function parseHeaders(text: string): [string, string][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.includes(':') && line.indexOf(':') > 0)
    .map((line) => {
      const idx = line.indexOf(':')
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as [string, string]
    })
}

/** 配置中的 headers 回填为多行文本（编辑态给原值，不脱敏） */
export function headersToText(headers?: [string, string][]): string {
  if (!headers?.length) return ''
  return headers.map(([k, v]) => `${k}: ${v}`).join('\n')
}

/** stdio 参数：按空白拆分；含空格的参数请走 JSON 模式以数组形式填写 */
export function splitArgs(text: string): string[] {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/) : []
}

/** 表单字段校验：返回 字段→错误信息（空对象表示通过） */
export function validateMcpForm(form: McpFormState): Partial<Record<keyof McpFormState, string>> {
  const errors: Partial<Record<keyof McpFormState, string>> = {}
  if (!form.name.trim()) errors.name = '请输入名称'
  if (form.transport === 'stdio') {
    if (!form.command.trim()) errors.command = '请输入启动命令'
  } else {
    const url = form.url.trim()
    if (!url) errors.url = '请输入服务器 URL'
    else if (!/^https?:\/\/\S+$/.test(url)) errors.url = 'URL 需以 http:// 或 https:// 开头'
  }
  const lines = form.headers.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  const badIdx = lines.findIndex((l) => !l.includes(':') || l.indexOf(':') === 0)
  if (badIdx >= 0) errors.headers = `第 ${badIdx + 1} 个非空行格式应为 Key: Value`
  return errors
}

export function isMcpFormValid(form: McpFormState): boolean {
  return Object.keys(validateMcpForm(form)).length === 0
}

/**
 * 表单 → MCPConnectionConfig
 * - opts.id 存在时保留原 id（编辑态），否则生成新 id（添加态）
 * - opts.enabled 由调用方按当前服务器状态传入（编辑禁用项不应意外发起连接）
 */
export function buildMcpConfig(
  form: McpFormState,
  opts: { id?: string; enabled?: boolean } = {},
): MCPConnectionConfig {
  const base = {
    id: opts.id ?? `mcp-${Date.now()}`,
    name: form.name.trim(),
    enabled: opts.enabled ?? true,
  }
  if (form.transport === 'stdio') {
    return { ...base, transport: 'stdio', command: form.command.trim(), args: splitArgs(form.args) }
  }
  const headers = parseHeaders(form.headers)
  return {
    ...base,
    transport: form.transport,
    url: form.url.trim(),
    ...(headers.length ? { headers } : {}),
  }
}

/** 配置 → 摘要文本：HTTP 显示 URL，stdio 显示命令与参数（单行） */
export function describeConfig(config: MCPConnectionConfig): string {
  if (config.transport === 'stdio') {
    return [config.command ?? '', ...(config.args ?? [])].filter(Boolean).join(' ')
  }
  return config.url ?? ''
}

/** 传输类型短标签（行内徽标用） */
export function transportLabel(transport: string): string {
  return transport === 'stdio' ? 'stdio' : 'HTTP'
}

// ── 分组（四组，与 Rust M6 链路状态机对齐：已连接 / 连接中 / 连接失败 / 已禁用） ──
// connecting = 后端退避重连中（reconnecting）；error 组承载 failed 与 enabled 但未建立连接的项。

export type McpGroupKey = 'connected' | 'connecting' | 'error' | 'disabled'

export const MCP_GROUPS: ReadonlyArray<{ key: McpGroupKey; label: string }> = [
  { key: 'connected', label: '已连接' },
  { key: 'connecting', label: '连接中' },
  { key: 'error', label: '连接失败' },
  { key: 'disabled', label: '已禁用' },
]

/** 连接状态 → 分组：禁用优先；connecting 单列（spinner）；其余非连接态落连接失败 */
export function groupOf(conn: MCPConnectionState): McpGroupKey {
  if (!conn.config.enabled) return 'disabled'
  if (conn.status === 'connected') return 'connected'
  if (conn.status === 'connecting') return 'connecting'
  return 'error'
}

/** 按组归类（保持组内原始顺序） */
export function groupConnections(list: MCPConnectionState[]): Record<McpGroupKey, MCPConnectionState[]> {
  const ret: Record<McpGroupKey, MCPConnectionState[]> = {
    connected: [],
    connecting: [],
    error: [],
    disabled: [],
  }
  for (const conn of list) ret[groupOf(conn)].push(conn)
  return ret
}

// ── 单条 JSON 模式（添加/编辑表单内切换；零 Rust 改动，2026-09-17 B4） ──
// 接受两种粘贴形态：
//   1. 裸服务器对象：{ "id"?, "name", "transport", "url"/"command", ... }
//   2. Claude Code 包裹：{ "mcpServers": { "<id>": { ... } } }（单条，多键取首并提示）
// headers 同时兼容生态常见的对象形态 { "K": "v" } 与原生元组数组 [["K","v"]]。

export interface ParsedServerJson {
  config: MCPConnectionConfig | null
  /** 人类可读错误（语法/结构/字段）；空数组表示通过 */
  errors: string[]
  /** 非阻断提示（如多服务器取首），可在确认时提示 */
  warnings: string[]
}

/** 名称 → 可读 id（JSON 模板与无 id 裸对象兜底） */
export function slugifyId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `mcp-${slug || 'server'}`
}

/** 已存在配置 → 表单状态（编辑态预填；headers 给原值，不脱敏） */
export function configToForm(config: MCPConnectionConfig): McpFormState {
  return {
    name: config.name,
    transport: config.transport,
    url: config.url ?? '',
    command: config.command ?? '',
    args: (config.args ?? []).join(' '),
    headers: headersToText(config.headers),
  }
}

/** 配置 → 单条 pretty JSON（字段按传输方式排序，便于阅读） */
export function stringifyConfigAsJson(config: MCPConnectionConfig): string {
  const { id, name, transport, enabled } = config
  const ordered: Record<string, unknown> =
    transport === 'stdio'
      ? { id, name, transport, command: config.command ?? '', args: config.args ?? [], enabled }
      : {
          id,
          name,
          transport,
          url: config.url ?? '',
          ...(config.headers?.length ? { headers: config.headers } : {}),
          enabled,
        }
  return JSON.stringify(ordered, null, 2)
}

/** 表单状态 → 单条 pretty JSON（切换到 JSON 模式时的可编辑内容） */
export function stringifyFormAsJson(
  form: McpFormState,
  opts: { id?: string; enabled?: boolean } = {},
): string {
  const id = opts.id ?? slugifyId(form.name)
  return stringifyConfigAsJson(buildMcpConfig(form, { id, enabled: opts.enabled ?? true }))
}

/** 解析单条服务器 JSON；错误尽量一次收集齐全 */
export function parseServerJson(text: string): ParsedServerJson {
  const errors: string[] = []
  const warnings: string[] = []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { config: null, errors: [`JSON 语法错误：${e instanceof Error ? e.message : String(e)}`], warnings }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { config: null, errors: ['请输入一个服务器配置对象，不要直接填数组或字符串'], warnings }
  }
  let obj = raw as Record<string, unknown>

  // 兼容 mcpServers 包裹（单条模式）
  let wrapKey = ''
  if (Object.prototype.hasOwnProperty.call(obj, 'mcpServers')) {
    const wrap = (obj as { mcpServers?: unknown }).mcpServers
    if (typeof wrap !== 'object' || wrap === null || Array.isArray(wrap)) {
      return { config: null, errors: ['mcpServers 必须是对象，形如 { "mcpServers": { "服务器id": { ... } } }'], warnings }
    }
    const keys = Object.keys(wrap as Record<string, unknown>)
    if (keys.length === 0) return { config: null, errors: ['mcpServers 中没有服务器配置'], warnings }
    if (keys.length > 1) warnings.push('检测到多个服务器，单条模式仅取第一个；批量编辑请直接修改 mcp.json')
    wrapKey = keys[0]
    const first = (wrap as Record<string, unknown>)[keys[0]]
    if (typeof first !== 'object' || first === null || Array.isArray(first)) {
      return { config: null, errors: [`mcpServers.${wrapKey} 必须是配置对象`], warnings }
    }
    obj = first as Record<string, unknown>
  }

  // name
  const name = typeof obj.name === 'string' ? obj.name.trim() : ''
  if (!name) errors.push('缺少 name（服务器显示名）')

  // transport（兼容 Claude Code 风格的 type；http 视为 streamable-http）
  let transport: MCPConnectionConfig['transport'] | null = null
  const tRaw = obj.transport ?? obj.type
  if (typeof tRaw !== 'string' || !tRaw.trim()) {
    errors.push('缺少 transport（streamable-http / sse / stdio）')
  } else {
    const norm = tRaw.trim() === 'http' ? 'streamable-http' : tRaw.trim()
    if (norm === 'streamable-http' || norm === 'sse' || norm === 'stdio') transport = norm
    else errors.push(`不支持的 transport：${tRaw}（仅 streamable-http / sse / stdio）`)
  }

  // id（包裹键名优先于对象内 id；都没有则交由调用方在确认时生成）
  let id = wrapKey
  if (!id && typeof obj.id === 'string' && obj.id.trim()) id = obj.id.trim()

  // url / command
  const url = typeof obj.url === 'string' ? obj.url.trim() : ''
  const command = typeof obj.command === 'string' ? obj.command.trim() : ''

  // args：字符串数组（宽容单字符串，按空白拆分）
  let args: string[] = []
  if (obj.args !== undefined) {
    if (Array.isArray(obj.args) && obj.args.every((a) => typeof a === 'string')) {
      args = obj.args as string[]
    } else if (typeof obj.args === 'string') {
      args = splitArgs(obj.args)
    } else {
      errors.push('args 必须是字符串数组，如 ["-y", "pkg"]')
    }
  }

  // headers：元组数组或对象
  let headers: [string, string][] = []
  if (obj.headers !== undefined) {
    const h = obj.headers
    if (Array.isArray(h)) {
      const ok = h.every(
        (x) => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && typeof x[1] === 'string',
      )
      if (ok) headers = h as [string, string][]
      else errors.push('headers 数组每项必须是 [键, 值]，如 ["Authorization", "Bearer xxx"]')
    } else if (typeof h === 'object' && h !== null) {
      const rec = h as Record<string, unknown>
      if (Object.values(rec).every((v) => typeof v === 'string')) {
        headers = Object.entries(rec as Record<string, string>)
      } else errors.push('headers 对象的值必须都是字符串')
    } else {
      errors.push('headers 必须是对象或 [键, 值] 数组')
    }
  }

  // enabled
  let enabled = true
  if (obj.enabled !== undefined) {
    if (typeof obj.enabled === 'boolean') enabled = obj.enabled
    else errors.push('enabled 必须是布尔值 true / false')
  }

  // 业务校验复用表单规则（url/command 必填、URL 形态）
  if (transport && name) {
    const probe: McpFormState = {
      name,
      transport,
      url: transport === 'stdio' ? '' : url,
      command: transport === 'stdio' ? command : '',
      args: args.join(' '),
      headers: headersToText(headers),
    }
    for (const msg of Object.values(validateMcpForm(probe))) errors.push(msg)
  }

  if (errors.length || !transport || !name) return { config: null, errors, warnings }

  const finalId = id || `mcp-${Date.now()}`
  const config: MCPConnectionConfig =
    transport === 'stdio'
      ? { id: finalId, name, transport, command, args, enabled }
      : { id: finalId, name, transport, url, ...(headers.length ? { headers } : {}), enabled }
  return { config, errors: [], warnings }
}
