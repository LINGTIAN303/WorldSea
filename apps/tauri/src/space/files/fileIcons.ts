/**
 * 文件类型图标映射（2026-09-07 换装 vscode-great-icons 真实图标集，用户指定）：
 * 扩展名 → 图标数据（多色 SVG 或 PNG data URI，主题原生格式），目录树/tab/预览头三处同源。
 * 数据源 file-icon-data.ts（构建期从主题仓库提取，运行时零依赖）。
 */
import { EXT_ICON_IDS, ICON_ID_ALIASES, GREAT_ICONS, DEFAULT_GREAT_ICON } from './file-icon-data'

/** 按文件名取图标数据（目录不经过此函数）；未收录扩展名回落主题默认文件图标 */
export function fileIconDataOf(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  const aliased = ICON_ID_ALIASES[ext]
  const iconId = EXT_ICON_IDS[aliased ?? ext] ?? EXT_ICON_IDS[ext]
  return (iconId && GREAT_ICONS[iconId]) || DEFAULT_GREAT_ICON
}
