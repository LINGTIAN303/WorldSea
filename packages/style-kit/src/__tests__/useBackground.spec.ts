import { beforeEach, describe, expect, it, vi } from 'vitest'

const load = async () => {
  vi.resetModules()
  return import('../composables/useBackground')
}

const TARGETS = ['canvas', 'home', 'titlebar', 'sidebar', 'content'] as const
const TARGET_VAR_SUFFIXES = ['image-light', 'image-dark', 'size', 'repeat', 'position', 'dim', 'blur'] as const

function resetDom() {
  const root = document.documentElement
  root.removeAttribute('data-workspace-bg')
  for (const target of TARGETS) {
    delete root.dataset[`wsBg${target[0].toUpperCase()}${target.slice(1)}`]
    for (const suffix of TARGET_VAR_SUFFIXES) root.style.removeProperty(`--ws-bg-${target}-${suffix}`)
  }
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
    const { normalizeTargetConfig } = await load()
    const b = normalizeTargetConfig({
      enabled: true, paths: { light: '/a.webp', dark: '' },
      fit: 'stretch', focusX: 12, focusY: 88, dim: 999, blur: -2,
    }, 'canvas')
    expect(b.paths.light).toBe('/a.webp')
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
    expect(BACKGROUND_DEFAULTS.targets.canvas.dim).toBe(35)
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
    expect(saved.targets.canvas.dim).toBe(80)
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
    expect(api.background.value.src).toBe('')
    expect(api.background.value.enabled).toBe(true)
    expect(api.missing.value.canvas.light).toBe(true)
    expect(localStorage.getItem(BACKGROUND_KEY)).toBeNull()
    expect(document.documentElement.dataset.workspaceBg).toBeUndefined()
    api.setSrc('asset://a.webp')
    expect(api.missing.value.canvas.light).toBe(false)
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

  it('五目标默认值齐全', async () => {
    const { BACKGROUND_DEFAULTS } = await load()
    expect(Object.keys(BACKGROUND_DEFAULTS.targets).sort()).toEqual(['canvas', 'content', 'home', 'sidebar', 'titlebar'])
    for (const c of Object.values(BACKGROUND_DEFAULTS.targets)) {
      expect(c.enabled).toBe(false)
      expect(c.paths).toEqual({ light: '', dark: '' })
      expect(c.dim).toBe(35)
      expect(c.blur).toBe(8)
    }
  })

  it('分区目标归一化强制 cover/居中', async () => {
    const { normalizeTargetConfig } = await load()
    const c = normalizeTargetConfig({ fit: 'tile', focusX: 0, focusY: 100 }, 'titlebar')
    expect(c.fit).toBe('cover')
    expect(c.focusX).toBe(50)
    expect(c.focusY).toBe(50)
  })

  it('v1 配置迁移到 canvas 亮色图', async () => {
    localStorage.setItem('worldsea_workspace_background', JSON.stringify({
      enabled: true, path: '/old.webp', src: 'asset://old.webp',
      fit: 'contain', focusX: 100, focusY: 0, dim: 12, blur: 3,
    }))
    const { applyPersistedBackground, useBackground } = await load()
    applyPersistedBackground()
    const canvas = useBackground().globalConfig.value.targets.canvas
    expect(canvas.enabled).toBe(true)
    expect(canvas.paths.light).toBe('/old.webp')
    expect(canvas.paths.dark).toBe('')
    expect(canvas.fit).toBe('contain')
    expect(canvas.focusX).toBe(100)
    expect(canvas.dim).toBe(12)
  })

  it('项目目标覆盖全局，显式关闭不回退', async () => {
    const { useBackground } = await load()
    const api = useBackground()
    api.updateTarget('canvas', { enabled: true }, 'global')
    api.setTargetImage('canvas', 'light', { path: '/g.webp', src: 'asset://g.webp' }, 'global')
    api.setTargetCustom('canvas', true)
    api.updateTarget('canvas', { enabled: false }, 'project')
    api.setTargetSrcs('canvas', { light: 'asset://p.webp', dark: '' }, 'project')
    expect(api.effective.value.canvas.enabled).toBe(false)
    expect(api.srcs.value.canvas.light).toBe('asset://p.webp')
    api.setTargetCustom('canvas', false)
    expect(api.effective.value.canvas.enabled).toBe(true)
    expect(api.srcs.value.canvas.light).toBe('asset://g.webp')
  })

  it('项目覆盖不吞掉全局缺失标记', async () => {
    const { useBackground } = await load()
    const api = useBackground()
    api.setTargetImage('canvas', 'light', { path: '/g.webp', src: 'asset://g.webp' }, 'global')
    api.markMissing('canvas', 'light', 'global')
    expect(api.missing.value.canvas.light).toBe(true)
    api.setProjectConfig({
      version: 1,
      targets: {
        canvas: { enabled: true, paths: { light: '', dark: '' }, fit: 'cover', focusX: 50, focusY: 50, dim: 35, blur: 8 },
      },
    })
    expect(api.missing.value.canvas.light).toBe(false)
    api.setProjectConfig(null)
    expect(api.missing.value.canvas.light).toBe(true)
  })

  it('亮图缺失回填暗图，双主题变量都写入', async () => {
    const { useBackground } = await load()
    const api = useBackground()
    api.setProjectConfig(null)
    api.setTargetImage('canvas', 'dark', { path: '/d.webp', src: 'asset://d.webp' }, 'global')
    const root = document.documentElement
    expect(root.style.getPropertyValue('--ws-bg-canvas-image-light')).toContain('asset://d.webp')
    expect(root.style.getPropertyValue('--ws-bg-canvas-image-dark')).toContain('asset://d.webp')
    expect(root.dataset.wsBgCanvas).toBe('on')
  })

  it('五个目标分别写 data 属性与变量', async () => {
    const { useBackground, BACKGROUND_TARGETS } = await load()
    const api = useBackground()
    for (const target of BACKGROUND_TARGETS) {
      api.setTargetImage(target, 'light', { path: `/${target}.webp`, src: `asset://${target}.webp` }, 'global')
    }
    const root = document.documentElement
    for (const target of BACKGROUND_TARGETS) {
      expect(root.dataset[`wsBg${target[0].toUpperCase()}${target.slice(1)}`]).toBe('on')
      expect(root.style.getPropertyValue(`--ws-bg-${target}-image-light`)).toContain(`asset://${target}.webp`)
    }
  })
})
