import type { GameEvent } from './useTacticalEngine'

interface JSUnit {
  id: string; name: string; team: string
  hp: number; max_hp: number; mp: number; max_mp: number
  attack: number; defense: number; speed: number
  move_range: number; attack_range: number
  skills: { id: string; name: string; mp_cost: number; multiplier: number; range: number; aoe: boolean }[]
  x: number; y: number; acted: boolean
}

interface JSTerrain {
  name: string; move_cost: number; attack_bonus: number; defense_bonus: number; blocks_move: boolean
}

const TERRAIN_MAP: Record<string, JSTerrain> = {
  plain:    { name: 'plain',    move_cost: 1, attack_bonus: 0,  defense_bonus: 0,  blocks_move: false },
  forest:   { name: 'forest',   move_cost: 2, attack_bonus: -1, defense_bonus: 2,  blocks_move: false },
  mountain: { name: 'mountain', move_cost: 3, attack_bonus: 1,  defense_bonus: 3,  blocks_move: false },
  water:    { name: 'water',    move_cost: 3, attack_bonus: -2, defense_bonus: -1, blocks_move: false },
  desert:   { name: 'desert',   move_cost: 2, attack_bonus: 0,  defense_bonus: -1, blocks_move: false },
  wall:     { name: 'wall',     move_cost: 999, attack_bonus: 0, defense_bonus: 5, blocks_move: true },
}

function manhattan(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2)
}

export class TacticalEngineJS {
  private gridType: string
  private width: number
  private height: number
  private terrainGrid: JSTerrain[][]
  private units: JSUnit[]
  private turn: number
  private phase: string
  private events: GameEvent[]

  constructor(gridType: string, width: number, height: number) {
    this.gridType = gridType
    this.width = width
    this.height = height
    this.terrainGrid = Array.from({ length: height }, () =>
      Array(width).fill(null).map(() => ({ ...TERRAIN_MAP.plain }))
    )
    this.units = []
    this.turn = 1
    this.phase = 'deployment'
    this.events = []
  }

