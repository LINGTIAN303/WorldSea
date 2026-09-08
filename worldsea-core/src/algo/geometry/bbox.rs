use serde::{Deserialize, Serialize};

use super::line::Point2D;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AABB2D {
  pub min: Point2D,
  pub max: Point2D,
}

impl AABB2D {
  #[must_use]
  pub const fn new(min: Point2D, max: Point2D) -> Self {
    Self { min, max }
  }

  #[must_use]
  pub fn from_points(points: &[Point2D]) -> Option<Self> {
    if points.is_empty() {
      return None;
    }
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for p in points {
      min_x = min_x.min(p.x);
      min_y = min_y.min(p.y);
      max_x = max_x.max(p.x);
      max_y = max_y.max(p.y);
    }
    Some(Self {
      min: Point2D::new(min_x, min_y),
      max: Point2D::new(max_x, max_y),
    })
  }

  #[must_use]
  pub fn intersects(self, other: Self) -> bool {
    self.min.x <= other.max.x
      && self.max.x >= other.min.x
      && self.min.y <= other.max.y
      && self.max.y >= other.min.y
  }

  #[must_use]
  pub fn contains_point(self, point: Point2D) -> bool {
    point.x >= self.min.x
      && point.x <= self.max.x
      && point.y >= self.min.y
      && point.y <= self.max.y
  }

  #[must_use]
  pub fn contains_box(self, other: Self) -> bool {
    self.min.x <= other.min.x
      && self.max.x >= other.max.x
      && self.min.y <= other.min.y
      && self.max.y >= other.max.y
  }

  #[must_use]
  pub const fn merged(self, other: Self) -> Self {
    Self {
      min: Point2D::new(
        self.min.x.min(other.min.x),
        self.min.y.min(other.min.y),
      ),
      max: Point2D::new(
        self.max.x.max(other.max.x),
        self.max.y.max(other.max.y),
      ),
    }
  }

  #[must_use]
  pub fn intersection(self, other: Self) -> Option<Self> {
    if !self.intersects(other) {
      return None;
    }
    Some(Self {
      min: Point2D::new(
        self.min.x.max(other.min.x),
        self.min.y.max(other.min.y),
      ),
      max: Point2D::new(
        self.max.x.min(other.max.x),
        self.max.y.min(other.max.y),
      ),
    })
  }

  #[must_use]
  pub fn expanded(self, delta: f64) -> Self {
    Self {
      min: Point2D::new(self.min.x - delta, self.min.y - delta),
      max: Point2D::new(self.max.x + delta, self.max.y + delta),
    }
  }

  #[must_use]
  pub fn width(self) -> f64 {
    self.max.x - self.min.x
  }

  #[must_use]
  pub fn height(self) -> f64 {
    self.max.y - self.min.y
  }

  #[must_use]
  pub fn area(self) -> f64 {
    self.width() * self.height()
  }

  #[must_use]
  pub const fn center(self) -> Point2D {
    Point2D::new(
      f64::midpoint(self.min.x, self.max.x),
      f64::midpoint(self.min.y, self.max.y),
    )
  }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OBB2D {
  pub center: Point2D,
  pub half_extents: [f64; 2],
  pub rotation: f64,
}

impl OBB2D {
  #[must_use]
  pub const fn new(center: Point2D, half_extents: [f64; 2], rotation: f64) -> Self {
    Self {
      center,
      half_extents,
      rotation,
    }
  }

  #[must_use]
  pub fn axes(self) -> [Point2D; 2] {
    let cos = self.rotation.cos();
    let sin = self.rotation.sin();
    [
      Point2D::new(cos, sin),
      Point2D::new(-sin, cos),
    ]
  }

  #[must_use]
  pub fn corners(self) -> [Point2D; 4] {
    let [ax1, ax2] = self.axes();
    let ex = self.half_extents[0];
    let ey = self.half_extents[1];
    [
      Point2D::new(
        ax2.x.mul_add(ey, ax1.x.mul_add(ex, self.center.x)),
        ax2.y.mul_add(ey, ax1.y.mul_add(ex, self.center.y)),
      ),
      Point2D::new(
        ax2.x.mul_add(ey, ax1.x.mul_add(-ex, self.center.x)),
        ax2.y.mul_add(ey, ax1.y.mul_add(-ex, self.center.y)),
      ),
      Point2D::new(
        ax2.x.mul_add(-ey, ax1.x.mul_add(-ex, self.center.x)),
        ax2.y.mul_add(-ey, ax1.y.mul_add(-ex, self.center.y)),
      ),
      Point2D::new(
        ax2.x.mul_add(-ey, ax1.x.mul_add(ex, self.center.x)),
        ax2.y.mul_add(-ey, ax1.y.mul_add(ex, self.center.y)),
      ),
    ]
  }

