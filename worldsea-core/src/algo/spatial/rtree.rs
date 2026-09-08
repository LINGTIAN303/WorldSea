use rstar::{AABB, RTree, RTreeObject};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpatialItem {
  pub id: String,
  pub min: [f64; 2],
  pub max: [f64; 2],
  pub category: String,
}

impl RTreeObject for SpatialItem {
  type Envelope = AABB<[f64; 2]>;

  fn envelope(&self) -> Self::Envelope {
    AABB::from_corners(self.min, self.max)
  }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointItem {
  pub id: String,
  pub coord: [f64; 2],
  pub category: String,
}

impl RTreeObject for PointItem {
  type Envelope = AABB<[f64; 2]>;

  fn envelope(&self) -> Self::Envelope {
    AABB::from_point(self.coord)
  }
}

#[derive(Debug, Clone, Default)]
pub struct SpatialIndex {
  rectangles: RTree<SpatialItem>,
  points: RTree<PointItem>,
}

impl Serialize for SpatialIndex {
  fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct SpatialIndexData {
      rectangles: Vec<SpatialItem>,
      points: Vec<PointItem>,
    }
    let data = SpatialIndexData {
      rectangles: self.rectangles.iter().cloned().collect(),
      points: self.points.iter().cloned().collect(),
    };
    data.serialize(serializer)
  }
}

impl<'de> Deserialize<'de> for SpatialIndex {
  fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SpatialIndexData {
      rectangles: Vec<SpatialItem>,
      points: Vec<PointItem>,
    }
    let data = SpatialIndexData::deserialize(deserializer)?;
    let mut idx = Self::new();
    for item in data.rectangles {
      idx.rectangles.insert(item);
    }
    for item in data.points {
      idx.points.insert(item);
    }
    Ok(idx)
  }
}

fn euclidean_sq(a: [f64; 2], b: [f64; 2]) -> f64 {
  let dx = a[0] - b[0];
  let dy = a[1] - b[1];
  dx.mul_add(dx, dy * dy)
}

impl SpatialIndex {
  #[must_use]
  pub fn new() -> Self {
    Self::default()
  }

  pub fn insert_rect(&mut self, item: SpatialItem) {
    self.rectangles.insert(item);
  }

  pub fn insert_point(&mut self, item: PointItem) {
    self.points.insert(item);
  }

  pub fn remove_rect(&mut self, item: &SpatialItem) -> bool {
    self.rectangles.remove(item).is_some()
  }

  pub fn remove_point(&mut self, item: &PointItem) -> bool {
    self.points.remove(item).is_some()
  }

  #[must_use]
  pub fn query_rect_in_range(&self, min: [f64; 2], max: [f64; 2]) -> Vec<&SpatialItem> {
    let envelope = AABB::from_corners(min, max);
    self.rectangles.locate_in_envelope_intersecting(&envelope).collect()
  }

  #[must_use]
  pub fn query_point_in_range(&self, min: [f64; 2], max: [f64; 2]) -> Vec<&PointItem> {
    let envelope = AABB::from_corners(min, max);
    self.points.locate_in_envelope(&envelope).collect()
  }

  #[must_use]
  pub fn query_rect_at_point(&self, point: [f64; 2]) -> Vec<&SpatialItem> {
    let envelope = AABB::from_point(point);
    self
      .rectangles
      .locate_in_envelope_intersecting(&envelope)
      .collect()
  }

  #[must_use]
  pub fn nearest_point(&self, query: [f64; 2]) -> Option<&PointItem> {
    let mut best: Option<(&PointItem, f64)> = None;
    for item in &self.points {
      let d = euclidean_sq(query, item.coord);
      if best.is_none_or(|(_, bd)| d < bd) {
        best = Some((item, d));
      }
    }
    best.map(|(item, _)| item)
  }

  #[must_use]
  pub fn nearest_rect(&self, query: [f64; 2]) -> Option<&SpatialItem> {
    let mut best: Option<(&SpatialItem, f64)> = None;
    for item in &self.rectangles {
      let center = [
        f64::midpoint(item.min[0], item.max[0]),
        f64::midpoint(item.min[1], item.max[1]),
      ];
      let d = euclidean_sq(query, center);
      if best.is_none_or(|(_, bd)| d < bd) {
        best = Some((item, d));
      }
    }
    best.map(|(item, _)| item)
  }

  #[must_use]
  pub fn k_nearest_points(&self, query: [f64; 2], k: usize) -> Vec<&PointItem> {
    let mut items: Vec<(&PointItem, f64)> = self
      .points
      .iter()
      .map(|item| (item, euclidean_sq(query, item.coord)))
      .collect();
    items.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    items.into_iter().take(k).map(|(item, _)| item).collect()
  }

  #[must_use]
  pub fn query_rects_by_category(&self, category: &str) -> Vec<&SpatialItem> {
    self
      .rectangles
      .iter()
      .filter(|item| item.category == category)
      .collect()
  }

  #[must_use]
  pub fn rect_count(&self) -> usize {
    self.rectangles.size()
  }

  #[must_use]
  pub fn point_count(&self) -> usize {
    self.points.size()
  }

