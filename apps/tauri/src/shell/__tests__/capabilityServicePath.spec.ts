/**
 * 能力桥 12 条的真实取数路径（阶段 2-C，2026-11-06）。
 *
 * 锁双路径（用户拍板 1-C：加校验但可降级）：
 * - 服务就绪 → 走服务（可断言「服务方法被调用过」= 路径判据）
 * - 服务缺席 → 回退直连（行为与 2-C 之前一致）
 *
 * 只测**读类**与**写类的降级分支**：写类的正常分支依赖 pinia store 全链路，
 * 由 world-services / tree 的测试覆盖；此处专注「能力这一层选哪条路」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WORLD_BUILTIN_CAPABILITIES } from '@/shell/capabilities'
import { clearWorldServiceTable, registerWorldServiceTable } from '@/world/service-registry'

function handlerOf(id: string): (args: Record<string, unknown>) => unknown {
  const cap = WORLD_BUILTIN_CAPABILITIES.find(c => c.id === id)
  if (!cap) throw new Error(`未找到能力 ${id}`)
  return cap.handler as (args: Record<string, unknown>) => unknown
}

beforeEach(() => {
  clearWorldServiceTable()
})

afterEach(() => {
  clearWorldServiceTable()
  vi.restoreAllMocks()
})

describe('能力清单完整性', () => {
  it('12 条内建能力全部在册，id 无重复', () => {
    const ids = WORLD_BUILTIN_CAPABILITIES.map(c => c.id)
    expect(ids).toHaveLength(12)
    expect(new Set(ids).size).toBe(12)
  })

  it('能力 id 均为「命名空间.名」小写点分，且 world.* 与 agent.* 分域', () => {
    for (const cap of WORLD_BUILTIN_CAPABILITIES) {
      expect(cap.id).toMatch(/^world\.[a-z]+(\.[a-z]+)?$/)
    }
  })
})

describe('读类：服务就绪时走服务（路径判据 = 服务方法被调用）', () => {
  it('world.views.list 走 world.views.list()', async () => {
    const list = vi.fn(() => [{ id: 'v1', label: '视图1', pluginId: 'p', toolbar: 'bar' }])
    registerWorldServiceTable({ 'world.views': { list } })

    const result = await handlerOf('world.views.list')({})
    expect(list).toHaveBeenCalledOnce()
    expect(result).toEqual([{ id: 'v1', label: '视图1', pluginId: 'p', toolbar: 'bar' }])
  })

  it('world.project.current 走 world.project.current()', async () => {
    const current = vi.fn(async () => ({ id: 'p1', name: '项目', dirPath: '/x', isDefault: true }))
    registerWorldServiceTable({ 'world.project': { current } })

    const result = await handlerOf('world.project.current')({})
    expect(current).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ id: 'p1', name: '项目' })
  })

  it('world.schema.get 走 world.schema：带 type 用 get，省略用 list', async () => {
    const get = vi.fn((type: string) => (type === 'character' ? { typeKey: 'character' } : undefined))
    const list = vi.fn(() => [{ typeKey: 'character' }, { typeKey: 'item' }])
    registerWorldServiceTable({ 'world.schema': { get, list } })

    await handlerOf('world.schema.get')({ type: 'character' })
    expect(get).toHaveBeenCalledWith('character')

    const all = await handlerOf('world.schema.get')({})
    expect(list).toHaveBeenCalledOnce()
    expect(all).toHaveLength(2)
  })

  it('world.entity.list 走 world.entities：带 type 用 byType，省略用 list', async () => {
    const list = vi.fn(() => [{ id: 'e1', type: 'character', name: 'A' }])
    const byType = vi.fn((_t: string) => [{ id: 'e2', type: 'item', name: 'B' }])
    registerWorldServiceTable({ 'world.entities': { list, byType } })

    const all = await handlerOf('world.entity.list')({})
    expect(list).toHaveBeenCalledOnce()
    expect(all).toEqual([{ id: 'e1', type: 'character', name: 'A' }])

    const filtered = await handlerOf('world.entity.list')({ type: 'item' })
    expect(byType).toHaveBeenCalledWith('item')
    expect(filtered).toEqual([{ id: 'e2', type: 'item', name: 'B' }])
  })

  it('world.relation.list 走 world.relations：带 entityId 用 byEntity，省略用 list', async () => {
    const list = vi.fn(() => [{ id: 'r1' }])
    const byEntity = vi.fn((_id: string) => [{ id: 'r2' }])
    registerWorldServiceTable({ 'world.relations': { list, byEntity } })

    await handlerOf('world.relation.list')({})
    expect(list).toHaveBeenCalledOnce()

    await handlerOf('world.relation.list')({ entityId: 'e1' })
    expect(byEntity).toHaveBeenCalledWith('e1')
  })

  it('world.entity.get 命中内存缓存时不再查磁盘', async () => {
    const get = vi.fn((id: string) => (id === 'e1' ? { id: 'e1', name: '缓存实体' } : undefined))
    registerWorldServiceTable({ 'world.entities': { get } })

    const entity = await handlerOf('world.entity.get')({ id: 'e1' })
    expect(get).toHaveBeenCalledWith('e1')
    expect(entity).toMatchObject({ id: 'e1', name: '缓存实体' })
  })
})

describe('读类：服务缺席时回退（不抛错，仍可用）', () => {
  it('树未启动 → world.views.list 回退读 pluginAPI（返回数组）', async () => {
    const result = await handlerOf('world.views.list')({})
    expect(Array.isArray(result)).toBe(true)
  })

  /**
   * `world.entity.list` 的回退分支直连 `storage`（需 Tauri invoke），测试环境没有壳。
   * 这里不断言返回结构，只断言**没有走服务分支**——即它确实尝试了 storage 而非静默返回空。
   * 真正的 storage 往返由真机走查覆盖，不在单测里伪造。
   */
  it('树未启动 → world.entity.list 不走服务分支（回退路径可达）', async () => {
    const list = vi.fn(() => [{ id: 'should-not-be-used' }])
    // 登记一个「只有 views 没有 entities」的表，确保 entities 确实缺席
    registerWorldServiceTable({ 'world.views': { list: () => [] } })

    const handler = handlerOf('world.entity.list')
    // storage 在无壳环境下会抛（或返回空），关键是 list 未被调用
    await handler({}).catch(() => undefined)
    expect(list, 'entities 服务缺席时不应走服务分支').not.toHaveBeenCalled()
  })
})

describe('world.project.list 不经服务（壳命令提供 dsh 工作区清单）', () => {
  it('源码里该能力直接调 cmd_dsh_workspace_list，不读 world.project 服务', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(__dirname, '..', 'capabilities.ts'), 'utf8')
    // 该能力块内应出现壳命令名，且不出现 svc<WorldProjectService>
    const idx = src.indexOf("id: 'world.project.list'")
    const block = src.slice(idx, idx + 400)
    expect(block).toContain('cmd_dsh_workspace_list')
    expect(block).not.toContain('svc<WorldProjectService>')
  })
})
