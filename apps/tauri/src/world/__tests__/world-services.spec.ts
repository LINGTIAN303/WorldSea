/**
 * 阶段 2-B · 服务目录：`createWorldServices()` 的方法表与 `requires` 预检链路。
 *
 * 这里测三件**独立**的事：
 * 1. 服务方法表可用（能取到实体/关系/schema/项目/视图），且**返回 store 的响应式引用而非拷贝**；
 * 2. `manifest.requires` 从这个服务列表出发才真正生效——这才是「空间轴」的入口；
 * 3. 真实插件（timeline）声明了依赖，且该声明对得上服务目录。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { assemblePlugins } from '../loader'
import { createWorldServices, WORLD_SERVICE_NAMES } from '../services'
import { entitySchemaRegistry } from '@worldsea/entity-core'

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createWorldServices：服务方法表', () => {
  it('提供 12 个服务，且与 WORLD_SERVICE_NAMES 完全一致', () => {
    const services = createWorldServices()
    expect(Object.keys(services).sort()).toEqual([...WORLD_SERVICE_NAMES].sort())
    expect(WORLD_SERVICE_NAMES).toContain('world.info')
    expect(WORLD_SERVICE_NAMES).toHaveLength(12)
  })

  it('world.projectExtras 直通 entity-core 的两个迁移扩展点注册面，且返回 disposer', () => {
    const extras = (createWorldServices() as Record<string, Record<string, any>>)['world.projectExtras']!
    expect(typeof extras.registerPackSerializer).toBe('function')
    expect(typeof extras.registerProjectExtraProvider).toBe('function')

    // 返回的必须是可调用 disposer（插件交给 ctx.effect 才能回卷）
    const serializer = {
      id: '__svc_test__',
      label: '测试分区',
      dependsOn: [] as string[],
      collect: async () => ({}),
      import: async () => undefined,
    }
    const dispose = extras.registerPackSerializer(serializer)
    expect(typeof dispose).toBe('function')
    expect(() => dispose()).not.toThrow()

    const provider = {
      id: '__svc_test_provider__',
      path: 'settings/__svc_test__.json',
      exportFile: () => null,
      importFile: async () => {},
    }
    const disposeProvider = extras.registerProjectExtraProvider(provider)
    expect(typeof disposeProvider).toBe('function')
    expect(() => disposeProvider()).not.toThrow()
  })

  it('world.entities.list 返回响应式引用而非拷贝（保持既有性能假设）', () => {
    const services = createWorldServices() as Record<string, { list: () => readonly unknown[] }>
    const first = services['world.entities']!.list()
    const second = services['world.entities']!.list()
    // 同一数组引用 = 不是每次新拷贝（96 个文件直访 store 时依赖这一点）
    expect(first).toBe(second)
  })

  it('world.relations 暴露 byEntity（读内存）与 loadByEntity（重载）两个不同语义', () => {
    const relations = (createWorldServices() as Record<string, Record<string, unknown>>)['world.relations']!
    expect(typeof relations.byEntity).toBe('function')
    expect(typeof relations.loadByEntity).toBe('function')
    expect(relations.byEntity).not.toBe(relations.loadByEntity)
  })

  it('world.schema 代理 entitySchemaRegistry 的 list/get/label', () => {
    const schema = (createWorldServices() as Record<string, Record<string, any>>)['world.schema']!
    expect(typeof schema.list).toBe('function')
    expect(typeof schema.get).toBe('function')
    expect(typeof schema.label).toBe('function')
    expect(schema.get('__不存在的类型__')).toBeUndefined()
  })

  it('world.schema.iconName 透传注册表（含用户图标槽位覆写解析）', () => {
    const schema = (createWorldServices() as Record<string, Record<string, (t: string) => string>>)['world.schema']!
    expect(typeof schema.iconName).toBe('function')
    // 未登记类型也应返回兜底图标名而非 undefined（getIconName 内部有 getDefaultIconName 兜底）
    expect(typeof schema.iconName!('__不存在的类型__')).toBe('string')
    expect(schema.iconName!('character')).toBe(entitySchemaRegistry.getIconName('character'))
  })

  it('world.info 携带树的元信息', () => {
    const info = (createWorldServices() as Record<string, Record<string, unknown>>)['world.info']!
    expect(info).toMatchObject({ name: 'WorldSea', tree: 'world', mode: 'browser' })
  })
})

/** 构造装载器候选（`assemblePlugins` 的入参形状）。 */
function makePlugin(id: string, requires?: string[]) {
  return {
    file: `./plugins/${id}/index.ts`,
    plugin: {
      manifest: { id, name: id, version: '1.0.0', description: '依赖预检用', requires },
      apply() {},
    },
  }
}

