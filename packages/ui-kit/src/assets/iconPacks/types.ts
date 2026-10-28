import type { IconDomain } from '../iconCatalog'

export type IconPackColorMode = 'mono' | 'color'

/** 单个包内图标；full name 为 `<packId>:<name>`。 */
export interface PackIconDef {
  name: string
  label: string
  keywords: string
  domains: IconDomain[]
  width: number
  height: number
  /** Iconify SVG inner body；生成时已做 id 去重与脚本拒绝。 */
  body: string
}

export interface IconPackDef {
  id: string
  label: string
  style: string
  license: string
  /** 来源/项目主页，许可页展示用。 */
  source?: string
  colorMode: IconPackColorMode
  icons: Record<string, PackIconDef>
}
