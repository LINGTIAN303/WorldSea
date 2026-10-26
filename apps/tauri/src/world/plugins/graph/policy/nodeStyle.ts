/**
 * 节点视觉策略（2026-10-26 重构）。
 *
 * 旧图的 26 种类型形状只存在注册表里，sigma 实际只画圆点；新图把注册表形状映射到 G6
 * 内置形状，并让颜色只表达 6 个语义族。大小由度数平方根映射，孤立实体保持最小档。
 */
import { familyPalette } from './palette'

export type G6NodeShape = 'circle' | 'rect' | 'ellipse' | 'diamond' | 'triangle' | 'hexagon'

export interface NodeVisual {
  g6Type: G6NodeShape
  size: number | [number, number]
  fill: string
  stroke: string
  lineWidth: number
  opacity: number
  /** 圆角矩形圆角（其他形状忽略） */
  radius?: number
}

/** 注册表形状（cytoscape 词汇）→ G6 内置形状 */
export function shapeForType(registryShape: string): G6NodeShape {
  switch (registryShape) {
    case 'round-rectangle':
    case 'rect':
      return 'rect'
    case 'round-triangle':
    case 'triangle':
      return 'triangle'
    case 'round-diamond':
    case 'diamond':
      return 'diamond'
    case 'round-hexagon':
    case 'hexagon':
      return 'hexagon'
    case 'ellipse':
      return 'ellipse'
    default:
      return 'circle'
  }
}

/** 度数 → 节点尺寸：平方根抑制 hub 过大，孤立实体最小档 */
export function nodeSizeFor(degree: number, isolated: boolean): number {
  const base = 5 + Math.sqrt(Math.max(0, degree)) * 2.2
  const size = isolated ? Math.max(4.5, base - 1) : Math.max(7, base)
  return Math.min(22, Math.round(size * 10) / 10)
}

export function nodeVisual(
  type: string,
  registryShape: string,
  degree: number,
  isolated: boolean,
  mode: 'dark' | 'theme' = 'dark',
): NodeVisual {
  const palette = familyPalette(type, mode)
  const g6Type = shapeForType(registryShape)
  const size = nodeSizeFor(degree, isolated)
  const boxed = g6Type === 'ellipse' || g6Type === 'rect'
  return {
    g6Type,
    size: boxed ? [Math.round(size * 1.22 * 10) / 10, Math.round(size * 0.9 * 10) / 10] : size,
    fill: palette.fill,
    stroke: palette.stroke,
    lineWidth: isolated ? 0.8 : 1.2,
    opacity: isolated ? 0.9 : 1,
    radius: g6Type === 'rect' ? 5 : undefined,
  }
}
