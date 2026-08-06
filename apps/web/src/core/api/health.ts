/** Web 端 coreBackend 领域层 — health 健康检查：存储/插件清单/插件健康（Web 端无 Tauri 后端，返回降级值），详细见 docs/details/注释/web/core/coreBackend.md */

import type {
  StorageHealthReport,
  ManifestValidationResult,
  PluginHealthReport,
} from '@worldsmith/core-api-types'
export type {
  StorageHealthReport,
  ManifestValidationResult,
  PluginHealthReport,
}

// ── Tauri-only API（Web 端无 Tauri 后端，返回降级值） ──

export async function checkStorageHealth(): Promise<StorageHealthReport | null> {
  // Web 端无 Tauri 后端，返回 null
  return null
}

export async function validatePluginManifest(
  _manifestJson: string,
): Promise<ManifestValidationResult | null> {
  // Web 端无 Tauri 后端，返回 null
  return null
}

export async function checkPluginHealth(
  _manifestsJson: string,
  _activeIdsJson: string,
): Promise<PluginHealthReport | null> {
  // Web 端无 Tauri 后端，返回 null
  return null
}
