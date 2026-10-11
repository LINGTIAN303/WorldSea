/**
 * IngestNormalizers — 装载边界归一器注册表契约（2026-10-11）。
 *
 * 锁定：
 * ① 未注册类型 → 原引用返回（装载热路径零开销）
 * ② 注册类型 → 归一生效；归一器「无变化返回原引用」契约被透传（不制造多余响应式更新）
 * ③ 注册/注销生命周期；同名重复注册以最后一次为准
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerIngestNormalizer,
  unregisterIngestNormalizer,
  normalizeIngestEntity,
  normalizeIngestEntities,
} from '../IngestNormalizers'
import type { Entity } from '../../types/entity'

function makeEntity(type: string, content?: string): Entity {
  const now = '2026-10-11T00:00:00.000Z'
  return {
    id: `e_${type}`,
    type,
    name: '测试实体',
    description: '',
    properties: content === undefined ? {} : { content },
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
}

describe('IngestNormalizers · 装载归一注册表', () => {
  beforeEach(() => {
    unregisterIngestNormalizer('notebook')
    unregisterIngestNormalizer('character')
  })

  it('未注册类型：原引用返回，不做任何变换', () => {
    const e = makeEntity('character', '# 标题')
    expect(normalizeIngestEntity(e)).toBe(e)
  })

  it('注册类型：归一器生效（内容变换）', () => {
    registerIngestNormalizer('notebook', (entity) => ({
      ...entity,
      name: entity.name.toUpperCase(),
    }))
    const e = makeEntity('notebook')
    const out = normalizeIngestEntity(e)
    expect(out).not.toBe(e)
    expect(out.name).toBe('测试实体'.toUpperCase())
  })

  it('归一器无变化返回原引用时，透传保持同一引用', () => {
    registerIngestNormalizer('notebook', (entity) => entity)
    const e = makeEntity('notebook', '<p>已是 HTML</p>')
    expect(normalizeIngestEntity(e)).toBe(e)
  })

  it('重复注册：以最后一次为准', () => {
    registerIngestNormalizer('notebook', (entity) => ({ ...entity, name: 'first' }))
    registerIngestNormalizer('notebook', (entity) => ({ ...entity, name: 'second' }))
    expect(normalizeIngestEntity(makeEntity('notebook')).name).toBe('second')
  })

  it('unregister 后恢复原样返回', () => {
    registerIngestNormalizer('notebook', (entity) => ({ ...entity, name: 'x' }))
    unregisterIngestNormalizer('notebook')
    const e = makeEntity('notebook')
    expect(normalizeIngestEntity(e)).toBe(e)
  })

  it('数组归一：逐实体应用且保持顺序', () => {
    registerIngestNormalizer('notebook', (entity) => ({ ...entity, name: 'n' }))
    const list = [makeEntity('character'), makeEntity('notebook'), makeEntity('notebook')]
    const out = normalizeIngestEntities(list)
    expect(out.map(e => e.name)).toEqual(['测试实体', 'n', 'n'])
    expect(out[0]).toBe(list[0])
  })
})
