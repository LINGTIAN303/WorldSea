/** 统一头像工具函数（图片/文字首字/背景色规则，avatar:// 解析见文档），详细见 docs/details/注释/web/ui/avatar.md */

/** 判断 avatar 字段是否为图片源（URL / data URI / blob / 存储引用 / 路径） */
export function isImageAvatar(avatar?: string | null): boolean {
  if (!avatar) return false
  return (
    avatar.startsWith('avatar://') ||
    avatar.startsWith('http://') ||
    avatar.startsWith('https://') ||
    avatar.startsWith('data:image/') ||
    avatar.startsWith('blob:') ||
    avatar.startsWith('/')
  )
}

/** 判断 avatar 是否为存储引用（avatar://xxx，需异步解析为可显示 URL） */
export function isAvatarRef(avatar?: string | null): boolean {
  return !!avatar && avatar.startsWith('avatar://')
}

/** 从存储引用提取 ID（avatar://xxx → xxx） */
export function getAvatarRefId(avatar?: string | null): string | null {
  if (!avatar || !avatar.startsWith('avatar://')) return null
  return avatar.slice('avatar://'.length)
}

/**
 * 获取头像显示文字（当无图片源时使用）
 * - avatar 是文字（非图片）→ 用 avatar 本身
 * - 否则 → name 首字
 * - 都无 → '?'
 */
export function getAvatarText(avatar?: string | null, name?: string | null): string {
  if (avatar && !isImageAvatar(avatar)) return avatar
  if (name) return name.charAt(0)
  return '?'
}

/**
 * 获取头像背景色（无图片源时）
 * - color 优先（支持纯色 / gradient）
 * - 否则 role 默认色（user 绿色，agent 主题色）
 */
export function getAvatarColor(color?: string | null, role: 'agent' | 'user' = 'agent'): string {
  if (color) return color
  return role === 'user' ? '#10b981' : 'var(--color-primary)'
}
