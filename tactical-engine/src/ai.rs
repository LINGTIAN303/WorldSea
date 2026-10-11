use crate::{AiAction, Position, TacticalEngine};

fn manhattan(x1: u32, y1: u32, x2: u32, y2: u32) -> u32 {
    (x1 as i32 - x2 as i32).unsigned_abs() + (y1 as i32 - y2 as i32).unsigned_abs()
}

fn no_action(unit_id: String) -> AiAction {
    AiAction {
        unit_id,
        action_type: "wait".to_string(),
        move_to: None,
        target: None,
        skill_id: None,
    }
}

pub fn decide(engine: &TacticalEngine, team: &str) -> AiAction {
    let unit = match engine
        .units
        .iter()
        .find(|u| u.team == team && !u.acted && u.hp > 0)
    {
        Some(u) => u,
        None => return no_action(String::new()),
    };

    let unit_id = unit.id.clone();
    let ux = unit.x;
    let uy = unit.y;
    let hp_ratio = unit.hp as f64 / unit.max_hp.max(1) as f64;

    let enemies: Vec<&crate::unit::BattleUnit> = engine
        .units
        .iter()
        .filter(|u| u.team != team && u.hp > 0)
        .collect();

    if enemies.is_empty() {
        return no_action(unit_id);
    }

    let allies: Vec<&crate::unit::BattleUnit> = engine
        .units
        .iter()
        .filter(|u| u.team == team && u.id != unit.id && u.hp > 0)
        .collect();
    let adjacent_allies = allies
        .iter()
        .filter(|a| manhattan(a.x, a.y, ux, uy) == 1)
        .count();

    // --- Retreat logic: low HP and isolated ---
    if hp_ratio < 0.3 && adjacent_allies == 0 {
        let movable = engine.get_movable_range(ux, uy);
        if let Some(safest) = movable.iter().max_by_key(|p| {
            // maximize distance to nearest enemy
            enemies
                .iter()
                .map(|e| manhattan(p.x, p.y, e.x, e.y))
                .min()
                .unwrap_or(0)
        }) {
            let current_min_dist = enemies
                .iter()
                .map(|e| manhattan(ux, uy, e.x, e.y))
                .min()
                .unwrap_or(0);
            let new_min_dist = enemies
                .iter()
                .map(|e| manhattan(safest.x, safest.y, e.x, e.y))
                .min()
                .unwrap_or(0);
            if new_min_dist > current_min_dist {
                return AiAction {
                    unit_id,
                    action_type: "move".to_string(),
                    move_to: Some(Position {
                        x: safest.x,
                        y: safest.y,
                    }),
                    target: None,
                    skill_id: None,
                };
            }
        }
    }

    // --- Check if can attack: prioritize low HP targets ---
    let attack_range = engine.get_attack_range(ux, uy);
    let attackable: Vec<&&crate::unit::BattleUnit> = enemies
        .iter()
        .filter(|e| attack_range.iter().any(|p| p.x == e.x && p.y == e.y))
        .collect();

    if !attackable.is_empty() {
        // Prefer lowest HP target (easiest kill)
        let target = attackable.iter().min_by_key(|e| e.hp).unwrap();
        return AiAction {
            unit_id,
            action_type: "attack".to_string(),
            move_to: None,
            target: Some(Position {
                x: target.x,
                y: target.y,
            }),
            skill_id: None,
        };
    }

    // --- Move towards best position ---
    let movable = engine.get_movable_range(ux, uy);
    if movable.is_empty() {
        return no_action(unit_id);
    }

    // Score each movable position:
    // - closeness to weakest enemy (for next turn attack)
    // - terrain defense bonus
    // - number of enemies reachable from that position
    let best = movable.iter().max_by_key(|p| {
        let nearest_enemy_dist = enemies
            .iter()
            .map(|e| manhattan(p.x, p.y, e.x, e.y))
            .min()
            .unwrap_or(999);

        let terrain = engine.board.get_terrain_cached(p.x, p.y);
        let def_bonus = terrain.defense_bonus;

        // Count enemies within attack range from this position
        let enemies_in_range = enemies
            .iter()
            .filter(|e| manhattan(p.x, p.y, e.x, e.y) <= unit.attack_range)
            .count() as i32;

        // Threat: avoid positions where many enemies can attack us
        let threat: i32 = enemies
            .iter()
            .filter(|e| manhattan(p.x, p.y, e.x, e.y) <= e.attack_range)
            .count() as i32;

        // Composite score: lower enemy distance + higher defense + more enemies reachable - threat
        let score =
            (100 - nearest_enemy_dist.min(50)) as i32 + def_bonus * 3 + enemies_in_range * 10
                - threat * 5;
        score
    });

    if let Some(pos) = best {
        let current_score = {
            let nearest = enemies
                .iter()
                .map(|e| manhattan(ux, uy, e.x, e.y))
                .min()
                .unwrap_or(999);
            let terrain = engine.board.get_terrain_cached(ux, uy);
            (100 - nearest.min(50)) as i32 + terrain.defense_bonus * 3
        };
        let new_score = {
            let nearest = enemies
                .iter()
                .map(|e| manhattan(pos.x, pos.y, e.x, e.y))
                .min()
                .unwrap_or(999);
            let terrain = engine.board.get_terrain_cached(pos.x, pos.y);
            let enemies_in_range = enemies
                .iter()
                .filter(|e| manhattan(pos.x, pos.y, e.x, e.y) <= unit.attack_range)
                .count() as i32;
            (100 - nearest.min(50)) as i32 + terrain.defense_bonus * 3 + enemies_in_range * 10
        };

        // Only move if it improves our situation
        if new_score > current_score {
            return AiAction {
                unit_id,
                action_type: "move".to_string(),
                move_to: Some(Position { x: pos.x, y: pos.y }),
                target: None,
                skill_id: None,
            };
        }
    }

    no_action(unit_id)
}
