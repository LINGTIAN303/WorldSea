import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { useBackground } from '@worldsea/style-kit'

vi.mock('@worldsea/entity-core/core', () => ({
  pickAndSaveWorkspaceBackground: vi.fn(),
  removeWorkspaceBackground: vi.fn(async () => undefined),
}))

import { pickAndSaveWorkspaceBackground, removeWorkspaceBackground } from '@worldsea/entity-core/core'
import BackgroundCard from '../BackgroundCard.vue'

const api = useBackground()
const pick = vi.mocked(pickAndSaveWorkspaceBackground)
const remove = vi.mocked(removeWorkspaceBackground)

describe('BackgroundCard', () => {
  beforeEach(() => {
    api.clear()
    localStorage.clear()
    document.documentElement.removeAttribute('data-workspace-bg')
    pick.mockReset()
    remove.mockReset()
    remove.mockResolvedValue(undefined)
  })

  it('选择图片后启用并显示预览', async () => {
    pick.mockResolvedValue({ ok: true, path: '/a.webp', src: 'asset://a.webp' })
    const w = mount(BackgroundCard)
    await w.find('.bg-actions .set-btn').trigger('click')
    await flushPromises()
    expect(api.background.value.src).toBe('asset://a.webp')
    expect(api.background.value.enabled).toBe(true)
    expect(w.find('.workspace-bg').exists()).toBe(true)
  })

  it('移除会清空配置并调用文件删除', async () => {
    api.setImage({ path: '/a.webp', src: 'asset://a.webp' })
    const w = mount(BackgroundCard)
    const buttons = w.findAll('.bg-actions .set-btn')
    await buttons[1].trigger('click')
    expect(api.background.value.src).toBe('')
    expect(remove).toHaveBeenCalledWith('/a.webp')
  })

  it('替换时删除旧文件', async () => {
    api.setImage({ path: '/old.webp', src: 'asset://old.webp' })
    pick.mockResolvedValue({ ok: true, path: '/new.webp', src: 'asset://new.webp' })
    const w = mount(BackgroundCard)
    await w.find('.bg-actions .set-btn').trigger('click')
    await flushPromises()
    expect(api.background.value.src).toBe('asset://new.webp')
    expect(remove).toHaveBeenCalledWith('/old.webp')
  })

  it('填充与开关写入配置', async () => {
    api.setImage({ path: '/a.webp', src: 'asset://a.webp' })
    const w = mount(BackgroundCard)
    await w.find('select').setValue('contain')
    expect(api.background.value.fit).toBe('contain')
    await w.find('.set-toggle input').setValue(false)
    expect(api.background.value.enabled).toBe(false)
  })
})
