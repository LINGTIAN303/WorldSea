import type { IconDef, IconCategory } from './types'
import { worldIcons } from './world'
import { actionIcons } from './action'
import { dataIcons } from './data'
import { themeIcons } from './theme'
import { categoryIcons } from './category'

const icons: Record<string, IconDef> = {
  ...worldIcons,
  ...actionIcons,
  ...dataIcons,
  ...themeIcons,
  ...categoryIcons,
}

export type IconName = keyof typeof icons

export function getIcon(name: string): IconDef | undefined {
  return icons[name]
}

export function hasIcon(name: string): boolean {
  return name in icons
}

export function getAllIconNames(): string[] {
  return Object.keys(icons)
}

export function getIconsByCategory(category: IconCategory): Record<string, IconDef> {
  const result: Record<string, IconDef> = {}
  for (const [name, def] of Object.entries(icons)) {
    if (def.category === category) {
      result[name] = def
    }
  }
  return result
}

export { type IconDef, type IconCategory } from './types'