mod ai;
mod awareness;
mod board;
mod combat;
mod pathfinding;
mod terrain;
mod unit;

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
#[derive(Serialize, Deserialize, Clone)]
pub struct Position {
    pub x: u32,
    pub y: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CombatResult {
    pub damage: i32,
    pub attacker_id: String,
    pub defender_id: String,
    pub defender_hp_remaining: i32,
    pub defender_dead: bool,
    pub critical: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AiAction {
    pub unit_id: String,
    pub action_type: String,
    pub move_to: Option<Position>,
    pub target: Option<Position>,
    pub skill_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AwarenessCell {
    pub x: u32,
    pub y: u32,
    pub controlling_team: Option<String>,
    pub threat_level: f64,
    pub is_supply_line: bool,
    pub is_isolated: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AwarenessResult {
    pub cells: Vec<AwarenessCell>,
}

/// Lightweight game event emitted from engine operations.
#[derive(Serialize, Deserialize, Clone)]
pub struct GameEvent {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

#[wasm_bindgen]
pub struct TacticalEngine {
    pub(crate) board: board::Board,
    pub(crate) units: Vec<unit::BattleUnit>,
    pub(crate) turn: u32,
    pub(crate) phase: String,
    events: Vec<GameEvent>,
}

#[wasm_bindgen]
impl TacticalEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(grid_type: &str, width: u32, height: u32) -> Self {
        Self {
            board: board::Board::new(grid_type, width, height),
            units: Vec::new(),
            turn: 1,
            phase: "deployment".to_string(),
            events: Vec::new(),
        }
    }

    pub fn place_unit(
        &mut self,
        id: &str,
        name: &str,
        team: &str,
        x: u32,
        y: u32,
        hp: i32,
        max_hp: i32,
        mp: i32,
        max_mp: i32,
        attack: i32,
        defense: i32,
        speed: i32,
        move_range: u32,
        attack_range: u32,
    ) -> Result<(), JsValue> {
        if x >= self.board.width || y >= self.board.height {
            return Err(JsValue::from_str("Position out of bounds"));
        }
        if self.units.iter().any(|u| u.x == x && u.y == y) {
            return Err(JsValue::from_str("Position occupied"));
        }
        self.units.push(unit::BattleUnit {
            id: id.to_string(),
            name: name.to_string(),
            team: team.to_string(),
            hp,
            max_hp,
            mp,
            max_mp,
            attack,
            defense,
            speed,
            move_range,
            attack_range,
            skills: Vec::new(),
            x,
            y,
            acted: false,
        });
        self.events.push(GameEvent {
            kind: "unit_placed".to_string(),
            unit_id: Some(id.to_string()),
            target_id: None,
            data: Some(serde_json::json!({ "x": x, "y": y, "team": team })),
        });
        Ok(())
    }

    pub fn remove_unit(&mut self, x: u32, y: u32) -> Result<(), JsValue> {
        let idx = self
            .units
            .iter()
            .position(|u| u.x == x && u.y == y)
            .ok_or_else(|| JsValue::from_str("No unit at position"))?;
        let removed_id = self.units[idx].id.clone();
        self.units.remove(idx);
        self.events.push(GameEvent {
            kind: "unit_removed".to_string(),
            unit_id: Some(removed_id),
            target_id: None,
            data: Some(serde_json::json!({ "x": x, "y": y })),
        });
        Ok(())
    }

    pub fn move_unit(&mut self, fx: u32, fy: u32, tx: u32, ty: u32) -> Result<(), JsValue> {
        let idx = self
            .units
            .iter()
            .position(|u| u.x == fx && u.y == fy)
            .ok_or_else(|| JsValue::from_str("No unit at source"))?;
        if fx == tx && fy == ty {
            self.units[idx].acted = true;
            return Ok(());
        }
        if self.units.iter().any(|u| u.x == tx && u.y == ty) {
            return Err(JsValue::from_str("Target occupied"));
        }
        let movable = self.get_movable_range(fx, fy);
        if !movable.iter().any(|p| p.x == tx && p.y == ty) {
            return Err(JsValue::from_str("Target not in move range"));
        }
        let unit_id = self.units[idx].id.clone();
        self.units[idx].x = tx;
        self.units[idx].y = ty;
        self.units[idx].acted = true;
        self.events.push(GameEvent {
            kind: "unit_moved".to_string(),
            unit_id: Some(unit_id),
            target_id: None,
            data: Some(serde_json::json!({ "fx": fx, "fy": fy, "tx": tx, "ty": ty })),
        });
        Ok(())
    }

    /// Dijkstra-based movable range respecting terrain costs.
    pub fn get_movable_range(&self, x: u32, y: u32) -> Vec<Position> {
        pathfinding::get_movable_range_bfs(self, x, y)
    }

    /// BFS attack range that cannot pass through blocking terrain.
    pub fn get_attack_range(&self, x: u32, y: u32) -> Vec<Position> {
        pathfinding::get_attack_range_bfs(self, x, y)
    }

    pub fn execute_attack(
        &mut self,
        ax: u32,
        ay: u32,
        tx: u32,
        ty: u32,
    ) -> Result<JsValue, JsValue> {
        let attacker_idx = self
            .units
            .iter()
            .position(|u| u.x == ax && u.y == ay)
            .ok_or_else(|| JsValue::from_str("No attacker at position"))?;
        let defender_idx = self
            .units
            .iter()
            .position(|u| u.x == tx && u.y == ty)
            .ok_or_else(|| JsValue::from_str("No defender at position"))?;

        if attacker_idx == defender_idx {
            return Err(JsValue::from_str("Cannot attack self"));
        }

        let terrain_at_defender = self.board.get_terrain_cached(tx, ty);
        let terrain_at_attacker = self.board.get_terrain_cached(ax, ay);

        // Use full combat with allies flanking
        let result = combat::calculate_damage_with_allies(
            &self.units[attacker_idx],
            &self.units[defender_idx],
            1.0,
            terrain_at_attacker.attack_bonus,
            terrain_at_defender.defense_bonus,
            &self.units,
        );

        self.units[defender_idx].hp -= result.damage;
        if self.units[defender_idx].hp <= 0 {
            self.units[defender_idx].hp = 0;
        }
        let dead = self.units[defender_idx].hp <= 0;
        self.units[attacker_idx].acted = true;

        let combat_result = CombatResult {
            damage: result.damage,
            attacker_id: self.units[attacker_idx].id.clone(),
            defender_id: self.units[defender_idx].id.clone(),
            defender_hp_remaining: self.units[defender_idx].hp,
            defender_dead: dead,
            critical: result.critical,
        };

        self.events.push(GameEvent {
            kind: if dead { "unit_killed" } else { "attack" }.to_string(),
            unit_id: Some(combat_result.attacker_id.clone()),
            target_id: Some(combat_result.defender_id.clone()),
            data: Some(serde_json::json!({
                "damage": result.damage,
                "critical": result.critical,
                "defender_dead": dead,
            })),
        });

        if dead {
            self.units.remove(defender_idx);
        }

        serde_wasm_bindgen::to_value(&combat_result).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn ai_decide(&self, team: &str) -> Result<JsValue, JsValue> {
        let action = ai::decide(self, team);
        serde_wasm_bindgen::to_value(&action).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn calculate_awareness(&self) -> Result<JsValue, JsValue> {
        let result = awareness::calculate(self);
        serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn set_terrain(&mut self, x: u32, y: u32, terrain_type: &str) {
        self.board.set_terrain(x, y, terrain_type);
    }

    pub fn get_unit_at(&self, x: u32, y: u32) -> Result<JsValue, JsValue> {
        match self.units.iter().find(|u| u.x == x && u.y == y) {
            Some(u) => {
                serde_wasm_bindgen::to_value(u).map_err(|e| JsValue::from_str(&e.to_string()))
            }
            None => Ok(JsValue::NULL),
        }
    }

    pub fn get_all_units(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.units).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn get_board_info(&self) -> Result<JsValue, JsValue> {
        let info = serde_json::json!({
            "gridType": self.board.grid_type,
            "width": self.board.width,
            "height": self.board.height,
        });
        Ok(JsValue::from_str(&info.to_string()))
    }

    pub fn next_turn(&mut self) {
        self.turn += 1;
        for u in &mut self.units {
            u.acted = false;
        }
        self.phase = "action".to_string();
        self.events.push(GameEvent {
            kind: "turn_start".to_string(),
            unit_id: None,
            target_id: None,
            data: Some(serde_json::json!({ "turn": self.turn })),
        });
    }

    pub fn get_turn(&self) -> u32 {
        self.turn
    }

    pub fn get_phase(&self) -> String {
        self.phase.clone()
    }

    pub fn start_battle(&mut self) {
        self.phase = "action".to_string();
        self.turn = 1;
        for u in &mut self.units {
            u.acted = false;
        }
        self.events.push(GameEvent {
            kind: "battle_start".to_string(),
            unit_id: None,
            target_id: None,
            data: None,
        });
    }

    pub fn check_victory(&self) -> Result<JsValue, JsValue> {
        let alive_teams: std::collections::HashSet<_> = self
            .units
            .iter()
            .filter(|u| u.hp > 0)
            .map(|u| u.team.clone())
            .collect();
        let result = if alive_teams.len() <= 1 {
            alive_teams
                .iter()
                .next()
                .map(|t| t.clone())
                .unwrap_or_default()
        } else {
            String::new()
        };
        if !result.is_empty() {
            // Note: we can't push to events here since this is &self, but the caller should check
        }
        Ok(JsValue::from_str(&result))
    }

    /// Drain all pending game events. Call this after each operation to consume events.
    pub fn drain_events(&mut self) -> Result<JsValue, JsValue> {
        let events = std::mem::take(&mut self.events);
        serde_wasm_bindgen::to_value(&events).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}
