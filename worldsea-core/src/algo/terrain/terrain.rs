use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoiseConfig {
  pub seed: u64,
  pub scale: f64,
  pub octaves: u32,
  pub persistence: f64,
  pub lacunarity: f64,
}

impl Default for NoiseConfig {
  fn default() -> Self {
    Self {
      seed: 42,
      scale: 0.01,
      octaves: 6,
      persistence: 0.5,
      lacunarity: 2.0,
    }
  }
}

fn hash2d(x: i64, y: i64, seed: u64) -> f64 {
  let mut h = seed.wrapping_add((x as u64).wrapping_mul(374761393));
  h = h.wrapping_add((y as u64).wrapping_mul(668265263));
  h ^= h >> 13;
  h = h.wrapping_mul(1274126177);
  h ^= h >> 16;
  (h as f64) / (u64::MAX as f64)
}

fn smoothstep(t: f64) -> f64 {
  t * t * (3.0 - 2.0 * t)
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
  a + (b - a) * t
}

pub fn value_noise_2d(x: f64, y: f64, config: &NoiseConfig) -> f64 {
  let mut value = 0.0;
  let mut amplitude = 1.0;
  let mut frequency = config.scale;
  let mut max_value = 0.0;

  for _ in 0..config.octaves {
    let sx = x * frequency;
    let sy = y * frequency;

    let ix = sx.floor() as i64;
    let iy = sy.floor() as i64;

    let fx = smoothstep(sx - ix as f64);
    let fy = smoothstep(sy - iy as f64);

    let n00 = hash2d(ix, iy, config.seed);
    let n10 = hash2d(ix + 1, iy, config.seed);
    let n01 = hash2d(ix, iy + 1, config.seed);
    let n11 = hash2d(ix + 1, iy + 1, config.seed);

    let nx0 = lerp(n00, n10, fx);
    let nx1 = lerp(n01, n11, fx);
    let n = lerp(nx0, nx1, fy);

    value += n * amplitude;
    max_value += amplitude;

    amplitude *= config.persistence;
    frequency *= config.lacunarity;
  }

  value / max_value
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeightMap {
  pub width: usize,
  pub height: usize,
  pub data: Vec<f64>,
}

impl HeightMap {
  #[must_use]
  pub fn new(width: usize, height: usize) -> Self {
    Self {
      width,
      height,
      data: vec![0.0; width * height],
    }
  }

  pub fn generate(config: &NoiseConfig, width: usize, height: usize, offset_x: f64, offset_y: f64) -> Self {
    let mut map = Self::new(width, height);
    for y in 0..height {
      for x in 0..width {
        let nx = (x as f64 + offset_x) * config.scale;
        let ny = (y as f64 + offset_y) * config.scale;
        map.data[y * width + x] = value_noise_2d(nx, ny, config);
      }
    }
    map
  }

  #[must_use]
  pub fn get(&self, x: usize, y: usize) -> f64 {
    if x < self.width && y < self.height {
      self.data[y * self.width + x]
    } else {
      0.0
    }
  }

  pub fn set(&mut self, x: usize, y: usize, value: f64) {
    if x < self.width && y < self.height {
      self.data[y * self.width + x] = value;
    }
  }

  #[must_use]
  pub fn slope_at(&self, x: usize, y: usize) -> (f64, f64) {
    let cx = self.get(x, y);
    let dx = if x + 1 < self.width {
      self.get(x + 1, y) - cx
    } else {
      0.0
    };
    let dy = if y + 1 < self.height {
      self.get(x, y + 1) - cx
    } else {
      0.0
    };
    (dx, dy)
  }

  #[must_use]
  pub fn slope_magnitude_at(&self, x: usize, y: usize) -> f64 {
    let (dx, dy) = self.slope_at(x, y);
    dx.hypot(dy)
  }

  #[must_use]
  pub fn aspect_at(&self, x: usize, y: usize) -> f64 {
    let (dx, dy) = self.slope_at(x, y);
    dy.atan2(dx)
  }

  #[must_use]
  pub fn min(&self) -> f64 {
    self.data.iter().copied().fold(f64::INFINITY, f64::min)
  }

  #[must_use]
  pub fn max(&self) -> f64 {
    self.data.iter().copied().fold(f64::NEG_INFINITY, f64::max)
  }

  pub fn normalize(&mut self) {
    let min = self.min();
    let max = self.max();
    let range = max - min;
    if range > 0.0 {
      for v in &mut self.data {
        *v = (*v - min) / range;
      }
    }
  }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContourPoint {
  pub x: f64,
  pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContourLine {
  pub level: f64,
  pub points: Vec<ContourPoint>,
}

pub fn marching_squares(heightmap: &HeightMap, levels: &[f64]) -> Vec<ContourLine> {
  let mut contours = Vec::new();

  for &level in levels {
    let mut lines = Vec::new();

    for y in 0..heightmap.height.saturating_sub(1) {
      for x in 0..heightmap.width.saturating_sub(1) {
        let tl = heightmap.get(x, y);
        let tr = heightmap.get(x + 1, y);
        let br = heightmap.get(x + 1, y + 1);
        let bl = heightmap.get(x, y + 1);

        let mut case = 0u8;
        if tl >= level { case |= 1; }
        if tr >= level { case |= 2; }
        if br >= level { case |= 4; }
        if bl >= level { case |= 8; }

        if case == 0 || case == 15 {
          continue;
        }

        let x0 = x as f64;
        let y0 = y as f64;
        let x1 = (x + 1) as f64;
        let y1 = (y + 1) as f64;

        let lerp_edge = |a: f64, b: f64| -> f64 {
          if (b - a).abs() < f64::EPSILON { 0.5 }
          else { (level - a) / (b - a) }
        };

        let top = ContourPoint { x: x0 + lerp_edge(tl, tr), y: y0 };
        let right = ContourPoint { x: x1, y: y0 + lerp_edge(tr, br) };
        let bottom = ContourPoint { x: x0 + lerp_edge(bl, br), y: y1 };
        let left = ContourPoint { x: x0, y: y0 + lerp_edge(tl, bl) };

        let segments: &[(ContourPoint, ContourPoint)] = match case {
          1 | 14 => &[(top, left)],
          2 | 13 => &[(top, right)],
          3 | 12 => &[(left, right)],
          4 | 11 => &[(bottom, right)],
          5 => &[(top, right), (bottom, left)],
          6 | 9 => &[(top, bottom)],
          7 | 8 => &[(left, bottom)],
          10 => &[(top, left), (bottom, right)],
          _ => &[],
        };

        for (p1, p2) in segments {
          lines.push(ContourLine {
            level,
            points: vec![*p1, *p2],
          });
        }
      }
    }

    contours.extend(lines);
  }

  contours
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_value_noise_deterministic() {
    let config = NoiseConfig::default();
    let v1 = value_noise_2d(100.0, 200.0, &config);
    let v2 = value_noise_2d(100.0, 200.0, &config);
    assert!((v1 - v2).abs() < f64::EPSILON);
  }

  #[test]
  fn test_value_noise_different_seeds() {
    let c1 = NoiseConfig { seed: 1, ..Default::default() };
    let c2 = NoiseConfig { seed: 99999, ..Default::default() };
    let v1 = value_noise_2d(100.0, 200.0, &c1);
    let v2 = value_noise_2d(100.0, 200.0, &c2);
    assert_ne!(v1, v2);
  }

  #[test]
  fn test_heightmap_generate() {
    let config = NoiseConfig::default();
    let map = HeightMap::generate(&config, 64, 64, 0.0, 0.0);
    assert_eq!(map.width, 64);
    assert_eq!(map.height, 64);
    assert_eq!(map.data.len(), 64 * 64);
  }

  #[test]
  fn test_heightmap_normalize() {
    let config = NoiseConfig::default();
    let mut map = HeightMap::generate(&config, 32, 32, 0.0, 0.0);
    map.normalize();
    assert!(map.min() >= -0.001);
    assert!(map.max() <= 1.001);
  }

  #[test]
  fn test_heightmap_slope() {
    let mut map = HeightMap::new(10, 10);
    for y in 0..10 {
      for x in 0..10 {
        map.set(x, y, (x + y) as f64);
      }
    }
    let (dx, dy) = map.slope_at(5, 5);
    assert!((dx - 1.0).abs() < 0.01);
    assert!((dy - 1.0).abs() < 0.01);
  }

  #[test]
  fn test_marching_squares_flat() {
    let mut map = HeightMap::new(10, 10);
    for i in 0..100 {
      map.data[i] = 0.5;
    }
    let contours = marching_squares(&map, &[0.5]);
    assert!(contours.is_empty());
  }

  #[test]
  fn test_marching_squares_slope() {
    let mut map = HeightMap::new(10, 10);
    for y in 0..10 {
      for x in 0..10 {
        map.set(x, y, (y as f64) / 10.0);
      }
    }
    let contours = marching_squares(&map, &[0.3, 0.5, 0.7]);
    assert!(!contours.is_empty());
  }
}
