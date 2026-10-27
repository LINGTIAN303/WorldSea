/**
 * 图库聚合纯函数：实体数组 → 图库条目（封面 / 形象图 / 画板作品三源）。
 * 与视图解耦便于单测；assets/ 目录扫描挂账二期。
 */
import type { Entity } from '@worldsea/entity-core'

export type GallerySource = 'cover' | 'portrait' | 'drawing'

export interface GalleryItem {
  key: string
  entity: Entity
  source: GallerySource
  sourceLabel: string
}

export const GALLERY_SOURCE_LABELS: Record<GallerySource, string> = { cover: '封面', portrait: '形象图', drawing: '画板' }

/** 聚合三源（每实体可同时出「封面 + 形象图」两卡；形象图已被勾选作封面的不重复出卡） */
export function collectGalleryItems(entities: readonly Entity[]): GalleryItem[] {
  const result: GalleryItem[] = []
  for (const entity of entities) {
    const hasCover = !!(entity.coverImage?.trim())
      || (entity.coverSource === 'portrait' && !!entity.portrait)
      || (entity.coverSource === 'video' && !!entity.videoAsset)
    if (hasCover) {
      result.push({ key: `cover:${entity.id}`, entity, source: 'cover', sourceLabel: GALLERY_SOURCE_LABELS.cover })
    }
    if (entity.portrait && entity.coverSource !== 'portrait') {
      // 形象图卡：伪实体强制 coverSource=portrait，让 EntityCardCover 走形象渲染分支（模型/Lottie 自带视口门控）
      result.push({
        key: `portrait:${entity.id}`,
        entity: { ...entity, coverSource: 'portrait' },
        source: 'portrait',
        sourceLabel: GALLERY_SOURCE_LABELS.portrait,
      })
    }
    const thumbnail = entity.properties?.thumbnail
    if (entity.type === 'drawing' && typeof thumbnail === 'string' && thumbnail.trim()) {
      result.push({
        key: `drawing:${entity.id}`,
        entity: { ...entity, coverSource: 'image', coverImage: thumbnail },
        source: 'drawing',
        sourceLabel: GALLERY_SOURCE_LABELS.drawing,
      })
    }
  }
  return result.sort((a, b) => b.entity.updatedAt.localeCompare(a.entity.updatedAt))
}
