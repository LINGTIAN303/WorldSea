/** Skills Store 商城状态管理（远程技能源/列表/安装卸载更新，非 Tauri 降级），详细见 docs/details/注释/packages/shared-composables/agent/useSkillsStore.md */

import { ref, computed } from 'vue'
import {
  downloadRemoteManifest,
  installSkillAndReload,
  uninstallSkillAndReload,
  getInstalledVersions,
  importLocalSkillAndReload,
  createSkillAndReload,
  autoImportSkill,
  composeSkillMd,
  sidecarJsonFromMeta,
  validateSkillMdText,
  getInstalledScanWarnings,
  hasSkillsInvoke,
  type RemoteSkillEntry,
  type InstalledMeta,
  type SkillCreateInput,
  type SkillValidationIssue,
} from '@agent/index'

/** 技能源配置 */
export interface SkillSource {
  name: string
  manifestUrl: string
  enabled: boolean
}

const STORAGE_KEY_SKILL_SOURCES = 'worldsea_skill_sources'

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
// T02 修复（2026-09-01）：商城可用性 = hasSkillsInvoke()（桌面 Tauri 或浏览器 HTTP 桥已注入），
// 不再只看 __TAURI_INTERNALS__——浏览器 HTTP 模式商城功能已可通桥。
const isTauri = computed(() => hasSkillsInvoke())
const skillSources = ref<SkillSource[]>(loadSources())
const remoteSkills = ref<RemoteSkillEntry[]>([])
const installedVersions = ref<InstalledMeta[]>([])
const loading = ref(false)
const installing = ref<string | null>(null)
const error = ref<string | null>(null)
/** 扫描警告（S2：覆盖冲突 / 同 id 重复 / 不合规；面板可见） */
const scanWarnings = ref<string[]>([])

/** 本地导入结果（S2：新增 issues——校验问题，error 级需显式放行） */
export interface ImportLocalResult {
  success: boolean
  warnings: string[]
  platform: string
  issues?: SkillValidationIssue[]
}

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
    if (!isTauri.value) {
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

  /** 刷新已安装技能版本（含扫描警告） */
  async function refreshInstalled(): Promise<void> {
    if (!isTauri.value) return
    installedVersions.value = await getInstalledVersions()
    scanWarnings.value = getInstalledScanWarnings()
  }

  /** 安装技能（成功后刷新已安装列表） */
  async function installSkill(skill: RemoteSkillEntry): Promise<boolean> {
    if (!isTauri.value) return false
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
    if (!isTauri.value) return false
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

  /**
   * 本地导入技能（多平台互通：自动检测外部格式）
   *
   * S2 协议基座变更：落盘改为「规范 SKILL.md（frontmatter 为唯一元数据源）+ 可选 sidecar」，
   * 不再写 legacy skill.yaml；导入前经协议校验，error 级默认拦截，
   * 用户可经 `allowNonCompliant` 显式放行（面板「仍然导入」）。
   */
  async function importLocal(raw: string, fallbackId: string, opts: { allowNonCompliant?: boolean } = {}): Promise<ImportLocalResult> {
    if (!isTauri.value) {
      return { success: false, warnings: ['商城功能仅在桌面端可用'], platform: 'unknown' }
    }
    error.value = null
    try {
      const parsed = autoImportSkill(raw, fallbackId)
      const skillId = parsed.meta.id
      const body = parsed.body?.trim() ? parsed.body : `# ${parsed.meta.name}`
      const skillMd = composeSkillMd(skillId, parsed.meta.description, body)
      const sidecarJson = sidecarJsonFromMeta(parsed.meta)

      // 协议校验（前置）：error 级拦截（可显式放行）
      const issues = validateSkillMdText(skillMd, skillId)
      const hasError = issues.some((issue) => issue.level === 'error')
      if (hasError && !opts.allowNonCompliant) {
        return { success: false, warnings: parsed.warnings, platform: parsed.platform, issues }
      }

      const result = await importLocalSkillAndReload({ skillId, skillMd, sidecarJson })
      if (result) {
        await refreshInstalled()
        return { success: true, warnings: parsed.warnings, platform: parsed.platform, issues }
      }
      error.value = '导入失败：写入技能文件失败'
      return { success: false, warnings: parsed.warnings, platform: parsed.platform, issues }
    } catch (e: any) {
      error.value = `导入失败: ${e?.message || e}`
      return { success: false, warnings: [], platform: 'unknown' }
    }
  }

  /** 创建技能（S2 创建向导：规范 SKILL.md + 可选 sidecar；校验 error 级默认拦截） */
  async function createSkill(
    input: SkillCreateInput,
    opts: { allowNonCompliant?: boolean } = {},
  ): Promise<{ ok: boolean; issues: SkillValidationIssue[] }> {
    if (!isTauri.value) {
      return { ok: false, issues: [{ level: 'error', message: '商城功能仅在桌面端可用' }] }
    }
    error.value = null
    try {
      const outcome = await createSkillAndReload(input, opts)
      if (outcome.ok) await refreshInstalled()
      else if (outcome.issues.length > 0) error.value = '创建失败：不符合协议规范'
      else error.value = '创建失败：写入技能文件失败'
      return { ok: outcome.ok, issues: outcome.issues }
    } catch (e: any) {
      error.value = `创建失败: ${e?.message || e}`
      return { ok: false, issues: [] }
    }
  }

  return {
    isTauri,
    skillSources,
    remoteSkills,
    installedVersions,
    scanWarnings,
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
    createSkill,
  }
}
