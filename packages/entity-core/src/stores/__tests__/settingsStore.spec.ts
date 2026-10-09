/**
 * settingsStore 图谱底色字段（2026-10-09 图谱批 D）。
 *
 * persistedRef 模式契约：默认 `'dark'`（深色星图）；赋值即落 localStorage
 * （`worldsea_graph_background`，watch 走微任务调度）；重开（新 pinia）读回。
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
