use serde::{Deserialize, Serialize};

const EPSILON: f64 = 1e-9;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point2D {
  pub x: f64,
  pub y: f64,
}

impl Point2D {
  #[must_use]
  pub const fn new(x: f64, y: f64) -> Self {
    Self { x, y }
  }

  #[must_use]
  pub fn distance_to(self, other: Self) -> f64 {
    let dx = self.x - other.x;
    let dy = self.y - other.y;
    dx.hypot(dy)
  }

  #[must_use]
  pub fn distance_to_segment(self, a: Self, b: Self) -> f64 {
    let closest = self.project_onto_segment(a, b);
    self.distance_to(closest)
  }

  #[must_use]
  pub fn project_onto_segment(self, a: Self, b: Self) -> Self {
    let ab = Self::new(b.x - a.x, b.y - a.y);
    let ap = Self::new(self.x - a.x, self.y - a.y);
    let ab_sq = ab.x.mul_add(ab.x, ab.y * ab.y);
    if ab_sq < EPSILON {
      return a;
    }
    let t = (ap.x.mul_add(ab.x, ap.y * ab.y) / ab_sq).clamp(0.0, 1.0);
    Self::new(a.x + t * ab.x, a.y + t * ab.y)
  }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment2D {
  pub start: Point2D,
  pub end: Point2D,
}

impl Segment2D {
  #[must_use]
  pub const fn new(start: Point2D, end: Point2D) -> Self {
    Self { start, end }
  }

  #[must_use]
  pub fn length(self) -> f64 {
    self.start.distance_to(self.end)
  }

  #[must_use]
  pub fn intersects(self, other: Self) -> bool {
    segment_intersect(
      self.start, self.end, other.start, other.end,
    )
  }

  #[must_use]
  pub fn intersection_point(self, other: Self) -> Option<Point2D> {
    segment_intersection_point(
      self.start, self.end, other.start, other.end,
    )
  }
}

fn cross2d(o: Point2D, a: Point2D, b: Point2D) -> f64 {
  (a.x - o.x).mul_add(b.y - o.y, -((a.y - o.y) * (b.x - o.x)))
}

fn on_segment(p: Point2D, q: Point2D, r: Point2D) -> bool {
  q.x <= p.x.max(r.x) + EPSILON
    && q.x >= p.x.min(r.x) - EPSILON
    && q.y <= p.y.max(r.y) + EPSILON
    && q.y >= p.y.min(r.y) - EPSILON
}

#[must_use]
pub fn segment_intersect(
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  p4: Point2D,
) -> bool {
  let d1 = cross2d(p3, p4, p1);
  let d2 = cross2d(p3, p4, p2);
  let d3 = cross2d(p1, p2, p3);
  let d4 = cross2d(p1, p2, p4);

  if ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0))
    && ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0))
  {
    return true;
  }

  if d1.abs() < EPSILON && on_segment(p3, p1, p4) {
    return true;
  }
  if d2.abs() < EPSILON && on_segment(p3, p2, p4) {
    return true;
  }
  if d3.abs() < EPSILON && on_segment(p1, p3, p2) {
    return true;
  }
  if d4.abs() < EPSILON && on_segment(p1, p4, p2) {
    return true;
  }

  false
}

#[must_use]
pub fn segment_intersection_point(
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  p4: Point2D,
) -> Option<Point2D> {
  let denom = (p1.x - p2.x).mul_add(p3.y - p4.y, -((p1.y - p2.y) * (p3.x - p4.x)));
  if denom.abs() < EPSILON {
    return None;
  }

  let t = (p1.x - p3.x).mul_add(p3.y - p4.y, -((p1.y - p3.y) * (p3.x - p4.x))) / denom;
  let u = -(p1.x - p2.x).mul_add(p1.y - p3.y, -((p1.y - p2.y) * (p1.x - p3.x))) / denom;

  if (0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u) {
    Some(Point2D::new(
      t.mul_add(p2.x - p1.x, p1.x),
      t.mul_add(p2.y - p1.y, p1.y),
    ))
  } else {
    None
  }
}

#[must_use]
pub fn find_all_intersections(segments: &[Segment2D]) -> Vec<(usize, usize, Point2D)> {
  let mut results = Vec::new();
  let n = segments.len();
  for i in 0..n {
    for j in (i + 1)..n {
      if let Some(pt) = segments[i].intersection_point(segments[j]) {
        results.push((i, j, pt));
      }
    }
  }
  results
}

