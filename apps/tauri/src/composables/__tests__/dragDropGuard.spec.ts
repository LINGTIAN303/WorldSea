/**
 * dragDropGuard 单测 —— 全局文件拖拽兜底的判定。
 *
 * 这层兜底只在 `dragDropEnabled: false` 之后才有意义（见模块头注释）：
 * 关掉宿主劫持后，文件拖到非落点区域会让 webview **导航到该文件**，必须自己挡。
 * 判定只认 `types` 里有没有 `Files`，故不误伤页面内的节点拖拽（自定义 MIME）。
 */
import { describe, it, expect } from 'vitest'
import { carriesFiles } from '../dragDropGuard'

function dt(types: string[]): DataTransfer {
  return { types } as unknown as DataTransfer
}

describe('dragDropGuard / carriesFiles', () => {
  it('types 含 Files → 判定为文件拖拽（需要兜底）', () => {
    expect(carriesFiles(dt(['Files']))).toBe(true)
    expect(carriesFiles(dt(['text/plain', 'Files']))).toBe(true)
  })

  it('页面内节点拖拽（自定义 MIME）→ 不判定为文件，兜底不介入', () => {
    expect(carriesFiles(dt(['application/x-worldsea-outline-node']))).toBe(false)
    expect(carriesFiles(dt(['text/plain']))).toBe(false)
  })

  it('空 / 缺失 → false（不抛错，也不误 preventDefault）', () => {
    expect(carriesFiles(dt([]))).toBe(false)
    expect(carriesFiles(null)).toBe(false)
    expect(carriesFiles(undefined)).toBe(false)
  })
})
