// coreBackend 健康检查领域（原 coreBackend.ts 拆分），详细见 docs/details/注释/tauri/coreBackend.md
import type {
  StorageHealthReport,
  ManifestValidationResult,
  PluginHealthReport,
} from '@worldsmith/core-api-types'
import { detectBackend, getTauriInvoke } from './runtime'

export async function checkStorageHealth(): Promise<StorageHealthReport | null> {
  const backend = detectBackend()

  if (backend === 'tauri') {
    const invoke = await getTauriInvoke()
    return invoke('cmd_check_storage_health') as Promise<StorageHealthReport | null>
  }

  return null
}

export async function validatePluginManifest(
  manifestJson: string,
): Promise<ManifestValidationResult | null> {
  const backend = detectBackend()

  if (backend === 'tauri') {
    const invoke = await getTauriInvoke()
    return invoke('cmd_validate_plugin_manifest', { manifestJson }) as Promise<ManifestValidationResult | null>
  }

  return null
}

export async function checkPluginHealth(
  manifestsJson: string,
  activeIdsJson: string,
): Promise<PluginHealthReport | null> {
  const backend = detectBackend()

  if (backend === 'tauri') {
    const invoke = await getTauriInvoke()
    return invoke('cmd_check_plugin_health', { manifestsJson, activeIdsJson }) as Promise<PluginHealthReport | null>
  }

  return null
}
