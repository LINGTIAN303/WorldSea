/**
 * @worldsea/theme-kit - Manifest Registry
 * 
 * 主题 Manifest 注册表：
 * - 注册/获取/查询主题配置
 * - 支持动态注册新主题
 */

import type { ThemeManifest } from './types'

const manifests = new Map<string, ThemeManifest>()

export function registerManifest(manifest: ThemeManifest): void {
  manifests.set(manifest.id, manifest)
}

export function getManifest(id: string): ThemeManifest | undefined {
  return manifests.get(id)
}

export function getAllManifests(): ThemeManifest[] {
  return Array.from(manifests.values())
}

export function hasManifest(id: string): boolean {
  return manifests.has(id)
}

export function unregisterManifest(id: string): void {
  manifests.delete(id)
}
