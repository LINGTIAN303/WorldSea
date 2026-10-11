use crate::terrain::{self, TerrainInfo, TerrainType};

pub struct Board {
    pub grid_type: String,
    pub width: u32,
    pub height: u32,
    terrain: Vec<Vec<String>>,
    /// Cached terrain info grid to avoid repeated String -> TerrainType conversions
    cache: Vec<Vec<TerrainInfo>>,
}

impl Board {
    pub fn new(grid_type: &str, width: u32, height: u32) -> Self {
        let default_info = terrain::get_terrain_info("plain");
        let terrain = vec![vec!["plain".to_string(); width as usize]; height as usize];
        let cache = vec![vec![default_info; width as usize]; height as usize];
        Self {
            grid_type: grid_type.to_string(),
            width,
            height,
            terrain,
            cache,
        }
    }

    pub fn get_terrain(&self, x: u32, y: u32) -> TerrainType {
        let name = self
            .terrain
            .get(y as usize)
            .and_then(|row| row.get(x as usize))
            .map(|s| s.as_str())
            .unwrap_or("plain");
        terrain::get_terrain_type(name)
    }

    /// Lightweight terrain lookup without String allocation. Used in hot paths (BFS, combat).
    pub fn get_terrain_cached(&self, x: u32, y: u32) -> TerrainInfo {
        self.cache
            .get(y as usize)
            .and_then(|row| row.get(x as usize))
            .copied()
            .unwrap_or(TerrainInfo {
                move_cost: 1,
                attack_bonus: 0,
                defense_bonus: 0,
                blocks_move: false,
            })
    }

    pub fn set_terrain(&mut self, x: u32, y: u32, terrain_type: &str) {
        if let Some(row) = self.terrain.get_mut(y as usize) {
            if let Some(cell) = row.get_mut(x as usize) {
                *cell = terrain_type.to_string();
            }
        }
        let info = terrain::get_terrain_info(terrain_type);
        if let Some(row) = self.cache.get_mut(y as usize) {
            if let Some(cell) = row.get_mut(x as usize) {
                *cell = info;
            }
        }
    }
}
