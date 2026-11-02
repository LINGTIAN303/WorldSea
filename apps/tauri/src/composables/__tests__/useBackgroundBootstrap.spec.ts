/**
 * 背景启动引导单测：全局 src 注入 / 项目覆盖加载与清空 / 竞态 token。
 * Tauri 与 entity-core 资产层全部打桩，只验证 bootstrap 自身的装配语义。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  isTauri: vi.fn(() => true),
  getFileStorageBackend: vi.fn(),
  resolveBackgroundSrc: vi.fn(),
  cleanupGlobalBackgroundOrphans: vi.fn(),
  readProjectBackground: vi.fn(),
  resolveProjectBackgroundAssets: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: mocks.convertFileSrc }))
vi.mock('@worldsea/entity-core/core', () => ({
  isTauri: mocks.isTauri,
  getFileStorageBackend: mocks.getFileStorageBackend,
  resolveBackgroundSrc: mocks.resolveBackgroundSrc,
  cleanupGlobalBackgroundOrphans: mocks.cleanupGlobalBackgroundOrphans,
  readProjectBackground: mocks.readProjectBackground,
  resolveProjectBackgroundAssets: mocks.resolveProjectBackgroundAssets,
}))

import { BACKGROUND_TARGETS, useBackground } from '@worldsea/style-kit'
import {
  clearProjectBackground, hydrateGlobalBackground, loadProjectBackgroundForCurrentProject,
  validateGlobalBackground,
} from '../useBackgroundBootstrap'

const api = useBackground()

beforeEach(() => {
  localStorage.clear()
  api.setProjectConfig(null)
  // 全局配置是模块单例：逐目标清空路径、srcs 与启用态，避免用例间串扰
  for (const target of BACKGROUND_TARGETS) {
    api.updateTarget(target, { enabled: false, paths: { light: '', dark: '' } }, 'global')
    api.setTargetSrcs(target, { light: '', dark: '' }, 'global')
  }
  mocks.isTauri.mockReturnValue(true)
  mocks.getFileStorageBackend.mockReturnValue({ projectDir: 'D:/proj' })
  mocks.convertFileSrc.mockClear()
  mocks.readProjectBackground.mockReset()
  mocks.resolveProjectBackgroundAssets.mockReset()
  mocks.resolveBackgroundSrc.mockReset()
  mocks.cleanupGlobalBackgroundOrphans.mockReset()
})

describe('hydrateGlobalBackground', () => {
  it('把全局亮/暗路径换成 asset URL，并写根属性', () => {
    api.updateTarget('home', {
      enabled: true,
      paths: { light: 'C:/bg/home-light.webp', dark: 'C:/bg/home-dark.webp' },
    }, 'global')

    hydrateGlobalBackground()

    expect(mocks.convertFileSrc).toHaveBeenCalledWith('C:/bg/home-light.webp')
    expect(mocks.convertFileSrc).toHaveBeenCalledWith('C:/bg/home-dark.webp')
    expect(api.srcs.value.home).toEqual({
      light: 'asset://C:/bg/home-light.webp',
      dark: 'asset://C:/bg/home-dark.webp',
    })
    expect(document.documentElement.dataset.wsBgHome).toBe('on')
    expect(document.documentElement.style.getPropertyValue('--ws-bg-home-image-light'))
      .toBe('url("asset://C:/bg/home-light.webp")')
  })

  it('非 Tauri 环境跳过，不触碰 convertFileSrc', () => {
    api.updateTarget('home', { enabled: true, paths: { light: 'C:/bg/home.webp', dark: '' } }, 'global')
    mocks.isTauri.mockReturnValue(false)

    hydrateGlobalBackground()

    expect(mocks.convertFileSrc).not.toHaveBeenCalled()
    expect(api.srcs.value.home).toEqual({ light: '', dark: '' })
  })
})

describe('validateGlobalBackground', () => {
  it('成功路径写 src、失败路径只标缺失，孤儿清理收到全部非空全局路径', async () => {
    api.updateTarget('canvas', { enabled: true, paths: { light: 'C:/bg/canvas-light.webp', dark: '' } }, 'global')
    api.updateTarget('home', { enabled: true, paths: { light: 'C:/bg/home-light.webp', dark: '' } }, 'global')
    api.updateTarget('sidebar', {
      enabled: true,
      paths: { light: 'C:/bg/side-light.webp', dark: 'C:/bg/side-dark.webp' },
    }, 'global')
    mocks.resolveBackgroundSrc.mockImplementation(async (path: string) =>
      (path.endsWith('side-dark.webp') ? null : `asset://${path}`))
    mocks.cleanupGlobalBackgroundOrphans.mockResolvedValue(undefined)

    await validateGlobalBackground()

    expect(api.srcs.value.canvas.light).toBe('asset://C:/bg/canvas-light.webp')
    expect(api.srcs.value.home.light).toBe('asset://C:/bg/home-light.webp')
    // 失效路径清空该槽 src 并记缺失，同目标另一主题不受影响
    expect(api.srcs.value.sidebar).toEqual({ light: 'asset://C:/bg/side-light.webp', dark: '' })
    expect(api.missing.value.sidebar.dark).toBe(true)
    expect(api.missing.value.home).toEqual({ light: false, dark: false })

    expect(mocks.cleanupGlobalBackgroundOrphans).toHaveBeenCalledTimes(1)
    const referenced = mocks.cleanupGlobalBackgroundOrphans.mock.calls[0][0]
    expect(typeof referenced).toBe('function')
    expect(referenced()).toEqual([
      'C:/bg/canvas-light.webp',
      'C:/bg/home-light.webp',
      'C:/bg/side-light.webp',
      'C:/bg/side-dark.webp',
    ])
  })

  it('非 Tauri 环境不解析也不清理', async () => {
    api.updateTarget('home', { enabled: true, paths: { light: 'C:/bg/home.webp', dark: '' } }, 'global')
    mocks.isTauri.mockReturnValue(false)

    await validateGlobalBackground()

    expect(mocks.resolveBackgroundSrc).not.toHaveBeenCalled()
    expect(mocks.cleanupGlobalBackgroundOrphans).not.toHaveBeenCalled()
  })
})

describe('loadProjectBackgroundForCurrentProject', () => {
  it('加载项目覆盖：写入 projectConfig、srcs 与缺失态', async () => {
    mocks.readProjectBackground.mockResolvedValue({
      version: 1,
      targets: {
        canvas: {
          enabled: true,
          paths: {
            light: '.worldsea/backgrounds/canvas-light-1.webp',
            dark: '.worldsea/backgrounds/canvas-dark-1.webp',
          },
        },
      },
    })
    mocks.resolveProjectBackgroundAssets.mockResolvedValue({
      srcs: { canvas: { light: 'asset://proj/light.webp', dark: null } },
      missing: { canvas: { light: false, dark: true } },
    })

    await loadProjectBackgroundForCurrentProject()

    expect(mocks.readProjectBackground).toHaveBeenCalledWith('D:/proj')
    expect(mocks.resolveProjectBackgroundAssets).toHaveBeenCalledWith('D:/proj', [
      { target: 'canvas', theme: 'light', path: '.worldsea/backgrounds/canvas-light-1.webp' },
      { target: 'canvas', theme: 'dark', path: '.worldsea/backgrounds/canvas-dark-1.webp' },
    ])
    expect(api.projectConfig.value?.targets.canvas?.enabled).toBe(true)
    expect(api.srcs.value.canvas).toEqual({ light: 'asset://proj/light.webp', dark: '' })
    expect(api.missing.value.canvas).toEqual({ light: false, dark: true })
    expect(api.effective.value.canvas.enabled).toBe(true)
  })

  it('无项目目录时清空覆盖且不读配置文件', async () => {
    mocks.getFileStorageBackend.mockReturnValue(null)

    await loadProjectBackgroundForCurrentProject()

    expect(api.projectConfig.value).toBeNull()
    expect(mocks.readProjectBackground).not.toHaveBeenCalled()
  })

  it('旧异步结果在清空后到达时被 generation token 丢弃', async () => {
    let resolveRead!: (value: unknown) => void
    mocks.readProjectBackground.mockReturnValue(new Promise((resolve) => { resolveRead = resolve }))

    const pending = loadProjectBackgroundForCurrentProject()
    clearProjectBackground()
    resolveRead({ version: 1, targets: { canvas: { enabled: true, paths: { light: 'rel.webp' } } } })
    await pending

    expect(api.projectConfig.value).toBeNull()
    expect(mocks.resolveProjectBackgroundAssets).not.toHaveBeenCalled()
  })
})

describe('clearProjectBackground', () => {
  it('移除项目覆盖并回落到全局 srcs', async () => {
    mocks.readProjectBackground.mockResolvedValue({
      version: 1,
      targets: { sidebar: { enabled: true, paths: { light: '.worldsea/backgrounds/sidebar-light-1.webp' } } },
    })
    mocks.resolveProjectBackgroundAssets.mockResolvedValue({
      srcs: { sidebar: { light: 'asset://proj/sidebar.webp', dark: null } },
      missing: { sidebar: { light: false, dark: false } },
    })
    await loadProjectBackgroundForCurrentProject()
    expect(api.projectConfig.value?.targets.sidebar).toBeTruthy()
    expect(api.srcs.value.sidebar.light).toBe('asset://proj/sidebar.webp')

    clearProjectBackground()

    expect(api.projectConfig.value).toBeNull()
    expect(api.srcs.value.sidebar).toEqual({ light: '', dark: '' })
    expect(document.documentElement.dataset.wsBgSidebar).toBeUndefined()
  })
})
