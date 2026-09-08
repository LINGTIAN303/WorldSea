use serde::{Deserialize, Serialize};

use super::line::{Point2D, Segment2D, segment_intersection_point};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Polygon2D {
  pub vertices: Vec<Point2D>,
}

impl Polygon2D {
  #[must_use]
  pub const fn new(vertices: Vec<Point2D>) -> Self {
    Self { vertices }
  }

  #[must_use]
  pub const fn is_valid(&self) -> bool {
    self.vertices.len() >= 3
  }

  #[must_use]
  pub fn signed_area(&self) -> f64 {
    let n = self.vertices.len();
    if n < 3 {
      return 0.0;
    }
    let mut area = 0.0;
    for i in 0..n {
      let j = (i + 1) % n;
      area += self.vertices[i].x * self.vertices[j].y;
      area -= self.vertices[j].x * self.vertices[i].y;
    }
    area / 2.0
  }

  #[must_use]
  pub fn area(&self) -> f64 {
    self.signed_area().abs()
  }

  #[must_use]
  pub fn is_clockwise(&self) -> bool {
    self.signed_area() < 0.0
  }

  #[must_use]
  pub fn centroid(&self) -> Option<Point2D> {
    if self.vertices.len() < 3 {
      return None;
    }
    let a = self.signed_area();
    if a.abs() < f64::EPSILON {
      #[allow(clippy::cast_precision_loss)]
      let n = self.vertices.len() as f64;
      let sum_x: f64 = self.vertices.iter().map(|v| v.x).sum();
      let sum_y: f64 = self.vertices.iter().map(|v| v.y).sum();
      return Some(Point2D::new(sum_x / n, sum_y / n));
    }
    let mut cx = 0.0;
    let mut cy = 0.0;
    let n = self.vertices.len();
    for i in 0..n {
      let j = (i + 1) % n;
      let cross = self.vertices[i].x.mul_add(self.vertices[j].y, -(self.vertices[j].x * self.vertices[i].y));
      cx += (self.vertices[i].x + self.vertices[j].x) * cross;
      cy += (self.vertices[i].y + self.vertices[j].y) * cross;
    }
    Some(Point2D::new(cx / (6.0 * a), cy / (6.0 * a)))
  }

  #[must_use]
  pub fn contains_point(&self, point: Point2D) -> bool {
    point_in_polygon(point, &self.vertices)
  }

  #[must_use]
  pub fn perimeter(&self) -> f64 {
    let n = self.vertices.len();
    if n < 2 {
      return 0.0;
    }
    let mut p = 0.0;
    for i in 0..n {
      let j = (i + 1) % n;
      p += self.vertices[i].distance_to(self.vertices[j]);
    }
    p
  }

  pub fn ensure_counter_clockwise(&mut self) -> bool {
    let was_cw = self.is_clockwise();
    if was_cw {
      self.vertices.reverse();
    }
    was_cw
  }
}

#[must_use]
pub fn point_in_polygon(point: Point2D, vertices: &[Point2D]) -> bool {
  let n = vertices.len();
  if n < 3 {
    return false;
  }
  let mut inside = false;
  let mut j = n - 1;
  for i in 0..n {
    let vi = vertices[i];
    let vj = vertices[j];
    if ((vi.y > point.y) != (vj.y > point.y))
      && (point.x < (vj.x - vi.x) * (point.y - vi.y) / (vj.y - vi.y) + vi.x)
    {
      inside = !inside;
    }
    j = i;
  }
  inside
}

#[must_use]
pub fn point_in_polygon_with_boundary(point: Point2D, vertices: &[Point2D], epsilon: f64) -> bool {
  if point_in_polygon(point, vertices) {
    return true;
  }
  let n = vertices.len();
  for i in 0..n {
    let j = (i + 1) % n;
    let dist = point.distance_to_segment(vertices[i], vertices[j]);
    if dist < epsilon {
      return true;
    }
  }
  false
}

#[must_use]
pub fn convex_hull(points: &[Point2D]) -> Vec<Point2D> {
  if points.len() <= 2 {
    return points.to_vec();
  }
  let mut sorted = points.to_vec();
  sorted.sort_by(|a, b| {
    a.x
      .partial_cmp(&b.x)
      .unwrap_or(std::cmp::Ordering::Equal)
      .then(a.y.partial_cmp(&b.y).unwrap_or(std::cmp::Ordering::Equal))
  });

  let mut lower = Vec::new();
  for p in &sorted {
    while lower.len() >= 2 {
      let a = lower[lower.len() - 2];
      let b = lower[lower.len() - 1];
      if cross(a, b, *p) <= 0.0 {
        lower.pop();
      } else {
        break;
      }
    }
    lower.push(*p);
  }

  let mut upper = Vec::new();
  for p in sorted.iter().rev() {
    while upper.len() >= 2 {
      let a = upper[upper.len() - 2];
      let b = upper[upper.len() - 1];
      if cross(a, b, *p) <= 0.0 {
        upper.pop();
      } else {
        break;
      }
    }
    upper.push(*p);
  }

  lower.pop();
  upper.pop();
  lower.extend(upper);
  lower
}

