use std::collections::HashMap;
use serde::{Deserialize, Serialize};

use crate::algo::geometry::line::Point2D;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConstraintType {
  FixedPoint { point_id: String, position: Point2D },
  Horizontal { line_id: String },
  Vertical { line_id: String },
  Parallel { line_id_a: String, line_id_b: String },
  Perpendicular { line_id_a: String, line_id_b: String },
  EqualLength { line_id_a: String, line_id_b: String },
  Distance { point_id_a: String, point_id_b: String, distance: f64 },
  Angle { line_id_a: String, line_id_b: String, angle_deg: f64 },
  Coincident { point_id_a: String, point_id_b: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Constraint {
  pub id: String,
  pub constraint_type: ConstraintType,
  pub priority: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintPoint {
  pub id: String,
  pub position: Point2D,
  pub free: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintLine {
  pub id: String,
  pub start_id: String,
  pub end_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintSystem {
  pub points: HashMap<String, ConstraintPoint>,
  pub lines: HashMap<String, ConstraintLine>,
  pub constraints: Vec<Constraint>,
}

fn angle_distance(a: f64, b: f64) -> f64 {
  let d = (b - a).rem_euclid(2.0 * std::f64::consts::PI);
  if d > std::f64::consts::PI { 2.0 * std::f64::consts::PI - d } else { d }
}

fn closer_angle(current: f64, option1: f64, option2: f64) -> f64 {
  if angle_distance(current, option1) <= angle_distance(current, option2) { option1 } else { option2 }
}

impl ConstraintSystem {
  #[must_use]
  pub fn new() -> Self {
    Self::default()
  }

  pub fn add_point(&mut self, id: String, position: Point2D, free: bool) {
    self.points.insert(id.clone(), ConstraintPoint { id, position, free });
  }

  pub fn add_line(&mut self, id: String, start_id: String, end_id: String) {
    self.lines.insert(id.clone(), ConstraintLine { id, start_id, end_id });
  }

  pub fn add_constraint(&mut self, constraint: Constraint) {
    self.constraints.push(constraint);
  }

  pub fn solve(&mut self, max_iterations: usize, tolerance: f64) -> SolveResult {
    let mut iterations = 0;
    let mut residual = f64::INFINITY;
    let mut violations: Vec<String> = Vec::new();

    for _ in 0..max_iterations {
      iterations += 1;
      let mut total_error = 0.0_f64;
      violations.clear();

      for constraint in &self.constraints {
        let (error, corrections) = self.evaluate_constraint(constraint);
        total_error += error * error;

        if error.abs() > tolerance {
          violations.push(format!(
            "约束 {} 违反，残差: {:.6}",
            constraint.id, error
          ));
        }

        for (point_id, dx, dy) in &corrections {
          if let Some(pt) = self.points.get_mut(point_id) {
            pt.position.x += dx;
            pt.position.y += dy;
          }
        }
      }

      residual = total_error.sqrt();
      if residual < tolerance {
        return SolveResult {
          solved: true,
          iterations,
          residual,
          violations: vec![],
        };
      }
    }

    SolveResult {
      solved: false,
      iterations,
      residual,
      violations,
    }
  }

  fn evaluate_constraint(&self, constraint: &Constraint) -> (f64, Vec<(String, f64, f64)>) {
    match &constraint.constraint_type {
      ConstraintType::FixedPoint { point_id, position } => {
        if let Some(pt) = self.points.get(point_id) {
          let dx = position.x - pt.position.x;
          let dy = position.y - pt.position.y;
          let dist = dx.hypot(dy);
          (dist, vec![(point_id.clone(), dx, dy)])
        } else {
          (0.0, vec![])
        }
      }
      ConstraintType::Horizontal { line_id } => {
        if let Some(line) = self.lines.get(line_id) {
          let start = self.points.get(&line.start_id);
          let end = self.points.get(&line.end_id);
          if let (Some(s), Some(e)) = (start, end) {
            let dy = s.position.y - e.position.y;
            let sf = s.free;
            let ef = e.free;
            let corrections = match (sf, ef) {
              (true, true) => vec![
                (line.start_id.clone(), 0.0, -dy * 0.5),
                (line.end_id.clone(), 0.0, dy * 0.5),
              ],
              (true, false) => vec![(line.start_id.clone(), 0.0, -dy)],
              (false, true) => vec![(line.end_id.clone(), 0.0, dy)],
              (false, false) => vec![],
            };
            (dy.abs(), corrections)
          } else {
            (0.0, vec![])
          }
        } else {
          (0.0, vec![])
        }
      }
      ConstraintType::Vertical { line_id } => {
        if let Some(line) = self.lines.get(line_id) {
          let start = self.points.get(&line.start_id);
          let end = self.points.get(&line.end_id);
          if let (Some(s), Some(e)) = (start, end) {
            let dx = s.position.x - e.position.x;
            let sf = s.free;
            let ef = e.free;
            let corrections = match (sf, ef) {
              (true, true) => vec![
                (line.start_id.clone(), -dx * 0.5, 0.0),
                (line.end_id.clone(), dx * 0.5, 0.0),
              ],
              (true, false) => vec![(line.start_id.clone(), -dx, 0.0)],
              (false, true) => vec![(line.end_id.clone(), dx, 0.0)],
              (false, false) => vec![],
            };
            (dx.abs(), corrections)
          } else {
            (0.0, vec![])
          }
        } else {
          (0.0, vec![])
        }
      }
      ConstraintType::Distance { point_id_a, point_id_b, distance } => {
        let pa = self.points.get(point_id_a);
        let pb = self.points.get(point_id_b);
        if let (Some(a), Some(b)) = (pa, pb) {
          let dx = b.position.x - a.position.x;
          let dy = b.position.y - a.position.y;
          let current = dx.hypot(dy);
          let error = current - distance;
          if current.abs() < f64::EPSILON {
            (error.abs(), vec![])
          } else {
            let nx = dx / current;
            let ny = dy / current;
            let af = a.free;
            let bf = b.free;
            let corrections = match (af, bf) {
              (true, true) => {
                let c = error * 0.5;
                vec![
                  (point_id_a.clone(), nx * c, ny * c),
                  (point_id_b.clone(), -nx * c, -ny * c),
                ]
              }
              (true, false) => {
                vec![(point_id_a.clone(), nx * error, ny * error)]
              }
              (false, true) => {
                vec![(point_id_b.clone(), -nx * error, -ny * error)]
              }
              (false, false) => vec![],
            };
            (error.abs(), corrections)
          }
        } else {
          (0.0, vec![])
        }
      }
      ConstraintType::Coincident { point_id_a, point_id_b } => {
        let pa = self.points.get(point_id_a);
        let pb = self.points.get(point_id_b);
        if let (Some(a), Some(b)) = (pa, pb) {
          let dx = a.position.x - b.position.x;
          let dy = a.position.y - b.position.y;
          let af = a.free;
          let bf = b.free;
          let corrections = match (af, bf) {
            (true, true) => vec![
              (point_id_a.clone(), -dx * 0.5, -dy * 0.5),
              (point_id_b.clone(), dx * 0.5, dy * 0.5),
            ],
            (true, false) => vec![(point_id_a.clone(), -dx, -dy)],
            (false, true) => vec![(point_id_b.clone(), dx, dy)],
            (false, false) => vec![],
          };
          (dx.hypot(dy), corrections)
        } else {
          (0.0, vec![])
        }
      }
      ConstraintType::Parallel { line_id_a, line_id_b } => {
        let dir_a = self.line_direction(line_id_a);
        let dir_b = self.line_direction(line_id_b);
        if let (Some(da), Some(db)) = (dir_a, dir_b) {
          let cross = da.0 * db.1 - da.1 * db.0;
          let angle_a = da.1.atan2(da.0);
          let angle_b = db.1.atan2(db.0);
          let target = closer_angle(angle_b, angle_a, angle_a + std::f64::consts::PI);
          let mut corrections = self.apply_rotation_correction(line_id_b, target);
          if corrections.is_empty() {
            let target_a = closer_angle(angle_a, angle_b, angle_b + std::f64::consts::PI);
            corrections = self.apply_rotation_correction(line_id_a, target_a);
          }
          (cross.abs(), corrections)
        } else {
          (0.0, vec![])
        }
      }
      ConstraintType::Perpendicular { line_id_a, line_id_b } => {
        let dir_a = self.line_direction(line_id_a);
        let dir_b = self.line_direction(line_id_b);
        if let (Some(da), Some(db)) = (dir_a, dir_b) {
          let dot = da.0 * db.0 + da.1 * db.1;
          let angle_a = da.1.atan2(da.0);
          let angle_b = db.1.atan2(db.0);
          let target = closer_angle(
            angle_b,
            angle_a + std::f64::consts::FRAC_PI_2,
            angle_a - std::f64::consts::FRAC_PI_2,
          );
          let mut corrections = self.apply_rotation_correction(line_id_b, target);
          if corrections.is_empty() {
            let target_a = closer_angle(
              angle_a,
              angle_b + std::f64::consts::FRAC_PI_2,
              angle_b - std::f64::consts::FRAC_PI_2,
            );
            corrections = self.apply_rotation_correction(line_id_a, target_a);
          }
          (dot.abs(), corrections)
        } else {
          (0.0, vec![])
        }
      }
      ConstraintType::EqualLength { line_id_a, line_id_b } => {
        let len_a = self.line_length(line_id_a);
        let len_b = self.line_length(line_id_b);
        if let (Some(la), Some(lb)) = (len_a, len_b) {
          if la < f64::EPSILON || lb < f64::EPSILON {
            return ((la - lb).abs(), vec![]);
          }
          let error = (la - lb).abs();
          let mut corrections = self.apply_scale_correction(line_id_b, la);
          if corrections.is_empty() {
            corrections = self.apply_scale_correction(line_id_a, lb);
          }
          (error, corrections)
        } else {
          (0.0, vec![])
        }
      }
      ConstraintType::Angle { line_id_a, line_id_b, angle_deg } => {
        let dir_a = self.line_direction(line_id_a);
        let dir_b = self.line_direction(line_id_b);
        if let (Some(da), Some(db)) = (dir_a, dir_b) {
          let angle_a = da.1.atan2(da.0);
          let angle_b = db.1.atan2(db.0);
          let angle_rad = angle_deg.to_radians();
          let target = closer_angle(angle_b, angle_a + angle_rad, angle_a - angle_rad);
          let error = angle_distance(angle_b, target);
          let mut corrections = self.apply_rotation_correction(line_id_b, target);
          if corrections.is_empty() {
            let target_a = closer_angle(angle_a, angle_b - angle_rad, angle_b + angle_rad);
            corrections = self.apply_rotation_correction(line_id_a, target_a);
          }
          (error, corrections)
        } else {
          (0.0, vec![])
        }
      }
    }
  }

  fn line_direction(&self, line_id: &str) -> Option<(f64, f64)> {
    let line = self.lines.get(line_id)?;
    let start = self.points.get(&line.start_id)?;
    let end = self.points.get(&line.end_id)?;
    let dx = end.position.x - start.position.x;
    let dy = end.position.y - start.position.y;
    let len = dx.hypot(dy);
    if len < f64::EPSILON {
      None
    } else {
      Some((dx / len, dy / len))
    }
  }

  fn line_length(&self, line_id: &str) -> Option<f64> {
    let line = self.lines.get(line_id)?;
    let start = self.points.get(&line.start_id)?;
    let end = self.points.get(&line.end_id)?;
    Some((end.position.x - start.position.x).hypot(end.position.y - start.position.y))
  }

  fn apply_rotation_correction(&self, line_id: &str, target_angle: f64) -> Vec<(String, f64, f64)> {
    let line = match self.lines.get(line_id) {
      Some(l) => l,
      None => return vec![],
    };
    let start = match self.points.get(&line.start_id) {
      Some(p) => p,
      None => return vec![],
    };
    let end = match self.points.get(&line.end_id) {
      Some(p) => p,
      None => return vec![],
    };
    let dx = end.position.x - start.position.x;
    let dy = end.position.y - start.position.y;
    let len = dx.hypot(dy);
    if len < f64::EPSILON {
      return vec![];
    }
    let new_ex = start.position.x + len * target_angle.cos();
    let new_ey = start.position.y + len * target_angle.sin();
    let cx = new_ex - end.position.x;
    let cy = new_ey - end.position.y;
    match (start.free, end.free) {
      (_, true) => vec![(line.end_id.clone(), cx, cy)],
      (true, false) => vec![(line.start_id.clone(), -cx, -cy)],
      (false, false) => vec![],
    }
  }

  fn apply_scale_correction(&self, line_id: &str, target_length: f64) -> Vec<(String, f64, f64)> {
    let line = match self.lines.get(line_id) {
      Some(l) => l,
      None => return vec![],
    };
    let start = match self.points.get(&line.start_id) {
      Some(p) => p,
      None => return vec![],
    };
    let end = match self.points.get(&line.end_id) {
      Some(p) => p,
      None => return vec![],
    };
    let dx = end.position.x - start.position.x;
    let dy = end.position.y - start.position.y;
    let len = dx.hypot(dy);
    if len < f64::EPSILON {
      return vec![];
    }
    let scale = target_length / len;
    let new_ex = start.position.x + dx * scale;
    let new_ey = start.position.y + dy * scale;
    let cx = new_ex - end.position.x;
    let cy = new_ey - end.position.y;
    match (start.free, end.free) {
      (_, true) => vec![(line.end_id.clone(), cx, cy)],
      (true, false) => vec![(line.start_id.clone(), -cx, -cy)],
      (false, false) => vec![],
    }
  }

}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolveResult {
  pub solved: bool,
  pub iterations: usize,
  pub residual: f64,
  pub violations: Vec<String>,
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_fixed_point_constraint() {
    let mut sys = ConstraintSystem::new();
    sys.add_point("p1".to_string(), Point2D::new(5.0, 5.0), true);
    sys.add_constraint(Constraint {
      id: "c1".to_string(),
      constraint_type: ConstraintType::FixedPoint {
        point_id: "p1".to_string(),
        position: Point2D::new(0.0, 0.0),
      },
      priority: 0,
    });
    let result = sys.solve(100, 0.001);
    assert!(result.solved);
    assert!((sys.points["p1"].position.x - 0.0).abs() < 0.01);
    assert!((sys.points["p1"].position.y - 0.0).abs() < 0.01);
  }

  #[test]
  fn test_horizontal_constraint() {
    let mut sys = ConstraintSystem::new();
    sys.add_point("p1".to_string(), Point2D::new(0.0, 0.0), false);
    sys.add_point("p2".to_string(), Point2D::new(10.0, 5.0), true);
    sys.add_line("l1".to_string(), "p1".to_string(), "p2".to_string());
    sys.add_constraint(Constraint {
      id: "c1".to_string(),
      constraint_type: ConstraintType::Horizontal { line_id: "l1".to_string() },
      priority: 0,
    });
    let result = sys.solve(100, 0.001);
    assert!(result.solved);
    assert!((sys.points["p2"].position.y - 0.0).abs() < 0.01);
  }

  #[test]
  fn test_distance_constraint() {
    let mut sys = ConstraintSystem::new();
    sys.add_point("p1".to_string(), Point2D::new(0.0, 0.0), false);
    sys.add_point("p2".to_string(), Point2D::new(5.0, 0.0), true);
    sys.add_constraint(Constraint {
      id: "c1".to_string(),
      constraint_type: ConstraintType::Distance {
        point_id_a: "p1".to_string(),
        point_id_b: "p2".to_string(),
        distance: 10.0,
      },
      priority: 0,
    });
    let result = sys.solve(200, 0.01);
    assert!(result.solved);
    let actual = sys.points["p1"].position.distance_to(sys.points["p2"].position);
    assert!((actual - 10.0).abs() < 0.1);
  }

  #[test]
  fn test_coincident_constraint() {
    let mut sys = ConstraintSystem::new();
    sys.add_point("p1".to_string(), Point2D::new(0.0, 0.0), false);
    sys.add_point("p2".to_string(), Point2D::new(5.0, 5.0), true);
    sys.add_constraint(Constraint {
      id: "c1".to_string(),
      constraint_type: ConstraintType::Coincident {
        point_id_a: "p1".to_string(),
        point_id_b: "p2".to_string(),
      },
      priority: 0,
    });
    let result = sys.solve(100, 0.001);
    assert!(result.solved);
    assert!((sys.points["p2"].position.x - 0.0).abs() < 0.01);
    assert!((sys.points["p2"].position.y - 0.0).abs() < 0.01);
  }

  #[test]
  fn test_vertical_constraint() {
    let mut sys = ConstraintSystem::new();
    sys.add_point("p1".to_string(), Point2D::new(0.0, 0.0), false);
    sys.add_point("p2".to_string(), Point2D::new(5.0, 10.0), true);
    sys.add_line("l1".to_string(), "p1".to_string(), "p2".to_string());
    sys.add_constraint(Constraint {
      id: "c1".to_string(),
      constraint_type: ConstraintType::Vertical { line_id: "l1".to_string() },
      priority: 0,
    });
    let result = sys.solve(100, 0.001);
    assert!(result.solved);
    assert!((sys.points["p2"].position.x - 0.0).abs() < 0.01);
  }

  #[test]
  fn test_parallel_constraint() {
    let mut sys = ConstraintSystem::new();
    sys.add_point("p1".to_string(), Point2D::new(0.0, 0.0), false);
    sys.add_point("p2".to_string(), Point2D::new(10.0, 0.0), false);
    sys.add_line("l1".to_string(), "p1".to_string(), "p2".to_string());
    sys.add_point("p3".to_string(), Point2D::new(0.0, 5.0), false);
    sys.add_point("p4".to_string(), Point2D::new(5.0, 10.0), true);
    sys.add_line("l2".to_string(), "p3".to_string(), "p4".to_string());
    sys.add_constraint(Constraint {
      id: "c1".to_string(),
      constraint_type: ConstraintType::Parallel {
        line_id_a: "l1".to_string(),
        line_id_b: "l2".to_string(),
      },
      priority: 0,
    });
    let result = sys.solve(200, 0.01);
    assert!(result.solved);
    let dy = sys.points["p4"].position.y - sys.points["p3"].position.y;
    assert!(dy.abs() < 0.1, "line B should be horizontal (parallel to A), dy = {dy}");
  }

  #[test]
  fn test_perpendicular_constraint() {
    let mut sys = ConstraintSystem::new();
    sys.add_point("p1".to_string(), Point2D::new(0.0, 0.0), false);
    sys.add_point("p2".to_string(), Point2D::new(10.0, 0.0), false);
    sys.add_line("l1".to_string(), "p1".to_string(), "p2".to_string());
    sys.add_point("p3".to_string(), Point2D::new(0.0, 5.0), false);
    sys.add_point("p4".to_string(), Point2D::new(5.0, 10.0), true);
    sys.add_line("l2".to_string(), "p3".to_string(), "p4".to_string());
    sys.add_constraint(Constraint {
      id: "c1".to_string(),
      constraint_type: ConstraintType::Perpendicular {
        line_id_a: "l1".to_string(),
        line_id_b: "l2".to_string(),
      },
      priority: 0,
    });
    let result = sys.solve(200, 0.01);
    assert!(result.solved);
    let dx = sys.points["p4"].position.x - sys.points["p3"].position.x;
    assert!(dx.abs() < 0.1, "line B should be vertical (perpendicular to A), dx = {dx}");
  }

  #[test]
  fn test_equal_length_constraint() {
    let mut sys = ConstraintSystem::new();
    sys.add_point("p1".to_string(), Point2D::new(0.0, 0.0), false);
    sys.add_point("p2".to_string(), Point2D::new(10.0, 0.0), false);
    sys.add_line("l1".to_string(), "p1".to_string(), "p2".to_string());
    sys.add_point("p3".to_string(), Point2D::new(0.0, 5.0), false);
    sys.add_point("p4".to_string(), Point2D::new(3.0, 5.0), true);
    sys.add_line("l2".to_string(), "p3".to_string(), "p4".to_string());
    sys.add_constraint(Constraint {
      id: "c1".to_string(),
      constraint_type: ConstraintType::EqualLength {
        line_id_a: "l1".to_string(),
        line_id_b: "l2".to_string(),
      },
      priority: 0,
    });
    let result = sys.solve(200, 0.01);
    assert!(result.solved);
    let len_b = sys.points["p3"].position.distance_to(sys.points["p4"].position);
    assert!((len_b - 10.0).abs() < 0.1, "line B should have length 10, got {len_b}");
  }

  #[test]
  fn test_angle_constraint() {
    let mut sys = ConstraintSystem::new();
    sys.add_point("p1".to_string(), Point2D::new(0.0, 0.0), false);
    sys.add_point("p2".to_string(), Point2D::new(10.0, 0.0), false);
    sys.add_line("l1".to_string(), "p1".to_string(), "p2".to_string());
    sys.add_point("p3".to_string(), Point2D::new(0.0, 5.0), false);
    sys.add_point("p4".to_string(), Point2D::new(0.0, 10.0), true);
    sys.add_line("l2".to_string(), "p3".to_string(), "p4".to_string());
    sys.add_constraint(Constraint {
      id: "c1".to_string(),
      constraint_type: ConstraintType::Angle {
        line_id_a: "l1".to_string(),
        line_id_b: "l2".to_string(),
        angle_deg: 30.0,
      },
      priority: 0,
    });
    let result = sys.solve(200, 0.01);
    assert!(result.solved);
    let dir_a = {
      let dx = sys.points["p2"].position.x - sys.points["p1"].position.x;
      let dy = sys.points["p2"].position.y - sys.points["p1"].position.y;
      dy.atan2(dx)
    };
    let dir_b = {
      let dx = sys.points["p4"].position.x - sys.points["p3"].position.x;
      let dy = sys.points["p4"].position.y - sys.points["p3"].position.y;
      dy.atan2(dx)
    };
    let actual_angle = (dir_b - dir_a).to_degrees().rem_euclid(360.0);
    let min_angle = actual_angle.min(360.0 - actual_angle);
    assert!((min_angle - 30.0).abs() < 1.0, "angle should be ~30°, got {min_angle}");
  }
}
