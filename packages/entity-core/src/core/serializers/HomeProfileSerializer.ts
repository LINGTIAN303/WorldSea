/**
 * 首页资料打包分区（`<项目>/worlddata/.worldsea/home.json`）：随 WorldSeaPack 导入/导出。
 * 只搬运单份 profile，不碰实体/关系；导入后广播 `ws-home-profile-changed` 让已挂载的首页重读。
 * 详细见 docs/details/注释/packages/entity-core/core/ProjectFS.md。
 */
import { getFileStorageBackend } from '../StorageBackend'
import type { Serializer } from './types'

/** 与应用侧 homeProfileStore.HOME_PROFILE_LIMITS 同口径（entity-core 不反向依赖 app） */
const LIMITS = { tagline: 80, about: 240, coverImage: 2048 } as const

interface HomeProfileData {
  version: 1
  tagline: string
  about: string
  coverImage: string
  updatedAt: string | null
}

function projectDir(): string | null {
  return getFileStorageBackend()?.projectDir ?? null
}

function profilePath(dir: string): string {
  return `${dir.replace(/\\/g, '/')}/.worldsea/home.json`
}

async function getInvoke() {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke
  } catch {
    return null
  }
}

function asText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizeProfile(value: unknown): HomeProfileData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  return {
    version: 1,
    tagline: asText(raw.tagline, LIMITS.tagline),
    about: asText(raw.about, LIMITS.about),
    coverImage: asText(raw.coverImage, LIMITS.coverImage),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  }
}

/** 读取当前项目 profile；缺失/损坏/非 Tauri 一律 null（可选分区，不阻塞打包） */
async function readProfile(dir: string): Promise<HomeProfileData | null> {
  const invoke = await getInvoke()
  if (!invoke) return null
  try {
    const text = await invoke<string>('cmd_fs_read', { path: profilePath(dir), encoding: 'utf-8' })
    return normalizeProfile(JSON.parse(text))
  } catch {
    return null
  }
}

export const homeProfileSerializer: Serializer = {
  id: 'home-profile',
  label: '首页资料',
  dependsOn: [],

  async collect(): Promise<Record<string, unknown>> {
    const dir = projectDir()
    const profile = dir ? await readProfile(dir) : null
    return { version: 1, total: profile ? 1 : 0, profile }
  },

  async import(data, strategy): Promise<void> {
    const incoming = normalizeProfile(data.profile)
    if (!incoming) return
    const dir = projectDir()
    const invoke = dir ? await getInvoke() : null
    if (!dir || !invoke) return

    const existing = strategy === 'merge' ? await readProfile(dir) : null
    // merge：空字段不覆盖已有内容；overwrite：以包内为准（空串即清空）
    const next: HomeProfileData = existing
      ? {
          version: 1,
          tagline: incoming.tagline || existing.tagline,
          about: incoming.about || existing.about,
          coverImage: incoming.coverImage || existing.coverImage,
          updatedAt: incoming.updatedAt ?? new Date().toISOString(),
        }
      : { ...incoming, updatedAt: incoming.updatedAt ?? new Date().toISOString() }

    await invoke('cmd_fs_write', {
      path: profilePath(dir),
      content: JSON.stringify(next, null, 2),
      createDirs: true,
    })
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ws-home-profile-changed'))
  },
}
