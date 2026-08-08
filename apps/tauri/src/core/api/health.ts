/** Phase A 迁移：coreBackend health 领域对齐 web 端 WASM 版本（无 Rust 命令，返回降级值），详细见 docs/details/注释/tauri/coreBackend.md */

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

// ── Tauri-only API（复用 WASM 决策：无 Rust 命令，返回降级值，与 web 端一致） ──

export async function checkStorageHealth(): Promise<StorageHealthReport | null> {
  return null
}

export async function validatePluginManifest(
  _manifestJson: string,
): Promise<ManifestValidationResult | null> {
  return null
}

export async function checkPluginHealth(
  _manifestsJson: string,
  _activeIdsJson: string,
): Promise<PluginHealthReport | null> {
  return null
}
