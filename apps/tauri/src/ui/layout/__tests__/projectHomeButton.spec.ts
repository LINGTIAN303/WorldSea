import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useUIStore } from '@/stores/uiStore'
import ProjectHomeButton from '../ProjectHomeButton.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('ProjectHomeButton', () => {
  it('工作台时点击回首页；首页时 aria-current 且再点不改状态', async () => {
    const ui = useUIStore()
    ui.setSurface('workspace')
    const w = mount(ProjectHomeButton)
    expect(w.attributes('aria-current')).toBeUndefined()
    await w.trigger('click')
    await nextTick()
    expect(ui.surface).toBe('home')
    expect(w.attributes('aria-current')).toBe('page')
    await w.trigger('click')
    expect(ui.surface).toBe('home')
  })
})
