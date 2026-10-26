/** 社区轮廓配色：低饱和、可叠加，避免抢走节点与标签的视觉重心 */

export interface CommunityColors {
  fill: string
  stroke: string
}

const DARK_COLORS: CommunityColors[] = [
  { fill: 'rgba(110, 168, 254, 0.10)', stroke: 'rgba(110, 168, 254, 0.55)' },
  { fill: 'rgba(167, 139, 250, 0.10)', stroke: 'rgba(167, 139, 250, 0.55)' },
  { fill: 'rgba(52, 211, 153, 0.10)', stroke: 'rgba(52, 211, 153, 0.50)' },
  { fill: 'rgba(251, 191, 36, 0.09)', stroke: 'rgba(251, 191, 36, 0.50)' },
  { fill: 'rgba(244, 114, 182, 0.09)', stroke: 'rgba(244, 114, 182, 0.50)' },
  { fill: 'rgba(56, 189, 248, 0.09)', stroke: 'rgba(56, 189, 248, 0.50)' },
]

const LIGHT_COLORS: CommunityColors[] = [
  { fill: 'rgba(79, 110, 247, 0.08)', stroke: 'rgba(79, 110, 247, 0.42)' },
  { fill: 'rgba(124, 92, 220, 0.08)', stroke: 'rgba(124, 92, 220, 0.42)' },
  { fill: 'rgba(16, 150, 110, 0.08)', stroke: 'rgba(16, 150, 110, 0.40)' },
  { fill: 'rgba(190, 130, 20, 0.08)', stroke: 'rgba(190, 130, 20, 0.40)' },
  { fill: 'rgba(198, 74, 138, 0.08)', stroke: 'rgba(198, 74, 138, 0.40)' },
  { fill: 'rgba(20, 140, 190, 0.08)', stroke: 'rgba(20, 140, 190, 0.40)' },
]

export function communityColors(index: number, themeMode: 'dark' | 'theme'): CommunityColors {
  const palette = themeMode === 'theme' ? LIGHT_COLORS : DARK_COLORS
  return palette[index % palette.length]
}
