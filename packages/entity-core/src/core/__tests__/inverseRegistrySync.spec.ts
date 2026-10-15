/**
 * inverseRegistry 同步契约（2026-10-15 修复）
 *
 * 背景：inverseRegistry 此前仅覆盖旧枚举 relationTypes——V2 关系（note_link 等）的
 * getInverse 恒为 undefined ⇒ createBidirectional 只建 forward 单记录（「双向」名不副实）。
 * 修复：syncToLegacyRegistry 扩展为同步 V2 inverseType（「已注册不覆盖」保护旧枚举语义）。
 *
 * 本 spec 锁定：
 * ① V2 关系 inverse 可查（note_link ↔ note_linked_from）；
 * ② 旧枚举关系 inverse 未被覆盖（belongs_to → controls）；
 * ③ 幂等：重复同步无副作用。
 *
 * 注：import 包入口即触发 relations 加载 + syncToLegacyRegistry（side-effect）。
 */
import { describe, expect, it } from 'vitest'
import { inverseRegistry, syncToLegacyRegistry } from '../../index'

describe('inverseRegistry · V2 关系同步（2026-10-15 修复）', () => {
  it('V2 关系 inverse 可查（note_link ↔ note_linked_from）', () => {
    expect(inverseRegistry.getInverse('note_link')).toBe('note_linked_from')
    expect(inverseRegistry.getInverse('note_linked_from')).toBe('note_link')
  })

  it('旧枚举关系 inverse 未被覆盖（belongs_to → controls）', () => {
    expect(inverseRegistry.getInverse('belongs_to')).toBe('controls')
  })

  it('幂等：重复同步无副作用', () => {
    const before = [...inverseRegistry.entries()]
    syncToLegacyRegistry()
    expect([...inverseRegistry.entries()]).toEqual(before)
  })
})
