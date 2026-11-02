import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const load = async () => {
  vi.resetModules()
  return import('../composables/useBackground')
}

const TARGETS = ['canvas', 'home', 'titlebar', 'sidebar', 'content-toolbar', 'content-view'] as const
const TARGET_VAR_SUFFIXES = ['image-light', 'image-dark', 'size', 'repeat', 'position', 'dim', 'blur'] as const
const V1_ALIASES = [
  'background', 'setImage', 'setSrc', 'clear', 'setEnabled', 'setFit',
  'setFocus', 'setDim', 'setBlur', 'flush',
]

/** 连字符目标写 dataset 时转 camelCase：content-toolbar → wsBgContentToolbar */
function datasetKey(target: string) {
  return `wsBg${target.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('')}`
}

function resetDom() {
  const root = document.documentElement
  for (const target of TARGETS) {
    delete root.dataset[datasetKey(target)]
    for (const suffix of TARGET_VAR_SUFFIXES) root.style.removeProperty(`--ws-bg-${target}-${suffix}`)
  }
}

describe('useBackground', () => {
  beforeEach(() => {
    // 全用例假计时器：每个用例重置模块后，上一个实例的防抖写盘定时器不得落到下一个用例
    vi.useFakeTimers()
    localStorage.clear()
    resetDom()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('默认不应用背景', async () => {
    const { applyPersistedBackground } = await load()
    applyPersistedBackground()
    const root = document.documentElement
    expect(root.dataset.wsBgCanvas).toBeUndefined()
    expect(root.style.getPropertyValue('--ws-bg-canvas-image-light')).toBe('')
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

  it('v1 损坏 JSON 不迁移，回默认值', async () => {
    localStorage.setItem('worldsea_workspace_background', '{oops')
    const { applyPersistedBackground, BACKGROUND_DEFAULTS, BACKGROUND_KEY } = await load()
    applyPersistedBackground()
    expect(document.documentElement.dataset.wsBgCanvas).toBeUndefined()
    expect(BACKGROUND_DEFAULTS.targets.canvas.dim).toBe(35)
    expect(localStorage.getItem(BACKGROUND_KEY)).toBeNull()
  })

  it('setTargetImage 启用并写变量；关闭后保留变量供预览', async () => {
    const { useBackground } = await load()
    const api = useBackground()
    api.setTargetImage('canvas', 'light', { path: '/a.webp', src: 'asset://a.webp' }, 'global')
    const root = document.documentElement
    expect(root.dataset.wsBgCanvas).toBe('on')
    expect(root.style.getPropertyValue('--ws-bg-canvas-image-light')).toContain('asset://a.webp')
    api.updateTarget('canvas', { enabled: false }, 'global')
    expect(root.dataset.wsBgCanvas).toBeUndefined()
    expect(root.style.getPropertyValue('--ws-bg-canvas-blur')).toBe('8px')
  })

  it('暗化夹取并延迟持久化，flushGlobal 立即落盘', async () => {
    const { useBackground, BACKGROUND_KEY } = await load()
    const api = useBackground()
    api.updateTarget('canvas', { dim: 200 }, 'global')
    expect(api.globalConfig.value.targets.canvas.dim).toBe(80)
    expect(api.effective.value.canvas.dim).toBe(80)
    expect(localStorage.getItem(BACKGROUND_KEY)).toBeNull()
    api.flushGlobal()
    const saved = JSON.parse(localStorage.getItem(BACKGROUND_KEY)!)
    expect(saved.targets.canvas.dim).toBe(80)
  })

  it('fit/focus 映射到目标 CSS 变量', async () => {
    const { useBackground } = await load()
    const api = useBackground()
    api.setTargetImage('canvas', 'light', { path: '/a.webp', src: 'asset://a.webp' }, 'global')
    api.updateTarget('canvas', { fit: 'tile', focusX: 0, focusY: 100 }, 'global')
    const root = document.documentElement
    expect(root.style.getPropertyValue('--ws-bg-canvas-size')).toBe('auto')
    expect(root.style.getPropertyValue('--ws-bg-canvas-repeat')).toBe('repeat')
    expect(root.style.getPropertyValue('--ws-bg-canvas-position')).toBe('0% 100%')
    api.updateTarget('canvas', { fit: 'contain' }, 'global')
    expect(root.style.getPropertyValue('--ws-bg-canvas-size')).toBe('contain')
    expect(root.style.getPropertyValue('--ws-bg-canvas-repeat')).toBe('no-repeat')
  })

  it('markMissing 软缺失：保留配置、不写存储；setTargetSrc 恢复', async () => {
    const { useBackground, BACKGROUND_KEY } = await load()
    const api = useBackground()
    api.setTargetImage('canvas', 'light', { path: '/a.webp', src: 'asset://a.webp' }, 'global')
    localStorage.removeItem(BACKGROUND_KEY)
    api.markMissing('canvas', 'light', 'global')
    expect(api.globalConfig.value.targets.canvas.paths.light).toBe('/a.webp')
    expect(api.globalSrcs.value.canvas.light).toBe('')
    expect(api.missing.value.canvas.light).toBe(true)
    expect(api.globalMissing.value.canvas.light).toBe(true)
    expect(localStorage.getItem(BACKGROUND_KEY)).toBeNull()
    expect(document.documentElement.dataset.wsBgCanvas).toBeUndefined()
    api.setTargetSrc('canvas', 'light', 'asset://a.webp', 'global')
    expect(api.missing.value.canvas.light).toBe(false)
    expect(document.documentElement.dataset.wsBgCanvas).toBe('on')
  })

  it('替换图片保留启用状态，首次选图自动启用', async () => {
    const { useBackground } = await load()
    const api = useBackground()
    api.setTargetImage('canvas', 'light', { path: '/a.webp', src: 'asset://a.webp' }, 'global')
    expect(api.globalConfig.value.targets.canvas.enabled).toBe(true)
    api.updateTarget('canvas', { enabled: false }, 'global')
    api.setTargetImage('canvas', 'dark', { path: '/b.webp', src: 'asset://b.webp' }, 'global')
    expect(api.globalConfig.value.targets.canvas.enabled).toBe(false)
    api.clearTargetImage('canvas', 'light', 'global')
    api.clearTargetImage('canvas', 'dark', 'global')
    expect(api.globalConfig.value.targets.canvas.paths).toEqual({ light: '', dark: '' })
    api.setTargetImage('canvas', 'light', { path: '/c.webp', src: 'asset://c.webp' }, 'global')
    expect(api.globalConfig.value.targets.canvas.enabled).toBe(true)
  })

  it('清空两主题图片后移除变量与属性', async () => {
    const { useBackground } = await load()
    const api = useBackground()
    api.setTargetImage('canvas', 'light', { path: '/a.webp', src: 'asset://a.webp' }, 'global')
    api.setTargetImage('canvas', 'dark', { path: '/b.webp', src: 'asset://b.webp' }, 'global')
    api.clearTargetImage('canvas', 'light', 'global')
    api.clearTargetImage('canvas', 'dark', 'global')
    expect(api.globalConfig.value.targets.canvas.paths).toEqual({ light: '', dark: '' })
    const root = document.documentElement
    expect(root.style.getPropertyValue('--ws-bg-canvas-image-light')).toBe('')
    expect(root.dataset.wsBgCanvas).toBeUndefined()
  })

  it('六目标默认值齐全', async () => {
    const { BACKGROUND_DEFAULTS } = await load()
    expect(Object.keys(BACKGROUND_DEFAULTS.targets).sort()).toEqual([
      'canvas', 'content-toolbar', 'content-view', 'home', 'sidebar', 'titlebar',
    ])
    for (const c of Object.values(BACKGROUND_DEFAULTS.targets)) {
      expect(c.enabled).toBe(false)
      expect(c.paths).toEqual({ light: '', dark: '' })
      expect(c.dim).toBe(35)
      expect(c.blur).toBe(8)
    }
  })

  it('旧 content 全局配置迁移到 content-view', async () => {
    localStorage.setItem('worldsea_background_v2', JSON.stringify({
      version: 2,
      targets: {
        content: {
          enabled: true,
          paths: { light: '/content.webp', dark: '/content-dark.webp' },
          fit: 'tile', focusX: 0, focusY: 100, dim: 20, blur: 4,
        },
      },
    }))
    const { applyPersistedBackground, useBackground } = await load()
    applyPersistedBackground()
    const api = useBackground()
    const view = api.globalConfig.value.targets['content-view']
    expect(view.enabled).toBe(true)
    expect(view.paths).toEqual({ light: '/content.webp', dark: '/content-dark.webp' })
    expect(view.fit).toBe('cover')
    expect(view.focusX).toBe(50)
    expect('content' in api.globalConfig.value.targets).toBe(false)
  })

  it('旧 content 项目配置迁移到 content-view', async () => {
    const { normalizeProjectConfig } = await load()
    const config = normalizeProjectConfig({
      version: 1,
      targets: {
        content: { enabled: true, paths: { light: '.worldsea/backgrounds/a.webp', dark: '' } },
      },
    })
    expect(config?.targets['content-view']?.paths.light).toBe('.worldsea/backgrounds/a.webp')
    expect(config?.targets['content-toolbar']).toBeUndefined()
  })

  it('新旧 key 同时存在时优先新 key', async () => {
    const { normalizeGlobalConfig, normalizeProjectConfig } = await load()
    const global = normalizeGlobalConfig({
      targets: {
        content: { enabled: true, paths: { light: '/old.webp', dark: '' } },
        'content-view': { enabled: false, paths: { light: '/new.webp', dark: '' } },
      },
    })
    expect(global.targets['content-view'].paths.light).toBe('/new.webp')
    const project = normalizeProjectConfig({
      targets: {
        content: { paths: { light: '.worldsea/backgrounds/old.webp', dark: '' } },
        'content-view': { paths: { light: '.worldsea/backgrounds/new.webp', dark: '' } },
      },
    })
    expect(project?.targets['content-view']?.paths.light).toBe('.worldsea/backgrounds/new.webp')
  })

  it('含连字符的目标写 camelCase dataset 与变量', async () => {
    const { useBackground } = await load()
    const api = useBackground()
    api.setTargetImage('content-toolbar', 'light', { path: '/t.webp', src: 'asset://t.webp' }, 'global')
    const root = document.documentElement
    expect(root.dataset.wsBgContentToolbar).toBe('on')
    expect(root.style.getPropertyValue('--ws-bg-content-toolbar-image-light')).toContain('asset://t.webp')
    api.updateTarget('content-toolbar', { enabled: false }, 'global')
    expect(root.dataset.wsBgContentToolbar).toBeUndefined()
  })

  it('分区目标归一化强制 cover/居中', async () => {
    const { normalizeTargetConfig } = await load()
    const c = normalizeTargetConfig({ fit: 'tile', focusX: 0, focusY: 100 }, 'titlebar')
    expect(c.fit).toBe('cover')
    expect(c.focusX).toBe(50)
    expect(c.focusY).toBe(50)
  })

  it('v1 配置迁移到 canvas 亮色图并写入 v2 键', async () => {
    localStorage.setItem('worldsea_workspace_background', JSON.stringify({
      enabled: true, path: '/old.webp', src: 'asset://old.webp',
      fit: 'contain', focusX: 100, focusY: 0, dim: 12, blur: 3,
    }))
    const { applyPersistedBackground, useBackground, BACKGROUND_KEY } = await load()
    applyPersistedBackground()
    const canvas = useBackground().globalConfig.value.targets.canvas
    expect(canvas.enabled).toBe(true)
    expect(canvas.paths.light).toBe('/old.webp')
    expect(canvas.paths.dark).toBe('')
    expect(canvas.fit).toBe('contain')
    expect(canvas.focusX).toBe(100)
    expect(canvas.dim).toBe(12)
    expect(JSON.parse(localStorage.getItem(BACKGROUND_KEY)!).version).toBe(2)
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
    expect(api.projectMissing.value.canvas.light).toBe(false)
    api.setProjectConfig(null)
    expect(api.missing.value.canvas.light).toBe(true)
  })

  it('暴露分 scope 运行时态供卡片预览', async () => {
    const { useBackground } = await load()
    const api = useBackground()
    api.setTargetImage('canvas', 'light', { path: '/g.webp', src: 'asset://g.webp' }, 'global')
    api.setTargetCustom('canvas', true)
    api.setTargetSrcs('canvas', { light: 'asset://p.webp', dark: '' }, 'project')
    expect(api.globalSrcs.value.canvas.light).toBe('asset://g.webp')
    expect(api.projectSrcs.value.canvas.light).toBe('asset://p.webp')
    api.markMissing('canvas', 'light', 'project')
    expect(api.projectMissing.value.canvas.light).toBe(true)
    expect(api.globalMissing.value.canvas.light).toBe(false)
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

  it('六个目标分别写 data 属性与变量', async () => {
    const { useBackground, BACKGROUND_TARGETS } = await load()
    const api = useBackground()
    for (const target of BACKGROUND_TARGETS) {
      api.setTargetImage(target, 'light', { path: `/${target}.webp`, src: `asset://${target}.webp` }, 'global')
    }
    const root = document.documentElement
    for (const target of BACKGROUND_TARGETS) {
      expect(root.dataset[datasetKey(target)]).toBe('on')
      expect(root.style.getPropertyValue(`--ws-bg-${target}-image-light`)).toContain(`asset://${target}.webp`)
    }
  })

  it('不再暴露 v1 兼容别名', async () => {
    const { useBackground } = await load()
    const api = useBackground() as unknown as Record<string, unknown>
    for (const key of V1_ALIASES) expect(api[key]).toBeUndefined()
  })
})
