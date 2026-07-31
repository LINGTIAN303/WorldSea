/**
 * 内存级图像缓存
 *
 * 用于在图像生成过程中暂存 base64 数据，供 vision-tools 跨调用共享。
 * 与 image-persistence (IndexedDB) 不同：本模块仅提供临时内存缓存，有 30 分钟 TTL。
 *
 * 写入方: vision-tools 的 vision_analyze 工具
 * 读取方: vision-tools 的 list_vision_images 工具
 * 关系: 本模块独立于 IndexedDB 持久化层，两者服务于不同目的
 */

/** 内存中缓存的单张图片 */
export interface StoredImage {
  data: string
  mimeType: string
}

/** 图片缓存 Map，key 为图片 ID，value 包含图片数组和创建时间 */
const pendingImages = new Map<string, { images: StoredImage[]; createdAt: number }>()

/** 图片缓存有效期：30 分钟 */
const IMAGE_TTL = 30 * 60 * 1000

/** 清理过期的图片缓存条目 */
function cleanup(): void {
  const now = Date.now()
  for (const [id, entry] of pendingImages) {
    if (now - entry.createdAt > IMAGE_TTL) {
      pendingImages.delete(id)
    }
  }
}

/**
 * 存储图片到内存缓存
 * 调用前自动清理过期条目
 * @param images 待缓存的图片数组
 * @returns 生成的唯一图片组 ID
 */
export function storeImages(images: StoredImage[]): string {
  cleanup()
  const imageId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  pendingImages.set(imageId, { images, createdAt: Date.now() })
  return imageId
}

/** 根据图片组 ID 获取缓存中的图片，已过期则返回 undefined */
export function getImages(imageId: string): StoredImage[] | undefined {
  const entry = pendingImages.get(imageId)
  return entry?.images
}

/** 从缓存中移除指定的图片组 */
export function removeImages(imageId: string): void {
  pendingImages.delete(imageId)
}

/** 检查指定图片组是否存在于缓存中 */
export function hasImages(imageId: string): boolean {
  return pendingImages.has(imageId)
}
