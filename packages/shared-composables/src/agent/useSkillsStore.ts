/** Skills Store 商城状态管理（远程技能源/列表/安装卸载更新，非 Tauri 降级），详细见 docs/details/注释/packages/shared-composables/agent/useSkillsStore.md */

import { ref, computed } from 'vue'
import {
  downloadRemoteManifest,
  installSkillAndReload,
  uninstallSkillAndReload,
  getInstalledVersions,
  importLocalSkillAndReload,
  autoImportSkill,
  exportToSkillYaml,
  type RemoteSkillEntry,
  type InstalledMeta,
} from '@agent/index'

/** 技能源配置 */
export interface SkillSource {
  name: string
  manifestUrl: string
  enabled: boolean
}

const STORAGE_KEY_SKILL_SOURCES = 'worldsmith_skill_sources'

/** 检测 Tauri 环境（Tauri 2 标准检测方式） */
function detectTauri(): boolean {
  // 使用宽松类型访问，避免依赖端特定全局声明
  // Tauri 端入口会在 global.d.ts 中声明 __TAURI_INTERNALS__
  return typeof window !== 'undefined' && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

/** 从 localStorage 加载技能源配置 */
function loadSources(): SkillSource[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SKILL_SOURCES)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch {}
  return []
}

// ── 全局共享状态（模块级，多组件复用）──
const isTauri = detectTauri()
const skillSources = ref<SkillSource[]>(loadSources())
const remoteSkills = ref<RemoteSkillEntry[]>([])
const installedVersions = ref<InstalledMeta[]>([])
const loading = ref(false)
const installing = ref<string | null>(null)
const error = ref<string | null>(null)

/** 持久化技能源配置 */
function saveSources(): void {
  try {
    localStorage.setItem(STORAGE_KEY_SKILL_SOURCES, JSON.stringify(skillSources.value))
  } catch {}
}

export function useSkillsStore() {
  /** 已安装技能 id 集合 */
  const installedIds = computed(() => new Set(installedVersions.value.map(s => s.id)))
  /** 已安装版本映射（id → version） */
  const installedVersionMap = computed(() =>
    new Map(installedVersions.value.map(s => [s.id, s.version])),
  )

  /** 添加技能源 */
  function addSource(name: string, manifestUrl: string): void {
    const trimmedName = name.trim()
    const trimmedUrl = manifestUrl.trim()
    if (!trimmedName || !trimmedUrl) return
    skillSources.value.push({ name: trimmedName, manifestUrl: trimmedUrl, enabled: true })
    saveSources()
  }

  /** 删除技能源 */
  function removeSource(idx: number): void {
    skillSources.value.splice(idx, 1)
    saveSources()
  }

  /** 切换技能源启用状态 */
  function toggleSource(idx: number): void {
    const src = skillSources.value[idx]
    if (src) {
      src.enabled = !src.enabled
      saveSources()
    }
  }

  /** 刷新远程技能列表（下载所有启用源的 manifest，合并去重） */
  async function refreshRemote(): Promise<void> {
    if (!isTauri) {
      error.value = '商城功能仅在桌面端可用'
      return
    }
    loading.value = true
    error.value = null
    try {
      const enabledSources = skillSources.value.filter(s => s.enabled)
      const allSkills: RemoteSkillEntry[] = []
      const seen = new Set<string>()
      for (const src of enabledSources) {
        const manifest = await downloadRemoteManifest(src.manifestUrl)
        if (manifest) {
          for (const skill of manifest.skills) {
            if (!seen.has(skill.id)) {
              seen.add(skill.id)
              allSkills.push(skill)
            }
          }
        }
      }
      remoteSkills.value = allSkills
    } catch (e: any) {
      error.value = `加载远程技能失败: ${e?.message || e}`
    } finally {
      loading.value = false
    }
  }

  /** 刷新已安装技能版本 */
  async function refreshInstalled(): Promise<void> {
    if (!isTauri) return
    installedVersions.value = await getInstalledVersions()
  }

  /** 安装技能（成功后刷新已安装列表） */
  async function installSkill(skill: RemoteSkillEntry): Promise<boolean> {
    if (!isTauri) return false
    installing.value = skill.id
    error.value = null
    try {
      const result = await installSkillAndReload({
        downloadUrl: skill.downloadUrl,
        pathInArchive: skill.pathInArchive,
        sha256: skill.sha256,
        skillId: skill.id,
      })
      if (result) {
        await refreshInstalled()
        return true
      }
      error.value = '安装失败：SHA256 校验失败或下载错误'
      return false
    } catch (e: any) {
      error.value = `安装失败: ${e?.message || e}`
      return false
    } finally {
      installing.value = null
    }
  }

  /** 卸载技能（成功后刷新已安装列表） */
  async function uninstallSkill(skillId: string): Promise<boolean> {
    if (!isTauri) return false
    installing.value = skillId
    error.value = null
    try {
      await uninstallSkillAndReload(skillId)
      await refreshInstalled()
      return true
    } catch (e: any) {
      error.value = `卸载失败: ${e?.message || e}`
      return false
    } finally {
      installing.value = null
    }
  }

  /** 检查技能是否已安装 */
  function isInstalled(skillId: string): boolean {
    return installedIds.value.has(skillId)
  }

  /** 检查技能是否有更新（本地版本 ≠ 远程版本） */
  function hasUpdate(skill: RemoteSkillEntry): boolean {
    const local = installedVersionMap.value.get(skill.id)
    return !!local && local !== skill.version
  }

  /** 本地导入技能（多平台互通：自动检测外部格式解析为标准 skill），详细见 docs/details/注释/packages/shared-composables/agent/useSkillsStore.md */
  async function importLocal(raw: string, fallbackId: string): Promise<{ success: boolean; warnings: string[]; platform: string }> {
    if (!isTauri) {
      return { success: false, warnings: ['商城功能仅在桌面端可用'], platform: 'unknown' }
    }
    error.value = null
    try {
      const parsed = autoImportSkill(raw, fallbackId)
      const skillYaml = exportToSkillYaml(parsed.meta)
      const skillMd = parsed.body || undefined
      const result = await importLocalSkillAndReload({
        skillId: parsed.meta.id,
        skillYaml,
        skillMd,
      })
      if (result) {
        await refreshInstalled()
        return { success: true, warnings: parsed.warnings, platform: parsed.platform }
      }
      error.value = '导入失败：写入技能文件失败'
      return { success: false, warnings: parsed.warnings, platform: parsed.platform }
    } catch (e: any) {
      error.value = `导入失败: ${e?.message || e}`
      return { success: false, warnings: [], platform: 'unknown' }
    }
  }

  return {
    isTauri,
    skillSources,
    remoteSkills,
    installedVersions,
    loading,
    installing,
    error,
    installedIds,
    installedVersionMap,
    addSource,
    removeSource,
    toggleSource,
    refreshRemote,
    refreshInstalled,
    installSkill,
    uninstallSkill,
    isInstalled,
    hasUpdate,
    importLocal,
  }
}
