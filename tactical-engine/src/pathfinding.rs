use crate::{Position, TacticalEngine};
use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// Dijkstra-based pathfinding that accumulates terrain move_cost.
/// Returns all reachable positions within the unit's move_range.
pub fn get_movable_range_bfs(engine: &TacticalEngine, x: u32, y: u32) -> Vec<Position> {
    let unit = match engine.units.iter().find(|u| u.x == x && u.y == y) {
        Some(u) => u,
        None => return Vec::new(),
    };
    let max_cost = unit.move_range;
    let w = engine.board.width;
    let h = engine.board.height;

    // cost grid: u32::MAX = unvisited
    let mut dist = vec![vec![u32::MAX; w as usize]; h as usize];
    dist[y as usize][x as usize] = 0;

    // min-heap: (cost, x, y)
    let mut heap: BinaryHeap<Reverse<(u32, u32, u32)>> = BinaryHeap::new();
    heap.push(Reverse((0, x, y)));

    let dirs: [(i32, i32); 4] = [(0, 1), (0, -1), (1, 0), (-1, 0)];

    while let Some(Reverse((cost, cx, cy))) = heap.pop() {
        if cost > dist[cy as usize][cx as usize] {
            continue;
        }
        for &(dx, dy) in &dirs {
            let nx = cx as i32 + dx;
            let ny = cy as i32 + dy;
            if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                continue;
            }
            let nx = nx as u32;
            let ny = ny as u32;

            // Skip cells occupied by other units (can't pass through)
            if engine.units.iter().any(|u| u.x == nx && u.y == ny) {
                continue;
            }

            let terrain = engine.board.get_terrain_cached(nx, ny);
            if terrain.blocks_move {
                continue;
            }
            let new_cost = cost + terrain.move_cost;
            if new_cost > max_cost {
                continue;
            }
            if new_cost < dist[ny as usize][nx as usize] {
                dist[ny as usize][nx as usize] = new_cost;
                heap.push(Reverse((new_cost, nx, ny)));
            }
        }
    }

    let mut result = Vec::new();
    for ry in 0..h {
        for rx in 0..w {
            if rx == x && ry == y {
                continue;
            }
            if dist[ry as usize][rx as usize] <= max_cost {
                result.push(Position { x: rx, y: ry });
            }
        }
    }
    result
}

/// BFS for attack range - uses Manhattan-style expansion but respects blocking terrain.
/// Attack range counts steps, not terrain cost.
pub fn get_attack_range_bfs(engine: &TacticalEngine, x: u32, y: u32) -> Vec<Position> {
    let unit = match engine.units.iter().find(|u| u.x == x && u.y == y) {
        Some(u) => u,
        None => return Vec::new(),
    };
    let max_range = unit.attack_range;
    let w = engine.board.width;
    let h = engine.board.height;

    let mut dist = vec![vec![u32::MAX; w as usize]; h as usize];
    dist[y as usize][x as usize] = 0;

    let mut queue = std::collections::VecDeque::new();
    queue.push_back((x, y, 0u32));

    let dirs: [(i32, i32); 4] = [(0, 1), (0, -1), (1, 0), (-1, 0)];

    while let Some((cx, cy, d)) = queue.pop_front() {
        if d >= max_range {
            continue;
        }
        for &(dx, dy) in &dirs {
            let nx = cx as i32 + dx;
            let ny = cy as i32 + dy;
            if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                continue;
            }
            let nx = nx as u32;
            let ny = ny as u32;
            let nd = d + 1;

            // Attack cannot pass through blocking terrain (walls)
            let terrain = engine.board.get_terrain_cached(nx, ny);
            if terrain.blocks_move {
                continue;
            }

            if nd < dist[ny as usize][nx as usize] {
                dist[ny as usize][nx as usize] = nd;
                queue.push_back((nx, ny, nd));
            }
        }
    }

    let mut result = Vec::new();
    for ry in 0..h {
        for rx in 0..w {
            if rx == x && ry == y {
                continue;
            }
            if dist[ry as usize][rx as usize] <= max_range {
                result.push(Position { x: rx, y: ry });
            }
        }
    }
    result
}
