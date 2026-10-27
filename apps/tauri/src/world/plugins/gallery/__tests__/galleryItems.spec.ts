import { describe, expect, it } from 'vitest'
import { collectGalleryItems } from '../galleryItems'
import type { Entity } from '@worldsea/entity-core'

function makeEntity(partial: Partial<Entity> & { id: string }): Entity {
  return {
    type: 'character',
    name: partial.id,
    description: '',
    properties: {},
    tags: [],
    createdAt: '2026-10-28T00:00:00Z',
    updatedAt: '2026-10-28T00:00:00Z',
    ...partial,
  }
}

describe('collectGalleryItems 三源聚合', () => {
  it('封面源：coverImage 出「封面」卡', () => {
    const items = collectGalleryItems([makeEntity({ id: 'a', coverImage: 'file:///a.png' })])
    expect(items.map(i => i.source)).toEqual(['cover'])
    expect(items[0]!.sourceLabel).toBe('封面')
  })

  it('形象图源：portrait 出「形象图」卡；已勾选形象作封面的不重复出卡', () => {
    const items = collectGalleryItems([
      makeEntity({ id: 'b', portrait: 'file:///b.png' }),
      makeEntity({ id: 'c', portrait: 'file:///c.png', coverSource: 'portrait' }),
    ])
    expect(items.map(i => `${i.source}:${i.entity.id}`)).toEqual(['portrait:b', 'cover:c'])
    // 形象图卡强制 coverSource=portrait，EntityCardCover 才走形象分支
    expect(items[0]!.entity.coverSource).toBe('portrait')
  })

  it('画板源：drawing 实体的 properties.thumbnail 出「画板」卡（伪实体 coverImage 承载缩略图）', () => {
    const items = collectGalleryItems([
      makeEntity({ id: 'd', type: 'drawing', properties: { thumbnail: 'file:///d.png' } }),
      makeEntity({ id: 'e', type: 'drawing', properties: {} }),
      makeEntity({ id: 'f', properties: { thumbnail: 'file:///f.png' } }),
    ])
    expect(items.map(i => i.source)).toEqual(['drawing'])
    expect(items[0]!.entity.coverImage).toBe('file:///d.png')
  })

  it('无图实体不出卡；updatedAt 降序排序', () => {
    const items = collectGalleryItems([
      makeEntity({ id: 'old', coverImage: 'file:///old.png', updatedAt: '2026-10-01T00:00:00Z' }),
      makeEntity({ id: 'new', coverImage: 'file:///new.png', updatedAt: '2026-10-28T00:00:00Z' }),
      makeEntity({ id: 'bare' }),
    ])
    expect(items.map(i => i.entity.id)).toEqual(['new', 'old'])
  })

  it('同实体封面 + 形象图并存出两卡（key 不冲突）', () => {
    const items = collectGalleryItems([
      makeEntity({ id: 'g', coverImage: 'file:///g.png', portrait: 'file:///g-portrait.png' }),
    ])
    expect(items.map(i => i.source).sort()).toEqual(['cover', 'portrait'])
  })
})
