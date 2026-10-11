use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct TerrainType {
    pub name: String,
    pub move_cost: u32,
    pub attack_bonus: i32,
    pub defense_bonus: i32,
    #[serde(rename = "blocks_movement")]
    blocks_move: bool,
}

impl TerrainType {
    pub fn blocks_movement(&self) -> bool {
        self.blocks_move
    }
}

/// Lightweight terrain info without String allocation, used in hot paths.
#[derive(Clone, Copy)]
pub struct TerrainInfo {
    pub move_cost: u32,
    pub attack_bonus: i32,
    pub defense_bonus: i32,
    pub blocks_move: bool,
}

pub fn get_terrain_type(name: &str) -> TerrainType {
    match name {
        "plain" => TerrainType {
            name: "plain".to_string(),
            move_cost: 1,
            attack_bonus: 0,
            defense_bonus: 0,
            blocks_move: false,
        },
        "forest" => TerrainType {
            name: "forest".to_string(),
            move_cost: 2,
            attack_bonus: -1,
            defense_bonus: 2,
            blocks_move: false,
        },
        "mountain" => TerrainType {
            name: "mountain".to_string(),
            move_cost: 3,
            attack_bonus: 1,
            defense_bonus: 3,
            blocks_move: false,
        },
        "water" => TerrainType {
            name: "water".to_string(),
            move_cost: 3,
            attack_bonus: -2,
            defense_bonus: -1,
            blocks_move: false,
        },
        "desert" => TerrainType {
            name: "desert".to_string(),
            move_cost: 2,
            attack_bonus: 0,
            defense_bonus: -1,
            blocks_move: false,
        },
        "wall" => TerrainType {
            name: "wall".to_string(),
            move_cost: 999,
            attack_bonus: 0,
            defense_bonus: 5,
            blocks_move: true,
        },
        _ => TerrainType {
            name: "plain".to_string(),
            move_cost: 1,
            attack_bonus: 0,
            defense_bonus: 0,
            blocks_move: false,
        },
    }
}

pub fn get_terrain_info(name: &str) -> TerrainInfo {
    match name {
        "plain" => TerrainInfo {
            move_cost: 1,
            attack_bonus: 0,
            defense_bonus: 0,
            blocks_move: false,
        },
        "forest" => TerrainInfo {
            move_cost: 2,
            attack_bonus: -1,
            defense_bonus: 2,
            blocks_move: false,
        },
        "mountain" => TerrainInfo {
            move_cost: 3,
            attack_bonus: 1,
            defense_bonus: 3,
            blocks_move: false,
        },
        "water" => TerrainInfo {
            move_cost: 3,
            attack_bonus: -2,
            defense_bonus: -1,
            blocks_move: false,
        },
        "desert" => TerrainInfo {
            move_cost: 2,
            attack_bonus: 0,
            defense_bonus: -1,
            blocks_move: false,
        },
        "wall" => TerrainInfo {
            move_cost: 999,
            attack_bonus: 0,
            defense_bonus: 5,
            blocks_move: true,
        },
        _ => TerrainInfo {
            move_cost: 1,
            attack_bonus: 0,
            defense_bonus: 0,
            blocks_move: false,
        },
    }
}
