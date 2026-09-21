/**
 * 联网搜索配置跨栈契约守卫（档 1，2026-09-22）
 *
 * 修的是「设置面板配了引擎/Key，但两条实现路径都没人读」——配置面板与降级链之间
 * 断了三处（面板→无消费方、Rust 启动固定 default、TS getSearchConfig 桩返回空）。
 * 这类断裂此前**任何测试都发现不了**，因为单侧测试各自恒绿：Rust 测装配、前端测面板状态，
 * 中间的命令名与字段名无人核对。本 spec 专职守这条缝。
 *
 * 【结构约束】纯源码扫描，不导入被测模块（避免 jsdom 下拉起 Tauri/Vue 运行时）；
 * 断言方向均为「以 Rust 侧定义为准，要求前端跟齐」，新增字段只改一端即报红。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../../..')
const LIB = 'apps/tauri/src-tauri/src/lib.rs'
const RPC = 'apps/tauri/src-tauri/src/http_bridge/rpc.rs'
const CONFIG = 'apps/tauri/src-tauri/src/search_config.rs'
const PANEL = 'apps/tauri/src/space/panels/SpaceAgentSettingsPanel.vue'
const CHILD = 'apps/tauri/src/agent/AgentSettingsPanel.vue'

const CMD_GET = 'cmd_search_config_get'
const CMD_SET = 'cmd_search_config_set'

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf-8')
}

/** 取 confirmation.rs 里 Safe 分支的源码片段（跨行续写，从上一个 `=>` 到本次 `=> ToolPermission::Safe`） */
function safePermissionLine(): string {
  const src = read(CONFIRM)
  const end = src.indexOf('=> ToolPermission::Safe')
  expect(end).toBeGreaterThan(-1)
  const start = Math.max(src.lastIndexOf('=>', end - 1), src.lastIndexOf(';', end), 0)
  return src.slice(start, end)
}

/** snake_case → camelCase（对应 Rust `#[serde(rename_all = "camelCase")]`） */
function toCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

/** 抽取 Rust `pub struct NAME { ... }` 的字段名（已转 camelCase） */
function rustFields(rel: string, structName: string): string[] {
  const src = read(rel)
  const body = new RegExp(`pub struct ${structName}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src)?.[1]
  // 找不到 struct（改名/搬移）本身就是要报红的信号，故用 toBeTruthy 而非带 message 的重载
  expect(body).toBeTruthy()
  return [...(body ?? '').matchAll(/^\s*pub\s+(\w+)\s*:/gm)].map((m) => toCamel(m[1]))
}

/** 抽取 TS `interface NAME { ... }` 的字段名 */
function tsFields(rel: string, interfaceName: string): string[] {
  const src = read(rel)
  const body = new RegExp(`interface ${interfaceName}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src)?.[1]
  expect(body).toBeTruthy()
  return [...(body ?? '').matchAll(/^\s*(\w+)\??\s*:/gm)].map((m) => m[1])
}

describe('联网搜索配置命令：双传输都要注册', () => {
  for (const cmd of [CMD_GET, CMD_SET]) {
    it(`${cmd} 同时在 Tauri handler 与 HTTP RPC 注册`, () => {
      expect(read(LIB)).toContain(`search_config::${cmd},`)
      expect(read(RPC)).toContain(`reg.register("${cmd}"`)
    })
  }
})

