import { ref } from 'vue'
import {
  SAVED_CONFIGS_STORAGE_KEY,
  type SavedGroupConfig,
  type ParticipantDraft,
} from '../components/setup/types'

/** 保存配置时所需的当前快照 */
export interface ConfigSnapshot {
  participants: ParticipantDraft[]
  maxRounds: number
  maxCostUsd: number
  parallelCount: number
  autoDegradation: boolean
}

/**
 * 群聊「我的配置」管理 composable
 *
 * 负责 savedConfigs 列表的加载、持久化、CRUD 操作。
 * renaming 状态由 SavedConfigsPanel 子组件内部管理，
 * 通过事件通知本 composable 执行 renameConfig 完成持久化。
 */
export function useSavedConfigs() {
  const savedConfigs = ref<SavedGroupConfig[]>(loadSavedConfigs())
  const activeSavedId = ref<string | null>(null)

  function loadSavedConfigs(): SavedGroupConfig[] {
    try {
      const raw = localStorage.getItem(SAVED_CONFIGS_STORAGE_KEY)
      return raw ? JSON.parse(raw) as SavedGroupConfig[] : []
    } catch {
      return []
    }
  }

  function persistSavedConfigs(configs: SavedGroupConfig[]): void {
    localStorage.setItem(SAVED_CONFIGS_STORAGE_KEY, JSON.stringify(configs))
  }

  /** 保存当前配置快照为新条目，返回新创建的配置（包含 id） */
  function saveCurrentConfig(snapshot: ConfigSnapshot): SavedGroupConfig {
    const cfg: SavedGroupConfig = {
      id: crypto.randomUUID(),
      name: snapshot.participants.map(p => p.name).join(' & '),
      participants: JSON.parse(JSON.stringify(snapshot.participants)) as ParticipantDraft[],
      maxRounds: snapshot.maxRounds,
      maxCostUsd: snapshot.maxCostUsd,
      parallelCount: snapshot.parallelCount,
      autoDegradation: snapshot.autoDegradation,
      savedAt: Date.now(),
    }
    savedConfigs.value.unshift(cfg)
    persistSavedConfigs(savedConfigs.value)
    activeSavedId.value = cfg.id
    return cfg
  }

  /** 根据 id 获取已保存配置（不存在返回 undefined） */
  function getConfig(id: string): SavedGroupConfig | undefined {
    return savedConfigs.value.find(c => c.id === id)
  }

  /** 标记当前激活的已保存配置 id（用于 UI 高亮） */
  function setActive(id: string | null): void {
    activeSavedId.value = id
  }

  /** 删除指定配置 */
  function deleteSavedConfig(id: string): void {
    savedConfigs.value = savedConfigs.value.filter(c => c.id !== id)
    persistSavedConfigs(savedConfigs.value)
    if (activeSavedId.value === id) {
      activeSavedId.value = null
    }
  }

  /** 重命名指定配置 */
  function renameConfig(id: string, newName: string): void {
    const trimmed = newName.trim()
    if (!trimmed) return
    const cfg = savedConfigs.value.find(c => c.id === id)
    if (cfg) {
      cfg.name = trimmed
      persistSavedConfigs(savedConfigs.value)
    }
  }

  return {
    savedConfigs,
    activeSavedId,
    saveCurrentConfig,
    getConfig,
    setActive,
    deleteSavedConfig,
    renameConfig,
  }
}
