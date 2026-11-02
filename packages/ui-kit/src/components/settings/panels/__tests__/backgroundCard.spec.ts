/**
 * 背景卡：范围/目标切换、跟随/自定义、亮暗图片槽、缺失提示、参数矩阵与项目配置读写。
 * entity-core 的存储与选图全部打桩；style-kit 用真实单例验证配置落点。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, enableAutoUnmount, mount } from '@vue/test-utils'
import type { Ref } from 'vue'

const env = vi.hoisted(() => ({
  projectDir: 'C:/proj/worlddata' as string,
  boundDir: null as unknown,
}))

const core = vi.hoisted(() => ({
  pickAndSaveBackground: vi.fn(),
  removeBackgroundFile: vi.fn(),
  removeProjectBackgroundFile: vi.fn(),
  readProjectBackground: vi.fn(),
  writeProjectBackground: vi.fn(),
  deleteProjectBackground: vi.fn(),
  resolveProjectBackgroundAssets: vi.fn(),
  cleanupProjectBackgroundOrphans: vi.fn(async () => undefined),
}))

vi.mock('@worldsea/entity-core/composables', async () => {
  const { ref } = await import('vue')
  env.boundDir = ref<string | null>('C:/proj')
  return { useFileSystemProject: () => ({ boundDir: env.boundDir }) }
})

vi.mock('@worldsea/entity-core/core', () => ({
  getFileStorageBackend: () => (env.projectDir ? { projectDir: env.projectDir } : null),
  pickAndSaveBackground: core.pickAndSaveBackground,
  removeBackgroundFile: core.removeBackgroundFile,
  removeProjectBackgroundFile: core.removeProjectBackgroundFile,
  readProjectBackground: core.readProjectBackground,
  writeProjectBackground: core.writeProjectBackground,
  deleteProjectBackground: core.deleteProjectBackground,
  resolveProjectBackgroundAssets: core.resolveProjectBackgroundAssets,
  cleanupProjectBackgroundOrphans: core.cleanupProjectBackgroundOrphans,
}))

import { BACKGROUND_TARGETS, BACKGROUND_THEMES, useBackground } from '@worldsea/style-kit'
import BackgroundCard from '../BackgroundCard.vue'

enableAutoUnmount(afterEach)

const api = useBackground()
const boundDir = () => env.boundDir as Ref<string | null>

function defaultTargets() {
  return {
    enabled: false,
    fit: 'cover' as const,
    focusX: 50 as const,
    focusY: 50 as const,
    dim: 35,
    blur: 8,
    paths: { light: '', dark: '' },
  }
}

function mapRegion(w: ReturnType<typeof mount>, label: string) {
  const btn = w.findAll('.bg-map__region').find((b) => b.text().includes(label))
  if (!btn) throw new Error(`未找到映射区域：${label}`)
  return btn
}

function switchMap(w: ReturnType<typeof mount>, label: string) {
  const btn = w.findAll('.bg-map__switch button').find((b) => b.text() === label)
  if (!btn) throw new Error(`未找到地图切换：${label}`)
  return btn
}

function canvasCard(w: ReturnType<typeof mount>) {
  return w.find('.bg-canvas-card')
}

function scopeButton(w: ReturnType<typeof mount>, label: string) {
  const btn = w.findAll('.bg-scope .bg-seg').find((b) => b.text() === label)
  if (!btn) throw new Error(`未找到范围按钮：${label}`)
  return btn
}

async function mountCard() {
  const w = mount(BackgroundCard)
  await flushPromises()
  return w
}

/** 打桩项目背景加载：挂载时 readProjectBackground → resolveProjectBackgroundAssets 返回给定结果 */
function mockProjectLoad(targets: Record<string, unknown>, assets?: { srcs?: Record<string, unknown>; missing?: Record<string, unknown> }) {
  core.readProjectBackground.mockResolvedValue({ version: 1, targets })
  core.resolveProjectBackgroundAssets.mockResolvedValue({
    srcs: assets?.srcs ?? {},
    missing: assets?.missing ?? {},
  })
}

