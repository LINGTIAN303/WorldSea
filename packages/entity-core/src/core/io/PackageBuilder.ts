/**
 * PackageBuilder — .ws 包构建器
 *
 * 将 WorldSmithPack 打包为 ZIP 归档（.ws 扩展名），内嵌媒体文件。
 * 媒体文件从实体 avatar 和 properties 中扫描引用并嵌入。
 *
 * 包结构：
 *   worldsmith-pack.ws (ZIP)
 *   ├── manifest.json      ← 包元数据 + 文件索引
 *   ├── pack.json          ← WorldSmithPack（完整数据）
 *   └── media/
 *       ├── avatars/       ← entity.avatar 引用的图片
 *       └── attachments/   ← properties 里引用的文件
 *
 * @example
 *   const builder = new PackageBuilder()
 *   const blob = await builder.build(pack, entities)
 *   // 浏览器下载（通过注入的 Downloader 实现）
 *   import { getDownloader } from './ioServices'
 *   getDownloader().download('project.ws', blob)
 */

import JSZip from 'jszip'
import type { WorldSmithPack } from './WorldSmithPack'
import type { Entity } from '../../types'

export interface PackageManifest {
  /** 包格式版本 */
  formatVersion: number
  /** 导出时间 */
  exportedAt: string
  /** 应用版本 */
  appVersion?: string
  /** 包的人类可读名称 */
  name?: string
  /** 内容摘要 */
  summary: {
    entities: number
    relations: number
    entityTypes: number
    relationTypes: number
    customModules: number
    mediaFiles: number
  }
  /** 内嵌媒体索引 { 原始引用 → ZIP 中的路径 } */
  mediaIndex: Record<string, string>
}

/**
 * 媒体扫描结果
 */
interface MediaRef {
  /** 原始 URL / 路径 */
  source: string
  /** ZIP 中的目标路径 */
  targetPath: string
  /** 从 source 获取的 Blob 数据 */
  blob: Blob | null
}

export class PackageBuilder {
  private zip: JSZip

  constructor() {
    this.zip = new JSZip()
  }

  /**
   * 构建 .ws 包
   *
   * @param pack  – WorldSmithPack 数据
   * @param entities – 实体列表（用于扫描 avatar/properties 中的媒体引用）
   * @returns ZIP Blob（.ws 格式）
   */
  async build(
    pack: WorldSmithPack,
    entities?: Entity[],
  ): Promise<Blob> {
    this.zip = new JSZip()

    // 1. 扫描媒体引用
    const mediaRefs = entities ? await this.scanMedia(entities) : []

    // 2. 写入 pack.json
    this.zip.file('pack.json', JSON.stringify(pack, null, 2))

    // 3. 写入媒体文件
    for (const ref of mediaRefs) {
      if (ref.blob) {
        this.zip.file(ref.targetPath, ref.blob)
      }
    }

    // 4. 构造 manifest.json
    const entityData = pack.serializers['entities'] as any
    const relationData = pack.serializers['relations'] as any
    const entityTypeData = pack.serializers['entity-types'] as any
    const relationTypeData = pack.serializers['relation-types'] as any
    const moduleData = pack.serializers['custom-modules'] as any

    const manifest: PackageManifest = {
      formatVersion: 1,
      exportedAt: pack.manifest.exportedAt,
      appVersion: pack.manifest.appVersion,
      name: pack.manifest.description,
      summary: {
        entities: entityData?.total ?? (entityData?.entities?.length ?? 0),
        relations: relationData?.total ?? (relationData?.relations?.length ?? 0),
        entityTypes: entityTypeData?.total ?? (entityTypeData?.schemas?.length ?? 0),
        relationTypes: relationTypeData?.total ?? (relationTypeData?.schemas?.length ?? 0),
        customModules: moduleData?.total ?? (moduleData?.modules?.length ?? 0),
        mediaFiles: mediaRefs.filter(r => r.blob !== null).length,
      },
      mediaIndex: {},
    }

    for (const ref of mediaRefs) {
      if (ref.blob) {
        manifest.mediaIndex[ref.source] = ref.targetPath
      }
    }

    this.zip.file('manifest.json', JSON.stringify(manifest, null, 2))

    return this.zip.generateAsync({ type: 'blob' })
  }

