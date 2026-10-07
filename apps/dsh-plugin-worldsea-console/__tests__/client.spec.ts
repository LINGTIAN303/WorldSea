// @vitest-environment jsdom
/**
 * console 客户端的**双槽位接线**（2026-10-07 拆分形态）：
 * ① `settings.plugins.tab`「WorldSea 插件」——插件卡片清单，worldsea 工具插件卡片内嵌数据面配置；
 * ② `settings.section`「WorldSea 产品域」——交界配置独立设置页。
 *
 * 这里只测「**我方**的接线与契约」，不测上游件的行为（`SettingsFormModel`/`SettingsForm` 由
 * ui-primitives 拥有、上游自测；真 React 渲染在浏览器里发生，本仓无 react 依赖——视觉与交互
 * 归真机走查）。所以桩只打在两处**框架边界**：`react` 与 `@deepseek-ai/dsh-client-ui-primitives`；
 * `lib/client.js` 用真实文件装载（`window.__ModuleLoader__` 假装载器 + 假 require）。
 *
 * 钉住的契约（任一侧漂移即静默断链）：
 * ① 入口插件须 `inject` `configForms`，否则拿不到配置句柄；
 * ② 绑定的命名空间必须是**本插件**在 `cordis.patch.yml` 里的**条目 id**（`worldsea-console`）
 *    ——worldsea 工具插件预设化后数据面真源移到本插件（预设子条目不在设置面枚举范围）；
 * ③ 字段名必须是宿主 `Config` 的两个键（`dshHome` / `dataRoot`）。
 * ②③ 直接与真源对读（读 patch 行、导入真 `Config`），不是复述字符串。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { Config } from '../../dsh-plugin-worldsea-console/lib/index.js'

const SOURCE = readFileSync(join(process.cwd(), 'apps/dsh-plugin-worldsea-console/lib/client.js'), 'utf8')
const PATCH = readFileSync(join(process.cwd(), 'apps/dsh-plugin-worldsea-console/cordis.patch.yml'), 'utf8')

interface ModuleFace {
  name: string
  inject: string[]
  apply: (ctx: unknown) => void
}

interface CapturedSpec { field: string }

let capturedScope: unknown
let capturedSpecs: CapturedSpec[] = []

interface TreeNode {
  type: unknown
  props: Record<string, unknown>
  children: unknown[]
}

// 渲染期钩子的最小模拟：cells 跨「多帧」保留（我们手动重复调用组件函数模拟重渲染），
// effect 收集后由渲染助手显式跑一次；setter 支持函数式更新（卡片展开切换用到）。
let hookCells: unknown[] = []
let hookIndex = 0
let pendingEffects: Array<() => void> = []

const reactStub = {
  createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): TreeNode => ({
    type,
    props: props ?? {},
    children: children.flat(),
  }),
  useState: (initial: unknown) => {
    const cell = hookIndex++
    if (!(cell in hookCells)) hookCells[cell] = initial
    return [hookCells[cell], (next: unknown) => {
      hookCells[cell] = typeof next === 'function' ? (next as (current: unknown) => unknown)(hookCells[cell]) : next
    }]
  },
  useEffect: (effect: () => void) => { pendingEffects.push(effect) },
}

const primitivesStub = {
  Switch: () => null,
  SegmentedControl: () => null,
  Tag: () => null,
  IconChevronDownOutlineRegular: () => null,
  IconGlobeOutlineRegular: () => null,
  Modal: () => null,
  SettingsForm: () => null,
  SettingsValueField: () => null,
  /** 只回声字段名——被断言的是「我方传了什么」，上游模型的行为不在此测。 */
  settingsTextField: (field: string): CapturedSpec => ({ field, format: String, parse: () => undefined }),
  SettingsFormModel: class {
    constructor(scope: unknown, specs: CapturedSpec[]) {
      capturedScope = scope
      capturedSpecs = specs
    }
    bind() { return { fakeStore: true } }
    shell() { return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false } }
    field() { return { text: '', overridden: false, invalid: false } }
    actions() { return { edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {} } }
    dispose() {}
  },
}

/** 装载真实 client.js（只伪造装载器与框架边界件）。 */
function loadModule(): ModuleFace {
  let loaded: ModuleFace | undefined
  const fakeRequire = (id: string): unknown => {
    if (id === 'react') return reactStub
    if (id === '@deepseek-ai/dsh-client-store') return { createSnapshotStore: (initial: unknown) => createFakeStore(initial) }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
    throw new Error(`未预期的 require：${id}`)
  }
  const fakeWindow = {
    __ModuleLoader__: {
      load: (entry: { factory: (require: (id: string) => unknown) => ModuleFace }) => {
        loaded = entry.factory(fakeRequire)
      },
    },
  }
  new Function('window', SOURCE)(fakeWindow)
  if (loaded === undefined) throw new Error('client.js 未调用 window.__ModuleLoader__.load')
  return loaded
}

