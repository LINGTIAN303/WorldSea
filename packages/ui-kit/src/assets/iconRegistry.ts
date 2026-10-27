import { hasIcon as hasRegistryIcon } from './icons/index'
import { hasLucideIcon } from '../components/lucideMap'

export {
  getIcon,
  getAllIconNames,
  getIconsByCategory,
  type IconDef,
  type IconName,
  type IconCategory,
} from './icons/index'

/** 图标是否可由 WsIcon 解析：自定义路径注册表 + Lucide/Tabler 混编都算。 */
export function hasIcon(name: string): boolean {
  return hasRegistryIcon(name) || hasLucideIcon(name)
}
