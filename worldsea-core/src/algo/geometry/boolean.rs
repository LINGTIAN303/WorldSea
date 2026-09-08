use serde::{Deserialize, Serialize};

use crate::algo::geometry::line::Point2D;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Polygon2DResult {
  pub exterior: Vec<Point2D>,
  pub interiors: Vec<Vec<Point2D>>,
}

impl Polygon2DResult {
  fn from_geo_polygon(poly: &geo::Polygon<f64>) -> Self {
    let exterior: Vec<Point2D> = poly.exterior().points().map(|c| Point2D::new(c.x(), c.y())).collect();
    let interiors: Vec<Vec<Point2D>> = poly.interiors().iter()
      .map(|ring| ring.points().map(|c| Point2D::new(c.x(), c.y())).collect())
      .collect();
    Self { exterior, interiors }
  }
}

fn to_geo_polygon(exterior: &[Point2D], interiors: &[Vec<Point2D>]) -> geo::Polygon<f64> {
  let ext_line: geo::LineString<f64> = exterior.iter()
    .map(|p| geo::Coord { x: p.x, y: p.y })
    .collect();
  let int_lines: Vec<geo::LineString<f64>> = interiors.iter()
    .map(|ring| ring.iter().map(|p| geo::Coord { x: p.x, y: p.y }).collect())
    .collect();
  geo::Polygon::new(ext_line, int_lines)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BooleanOp {
  Union,
  Intersection,
  Difference,
  Xor,
}

pub fn polygon_boolean_op(
  op: &BooleanOp,
  a_exterior: &[Point2D],
  a_interiors: &[Vec<Point2D>],
  b_exterior: &[Point2D],
  b_interiors: &[Vec<Point2D>],
) -> Vec<Polygon2DResult> {
  use geo::BooleanOps;

  let poly_a = to_geo_polygon(a_exterior, a_interiors);
  let poly_b = to_geo_polygon(b_exterior, b_interiors);

  let result = match op {
    BooleanOp::Union => poly_a.union(&poly_b),
    BooleanOp::Intersection => poly_a.intersection(&poly_b),
    BooleanOp::Difference => poly_a.difference(&poly_b),
    BooleanOp::Xor => poly_a.xor(&poly_b),
  };

  result.0.iter().map(Polygon2DResult::from_geo_polygon).collect()
}

pub fn polygon_offset(exterior: &[Point2D], interiors: &[Vec<Point2D>], delta: f64) -> Polygon2DResult {
  use geo::algorithm::buffer::Buffer;

  let poly = to_geo_polygon(exterior, interiors);
  let buffered = poly.buffer(delta);

  if let Some(first) = buffered.0.first() {
    Polygon2DResult::from_geo_polygon(first)
  } else {
    Polygon2DResult { exterior: exterior.to_vec(), interiors: interiors.to_vec() }
  }
}

pub fn polygon_simplify(exterior: &[Point2D], interiors: &[Vec<Point2D>], epsilon: f64) -> Polygon2DResult {
  use geo::Simplify;

  let poly = to_geo_polygon(exterior, interiors);
  let simplified = poly.simplify(epsilon);

  Polygon2DResult::from_geo_polygon(&simplified)
}

pub fn polygon_convex_hull(points: &[Point2D]) -> Vec<Point2D> {
  use geo::ConvexHull;

  let coords: Vec<geo::Coord<f64>> = points.iter()
    .map(|p| geo::Coord { x: p.x, y: p.y })
    .collect();
  let multipoint = geo::MultiPoint(coords.iter().map(|c| geo::Point(*c)).collect());
  let hull = multipoint.convex_hull();

  hull.exterior().coords().map(|c| Point2D::new(c.x, c.y)).collect()
}

pub fn polygon_area(exterior: &[Point2D]) -> f64 {
  let line: geo::LineString<f64> = exterior.iter()
    .map(|p| geo::Coord { x: p.x, y: p.y })
    .collect();
  use geo::Area;
  let poly = geo::Polygon::new(line, vec![]);
  poly.signed_area().abs()
}

pub fn line_interpolate_point(line_points: &[Point2D], fraction: f64) -> Option<Point2D> {
  use geo::line_measures::Euclidean;
  use geo::InterpolatableLine;
  use geo::LineString;

  let line_string: LineString<f64> = line_points.iter()
    .map(|p| geo::Coord { x: p.x, y: p.y })
    .collect();

  line_string.point_at_ratio_from_start(&Euclidean, fraction)
    .map(|pt| Point2D::new(pt.x(), pt.y()))
}

pub fn line_length(line_points: &[Point2D]) -> f64 {
  use geo::line_measures::Euclidean;
  use geo::line_measures::LengthMeasurable;

  let line_string: geo::LineString<f64> = line_points.iter()
    .map(|p| geo::Coord { x: p.x, y: p.y })
    .collect();

  line_string.length(&Euclidean)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn square(x: f64, y: f64, size: f64) -> Vec<Point2D> {
    vec![
      Point2D::new(x, y),
      Point2D::new(x + size, y),
      Point2D::new(x + size, y + size),
      Point2D::new(x, y + size),
      Point2D::new(x, y),
    ]
  }

  #[test]
  fn test_union() {
    let a = square(0.0, 0.0, 2.0);
    let b = square(1.0, 1.0, 2.0);
    let result = polygon_boolean_op(&BooleanOp::Union, &a, &[], &b, &[]);
    assert!(!result.is_empty());
    let total_area: f64 = result.iter().map(|p| polygon_area(&p.exterior)).sum();
    assert!((total_area - 7.0).abs() < 0.1, "union area should be ~7, got {total_area}");
  }

  #[test]
  fn test_intersection() {
    let a = square(0.0, 0.0, 2.0);
    let b = square(1.0, 1.0, 2.0);
    let result = polygon_boolean_op(&BooleanOp::Intersection, &a, &[], &b, &[]);
    assert!(!result.is_empty());
    let total_area: f64 = result.iter().map(|p| polygon_area(&p.exterior)).sum();
    assert!((total_area - 1.0).abs() < 0.1, "intersection area should be ~1, got {total_area}");
  }

  #[test]
  fn test_difference() {
    let a = square(0.0, 0.0, 2.0);
    let b = square(1.0, 1.0, 2.0);
    let result = polygon_boolean_op(&BooleanOp::Difference, &a, &[], &b, &[]);
    assert!(!result.is_empty());
    let total_area: f64 = result.iter().map(|p| polygon_area(&p.exterior)).sum();
    assert!((total_area - 3.0).abs() < 0.1, "difference area should be ~3, got {total_area}");
  }

  #[test]
  fn test_xor() {
    let a = square(0.0, 0.0, 2.0);
    let b = square(1.0, 1.0, 2.0);
    let result = polygon_boolean_op(&BooleanOp::Xor, &a, &[], &b, &[]);
    assert!(!result.is_empty());
    let total_area: f64 = result.iter().map(|p| polygon_area(&p.exterior)).sum();
    assert!((total_area - 6.0).abs() < 0.1, "xor area should be ~6, got {total_area}");
  }

  #[test]
  fn test_polygon_area() {
    let sq = square(0.0, 0.0, 5.0);
    let area = polygon_area(&sq);
    assert!((area - 25.0).abs() < 0.01, "area should be 25, got {area}");
  }

  #[test]
  fn test_polygon_simplify() {
    let pts = vec![
      Point2D::new(0.0, 0.0),
      Point2D::new(1.0, 0.01),
      Point2D::new(2.0, 0.0),
      Point2D::new(2.0, 2.0),
      Point2D::new(0.0, 2.0),
      Point2D::new(0.0, 0.0),
    ];
    let result = polygon_simplify(&pts, &[], 0.1);
    assert!(result.exterior.len() < pts.len(), "simplified should have fewer points");
  }

  #[test]
  fn test_line_length() {
    let pts = vec![
      Point2D::new(0.0, 0.0),
      Point2D::new(3.0, 4.0),
    ];
    let len = line_length(&pts);
    assert!((len - 5.0).abs() < 0.01, "length should be 5, got {len}");
  }
}
