/**
 * settingsStore 图谱底色字段。
 * persistedRef 模式契约：默认 'dark'（深色星图）；赋值即落 localStorage（`worldsea_graph_background`，watch 走微任务调度）；重开（新 pinia）读回。
 * 落 localStorage 的 store ⇒ spec 必清（既有纪律）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '../settingsStore'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('settingsStore / 图谱底色（批 D）', () => {
  it('默认「深色星图」；改「跟随主题」落盘并可读回', async () => {
    const store = useSettingsStore()
    expect(store.graphBackgroundMode).toBe('dark')

    store.graphBackgroundMode = 'theme'
    await nextTick()
    expect(localStorage.getItem('worldsea_graph_background')).toBe('theme')

    // 模拟重开：新 pinia 实例（持久层已有值）
    setActivePinia(createPinia())
    expect(useSettingsStore().graphBackgroundMode).toBe('theme')
  })
})

describe('settingsStore / 外部插件清单对账（批1）', () => {
  it('sync 新增外部条目（source=external，内置不动）；已存在 id 保留用户 active', () => {
    const store = useSettingsStore()
    const builtins = store.sprouts.filter(s => s.source !== 'external')
    expect(builtins.length).toBeGreaterThan(0)

    store.syncExternalSprouts([{ id: 'ws.demo', label: '示例', icon: 'puzzle', active: true }])
    expect(store.sprouts.filter(s => s.source === 'external')).toHaveLength(1)
    expect(store.sprouts.filter(s => s.source !== 'external')).toEqual(builtins)
    expect(store.isActive('ws.demo')).toBe(true)

    // 用户关掉 → 再 sync（label 更新）active 保持
    store.toggleSprout('ws.demo')
    store.syncExternalSprouts([{ id: 'ws.demo', label: '示例改', icon: 'puzzle', active: true }])
    const entry = store.sprouts.find(s => s.id === 'ws.demo')!
    expect(entry.active).toBe(false)
    expect(entry.label).toBe('示例改')
  })

  it('消失的插件条目被剔除；独立持久化键跨启动读回（占位形状，world 树 sync 校正 label）', () => {
    const store = useSettingsStore()
    store.syncExternalSprouts([{ id: 'ws.demo', label: '示例', icon: 'puzzle', active: true }])
    store.syncExternalSprouts([]) // 插件目录清空
    expect(store.sprouts.find(s => s.id === 'ws.demo')).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('worldsea_external_plugins') ?? '[]')).toEqual([])

    store.syncExternalSprouts([{ id: 'ws.keep', label: '保留', icon: 'puzzle', active: true }])
    // 模拟重开：新 pinia 读回（label 为占位 = id 尾段，等 world 树 sync 校正）
    setActivePinia(createPinia())
    const restored = useSettingsStore().sprouts.find(s => s.id === 'ws.keep')
    expect(restored).toMatchObject({ id: 'ws.keep', label: 'keep', source: 'external' })
  })
})
