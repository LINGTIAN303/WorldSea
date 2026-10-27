// F1 资产库复用守卫：列举/空态/选择/关闭。IO（cmd_fs_list）在 entity-core 单测覆盖，
// 这里 mock listProjectAssets 只验弹层行为。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const { assets, listProjectAssets } = vi.hoisted(() => {
  const assets = [
    { path: 'D:/w/assets/animated_1_ab.gif', name: 'animated_1_ab.gif', size: 2048, modified: 1700000000000, kind: 'animated' },
    { path: 'D:/w/assets/model_2_cd.glb', name: 'model_2_cd.glb', size: 4096, kind: 'model' },
  ]
  return { assets, listProjectAssets: vi.fn(async () => assets) }
})

vi.mock('@worldsea/entity-core/core', () => ({
  listProjectAssets,
  ASSET_KIND_LABELS: {
    static: '静态图片',
    animated: '动态图（GIF/APNG/动态WebP）',
    lottie: 'Lottie 动画（JSON）',
    model: '3D 模型（GLB/GLTF）',
    video: '视频',
  },
}))

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
}))

import AssetLibraryPicker from '../AssetLibraryPicker.vue'

function mountPicker(kinds: string[] = ['static', 'animated', 'lottie', 'model']) {
  return mount(AssetLibraryPicker, { props: { kinds: kinds as never } })
}

async function settle(w: ReturnType<typeof mountPicker>) {
  await new Promise((r) => setTimeout(r, 0))
  await w.vm.$nextTick()
}

function clickEl(sel: string, index = 0) {
  const el = document.querySelectorAll(sel)[index] as HTMLElement
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

beforeEach(() => {
  listProjectAssets.mockClear()
})

describe('AssetLibraryPicker —— 资产库弹层', () => {
  it('按传入类别并集列举，显示名称与类别', async () => {
    const w = mountPicker()
    await settle(w)
    expect(listProjectAssets).toHaveBeenCalledWith(['static', 'animated', 'lottie', 'model'])
    expect(document.querySelectorAll('.alp-item')).toHaveLength(2)
    expect(document.body.textContent).toContain('animated_1_ab.gif')
    expect(document.body.textContent).toContain('动态图')
    w.unmount()
  })

  it('点击条目 emit select（原样路径与类别，URL 转换由 AssetField 负责）', async () => {
    const w = mountPicker()
    await settle(w)
    clickEl('.alp-item', 0)
    expect(w.emitted('select')?.[0]?.[0]).toMatchObject({
      path: 'D:/w/assets/animated_1_ab.gif',
      name: 'animated_1_ab.gif',
      kind: 'animated',
    })
    w.unmount()
  })

  it('空库显示空态提示', async () => {
    listProjectAssets.mockResolvedValueOnce([])
    const w = mountPicker()
    await settle(w)
    expect(document.body.textContent).toContain('资产库为空')
    w.unmount()
  })

  it('关闭按钮 emit close', async () => {
    const w = mountPicker()
    await settle(w)
    clickEl('.alp-close')
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })
})
