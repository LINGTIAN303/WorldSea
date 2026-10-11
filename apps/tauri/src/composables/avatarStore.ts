/**
 * AvatarStore — 头像图片持久化层
 *
 * 任务 19 Phase 4：图片头像存储（IndexedDB/Dexie）。
 *   用户上传的头像图片压缩后以 Blob 存入 IndexedDB，avatar 字段存引用 `avatar://${id}`。
 *   AvatarBadge 通过 useAvatarImage 异步解析引用为 object URL 显示。
 *
 * 设计参考：longTaskStore.ts 的 Dexie 单例模式。
 */
import Dexie, { type Table } from 'dexie'
import { isAvatarRef, getAvatarRefId } from '../ui/avatar'

/** 头像记录（持久化到 IndexedDB） */
export interface AvatarRecord {
  id: string
  blob: Blob
  createdAt: number
}

class AvatarDB extends Dexie {
  avatars!: Table<AvatarRecord, string>
  constructor() {
    super('worldsea-avatars')
    this.version(1).stores({
      avatars: 'id, createdAt',
    })
  }
}

/** 单例数据库实例（懒加载） */
let db: AvatarDB | null = null
function getDb(): AvatarDB {
  if (!db) db = new AvatarDB()
  return db
}

/** 保存头像图片，返回引用 ID（avatar 字段存 `avatar://${id}`） */
export async function saveAvatar(blob: Blob): Promise<string> {
  const id = crypto.randomUUID()
  await getDb().avatars.put({ id, blob, createdAt: Date.now() })
  return id
}

/** 获取头像 Blob */
export async function getAvatarBlob(id: string): Promise<Blob | null> {
  try {
    const rec = await getDb().avatars.get(id)
    return rec?.blob || null
  } catch (err) {
    console.warn('[AvatarStore] getAvatarBlob 失败:', err)
    return null
  }
}

/** 删除头像 */
export async function deleteAvatar(id: string): Promise<void> {
  try {
    await getDb().avatars.delete(id)
  } catch (err) {
    console.warn('[AvatarStore] deleteAvatar 失败:', err)
  }
}

/**
 * 压缩图片（canvas resize，jpeg 0.85）
 * 头像圆形裁剪显示，透明背景非必需，统一 jpeg 减小体积。
 */
function compressImage(file: File, maxSize = 256, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('canvas 2d 不可用')); return }
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob((b) => {
        if (b) resolve(b)
        else reject(new Error('图片压缩失败'))
      }, 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')) }
    img.src = url
  })
}

/**
 * 从用户选择的文件上传头像：压缩 → 存 IndexedDB → 清理旧引用
 * @param file 用户选择的图片文件
 * @param oldAvatar 旧的 avatar 字段值（若为引用则清理旧 Blob，避免堆积废弃数据）
 * @returns 新的 avatar 字段值（`avatar://${id}`）
 */
export async function uploadAvatarFromFile(
  file: File,
  oldAvatar?: string | null,
): Promise<string> {
  const blob = await compressImage(file)
  const id = await saveAvatar(blob)
  // 清理旧头像引用
  if (oldAvatar && isAvatarRef(oldAvatar)) {
    const oldId = getAvatarRefId(oldAvatar)
    if (oldId && oldId !== id) {
      await deleteAvatar(oldId)
    }
  }
  return `avatar://${id}`
}
