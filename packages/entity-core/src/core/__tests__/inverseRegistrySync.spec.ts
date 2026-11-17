/**
 * inverseRegistry 契约（2026-11-17 关系权威源收敛后重写）。
 *
 * 历史：本模块原自带 Map，`relationTypes.ts` 有 42 行手写注册与它对表。
 * 两份数据实测冲突 15 条，其中 6 条把非对称关系注册成自指，
 * 导致 `createBidirectional` 建出源目标相同的反向边。
 *
 * 现契约：`inverseRegistry` 是 `relationshipRegistry` 的**纯派生视图**，
 * 不保存任何独立状态，因此不可能分歧。本 spec 锁定该契约。
 */
import { describe, expect, it } from 'vitest'
import { relationshipRegistry, inverseRegistry, syncToLegacyRegistry } from '../../index'

describe('inverseRegistry · 派生视图契约', () => {
  it('V2 关系 inverse 可查（note_link ↔ note_linked_from）', () => {
    expect(inverseRegistry.getInverse('note_link')).toBe('note_linked_from')
    expect(inverseRegistry.getInverse('note_linked_from')).toBe('note_link')
  })

  it('belongs_to 的逆类型取自注册表（has_member），不再是旧手写表的 controls', () => {
    // 旧行为 controls 是错误值：它来自 relationTypes.ts 的手写注册，
    // 与 relations/index.ts 的声明 inverseType: 'has_member' 冲突。
    expect(relationshipRegistry.get('belongs_to')?.inverseType).toBe('has_member')
    expect(inverseRegistry.getInverse('belongs_to')).toBe('has_member')
  })

  it('register 是空实现——无法再制造第二份数据源', () => {
    const before = inverseRegistry.getInverse('belongs_to')
    inverseRegistry.register('belongs_to', '__tampered__')
    expect(inverseRegistry.getInverse('belongs_to')).toBe(before)
  })

  it('未注册类型返回 undefined（不伪造逆关系）', () => {
    expect(inverseRegistry.getInverse('__never_registered__')).toBeUndefined()
  })

  it('幂等：重复同步不改动 inverse 视图', () => {
    const before = [...inverseRegistry.entries()]
    syncToLegacyRegistry()
    expect([...inverseRegistry.entries()]).toEqual(before)
  })
})
