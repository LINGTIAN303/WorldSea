/**
 * preview_file 工具单测（2026-09-14 文件触达「最后一米」）
 *
 * 覆盖：Tauri 路径成功推送（事件 detail = FsNode 形状）/ 文件不存在（cmd_fs_stat
 * 对不存在路径直接 Err，catch 即不存在）/ 目录拒绝 / Web 模式明确报错 /
 * 缺参 / 路径基名提取（兼容正反斜杠）。
 *
 * 测试环境 jsdom（window 可用）。Tauri 判定走 window.__TAURI_INTERNALS__
 * （execution/index.ts isTauri），@tauri-apps/api/core 用 vi.mock 拦截动态导入。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...a),
}))

import { previewFileTool } from '../preview-file'

/** 收集 worldsea:preview-file 事件的 detail */
function collectPreviewEvents(): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = []
  window.addEventListener('worldsea:preview-file', (e) => {
    events.push((e as CustomEvent).detail)
  })
  return events
}

describe('preview_file', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  })

  it('Tauri 模式：stat 成功 → 派发事件 + ok:true，detail 为 FsNode 形状', async () => {
    invokeMock.mockResolvedValue({ isDir: false, isFile: true, size: 12345, modified: '2026-09-14', created: null, readonly: false })
    const events = collectPreviewEvents()

    const result = JSON.parse(await previewFileTool.execute({ path: 'D:/world/设定集/种族志.docx' }, {} as never))

    expect(invokeMock).toHaveBeenCalledWith('cmd_fs_stat', { path: 'D:/world/设定集/种族志.docx' })
    expect(result.ok).toBe(true)
    expect(result.name).toBe('种族志.docx')
    expect(result.size).toBe(12345)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      name: '种族志.docx',
      path: 'D:/world/设定集/种族志.docx',
      isDir: false,
      size: 12345,
      modified: '2026-09-14',
    })
  })

  it('反斜杠路径：name 取最后一段', async () => {
    invokeMock.mockResolvedValue({ isDir: false, size: 1, modified: null })
    const events = collectPreviewEvents()

    const result = JSON.parse(await previewFileTool.execute({ path: 'D:\\world\\img\\map.png' }, {} as never))

    expect(result.ok).toBe(true)
    expect(result.name).toBe('map.png')
    expect(events[0]).toMatchObject({ name: 'map.png', path: 'D:\\world\\img\\map.png' })
  })

  it('文件不存在（stat Err）→ ok:false 且不派发事件', async () => {
    invokeMock.mockRejectedValue(new Error('No such file'))
    const events = collectPreviewEvents()

    const result = JSON.parse(await previewFileTool.execute({ path: 'D:/not/exist.pdf' }, {} as never))

    expect(result.ok).toBe(false)
    expect(result.error).toContain('不存在')
    expect(events).toHaveLength(0)
  })

  it('路径是目录 → 拒绝预览', async () => {
    invokeMock.mockResolvedValue({ isDir: true, size: 0, modified: null })
    const events = collectPreviewEvents()

    const result = JSON.parse(await previewFileTool.execute({ path: 'D:/world/docs' }, {} as never))

    expect(result.ok).toBe(false)
    expect(result.error).toContain('目录')
    expect(events).toHaveLength(0)
  })

  it('缺少 path 参数 → ok:false', async () => {
    const result = JSON.parse(await previewFileTool.execute({}, {} as never))
    expect(result.ok).toBe(false)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('Web 模式（无 Tauri）→ 明确报错「仅桌面端」', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    delete (window as unknown as Record<string, unknown>).__TAURI__
    // preview-file.ts 的 _invoke 模块级缓存会跨用例残留，重置模块取新实例
    vi.resetModules()
    const mod = await import('../preview-file')

    const result = JSON.parse(await mod.previewFileTool.execute({ path: 'D:/x.pdf' }, {} as never))

    expect(result.ok).toBe(false)
    expect(result.error).toContain('桌面端')
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
