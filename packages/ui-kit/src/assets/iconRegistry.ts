import { hasIcon as hasRegistryIcon } from './icons/index'
import { hasPackIcon } from './iconPacks'
import { hasLucideIcon } from '../components/lucideMap'
import { hasCustomIcon } from '../components/customIconResolver'

export {
  getIcon,
  getAllIconNames,
  getIconsByCategory,
  type IconDef,
  type IconName,
  type IconCategory,
} from './icons/index'

/** 图标是否可由 WsIcon 解析：自定义资产 + 内置包 + 自定义路径注册表 + Lucide/Tabler 混编都算。 */
export function hasIcon(name: string): boolean {
  return hasCustomIcon(name) || hasPackIcon(name) || hasRegistryIcon(name) || hasLucideIcon(name)
}