  pub fn clear(&mut self) {
    self.rectangles = RTree::new();
    self.points = RTree::new();
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpatialQueryResult {
  pub ids: Vec<String>,
  pub count: usize,
}

impl SpatialQueryResult {
  #[must_use]
  pub fn from_rect_items(items: &[&SpatialItem]) -> Self {
    let ids: Vec<String> = items.iter().map(|i| i.id.clone()).collect();
    Self {
      count: ids.len(),
      ids,
    }
  }

  #[must_use]
  pub fn from_point_items(items: &[&PointItem]) -> Self {
    let ids: Vec<String> = items.iter().map(|i| i.id.clone()).collect();
    Self {
      count: ids.len(),
      ids,
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn make_rect(id: &str, x1: f64, y1: f64, x2: f64, y2: f64, cat: &str) -> SpatialItem {
    SpatialItem {
      id: id.to_string(),
      min: [x1, y1],
      max: [x2, y2],
      category: cat.to_string(),
    }
  }

  fn make_point(id: &str, x: f64, y: f64, cat: &str) -> PointItem {
    PointItem {
      id: id.to_string(),
      coord: [x, y],
      category: cat.to_string(),
    }
  }

  #[test]
  fn test_insert_and_query_rect() {
    let mut idx = SpatialIndex::new();
    idx.insert_rect(make_rect("wall1", 0.0, 0.0, 10.0, 0.3, "wall"));
    idx.insert_rect(make_rect("wall2", 0.0, 0.0, 0.3, 10.0, "wall"));
    idx.insert_rect(make_rect("door1", 3.0, 0.0, 4.0, 0.3, "door"));

    let results = idx.query_rect_in_range([2.0, -1.0], [5.0, 1.0]);
    assert_eq!(results.len(), 2);
    let ids: Vec<&str> = results.iter().map(|r| r.id.as_str()).collect();
    assert!(ids.contains(&"wall1"));
    assert!(ids.contains(&"door1"));
  }

  #[test]
  fn test_point_at_click() {
    let mut idx = SpatialIndex::new();
    idx.insert_rect(make_rect("furniture1", 2.0, 3.0, 5.0, 6.0, "furniture"));
    idx.insert_rect(make_rect("furniture2", 10.0, 10.0, 12.0, 12.0, "furniture"));

    let hits = idx.query_rect_at_point([3.5, 4.5]);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, "furniture1");
  }

  #[test]
  fn test_nearest_neighbor() {
    let mut idx = SpatialIndex::new();
    idx.insert_point(make_point("p1", 1.0, 1.0, "node"));
    idx.insert_point(make_point("p2", 5.0, 5.0, "node"));
    idx.insert_point(make_point("p3", 10.0, 10.0, "node"));

    let nearest = idx.nearest_point([4.0, 4.0]).unwrap();
    assert_eq!(nearest.id, "p2");
  }

  #[test]
  fn test_k_nearest() {
    let mut idx = SpatialIndex::new();
    for i in 0..10 {
      let x = f64::from(i) * 2.0;
      idx.insert_point(make_point(&format!("p{i}"), x, 0.0, "node"));
    }

    let results = idx.k_nearest_points([3.0, 0.0], 3);
    assert_eq!(results.len(), 3);
    assert_eq!(results[0].id, "p2");
  }

  #[test]
  fn test_category_filter() {
    let mut idx = SpatialIndex::new();
    idx.insert_rect(make_rect("w1", 0.0, 0.0, 10.0, 0.3, "wall"));
    idx.insert_rect(make_rect("d1", 3.0, 0.0, 4.0, 0.3, "door"));
    idx.insert_rect(make_rect("w2", 0.0, 0.0, 0.3, 10.0, "wall"));

    let walls = idx.query_rects_by_category("wall");
    assert_eq!(walls.len(), 2);
  }

  #[test]
  fn test_remove() {
    let mut idx = SpatialIndex::new();
    let item = make_rect("r1", 0.0, 0.0, 1.0, 1.0, "test");
    idx.insert_rect(item.clone());
    assert_eq!(idx.rect_count(), 1);

    assert!(idx.remove_rect(&item));
    assert_eq!(idx.rect_count(), 0);
  }

  #[test]
  fn test_clear() {
    let mut idx = SpatialIndex::new();
    idx.insert_rect(make_rect("r1", 0.0, 0.0, 1.0, 1.0, "test"));
    idx.insert_point(make_point("p1", 0.0, 0.0, "test"));
    idx.clear();
    assert_eq!(idx.rect_count(), 0);
    assert_eq!(idx.point_count(), 0);
  }

  #[test]
  fn test_serialize_deserialize() {
    let mut idx = SpatialIndex::new();
    idx.insert_rect(make_rect("r1", 0.0, 0.0, 10.0, 10.0, "wall"));
    idx.insert_point(make_point("p1", 5.0, 5.0, "node"));

    let json = serde_json::to_string(&idx).unwrap();
    let restored: SpatialIndex = serde_json::from_str(&json).unwrap();
    assert_eq!(restored.rect_count(), 1);
    assert_eq!(restored.point_count(), 1);
  }
}
