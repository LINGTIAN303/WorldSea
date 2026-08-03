/**
 * ConfigAdapterImpl - ConfigAdapter 接口的宿主实现
 *
 * 将 ArchiveConfig 持久化到 localStorage（全局配置）。
 * 后续可扩展为项目级配置（通过 project_settings 表）。
 *
 * 存储格式：JSON 字符串，key = worldsmith_memory_archive_config
 */

import type { ConfigAdapter } from '@worldsmith/memory-archive/adapters'
import type { ArchiveConfig } from '@worldsmith/memory-archive/types'

const STORAGE_KEY = 'worldsmith_memory_archive_config'

/**
 * 创建配置适配器实例
 *
 * 配置为全局存储（localStorage），不随项目切换变化。
 * 归档阈值、衰减策略等参数对所有项目统一生效。
 */
export function createConfigAdapter(): ConfigAdapter {
  return {
    async loadConfig(): Promise<ArchiveConfig | null> {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return null
        return JSON.parse(raw) as ArchiveConfig
      } catch (err) {
        console.error('[ConfigAdapterImpl] loadConfig failed:', err)
        return null
      }
    },

    async saveConfig(config: ArchiveConfig): Promise<void> {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
      } catch (err) {
        console.error('[ConfigAdapterImpl] saveConfig failed:', err)
        throw err
      }
    },
  }
}
