/**
 * 切项目后关系镜像表必须恢复（2026-11-17 关系权威源收敛）。
 *
 * 缺陷原貌：`useProjectSwitcher.reinitializeModules()` 执行 `relationSchemaRegistry.clear()`，
 * 恢复依赖包入口的 side-effect —— 而包入口只在模块**首次加载**时执行一次。
 * 实测切一次项目后该表恒为 0，全局图谱边标签（useGraphData.ts:117）从「属于」退化为
 * 显示 `belongs_to`。
 *
 * 本 spec 锁定修复后的行为：clear 之后由 `syncToLegacyRegistry()` 无条件重建。
 */
import { describe, expect, it } from 'vitest'
import { relationshipRegistry, relationSchemaRegistry, syncToLegacyRegistry } from '../../index'

describe('切项目：关系镜像表重建', () => {
  it('前置：注册表有量级正确的关系条目', () => {
    expect(relationshipRegistry.getAll().length).toBeGreaterThan(100)
  })

  it('clear 后镜像表归零（复现缺陷前提）', () => {
    relationSchemaRegistry.clear()
    expect(relationSchemaRegistry.getAll()).toHaveLength(0)
  })

  it('syncToLegacyRegistry 后恢复全部条目', () => {
    syncToLegacyRegistry()
    const v2 = relationshipRegistry.getAll().length
    const legacy = relationSchemaRegistry.getAll().length
    expect(legacy).toBe(v2)
  })

  it('恢复后 label 与注册表一致（图谱边标签不再退化）', () => {
    const wrong = relationshipRegistry
      .getAll()
      .filter(s => relationSchemaRegistry.get(s.type)?.label !== s.label)
      .map(s => s.type)
    expect(wrong).toEqual([])
  })

  it('恢复是幂等的（重复调用不重复插入）', () => {
    const before = relationSchemaRegistry.getAll().length
    syncToLegacyRegistry()
    syncToLegacyRegistry()
    expect(relationSchemaRegistry.getAll().length).toBe(before)
  })
})
