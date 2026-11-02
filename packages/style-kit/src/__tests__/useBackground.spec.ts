import { beforeEach, describe, expect, it, vi } from 'vitest'

const load = async () => {
  vi.resetModules()
  return import('../composables/useBackground')
}

function resetDom() {
  const root = document.documentElement
  root.removeAttribute('data-workspace-bg')
  for (const name of ['--ws-bg-image', '--ws-bg-size', '--ws-bg-repeat', '--ws-bg-position', '--ws-bg-dim', '--ws-bg-blur']) {
    root.style.removeProperty(name)
  }
}

describe('useBackground', () => {
  beforeEach(() => {
    localStorage.clear()
    resetDom()
  })

  it('默认不应用背景', async () => {
    const { applyPersistedBackground } = await load()
    applyPersistedBackground()
    expect(document.documentElement.dataset.workspaceBg).toBeUndefined()
    expect(document.documentElement.style.getPropertyValue('--ws-bg-image')).toBe('')
  })

  it('归一化：枚举回退、焦点就近、数值夹取', async () => {
    const { normalizeBackground } = await load()
    const b = normalizeBackground({
      enabled: true, path: '/a.webp', src: 'asset://a.webp',
      fit: 'stretch', focusX: 12, focusY: 88, dim: 999, blur: -2,
    })
    expect(b.fit).toBe('cover')
    expect(b.focusX).toBe(0)
    expect(b.focusY).toBe(100)
    expect(b.dim).toBe(80)
    expect(b.blur).toBe(0)
  })

  it('损坏 JSON 回默认值', async () => {
    localStorage.setItem('worldsea_workspace_background', '{oops')
    const { applyPersistedBackground, BACKGROUND_DEFAULTS } = await load()
    applyPersistedBackground()
    expect(document.documentElement.dataset.workspaceBg).toBeUndefined()
    expect(BACKGROUND_DEFAULTS.dim).toBe(35)
  })

  it('setImage 启用并写变量；关闭后保留变量供预览', async () => {
    const { useBackground } = await load()
    const api = useBackground()
    api.setImage({ path: '/a.webp', src: 'asset://a.webp' })
    expect(document.documentElement.dataset.workspaceBg).toBe('on')
    expect(document.documentElement.style.getPropertyValue('--ws-bg-image')).toContain('asset://a.webp')
    api.setEnabled(false)
    expect(document.documentElement.dataset.workspaceBg).toBeUndefined()
    expect(document.documentElement.style.getPropertyValue('--ws-bg-blur')).toBe('8px')
  })

  it('setDim 夹取并延迟持久化，flush 立即落盘', async () => {
    vi.useFakeTimers()
    const { useBackground, BACKGROUND_KEY } = await load()
    const api = useBackground()
    api.setDim(200)
    expect(api.background.value.dim).toBe(80)
    expect(localStorage.getItem(BACKGROUND_KEY)).toBeNull()
    api.flush()
    const saved = JSON.parse(localStorage.getItem(BACKGROUND_KEY)!)
    expect(saved.dim).toBe(80)
    vi.useRealTimers()
  })

  it('fit/focus 映射到 CSS 变量', async () => {
    const { useBackground } = await load()
    const api = useBackground()
    api.setImage({ path: '/a.webp', src: 'asset://a.webp' })
    api.setFit('tile')
    api.setFocus(0, 100)
    const root = document.documentElement
    expect(root.style.getPropertyValue('--ws-bg-size')).toBe('auto')
    expect(root.style.getPropertyValue('--ws-bg-repeat')).toBe('repeat')
    expect(root.style.getPropertyValue('--ws-bg-position')).toBe('0% 100%')
    api.setFit('contain')
    expect(root.style.getPropertyValue('--ws-bg-size')).toBe('contain')
    expect(root.style.getPropertyValue('--ws-bg-repeat')).toBe('no-repeat')
  })

  it('markMissing 软缺失：保留配置、不写存储；setSrc 恢复', async () => {
    const { useBackground, BACKGROUND_KEY } = await load()
    const api = useBackground()
    api.setImage({ path: '/a.webp', src: 'asset://a.webp' })
    localStorage.removeItem(BACKGROUND_KEY)
    api.markMissing()
    expect(api.background.value.path).toBe('/a.webp')
    expect(api.background.value.src).toBe('asset://a.webp')
    expect(api.background.value.enabled).toBe(true)
    expect(api.missing.value).toBe(true)
    expect(localStorage.getItem(BACKGROUND_KEY)).toBeNull()
    expect(document.documentElement.dataset.workspaceBg).toBeUndefined()
    api.setSrc('asset://a.webp')
    expect(api.missing.value).toBe(false)
    expect(document.documentElement.dataset.workspaceBg).toBe('on')
  })

  it('替换图片保留启用状态，首次选图自动启用', async () => {
    const { useBackground } = await load()
    const api = useBackground()
    api.setImage({ path: '/a.webp', src: 'asset://a.webp' })
    expect(api.background.value.enabled).toBe(true)
    api.setEnabled(false)
    api.setImage({ path: '/b.webp', src: 'asset://b.webp' })
    expect(api.background.value.enabled).toBe(false)
    api.clear()
    api.setImage({ path: '/c.webp', src: 'asset://c.webp' })
    expect(api.background.value.enabled).toBe(true)
  })

  it('clear 清空配置、变量与属性', async () => {
    const { useBackground } = await load()
    const api = useBackground()
    api.setImage({ path: '/a.webp', src: 'asset://a.webp' })
    api.clear()
    expect(api.background.value.src).toBe('')
    expect(api.background.value.enabled).toBe(false)
    expect(document.documentElement.dataset.workspaceBg).toBeUndefined()
    expect(document.documentElement.style.getPropertyValue('--ws-bg-image')).toBe('')
  })
})