  /**
   * 从实体中扫描媒体引用
   *
   * 扫描：
   *   - entity.avatar（如果有）
   *   - entity.properties 中所有字符串值（尝试匹配 URL / data URI）
   */
  private async scanMedia(entities: Entity[]): Promise<MediaRef[]> {
    const refs: MediaRef[] = []
    const seen = new Set<string>()

    for (const entity of entities) {
      // avatar
      if (entity.avatar && !seen.has(entity.avatar)) {
        seen.add(entity.avatar)
        refs.push({
          source: entity.avatar,
          targetPath: `media/avatars/${entity.id}-${this.extractFileName(entity.avatar)}`,
          blob: await this.tryFetchBlob(entity.avatar),
        })
      }

      // properties — 遍历所有字符串值
      for (const [, value] of Object.entries(entity.properties)) {
        if (typeof value === 'string' && this.isLikelyUrl(value) && !seen.has(value)) {
          seen.add(value)
          refs.push({
            source: value,
            targetPath: `media/attachments/${entity.id}-${this.extractFileName(value)}`,
            blob: await this.tryFetchBlob(value),
          })
        }
      }
    }

    return refs
  }

  /**
   * 判断是否为 URL 或 data URI
   */
  private isLikelyUrl(s: string): boolean {
    return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:') || s.startsWith('blob:')
  }

  /**
   * 从路径/URL 中提取文件名
   */
  private extractFileName(url: string): string {
    if (url.startsWith('data:')) {
      // data:image/png;base64,... → image.png
      const match = url.match(/^data:(\w+\/(\w+));/)
      return match ? `image.${match[2]}` : `file.bin`
    }
    try {
      const u = new URL(url)
      const segments = u.pathname.split('/').filter(Boolean)
      return segments.length > 0 ? segments[segments.length - 1] : 'file'
    } catch {
      // 不是标准 URL，用路径的最后一段
      const parts = url.replace(/\\/g, '/').split('/').filter(Boolean)
      return parts.length > 0 ? parts[parts.length - 1] : 'file'
    }
  }

  /**
   * 尝试获取远程或内联资源的 Blob
   */
  private async tryFetchBlob(url: string): Promise<Blob | null> {
    try {
      if (url.startsWith('data:')) {
        // data URI → Blob
        const res = await fetch(url)
        return res.ok ? await res.blob() : null
      }
      if (url.startsWith('blob:')) {
        // blob: URL（浏览器本地 blob）
        const res = await fetch(url)
        return res.ok ? await res.blob() : null
      }
      if (url.startsWith('http://') || url.startsWith('https://')) {
        // 远程 URL（跨域可能有 CORS 限制）
        const res = await fetch(url, { mode: 'cors' })
        return res.ok ? await res.blob() : null
      }
      return null
    } catch {
      // 静默跳过无法获取的资源
      return null
    }
  }

  /**
   * 从 .ws ZIP 中解析出 WorldSmithPack
   */
  static async extractPack(blob: Blob): Promise<{
    pack: WorldSmithPack
    manifest?: PackageManifest
    mediaFiles?: Record<string, Blob>
  }> {
    const zip = await JSZip.loadAsync(blob)

    // 读取 pack.json
    const packFile = zip.file('pack.json')
    if (!packFile) throw new Error('.ws 包中缺少 pack.json')
    const packText = await packFile.async('text')
    let pack: WorldSmithPack
try { pack = JSON.parse(packText) } catch (e) { throw new Error('\u65e0\u6548\u7684 .wsm \u6587\u4ef6: ' + e) }

    // 读取 manifest.json（可选）
    let manifest: PackageManifest | undefined
    const manifestFile = zip.file('manifest.json')
    if (manifestFile) {
      try { manifest = JSON.parse(await manifestFile.async('text')) } catch (e) { throw new Error('\u65e0\u6548\u7684 manifest.json: ' + e) }
    }

    // 提取媒体文件
    const mediaFiles: Record<string, Blob> = {}
    const mediaFolder = zip.folder('media')
    if (mediaFolder) {
      const promises: Promise<void>[] = []
      mediaFolder.forEach((path, file) => {
        if (!file.dir) {
          promises.push(
            file.async('blob').then(blob => { mediaFiles[path] = blob }),
          )
        }
      })
      await Promise.all(promises)
    }

    return { pack, manifest, mediaFiles }
  }
}