fn cross(o: Point2D, a: Point2D, b: Point2D) -> f64 {
  (a.x - o.x).mul_add(b.y - o.y, -((a.y - o.y) * (b.x - o.x)))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedEdge {
  pub edge_idx_a: usize,
  pub edge_idx_b: usize,
  pub distance: f64,
}

#[must_use]
pub fn find_shared_edges(
  vertices_a: &[Point2D],
  vertices_b: &[Point2D],
  threshold: f64,
) -> Vec<SharedEdge> {
  let mut result = Vec::new();
  let na = vertices_a.len();
  let nb = vertices_b.len();
  for i in 0..na {
    let a1 = vertices_a[i];
    let a2 = vertices_a[(i + 1) % na];
    for j in 0..nb {
      let b1 = vertices_b[j];
      let b2 = vertices_b[(j + 1) % nb];
      let d1 = a1.distance_to(b1);
      let d2 = a2.distance_to(b2);
      let d3 = a1.distance_to(b2);
      let d4 = a2.distance_to(b1);
      if (d1 < threshold && d2 < threshold) || (d3 < threshold && d4 < threshold) {
        result.push(SharedEdge {
          edge_idx_a: i,
          edge_idx_b: j,
          distance: d1.min(d2).min(d3).min(d4),
        });
      }
    }
  }
  result
}

#[must_use]
pub fn chaikin_smooth(vertices: &[Point2D], iterations: usize) -> Vec<Point2D> {
  if vertices.len() < 3 || iterations == 0 {
    return vertices.to_vec();
  }
  let mut current = vertices.to_vec();
  for _ in 0..iterations {
    let n = current.len();
    let mut next = Vec::with_capacity(n * 2);
    for i in 0..n {
      let a = current[i];
      let b = current[(i + 1) % n];
      next.push(Point2D::new(
        a.x * 0.75 + b.x * 0.25,
        a.y * 0.75 + b.y * 0.25,
      ));
      next.push(Point2D::new(
        a.x * 0.25 + b.x * 0.75,
        a.y * 0.25 + b.y * 0.75,
      ));
    }
    current = next;
  }
  current
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinePolygonIntersection {
  pub point: Point2D,
  pub line_idx: usize,
  pub edge_idx: usize,
}

#[must_use]
pub fn find_line_polygon_intersections(
  line: &[Point2D],
  polygon: &[Point2D],
) -> Vec<LinePolygonIntersection> {
  let mut result = Vec::new();
  let n = polygon.len();
  for i in 0..line.len().saturating_sub(1) {
    let seg = Segment2D::new(line[i], line[i + 1]);
    for j in 0..n {
      let edge = Segment2D::new(polygon[j], polygon[(j + 1) % n]);
      if let Some(pt) = segment_intersection_point(seg.start, seg.end, edge.start, edge.end) {
        result.push(LinePolygonIntersection {
          point: pt,
          line_idx: i,
          edge_idx: j,
        });
      }
    }
  }
  result
}

#[must_use]
pub fn polygon_split(
  polygon: &[Point2D],
  cutting_line: &[Point2D],
) -> Vec<Vec<Point2D>> {
  let intersections = find_line_polygon_intersections(cutting_line, polygon);
  if intersections.len() < 2 {
    return vec![polygon.to_vec()];
  }

  let int1 = &intersections[0];
  let int2 = &intersections[intersections.len() - 1];
  let n = polygon.len();

  let mut poly1 = vec![int1.point];
  let mut idx = (int1.edge_idx + 1) % n;
  while idx != (int2.edge_idx + 1) % n {
    poly1.push(polygon[idx]);
    idx = (idx + 1) % n;
  }
  poly1.push(int2.point);
  for i in (int1.line_idx..=int2.line_idx).rev() {
    if i < cutting_line.len() {
      poly1.push(cutting_line[i]);
    }
  }

  let mut poly2 = vec![int2.point];
  idx = (int2.edge_idx + 1) % n;
  while idx != (int1.edge_idx + 1) % n {
    poly2.push(polygon[idx]);
    idx = (idx + 1) % n;
  }
  poly2.push(int1.point);
  for i in int1.line_idx..=int2.line_idx {
    if i < cutting_line.len() {
      poly2.push(cutting_line[i]);
    }
  }

  let result: Vec<Vec<Point2D>> = vec![poly1, poly2]
    .into_iter()
    .filter(|p| p.len() >= 3)
    .collect();

  if result.is_empty() {
    vec![polygon.to_vec()]
  } else {
    result
  }
}

#[must_use]
pub fn polygon_augment(
  polygon: &[Point2D],
  adding_line: &[Point2D],
) -> Vec<Point2D> {
  let intersections = find_line_polygon_intersections(adding_line, polygon);
  if intersections.len() < 2 {
    return vec![];
  }

  let int1 = &intersections[0];
  let int2 = &intersections[intersections.len() - 1];
  let n = polygon.len();

  let mut result = vec![int1.point];
  for i in int1.line_idx + 1..=int2.line_idx {
    if i < adding_line.len() {
      result.push(adding_line[i]);
    }
  }
  result.push(int2.point);

  let mut idx = (int2.edge_idx + 1) % n;
  while idx != (int1.edge_idx + 1) % n {
    result.push(polygon[idx]);
    idx = (idx + 1) % n;
  }

  if result.len() >= 3 { result } else { vec![] }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn square() -> Polygon2D {
    Polygon2D::new(vec![
      Point2D::new(0.0, 0.0),
      Point2D::new(10.0, 0.0),
      Point2D::new(10.0, 10.0),
      Point2D::new(0.0, 10.0),
    ])
  }

  #[test]
  fn test_area_square() {
    let sq = square();
    assert!((sq.area() - 100.0).abs() < 1e-9);
  }

  #[test]
  fn test_centroid_square() {
    let sq = square();
    let c = sq.centroid().unwrap();
    assert!((c.x - 5.0).abs() < 1e-9);
    assert!((c.y - 5.0).abs() < 1e-9);
  }

  #[test]
  fn test_point_inside() {
    let sq = square();
    assert!(sq.contains_point(Point2D::new(5.0, 5.0)));
  }

  #[test]
  fn test_point_outside() {
    let sq = square();
    assert!(!sq.contains_point(Point2D::new(15.0, 5.0)));
  }

  #[test]
  fn test_point_on_edge() {
    let sq = square();
    assert!(sq.contains_point(Point2D::new(5.0, 0.0)));
    assert!(point_in_polygon_with_boundary(
      Point2D::new(5.0, 0.0),
      &sq.vertices,
      0.01
    ));
  }

  #[test]
  fn test_perimeter() {
    let sq = square();
    assert!((sq.perimeter() - 40.0).abs() < 1e-9);
  }

  #[test]
  fn test_clockwise_detection() {
    let cw = Polygon2D::new(vec![
      Point2D::new(0.0, 0.0),
      Point2D::new(0.0, 10.0),
      Point2D::new(10.0, 10.0),
      Point2D::new(10.0, 0.0),
    ]);
    assert!(cw.is_clockwise());
  }

  #[test]
  fn test_ensure_ccw() {
    let mut cw = Polygon2D::new(vec![
      Point2D::new(0.0, 0.0),
      Point2D::new(0.0, 10.0),
      Point2D::new(10.0, 10.0),
      Point2D::new(10.0, 0.0),
    ]);
    cw.ensure_counter_clockwise();
    assert!(!cw.is_clockwise());
  }

  #[test]
  fn test_convex_hull() {
    let points = vec![
      Point2D::new(0.0, 0.0),
      Point2D::new(1.0, 1.0),
      Point2D::new(2.0, 0.0),
      Point2D::new(1.0, -1.0),
      Point2D::new(0.5, 0.5),
    ];
    let hull = convex_hull(&points);
    assert_eq!(hull.len(), 4);
  }

  #[test]
  fn test_triangle_contains() {
    let tri = Polygon2D::new(vec![
      Point2D::new(0.0, 0.0),
      Point2D::new(10.0, 0.0),
      Point2D::new(5.0, 10.0),
    ]);
    assert!(tri.contains_point(Point2D::new(5.0, 3.0)));
    assert!(!tri.contains_point(Point2D::new(0.0, 10.0)));
  }

  #[test]
  fn test_chaikin_smooth() {
    let square = vec![
      Point2D::new(0.0, 0.0),
      Point2D::new(10.0, 0.0),
      Point2D::new(10.0, 10.0),
      Point2D::new(0.0, 10.0),
    ];
    let smoothed = chaikin_smooth(&square, 2);
    assert!(smoothed.len() > square.len(), "chaikin should increase vertex count");
  }

  #[test]
  fn test_chaikin_smooth_zero_iterations() {
    let pts = vec![
      Point2D::new(0.0, 0.0),
      Point2D::new(1.0, 0.0),
      Point2D::new(1.0, 1.0),
    ];
    let result = chaikin_smooth(&pts, 0);
    assert_eq!(result.len(), pts.len());
  }

  #[test]
  fn test_find_shared_edges() {
    let poly_a = vec![
      Point2D::new(0.0, 0.0),
      Point2D::new(10.0, 0.0),
      Point2D::new(10.0, 10.0),
      Point2D::new(0.0, 10.0),
    ];
    let poly_b = vec![
      Point2D::new(10.0, 0.0),
      Point2D::new(20.0, 0.0),
      Point2D::new(20.0, 10.0),
      Point2D::new(10.0, 10.0),
    ];
    let shared = find_shared_edges(&poly_a, &poly_b, 1.0);
    assert!(!shared.is_empty(), "adjacent squares should share edges");
  }

  #[test]
  fn test_find_shared_edges_no_overlap() {
    let poly_a = vec![
      Point2D::new(0.0, 0.0),
      Point2D::new(5.0, 0.0),
      Point2D::new(5.0, 5.0),
      Point2D::new(0.0, 5.0),
    ];
    let poly_b = vec![
      Point2D::new(100.0, 100.0),
      Point2D::new(110.0, 100.0),
      Point2D::new(110.0, 110.0),
      Point2D::new(100.0, 110.0),
    ];
    let shared = find_shared_edges(&poly_a, &poly_b, 1.0);
    assert!(shared.is_empty(), "distant squares should not share edges");
  }

  #[test]
  fn test_find_line_polygon_intersections() {
    let polygon = vec![
      Point2D::new(0.0, 0.0),
      Point2D::new(10.0, 0.0),
      Point2D::new(10.0, 10.0),
      Point2D::new(0.0, 10.0),
    ];
    let line = vec![
      Point2D::new(-5.0, 5.0),
      Point2D::new(15.0, 5.0),
    ];
    let intersections = find_line_polygon_intersections(&line, &polygon);
    assert_eq!(intersections.len(), 2, "horizontal line through center should intersect twice");
  }

  #[test]
  fn test_polygon_split() {
    let polygon = vec![
      Point2D::new(0.0, 0.0),
      Point2D::new(10.0, 0.0),
      Point2D::new(10.0, 10.0),
      Point2D::new(0.0, 10.0),
    ];
    let cutting = vec![
      Point2D::new(-5.0, 5.0),
      Point2D::new(15.0, 5.0),
    ];
    let parts = polygon_split(&polygon, &cutting);
    assert_eq!(parts.len(), 2, "splitting square horizontally should yield 2 parts");
    for part in &parts {
      assert!(part.len() >= 3, "each part should have at least 3 vertices");
    }
  }

  #[test]
  fn test_polygon_split_no_intersection() {
    let polygon = vec![
      Point2D::new(0.0, 0.0),
      Point2D::new(10.0, 0.0),
      Point2D::new(10.0, 10.0),
      Point2D::new(0.0, 10.0),
    ];
    let line = vec![
      Point2D::new(20.0, 0.0),
      Point2D::new(30.0, 0.0),
    ];
    let parts = polygon_split(&polygon, &line);
    assert_eq!(parts.len(), 1, "no intersection should return original polygon");
    assert_eq!(parts[0].len(), polygon.len());
  }

  #[test]
  fn test_polygon_augment() {
    let polygon = vec![
      Point2D::new(0.0, 0.0),
      Point2D::new(10.0, 0.0),
      Point2D::new(10.0, 10.0),
      Point2D::new(0.0, 10.0),
    ];
    let adding = vec![
      Point2D::new(-5.0, 5.0),
      Point2D::new(5.0, 5.0),
      Point2D::new(5.0, 15.0),
    ];
    let result = polygon_augment(&polygon, &adding);
    assert!(result.len() >= 3, "augmented polygon should have at least 3 vertices");
  }

  #[test]
  fn test_polygon_augment_no_intersection() {
    let polygon = vec![
      Point2D::new(0.0, 0.0),
      Point2D::new(10.0, 0.0),
      Point2D::new(10.0, 10.0),
      Point2D::new(0.0, 10.0),
    ];
    let line = vec![
      Point2D::new(20.0, 0.0),
      Point2D::new(30.0, 0.0),
    ];
    let result = polygon_augment(&polygon, &line);
    assert!(result.is_empty(), "no intersection should return empty");
  }
}