/** 快照 store 的最小模拟（set/getSnapshot/subscribe）。 */
function createFakeStore(initial: unknown): { set: (value: unknown) => void, getSnapshot: () => unknown, subscribe: () => () => void } {
  let value = initial
  return {
    set: (next: unknown) => { value = next },
    getSnapshot: () => value,
    subscribe: () => () => {},
  }
}

interface Registration { def: Record<string, unknown>, component: unknown }

/** 最小假 ctx：只提供 client.js 用到的服务边界；按槽位名收下注册。 */
function applyModule(): {
  getCalls: string[]
  face: () => Record<string, unknown>
  registered: Record<string, Registration>
  commandContributions: Array<Record<string, unknown>>
} {
  const getCalls: string[] = []
  const scope = { fakeScope: true }
  const registered: Record<string, Registration> = {}
  const commandContributions: Array<Record<string, unknown>> = []
  const ctx = {
    effect: (fn: () => unknown) => fn(),
    locale: { register: () => {}, bind: () => (key: string) => key },
    slots: {
      inject: (_name: string, fn: () => void) => fn(),
      register: (def: { name: string }, component: unknown) => {
        registered[def.name] = { def, component }
      },
    },
    configForms: { get: (ns: string) => { getCalls.push(ns); return scope } },
    commandUi: { register: (contribution: Record<string, unknown>) => { commandContributions.push(contribution); return () => {} } },
  }
  capturedScope = undefined
  capturedSpecs = []
  loadModule().apply(ctx)
  if (registered['settings.plugins.tab'] === undefined) throw new Error('未注册 settings.plugins.tab')
  if (registered['settings.section'] === undefined) throw new Error('未注册 settings.section')
  if (registered['shell.overlay'] === undefined) throw new Error('未注册 shell.overlay')
  const tabDef = registered['settings.plugins.tab']!.def as { inject?: () => Record<string, unknown> }
  return { getCalls, face: () => tabDef.inject?.() ?? {}, registered, commandContributions }
}

/** 宿主 Config 的键（走真 schema，不读源码字符串）。 */
function hostConfigFields(): string[] {
  const json = Config.toJSON() as {
    uid: number | string
    refs: Record<string, { dict?: Record<string, number | string> }>
  }
  const root = json.refs[String(json.uid)]
  return Object.keys(root.dict ?? {}).sort()
}

const FAKE_HOME = String.raw`C:\Users\tester\AppData\Roaming\worldsea\dsh-home`

/** 采集这些 props 的字符串值（桩不调用函数组件，SettingsValueField/SwitchRow 的文案在 props 里）。 */
const COLLECTED_PROPS = ['label', 'hint', 'placeholder'] as const

/** 树节点的全部字符串（含嵌套子数组与白名单 props）。 */
function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out)
    return out
  }
  if (node !== null && typeof node === 'object') {
    const candidate = node as TreeNode
    for (const key of COLLECTED_PROPS) {
      const value = candidate.props?.[key]
      if (typeof value === 'string') out.push(value)
    }
    for (const child of candidate.children ?? []) collectStrings(child, out)
  }
  return out
}

/** 深度优先找第一个满足谓词的节点。 */
function findNode(node: unknown, predicate: (candidate: TreeNode) => boolean): TreeNode | undefined {
  if (node === null || typeof node !== 'object') return undefined
  const candidate = node as TreeNode
  if (candidate.props !== undefined && predicate(candidate)) return candidate
  for (const child of candidate.children ?? []) {
    const found = findNode(child, predicate)
    if (found !== undefined) return found
  }
  return undefined
}

/** 点开一张插件卡片（调用卡片按钮的 onClick，随后由调用方重渲染）。 */
function clickCard(tree: TreeNode, entryId: string): void {
  const card = findNode(tree, (node) => node.props['data-plugin-entry'] === entryId)
  if (card === undefined) throw new Error(`未找到卡片：${entryId}`)
  const button = card.children.find((child) => (child as TreeNode | null)?.type === 'button') as TreeNode | undefined
  const onClick = button?.props['onClick'] as (() => void) | undefined
  if (typeof onClick !== 'function') throw new Error(`卡片 ${entryId} 的按钮缺 onClick`)
  onClick()
}

interface RenderOptions {
  /** 壳注入的 __WORLDSEA_DSH_HOME__；null/缺省 = 非壳环境（无该全局）。 */
  shellHome?: string | null
  /** dshHome 字段是否「覆盖中」。 */
  overridden?: boolean
}

