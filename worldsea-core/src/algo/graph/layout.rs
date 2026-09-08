use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::pathfind::WeightedGraph;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutNode {
  pub id: String,
  pub x: f64,
  pub y: f64,
  pub vx: f64,
  pub vy: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutEdge {
  pub source: String,
  pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForceLayoutConfig {
  pub repulsion: f64,
  pub attraction: f64,
  pub ideal_length: f64,
  pub damping: f64,
  pub max_iterations: usize,
  pub epsilon: f64,
  pub area: f64,
  pub gravity: f64,
}

impl Default for ForceLayoutConfig {
  fn default() -> Self {
    Self {
      repulsion: 1000.0,
      attraction: 0.01,
      ideal_length: 100.0,
      damping: 0.9,
      max_iterations: 300,
      epsilon: 1.0,
      area: 10000.0,
      gravity: 0.1,
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForceLayoutResult {
  pub nodes: Vec<LayoutNode>,
  pub iterations: usize,
  pub converged: bool,
  pub total_energy: f64,
}

#[allow(clippy::cast_precision_loss)]
#[allow(clippy::too_many_lines)]
#[must_use] 
pub fn force_directed_layout(
  graph: &WeightedGraph,
  config: &ForceLayoutConfig,
) -> ForceLayoutResult {
  let nodes_set = graph.nodes();
  let n = nodes_set.len();
  if n == 0 {
    return ForceLayoutResult {
      nodes: vec![],
      iterations: 0,
      converged: true,
      total_energy: 0.0,
    };
  }

  let mut nodes: Vec<LayoutNode> = nodes_set
    .iter()
    .enumerate()
    .map(|(i, id)| {
      let angle = 2.0 * std::f64::consts::PI * i as f64 / n as f64;
      LayoutNode {
        id: id.to_string(),
        x: (angle.cos() * config.ideal_length).mul_add(2.0, config.area.sqrt() / 2.0),
        y: (angle.sin() * config.ideal_length).mul_add(2.0, config.area.sqrt() / 2.0),
        vx: 0.0,
        vy: 0.0,
      }
    })
    .collect();

  let mut id_to_idx: HashMap<String, usize> = HashMap::new();
  for (i, node) in nodes.iter().enumerate() {
    id_to_idx.insert(node.id.clone(), i);
  }

  let edges: Vec<LayoutEdge> = graph
    .adjacency
    .iter()
    .flat_map(|(from, edges)| {
      edges
        .iter()
        .map(|e| LayoutEdge {
          source: from.clone(),
          target: e.target.clone(),
        })
        .collect::<Vec<_>>()
    })
    .collect();

  let center_x = config.area.sqrt() / 2.0;
  let center_y = config.area.sqrt() / 2.0;

  let mut iterations = 0;
  let mut converged = false;
  let mut temperature = config.area.sqrt() / 4.0;
  let cooling = temperature / config.max_iterations as f64;

  for iter in 0..config.max_iterations {
    iterations = iter + 1;
    let mut displacements: Vec<(f64, f64)> = vec![(0.0, 0.0); n];

    for i in 0..n {
      for j in 0..n {
        if i == j {
          continue;
        }
        let dx = nodes[i].x - nodes[j].x;
        let dy = nodes[i].y - nodes[j].y;
        let dist_sq = dx.mul_add(dx, dy * dy);
        let dist = dist_sq.sqrt().max(0.1);
        let force = config.repulsion / dist_sq;
        displacements[i].0 += (dx / dist) * force;
        displacements[i].1 += (dy / dist) * force;
      }
    }

    for edge in &edges {
      if let (Some(&i), Some(&j)) = (id_to_idx.get(&edge.source), id_to_idx.get(&edge.target)) {
        let dx = nodes[j].x - nodes[i].x;
        let dy = nodes[j].y - nodes[i].y;
        let dist = dx.hypot(dy).max(0.1);
        let force = config.attraction * (dist - config.ideal_length);
        displacements[i].0 += (dx / dist) * force;
        displacements[i].1 += (dy / dist) * force;
        displacements[j].0 -= (dx / dist) * force;
        displacements[j].1 -= (dy / dist) * force;
      }
    }

    for i in 0..n {
      let dx = center_x - nodes[i].x;
      let dy = center_y - nodes[i].y;
      displacements[i].0 += dx * config.gravity;
      displacements[i].1 += dy * config.gravity;
    }

    let mut total_energy = 0.0;
    for i in 0..n {
      let disp_mag = displacements[i].0.hypot(displacements[i].1)
        .min(temperature);
      nodes[i].x += (displacements[i].0 / disp_mag.max(0.1)) * disp_mag;
      nodes[i].y += (displacements[i].1 / disp_mag.max(0.1)) * disp_mag;
      total_energy += displacements[i].0.mul_add(displacements[i].0, displacements[i].1 * displacements[i].1);
    }

    temperature -= cooling;
    if temperature < 0.0 {
      temperature = 0.0;
    }

    if total_energy < config.epsilon {
      converged = true;
      break;
    }
  }

  let total_energy: f64 = nodes
    .iter()
    .zip(displacements_for_energy(&nodes, &edges, &id_to_idx, config, center_x, center_y))
    .map(|(_n, d)| d.0.mul_add(d.0, d.1 * d.1))
    .sum();

  ForceLayoutResult {
    nodes,
    iterations,
    converged,
    total_energy,
  }
}

// ============================================================================
// Grid Layout — 规则网格排列
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridLayoutConfig {
  /// 列数。0 表示自动 = ceil(sqrt(n))
  pub columns: usize,
  /// 单元格宽度
  pub cell_width: f64,
  /// 单元格高度
  pub cell_height: f64,
  /// 起始 X 偏移
  pub start_x: f64,
  /// 起始 Y 偏移
  pub start_y: f64,
  /// 排序键
  pub sort_by: GridSortKey,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GridSortKey {
  Name,
  Degree,
  Type,
  None,
}

impl Default for GridLayoutConfig {
  fn default() -> Self {
    Self {
      columns: 0,
      cell_width: 180.0,
      cell_height: 100.0,
      start_x: 40.0,
      start_y: 40.0,
      sort_by: GridSortKey::Name,
    }
  }
}

#[must_use]
pub fn grid_layout(
  graph: &WeightedGraph,
  config: &GridLayoutConfig,
) -> Vec<LayoutNode> {
  let nodes_set = graph.nodes();
  let n = nodes_set.len();
  if n == 0 {
    return vec![];
  }

  let mut ids: Vec<String> = nodes_set.iter().map(|s| s.to_string()).collect();

  // 排序
  match config.sort_by {
    GridSortKey::Name => ids.sort(),
    GridSortKey::Degree => {
      let degree: HashMap<&str, usize> = compute_degrees(graph);
      ids.sort_by_cached_key(|id| degree.get(id.as_str()).copied().unwrap_or(0));
    }
    GridSortKey::Type => {
      ids.sort();
    }
    GridSortKey::None => {}
  }

  let cols = if config.columns > 0 {
    config.columns
  } else {
    (n as f64).sqrt().ceil() as usize
  };

  ids
    .into_iter()
    .enumerate()
    .map(|(i, id)| {
      let row = i / cols;
      let col = i % cols;
      LayoutNode {
        id,
        x: config.start_x + col as f64 * config.cell_width + config.cell_width / 2.0,
        y: config.start_y + row as f64 * config.cell_height + config.cell_height / 2.0,
        vx: 0.0,
        vy: 0.0,
      }
    })
    .collect()
}

// ============================================================================
// Radial Layout — 同心圆排列
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadialLayoutConfig {
  /// 布局中心 X
  pub center_x: f64,
  /// 布局中心 Y
  pub center_y: f64,
  /// 圆环间距
  pub radius_step: f64,
  /// 起始角度偏移（弧度）
  pub angle_offset: f64,
  /// 是否按度数排序（高度数在内圈）
  pub sort_by_degree: bool,
  /// 每圈最大节点数（0 = 自动 = ceil(sqrt(n)))
  pub max_per_ring: usize,
}

impl Default for RadialLayoutConfig {
  fn default() -> Self {
    Self {
      center_x: 0.0,  // 调用方需在 prep 阶段填入实际画布中心
      center_y: 0.0,
      radius_step: 120.0,
      angle_offset: -std::f64::consts::FRAC_PI_2,
      sort_by_degree: true,
      max_per_ring: 0,
    }
  }
}

#[must_use]
pub fn radial_layout(
  graph: &WeightedGraph,
  config: &RadialLayoutConfig,
) -> Vec<LayoutNode> {
  let nodes_set = graph.nodes();
  let n = nodes_set.len();
  if n == 0 {
    return vec![];
  }

  let mut ids: Vec<String> = nodes_set.iter().map(|s| s.to_string()).collect();

  if config.sort_by_degree {
    let degree = compute_degrees(graph);
    ids.sort_by_cached_key(|id| std::cmp::Reverse(degree.get(id.as_str()).copied().unwrap_or(0)));
  } else {
    ids.sort();
  }

  let per_ring = if config.max_per_ring > 0 {
    config.max_per_ring
  } else {
    (n as f64).sqrt().ceil() as usize
  };

  ids
    .into_iter()
    .enumerate()
    .map(|(i, id)| {
      let ring = i / per_ring;
      let pos_in_ring = i % per_ring;
      let count_in_ring = if ring == (n - 1) / per_ring {
        n - ring * per_ring
      } else {
        per_ring
      };
      let angle = config.angle_offset
        + 2.0 * std::f64::consts::PI * pos_in_ring as f64 / count_in_ring as f64;
      let radius = config.radius_step * (ring as f64 + 1.0);
      LayoutNode {
        id,
        x: config.center_x + angle.cos() * radius,
        y: config.center_y + angle.sin() * radius,
        vx: 0.0,
        vy: 0.0,
      }
    })
    .collect()
}

// ============================================================================
// Tree Layout — Buchheim 算法 (层级树)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TreeDirection {
  TopToBottom,
  LeftToRight,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeLayoutConfig {
  /// 根节点 ID（必填）
  pub root_id: String,
  /// 方向
  pub direction: TreeDirection,
  /// 节点宽度
  pub node_width: f64,
  /// 节点高度
  pub node_height: f64,
  /// 水平间距
  pub horizontal_gap: f64,
  /// 垂直间距
  pub vertical_gap: f64,
  /// 起始偏移 X
  pub start_x: f64,
  /// 起始偏移 Y
  pub start_y: f64,
}

impl Default for TreeLayoutConfig {
  fn default() -> Self {
    Self {
      root_id: String::new(),
      direction: TreeDirection::TopToBottom,
      node_width: 160.0,
      node_height: 60.0,
      horizontal_gap: 40.0,
      vertical_gap: 80.0,
      start_x: 0.0,
      start_y: 0.0,
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutError {
  pub message: String,
}

impl LayoutError {
  fn new(msg: impl Into<String>) -> Self {
    Self { message: msg.into() }
  }
}

impl std::fmt::Display for LayoutError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "{}", self.message)
  }
}

/// Buchheim 树布局内部节点
#[derive(Clone)]
struct TreeNode {
  id: String,
  /// 子节点在 all_nodes 中的索引
  children: Vec<usize>,
  x: f64,
  y: f64,
  /// 子树宽度（叶子数）
  width: usize,
  /// 下个兄弟的修正链（轮廓线程）
  thread: Option<usize>,
}

#[allow(clippy::too_many_lines)]
#[must_use]
pub fn tree_layout(
  graph: &WeightedGraph,
  config: &TreeLayoutConfig,
) -> Result<Vec<LayoutNode>, LayoutError> {
  // 根节点验证优先于空图检查：指定了 root 但图中不存在即为错误
  if !graph.nodes().contains(config.root_id.as_str()) {
    return Err(LayoutError::new(format!(
      "Tree root '{}' not found in graph",
      config.root_id
    )));
  }

  let n = graph.nodes().len();
  if n == 0 {
    return Ok(vec![]);
  }

  // BFS 构建树（忽略回边）
  let mut visited: HashMap<String, usize> = HashMap::new();
  let mut all_nodes: Vec<TreeNode> = Vec::new();

  // index 0 = root
  let root = TreeNode {
    id: config.root_id.clone(),
    children: vec![],
    x: 0.0, y: 0.0, width: 0, thread: None,
  };
  all_nodes.push(root);
  visited.insert(config.root_id.clone(), 0);

  let mut queue: Vec<usize> = vec![0]; // BFS queue of indices

  while let Some(parent_idx) = queue.pop() {
    let pid = all_nodes[parent_idx].id.clone();
    if let Some(neighbors) = graph.adjacency.get(&pid) {
      for edge in neighbors {
        let cid = &edge.target;
        if visited.contains_key(cid) {
          continue;
        }
        let child_idx = all_nodes.len();
        visited.insert(cid.clone(), child_idx);
        all_nodes.push(TreeNode {
          id: cid.clone(),
          children: vec![],
          x: 0.0, y: 0.0, width: 0, thread: None,
        });
        all_nodes[parent_idx].children.push(child_idx);
        queue.push(child_idx);
      }
    }
  }

  // Buchheim layout
  first_walk(&mut all_nodes, 0);
  second_walk(&mut all_nodes, 0, 0.0);
  assign_depths(&mut all_nodes, 0, 0);

  // 将树坐标映射为布局节点
  let cell_w = config.node_width + config.horizontal_gap;
  let cell_h = config.node_height + config.vertical_gap;

  let mut result: Vec<LayoutNode> = Vec::with_capacity(all_nodes.len());
  for node in &all_nodes {
    let (lx, ly) = match config.direction {
      TreeDirection::TopToBottom => (
        config.start_x + node.x * cell_w + config.node_width / 2.0,
        config.start_y + node.y * cell_h + config.node_height / 2.0,
      ),
      TreeDirection::LeftToRight => (
        config.start_x + node.y * cell_h + config.node_height / 2.0,
        config.start_y + node.x * cell_w + config.node_width / 2.0,
      ),
    };
    result.push(LayoutNode {
      id: node.id.clone(),
      x: lx,
      y: ly,
      vx: 0.0,
      vy: 0.0,
    });
  }
  Ok(result)
}

/// 后序遍历：计算 leaf count 并分配初始 X
fn first_walk(nodes: &mut [TreeNode], idx: usize) {
  if nodes[idx].children.is_empty() {
    nodes[idx].width = 1;
    return;
  }

  let child_indices: Vec<usize> = nodes[idx].children.clone();
  let child_count = child_indices.len();

  for &c in &child_indices {
    first_walk(nodes, c);
  }

  nodes[idx].width = child_indices.iter().map(|&c| nodes[c].width).sum();

  if child_count == 1 {
    let c = child_indices[0];
    nodes[idx].x = nodes[c].x;
  } else {
    let left = child_indices[0];
    let right = child_indices[child_count - 1];
    nodes[idx].x = (nodes[left].x + nodes[right].x) / 2.0;
  }

  // apportion: 解决邻近子树重叠
  for i in 1..child_count {
    apportion(nodes, child_indices[i - 1], child_indices[i]);
  }
}

/// 子树间移位避免重叠（Buchheim apportion 简化版）
#[allow(unused_assignments)]
fn apportion(nodes: &mut [TreeNode], left_idx: usize, right_idx: usize) {
  let mut li = left_idx;
  let mut ri = right_idx;
  let mut lo = nodes[left_idx].x;
  let mut _ro = nodes[right_idx].x;
  let gap = 1.0;

  loop {
    let overlap = lo + gap - _ro;
    if overlap > 0.0 {
      shift_subtree(nodes, right_idx, overlap);
      _ro += overlap;
    }

    // descend to next contour level
    if !nodes[li].children.is_empty() && !nodes[ri].children.is_empty() {
      li = *nodes[li].children.last().unwrap();
      ri = nodes[ri].children[0];
      lo = nodes[li].x;
      _ro = nodes[ri].x;
    } else if !nodes[li].children.is_empty() {
      li = *nodes[li].children.last().unwrap();
      lo = nodes[li].x;
      if let Some(t) = nodes[ri].thread {
        ri = t;
        _ro = nodes[ri].x;
      } else {
        break;
      }
    } else if !nodes[ri].children.is_empty() {
      ri = nodes[ri].children[0];
      _ro = nodes[ri].x;
      break;
    } else {
      break;
    }
  }
}

/// 右移整个子树
fn shift_subtree(nodes: &mut [TreeNode], root_idx: usize, amount: f64) {
  nodes[root_idx].x += amount;
  let children: Vec<usize> = nodes[root_idx].children.clone();
  for c in children {
    shift_subtree(nodes, c, amount);
  }
}

/// 前序遍历：分配深度 (Y) 并传播累积偏移
fn second_walk(nodes: &mut [TreeNode], idx: usize, x_offset: f64) {
  nodes[idx].x += x_offset;
  nodes[idx].y = 0.0; // placeholder — will be set based on depth

  let children: Vec<usize> = nodes[idx].children.clone();
  if children.is_empty() {
    return;
  }

  let first_x = nodes[children[0]].x;
  for &c in &children {
    second_walk(nodes, c, nodes[idx].x - first_x);
  }
}

/// 自上而下设置 Y（深度）
fn assign_depths(nodes: &mut [TreeNode], idx: usize, depth: usize) {
  nodes[idx].y = depth as f64;
  let children: Vec<usize> = nodes[idx].children.clone();
  for c in children {
    assign_depths(nodes, c, depth + 1);
  }
}

// ============================================================================
// Mindmap Tree Layout — 中心辐射式层级树
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapTreeConfig {
  /// 中心节点 ID
  pub center_id: String,
  /// 中心 X（画布中心）
  pub center_x: f64,
  /// 中心 Y（画布中心）
  pub center_y: f64,
  /// 每层半径步长
  pub radius_step: f64,
  /// 最小角度扇区（弧度，防子节点扇区过窄重叠）
  pub min_sector_angle: f64,
  /// 起始角度偏移（弧度，默认 -π/2 即上方开始）
  pub angle_offset: f64,
  /// 最大深度限制
  pub max_depth: usize,
}

impl Default for MindmapTreeConfig {
  fn default() -> Self {
    Self {
      center_id: String::new(),
      center_x: 400.0,
      center_y: 300.0,
      radius_step: 140.0,
      min_sector_angle: 0.15, // ~8.6°
      angle_offset: -std::f64::consts::FRAC_PI_2,
      max_depth: 10,
    }
  }
}

/// 内部树结构（mindmap_tree_layout 使用）
#[derive(Clone)]
struct MindmapTreeNode {
  id: String,
  depth: usize,
  children: Vec<usize>,
  subtree_size: usize,
  start_angle: f64,
  end_angle: f64,
}

/// 中心辐射式层级树：从 center_id BFS，每层一圈，
/// 子节点按子树大小分配角度扇区
#[must_use]
pub fn mindmap_tree_layout(
  graph: &WeightedGraph,
  config: &MindmapTreeConfig,
) -> Vec<LayoutNode> {
  let nodes_set = graph.nodes();
  if nodes_set.is_empty() {
    return vec![];
  }

  // BFS 构建层级树
  let mut all_tree: Vec<MindmapTreeNode> = Vec::new();
  let mut id_to_idx: HashMap<String, usize> = HashMap::new();

  // root
  all_tree.push(MindmapTreeNode {
    id: config.center_id.clone(),
    depth: 0,
    children: vec![],
    subtree_size: 0,
    start_angle: 0.0,
    end_angle: std::f64::consts::TAU,
  });
  id_to_idx.insert(config.center_id.clone(), 0);

  // BFS
  let mut queue: Vec<usize> = vec![0];
  while let Some(pi) = queue.pop() {
    let pid = all_tree[pi].id.clone();
    let depth = all_tree[pi].depth;
    if depth >= config.max_depth {
      continue;
    }
    let mut new_children: Vec<usize> = Vec::new();
    if let Some(neighbors) = graph.adjacency.get(pid.as_str()) {
      for edge in neighbors {
        let cid = &edge.target;
        if cid == &pid || id_to_idx.contains_key(cid.as_str()) {
          continue;
        }
        let ci = all_tree.len();
        id_to_idx.insert(cid.clone(), ci);
        all_tree.push(MindmapTreeNode {
          id: cid.clone(),
          depth: depth + 1,
          children: vec![],
          subtree_size: 0,
          start_angle: 0.0,
          end_angle: 0.0,
        });
        new_children.push(ci);
        queue.push(ci);
      }
    }
    all_tree[pi].children = new_children;
  }

  // 后序遍历计算 subtree_size
  for i in (0..all_tree.len()).rev() {
    let children: Vec<usize> = all_tree[i].children.clone();
    let mut sz = 1usize;
    for &c in &children {
      sz += all_tree[c].subtree_size;
    }
    all_tree[i].subtree_size = sz;
  }

  // 分配角度扇区
  if !all_tree.is_empty() {
    assign_mindmap_sectors(&mut all_tree, 0, 0.0, std::f64::consts::TAU, 0.15);
  }

  // 映射为 LayoutNode
  all_tree
    .into_iter()
    .map(|ti| {
      let mid_angle = (ti.start_angle + ti.end_angle) / 2.0 + config.angle_offset;
      let radius = if ti.depth == 0 {
        0.0
      } else {
        config.radius_step * ti.depth as f64
      };
      LayoutNode {
        id: ti.id,
        x: config.center_x + mid_angle.cos() * radius,
        y: config.center_y + mid_angle.sin() * radius,
        vx: 0.0,
        vy: 0.0,
      }
    })
    .collect()
}

/// 递归分配角度扇区
fn assign_mindmap_sectors(
  tree: &mut [MindmapTreeNode],
  idx: usize,
  start: f64,
  end: f64,
  min_sector: f64,
) {
  tree[idx].start_angle = start;
  tree[idx].end_angle = end;

  let children: Vec<usize> = tree[idx].children.clone();
  if children.is_empty() {
    return;
  }

  let self_size = tree[idx].subtree_size.max(1) as f64;
  let range = (end - start).max(0.0);

  let mut cursor = start;
  let child_count = children.len();

  for (ci, &c) in children.iter().enumerate() {
    let child_share = if child_count == 1 {
      range
    } else {
      let prop = tree[c].subtree_size as f64 / self_size;
      (range * prop).max(min_sector)
    };

    let child_start = cursor;
    let child_end = if ci == child_count - 1 {
      end
    } else {
      (cursor + child_share).min(end)
    };

    assign_mindmap_sectors(tree, c, child_start, child_end, min_sector);
    cursor = child_end;
  }
}

// ============================================================================
// Unified Layout API
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LayoutAlgorithm {
  Force(ForceLayoutConfig),
  Radial(RadialLayoutConfig),
  Tree(TreeLayoutConfig),
  Grid(GridLayoutConfig),
  MindmapTree(MindmapTreeConfig),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutResult {
  pub nodes: Vec<LayoutNode>,
  /// 仅 force 布局有效
  #[serde(skip_serializing_if = "Option::is_none")]
  pub iterations: Option<usize>,
  /// 仅 force 布局有效
  #[serde(skip_serializing_if = "Option::is_none")]
  pub converged: Option<bool>,
  /// 仅 force 布局有效
  #[serde(skip_serializing_if = "Option::is_none")]
  pub total_energy: Option<f64>,
}

#[must_use]
pub fn compute_layout(
  graph: &WeightedGraph,
  algorithm: &LayoutAlgorithm,
) -> Result<LayoutResult, LayoutError> {
  match algorithm {
    LayoutAlgorithm::Force(config) => {
      let r = force_directed_layout(graph, config);
      Ok(LayoutResult {
        nodes: r.nodes,
        iterations: Some(r.iterations),
        converged: Some(r.converged),
        total_energy: Some(r.total_energy),
      })
    }
    LayoutAlgorithm::Radial(config) => {
      let nodes = radial_layout(graph, config);
      Ok(LayoutResult {
        nodes,
        iterations: None,
        converged: None,
        total_energy: None,
      })
    }
    LayoutAlgorithm::Tree(config) => {
      let nodes = tree_layout(graph, config)?;
      Ok(LayoutResult {
        nodes,
        iterations: None,
        converged: None,
        total_energy: None,
      })
    }
    LayoutAlgorithm::Grid(config) => {
      let nodes = grid_layout(graph, config);
      Ok(LayoutResult {
        nodes,
        iterations: None,
        converged: None,
        total_energy: None,
      })
    }
    LayoutAlgorithm::MindmapTree(config) => {
      let nodes = mindmap_tree_layout(graph, config);
      Ok(LayoutResult {
        nodes,
        iterations: None,
        converged: None,
        total_energy: None,
      })
    }
  }
}

/// 辅助：按 degree 排序时需要的度数字典
fn compute_degrees(graph: &WeightedGraph) -> HashMap<&str, usize> {
  let mut degree: HashMap<&str, usize> = HashMap::new();
  for (from, edges) in &graph.adjacency {
    degree.entry(from).or_insert(0);
    for e in edges {
      *degree.entry(from).or_insert(0) += 1;
      degree.entry(&e.target).or_insert(0);
    }
  }
  degree
}

fn displacements_for_energy(
  nodes: &[LayoutNode],
  edges: &[LayoutEdge],
  id_to_idx: &HashMap<String, usize>,
  config: &ForceLayoutConfig,
  center_x: f64,
  center_y: f64,
) -> Vec<(f64, f64)> {
  let n = nodes.len();
  let mut disps: Vec<(f64, f64)> = vec![(0.0, 0.0); n];

  for i in 0..n {
    for j in 0..n {
      if i == j {
        continue;
      }
      let dx = nodes[i].x - nodes[j].x;
      let dy = nodes[i].y - nodes[j].y;
      let dist_sq = dx.mul_add(dx, dy * dy);
      let dist = dist_sq.sqrt().max(0.1);
      let force = config.repulsion / dist_sq;
      disps[i].0 += (dx / dist) * force;
      disps[i].1 += (dy / dist) * force;
    }
  }

  for edge in edges {
    if let (Some(&i), Some(&j)) = (id_to_idx.get(&edge.source), id_to_idx.get(&edge.target)) {
      let dx = nodes[j].x - nodes[i].x;
      let dy = nodes[j].y - nodes[i].y;
      let dist = dx.hypot(dy).max(0.1);
      let force = config.attraction * (dist - config.ideal_length);
      disps[i].0 += (dx / dist) * force;
      disps[i].1 += (dy / dist) * force;
    }
  }

  for i in 0..n {
    let dx = center_x - nodes[i].x;
    let dy = center_y - nodes[i].y;
    disps[i].0 += dx * config.gravity;
    disps[i].1 += dy * config.gravity;
  }

  disps
}

#[cfg(test)]
mod tests {
  use super::*;

  // ── Force Layout ──

  #[test]
  fn test_force_layout_simple() {
    let mut g = WeightedGraph::new();
    g.add_undirected_edge("A", "B", 1.0, None);
    g.add_undirected_edge("B", "C", 1.0, None);
    g.add_undirected_edge("C", "A", 1.0, None);

    let config = ForceLayoutConfig {
      max_iterations: 50,
      ..Default::default()
    };
    let result = force_directed_layout(&g, &config);
    assert_eq!(result.nodes.len(), 3);
    assert!(result.iterations > 0);
  }

  #[test]
  fn test_force_layout_empty() {
    let g = WeightedGraph::new();
    let result = force_directed_layout(&g, &ForceLayoutConfig::default());
    assert!(result.nodes.is_empty());
    assert!(result.converged);
  }

  #[test]
  fn test_force_layout_single_node() {
    let mut g = WeightedGraph::new();
    g.add_edge("A", "A", 0.0, None);
    let result = force_directed_layout(&g, &ForceLayoutConfig::default());
    assert_eq!(result.nodes.len(), 1);
  }

  #[test]
  fn test_force_layout_convergence() {
    let mut g = WeightedGraph::new();
    for i in 0..5 {
      for j in (i + 1)..5 {
        g.add_undirected_edge(&format!("N{i}"), &format!("N{j}"), 1.0, None);
      }
    }
    let config = ForceLayoutConfig {
      max_iterations: 500,
      epsilon: 0.01,
      ..Default::default()
    };
    let result = force_directed_layout(&g, &config);
    assert!(result.iterations > 0);
  }

  // ── Grid Layout ──

  #[test]
  fn test_grid_layout_empty() {
    let g = WeightedGraph::new();
    let result = grid_layout(&g, &GridLayoutConfig::default());
    assert!(result.is_empty());
  }

  #[test]
  fn test_grid_layout_4_nodes() {
    let mut g = WeightedGraph::new();
    for id in &["D", "A", "C", "B"] {
      g.add_edge(id, id, 0.0, None);
    }
    let result = grid_layout(&g, &GridLayoutConfig::default());
    assert_eq!(result.len(), 4);
    // 按 Name 排序: A, B, C, D — 2列网格
    let ids: Vec<&str> = result.iter().map(|n| n.id.as_str()).collect();
    assert_eq!(ids, vec!["A", "B", "C", "D"]);
    // A 在第一列，B 在第二列
    assert!(result[0].x < result[1].x);
    // A 和 C 同一列，y 不同
    assert!((result[0].x - result[2].x).abs() < 1.0);
    assert!(result[0].y < result[2].y);
  }

  #[test]
  fn test_grid_layout_custom_columns() {
    let mut g = WeightedGraph::new();
    for id in &["A", "B", "C"] {
      g.add_edge(id, id, 0.0, None);
    }
    let config = GridLayoutConfig {
      columns: 1,
      ..Default::default()
    };
    let result = grid_layout(&g, &config);
    assert_eq!(result.len(), 3);
    // 单列：X 相同
    assert!((result[0].x - result[1].x).abs() < 1.0);
    assert!((result[1].x - result[2].x).abs() < 1.0);
    // Y 递增
    assert!(result[0].y < result[1].y);
    assert!(result[1].y < result[2].y);
  }

  // ── Radial Layout ──

  #[test]
  fn test_radial_layout_empty() {
    let g = WeightedGraph::new();
    let result = radial_layout(&g, &RadialLayoutConfig::default());
    assert!(result.is_empty());
  }

  #[test]
  fn test_radial_layout_single_ring() {
    let mut g = WeightedGraph::new();
    for id in &["A", "B", "C", "D"] {
      g.add_edge(id, id, 0.0, None);
    }
    let config = RadialLayoutConfig {
      center_x: 500.0,
      center_y: 400.0,
      radius_step: 120.0,
      sort_by_degree: false,
      max_per_ring: 10,
      ..Default::default()
    };
    let result = radial_layout(&g, &config);
    assert_eq!(result.len(), 4);
    // 所有节点距中心 ~120
    for n in &result {
      let dist = ((n.x - 500.0).powi(2) + (n.y - 400.0).powi(2)).sqrt();
      assert!((dist - 120.0).abs() < 1.0, "expected ~120, got {dist}");
    }
  }

  // ── Tree Layout ──

  #[test]
  fn test_tree_layout_simple_chain() {
    let mut g = WeightedGraph::new();
    g.add_edge("A", "B", 1.0, None);
    g.add_edge("B", "C", 1.0, None);
    g.add_edge("C", "D", 1.0, None);

    let config = TreeLayoutConfig {
      root_id: "A".to_string(),
      direction: TreeDirection::TopToBottom,
      ..Default::default()
    };
    let result = tree_layout(&g, &config).unwrap();
    assert_eq!(result.len(), 4);

    let ids: Vec<&str> = result.iter().map(|n| n.id.as_str()).collect();
    assert!(ids.contains(&"A"));
    assert!(ids.contains(&"D"));

    // 垂直方向：根在最上，叶在最下
    let a = result.iter().find(|n| n.id == "A").unwrap();
    let d = result.iter().find(|n| n.id == "D").unwrap();
    assert!(a.y < d.y, "root should be above leaf");
  }

  #[test]
  fn test_tree_layout_empty() {
    let g = WeightedGraph::new();
    let config = TreeLayoutConfig {
      root_id: "X".to_string(),
      ..Default::default()
    };
    let result = tree_layout(&g, &config);
    assert!(result.is_err());
  }

  #[test]
  fn test_tree_layout_left_to_right() {
    let mut g = WeightedGraph::new();
    g.add_edge("R", "C1", 1.0, None);
    g.add_edge("R", "C2", 1.0, None);

    let config = TreeLayoutConfig {
      root_id: "R".to_string(),
      direction: TreeDirection::LeftToRight,
      ..Default::default()
    };
    let result = tree_layout(&g, &config).unwrap();
    assert_eq!(result.len(), 3);

    let root = result.iter().find(|n| n.id == "R").unwrap();
    let c1 = result.iter().find(|n| n.id == "C1").unwrap();
    assert!(root.x < c1.x, "root should be left of child in LTR mode");
  }

  // ── Unified compute_layout ──

  #[test]
  fn test_compute_layout_force() {
    let mut g = WeightedGraph::new();
    g.add_undirected_edge("A", "B", 1.0, None);

    let result = compute_layout(
      &g,
      &LayoutAlgorithm::Force(ForceLayoutConfig {
        max_iterations: 50,
        ..Default::default()
      }),
    )
    .unwrap();
    assert_eq!(result.nodes.len(), 2);
    assert!(result.iterations.is_some());
    assert!(result.converged.is_some());
  }

  #[test]
  fn test_compute_layout_grid() {
    let mut g = WeightedGraph::new();
    g.add_edge("A", "A", 0.0, None);
    g.add_edge("B", "B", 0.0, None);

    let result = compute_layout(&g, &LayoutAlgorithm::Grid(GridLayoutConfig::default())).unwrap();
    assert_eq!(result.nodes.len(), 2);
    assert!(result.iterations.is_none());
  }

  #[test]
  fn test_compute_layout_radial() {
    let mut g = WeightedGraph::new();
    for id in &["X", "Y", "Z"] {
      g.add_edge(id, id, 0.0, None);
    }
    let result = compute_layout(&g, &LayoutAlgorithm::Radial(RadialLayoutConfig::default())).unwrap();
    assert_eq!(result.nodes.len(), 3);
  }

  #[test]
  fn test_compute_layout_tree() {
    let mut g = WeightedGraph::new();
    g.add_edge("R", "A", 1.0, None);
    g.add_edge("R", "B", 1.0, None);

    let result = compute_layout(
      &g,
      &LayoutAlgorithm::Tree(TreeLayoutConfig {
        root_id: "R".to_string(),
        ..Default::default()
      }),
    )
    .unwrap();
    assert_eq!(result.nodes.len(), 3);
  }

  #[test]
  fn test_compute_layout_tree_missing_root() {
    let g = WeightedGraph::new();
    let result = compute_layout(
      &g,
      &LayoutAlgorithm::Tree(TreeLayoutConfig {
        root_id: "nonexistent".to_string(),
        ..Default::default()
      }),
    );
    assert!(result.is_err());
  }

  #[test]
  fn test_mindmap_tree_simple() {
    let mut g = WeightedGraph::new();
    g.add_edge("center", "A", 1.0, None);
    g.add_edge("center", "B", 1.0, None);
    g.add_edge("A", "A1", 1.0, None);
    g.add_edge("A", "A2", 1.0, None);

    let config = MindmapTreeConfig {
      center_id: "center".to_string(),
      center_x: 400.0,
      center_y: 300.0,
      ..Default::default()
    };
    let result = mindmap_tree_layout(&g, &config);
    assert_eq!(result.len(), 5);
    // 中心在 (400, 300)
    let center = result.iter().find(|n| n.id == "center").unwrap();
    assert!((center.x - 400.0).abs() < 1.0);
    assert!((center.y - 300.0).abs() < 1.0);
    // A 和 B 应在不同角度
    let a = result.iter().find(|n| n.id == "A").unwrap();
    let b = result.iter().find(|n| n.id == "B").unwrap();
    assert!(a.x != b.x || a.y != b.y, "children should be at different angles");
  }

  #[test]
  fn test_mindmap_tree_empty_center() {
    let g = WeightedGraph::new();
    let config = MindmapTreeConfig {
      center_id: "nonexistent".to_string(),
      ..Default::default()
    };
    let result = mindmap_tree_layout(&g, &config);
    assert_eq!(result.len(), 0);
  }

  #[test]
  fn test_compute_layout_mindmap_tree() {
    let mut g = WeightedGraph::new();
    g.add_edge("root", "child1", 1.0, None);
    g.add_edge("root", "child2", 1.0, None);
    let result = compute_layout(
      &g,
      &LayoutAlgorithm::MindmapTree(MindmapTreeConfig {
        center_id: "root".to_string(),
        ..Default::default()
      }),
    ).unwrap();
    assert_eq!(result.nodes.len(), 3);
  }

  #[test]
  fn test_grid_layout_no_sort() {
    let mut g = WeightedGraph::new();
    g.add_edge("C", "C", 0.0, None);
    g.add_edge("A", "A", 0.0, None);
    g.add_edge("B", "B", 0.0, None);

    let config = GridLayoutConfig {
      sort_by: GridSortKey::None,
      columns: 3,
      ..Default::default()
    };
    let result = grid_layout(&g, &config);
    assert_eq!(result.len(), 3);
  }

  #[test]
  fn test_tree_layout_multiple_children() {
    let mut g = WeightedGraph::new();
    g.add_edge("R", "A", 1.0, None);
    g.add_edge("R", "B", 1.0, None);
    g.add_edge("R", "C", 1.0, None);
    g.add_edge("A", "A1", 1.0, None);
    g.add_edge("A", "A2", 1.0, None);

    let config = TreeLayoutConfig {
      root_id: "R".to_string(),
      ..Default::default()
    };
    let result = tree_layout(&g, &config).unwrap();
    assert_eq!(result.len(), 6);

    // A1 和 A2 不应重叠
    let a1 = result.iter().find(|n| n.id == "A1").unwrap();
    let a2 = result.iter().find(|n| n.id == "A2").unwrap();
    assert!((a1.x - a2.x).abs() > 1.0, "siblings should not overlap");
  }
}