  #[must_use]
  pub fn intersects(self, other: Self) -> bool {
    sat_test(self, other) && sat_test(other, self)
  }

  #[must_use]
  pub fn to_aabb(self) -> AABB2D {
    AABB2D::from_points(&self.corners()).unwrap_or_else(|| AABB2D::new(
      self.center,
      self.center,
    ))
  }
}

fn project_obb(obb: OBB2D, axis: Point2D) -> (f64, f64) {
  let corners = obb.corners();
  let mut min = f64::INFINITY;
  let mut max = f64::NEG_INFINITY;
  for c in &corners {
    let proj = c.x.mul_add(axis.x, c.y * axis.y);
    min = min.min(proj);
    max = max.max(proj);
  }
  (min, max)
}

fn overlap_on_axis(a: OBB2D, b: OBB2D, axis: Point2D) -> bool {
  let (min_a, max_a) = project_obb(a, axis);
  let (min_b, max_b) = project_obb(b, axis);
  max_a >= min_b && max_b >= min_a
}

fn sat_test(a: OBB2D, b: OBB2D) -> bool {
  let axes = a.axes();
  overlap_on_axis(a, b, axes[0]) && overlap_on_axis(a, b, axes[1])
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_aabb_intersects_overlap() {
    let a = AABB2D::new(Point2D::new(0.0, 0.0), Point2D::new(10.0, 10.0));
    let b = AABB2D::new(Point2D::new(5.0, 5.0), Point2D::new(15.0, 15.0));
    assert!(a.intersects(b));
  }

  #[test]
  fn test_aabb_no_intersect() {
    let a = AABB2D::new(Point2D::new(0.0, 0.0), Point2D::new(10.0, 10.0));
    let b = AABB2D::new(Point2D::new(20.0, 20.0), Point2D::new(30.0, 30.0));
    assert!(!a.intersects(b));
  }

  #[test]
  fn test_aabb_contains_point() {
    let a = AABB2D::new(Point2D::new(0.0, 0.0), Point2D::new(10.0, 10.0));
    assert!(a.contains_point(Point2D::new(5.0, 5.0)));
    assert!(!a.contains_point(Point2D::new(15.0, 5.0)));
  }

  #[test]
  fn test_aabb_merged() {
    let a = AABB2D::new(Point2D::new(0.0, 0.0), Point2D::new(10.0, 10.0));
    let b = AABB2D::new(Point2D::new(5.0, 5.0), Point2D::new(15.0, 15.0));
    let m = a.merged(b);
    assert!((m.min.x - 0.0).abs() < 1e-9);
    assert!((m.max.x - 15.0).abs() < 1e-9);
  }

  #[test]
  fn test_aabb_intersection() {
    let a = AABB2D::new(Point2D::new(0.0, 0.0), Point2D::new(10.0, 10.0));
    let b = AABB2D::new(Point2D::new(5.0, 5.0), Point2D::new(15.0, 15.0));
    let inter = a.intersection(b).unwrap();
    assert!((inter.min.x - 5.0).abs() < 1e-9);
    assert!((inter.max.x - 10.0).abs() < 1e-9);
  }

  #[test]
  fn test_obb_intersect_aligned() {
    let a = OBB2D::new(Point2D::new(5.0, 5.0), [5.0, 5.0], 0.0);
    let b = OBB2D::new(Point2D::new(10.0, 5.0), [5.0, 5.0], 0.0);
    assert!(a.intersects(b));
  }

  #[test]
  fn test_obb_no_intersect() {
    let a = OBB2D::new(Point2D::new(0.0, 0.0), [2.0, 2.0], 0.0);
    let b = OBB2D::new(Point2D::new(20.0, 20.0), [2.0, 2.0], 0.0);
    assert!(!a.intersects(b));
  }

  #[test]
  fn test_obb_rotated_intersect() {
    let a = OBB2D::new(Point2D::new(5.0, 5.0), [5.0, 1.0], 0.0);
    let b = OBB2D::new(Point2D::new(5.0, 5.0), [5.0, 1.0], std::f64::consts::FRAC_PI_2);
    assert!(a.intersects(b));
  }

  #[test]
  fn test_obb_to_aabb() {
    let obb = OBB2D::new(Point2D::new(5.0, 5.0), [3.0, 2.0], 0.0);
    let aabb = obb.to_aabb();
    assert!((aabb.min.x - 2.0).abs() < 1e-9);
    assert!((aabb.max.x - 8.0).abs() < 1e-9);
  }

  #[test]
  fn test_from_points() {
    let points = vec![
      Point2D::new(1.0, 2.0),
      Point2D::new(3.0, 4.0),
      Point2D::new(-1.0, 0.0),
    ];
    let aabb = AABB2D::from_points(&points).unwrap();
    assert!((aabb.min.x - (-1.0)).abs() < 1e-9);
    assert!((aabb.max.y - 4.0).abs() < 1e-9);
  }
}
