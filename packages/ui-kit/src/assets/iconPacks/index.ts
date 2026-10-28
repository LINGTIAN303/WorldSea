/** 多风格内置图标库注册表：名称统一为 `<packId>:<iconName>`，与裸名/Lucide/custom 并存。 */
import type { IconCatalogEntry, IconDomain } from '../iconCatalog'
import { GENERATED_ICON_PACKS } from './generated'
import type { IconPackDef, PackIconDef } from './types'

export type { IconPackDef, PackIconDef, IconPackColorMode } from './types'

export const ICON_PACKS: IconPackDef[] = GENERATED_ICON_PACKS

const PACK_BY_ID = new Map<string, IconPackDef>(ICON_PACKS.map(pack => [pack.id, pack]))

export function getIconPack(id: string): IconPackDef | undefined {
  return PACK_BY_ID.get(id)
}

export function packIconFullName(packId: string, iconName: string): string {
  return `${packId}:${iconName}`
}

export function parsePackIconName(name: string): { pack: IconPackDef; iconName: string } | null {
  if (typeof name !== 'string') return null
  const split = name.indexOf(':')
  if (split <= 0 || split === name.length - 1) return null
  const pack = PACK_BY_ID.get(name.slice(0, split))
  if (!pack) return null
  return { pack, iconName: name.slice(split + 1) }
}

export function resolvePackIcon(name: string): { pack: IconPackDef; icon: PackIconDef } | null {
  const parsed = parsePackIconName(name)
  if (!parsed) return null
  const icon = parsed.pack.icons[parsed.iconName]
  return icon ? { pack: parsed.pack, icon } : null
}

export function hasPackIcon(name: string): boolean {
  return resolvePackIcon(name) !== null
}

export interface PackSearchEntry extends IconCatalogEntry {
  packId: string
  packLabel: string
  packStyle: string
  colorMode: IconPackDef['colorMode']
}

/** 搜索包图标；packId 省略/all 时跨全部新库。 */
export function searchPackIcons(
  query: string,
  packId: string | 'all' = 'all',
  domain: IconDomain | 'all' = 'all',
): PackSearchEntry[] {
  const q = query.trim().toLowerCase()
  const packs = packId === 'all' ? ICON_PACKS : ICON_PACKS.filter(pack => pack.id === packId)
  const out: PackSearchEntry[] = []
  for (const pack of packs) {
    for (const icon of Object.values(pack.icons)) {
      if (domain !== 'all' && !icon.domains.includes(domain)) continue
      if (q) {
        const haystack = `${icon.name} ${icon.label} ${icon.keywords}`.toLowerCase()
        if (!haystack.includes(q)) continue
      }
      out.push({
        name: packIconFullName(pack.id, icon.name),
        label: icon.label,
        keywords: icon.keywords,
        domains: icon.domains,
        packId: pack.id,
        packLabel: pack.label,
        packStyle: pack.style,
        colorMode: pack.colorMode,
      })
    }
  }
  return out
}