  place_unit(
    id: string, name: string, team: string,
    x: number, y: number,
    hp: number, max_hp: number, mp: number, max_mp: number,
    attack: number, defense: number, speed: number,
    move_range: number, attack_range: number,
  ): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      throw new Error('Position out of bounds')
    }
    if (this.units.some(u => u.x === x && u.y === y)) {
      throw new Error('Position occupied')
    }
    this.units.push({
      id, name, team, hp, max_hp, mp, max_mp,
      attack, defense, speed, move_range, attack_range,
      skills: [], x, y, acted: false,
    })
    this.events.push({ kind: 'unit_placed', unit_id: id, data: { x, y, team } })
  }

  remove_unit(x: number, y: number): void {
    const idx = this.units.findIndex(u => u.x === x && u.y === y)
    if (idx === -1) throw new Error('No unit at position')
    const removedId = this.units[idx].id
    this.units.splice(idx, 1)
    this.events.push({ kind: 'unit_removed', unit_id: removedId, data: { x, y } })
  }

  move_unit(fx: number, fy: number, tx: number, ty: number): void {
    const idx = this.units.findIndex(u => u.x === fx && u.y === fy)
    if (idx === -1) throw new Error('No unit at source')
    if (fx === tx && fy === ty) {
      this.units[idx].acted = true
      return
    }
    if (this.units.some(u => u.x === tx && u.y === ty)) throw new Error('Target occupied')
    const movable = this.get_movable_range(fx, fy)
    if (!movable.some(p => p.x === tx && p.y === ty)) throw new Error('Target not in move range')
    const unitId = this.units[idx].id
    this.units[idx].x = tx
    this.units[idx].y = ty
    this.units[idx].acted = true
    this.events.push({ kind: 'unit_moved', unit_id: unitId, data: { fx, fy, tx, ty } })
  }

  /// Dijkstra-based movable range (mirrors Rust pathfinding.rs)
  get_movable_range(x: number, y: number): { x: number; y: number }[] {
    const unit = this.units.find(u => u.x === x && u.y === y)
    if (!unit) return []
    const maxCost = unit.move_range
    const w = this.width, h = this.height
    const dist: number[][] = Array.from({ length: h }, () => Array(w).fill(Infinity))
    dist[y][x] = 0
    // Simple priority queue using sorted insert (adequate for small grids)
    const heap: [number, number, number][] = [[0, x, y]]
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]]

    while (heap.length > 0) {
      const [cost, cx, cy] = heap.shift()!
      if (cost > dist[cy][cx]) continue
      for (const [dx, dy] of dirs) {
        const nx = cx + dx, ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        if (this.units.some(u => u.x === nx && u.y === ny)) continue
        const terrain = this.terrainGrid[ny]?.[nx]
        if (!terrain || terrain.blocks_move) continue
        const newCost = cost + terrain.move_cost
        if (newCost > maxCost) continue
        if (newCost < dist[ny][nx]) {
          dist[ny][nx] = newCost
          // Insert in sorted order (min-heap simulation)
          let insertIdx = heap.length
          for (let i = 0; i < heap.length; i++) {
            if (newCost < heap[i][0]) { insertIdx = i; break }
          }
          heap.splice(insertIdx, 0, [newCost, nx, ny])
        }
      }
    }

    const result: { x: number; y: number }[] = []
    for (let ry = 0; ry < h; ry++) {
      for (let rx = 0; rx < w; rx++) {
        if (rx === x && ry === y) continue
        if (dist[ry][rx] <= maxCost) result.push({ x: rx, y: ry })
      }
    }
    return result
  }

  /// BFS attack range that respects blocking terrain
  get_attack_range(x: number, y: number): { x: number; y: number }[] {
    const unit = this.units.find(u => u.x === x && u.y === y)
    if (!unit) return []
    const maxRange = unit.attack_range
    const w = this.width, h = this.height
    const dist: number[][] = Array.from({ length: h }, () => Array(w).fill(Infinity))
    dist[y][x] = 0
    const queue: [number, number, number][] = [[x, y, 0]]
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]]

    while (queue.length > 0) {
      const [cx, cy, d] = queue.shift()!
      if (d >= maxRange) continue
      for (const [dx, dy] of dirs) {
        const nx = cx + dx, ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const nd = d + 1
        const terrain = this.terrainGrid[ny]?.[nx]
        if (terrain?.blocks_move) continue
        if (nd < dist[ny][nx]) {
          dist[ny][nx] = nd
          queue.push([nx, ny, nd])
        }
      }
    }

    const result: { x: number; y: number }[] = []
    for (let ry = 0; ry < h; ry++) {
      for (let rx = 0; rx < w; rx++) {
        if (rx === x && ry === y) continue
        if (dist[ry][rx] <= maxRange) result.push({ x: rx, y: ry })
      }
    }
    return result
  }

  execute_attack(ax: number, ay: number, tx: number, ty: number): Record<string, any> {
    const aIdx = this.units.findIndex(u => u.x === ax && u.y === ay)
    if (aIdx === -1) throw new Error('No attacker at position')
    const dIdx = this.units.findIndex(u => u.x === tx && u.y === ty)
    if (dIdx === -1) throw new Error('No defender at position')
    if (aIdx === dIdx) throw new Error('Cannot attack self')

    const attacker = this.units[aIdx]
    const defender = this.units[dIdx]
    const terrainAtDefender = this.terrainGrid[ty]?.[tx]
    const terrainAtAttacker = this.terrainGrid[ay]?.[ax]
    const terrainDefBonus = terrainAtDefender?.defense_bonus ?? 0
    const terrainAtkBonus = terrainAtAttacker?.attack_bonus ?? 0

    // Flanking: count adjacent allies
    const adjacentAllies = this.units.filter(u =>
      u.id !== attacker.id && u.team === attacker.team && u.hp > 0 &&
      manhattan(u.x, u.y, attacker.x, attacker.y) === 1
    ).length
    const flankBonus = Math.min(adjacentAllies * 0.1, 0.3)

    let baseDamage = attacker.attack + terrainAtkBonus - defender.defense * terrainDefBonus / 2
    let damage = Math.max(1, Math.floor(baseDamage))
    let critical = false
    if (Math.random() < 0.1) {
      damage = Math.floor(damage * 1.5)
      critical = true
    }
    damage = Math.floor(damage * (1 + flankBonus))

    // Melee adjacency bonus
    if (manhattan(attacker.x, attacker.y, defender.x, defender.y) === 1) {
      damage = Math.floor(damage * 1.15)
    }

    this.units[dIdx].hp = Math.max(0, this.units[dIdx].hp - damage)
    const dead = this.units[dIdx].hp <= 0
    this.units[aIdx].acted = true

    const result = {
      damage,
      attacker_id: attacker.id,
      defender_id: defender.id,
      defender_hp_remaining: this.units[dIdx].hp,
      defender_dead: dead,
      critical,
    }

    this.events.push({
      kind: dead ? 'unit_killed' : 'attack',
      unit_id: attacker.id,
      target_id: defender.id,
      data: { damage, critical, defender_dead: dead },
    })

    if (dead) this.units.splice(dIdx, 1)
    return result
  }

  set_terrain(x: number, y: number, terrain_type: string): void {
    const t = TERRAIN_MAP[terrain_type]
    if (t && this.terrainGrid[y]?.[x]) {
      this.terrainGrid[y][x] = { ...t }
    }
  }

  get_unit_at(x: number, y: number): JSUnit | null {
    return this.units.find(u => u.x === x && u.y === y) || null
  }

  get_all_units(): JSUnit[] {
    return [...this.units]
  }

  get_board_info(): Record<string, any> {
    return { gridType: this.gridType, width: this.width, height: this.height }
  }

  next_turn(): void {
    this.turn++
    for (const u of this.units) u.acted = false
    this.phase = 'action'
    this.events.push({ kind: 'turn_start', data: { turn: this.turn } })
  }

  get_turn(): number { return this.turn }
  get_phase(): string { return this.phase }

  start_battle(): void {
    this.phase = 'action'
    this.turn = 1
    for (const u of this.units) u.acted = false
    this.events.push({ kind: 'battle_start' })
  }

  check_victory(): string {
    const alive = new Set(this.units.filter(u => u.hp > 0).map(u => u.team))
    if (alive.size <= 1) return alive.values().next().value ?? ''
    return ''
  }

  /// Smart AI: mirrors Rust ai.rs logic
  ai_decide(team: string): Record<string, any> {
    const unit = this.units.find(u => u.team === team && !u.acted && u.hp > 0)
    if (!unit) return { unit_id: '', action_type: 'wait', move_to: null, target: null, skill_id: null }

    const enemies = this.units.filter(u => u.team !== team && u.hp > 0)
    if (enemies.length === 0) return { unit_id: unit.id, action_type: 'wait', move_to: null, target: null, skill_id: null }

    const allies = this.units.filter(u => u.team === team && u.id !== unit.id && u.hp > 0)
    const adjacentAllies = allies.filter(a => manhattan(a.x, a.y, unit.x, unit.y) === 1).length
    const hpRatio = unit.hp / Math.max(1, unit.max_hp)

    // Retreat: low HP and isolated
    if (hpRatio < 0.3 && adjacentAllies === 0) {
      const movable = this.get_movable_range(unit.x, unit.y)
      let safest = movable[0]
      let bestMinDist = 0
      for (const m of movable) {
        const minDist = Math.min(...enemies.map(e => manhattan(m.x, m.y, e.x, e.y)))
        if (minDist > bestMinDist) { bestMinDist = minDist; safest = m }
      }
      const currentMinDist = Math.min(...enemies.map(e => manhattan(unit.x, unit.y, e.x, e.y)))
      if (safest && bestMinDist > currentMinDist) {
        return { unit_id: unit.id, action_type: 'move', move_to: safest, target: null, skill_id: null }
      }
    }

    // Attack: prioritize low HP targets
    const attackRange = this.get_attack_range(unit.x, unit.y)
    const attackable = enemies.filter(e => attackRange.some(p => p.x === e.x && p.y === e.y))
    if (attackable.length > 0) {
      const target = attackable.reduce((a, b) => a.hp < b.hp ? a : b)
      return { unit_id: unit.id, action_type: 'attack', move_to: null, target: { x: target.x, y: target.y }, skill_id: null }
    }

    // Move: score positions
    const movable = this.get_movable_range(unit.x, unit.y)
    if (movable.length === 0) return { unit_id: unit.id, action_type: 'wait', move_to: null, target: null, skill_id: null }

    let bestPos = movable[0]
    let bestScore = -Infinity
    for (const p of movable) {
      const nearestDist = Math.min(...enemies.map(e => manhattan(p.x, p.y, e.x, e.y)))
      const terrain = this.terrainGrid[p.y]?.[p.x]
      const defBonus = terrain?.defense_bonus ?? 0
      const enemiesInRange = enemies.filter(e => manhattan(p.x, p.y, e.x, e.y) <= unit.attack_range).length
      const threat = enemies.filter(e => manhattan(p.x, p.y, e.x, e.y) <= e.attack_range).length
      const score = (100 - Math.min(nearestDist, 50)) + defBonus * 3 + enemiesInRange * 10 - threat * 5
      if (score > bestScore) { bestScore = score; bestPos = p }
    }

    // Only move if beneficial
    const currentNearest = Math.min(...enemies.map(e => manhattan(unit.x, unit.y, e.x, e.y)))
    const currentTerrain = this.terrainGrid[unit.y]?.[unit.x]
    const currentScore = (100 - Math.min(currentNearest, 50)) + (currentTerrain?.defense_bonus ?? 0) * 3
    if (bestScore > currentScore && bestPos) {
      return { unit_id: unit.id, action_type: 'move', move_to: bestPos, target: null, skill_id: null }
    }

    return { unit_id: unit.id, action_type: 'wait', move_to: null, target: null, skill_id: null }
  }

  calculate_awareness(): Record<string, any> {
    const cells: Record<string, any>[] = []
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        const unitsNear = this.units.filter(u => Math.abs(u.x - c) <= 3 && Math.abs(u.y - r) <= 3)
        const teamCounts: Record<string, number> = {}
        for (const u of unitsNear) {
          teamCounts[u.team] = (teamCounts[u.team] || 0) + 1
        }
        let controllingTeam: string | null = null
        let maxCount = 0
        for (const [team, count] of Object.entries(teamCounts)) {
          if (count > maxCount) { maxCount = count; controllingTeam = team }
        }
        const threatLevel = controllingTeam
          ? unitsNear.filter(u => u.team !== controllingTeam).length * 0.2
          : 0
        const hasFriendly = this.units.some(u => u.team === 'ally' && Math.abs(u.x - c) <= 2 && Math.abs(u.y - r) <= 2)
        const hasEnemy = this.units.some(u => u.team === 'enemy' && Math.abs(u.x - c) <= 2 && Math.abs(u.y - r) <= 2)
        cells.push({
          x: c, y: r,
          controlling_team: controllingTeam,
          threat_level: threatLevel,
          is_supply_line: hasFriendly && !hasEnemy,
          is_isolated: hasFriendly && unitsNear.filter(u => u.team === 'ally').length === 1,
        })
      }
    }
    return { cells }
  }

  drain_events(): GameEvent[] {
    const events = [...this.events]
    this.events = []
    return events
  }
}
