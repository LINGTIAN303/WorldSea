/**
 * 图谱色板与语义族（2026-10-26 重构）。
 *
 * 旧图画布上 17 类实体各用高饱和色 + 27 类关系色，远看只剩彩虹噪点。
 * 新规则：颜色只表达 6 个语义族 + 中性辅助，类型身份由形状、图标与图例承担；
 * 色相仍复用类型注册表的家族语义，便于与列表/详情页保持心智一致。
 */
import type { SemanticFamily } from '../model/types'

export interface FamilyPalette {
  /** 节点填充（主色） */
  fill: string
  /** 节点描边 / 星座边界（提亮一档） */
  stroke: string
  /** 星座气泡填充（低透明） */
  soft: string
  /** 图例文字用的强色 */
  text: string
}

/** 深色星图档：低饱和、偏冷，避免 17 色噪声 */
export const DARK_FAMILY_PALETTE: Record<SemanticFamily, FamilyPalette> = {
  being: { fill: '#d97a63', stroke: '#f0a68f', soft: 'rgba(217,122,99,0.20)', text: '#f2b7a5' },
  place: { fill: '#4d9fc4', stroke: '#86c6e4', soft: 'rgba(77,159,196,0.20)', text: '#9fd3ea' },
  narrative: { fill: '#cf9a4c', stroke: '#edc47e', soft: 'rgba(207,154,76,0.20)', text: '#f0cf95' },
  society: { fill: '#8f84d9', stroke: '#bdb5f4', soft: 'rgba(143,132,217,0.20)', text: '#cfc8fb' },
  artifact: { fill: '#3fae9b', stroke: '#7fd6c7', soft: 'rgba(63,174,155,0.20)', text: '#9fe0d4' },
  concept: { fill: '#b06fd4', stroke: '#d6a6ef', soft: 'rgba(176,111,212,0.20)', text: '#e2bcf4' },
  meta: { fill: '#7f8ea3', stroke: '#b4c0d2', soft: 'rgba(127,142,163,0.18)', text: '#c3cede' },
}

/** 跟随主题档：同一家族降一档亮度，落在浅底上 */
export const LIGHT_FAMILY_PALETTE: Record<SemanticFamily, FamilyPalette> = {
  being: { fill: '#c05c43', stroke: '#a34a35', soft: 'rgba(192,92,67,0.12)', text: '#8f3f2c' },
  place: { fill: '#2f7fa4', stroke: '#236684', soft: 'rgba(47,127,164,0.12)', text: '#1f5a75' },
  narrative: { fill: '#a87524', stroke: '#8a5f19', soft: 'rgba(168,117,36,0.12)', text: '#745015' },
  society: { fill: '#6f62c2', stroke: '#594fa3', soft: 'rgba(111,98,194,0.12)', text: '#4d438c' },
  artifact: { fill: '#2b8b7c', stroke: '#216f63', soft: 'rgba(43,139,124,0.12)', text: '#1b5f55' },
  concept: { fill: '#9250b8', stroke: '#773f99', soft: 'rgba(146,80,184,0.12)', text: '#6a3789' },
  meta: { fill: '#63758a', stroke: '#506073', soft: 'rgba(99,117,138,0.12)', text: '#445364' },
}

/** 边语义族色（深色档） */
export const DARK_EDGE_FAMILY: Record<string, string> = {
  structural: '#8fa3bf',
  social: '#c79ae6',
  spatial: '#6fb7d8',
  causal: '#d98a73',
  narrative: '#d9b46f',
  other: '#7c8ea6',
}

/** 边语义族色（主题档） */
export const LIGHT_EDGE_FAMILY: Record<string, string> = {
  structural: '#5e7189',
  social: '#8a5eb0',
  spatial: '#2f7fa4',
  causal: '#b25a43',
  narrative: '#9a742c',
  other: '#6b7c90',
}

/** 类型 → 语义族（未登记类型落 meta；域内类型按 `typeMappingRegistry` 的语义归并） */
const TYPE_FAMILY: Record<string, SemanticFamily> = {
  character: 'being',
  species: 'being',
  plant: 'being',
  region: 'place',
  building: 'place',
  event: 'narrative',
  conflict: 'narrative',
  outline_node: 'narrative',
  manuscript: 'narrative',
  organization: 'society',
  culture: 'society',
  language: 'society',
  item: 'artifact',
  weapon: 'artifact',
  apparel: 'artifact',
  combat_stat: 'artifact',
  magic: 'artifact',
  concept: 'concept',
  inspiration: 'concept',
  note: 'meta',
  textbox: 'meta',
  image: 'meta',
  link: 'meta',
  group: 'meta',
  center: 'meta',
  section: 'meta',
}

export function familyOfType(type: string): SemanticFamily {
  return TYPE_FAMILY[type] ?? 'meta'
}

export function familyPalette(type: string, mode: 'dark' | 'theme'): FamilyPalette {
  const table = mode === 'theme' ? LIGHT_FAMILY_PALETTE : DARK_FAMILY_PALETTE
  return table[familyOfType(type)]
}

/** `#rrggbb` → `rgba(r,g,b,a)`；非 6 位 hex 原样透传（防御第三方色值） */
export function withAlpha(color: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return color
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
