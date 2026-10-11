use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::pathfind::WeightedGraph;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRankResult {
  pub scores: HashMap<String, f64>,
  pub iterations: usize,
  pub converged: bool,
}

pub fn pagerank(
  graph: &WeightedGraph,
  damping: f64,
  max_iterations: usize,
  tolerance: f64,
) -> PageRankResult {
  let nodes: Vec<String> = graph.adjacency.keys().cloned().collect();
  let n = nodes.len();
  if n == 0 {
    return PageRankResult { scores: HashMap::new(), iterations: 0, converged: true };
  }

  let node_set: HashSet<String> = nodes.iter().cloned().collect();
  let mut out_degree: HashMap<String, usize> = HashMap::new();
  for (node, edges) in &graph.adjacency {
    out_degree.insert(node.clone(), edges.len());
  }

  let mut scores: HashMap<String, f64> = HashMap::new();
  let init_score = 1.0 / n as f64;
  for node in &nodes {
    scores.insert(node.clone(), init_score);
  }

  let mut iterations = 0;
  let mut converged = false;

  for i in 0..max_iterations {
    iterations = i + 1;
    let mut new_scores: HashMap<String, f64> = HashMap::new();
    for node in &nodes {
      new_scores.insert(node.clone(), (1.0 - damping) / n as f64);
    }

    for (source, edges) in &graph.adjacency {
      let degree = edges.len();
      if degree == 0 { continue; }
      let share = damping * scores[source] / degree as f64;
      for edge in edges {
        if let Some(s) = new_scores.get_mut(&edge.target) {
          *s += share;
        } else if node_set.contains(&edge.target) {
          new_scores.insert(edge.target.clone(), (1.0 - damping) / n as f64 + share);
        }
      }
    }

    let mut max_diff = 0.0_f64;
    for node in &nodes {
      let old_val = scores[node];
      let new_val = new_scores[node];
      max_diff = max_diff.max((new_val - old_val).abs());
    }

    scores = new_scores;

    if max_diff < tolerance {
      converged = true;
      break;
    }
  }

  PageRankResult { scores, iterations, converged }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Community {
  pub id: usize,
  pub members: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityDetectionResult {
  pub communities: Vec<Community>,
  pub modularity: f64,
}

fn edge_weight(graph: &WeightedGraph, a: &str, b: &str) -> f64 {
  graph.adjacency.get(a)
    .and_then(|edges| edges.iter().find(|e| e.target == b))
    .map(|e| e.weight)
    .unwrap_or(0.0)
}

fn total_edge_weight(graph: &WeightedGraph) -> f64 {
  let mut total = 0.0;
  for edges in graph.adjacency.values() {
    for edge in edges {
      total += edge.weight;
    }
  }
  total
}

fn weighted_degree(graph: &WeightedGraph, node: &str) -> f64 {
  graph.adjacency.get(node)
    .map(|edges| edges.iter().map(|e| e.weight).sum())
    .unwrap_or(0.0)
}

fn compute_modularity(
  graph: &WeightedGraph,
  partition: &HashMap<String, usize>,
  m: f64,
) -> f64 {
  if m.abs() < f64::EPSILON { return 0.0; }

  let mut q = 0.0;
  let nodes: Vec<String> = graph.adjacency.keys().cloned().collect();
  for i in 0..nodes.len() {
    for j in 0..nodes.len() {
      if partition[&nodes[i]] != partition[&nodes[j]] { continue; }
      let aij = edge_weight(graph, &nodes[i], &nodes[j]);
      let ki = weighted_degree(graph, &nodes[i]);
      let kj = weighted_degree(graph, &nodes[j]);
      q += aij - (ki * kj) / (2.0 * m);
    }
  }
  q / (2.0 * m)
}

pub fn louvain_communities(graph: &WeightedGraph) -> CommunityDetectionResult {
  let nodes: Vec<String> = graph.adjacency.keys().cloned().collect();
  let n = nodes.len();
  if n == 0 {
    return CommunityDetectionResult { communities: vec![], modularity: 0.0 };
  }

  let m = total_edge_weight(graph);
  let mut partition: HashMap<String, usize> = HashMap::new();
  for (i, node) in nodes.iter().enumerate() {
    partition.insert(node.clone(), i);
  }

  let mut improved = true;
  while improved {
    improved = false;
    for node in &nodes {
      let current_community = partition[node];
      let ki = weighted_degree(graph, node);

      let mut community_ki: HashMap<usize, f64> = HashMap::new();
      if let Some(edges) = graph.adjacency.get(node) {
        for edge in edges {
          let c = partition[&edge.target];
          *community_ki.entry(c).or_default() += edge.weight;
        }
      }

      let ki_in_current = community_ki.get(&current_community).copied().unwrap_or(0.0);

      let mut sigma_tot_current = 0.0_f64;
      let mut sigma_tot_map: HashMap<usize, f64> = HashMap::new();
      for other in &nodes {
        let c = partition[other];
        let kd = weighted_degree(graph, other);
        *sigma_tot_map.entry(c).or_default() += kd;
        if c == current_community {
          sigma_tot_current += kd;
        }
      }
      sigma_tot_current -= ki;

      let mut best_gain = 0.0;
      let mut best_community = current_community;

      let neighbor_communities: HashSet<usize> = graph.adjacency.get(node)
        .map(|edges| edges.iter().map(|e| partition[&e.target]).collect())
        .unwrap_or_default();

      for &c in &neighbor_communities {
        if c == current_community { continue; }
        let ki_in_c = community_ki.get(&c).copied().unwrap_or(0.0);
        let sigma_tot_c = sigma_tot_map.get(&c).copied().unwrap_or(0.0);

        let delta_q = (ki_in_c - ki_in_current)
          + (sigma_tot_current - sigma_tot_c) * ki / m;

        if delta_q > best_gain {
          best_gain = delta_q;
          best_community = c;
        }
      }

      if best_community != current_community {
        partition.insert(node.clone(), best_community);
        improved = true;
      }
    }
  }

  let mut community_map: HashMap<usize, Vec<String>> = HashMap::new();
  for (node, c) in &partition {
    community_map.entry(*c).or_default().push(node.clone());
  }

  let communities: Vec<Community> = community_map
    .into_iter()
    .enumerate()
    .map(|(id, (_, members))| Community { id, members })
    .collect();

  let modularity = compute_modularity(graph, &partition, m);

  CommunityDetectionResult { communities, modularity }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BetweennessResult {
  pub betweenness: HashMap<String, f64>,
}

pub fn betweenness_centrality(graph: &WeightedGraph) -> BetweennessResult {
  let nodes: Vec<String> = graph.adjacency.keys().cloned().collect();
  let mut betweenness: HashMap<String, f64> = HashMap::new();
  for node in &nodes {
    betweenness.insert(node.clone(), 0.0);
  }

  for source in &nodes {
    let mut stack: Vec<String> = Vec::new();
    let mut predecessors: HashMap<String, Vec<String>> = HashMap::new();
    let mut sigma: HashMap<String, f64> = HashMap::new();
    let mut dist: HashMap<String, f64> = HashMap::new();

    for node in &nodes {
      sigma.insert(node.clone(), 0.0);
      dist.insert(node.clone(), f64::INFINITY);
      predecessors.insert(node.clone(), vec![]);
    }
    sigma.insert(source.clone(), 1.0);
    dist.insert(source.clone(), 0.0);

    let mut queue: Vec<String> = vec![source.clone()];

    while !queue.is_empty() {
      let mut min_idx = 0;
      let mut min_dist = f64::INFINITY;
      for (i, node) in queue.iter().enumerate() {
        if dist[node] < min_dist {
          min_dist = dist[node];
          min_idx = i;
        }
      }
      let v = queue.swap_remove(min_idx);
      stack.push(v.clone());

      if let Some(edges) = graph.adjacency.get(&v) {
        for edge in edges {
          let w = &edge.target;
          let alt = dist[&v] + edge.weight;
          if alt < dist[w] {
            dist.insert(w.clone(), alt);
            sigma.insert(w.clone(), 0.0);
            predecessors.insert(w.clone(), vec![]);
            if !queue.contains(w) {
              queue.push(w.clone());
            }
          }
          if (alt - dist[w]).abs() < 1e-10 {
            *sigma.get_mut(w).unwrap() += sigma[&v];
            predecessors.get_mut(w).unwrap().push(v.clone());
          }
        }
      }
    }

    let mut delta: HashMap<String, f64> = HashMap::new();
    for node in &nodes {
      delta.insert(node.clone(), 0.0);
    }

    while let Some(w) = stack.pop() {
      for v in &predecessors[&w] {
        let sv = sigma[v];
        let sw = sigma[&w];
        if sw.abs() > f64::EPSILON {
          *delta.get_mut(v).unwrap() += (sv / sw) * (1.0 + delta[&w]);
        }
      }
      if w != *source {
        *betweenness.get_mut(&w).unwrap() += delta[&w];
      }
    }
  }

  BetweennessResult { betweenness }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn make_star_graph() -> WeightedGraph {
    let mut g = WeightedGraph::new();
    g.add_undirected_edge("center", "a", 1.0, None);
    g.add_undirected_edge("center", "b", 1.0, None);
    g.add_undirected_edge("center", "c", 1.0, None);
    g.add_undirected_edge("center", "d", 1.0, None);
    g
  }

  fn make_triangle_graph() -> WeightedGraph {
    let mut g = WeightedGraph::new();
    g.add_undirected_edge("a", "b", 1.0, None);
    g.add_undirected_edge("b", "c", 1.0, None);
    g.add_undirected_edge("c", "a", 1.0, None);
    g
  }

  fn make_two_cliques() -> WeightedGraph {
    let mut g = WeightedGraph::new();
    g.add_undirected_edge("a1", "a2", 1.0, None);
    g.add_undirected_edge("a2", "a3", 1.0, None);
    g.add_undirected_edge("a3", "a1", 1.0, None);
    g.add_undirected_edge("b1", "b2", 1.0, None);
    g.add_undirected_edge("b2", "b3", 1.0, None);
    g.add_undirected_edge("b3", "b1", 1.0, None);
    g.add_undirected_edge("a1", "b1", 0.1, None);
    g
  }

  #[test]
  fn test_pagerank_converges() {
    let g = make_star_graph();
    let result = pagerank(&g, 0.85, 100, 1e-6);
    assert!(result.converged);
    assert!(result.scores.contains_key("center"));
    assert!(result.scores["center"] > 0.0);
  }

  #[test]
  fn test_pagerank_hub_has_higher_score() {
    let g = make_star_graph();
    let result = pagerank(&g, 0.85, 100, 1e-6);
    assert!(result.scores["center"] > result.scores["a"], "hub should have higher PageRank");
  }

  #[test]
  fn test_pagerank_empty_graph() {
    let g = WeightedGraph::new();
    let result = pagerank(&g, 0.85, 100, 1e-6);
    assert!(result.scores.is_empty());
    assert!(result.converged);
  }

  #[test]
  fn test_pagerank_triangle_equal() {
    let g = make_triangle_graph();
    let result = pagerank(&g, 0.85, 100, 1e-6);
    let score_a = result.scores["a"];
    let score_b = result.scores["b"];
    assert!((score_a - score_b).abs() < 0.01, "symmetric graph should have equal scores");
  }

  #[test]
  fn test_louvain_single_community() {
    let g = make_triangle_graph();
    let result = louvain_communities(&g);
    assert_eq!(result.communities.len(), 1, "fully connected triangle should be one community");
  }

  #[test]
  fn test_louvain_two_communities() {
    let g = make_two_cliques();
    let result = louvain_communities(&g);
    assert!(result.communities.len() >= 2, "two weakly connected cliques should form 2+ communities");
  }

  #[test]
  fn test_louvain_empty_graph() {
    let g = WeightedGraph::new();
    let result = louvain_communities(&g);
    assert!(result.communities.is_empty());
  }

  #[test]
  fn test_betweenness_center_is_highest() {
    let g = make_star_graph();
    let result = betweenness_centrality(&g);
    let center_bc = result.betweenness["center"];
    for (node, &bc) in &result.betweenness {
      if node != "center" {
        assert!(center_bc >= bc, "center should have highest betweenness");
      }
    }
  }

  #[test]
  fn test_betweenness_triangle_equal() {
    let g = make_triangle_graph();
    let result = betweenness_centrality(&g);
    let score_a = result.betweenness["a"];
    let score_b = result.betweenness["b"];
    assert!((score_a - score_b).abs() < 0.01, "symmetric graph should have equal betweenness");
  }
}
