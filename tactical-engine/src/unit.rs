use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub mp_cost: i32,
    pub multiplier: f64,
    pub range: u32,
    pub aoe: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BattleUnit {
    pub id: String,
    pub name: String,
    pub team: String,
    pub hp: i32,
    pub max_hp: i32,
    pub mp: i32,
    pub max_mp: i32,
    pub attack: i32,
    pub defense: i32,
    pub speed: i32,
    pub move_range: u32,
    pub attack_range: u32,
    pub skills: Vec<Skill>,
    pub x: u32,
    pub y: u32,
    pub acted: bool,
}
