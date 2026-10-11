use crate::unit::BattleUnit;

pub struct DamageResult {
    pub damage: i32,
    pub critical: bool,
}

/// Improved combat formula:
/// base = attack * skill_multiplier + terrain_attack_bonus - defense * terrain_defense / 2
/// flanking = min(adjacent_ally_count * 0.1, 0.3)
/// damage = max(1, floor(base * (1 + flanking)))
/// 10% crit chance -> 1.5x damage
/// melee adjacency bonus (manhattan == 1): +15%
pub fn calculate_damage(
    attacker: &BattleUnit,
    defender: &BattleUnit,
    skill_multiplier: f64,
    terrain_atk_bonus: i32,
    terrain_def_bonus: i32,
) -> DamageResult {
    let base = attacker.attack as f64 * skill_multiplier + terrain_atk_bonus as f64
        - defender.defense as f64 * terrain_def_bonus as f64 / 2.0;
    let mut damage = std::cmp::max(1, base as i32);

    let critical = js_sys::Math::random() < 0.1;
    if critical {
        damage = (damage as f64 * 1.5) as i32;
    }

    let manhattan = (attacker.x as i32 - defender.x as i32).abs()
        + (attacker.y as i32 - defender.y as i32).abs();
    if manhattan == 1 {
        damage = (damage as f64 * 1.15) as i32;
    }

    DamageResult { damage, critical }
}

/// Full combat calculation with ally flanking bonus.
pub fn calculate_damage_with_allies(
    attacker: &BattleUnit,
    defender: &BattleUnit,
    skill_multiplier: f64,
    terrain_atk_bonus: i32,
    terrain_def_bonus: i32,
    all_units: &[BattleUnit],
) -> DamageResult {
    let base = attacker.attack as f64 * skill_multiplier + terrain_atk_bonus as f64
        - defender.defense as f64 * terrain_def_bonus as f64 / 2.0;
    let mut damage = std::cmp::max(1, base as i32);

    let critical = js_sys::Math::random() < 0.1;
    if critical {
        damage = (damage as f64 * 1.5) as i32;
    }

    // Flanking: count adjacent allies (within manhattan 1 of attacker, not the attacker itself)
    let adjacent_allies = all_units
        .iter()
        .filter(|u| {
            u.id != attacker.id && u.team == attacker.team && u.hp > 0 && {
                let dist =
                    (u.x as i32 - attacker.x as i32).abs() + (u.y as i32 - attacker.y as i32).abs();
                dist == 1
            }
        })
        .count();

    let flank_bonus = (adjacent_allies as f64 * 0.1).min(0.3);
    damage = (damage as f64 * (1.0 + flank_bonus)) as i32;

    let manhattan = (attacker.x as i32 - defender.x as i32).abs()
        + (attacker.y as i32 - defender.y as i32).abs();
    if manhattan == 1 {
        damage = (damage as f64 * 1.15) as i32;
    }

    DamageResult { damage, critical }
}
