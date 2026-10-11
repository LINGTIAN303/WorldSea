use std::collections::{HashMap, HashSet, VecDeque};

use serde::{Deserialize, Serialize};

use super::pathfind::WeightedGraph;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopologicalSortResult {
  pub order: Vec<String>,
  pub has_cycle: bool,
  pub cycle_nodes: Vec<String>,
}

#[allow(clippy::missing_panics_doc)]
#[must_use] 
pub fn topological_sort(graph: &WeightedGraph) -> TopologicalSortResult {
  let nodes = graph.nodes();
  let mut in_degree: HashMap<&str, usize> = HashMap::new();
  for node in &nodes {
    in_degree.insert(node, 0);
  }
  for edges in graph.adjacency.values() {
    for edge in edges {
      *in_degree.entry(&edge.target).or_insert(0) += 1;
    }
  }

  let mut queue: VecDeque<&str> = VecDeque::new();
  for (&node, &deg) in &in_degree {
    if deg == 0 {
      queue.push_back(node);
    }
  }

  let mut order = Vec::new();
  while let Some(node) = queue.pop_front() {
    order.push(node.to_string());
    if let Some(edges) = graph.adjacency.get(node) {
      for edge in edges {
        let deg = in_degree.get_mut(edge.target.as_str()).unwrap();
        *deg -= 1;
        if *deg == 0 {
          queue.push_back(edge.target.as_str());
        }
      }
    }
  }

  let has_cycle = order.len() < nodes.len();
  let cycle_nodes = if has_cycle {
    let ordered_set: HashSet<&str> = order.iter().map(std::string::String::as_str).collect();
    nodes
      .iter()
      .filter(|n| !ordered_set.contains(*n))
      .map(std::string::ToString::to_string)
      .collect()
  } else {
    vec![]
  };

  TopologicalSortResult {
    order,
    has_cycle,
    cycle_nodes,
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedComponentsResult {
  pub components: Vec<Vec<String>>,
  pub count: usize,
  pub largest_size: usize,
}

#[must_use] 
pub fn connected_components(graph: &WeightedGraph) -> ConnectedComponentsResult {
  let nodes = graph.nodes();
  let mut visited: HashSet<String> = HashSet::new();
  let mut components = Vec::new();

  for start in &nodes {
    let start_str = start.to_string();
    if visited.contains(&start_str) {
      continue;
    }

    let mut component = Vec::new();
    let mut queue = VecDeque::new();
    queue.push_back(start_str.clone());
    visited.insert(start_str.clone());

    while let Some(node) = queue.pop_front() {
      component.push(node.clone());
      if let Some(edges) = graph.adjacency.get(&node) {
        for edge in edges {
          if !visited.contains(&edge.target) {
            visited.insert(edge.target.clone());
            queue.push_back(edge.target.clone());
          }
        }
      }
      for (from, edges) in &graph.adjacency {
        if !visited.contains(from) && edges.iter().any(|e| e.target == node) {
          visited.insert(from.clone());
          queue.push_back(from.clone());
        }
      }
    }

    components.push(component);
  }

  let count = components.len();
  let largest_size = components.iter().map(std::vec::Vec::len).max().unwrap_or(0);

  ConnectedComponentsResult {
    components,
    count,
    largest_size,
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StronglyConnectedResult {
  pub components: Vec<Vec<String>>,
  pub count: usize,
  pub has_cycles: bool,
}

#[must_use] 
pub fn tarjan_scc(graph: &WeightedGraph) -> StronglyConnectedResult {
  let nodes: Vec<String> = graph.nodes().into_iter().map(std::string::ToString::to_string).collect();
  let mut index_counter: usize = 0;
  let mut stack: Vec<String> = Vec::new();
  let mut on_stack: HashSet<String> = HashSet::new();
  let mut indices: HashMap<String, usize> = HashMap::new();
  let mut lowlinks: HashMap<String, usize> = HashMap::new();
  let mut components: Vec<Vec<String>> = Vec::new();

  for node in &nodes {
    if !indices.contains_key(node) {
      strongconnect(
        node,
        graph,
        &mut index_counter,
        &mut stack,
        &mut on_stack,
        &mut indices,
        &mut lowlinks,
        &mut components,
      );
    }
  }

  let count = components.len();
  let has_cycles = components.iter().any(|c| c.len() > 1);

  StronglyConnectedResult {
    components,
    count,
    has_cycles,
  }
}

#[allow(clippy::too_many_arguments)]
fn strongconnect(
  v: &str,
  graph: &WeightedGraph,
  index_counter: &mut usize,
  stack: &mut Vec<String>,
  on_stack: &mut HashSet<String>,
  indices: &mut HashMap<String, usize>,
  lowlinks: &mut HashMap<String, usize>,
  components: &mut Vec<Vec<String>>,
) {
  indices.insert(v.to_string(), *index_counter);
  lowlinks.insert(v.to_string(), *index_counter);
  *index_counter += 1;
  stack.push(v.to_string());
  on_stack.insert(v.to_string());

  if let Some(edges) = graph.adjacency.get(v) {
    for edge in edges {
      if !indices.contains_key(&edge.target) {
        strongconnect(
          &edge.target,
          graph,
          index_counter,
          stack,
          on_stack,
          indices,
          lowlinks,
          components,
        );
        let w_low = lowlinks[&edge.target];
        let v_low = lowlinks.get_mut(v).unwrap();
        *v_low = (*v_low).min(w_low);
      } else if on_stack.contains(&edge.target) {
        let w_idx = indices[&edge.target];
        let v_low = lowlinks.get_mut(v).unwrap();
        *v_low = (*v_low).min(w_idx);
      }
    }
  }

  if lowlinks[v] == indices[v] {
    let mut component = Vec::new();
    loop {
      let w = stack.pop().unwrap();
      on_stack.remove(&w);
      component.push(w.clone());
      if w == v {
        break;
      }
    }
    components.push(component);
  }
}

#[must_use] 
pub fn find_dangling_references(graph: &WeightedGraph) -> Vec<String> {
  let nodes_with_outgoing: HashSet<&str> = graph.adjacency.keys().map(std::string::String::as_str).collect();
  let all_nodes = graph.nodes();
  let mut dangling = Vec::new();

  for node in &all_nodes {
    if !nodes_with_outgoing.contains(node) && !graph.adjacency.contains_key(*node) {
      dangling.push(node.to_string());
    }
  }

  dangling
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_topological_sort_dag() {
    let mut g = WeightedGraph::new();
    g.add_edge("A", "B", 1.0, None);
    g.add_edge("A", "C", 1.0, None);
    g.add_edge("B", "D", 1.0, None);
    g.add_edge("C", "D", 1.0, None);

    let result = topological_sort(&g);
    assert!(!result.has_cycle);
    assert_eq!(result.order.len(), 4);
    let a_pos = result.order.iter().position(|n| n == "A").unwrap();
    let b_pos = result.order.iter().position(|n| n == "B").unwrap();
    let d_pos = result.order.iter().position(|n| n == "D").unwrap();
    assert!(a_pos < b_pos);
    assert!(b_pos < d_pos);
  }

  #[test]
  fn test_topological_sort_cycle() {
    let mut g = WeightedGraph::new();
    g.add_edge("A", "B", 1.0, None);
    g.add_edge("B", "C", 1.0, None);
    g.add_edge("C", "A", 1.0, None);

    let result = topological_sort(&g);
    assert!(result.has_cycle);
    assert!(!result.cycle_nodes.is_empty());
  }

  #[test]
  fn test_connected_components() {
    let mut g = WeightedGraph::new();
    g.add_undirected_edge("A", "B", 1.0, None);
    g.add_undirected_edge("B", "C", 1.0, None);
    g.add_undirected_edge("D", "E", 1.0, None);

    let result = connected_components(&g);
    assert_eq!(result.count, 2);
    assert_eq!(result.largest_size, 3);
  }

  #[test]
  fn test_tarjan_scc_no_cycles() {
    let mut g = WeightedGraph::new();
    g.add_edge("A", "B", 1.0, None);
    g.add_edge("B", "C", 1.0, None);

    let result = tarjan_scc(&g);
    assert!(!result.has_cycles);
    assert_eq!(result.count, 3);
  }

  #[test]
  fn test_tarjan_scc_with_cycle() {
    let mut g = WeightedGraph::new();
    g.add_edge("A", "B", 1.0, None);
    g.add_edge("B", "C", 1.0, None);
    g.add_edge("C", "A", 1.0, None);
    g.add_edge("C", "D", 1.0, None);

    let result = tarjan_scc(&g);
    assert!(result.has_cycles);
    let scc_sizes: Vec<usize> = result.components.iter().map(|c| c.len()).collect();
    assert!(scc_sizes.contains(&3));
  }

  #[test]
  fn test_dangling_references() {
    let mut g = WeightedGraph::new();
    g.add_edge("A", "B", 1.0, None);
    g.add_edge("A", "C", 1.0, None);

    let dangling = find_dangling_references(&g);
    assert_eq!(dangling.len(), 2);
  }
}
