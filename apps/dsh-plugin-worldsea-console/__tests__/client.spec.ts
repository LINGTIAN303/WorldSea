// @vitest-environment jsdom
/**
 * console 客户端的**跨插件绑定接线**（D3-c2，2026-09-30）。
 *
 * 这里只测「**我方**的接线与契约」，不测上游件的行为（`SettingsFormModel`/`SettingsForm` 由
 * ui-primitives 拥有、上游自测；真 React 渲染在浏览器里发生，本仓无 react 依赖——视觉与交互
 * 归真机走查）。所以桩只打在两处**框架边界**：`react` 与 `@deepseek-ai/dsh-client-ui-primitives`；
 * `lib/client.js` 用真实文件装载（`window.__ModuleLoader__` 假装载器 + 假 require）。
 *
 * 钉住的契约（任一侧漂移即静默断链）：
 * ① 入口插件须 `inject` `configForms`，否则拿不到配置句柄；
 * ② 绑定的命名空间必须是宿主插件在 `cordis.patch.yml` 里的**条目 id**（`worldsea`）；
 * ③ 字段名必须是宿主 `Config` 的两个键（`dshHome` / `dataRoot`）。
 * ②③ 直接与宿主侧真源对读（读 patch 行、导入真 `Config`），不是复述字符串。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { Config } from '../../dsh-plugin-worldsea/lib/index.js'

const SOURCE = readFileSync(join(process.cwd(), 'apps/dsh-plugin-worldsea-console/lib/client.js'), 'utf8')
const PATCH = readFileSync(join(process.cwd(), 'apps/dsh-plugin-worldsea/cordis.patch.yml'), 'utf8')

interface ModuleFace {
  name: string
  inject: string[]
  apply: (ctx: unknown) => void
}

interface CapturedSpec { field: string }

let capturedScope: unknown
let capturedSpecs: CapturedSpec[] = []

const reactStub = {
  createElement: () => null,
  useState: (initial: unknown) => [initial, () => {}],
  useEffect: () => {},
}

const primitivesStub = {
  Switch: () => null,
  SegmentedControl: () => null,
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

/** 最小假 ctx：只提供 client.js 用到的服务边界。 */
function applyModule(): { getCalls: string[], face: () => Record<string, unknown>, registered: Record<string, unknown> } {
  const getCalls: string[] = []
  const scope = { fakeScope: true }
  let captured: { def: unknown, component: unknown } | undefined
  const ctx = {
    effect: (fn: () => unknown) => fn(),
    locale: { register: () => {}, bind: () => (key: string) => key },
    slots: {
      inject: (_name: string, fn: () => void) => fn(),
      register: (def: unknown, component: unknown) => { captured = { def, component } },
    },
    configForms: { get: (ns: string) => { getCalls.push(ns); return scope } },
  }
  capturedScope = undefined
  capturedSpecs = []
  loadModule().apply(ctx)
  if (captured === undefined) throw new Error('未注册 settings.plugins.tab')
  const def = captured.def as { inject?: () => Record<string, unknown> }
  return { getCalls, face: () => def.inject?.() ?? {}, registered: captured }
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

describe('console 客户端：跨插件 config 绑定接线（D3-c2）', () => {
  it('inject 声明 configForms（拿配置句柄的前提）', () => {
    expect(loadModule().inject).toContain('configForms')
  })

  it('绑定宿主插件条目 id 的命名空间，并把两个字段交给表单模型', () => {
    const { getCalls } = applyModule()
    expect(getCalls).toEqual(['worldsea'])
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

  it('跨文件契约：命名空间 == 宿主 patch 行的条目 id', () => {
    const { getCalls } = applyModule()
    const rowIds = [...PATCH.matchAll(/^\s*-\s*id:\s*(\S+)\s*$/gm)].map(match => match[1])
    expect(rowIds).toContain(getCalls[0])
  })

  it('跨文件契约：字段名 == 宿主 Config 的键', () => {
    applyModule()
    expect(capturedSpecs.map(spec => spec.field).sort()).toEqual(hostConfigFields())
  })
})