beforeEach(() => {
  env.projectDir = 'C:/proj/worlddata'
  boundDir().value = 'C:/proj'
  api.setProjectConfig(null)
  for (const target of BACKGROUND_TARGETS) {
    for (const theme of BACKGROUND_THEMES) api.clearTargetImage(target, theme, 'global')
    api.updateTarget(target, defaultTargets(), 'global')
  }
  api.flushGlobal()
  localStorage.clear()
  for (const fn of Object.values(core)) fn.mockReset()
  core.pickAndSaveBackground.mockResolvedValue(null)
  core.removeBackgroundFile.mockResolvedValue(undefined)
  core.removeProjectBackgroundFile.mockResolvedValue(undefined)
  core.readProjectBackground.mockResolvedValue(null)
  core.writeProjectBackground.mockResolvedValue(undefined)
  core.deleteProjectBackground.mockResolvedValue(undefined)
  core.resolveProjectBackgroundAssets.mockResolvedValue({ srcs: {}, missing: {} })
  core.cleanupProjectBackgroundOrphans.mockResolvedValue(undefined)
})

describe('BackgroundCard', () => {
  it('本项目自定义继承全局参数但图片为空', async () => {
    api.updateTarget('canvas', { dim: 55, enabled: true, paths: { light: 'C:/global.webp', dark: '' } }, 'global')
    const w = await mountCard()
    await canvasCard(w).trigger('click')
    await scopeButton(w, '本项目').trigger('click')
    expect(w.text()).toContain('当前跟随全局')
    await w.find('.bg-project__btn').trigger('click')
    await flushPromises()
    const cfg = api.projectConfig.value?.targets.canvas
    expect(cfg?.dim).toBe(55)
    expect(cfg?.paths).toEqual({ light: '', dark: '' })
    expect(w.text()).toContain('本项目自定义中')
    expect(core.writeProjectBackground).toHaveBeenCalledWith('C:/proj/worlddata', expect.objectContaining({
      version: 1,
      targets: expect.objectContaining({ canvas: expect.objectContaining({ dim: 55 }) }),
    }))
  })

  it('恢复跟随全局删除项目目标并调用项目文件删除', async () => {
    const w = await mountCard()
    api.setProjectConfig({
      version: 1,
      targets: {
        canvas: {
          ...defaultTargets(),
          enabled: true,
          paths: {
            light: '.worldsea/backgrounds/background-canvas-light-1.webp',
            dark: '.worldsea/backgrounds/background-canvas-dark-1.webp',
          },
        },
      },
    })
    await canvasCard(w).trigger('click')
    await scopeButton(w, '本项目').trigger('click')
    expect(w.text()).toContain('本项目自定义中')
    await w.find('.bg-project__btn').trigger('click')
    await flushPromises()
    expect(api.projectConfig.value?.targets.canvas).toBeUndefined()
    expect(core.removeProjectBackgroundFile).toHaveBeenCalledWith(
      'C:/proj/worlddata',
      '.worldsea/backgrounds/background-canvas-light-1.webp',
    )
    expect(core.removeProjectBackgroundFile).toHaveBeenCalledWith(
      'C:/proj/worlddata',
      '.worldsea/backgrounds/background-canvas-dark-1.webp',
    )
    // 已无自定义目标：删除配置文件而非写空配置
    expect(core.deleteProjectBackground).toHaveBeenCalledWith('C:/proj/worlddata')
    expect(core.writeProjectBackground).not.toHaveBeenCalled()
    // 项目回到全跟随全局：以空引用清理残留图片
    expect(core.cleanupProjectBackgroundOrphans).toHaveBeenCalledWith('C:/proj/worlddata', [])
  })

  it('范围/目标切换只改当前卡片状态，不改其他目标配置', async () => {
    api.updateTarget('titlebar', { dim: 12 }, 'global')
    const before = JSON.stringify(api.globalConfig.value)
    const w = await mountCard()
    await canvasCard(w).trigger('click')
    await scopeButton(w, '本项目').trigger('click')
    await scopeButton(w, '全局').trigger('click')
    expect(JSON.stringify(api.globalConfig.value)).toBe(before)
    expect(core.writeProjectBackground).not.toHaveBeenCalled()
  })

  it('首次选图自动启用；已有路径时替换保留原 enabled', async () => {
    core.pickAndSaveBackground.mockResolvedValue({ ok: true, path: 'C:/bg/a.webp', src: 'asset://a.webp' })
    const w = await mountCard()
    await canvasCard(w).trigger('click')
    await w.find('.bg-slot--light .bg-slot__pick').trigger('click')
    await flushPromises()
    expect(api.globalConfig.value.targets.canvas.paths.light).toBe('C:/bg/a.webp')
    expect(api.globalConfig.value.targets.canvas.enabled).toBe(true)
    await w.find('input[aria-label="启用背景"]').setValue(false)
    core.pickAndSaveBackground.mockResolvedValue({ ok: true, path: 'C:/bg/b.webp', src: 'asset://b.webp' })
    await w.find('.bg-slot--light .bg-slot__pick').trigger('click')
    await flushPromises()
    expect(api.globalConfig.value.targets.canvas.paths.light).toBe('C:/bg/b.webp')
    expect(api.globalConfig.value.targets.canvas.enabled).toBe(false)
    // 替换旧文件
    expect(core.removeBackgroundFile).toHaveBeenCalledWith('C:/bg/a.webp')
  })

  it('项目范围选图写入相对路径并保存项目配置', async () => {
    const w = await mountCard()
    await canvasCard(w).trigger('click')
    await scopeButton(w, '本项目').trigger('click')
    await w.find('.bg-project__btn').trigger('click')
    await flushPromises()
    core.pickAndSaveBackground.mockResolvedValue({
      ok: true,
      path: 'C:/proj/worlddata/.worldsea/backgrounds/background-canvas-light-1.webp',
      relativePath: '.worldsea/backgrounds/background-canvas-light-1.webp',
      src: 'asset://p/light.webp',
    })
    await w.find('.bg-slot--light .bg-slot__pick').trigger('click')
    await flushPromises()
    const cfg = api.projectConfig.value?.targets.canvas
    expect(cfg?.paths.light).toBe('.worldsea/backgrounds/background-canvas-light-1.webp')
    expect(api.globalConfig.value.targets.canvas.paths.light).toBe('')
    expect(core.pickAndSaveBackground).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'project',
      projectDir: 'C:/proj/worlddata',
      target: 'canvas',
      theme: 'light',
    }))
    expect(core.writeProjectBackground).toHaveBeenLastCalledWith('C:/proj/worlddata', expect.objectContaining({
      version: 1,
      targets: expect.objectContaining({
        canvas: expect.objectContaining({
          paths: { light: '.worldsea/backgrounds/background-canvas-light-1.webp', dark: '' },
        }),
      }),
    }))
  })

  it('项目范围跟随全局时控件只读；本项目自定义后可编辑', async () => {
    api.updateTarget('canvas', { enabled: true, paths: { light: 'C:/g.webp', dark: '' } }, 'global')
    const w = await mountCard()
    await canvasCard(w).trigger('click')
    await scopeButton(w, '本项目').trigger('click')
    expect(w.text()).toContain('当前跟随全局')
    expect(w.find('input[aria-label="启用背景"]').attributes('disabled')).toBeDefined()
    expect(w.find('.bg-slot--light .bg-slot__pick').attributes('disabled')).toBeDefined()
    await w.find('.bg-project__btn').trigger('click')
    await flushPromises()
    expect(w.find('.bg-slot--light .bg-slot__pick').attributes('disabled')).toBeUndefined()
    expect(w.text()).toContain('请为本项目重新选择图片')
  })

  it('亮/暗两槽分别显示缺失提示，一槽缺失时另一槽仍可选择', async () => {
    api.setTargetImage('canvas', 'light', { path: 'C:/bg/a.webp', src: 'asset://a.webp' }, 'global')
    api.setTargetImage('canvas', 'dark', { path: 'C:/bg/b.webp', src: 'asset://b.webp' }, 'global')
    api.markMissing('canvas', 'light', 'global')
    const w = await mountCard()
    await canvasCard(w).trigger('click')
    expect(w.findAll('.bg-slot--light .bg-error').length).toBe(1)
    expect(w.findAll('.bg-slot--dark .bg-error').length).toBe(0)
    expect(w.find('.bg-slot--dark .bg-slot__pick').attributes('disabled')).toBeUndefined()
    core.pickAndSaveBackground.mockResolvedValue({ ok: true, path: 'C:/bg/c.webp', src: 'asset://c.webp' })
    await w.find('.bg-slot--dark .bg-slot__pick').trigger('click')
    await flushPromises()
    expect(api.globalConfig.value.targets.canvas.paths.dark).toBe('C:/bg/c.webp')
  })

  it('分区目标不显示填充/焦点控件；大背景/首页显示', async () => {
    const w = await mountCard()
    // 默认选中窗口栏：结构目标不显示填充与焦点
    expect(w.find('.bg-editor__head').text()).toBe('窗口栏')
    expect(w.find('.bg-fit').exists()).toBe(false)
    expect(w.find('.bg-focus').exists()).toBe(false)
    await canvasCard(w).trigger('click')
    expect(w.find('.bg-fit').exists()).toBe(true)
    expect(w.find('.bg-focus').exists()).toBe(true)
    await mapRegion(w, '侧栏').trigger('click')
    expect(w.find('.bg-fit').exists()).toBe(false)
    expect(w.find('.bg-focus').exists()).toBe(false)
    await switchMap(w, '首页').trigger('click')
    expect(w.find('.bg-fit').exists()).toBe(true)
    expect(w.find('.bg-focus').exists()).toBe(true)
  })

  it('参数修改写入当前目标并持久化全局配置', async () => {
    api.setTargetImage('canvas', 'light', { path: 'C:/bg/a.webp', src: 'asset://a.webp' }, 'global')
    api.setTargetImage('home', 'light', { path: 'C:/bg/home.webp', src: 'asset://home.webp' }, 'global')
    const w = await mountCard()
    await canvasCard(w).trigger('click')
    await w.find('.bg-fit').setValue('contain')
    await switchMap(w, '首页').trigger('click')
    await w.find('.bg-fit').setValue('tile')
    expect(api.globalConfig.value.targets.canvas.fit).toBe('contain')
    expect(api.globalConfig.value.targets.home.fit).toBe('tile')
    const saved = JSON.parse(localStorage.getItem('worldsea_background_v2')!)
    expect(saved.targets.canvas.fit).toBe('contain')
  })

  it('地图切首页自动选中首页；切回工作台恢复上次结构目标', async () => {
    const w = await mountCard()
    expect(w.find('.bg-editor__head').text()).toBe('窗口栏')
    await mapRegion(w, '侧栏').trigger('click')
    expect(w.find('.bg-editor__head').text()).toBe('侧栏')
    await switchMap(w, '首页').trigger('click')
    expect(w.find('.bg-map__home.is-selected').exists()).toBe(true)
    expect(w.find('.bg-editor__head').text()).toBe('首页')
    await switchMap(w, '工作台').trigger('click')
    expect(mapRegion(w, '侧栏').classes()).toContain('is-selected')
    expect(w.find('.bg-editor__head').text()).toBe('侧栏')
  })

  it('大背景卡片选中 canvas，地图当前页保留但无选中区域', async () => {
    const w = await mountCard()
    await canvasCard(w).trigger('click')
    expect(w.find('.bg-editor__head').text()).toBe('大背景')
    expect(w.find('.bg-canvas-card.is-selected').exists()).toBe(true)
    expect(w.findAll('.bg-map__region.is-selected').length).toBe(0)
    // canvas 不改地图：仍停在首页切换后的原地图上
    await switchMap(w, '首页').trigger('click')
    await canvasCard(w).trigger('click')
    expect(w.find('.bg-map__home.is-selected').exists()).toBe(false)
    expect(w.find('.bg-canvas-card.is-selected').exists()).toBe(true)
  })

  it('选图期间锁定地图区域、地图切换与大背景卡片', async () => {
    let resolvePick!: (value: unknown) => void
    core.pickAndSaveBackground.mockReturnValue(new Promise((resolve) => { resolvePick = resolve }))
    const w = await mountCard()
    await w.find('.bg-slot--light .bg-slot__pick').trigger('click')
    await flushPromises()
    expect(mapRegion(w, '侧栏').attributes('disabled')).toBeDefined()
    expect(switchMap(w, '首页').attributes('disabled')).toBeDefined()
    expect(canvasCard(w).attributes('disabled')).toBeDefined()
    resolvePick(null)
    await flushPromises()
    expect(mapRegion(w, '侧栏').attributes('disabled')).toBeUndefined()
    expect(canvasCard(w).attributes('disabled')).toBeUndefined()
  })

  it('选中工具条时提示仅随流工具条生效', async () => {
    const w = await mountCard()
    expect(w.text()).not.toContain('悬浮胶囊')
    await mapRegion(w, '工具条').trigger('click')
    expect(w.find('.bg-editor__head').text()).toBe('工具条')
    expect(w.text()).toContain('工具条背景仅在使用随流工具条（bar）的视图生效；悬浮胶囊与隐藏工具条不套背景。')
  })

  it('项目跟随/自定义作用于当前选中的工具条目标', async () => {
    api.updateTarget('content-toolbar', { dim: 44, enabled: true }, 'global')
    const w = await mountCard()
    await mapRegion(w, '工具条').trigger('click')
    await scopeButton(w, '本项目').trigger('click')
    expect(w.text()).toContain('当前跟随全局')
    await w.find('.bg-project__btn').trigger('click')
    await flushPromises()
    const cfg = api.projectConfig.value?.targets['content-toolbar']
    expect(cfg?.dim).toBe(44)
    expect(cfg?.paths).toEqual({ light: '', dark: '' })
    expect(core.writeProjectBackground).toHaveBeenLastCalledWith('C:/proj/worlddata', expect.objectContaining({
      targets: expect.objectContaining({ 'content-toolbar': expect.objectContaining({ dim: 44 }) }),
    }))
    await w.find('.bg-project__btn').trigger('click')
    await flushPromises()
    expect(api.projectConfig.value?.targets['content-toolbar']).toBeUndefined()
  })

  it('无项目时「本项目」禁用并提示；切项目后重新加载项目配置', async () => {
    env.projectDir = ''
    const w = await mountCard()
    const projectScope = scopeButton(w, '本项目')
    expect(projectScope.attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('未打开项目')
    core.readProjectBackground.mockResolvedValue({
      version: 1,
      targets: {
        canvas: { ...defaultTargets(), enabled: true, paths: { light: '.worldsea/backgrounds/a.webp', dark: '' } },
      },
    })
    core.resolveProjectBackgroundAssets.mockResolvedValue({
      srcs: { canvas: { light: 'asset://p/a.webp', dark: null } },
      missing: { canvas: { light: false, dark: false } },
    })
    env.projectDir = 'C:/other/worlddata'
    boundDir().value = 'C:/other'
    await flushPromises()
    expect(core.readProjectBackground).toHaveBeenCalledWith('C:/other/worlddata')
    expect(api.projectConfig.value?.targets.canvas?.enabled).toBe(true)
    expect(scopeButton(w, '本项目').attributes('disabled')).toBeUndefined()
  })

  it('在途项目加载不覆盖之后的自定义操作', async () => {
    let resolveAssets!: (value: unknown) => void
    core.readProjectBackground.mockResolvedValue({
      version: 1,
      targets: {
        canvas: { ...defaultTargets(), enabled: true, paths: { light: '.worldsea/backgrounds/a.webp', dark: '' } },
      },
    })
    core.resolveProjectBackgroundAssets.mockReturnValue(new Promise((resolve) => { resolveAssets = resolve }))
    const w = await mountCard()
    // 资源解析未返回时用户点「本项目自定义」：旧加载必须作废
    await canvasCard(w).trigger('click')
    await scopeButton(w, '本项目').trigger('click')
    await w.find('.bg-project__btn').trigger('click')
    await flushPromises()
    resolveAssets({
      srcs: { canvas: { light: 'asset://p/a.webp', dark: null } },
      missing: { canvas: { light: false, dark: false } },
    })
    await flushPromises()
    const cfg = api.projectConfig.value?.targets.canvas
    expect(cfg?.paths).toEqual({ light: '', dark: '' })
    expect(cfg?.enabled).toBe(false)
  })

  it('项目范围参数落盘使用捕获的项目目录', async () => {
    mockProjectLoad(
      { canvas: { ...defaultTargets(), enabled: true, paths: { light: '.worldsea/backgrounds/a.webp', dark: '' } } },
      { srcs: { canvas: { light: 'asset://p/a.webp', dark: null } }, missing: { canvas: { light: false, dark: false } } },
    )
    const w = await mountCard()
    await canvasCard(w).trigger('click')
    await scopeButton(w, '本项目').trigger('click')
    core.writeProjectBackground.mockClear()
    // 启用开关：改完即落盘
    await w.find('input[aria-label="启用背景"]').setValue(false)
    expect(core.writeProjectBackground).toHaveBeenLastCalledWith('C:/proj/worlddata', expect.objectContaining({
      targets: expect.objectContaining({ canvas: expect.objectContaining({ enabled: false }) }),
    }))
    core.writeProjectBackground.mockClear()
    // 暗化：input 只调度 150ms 防抖，落盘快照带捕获的项目目录
    const dim = w.find('input[aria-label="暗化"]')
    ;(dim.element as HTMLInputElement).value = '52'
    await dim.trigger('input')
    expect(core.writeProjectBackground).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(core.writeProjectBackground).toHaveBeenCalledTimes(1)
    expect(core.writeProjectBackground).toHaveBeenLastCalledWith('C:/proj/worlddata', expect.objectContaining({
      targets: expect.objectContaining({ canvas: expect.objectContaining({ dim: 52 }) }),
    }))
  })

  it('项目范围保存成功后按配置引用清理孤儿背景', async () => {
    mockProjectLoad(
      { canvas: { ...defaultTargets(), enabled: true, paths: { light: '.worldsea/backgrounds/a.webp', dark: '' } } },
      { srcs: { canvas: { light: 'asset://p/a.webp', dark: null } }, missing: { canvas: { light: false, dark: false } } },
    )
    const w = await mountCard()
    await canvasCard(w).trigger('click')
    await scopeButton(w, '本项目').trigger('click')
    core.writeProjectBackground.mockClear()
    core.cleanupProjectBackgroundOrphans.mockClear()
    // 暗化防抖落盘后，清理收到项目目录与配置引用的相对路径
    const dim = w.find('input[aria-label="暗化"]')
    ;(dim.element as HTMLInputElement).value = '41'
    await dim.trigger('input')
    expect(core.cleanupProjectBackgroundOrphans).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 200))
    await flushPromises()
    expect(core.writeProjectBackground).toHaveBeenCalledTimes(1)
    expect(core.cleanupProjectBackgroundOrphans).toHaveBeenCalledWith(
      'C:/proj/worlddata',
      ['.worldsea/backgrounds/a.webp'],
    )
  })

  it('切换项目前把旧项目挂起快照写到旧目录', async () => {
    mockProjectLoad(
      { canvas: { ...defaultTargets(), enabled: true, paths: { light: '.worldsea/backgrounds/a.webp', dark: '' } } },
      { srcs: { canvas: { light: 'asset://p/a.webp', dark: null } }, missing: { canvas: { light: false, dark: false } } },
    )
    const w = await mountCard()
    await canvasCard(w).trigger('click')
    await scopeButton(w, '本项目').trigger('click')
    core.writeProjectBackground.mockClear()
    const dim = w.find('input[aria-label="暗化"]')
    ;(dim.element as HTMLInputElement).value = '61'
    await dim.trigger('input')
    expect(core.writeProjectBackground).not.toHaveBeenCalled()
    // 防抖未触发就切项目：旧快照立即写旧目录，定时器不得把旧配置写进新项目
    core.readProjectBackground.mockResolvedValue(null)
    env.projectDir = 'C:/other/worlddata'
    boundDir().value = 'C:/other'
    await flushPromises()
    expect(core.writeProjectBackground).toHaveBeenCalledTimes(1)
    expect(core.writeProjectBackground).toHaveBeenLastCalledWith('C:/proj/worlddata', expect.objectContaining({
      targets: expect.objectContaining({ canvas: expect.objectContaining({ dim: 61 }) }),
    }))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(core.writeProjectBackground).toHaveBeenCalledTimes(1)
  })

  it('项目范围替换图片删除旧相对路径文件', async () => {
    mockProjectLoad(
      { canvas: { ...defaultTargets(), enabled: true, paths: { light: '.worldsea/backgrounds/background-canvas-light-1.webp', dark: '' } } },
      { srcs: { canvas: { light: 'asset://p/1.webp', dark: null } }, missing: { canvas: { light: false, dark: false } } },
    )
    const w = await mountCard()
    await canvasCard(w).trigger('click')
    await scopeButton(w, '本项目').trigger('click')
    core.pickAndSaveBackground.mockResolvedValue({
      ok: true,
      path: 'C:/proj/worlddata/.worldsea/backgrounds/background-canvas-light-2.webp',
      relativePath: '.worldsea/backgrounds/background-canvas-light-2.webp',
      src: 'asset://p/2.webp',
    })
    await w.find('.bg-slot--light .bg-slot__pick').trigger('click')
    await flushPromises()
    expect(api.projectConfig.value?.targets.canvas?.paths.light)
      .toBe('.worldsea/backgrounds/background-canvas-light-2.webp')
    expect(core.removeProjectBackgroundFile).toHaveBeenCalledWith(
      'C:/proj/worlddata',
      '.worldsea/backgrounds/background-canvas-light-1.webp',
    )
    expect(core.writeProjectBackground).toHaveBeenLastCalledWith('C:/proj/worlddata', expect.objectContaining({
      version: 1,
      targets: expect.objectContaining({
        canvas: expect.objectContaining({
          paths: { light: '.worldsea/backgrounds/background-canvas-light-2.webp', dark: '' },
        }),
      }),
    }))
  })

  it('项目范围缺失提示按项目运行时态显示', async () => {
    mockProjectLoad(
      { canvas: { ...defaultTargets(), enabled: true, paths: { light: '.worldsea/backgrounds/background-canvas-light-1.webp', dark: '' } } },
      { srcs: { canvas: { light: null, dark: null } }, missing: { canvas: { light: true, dark: false } } },
    )
    const w = await mountCard()
    await canvasCard(w).trigger('click')
    await scopeButton(w, '本项目').trigger('click')
    expect(w.findAll('.bg-slot--light .bg-error').length).toBe(1)
    expect(w.findAll('.bg-slot--dark .bg-error').length).toBe(0)
  })
})
