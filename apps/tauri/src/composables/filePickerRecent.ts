/**
 * 选择器的「最近访问目录」持久化（localStorage）。
 *
 * 只记用户实际在其中做过选择或长时间停留的目录，用于下次打开时少走几步导航。
 * 与 `useResizable` 等既有偏好一样是纯前端状态，不进项目数据、不跨设备同步。
 */

const STORAGE_KEY = 'worldsea_file_picker_recent_dirs'
/** 保留条数（够用又不至于把左轨挤满） */
const MAX_RECENT = 5

/** 读取最近访问目录（最新在前；损坏数据静默丢弃） */
export function loadRecentDirs(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p): p is string => typeof p === 'string' && p.length > 0).slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

/** 记录一个目录（去重后置顶，超出上限截断）；返回更新后的列表 */
export function pushRecentDir(dir: string): string[] {
  const trimmed = dir.trim()
  if (!trimmed) return loadRecentDirs()
  // 大小写与分隔符归一后去重（Windows 下 `D:\a` 与 `d:/a` 是同一目录）
  const key = trimmed.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const rest = loadRecentDirs().filter((p) => {
    const k = p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    return k !== key
  })
  const next = [trimmed, ...rest].slice(0, MAX_RECENT)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 存储不可用（隐私模式/配额满）：功能降级为不记忆，不阻断选择流程
  }
  return next
}

/** 清空最近访问（供设置或诊断使用） */
export function clearRecentDirs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 同上：静默降级
  }
}

/* ── 视图模式偏好（列表 / 网格） ── */

const VIEW_KEY = 'worldsea_file_picker_view'

/** 读取视图模式偏好（缺失或非法值回退列表） */
export function loadViewMode(): 'list' | 'grid' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

/** 保存视图模式偏好（存储不可用时静默放弃，本次会话内仍生效） */
export function saveViewMode(mode: 'list' | 'grid'): void {
  try {
    localStorage.setItem(VIEW_KEY, mode)
  } catch {
    // 静默降级
  }
}