const FAKE_PREFS = { manualGeneration: true, agentsPointer: false, snapshotExport: 'auto' }

/** 挂全局 IPC 与壳常量；返回卸载函数。 */
function installGlobals(options: RenderOptions): () => void {
  const globals = globalThis as Record<string, unknown>
  if (options.shellHome == null) delete globals.__WORLDSEA_DSH_HOME__
  else globals.__WORLDSEA_DSH_HOME__ = options.shellHome
  globals.__TAURI_INTERNALS__ = {
    invoke: (command: string) => Promise.resolve(command === 'cmd_product_prefs_get' ? FAKE_PREFS : {}),
  }
  return () => {
    delete globals.__TAURI_INTERNALS__
    delete globals.__WORLDSEA_DSH_HOME__
  }
}

/** 渲染一帧 + 跑 effect + 冲 Promise 微任务 + 再渲染一帧（等 prefs/挂载态落定）。 */
async function settle(render: () => TreeNode): Promise<TreeNode> {
  render()
  for (const effect of pendingEffects) effect()
  await Promise.resolve()
  await Promise.resolve()
  return render()
}

/**
 * 渲染「WorldSea 插件」标签页：可选先点开一张卡片（配置表单收在卡片内）。
 */
async function renderPluginsTab(options: RenderOptions & { expand?: string } = {}): Promise<TreeNode> {
  hookCells = []
  pendingEffects = []
  const uninstall = installGlobals(options)
  try {
    const { registered } = applyModule()
    const component = registered['settings.plugins.tab']!.component as (props: Record<string, unknown>) => TreeNode
    const snapshot = {
      available: true,
      writable: true,
      dirty: false,
      invalid: false,
      saving: false,
      failed: false,
      pluginStatus: 'ready',
      dshHome: { text: '', overridden: options.overridden === true, invalid: false },
      dataRoot: { text: '', overridden: false, invalid: false },
    }
    const props = {
      useDataFace: (select: (state: unknown) => unknown) => select(snapshot),
      save: () => {},
      edit: () => {},
      resetField: () => {},
      discard: () => {},
    }
    const render = (): TreeNode => {
      hookIndex = 0
      return component(props)
    }
    let tree = await settle(render)
    if (typeof options.expand === 'string') {
      clickCard(tree, options.expand)
      tree = render()
    }
    return tree
  } finally {
    uninstall()
  }
}

/** 渲染「WorldSea 产品域」独立分区（等 cmd_product_prefs_get 落定）。 */
async function renderSection(): Promise<TreeNode> {
  hookCells = []
  pendingEffects = []
  const globals = globalThis as Record<string, unknown>
  globals.__TAURI_INTERNALS__ = {
    invoke: (command: string) => Promise.resolve(command === 'cmd_product_prefs_get' ? FAKE_PREFS : {}),
  }
  try {
    const { registered } = applyModule()
    const component = registered['settings.section']!.component as (props: Record<string, unknown>) => TreeNode
    const render = (): TreeNode => {
      hookIndex = 0
      return component({})
    }
    return await settle(render)
  } finally {
    delete globals.__TAURI_INTERNALS__
  }
}

describe('console 客户端：双槽位接线与跨插件契约（2026-10-07）', () => {
  it('inject 声明 configForms（拿配置句柄的前提）', () => {
    expect(loadModule().inject).toContain('configForms')
  })

  it('inject 声明 commandUi，/entity 注册为客户端贡献位（name + 中文名 label + 短提示 + 图标 + action）', () => {
    expect(loadModule().inject).toContain('commandUi')
    const { commandContributions } = applyModule()
    expect(commandContributions).toHaveLength(1)
    const contribution = commandContributions[0] as {
      name: string
      label: () => string
      description: () => string
      icon: unknown
      available: () => boolean
      ui: { kind: string, run: () => void }
    }
    expect(contribution.name).toBe('entity')
    expect(contribution.label()).toBe('entityMenuLabel')
    expect(contribution.description()).toBe('entityMenuHint')
    expect(contribution.icon).toBeTypeOf('function')
    expect(contribution.available()).toBe(true)
    expect(contribution.ui.kind).toBe('action')
    expect(contribution.ui.run).toBeTypeOf('function')
  })

  it('Tab 注册在 settings.plugins.tab，id 保持 worldsea-console', () => {
    const { registered } = applyModule()
    expect(registered['settings.plugins.tab']!.def['id']).toBe('worldsea-console')
  })

  it('分区注册在 settings.section，id worldsea-product、order 25（排在内置四页之后）', () => {
    const { registered } = applyModule()
    const def = registered['settings.section']!.def
    expect(def['id']).toBe('worldsea-product')
    expect(def['order']).toBe(25)
    expect(def['label']).toBeTypeOf('function')
  })

  it('绑定本插件条目 id 的命名空间，并把两个字段交给表单模型', () => {
    const { getCalls } = applyModule()
    expect(getCalls).toEqual(['worldsea-console'])
    expect(capturedScope).toEqual({ fakeScope: true })
    expect(capturedSpecs.map(spec => spec.field).sort()).toEqual(['dataRoot', 'dshHome'])
  })

  it('渲染面拿到 hooks（快照座位）与表单动作（scope 真穿到组件）', () => {
    const { face } = applyModule()
    const injected = face()
    expect(injected.hooks).toBeTruthy()
    expect(typeof injected.save).toBe('function')
    expect(typeof injected.edit).toBe('function')
    expect(typeof injected.discard).toBe('function')
  })

  it('跨文件契约：命名空间 == 本插件 patch 行的条目 id', () => {
    const { getCalls } = applyModule()
    const rowIds = [...PATCH.matchAll(/^\s*-\s*id:\s*(\S+)\s*$/gm)].map(match => match[1])
    expect(rowIds).toContain(getCalls[0])
  })

  it('跨文件契约：字段名 == 宿主 Config 的键', () => {
    applyModule()
    expect(capturedSpecs.map(spec => spec.field).sort()).toEqual(hostConfigFields())
  })
})

