import { describe, expect, it } from 'vitest'
import { analyzeOverview } from '../model/overview'
import { islandRadius, layoutOverview, phyllotaxis, solveRingRadius } from '../model/layout'
import type { EntityNodeInput, RelationEdgeInput } from '../model/types'

const META = (type: string) => ({ label: type, icon: type, shape: 'ellipse' })

function node(id: string, type: string, degree = 0): EntityNodeInput {
  return { id, name: id, type, label: type, icon: type, shape: 'ellipse', tags: [], description: '', degree }
}

function edge(id: string, source: string, target: string): RelationEdgeInput {
  return {
    id, source, target, relType: 'knows', relLabel: '认识', bidirectional: false, symmetric: false,
    noArrow: false, dashed: false, relationIds: [id],
  }
}

function build() {
  const nodes = [
    node('a', 'character', 2), node('b', 'character', 2), node('c', 'concept', 1),
    ...Array.from({ length: 40 }, (_, i) => node(`concept-${i}`, 'concept')),
    ...Array.from({ length: 12 }, (_, i) => node(`region-${i}`, 'region')),
    node('lone', 'character'),
  ]
  const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')]
  return analyzeOverview(nodes, edges, META)
}

describe('layoutOverview', () => {
  it('所有节点都有有限坐标，核心在原点附近，星座在核心外', () => {
    const overview = build()
    const layout = layoutOverview(overview)
    for (const item of overview.nodes) {
      const point = layout.positions[item.id]
      expect(point).toBeDefined()
      expect(Number.isFinite(point!.x)).toBe(true)
      expect(Number.isFinite(point!.y)).toBe(true)
    }
    const core = layout.groups.core!
    expect(core).toBeDefined()
    expect(Math.hypot(core.x, core.y)).toBeLessThan(1e-6)

    const islands = Object.values(layout.groups).filter(g => g.kind === 'island')
    expect(islands.length).toBe(3)
    for (const island of islands) {
      expect(Math.hypot(island.x, island.y)).toBeGreaterThan(core.radius)
      expect(island.radius).toBeGreaterThan(20)
    }
  })

  it('叶序圆盘点数正确、落在半径内且位置唯一', () => {
    const points = Array.from({ length: 60 }, (_, i) => phyllotaxis(i, 60, 120))
    const keys = new Set(points.map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`))
    expect(keys.size).toBe(60)
    for (const point of points) {
      expect(Math.hypot(point.x, point.y)).toBeLessThanOrEqual(120)
    }
  })

  it('环形打包半径足够容纳所有圆盘', () => {
    const radii = [40, 40, 40, 40, 40, 40]
    const R = solveRingRadius(radii, 30)
    const occupied = radii.reduce((sum, r) => sum + 2 * Math.asin((r + 15) / R), 0)
    expect(occupied).toBeLessThanOrEqual(Math.PI * 2)
    expect(R).toBeGreaterThan(Math.max(...radii))
  })

  it('星座半径随数量单调增长', () => {
    expect(islandRadius(10)).toBeLessThan(islandRadius(100))
    expect(islandRadius(100)).toBeLessThan(islandRadius(400))
    expect(islandRadius(1)).toBeGreaterThan(0)
  })

  it('空图不产生坐标', () => {
    const overview = analyzeOverview([], [], META)
    const layout = layoutOverview(overview)
    expect(layout.positions).toEqual({})
    expect(layout.groups).toEqual({})
  })
})
