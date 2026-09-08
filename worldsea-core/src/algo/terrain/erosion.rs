use serde::{Deserialize, Serialize};

use super::terrain::HeightMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErosionConfig {
  pub iterations: usize,
  pub inertia: f64,
  pub capacity_factor: f64,
  pub min_slope: f64,
  pub erosion_rate: f64,
  pub deposition_rate: f64,
  pub evaporation_rate: f64,
  pub gravity: f64,
  pub start_water: f64,
  pub start_speed: f64,
  pub max_droplet_lifetime: usize,
}

impl Default for ErosionConfig {
  fn default() -> Self {
    Self {
      iterations: 50000,
      inertia: 0.05,
      capacity_factor: 4.0,
      min_slope: 0.01,
      erosion_rate: 0.3,
      deposition_rate: 0.3,
      evaporation_rate: 0.01,
      gravity: 10.0,
      start_water: 1.0,
      start_speed: 1.0,
      max_droplet_lifetime: 30,
    }
  }
}

pub fn hydraulic_erosion(map: &mut HeightMap, config: &ErosionConfig) {
  let w = map.width;
  let h = map.height;
  if w < 3 || h < 3 { return; }

  let mut rng = simple_rng(w, h);

  for _ in 0..config.iterations {
    let mut pos_x = rng.next() * (w - 3) as f64 + 1.0;
    let mut pos_y = rng.next() * (h - 3) as f64 + 1.0;
    let mut dir_x = 0.0_f64;
    let mut dir_y = 0.0_f64;
    let mut speed = config.start_speed;
    let mut water = config.start_water;
    let mut sediment = 0.0_f64;

    for _ in 0..config.max_droplet_lifetime {
      let node_x = pos_x.floor() as usize;
      let node_y = pos_y.floor() as usize;
      if node_x >= w - 1 || node_y >= h - 1 { break; }

      let cell_off_x = pos_x - node_x as f64;
      let cell_off_y = pos_y - node_y as f64;

      let height_sw = map.get(node_x, node_y);
      let height_se = map.get(node_x + 1, node_y);
      let height_nw = map.get(node_x, node_y + 1);
      let height_ne = map.get(node_x + 1, node_y + 1);

      let gradient_x = (height_se - height_sw) * (1.0 - cell_off_y)
        + (height_ne - height_nw) * cell_off_y;
      let gradient_y = (height_nw - height_sw) * (1.0 - cell_off_x)
        + (height_ne - height_se) * cell_off_x;

      let old_height = height_sw * (1.0 - cell_off_x) * (1.0 - cell_off_y)
        + height_se * cell_off_x * (1.0 - cell_off_y)
        + height_nw * (1.0 - cell_off_x) * cell_off_y
        + height_ne * cell_off_x * cell_off_y;

      dir_x = dir_x * config.inertia - gradient_x * (1.0 - config.inertia);
      dir_y = dir_y * config.inertia - gradient_y * (1.0 - config.inertia);
      let len = dir_x.hypot(dir_y);
      if len < f64::EPSILON {
        dir_x = rng.next() * 2.0 - 1.0;
        dir_y = rng.next() * 2.0 - 1.0;
      } else {
        dir_x /= len;
        dir_y /= len;
      }

      pos_x += dir_x;
      pos_y += dir_y;

      if pos_x < 1.0 || pos_x >= w as f64 - 2.0 || pos_y < 1.0 || pos_y >= h as f64 - 2.0 {
        break;
      }

      let new_node_x = pos_x.floor() as usize;
      let new_node_y = pos_y.floor() as usize;
      if new_node_x >= w - 1 || new_node_y >= h - 1 { break; }

      let new_cell_off_x = pos_x - new_node_x as f64;
      let new_cell_off_y = pos_y - new_node_y as f64;

      let new_height = map.get(new_node_x, new_node_y) * (1.0 - new_cell_off_x) * (1.0 - new_cell_off_y)
        + map.get(new_node_x + 1, new_node_y) * new_cell_off_x * (1.0 - new_cell_off_y)
        + map.get(new_node_x, new_node_y + 1) * (1.0 - new_cell_off_x) * new_cell_off_y
        + map.get(new_node_x + 1, new_node_y + 1) * new_cell_off_x * new_cell_off_y;

      let height_diff = new_height - old_height;

      let capacity = f64::max(-height_diff, config.min_slope) * speed * water * config.capacity_factor;

      if sediment > capacity || height_diff > 0.0 {
        let deposit = if height_diff > 0.0 {
          f64::min(height_diff, sediment)
        } else {
          (sediment - capacity) * config.deposition_rate
        };
        sediment -= deposit;

        let dep_node_x = pos_x.floor() as usize;
        let dep_node_y = pos_y.floor() as usize;
        let dep_off_x = pos_x - dep_node_x as f64;
        let dep_off_y = pos_y - dep_node_y as f64;

        if dep_node_x < w && dep_node_y < h {
          map.set(dep_node_x, dep_node_y, map.get(dep_node_x, dep_node_y) + deposit * (1.0 - dep_off_x) * (1.0 - dep_off_y));
        }
        if dep_node_x + 1 < w && dep_node_y < h {
          map.set(dep_node_x + 1, dep_node_y, map.get(dep_node_x + 1, dep_node_y) + deposit * dep_off_x * (1.0 - dep_off_y));
        }
        if dep_node_x < w && dep_node_y + 1 < h {
          map.set(dep_node_x, dep_node_y + 1, map.get(dep_node_x, dep_node_y + 1) + deposit * (1.0 - dep_off_x) * dep_off_y);
        }
        if dep_node_x + 1 < w && dep_node_y + 1 < h {
          map.set(dep_node_x + 1, dep_node_y + 1, map.get(dep_node_x + 1, dep_node_y + 1) + deposit * dep_off_x * dep_off_y);
        }
      } else {
        let erode = f64::min((capacity - sediment) * config.erosion_rate, -height_diff);
        sediment += erode;

        let er_node_x = (pos_x - dir_x).floor() as usize;
        let er_node_y = (pos_y - dir_y).floor() as usize;
        if er_node_x < w && er_node_y < h {
          map.set(er_node_x, er_node_y, map.get(er_node_x, er_node_y) - erode * 0.5);
        }
        if er_node_x + 1 < w && er_node_y < h {
          map.set(er_node_x + 1, er_node_y, map.get(er_node_x + 1, er_node_y) - erode * 0.25);
        }
        if er_node_x < w && er_node_y + 1 < h {
          map.set(er_node_x, er_node_y + 1, map.get(er_node_x, er_node_y + 1) - erode * 0.25);
        }
      }

      speed = (speed * speed + height_diff * config.gravity).sqrt();
      water *= 1.0 - config.evaporation_rate;
    }
  }
}

