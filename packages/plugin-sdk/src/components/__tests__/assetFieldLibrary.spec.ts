// F1 接线守卫：AssetField 空态/已选态都能开资产库；选中后回写 value + kind（自动判定）。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const { listProjectAssets } = vi.hoisted(() => ({ listProjectAssets: vi.fn() }))

vi.mock('@worldsea/entity-core/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listProjectAssets,
}))

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
  invoke: vi.fn(),
}))

import AssetField from '../AssetField.vue'

const library = [
  { path: 'D:/w/assets/animated_1_ab.gif', name: 'animated_1_ab.gif', size: 2048, modified: 1700000000000, kind: 'animated' },
  { path: 'D:/w/assets/static_2_cd.png', name: 'static_2_cd.png', size: 1024, modified: 1600000000000, kind: 'static' },
]

function clickEl(sel: string, index = 0) {
  const el = document.querySelectorAll(sel)[index] as HTMLElement
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

async function openLibrary(w: ReturnType<typeof mount>) {
  await w.find('.asset-library-btn').trigger('click')
  await flush()
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  listProjectAssets.mockReset()
  listProjectAssets.mockResolvedValue(library)
})

describe('AssetField —— 从资产库选（F1）', () => {
  it('空态也有「从资产库选」入口，点击打开弹层', async () => {
    const w = mount(AssetField, { props: { category: 'portrait' } })
    await flush()
    await openLibrary(w)
    expect(document.querySelector('.alp-dialog')).toBeTruthy()
    w.unmount()
  })

  it('已选态同样有入口', async () => {
    const w = mount(AssetField, { props: { category: 'portrait', value: 'asset://old.png', kind: 'static' } })
    await flush()
    expect(w.find('.asset-library-btn').exists()).toBe(true)
    w.unmount()
  })

  it('选中动图资产 → 回写 value + kind=animated', async () => {
    const w = mount(AssetField, { props: { category: 'portrait' } })
    await flush()
    await openLibrary(w)
    clickEl('.alp-item', 0)
    await flush()
    expect(w.emitted('update:value')?.[0]?.[0]).toBe('asset://D:/w/assets/animated_1_ab.gif')
    expect(w.emitted('update:kind')?.[0]?.[0]).toBe('animated')
    w.unmount()
  })

  it('选中静态资产 → kind=static', async () => {
    const w = mount(AssetField, { props: { category: 'portrait' } })
    await flush()
    await openLibrary(w)
    clickEl('.alp-item', 1)
    await flush()
    expect(w.emitted('update:kind')?.[0]?.[0]).toBe('static')
    w.unmount()
  })
})
