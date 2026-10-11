use std::collections::{HashMap, HashSet};

use crate::{AwarenessCell, AwarenessResult, TacticalEngine};

fn manhattan(x1: u32, y1: u32, x2: u32, y2: u32) -> u32 {
    (x1 as i32 - x2 as i32).unsigned_abs() + (y1 as i32 - y2 as i32).unsigned_abs()
}

struct ComponentInfo {
    has_edge_unit: bool,
    unit_positions: Vec<(u32, u32)>,
}

fn build_team_components(
    units: &[crate::unit::BattleUnit],
    team: &str,
    width: u32,
    height: u32,
) -> Vec<ComponentInfo> {
    let team_units: Vec<&crate::unit::BattleUnit> =
        units.iter().filter(|u| u.team == team).collect();
    if team_units.is_empty() {
        return Vec::new();
    }

    let mut visited: HashSet<usize> = HashSet::new();
    let mut components = Vec::new();

    for i in 0..team_units.len() {
        if visited.contains(&i) {
            continue;
        }

        let mut stack = vec![i];
        let mut component_positions = Vec::new();
        let mut has_edge = false;

        while let Some(idx) = stack.pop() {
            if visited.contains(&idx) {
                continue;
            }
            visited.insert(idx);

            let u = team_units[idx];
            component_positions.push((u.x, u.y));

            if u.x == 0 || u.y == 0 || u.x == width - 1 || u.y == height - 1 {
                has_edge = true;
            }

            for j in 0..team_units.len() {
                if visited.contains(&j) {
                    continue;
                }
                if manhattan(u.x, u.y, team_units[j].x, team_units[j].y) == 1 {
                    stack.push(j);
                }
            }
        }

        components.push(ComponentInfo {
            has_edge_unit: has_edge,
            unit_positions: component_positions,
        });
    }

    components
}

pub fn calculate(engine: &TacticalEngine) -> AwarenessResult {
    let width = engine.board.width;
    let height = engine.board.height;

    let teams: Vec<String> = engine
        .units
        .iter()
        .map(|u| u.team.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    let mut team_components: HashMap<String, Vec<ComponentInfo>> = HashMap::new();
    for team in &teams {
        team_components.insert(
            team.clone(),
            build_team_components(&engine.units, team, width, height),
        );
    }

    let mut cells = Vec::new();

    for y in 0..height {
        for x in 0..width {
            let terrain = engine.board.get_terrain_cached(x, y);
            let terrain_blocks = terrain.blocks_move;

            let mut team_reach_count: HashMap<&str, u32> = HashMap::new();
            for unit in &engine.units {
                if terrain_blocks {
                    continue;
                }
                let dist = manhattan(unit.x, unit.y, x, y);
                if dist <= unit.move_range {
                    *team_reach_count.entry(&unit.team).or_insert(0) += 1;
                }
            }

            let controlling_team = team_reach_count
                .iter()
                .max_by_key(|(_, &count)| count)
                .filter(|(_, &count)| count > 0)
                .map(|(&team, _)| team.to_string());

            let threat_level = if let Some(ref ctrl_team) = controlling_team {
                engine
                    .units
                    .iter()
                    .filter(|u| u.team != *ctrl_team)
                    .filter_map(|u| {
                        let dist = manhattan(u.x, u.y, x, y);
                        if dist <= u.attack_range {
                            Some(u.attack as f64 / (dist as f64).max(1.0))
                        } else {
                            None
                        }
                    })
                    .sum()
            } else {
                engine
                    .units
                    .iter()
                    .filter_map(|u| {
                        let dist = manhattan(u.x, u.y, x, y);
                        if dist <= u.attack_range {
                            Some(u.attack as f64 / (dist as f64).max(1.0))
                        } else {
                            None
                        }
                    })
                    .sum()
            };

            let is_supply_line = if let Some(ref ctrl_team) = controlling_team {
                if let Some(components) = team_components.get(ctrl_team) {
                    components.iter().any(|comp| {
                        comp.has_edge_unit
                            && comp.unit_positions.iter().any(|&(ux, uy)| {
                                let dist = manhattan(ux, uy, x, y);
                                dist <= engine
                                    .units
                                    .iter()
                                    .find(|u| u.x == ux && u.y == uy)
                                    .map(|u| u.move_range)
                                    .unwrap_or(0)
                            })
                    })
                } else {
                    false
                }
            } else {
                false
            };

            let unit_at_cell = engine.units.iter().find(|u| u.x == x && u.y == y);
            let is_isolated = if let Some(unit) = unit_at_cell {
                !engine.units.iter().any(|u| {
                    u.id != unit.id && u.team == unit.team && manhattan(u.x, u.y, x, y) == 1
                })
            } else {
                false
            };

            cells.push(AwarenessCell {
                x,
                y,
                controlling_team,
                threat_level,
                is_supply_line,
                is_isolated,
            });
        }
    }

    AwarenessResult { cells }
}