describe('console 客户端：插件卡片清单（WorldSea 插件 Tab）', () => {
  it('收起态：两卡片标题与描述可见，数据面配置不出现', async () => {
    const strings = collectStrings(await renderPluginsTab())
    expect(strings).toContain('pluginsTitle')
    expect(strings).toContain('toolPluginTitle')
    expect(strings).toContain('consolePluginTitle')
    expect(strings).toContain('toolPluginDesc')
    expect(strings).toContain('consolePluginDesc')
    expect(strings).not.toContain('dshHome')
    expect(strings).not.toContain('dataRoot')
  })

  it('展开 worldsea 卡片：详情含条目/模块/工具事实与数据面配置', async () => {
    const strings = collectStrings(await renderPluginsTab({ expand: 'worldsea' }))
    expect(strings).toContain('dataFace')
    expect(strings).toContain('dshHome')
    expect(strings).toContain('dataRoot')
    expect(strings).toContain('worldsea')
    expect(strings).toContain('dsh-plugin-worldsea')
    expect(strings).toContain('toolsFactValue')
    expect(strings).toContain('presetFactValue')
  })

  it('展开 worldsea-console 卡片：只有事实行，无配置表单', async () => {
    const strings = collectStrings(await renderPluginsTab({ expand: 'worldsea-console' }))
    expect(strings).toContain('worldsea-console')
    expect(strings).not.toContain('dataFace')
  })

  it('未覆盖且有壳注入常量时，展开卡片渲染出「缺省生效值：<路径>」行（D3-c2b 延续）', async () => {
    const strings = collectStrings(await renderPluginsTab({ shellHome: FAKE_HOME, expand: 'worldsea' }))
    expect(strings).toContain(`dshHomeDefault${FAKE_HOME}`)
  })

  it('覆盖中时不显示缺省行（覆盖值才是当前读法）', async () => {
    const strings = collectStrings(await renderPluginsTab({ shellHome: FAKE_HOME, overridden: true, expand: 'worldsea' }))
    expect(strings.some(text => text.includes(FAKE_HOME))).toBe(false)
  })

  it('壳未注入常量（非壳环境）时不显示缺省行', async () => {
    const strings = collectStrings(await renderPluginsTab({ shellHome: null, expand: 'worldsea' }))
    expect(strings.some(text => text.includes('dshHomeDefault'))).toBe(false)
  })
})

describe('console 客户端：交界配置独立分区（WorldSea 产品域）', () => {
  it('渲染三组交界配置，且插件数据面已迁出（不在本页）', async () => {
    const strings = collectStrings(await renderSection())
    expect(strings).toContain('title')
    expect(strings).toContain('manualGeneration')
    expect(strings).toContain('agentsPointer')
    expect(strings).toContain('snapshotExport')
    expect(strings).not.toContain('dataFace')
    expect(strings).not.toContain('dshHome')
  })

  it('非桌面壳环境（无 Tauri IPC）显示降级提示', () => {
    hookCells = []
    pendingEffects = []
    const { registered } = applyModule()
    const component = registered['settings.section']!.component as (props: Record<string, unknown>) => TreeNode
    const render = (): TreeNode => {
      hookIndex = 0
      return component({})
    }
    const strings = collectStrings(render())
    expect(strings).toContain('notTauri')
  })
})