struct SimpleRng {
  state: u64,
}

impl SimpleRng {
  fn next(&mut self) -> f64 {
    self.state = self.state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    (self.state >> 33) as f64 / (1u64 << 31) as f64
  }
}

fn simple_rng(w: usize, h: usize) -> SimpleRng {
  SimpleRng { state: (w as u64).wrapping_mul(12345).wrapping_add(h as u64).wrapping_mul(67890) }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewshedResult {
  pub visible: Vec<bool>,
  pub width: usize,
  pub height: usize,
}

pub fn viewshed(map: &HeightMap, observer_x: usize, observer_y: usize, observer_height: f64, radius: f64) -> ViewshedResult {
  let w = map.width;
  let h = map.height;
  let total = w * h;
  let mut visible = vec![false; total];

  if observer_x >= w || observer_y >= h { return ViewshedResult { visible, width: w, height: h }; }

  let obs_height = map.get(observer_x, observer_y) + observer_height;
  visible[observer_y * w + observer_x] = true;

  let radius_sq = radius * radius;

  for dy in -(h as i64)..=(h as i64) {
    for dx in -(w as i64)..=(w as i64) {
      if dx == 0 && dy == 0 { continue; }
      let dist_sq = (dx * dx + dy * dy) as f64;
      if dist_sq > radius_sq { continue; }

      let steps = i64::max(dx.abs(), dy.abs());
      if steps == 0 { continue; }

      let step_x = dx as f64 / steps as f64;
      let step_y = dy as f64 / steps as f64;

      let mut max_slope = f64::NEG_INFINITY;
      let mut blocked = false;

      for step in 1..=steps {
        let cx = observer_x as f64 + step_x * step as f64;
        let cy = observer_y as f64 + step_y * step as f64;
        let ix = cx.round() as usize;
        let iy = cy.round() as usize;
        if ix >= w || iy >= h { break; }

        let terrain_h = map.get(ix, iy);
        let dist = ((ix as f64 - observer_x as f64).hypot(iy as f64 - observer_y as f64)).max(0.5);
        let slope = (terrain_h - obs_height) / dist;

        if slope > max_slope {
          max_slope = slope;
        }

        if max_slope > 0.0 && terrain_h < obs_height {
          blocked = true;
        }

        if !blocked || terrain_h >= obs_height {
          visible[iy * w + ix] = true;
        }
      }
    }
  }

  ViewshedResult { visible, width: w, height: h }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::algo::terrain::terrain::NoiseConfig;

  #[test]
  fn test_erosion_modifies_heightmap() {
    let config = NoiseConfig { seed: 42, scale: 0.05, octaves: 4, persistence: 0.5, lacunarity: 2.0 };
    let mut map = HeightMap::generate(&config, 32, 32, 0.0, 0.0);
    let original = map.data.clone();
    hydraulic_erosion(&mut map, &ErosionConfig { iterations: 1000, ..Default::default() });
    let changed = map.data.iter().zip(original.iter()).filter(|(a, b)| (*a - *b).abs() > 1e-10).count();
    assert!(changed > 0, "erosion should modify the heightmap");
  }

  #[test]
  fn test_erosion_preserves_size() {
    let config = NoiseConfig::default();
    let mut map = HeightMap::generate(&config, 16, 16, 0.0, 0.0);
    hydraulic_erosion(&mut map, &ErosionConfig { iterations: 100, ..Default::default() });
    assert_eq!(map.data.len(), 16 * 16);
  }

  #[test]
  fn test_viewshed_flat_all_visible() {
    let mut map = HeightMap::new(10, 10);
    for i in 0..100 { map.data[i] = 0.0; }
    let result = viewshed(&map, 5, 5, 1.0, 100.0);
    let visible_count = result.visible.iter().filter(|&&v| v).count();
    assert_eq!(visible_count, 100, "flat terrain should be fully visible");
  }

  #[test]
  fn test_viewshed_wall_blocks() {
    let mut map = HeightMap::new(10, 10);
    for i in 0..100 { map.data[i] = 0.0; }
    for y in 0..10 { map.set(5, y, 10.0); }
    let result = viewshed(&map, 2, 5, 1.0, 100.0);
    assert!(result.visible[5 * 10 + 8] == false, "point behind wall should not be visible");
  }

  #[test]
  fn test_viewshed_observer_position_visible() {
    let mut map = HeightMap::new(10, 10);
    for i in 0..100 { map.data[i] = 0.0; }
    let result = viewshed(&map, 3, 3, 1.0, 5.0);
    assert!(result.visible[3 * 10 + 3], "observer position should be visible");
  }
}