describe('requires 预检：服务目录让依赖声明真正生效', () => {
  const SERVICES = [...WORLD_SERVICE_NAMES]

  it('声明已提供的服务 → 接受装载', () => {
    const { accepted, report } = assemblePlugins(
      [makePlugin('ws.test.ok', ['world.entities', 'world.relations'])],
      SERVICES,
    )
    expect(report.rejected, '不应被拒').toHaveLength(0)
    expect(accepted.map(p => p.manifest.id)).toEqual(['ws.test.ok'])
  })

  it('声明未提供的服务 → 拒绝且给出可读原因', () => {
    const { accepted, report } = assemblePlugins(
      [makePlugin('ws.test.bad', ['world.nonexistent'])],
      SERVICES,
    )
    expect(accepted).toHaveLength(0)
    expect(report.rejected).toHaveLength(1)
    expect(report.rejected[0]!.reason).toContain('本树未提供依赖服务')
    expect(report.rejected[0]!.reason).toContain('world.nonexistent')
  })

  it('部分满足 → 仍拒（缺一不可）', () => {
    const { report } = assemblePlugins(
      [makePlugin('ws.test.partial', ['world.entities', 'world.missing'])],
      SERVICES,
    )
    expect(report.rejected).toHaveLength(1)
    expect(report.rejected[0]!.reason).toContain('world.missing')
    expect(report.rejected[0]!.reason).not.toContain('world.entities')
  })

  it('不声明 requires → 照常接受（向后兼容）', () => {
    const { accepted, report } = assemblePlugins([makePlugin('ws.test.none')], SERVICES)
    expect(report.rejected).toHaveLength(0)
    expect(accepted).toHaveLength(1)
  })
})

describe('真实插件依赖：timeline 声明 world.projectExtras', () => {
  it('timeline manifest 声明了 world.projectExtras 依赖', async () => {
    // 不 import '../plugins/timeline'：其 TimelineView.vue 会连带拉起重依赖（vitest 并行下超时）。
    // 改为静态读取源码中的 manifest 声明——这正是「声明是什么」的权威来源。
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(join(__dirname, '..', 'plugins', 'timeline', 'index.ts'), 'utf8')
    expect(source).toContain("requires: ['world.projectExtras']")
  })

  it('服务目录里确有该依赖（声明与实际提供对得上）', () => {
    expect(WORLD_SERVICE_NAMES).toContain('world.projectExtras')
  })

  it('装载器：从服务名单里抽掉该服务 → timeline 被拒', () => {
    const services = WORLD_SERVICE_NAMES.filter(n => n !== 'world.projectExtras')
    const { accepted, report } = assemblePlugins(
      [makePlugin('official.timeline', ['world.projectExtras'])],
      [...services],
    )
    expect(accepted).toHaveLength(0)
    expect(report.rejected[0]!.reason).toContain('world.projectExtras')
  })
})

describe('world.settings：只读偏好，不转发整个 store', () => {
  it('暴露的正是消费方实际读取的 5 个字段', () => {
    const settings = (createWorldServices() as Record<string, Record<string, unknown>>)['world.settings']!
    expect(Object.keys(settings).sort()).toEqual([
      'autoCreateEntityEnabled',
      'autoCreateEntityRefEnabled',
      'autoCreateSelectorEnabled',
      'graphBackgroundMode',
      'panelLimitEnabled',
    ])
  })

  it('取值来自 settingsStore（非写死的默认值）', () => {
    const settings = (createWorldServices() as Record<string, Record<string, () => unknown>>)['world.settings']!
    // 读的是 store 当前值：类型与 store 声明一致即可；此处断言可调用且非 undefined
    expect(typeof settings.panelLimitEnabled!()).toBe('boolean')
    expect(typeof settings.graphBackgroundMode!()).toBe('string')
  })

  it('未暴露 store 的敏感面（模型密钥 / provider / AI 端点）', () => {
    const settings = (createWorldServices() as Record<string, Record<string, unknown>>)['world.settings']!
    for (const forbidden of ['aiCloudKey', 'customProviders', 'getCustomKeyStoreId', 'aiLocalEndpoint', 'agentBackend']) {
      expect(settings).not.toHaveProperty(forbidden)
    }
  })
})

describe('world.ui：导航意图，不传组件对象', () => {
  it('暴露 6 个方法，且不含任何组件相关字段', () => {
    const ui = (createWorldServices() as Record<string, Record<string, unknown>>)['world.ui']!
    expect(Object.keys(ui).sort()).toEqual([
      'currentView',
      'navigateTo',
      'selectEntity',
      'selectedEntityId',
      'setJumpBackViewId',
      'setSettingsTarget',
    ])
    // 组件引用不得跨服务传递：viewComponent 由 uiStore.showView 内部维护
    for (const forbidden of ['viewComponent', 'showView', 'viewRefreshKey', 'views']) {
      expect(ui).not.toHaveProperty(forbidden)
    }
  })

  it('navigateTo 只设 currentView，不传组件（由 ViewContainer 解析）', () => {
    const ui = (createWorldServices() as Record<string, Record<string, (id: string) => void>>)['world.ui']!
    expect(ui.navigateTo!.length).toBe(1) // 单参 = 只有 viewId
  })
})

