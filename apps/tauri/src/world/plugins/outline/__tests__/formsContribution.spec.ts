/**
 * outline 的表现形式贡献位接入测试（第 6 贡献位）。
 *
 * 验的是「outline 真的把 11 种表现形式交给平台了」，而不是「它内部注册表里有 11 条」。
 * 两者差别就是这次提升的全部意义：内部注册表外界看不见、不随插件启停；
 * 平台贡献位带 pluginId，插件卸载能精确回卷。
 *
 * 不 import outline 的 `apply`（会连带拉起 BoardView 整条渲染链，vitest 并行下超时），
 * 改为直接调 `publishFormsToPluginApi` 并把 `api.registerForm` 换成记录器。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { formRegistry } from '@worldsea/entity-core/core'
import type { FormDefinition } from '@worldsea/entity-core/core'

import { publishFormsToPluginApi, resetFormsInitialization } from '../board/forms/initializeForms'

beforeEach(() => {
  formRegistry.clear()
  resetFormsInitialization()
})

describe('outline 表现形式 → 平台贡献位', () => {
  it('11 种表现形式全部经 api.registerForm 交给平台', () => {
    const published: FormDefinition[] = []
    publishFormsToPluginApi({ registerForm: (def: FormDefinition) => { published.push(def) } })

    expect(published).toHaveLength(11)
    expect(published.map(d => d.form).sort()).toEqual(
      ['card', 'paragraph', 'progress', 'question', 'refs', 'script', 'sentence', 'storyline', 'table', 'title', 'tree'],
    )
  })

  it('每个形式都带完整定义（label / icon / kind / component / configSchema）', () => {
    const published: FormDefinition[] = []
    publishFormsToPluginApi({ registerForm: (def: FormDefinition) => { published.push(def) } })

    for (const def of published) {
      expect(def.label, `${def.form} 缺 label`).toBeTruthy()
      expect(def.icon, `${def.form} 缺 icon`).toBeTruthy()
      expect(['inline', 'derived'], `${def.form} kind 非法`).toContain(def.kind)
      expect(def.component, `${def.form} 缺 component`).toBeTruthy()
      expect(Array.isArray(def.configSchema), `${def.form} configSchema 非数组`).toBe(true)
    }
  })

  it('幂等：重复调用不会让平台注册表膨胀（注册表本身去重）', () => {
    // 走真实平台注册（模拟 PluginAPI 回填 pluginId），连调两次
    const api = {
      registerForm: (def: FormDefinition) =>
        formRegistry.register({ ...def, pluginId: 'official.outline' }),
    }
    publishFormsToPluginApi(api)
    publishFormsToPluginApi(api)

    // 第二次调用时 initializeForms 已 initialized，只重放同样 11 条 → 注册表幂等仍 11 条
    expect(formRegistry.getAll()).toHaveLength(11)
  })

  it('经真实平台注册后，能按插件回卷（这是贡献位成立的关键）', () => {
    publishFormsToPluginApi({
      registerForm: (def: FormDefinition) => formRegistry.register({ ...def, pluginId: 'official.outline' }),
    })
    expect(formRegistry.getAll()).toHaveLength(11)

    const removed = formRegistry.unregisterByPlugin('official.outline')

    expect(removed).toBe(11)
    expect(formRegistry.getAll()).toHaveLength(0)
  })
})