#[must_use]
pub fn nearest_point_on_segments(query: Point2D, segments: &[Segment2D]) -> Option<(usize, Point2D, f64)> {
  let mut best: Option<(usize, Point2D, f64)> = None;
  for (i, seg) in segments.iter().enumerate() {
    let proj = query.project_onto_segment(seg.start, seg.end);
    let dist = query.distance_to(proj);
    if best.is_none_or(|b| dist < b.2) {
      best = Some((i, proj, dist));
    }
  }
  best
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_segment_intersect_crossing() {
    let s1 = Segment2D::new(Point2D::new(0.0, 0.0), Point2D::new(10.0, 10.0));
    let s2 = Segment2D::new(Point2D::new(0.0, 10.0), Point2D::new(10.0, 0.0));
    assert!(s1.intersects(s2));
  }

  #[test]
  fn test_segment_intersect_parallel() {
    let s1 = Segment2D::new(Point2D::new(0.0, 0.0), Point2D::new(10.0, 0.0));
    let s2 = Segment2D::new(Point2D::new(0.0, 5.0), Point2D::new(10.0, 5.0));
    assert!(!s1.intersects(s2));
  }

  #[test]
  fn test_segment_intersect_collinear_overlap() {
    let s1 = Segment2D::new(Point2D::new(0.0, 0.0), Point2D::new(10.0, 0.0));
    let s2 = Segment2D::new(Point2D::new(5.0, 0.0), Point2D::new(15.0, 0.0));
    assert!(s1.intersects(s2));
  }

  #[test]
  fn test_intersection_point_exact() {
    let s1 = Segment2D::new(Point2D::new(0.0, 0.0), Point2D::new(10.0, 10.0));
    let s2 = Segment2D::new(Point2D::new(0.0, 10.0), Point2D::new(10.0, 0.0));
    let pt = s1.intersection_point(s2).unwrap();
    assert!((pt.x - 5.0).abs() < EPSILON);
    assert!((pt.y - 5.0).abs() < EPSILON);
  }

  #[test]
  fn test_intersection_point_no_cross() {
    let s1 = Segment2D::new(Point2D::new(0.0, 0.0), Point2D::new(5.0, 5.0));
    let s2 = Segment2D::new(Point2D::new(6.0, 6.0), Point2D::new(10.0, 10.0));
    assert!(s1.intersection_point(s2).is_none());
  }

  #[test]
  fn test_find_all_intersections() {
    let segments = vec![
      Segment2D::new(Point2D::new(0.0, 0.0), Point2D::new(10.0, 10.0)),
      Segment2D::new(Point2D::new(0.0, 10.0), Point2D::new(10.0, 0.0)),
      Segment2D::new(Point2D::new(0.0, 5.0), Point2D::new(10.0, 5.0)),
    ];
    let results = find_all_intersections(&segments);
    assert_eq!(results.len(), 3);
  }

  #[test]
  fn test_project_onto_segment() {
    let p = Point2D::new(5.0, 5.0);
    let a = Point2D::new(0.0, 0.0);
    let b = Point2D::new(10.0, 0.0);
    let proj = p.project_onto_segment(a, b);
    assert!((proj.x - 5.0).abs() < EPSILON);
    assert!((proj.y - 0.0).abs() < EPSILON);
  }

  #[test]
  fn test_project_onto_segment_clamp() {
    let p = Point2D::new(15.0, 5.0);
    let a = Point2D::new(0.0, 0.0);
    let b = Point2D::new(10.0, 0.0);
    let proj = p.project_onto_segment(a, b);
    assert!((proj.x - 10.0).abs() < EPSILON);
  }

  #[test]
  fn test_nearest_point_on_segments() {
    let segments = vec![
      Segment2D::new(Point2D::new(0.0, 0.0), Point2D::new(10.0, 0.0)),
      Segment2D::new(Point2D::new(0.0, 10.0), Point2D::new(10.0, 10.0)),
    ];
    let result = nearest_point_on_segments(Point2D::new(5.0, 3.0), &segments);
    assert!(result.is_some());
    let (idx, _, dist) = result.unwrap();
    assert_eq!(idx, 0);
    assert!((dist - 3.0).abs() < EPSILON);
  }
}
