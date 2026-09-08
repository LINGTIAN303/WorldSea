use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
  pub target: String,
  pub weight: f64,
  pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WeightedGraph {
  pub adjacency: HashMap<String, Vec<GraphEdge>>,
}

impl WeightedGraph {
  #[must_use]
  pub fn new() -> Self {
    Self::default()
  }

  pub fn add_edge(&mut self, from: &str, to: &str, weight: f64, label: Option<String>) {
    self
      .adjacency
      .entry(from.to_string())
      .or_default()
      .push(GraphEdge {
        target: to.to_string(),
        weight,
        label,
      });
  }

  pub fn add_undirected_edge(&mut self, a: &str, b: &str, weight: f64, label: Option<String>) {
    self.add_edge(a, b, weight, label.clone());
    self.add_edge(b, a, weight, label);
  }

  #[must_use]
  pub fn nodes(&self) -> HashSet<&str> {
    let mut set = HashSet::new();
    for from in self.adjacency.keys() {
      set.insert(from.as_str());
      for edge in &self.adjacency[from] {
        set.insert(edge.target.as_str());
      }
    }
    set
  }

  #[must_use]
  pub fn node_count(&self) -> usize {
    self.nodes().len()
  }

  #[must_use]
  pub fn edge_count(&self) -> usize {
    self.adjacency.values().map(std::vec::Vec::len).sum()
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathResult {
  pub path: Vec<String>,
  pub total_cost: f64,
  pub found: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortestPathsResult {
  pub distances: HashMap<String, f64>,
  pub predecessors: HashMap<String, String>,
  pub source: String,
}

#[must_use] 
pub fn dijkstra(graph: &WeightedGraph, source: &str) -> ShortestPathsResult {
  let mut distances: HashMap<String, f64> = HashMap::new();
  let mut predecessors: HashMap<String, String> = HashMap::new();
  let mut visited: HashSet<String> = HashSet::new();

  distances.insert(source.to_string(), 0.0);

  let mut heap = BinaryHeap::new();
  heap.push(State {
    cost: 0.0,
    node: source.to_string(),
  });

  while let Some(State { cost, node }) = heap.pop() {
    if visited.contains(&node) {
      continue;
    }
    visited.insert(node.clone());

    if let Some(edges) = graph.adjacency.get(&node) {
      for edge in edges {
        let next = cost + edge.weight;
        let current_best = distances.get(&edge.target).copied().unwrap_or(f64::INFINITY);
        if next < current_best {
          distances.insert(edge.target.clone(), next);
          predecessors.insert(edge.target.clone(), node.clone());
          heap.push(State {
            cost: next,
            node: edge.target.clone(),
          });
        }
      }
    }
  }

  ShortestPathsResult {
    distances,
    predecessors,
    source: source.to_string(),
  }
}

#[must_use] 
pub fn dijkstra_path(graph: &WeightedGraph, source: &str, target: &str) -> PathResult {
  let result = dijkstra(graph, source);
  reconstruct_path(&result, target)
}

pub fn astar<F>(graph: &WeightedGraph, source: &str, target: &str, heuristic: F) -> PathResult
where
  F: Fn(&str) -> f64,
{
  let mut g_score: HashMap<String, f64> = HashMap::new();
  let mut predecessors: HashMap<String, String> = HashMap::new();
  let mut visited: HashSet<String> = HashSet::new();

  g_score.insert(source.to_string(), 0.0);

  let mut heap = BinaryHeap::new();
  heap.push(State {
    cost: heuristic(source),
    node: source.to_string(),
  });

  while let Some(State { cost: _f, node }) = heap.pop() {
    if node == target {
      let mut path = Vec::new();
      let mut current = target.to_string();
      path.push(current.clone());
      while let Some(pred) = predecessors.get(&current) {
        path.push(pred.clone());
        current = pred.clone();
      }
      path.reverse();
      return PathResult {
        found: true,
        total_cost: g_score.get(target).copied().unwrap_or(0.0),
        path,
      };
    }

    if visited.contains(&node) {
      continue;
    }
    visited.insert(node.clone());

    let current_g = g_score.get(&node).copied().unwrap_or(f64::INFINITY);

    if let Some(edges) = graph.adjacency.get(&node) {
      for edge in edges {
        let tentative_g = current_g + edge.weight;
        let neighbor_g = g_score.get(&edge.target).copied().unwrap_or(f64::INFINITY);
        if tentative_g < neighbor_g {
          g_score.insert(edge.target.clone(), tentative_g);
          predecessors.insert(edge.target.clone(), node.clone());
          let f = tentative_g + heuristic(&edge.target);
          heap.push(State {
            cost: f,
            node: edge.target.clone(),
          });
        }
      }
    }
  }

  PathResult {
    found: false,
    path: vec![],
    total_cost: f64::INFINITY,
  }
}

#[allow(clippy::missing_panics_doc)]
#[must_use] 
pub fn k_shortest_paths(graph: &WeightedGraph, source: &str, target: &str, k: usize) -> Vec<PathResult> {
  let first = dijkstra_path(graph, source, target);
  if !first.found {
    return vec![];
  }

  let mut results = vec![first];
  let _graph_copy = graph.clone();

  for _ in 1..k {
    let last_path = &results.last().unwrap().path;
    let mut found_alternative = false;

    for i in 0..last_path.len().saturating_sub(1) {
      let spur_node = &last_path[i];
      let root_path = &last_path[..=i];

      let mut temp_graph = graph.clone();

      for result in &results {
        if result.path.len() > i && result.path[..=i] == *root_path {
          let from = &result.path[i];
          let to = &result.path[i + 1];
          if let Some(edges) = temp_graph.adjacency.get_mut(from) {
            edges.retain(|e| e.target != *to);
          }
        }
      }

      for node in root_path.iter().take(root_path.len().saturating_sub(1)) {
        temp_graph.adjacency.remove(node);
      }

      let spur_result = dijkstra_path(&temp_graph, spur_node, target);
      if spur_result.found {
        let mut full_path = root_path.to_vec();
        full_path.extend_from_slice(&spur_result.path[1..]);
        let mut total_cost = 0.0;
        for j in 0..full_path.len().saturating_sub(1) {
          if let Some(edges) = graph.adjacency.get(&full_path[j]) {
            if let Some(e) = edges.iter().find(|e| e.target == full_path[j + 1]) {
              total_cost += e.weight;
            }
          }
        }
        results.push(PathResult {
          path: full_path,
          total_cost,
          found: true,
        });
        found_alternative = true;
        break;
      }
    }

    if !found_alternative {
      break;
    }
  }

  results.sort_by(|a, b| a.total_cost.partial_cmp(&b.total_cost).unwrap_or(Ordering::Equal));
  results.dedup_by(|a, b| a.path == b.path);
  results.truncate(k);
  results
}

fn reconstruct_path(result: &ShortestPathsResult, target: &str) -> PathResult {
  let cost = result.distances.get(target).copied().unwrap_or(f64::INFINITY);
  if cost.is_infinite() {
    return PathResult {
      found: false,
      path: vec![],
      total_cost: f64::INFINITY,
    };
  }

  let mut path = Vec::new();
  let mut current = target.to_string();
  path.push(current.clone());
  while let Some(pred) = result.predecessors.get(&current) {
    path.push(pred.clone());
    current = pred.clone();
  }
  path.reverse();

  PathResult {
    found: true,
    path,
    total_cost: cost,
  }
}

#[derive(Debug, Clone)]
struct State {
  cost: f64,
  node: String,
}

impl PartialEq for State {
  fn eq(&self, other: &Self) -> bool {
    self.cost == other.cost && self.node == other.node
  }
}

impl Eq for State {}

impl PartialOrd for State {
  fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
    Some(self.cmp(other))
  }
}

impl Ord for State {
  fn cmp(&self, other: &Self) -> Ordering {
    other
      .cost
      .partial_cmp(&self.cost)
      .unwrap_or(Ordering::Equal)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn sample_graph() -> WeightedGraph {
    let mut g = WeightedGraph::new();
    g.add_edge("A", "B", 1.0, None);
    g.add_edge("A", "C", 4.0, None);
    g.add_edge("B", "C", 2.0, None);
    g.add_edge("B", "D", 5.0, None);
    g.add_edge("C", "D", 1.0, None);
    g
  }

  #[test]
  fn test_dijkstra_shortest_path() {
    let g = sample_graph();
    let result = dijkstra_path(&g, "A", "D");
    assert!(result.found);
    assert_eq!(result.path, vec!["A", "B", "C", "D"]);
    assert!((result.total_cost - 4.0).abs() < 1e-9);
  }

  #[test]
  fn test_dijkstra_unreachable() {
    let g = sample_graph();
    let result = dijkstra_path(&g, "D", "A");
    assert!(!result.found);
  }

  #[test]
  fn test_dijkstra_all_distances() {
    let g = sample_graph();
    let result = dijkstra(&g, "A");
    assert!((result.distances["A"] - 0.0).abs() < 1e-9);
    assert!((result.distances["B"] - 1.0).abs() < 1e-9);
    assert!((result.distances["C"] - 3.0).abs() < 1e-9);
    assert!((result.distances["D"] - 4.0).abs() < 1e-9);
  }

  #[test]
  fn test_astar_with_heuristic() {
    let g = sample_graph();
    let h = |node: &str| match node {
      "A" => 5.0,
      "B" => 3.0,
      "C" => 1.0,
      "D" => 0.0,
      _ => f64::INFINITY,
    };
    let result = astar(&g, "A", "D", h);
    assert!(result.found);
    assert_eq!(result.path, vec!["A", "B", "C", "D"]);
    assert!((result.total_cost - 4.0).abs() < 1e-9);
  }

  #[test]
  fn test_astar_not_found() {
    let g = sample_graph();
    let result = astar(&g, "D", "A", |_| 0.0);
    assert!(!result.found);
  }

  #[test]
  fn test_k_shortest_paths() {
    let mut g = WeightedGraph::new();
    g.add_edge("A", "B", 1.0, None);
    g.add_edge("A", "C", 2.0, None);
    g.add_edge("B", "D", 2.0, None);
    g.add_edge("C", "D", 1.0, None);
    g.add_edge("A", "D", 10.0, None);

    let paths = k_shortest_paths(&g, "A", "D", 3);
    assert!(paths.len() >= 2);
    assert!((paths[0].total_cost - 3.0).abs() < 1e-9);
  }

  #[test]
  fn test_undirected_edge() {
    let mut g = WeightedGraph::new();
    g.add_undirected_edge("A", "B", 5.0, Some("friend".to_string()));
    assert_eq!(g.adjacency["A"].len(), 1);
    assert_eq!(g.adjacency["B"].len(), 1);
    assert_eq!(g.adjacency["A"][0].label.as_deref(), Some("friend"));
  }
}
