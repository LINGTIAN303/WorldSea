import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import WorkspaceBackground from '../WorkspaceBackground.vue'
import { useBackground } from '@worldsea/style-kit'

const api = useBackground()

describe('WorkspaceBackground', () => {
  beforeEach(() => {
    api.clear()
    localStorage.clear()
    document.documentElement.removeAttribute('data-workspace-bg')
  })

  it('无图不渲染', () => {
    expect(mount(WorkspaceBackground).find('.workspace-bg').exists()).toBe(false)
  })

  it('有图且启用渲染', () => {
    api.setImage({ path: '/a.webp', src: 'asset://a.webp' })
    expect(mount(WorkspaceBackground).find('.workspace-bg').exists()).toBe(true)
  })

  it('preview 在关闭态仍渲染，普通模式不渲染', () => {
    api.setImage({ path: '/a.webp', src: 'asset://a.webp' })
    api.setEnabled(false)
    expect(mount(WorkspaceBackground, { props: { preview: true } }).find('.workspace-bg').exists()).toBe(true)
    expect(mount(WorkspaceBackground).find('.workspace-bg').exists()).toBe(false)
  })
})
