import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { entitySchemaRegistry, fieldRegistry, useEntityStore, useUIStore } from '@worldsea/entity-core'
import type { Entity, PluginView } from '@worldsea/entity-core'
import { homeLoadGate, useHomeData, waitUntilIdle } from '../useHomeData'

const project = ref<{ id: string; name: string; isDefault?: boolean } | null>({ id: 'p1', name: '纯真' })
let viewsFixture: PluginView[] = []

vi.mock('@/composables/useProjectSwitcher', () => ({
  useProjectSwitcher: () => ({ currentProject: project }),
}))
vi.mock('@/world', () => ({
  availablePlugins: () => [{
    manifest: {
      id: 'official.characters', name: '角色', version: '1.0.0', description: '',
      domain: 'life', kind: 'sprout', entityTypes: ['character'],
    },
    apply: () => {},
  }],
}))
vi.mock('@/ui/layout/sidebar/viewOrder', () => ({
  allVisibleViewsInSidebarOrder: () => viewsFixture,
}))
vi.mock('@/world/plugins/field-matrix/composables/useFieldMatrixData', async () => {
  const { ref: vueRef } = await import('vue')
  return {
    useFieldMatrixData: () => ({
      model: vueRef({
        entities: [], traits: [], facets: [], relations: [], views: [],
        stats: { buds: 27, entities: 0, instances: 0, keys: 0, traits: 0, facets: 0 },
      }),
    }),
  }
})

function character(id: string, updatedAt: string): Entity {
  return { id, type: 'character', name: id, description: '', properties: {}, tags: [], createdAt: updatedAt, updatedAt }
}

function view(id: string, label: string, pluginId: string): PluginView {
  return { id, label, icon: 'character', component: {} as never, pluginId }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  project.value = { id: 'p1', name: '纯真' }
  viewsFixture = []
  entitySchemaRegistry.clear()
  useUIStore().markReady()
})

describe('useHomeData/waitUntilIdle', () => {
  it('flag 变 false 后才 resolve', async () => {
    const flag = ref(true)
    let done = false
    const p = waitUntilIdle(() => flag.value).then(() => { done = true })
    await nextTick()
    expect(done).toBe(false)
    flag.value = false
    await nextTick()
    await p
    expect(done).toBe(true)
  })
})

describe('useHomeData/homeLoadGate', () => {
  it('启动中等待、启动失败报错、就绪且后端就绪才允许兜底装载', () => {
    expect(homeLoadGate('booting', false)).toBe('wait-boot')
    expect(homeLoadGate('booting', true)).toBe('wait-boot')
    expect(homeLoadGate('error', true)).toBe('boot-error')
    expect(homeLoadGate('ready', true)).toBe('load')
    // 就绪但文件后端未绑项目（浏览器预览）：只用内存态，不兜底 loadAll
    expect(homeLoadGate('ready', false)).toBe('read-only')
  })
})

describe('useHomeData/Schema 响应式透镜', () => {
  it('首屏先算（schema 未注册）后注册 schema/视图，data 会重算并补出最近动态', async () => {
    const entityStore = useEntityStore()
    entityStore.entities.push(character('c1', '2026-10-23T10:00:00.000Z'))

    let home!: ReturnType<typeof useHomeData>
    const Probe = defineComponent({
      setup() {
        home = useHomeData()
        return () => null
      },
    })
    mount(Probe)
    await flushPromises()

    // 方案 A：此时 schema / 视图都没注册（冷启动 HomeSurface 先挂载的真实时序）——
    // 域卡仍能靠内置兜底表计数，但没有视图映射：最近动态空、域卡无可进入视图
    expect(home.data.value?.snapshot.entityCount).toBe(1)
    expect(home.data.value?.recent).toEqual([])
    expect(home.data.value?.domains.find(d => d.id === 'life')?.firstViewId).toBeNull()
    expect(home.data.value?.continueTarget).toBeNull()

    // 方案 B：installWorldTree 之后 schema 与视图注册完成
    entitySchemaRegistry.register({ typeKey: 'character', label: '角色', icon: 'character', fields: [], pluginId: 'official.characters' })
    fieldRegistry.registerBuiltin('character', []) // 只借它 bump version，模拟插件注册
    viewsFixture = [view('characters', '角色', 'official.characters')]
    await nextTick()

    expect(home.data.value?.recent.map(e => e.name)).toEqual(['c1'])
    expect(home.data.value?.domains.find(d => d.id === 'life')?.entityCount).toBe(1)
    expect(home.data.value?.domains.find(d => d.id === 'life')?.firstViewId).toBe('characters')
    expect(home.data.value?.continueTarget?.viewId).toBe('characters')
  })
})
