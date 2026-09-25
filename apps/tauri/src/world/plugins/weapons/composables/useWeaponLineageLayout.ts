import type { WeaponNode } from './useWeaponLineageData'

export type WeaponLayoutMode = 'grid' | 'radial'

export function useWeaponLineageLayout() {
  function layoutGrid(nodes: WeaponNode[]): void {
    if (nodes.length === 0) return

    const groups = new Map<string, WeaponNode[]>()
    for (const n of nodes) {
      if (!groups.has(n.weaponType)) groups.set(n.weaponType, [])
      groups.get(n.weaponType)!.push(n)
    }

    const colW = 200
    const rowH = 80
    let colIdx = 0

    for (const [, groupNodes] of groups) {
      groupNodes.sort((a, b) => {
        const rankOrder = ['凡品', '良品', '精品', '珍品', '绝品', '神品']
        return rankOrder.indexOf(a.rank) - rankOrder.indexOf(b.rank)
      })

      const x = colIdx * colW
      for (let i = 0; i < groupNodes.length; i++) {
        groupNodes[i].x = x
        groupNodes[i].y = i * rowH
      }
      colIdx++
    }
  }

  function layoutRadial(nodes: WeaponNode[]): void {
    if (nodes.length === 0) return

    const groups = new Map<string, WeaponNode[]>()
    for (const n of nodes) {
      if (!groups.has(n.weaponType)) groups.set(n.weaponType, [])
      groups.get(n.weaponType)!.push(n)
    }

    const groupKeys = Array.from(groups.keys())
    const groupAngleStep = (Math.PI * 2) / groupKeys.length
    const groupRadius = 200

    for (let g = 0; g < groupKeys.length; g++) {
      const groupNodes = groups.get(groupKeys[g])!
      const baseAngle = g * groupAngleStep - Math.PI / 2
      const baseX = Math.cos(baseAngle) * groupRadius
      const baseY = Math.sin(baseAngle) * groupRadius

      for (let i = 0; i < groupNodes.length; i++) {
        const offset = (i - (groupNodes.length - 1) / 2) * 70
        const perpAngle = baseAngle + Math.PI / 2
        groupNodes[i].x = baseX + Math.cos(perpAngle) * offset
        groupNodes[i].y = baseY + Math.sin(perpAngle) * offset
      }
    }
  }

  function applyLayout(nodes: WeaponNode[], mode: WeaponLayoutMode): void {
    if (mode === 'grid') layoutGrid(nodes)
    else layoutRadial(nodes)
  }

  return { applyLayout }
}