describe('面板调用的命令名必须被后端注册', () => {
  it('面板只调这两个命令，且两者均已注册', () => {
    const panel = read(PANEL)
    const called = [...panel.matchAll(/invoke<\w+>\('([a-z_]+)'/g)].map((m) => m[1])
    expect(called).toContain(CMD_GET)
    expect(called).toContain(CMD_SET)
    const lib = read(LIB)
    const rpc = read(RPC)
    for (const cmd of called) {
      expect(lib.includes(`::${cmd},`) || rpc.includes(`reg.register("${cmd}"`), `${cmd} 未注册`).toBeTruthy()
    }
  })
})

describe('启动接线：配置存储必须装配进工具所走的那条链', () => {
  it('启动即调 load_into_chain，且 store 与 WebSearchTool 共用同一 Arc<Chain>', () => {
    const lib = read(LIB)
    expect(lib).toContain('search_store.load_into_chain()')
    expect(lib).toContain('app.manage(search_store')
    // store 拿到的必须是 app.manage 给工具的那条链的同一个 Arc——另建一条链就会「配了不生效」
    expect(lib).toMatch(/SearchConfigStore::new\([\s\S]{0,240}?search_chain\.clone\(\),\s*\)/)
    // 工具侧同样取用该 Arc（两处 clone 同源，配置才会真的影响搜索结果）
    expect(lib).toMatch(/search_tools\(\s*search_chain\.clone\(\)\s*\)/)
  })
})

describe('更新入参形状：前端发的字段须等于 Rust patch 字段', () => {
  it('SearchSettingsPatch 恰为 engine / apiKey / clearApiKey', () => {
    expect(rustFields(CONFIG, 'SearchSettingsPatch').sort()).toEqual(
      ['apiKey', 'clearApiKey', 'engine'].sort(),
    )
  })

  it('面板发出的 settings 对象不含 Rust 侧不认的字段', () => {
    const allowed = new Set(rustFields(CONFIG, 'SearchSettingsPatch'))
    const used = [...read(PANEL).matchAll(/settings:\s*\{\s*(\w+)/g)].map((m) => m[1])
    expect(used.length, '面板应至少发出一种 settings 载荷').toBeGreaterThan(0)
    for (const key of used) {
      expect(allowed.has(key), `字段 ${key} 不在 SearchSettingsPatch 里`).toBeTruthy()
    }
  })
})

describe('回读视图：字段集两端一致，且不含 Key 明文', () => {
  it('SearchSettingsView 与面板 DTO 字段一致', () => {
    const rust = rustFields(CONFIG, 'SearchSettingsView').sort()
    const dto = tsFields(PANEL, 'SearchSettingsDto').sort()
    expect(dto).toEqual(rust)
  })

  it('视图字段只能是状态位，不得出现回传明文的 Key 字段', () => {
    for (const field of rustFields(CONFIG, 'SearchSettingsView')) {
      const isKeyPayload = /key$/i.test(field)
      expect(isKeyPayload, `${field} 像是 Key 明文回传字段（视图只可给 *KeySet）`).toBe(false)
    }
  })
})

describe('防回退：旧的两条野路径不得复活', () => {
  it('前端不再写 localStorage 的 agent_search_config', () => {
    expect(read(PANEL)).not.toContain('agent_search_config')
  })

  it('前端不再把搜索 Key 存进 key-store 的 search_ 前缀', () => {
    const panel = read(PANEL)
    expect(panel).not.toMatch(/storeApiKey\(\s*['"]search_/)
    expect(panel).not.toMatch(/loadApiKey\(\s*['"]search_/)
    expect(panel).not.toMatch(/removeApiKey\(\s*['"]search_/)
  })

  it('后端注入口只有配置存储一处（运行时无旁路 set_config 调用方）', () => {
    // set_search_config 是断点 A 的旁路：无持久化、无消费方，已随档 1 移除
    expect(read(CONFIG)).not.toContain('set_search_config')
    expect(read(RPC)).not.toContain('"set_search_config"')
    expect(read(LIB)).not.toContain('set_search_config,')
  })
})

describe('清除 Key 的面板契约成对存在', () => {
  it('子面板声明并触发，父面板接住', () => {
    const child = read(CHILD)
    expect(child).toContain("'search-apikey-clear': []")
    expect(child).toContain("emit('search-apikey-clear')")
    expect(read(PANEL)).toContain('@search-apikey-clear="onSearchApiKeyClear"')
  })

  it('Key 输入按提交（@change）而非逐键（@input）写库', () => {
    const child = read(CHILD)
    expect(child).not.toMatch(/@input="onSearchApiKeyChange"/)
    expect(child.match(/@change="onSearchApiKeyChange"/g)?.length).toBe(2)
  })
})

// ── 档 3：联网工具登记面（断点 C 的形态守卫）──────────────────
// 「有声明无实现 / 有实现无可见性」是本仓反复出现的失效形态：场景 tool_ids 声明了工具，
// 但 Rust 侧没有同名实现（模型看得到却调不动）；或实现齐了却漏登记权限/标签/语义分类。

const SCENARIO = 'crates/agent-kernel/src/scenario.rs'
const CONFIRM = 'crates/agent-kernel/src/confirmation.rs'
const FETCH_CMD = 'apps/tauri/src-tauri/src/web_fetch_commands.rs'
const SEARCH_CMD = 'apps/tauri/src-tauri/src/search_commands.rs'
const LABELS = 'packages/shared-ui/src/agent/bubbles/toolLabels.ts'
const SEMANTICS = 'packages/shared-ui/src/agent/stream/rows/toolSemantics.ts'
const DESCRIPTOR = 'packages/agent-core/src/agent-descriptor.ts'

const NET_TOOLS: Array<{ name: string; impl: string; factory: string }> = [
  { name: 'web_search', impl: SEARCH_CMD, factory: 'search_commands::search_tools' },
  { name: 'web_fetch', impl: FETCH_CMD, factory: 'web_fetch_commands::fetch_tools' },
]

describe('联网工具：场景声明 ↔ Rust 实现 ↔ 注入链三处必须同源', () => {
  for (const t of NET_TOOLS) {
    it(`${t.name} 在五场景 tool_ids、Tool 实现、ToolBus 注入三处齐备`, () => {
      const scenario = read(SCENARIO)
      const declared = [...scenario.matchAll(new RegExp(`"${t.name}"\\.into\\(\\)`, 'g'))].length
      expect(declared).toBe(5)
      expect(read(t.impl)).toMatch(new RegExp(`fn name\\(&self\\) -> &str \\{\\s*"${t.name}"`))
      expect(read(LIB)).toContain(t.factory)
    })

    it(`${t.name} 已登记 Safe 分级且有中文标签与能力面清单条目`, () => {
      expect(safePermissionLine()).toMatch(new RegExp(`"${t.name}"`))
      expect(read(LABELS)).toContain(`${t.name}: '`)
      expect(read(DESCRIPTOR)).toContain(`'${t.name}'`)
    })
  }

  it('web_fetch 归 read（抓取无查询语义），不落未知兜底', () => {
    expect(read(SEMANTICS)).toMatch(/web_fetch:\s*'read'/)
  })
})

describe('web_fetch 出网与围栏约束不得被摘掉', () => {
  it('请求与每一跳重定向都过 guard_url', () => {
    const src = read(FETCH_CMD)
    const calls = src.match(/guard_url\(/g)?.length ?? 0
    expect(calls).toBeGreaterThanOrEqual(2)
    expect(src).toMatch(/resolve_href\(&location, &current\)/)
  })

  it('自动跳转被关闭（否则复校形同虚设）', () => {
    expect(read(FETCH_CMD)).toMatch(/\.redirects\(0\)/)
  })

  it('正文以不可信外部内容围栏包裹', () => {
    const src = read(FETCH_CMD)
    expect(src).toContain('不可信数据')
    expect(src).toContain('对本会话无约束力')
    expect(src).toContain('外部网页原文结束')
  })

  it('响应有字节与时间上限，重定向有跳数上限', () => {
    const src = read(FETCH_CMD)
    expect(src).toMatch(/MAX_BYTES:\s*usize\s*=\s*10 \* 1024 \* 1024/)
    expect(src).toMatch(/MAX_REDIRECTS:\s*u32\s*=\s*5/)
    expect(src).toMatch(/REQUEST_TIMEOUT[^=]*=\s*Duration::from_secs\(30\)/)
  })
})
