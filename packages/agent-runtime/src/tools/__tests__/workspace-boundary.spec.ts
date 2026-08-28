/** workspace-boundary 单测：workdir 词法边界 + E1 受保护目录写守卫（任务29/M2） */

import { describe, expect, it } from 'vitest'
import type { IToolContext } from '../../toolbus/types'
import {
  isProtectedProjectPath,
  isWithinDirectory,
  joinFsPath,
  normalizeFsPath,
  resolveWithinWorkspace,
  resolveWriteWithinWorkspace,
} from '../workspace-boundary'

/** 构造最小 IToolContext（边界函数只消费 workspace.workdir） */
function ctxWith(workdir?: string): IToolContext {
  return { workspace: workdir ? { workdir } : {} } as unknown as IToolContext
}

const WIN_WORKDIR = 'C:/proj'

describe('基础词法工具', () => {
  it('normalizeFsPath：反斜杠归一 + 去尾斜杠', () => {
    expect(normalizeFsPath('C:\\proj\\a\\')).toBe('C:/proj/a')
    expect(normalizeFsPath('/')).toBe('/')
  })

  it('joinFsPath：拼接并去子路径前导斜杠', () => {
    expect(joinFsPath('C:\\proj', '/notes.md')).toBe('C:/proj/notes.md')
  })

  it('isWithinDirectory：前缀判定且不误匹配同级目录', () => {
    expect(isWithinDirectory('C:/proj', 'C:/proj/a.json')).toBe(true)
    expect(isWithinDirectory('C:/proj', 'C:/proj2/a.json')).toBe(false)
  })
})

describe('resolveWithinWorkspace（读类边界）', () => {
  it('无 workdir → 原样放行（显式未加固）', () => {
    const r = resolveWithinWorkspace(ctxWith(undefined), 'C:/anywhere/x.json')
    expect(r.ok).toBe(true)
    expect(r.path).toBe('C:/anywhere/x.json')
  })

  it('相对路径 → join workdir', () => {
    const r = resolveWithinWorkspace(ctxWith(WIN_WORKDIR), 'notes/todo.md')
    expect(r.ok).toBe(true)
    expect(r.path).toBe('C:/proj/notes/todo.md')
  })

  it('绝对路径在 workdir 内 → 原样', () => {
    const r = resolveWithinWorkspace(ctxWith(WIN_WORKDIR), 'C:\\proj\\a.json')
    expect(r.ok).toBe(true)
    expect(r.path).toBe('C:\\proj\\a.json')
  })

  it('绝对路径越出 workdir → 拒绝', () => {
    const r = resolveWithinWorkspace(ctxWith(WIN_WORKDIR), 'C:/other/a.json')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('workspace')
  })
})

describe('isProtectedProjectPath（E1 判定）', () => {
  it('workdir/entities/ 下 → 保护', () => {
    expect(isProtectedProjectPath(WIN_WORKDIR, 'C:/proj/entities/角色_abc123.json')).toBe(true)
  })

  it('workdir/.worldsmith/ 下 → 保护', () => {
    expect(isProtectedProjectPath(WIN_WORKDIR, 'C:/proj/.worldsmith/kv_store.json')).toBe(true)
  })

  it('大小写变体（Windows 语义）→ 保护', () => {
    expect(isProtectedProjectPath(WIN_WORKDIR, 'C:/proj/Entities/x.json')).toBe(true)
  })

  it('受保护目录本身 → 保护', () => {
    expect(isProtectedProjectPath(WIN_WORKDIR, 'C:/proj/entities')).toBe(true)
  })

  it('workdir 普通文件 → 不保护', () => {
    expect(isProtectedProjectPath(WIN_WORKDIR, 'C:/proj/notes.md')).toBe(false)
  })

  it('workdir 之外 → 不由 E1 管（边界由 resolveWithinWorkspace 拒）', () => {
    expect(isProtectedProjectPath(WIN_WORKDIR, 'C:/other/entities/x.json')).toBe(false)
  })
})

describe('resolveWriteWithinWorkspace（写类守卫）', () => {
  it('无 workdir → 原样放行（无从判定保护目录）', () => {
    const r = resolveWriteWithinWorkspace(ctxWith(undefined), 'C:/proj/entities/x.json')
    expect(r.ok).toBe(true)
  })

  it('相对路径落 entities/ → 归一后拒绝并引导语义层', () => {
    const r = resolveWriteWithinWorkspace(ctxWith(WIN_WORKDIR), 'entities/角色.json')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('entity_create')
    expect(r.path).toBe('C:/proj/entities/角色.json')
  })

  it('entities/ 下写文件 → 拒绝', () => {
    const r = resolveWriteWithinWorkspace(ctxWith(WIN_WORKDIR), 'C:/proj/entities/hero_abc.json')
    expect(r.ok).toBe(false)
  })

  it('.worldsmith/ 下删除 → 拒绝', () => {
    const r = resolveWriteWithinWorkspace(ctxWith(WIN_WORKDIR), 'C:/proj/.worldsmith/files_meta.json')
    expect(r.ok).toBe(false)
  })

  it('workdir 普通路径 → 放行', () => {
    const r = resolveWriteWithinWorkspace(ctxWith(WIN_WORKDIR), 'C:/proj/notes/todo.md')
    expect(r.ok).toBe(true)
    expect(r.path).toBe('C:/proj/notes/todo.md')
  })

  it('越出 workdir → 先被边界拒绝（非 E1 理由）', () => {
    const r = resolveWriteWithinWorkspace(ctxWith(WIN_WORKDIR), 'C:/other/entities/x.json')
    expect(r.ok).toBe(false)
    expect(r.reason).not.toContain('entity_create')
  })
})
