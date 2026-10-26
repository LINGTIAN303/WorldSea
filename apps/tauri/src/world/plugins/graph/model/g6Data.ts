/**
 * G6 数据装配（2026-10-26 重构）。
 *
 * 把「关系核心 + 类型星座 + 预计算坐标」翻译成 G6 的节点/边/Combo 数据。
 * G6 官方约束：不要直接传 Vue reactive 对象——本函数只产出普通对象。
 */
import type { ComboData, EdgeData, GraphData, NodeData } from '@antv/g6'
import type { GroupLayout, Overview, OverviewLayout } from './types'
import type { GraphTheme } from '../graphTheme'
import { DARK_EDGE_FAMILY, LIGHT_EDGE_FAMILY, familyPalette, withAlpha } from '../policy/palette'
import { edgeVisual } from '../policy/edgeStyle'
import { nodeVisual } from '../policy/nodeStyle'

export function buildG6Data(
  overview: Overview,
  layout: OverviewLayout,
  theme: GraphTheme,
): GraphData {
  const nodeMap = new Map(overview.nodes.map(n => [n.id, n]))

  const nodes: NodeData[] = overview.nodes.map(node => {
    const position = layout.positions[node.id] ?? { x: 0, y: 0 }
    const visual = nodeVisual(node.type, node.typeShape, node.degree, node.isolated, theme.mode)
    return {
      id: node.id,
      type: visual.g6Type,
      combo: node.groupId,
      data: {
        name: node.name,
        entityType: node.type,
        typeLabel: node.typeLabel,
        icon: node.typeIcon,
        degree: node.degree,
        isolated: node.isolated,
        groupId: node.groupId,
        tags: node.tags,
        description: node.description,
      },
      style: {
        x: position.x,
        y: position.y,
        size: visual.size,
        fill: visual.fill,
        stroke: visual.stroke,
        lineWidth: visual.lineWidth,
        opacity: visual.opacity,
        radius: visual.radius,
        cursor: 'pointer',
        label: true,
        labelText: node.name,
        labelPlacement: 'bottom',
        labelFontSize: 10,
        labelFontWeight: 500,
        labelFill: theme.labelFill,
        labelBackground: true,
        labelBackgroundFill: theme.labelBg,
        labelBackgroundRadius: 4,
        labelPadding: [1, 4],
        labelMaxWidth: 120,
        labelWordWrap: true,
        halo: false,
      },
    } satisfies NodeData
  })

  const edgeFamilyColors = theme.mode === 'theme' ? LIGHT_EDGE_FAMILY : DARK_EDGE_FAMILY

  const edges: EdgeData[] = overview.edges
    .filter(edge => nodeMap.has(edge.source) && nodeMap.has(edge.target))
    .map(edge => {
      const visual = edgeVisual(
        edge.relType, edge.noArrow, edge.bidirectional, edge.symmetric, edge.dashed, false, theme.mode,
      )
      const familyColor = edgeFamilyColors[edge.family] ?? edgeFamilyColors.other
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'quadratic',
        data: {
          relType: edge.relType,
          relLabel: edge.relLabel,
          family: edge.family,
          hlStroke: withAlpha(familyColor, 0.95),
        },
        style: {
          stroke: visual.stroke,
          lineWidth: visual.lineWidth,
          endArrow: visual.endArrow,
          startArrow: visual.startArrow,
          endArrowSize: 7,
          startArrowSize: 7,
          endArrowFill: visual.stroke,
          startArrowFill: visual.stroke,
          lineDash: visual.lineDash,
          curveOffset: visual.curveOffset,
          opacity: 0.76,
          label: false,
          labelText: edge.relLabel,
          labelFontSize: 9,
          labelFill: theme.edgeLabelFill,
          labelBackground: true,
          labelBackgroundFill: theme.labelBg,
          labelBackgroundRadius: 3,
          labelPadding: [1, 3],
        },
      } satisfies EdgeData
    })

  const combos: ComboData[] = overview.groups.map(group => {
    const groupLayout: GroupLayout | undefined = layout.groups[group.id]
    const isCore = group.kind === 'core'
    const palette = group.type ? familyPalette(group.type, theme.mode) : null
    const radius = groupLayout?.radius ?? 60
    return {
      id: group.id,
      type: isCore ? 'rect' : 'circle',
      data: {
        kind: group.kind,
        entityType: group.type,
        label: group.label,
        icon: group.icon,
        count: group.count,
      },
      style: {
        x: groupLayout?.x ?? 0,
        y: groupLayout?.y ?? 0,
        collapsed: !isCore,
        collapsedSize: [Math.max(64, radius * 2), Math.max(64, radius * 2)],
        padding: isCore ? 28 : 20,
        fill: isCore ? theme.coreFill : palette?.soft,
        stroke: isCore ? theme.coreStroke : withAlpha(palette?.stroke ?? '#7f8ea3', 0.52),
        lineWidth: isCore ? 1.2 : 1.4,
        radius: isCore ? 24 : undefined,
        cursor: 'pointer',
        label: true,
        labelText: `${group.label} · ${group.count}`,
        labelPlacement: 'top',
        labelFontSize: 13,
        labelFontWeight: 600,
        labelFill: theme.textStrong,
        labelBackground: true,
        labelBackgroundFill: theme.labelBg,
        labelBackgroundRadius: 5,
        labelPadding: [2, 7],
      },
    } satisfies ComboData
  })

  return { nodes, edges, combos }
}