describe('world.font / world.fontLibrary：只给「有效字体」，不给 prefs 整包', () => {
  it('world.font 暴露 3 个方法，且不含 prefs / setLayerFont 等写面', () => {
    const font = (createWorldServices() as Record<string, Record<string, unknown>>)['world.font']!
    expect(Object.keys(font).sort()).toEqual(['exportFamily', 'family', 'uiScale'])
    for (const forbidden of ['prefs', 'setLayerFont', 'setLayerVariant', 'resetLayer', 'reapplyAll']) {
      expect(font).not.toHaveProperty(forbidden)
    }
  })

  it('exportFamily 单点实现回落链（preview → content → 兜底），避免两处各写一份', () => {
    const font = (createWorldServices() as Record<string, Record<string, (fb?: string) => string>>)['world.font']!
    // 无自定义字体时落到兜底；自定义形参生效
    expect(typeof font.exportFamily!('__fallback__')).toBe('string')
    expect(font.exportFamily!('__fallback__').length).toBeGreaterThan(0)
  })

  it('family 接受任意层，未设置返回空串而非 undefined', () => {
    const font = (createWorldServices() as Record<string, Record<string, (l: string) => string>>)['world.font']!
    for (const layer of ['chrome', 'editorUi', 'content', 'preview', 'canvas', 'agent']) {
      expect(typeof font.family!(layer)).toBe('string')
    }
  })

  it('world.fontLibrary 只暴露只读清单，不含增删与容量管理', () => {
    const lib = (createWorldServices() as Record<string, Record<string, unknown>>)['world.fontLibrary']!
    expect(Object.keys(lib)).toEqual(['list'])
    for (const forbidden of ['addEntry', 'removeEntry', 'totalSize', 'isOverCapacity', 'restoreAllFonts']) {
      expect(lib).not.toHaveProperty(forbidden)
    }
  })
})

describe('world.trash：只给「用户能做的三件事」，不暴露管线内部写入口', () => {
  it('暴露 5 个成员：2 个只读投影 + 3 个语义动作', () => {
    const trash = (createWorldServices() as Record<string, Record<string, unknown>>)['world.trash']!
    expect(Object.keys(trash).sort()).toEqual([
      'emptyTrash',
      'entityItems',
      'permanentDeleteEntity',
      'restoreEntity',
      'totalCount',
    ])
  })

  it('不暴露 store 的 add（删除管线内部写入口，插件不得自造回收站条目）', () => {
    const trash = (createWorldServices() as Record<string, Record<string, unknown>>)['world.trash']!
    expect(trash).not.toHaveProperty('add')
  })

  it('不暴露半步操作 restore / permanentDelete（只动回收站、不碰磁盘与实体表）', () => {
    const trash = (createWorldServices() as Record<string, Record<string, unknown>>)['world.trash']!
    // 用 useTrash 的编排替换，故同名裸方法不得出现
    expect(trash).not.toHaveProperty('restore')
    expect(trash).not.toHaveProperty('permanentDelete')
    expect(trash.restoreEntity).not.toBe(trash.permanentDeleteEntity)
  })

  it('只读投影读 store 当前值：空回收站下 entityItems 为空、totalCount 为 0', () => {
    const trash = (createWorldServices() as Record<string, Record<string, () => unknown>>)['world.trash']!
    expect(trash.entityItems!()).toEqual([])
    expect(trash.totalCount!()).toBe(0)
  })

  it('computed 包成方法后仍保持响应式（模板里 {{ trash.totalCount() }} 能追踪到）', async () => {
    const { computed, nextTick } = await import('vue')
    const trash = (createWorldServices() as Record<string, Record<string, () => unknown>>)['world.trash']!
    const count = computed(() => trash.totalCount!() as number)
    expect(count.value).toBe(0)

    const { useTrashStore } = await import('@worldsea/entity-core')
    useTrashStore().add({
      id: 'trash_entity_svc_probe',
      entityType: 'entity',
      data: { id: 'svc_probe', type: 'character', properties: {} } as never,
      deletedAt: new Date().toISOString(),
      deletedBy: 'user',
    })
    await nextTick()
    expect(count.value, 'computed 未追踪到 store 变更').toBe(1)

    useTrashStore().emptyTrash()
    await nextTick()
    expect(count.value).toBe(0)
  })
})
