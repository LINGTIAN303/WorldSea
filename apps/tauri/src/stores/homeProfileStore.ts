import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getFileStorageBackend, isTauri } from '@worldsea/entity-core/core'

export interface HomeProfile {
  version: 1
  tagline: string
  about: string
  coverImage: string
  updatedAt: string | null
}

export const HOME_PROFILE_LIMITS = { tagline: 80, about: 240 } as const

export function defaultHomeProfile(): HomeProfile {
  return { version: 1, tagline: '', about: '', coverImage: '', updatedAt: null }
}

function asText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function normalizeHomeProfile(value: unknown): HomeProfile {
  if (!value || typeof value !== 'object') return defaultHomeProfile()
  const raw = value as Record<string, unknown>
  return {
    version: 1,
    tagline: asText(raw.tagline, HOME_PROFILE_LIMITS.tagline),
    about: asText(raw.about, HOME_PROFILE_LIMITS.about),
    coverImage: asText(raw.coverImage, 2048),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  }
}

export function homeProfilePath(projectDir: string): string {
  return `${projectDir.replace(/\\/g, '/')}/.worldsea/home.json`
}

export const useHomeProfileStore = defineStore('homeProfile', () => {
  const profile = ref<HomeProfile>(defaultHomeProfile())
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  /**
   * 内存 profile 归属的项目目录（`getFileStorageBackend().projectDir`）。
   * `save()` 以内存态为基准合并 patch，若不校验归属，切项目后会把旧项目草稿写进新项目。
   */
  const loadedProjectDir = ref<string | null>(null)
  /** 载入代际：只采纳最后一次 load 的结果，丢弃切项目途中的过期返回 */
  let loadSeq = 0
  /** 保存队列：串行落盘，避免两次 invoke 完成顺序颠倒导致旧内容后写覆盖新内容 */
  let saveQueue: Promise<unknown> = Promise.resolve()

  async function load(): Promise<void> {
    const dir = getFileStorageBackend()?.projectDir ?? null
    const seq = ++loadSeq
    if (!isTauri() || !dir) {
      loadedProjectDir.value = null
      profile.value = defaultHomeProfile()
      loading.value = false
      return
    }
    loading.value = true
    error.value = null
    try {
      const text = await invoke<string>('cmd_fs_read', { path: homeProfilePath(dir), encoding: 'utf-8' })
      if (seq !== loadSeq) return
      profile.value = normalizeHomeProfile(JSON.parse(text))
      loadedProjectDir.value = dir
    } catch {
      // 文件不存在/损坏：首页用默认值，不把可选文件当用户可见错误。
      // 仍登记目录——空默认值配该目录是「已同步」的一致状态，随后的编辑可以直接建立文件。
      if (seq !== loadSeq) return
      profile.value = defaultHomeProfile()
      loadedProjectDir.value = dir
    } finally {
      if (seq === loadSeq) loading.value = false
    }
  }

  function save(patch: Partial<Pick<HomeProfile, 'tagline' | 'about' | 'coverImage'>>): Promise<boolean> {
    const dir = getFileStorageBackend()?.projectDir ?? null
    if (!isTauri() || !dir) {
      error.value = '当前环境不支持保存首页简介'
      return Promise.resolve(false)
    }
    // 跨项目守卫：内存态尚未对应当前项目目录（未 load / load 在途 / 切项目后未重载）→ 拒绝写入
    if (loadedProjectDir.value !== dir) {
      error.value = '首页简介尚未同步到当前项目，请稍后重试'
      return Promise.resolve(false)
    }
    const seq = loadSeq
    const task = saveQueue.then(async () => {
      // 排队期间可能已切项目：执行前复核目标目录，绝不把旧项目草稿写进新项目
      if ((getFileStorageBackend()?.projectDir ?? null) !== dir) {
        error.value = '项目已切换，未保存首页简介'
        return false
      }
      saving.value = true
      error.value = null
      try {
        // 以执行时的内存态为基准：排队期间先完成的保存不会被本次部分 patch 覆盖
        const next = normalizeHomeProfile({ ...profile.value, ...patch, updatedAt: new Date().toISOString() })
        await invoke('cmd_fs_write', {
          path: homeProfilePath(dir),
          content: JSON.stringify(next, null, 2),
          createDirs: true,
        })
        // 写入目标在调用时已固定为 dir；若期间已发起新的 load（切项目），不要把旧项目内容写回内存
        if (seq === loadSeq) profile.value = next
        return true
      } catch (e) {
        error.value = e instanceof Error ? e.message : String(e)
        return false
      } finally {
        saving.value = false
      }
    })
    saveQueue = task.then(() => undefined, () => undefined)
    return task
  }

  function reset() {
    profile.value = defaultHomeProfile()
    loadedProjectDir.value = null
    error.value = null
  }

  return { profile, loading, saving, error, loadedProjectDir, load, save, reset }
})
