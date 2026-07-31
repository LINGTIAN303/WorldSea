//! 算法（Algorithm）相关命令
//!
//! 拆分自 lib.rs（P0-2 批次4）。
//! 涵盖几何、图论、布局、CRDT、地形、约束求解、DXF、多边形布尔等纯算法命令。
//! 所有命令无状态（不依赖 `State<AppState>`），仅做参数反序列化 → 调用 core → 序列化返回。

use worldsmith_core::error::CoreError;

// 几何
use worldsmith_core::algo::geometry::line::{Point2D, Segment2D, find_all_intersections};
use worldsmith_core::algo::geometry::polygon::{
    Polygon2D, point_in_polygon, convex_hull, chaikin_smooth, find_shared_edges,
    find_line_polygon_intersections, polygon_split, polygon_augment,
};
use worldsmith_core::algo::geometry::bbox::{AABB2D, OBB2D};
use worldsmith_core::algo::geometry::boolean;

// 图论
use worldsmith_core::algo::graph::pathfind::{WeightedGraph, dijkstra, dijkstra_path, astar, k_shortest_paths};
use worldsmith_core::algo::graph::topology::{topological_sort, connected_components, tarjan_scc, find_dangling_references};
use worldsmith_core::algo::graph::layout::{
    force_directed_layout, ForceLayoutConfig,
    grid_layout, GridLayoutConfig,
    radial_layout, RadialLayoutConfig,
    tree_layout, TreeLayoutConfig,
    compute_layout, LayoutAlgorithm,
};
use worldsmith_core::algo::graph::community;

// 协作（CRDT）
use worldsmith_core::algo::collab::crdt::{LWWRegister, ORSet, RGA, VectorClock};

// 地形
use worldsmith_core::algo::terrain::terrain::{NoiseConfig, HeightMap, value_noise_2d, marching_squares};
use worldsmith_core::algo::terrain::erosion;

// 草图约束 / DXF
use worldsmith_core::algo::draft::constraint::ConstraintSystem;
use worldsmith_core::algo::draft::dxf_io;

// ── 几何算法命令 ──

#[tauri::command]
pub fn cmd_algo_segment_intersect(
    seg1_json: String,
    seg2_json: String,
) -> Result<bool, CoreError> {
    let s1: Segment2D = serde_json::from_str(&seg1_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let s2: Segment2D = serde_json::from_str(&seg2_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(s1.intersects(s2))
}

#[tauri::command]
pub fn cmd_algo_segment_intersection_point(
    seg1_json: String,
    seg2_json: String,
) -> Result<Option<Point2D>, CoreError> {
    let s1: Segment2D = serde_json::from_str(&seg1_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let s2: Segment2D = serde_json::from_str(&seg2_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(s1.intersection_point(s2))
}

#[tauri::command]
pub fn cmd_algo_find_all_intersections(
    segments_json: String,
) -> Result<serde_json::Value, CoreError> {
    let segments: Vec<Segment2D> = serde_json::from_str(&segments_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let results = find_all_intersections(&segments);
    Ok(serde_json::to_value(&results).map_err(|e| CoreError::serialize(e.to_string()))?)
}

#[tauri::command]
pub fn cmd_algo_point_in_polygon(
    point_json: String,
    vertices_json: String,
) -> Result<bool, CoreError> {
    let point: Point2D = serde_json::from_str(&point_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let vertices: Vec<Point2D> = serde_json::from_str(&vertices_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(point_in_polygon(point, &vertices))
}

#[tauri::command]
pub fn cmd_algo_polygon_area(vertices_json: String) -> Result<f64, CoreError> {
    let poly: Polygon2D = serde_json::from_str(&vertices_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(poly.area())
}

#[tauri::command]
pub fn cmd_algo_polygon_centroid(vertices_json: String) -> Result<Option<Point2D>, CoreError> {
    let poly: Polygon2D = serde_json::from_str(&vertices_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(poly.centroid())
}

#[tauri::command]
pub fn cmd_algo_convex_hull(points_json: String) -> Result<Vec<Point2D>, CoreError> {
    let points: Vec<Point2D> = serde_json::from_str(&points_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(convex_hull(&points))
}

#[tauri::command]
pub fn cmd_algo_aabb_intersects(
    a_json: String,
    b_json: String,
) -> Result<bool, CoreError> {
    let a: AABB2D = serde_json::from_str(&a_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let b: AABB2D = serde_json::from_str(&b_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(a.intersects(b))
}

#[tauri::command]
pub fn cmd_algo_obb_intersects(
    a_json: String,
    b_json: String,
) -> Result<bool, CoreError> {
    let a: OBB2D = serde_json::from_str(&a_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let b: OBB2D = serde_json::from_str(&b_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(a.intersects(b))
}

// ── 图算法命令 ──

#[tauri::command]
pub fn cmd_algo_dijkstra(
    graph_json: String,
    source: String,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = dijkstra(&graph, &source);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_dijkstra_path(
    graph_json: String,
    source: String,
    target: String,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = dijkstra_path(&graph, &source, &target);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_astar(
    graph_json: String,
    source: String,
    target: String,
    heuristic_json: String,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let heuristic_map: std::collections::HashMap<String, f64> = serde_json::from_str(&heuristic_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = astar(&graph, &source, &target, |node| {
        heuristic_map.get(node).copied().unwrap_or(f64::INFINITY)
    });
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_k_shortest_paths(
    graph_json: String,
    source: String,
    target: String,
    k: usize,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = k_shortest_paths(&graph, &source, &target, k);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_topological_sort(
    graph_json: String,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = topological_sort(&graph);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_connected_components(
    graph_json: String,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = connected_components(&graph);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_tarjan_scc(
    graph_json: String,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = tarjan_scc(&graph);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_find_dangling(
    graph_json: String,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = find_dangling_references(&graph);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

// ── 布局算法命令 ──

#[tauri::command]
pub fn cmd_algo_force_layout(
    graph_json: String,
    config_json: Option<String>,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let config: ForceLayoutConfig = config_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let result = force_directed_layout(&graph, &config);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_grid_layout(
    graph_json: String,
    config_json: Option<String>,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let config: GridLayoutConfig = config_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let result = grid_layout(&graph, &config);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_radial_layout(
    graph_json: String,
    config_json: Option<String>,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let config: RadialLayoutConfig = config_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let result = radial_layout(&graph, &config);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_tree_layout(
    graph_json: String,
    config_json: String,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let config: TreeLayoutConfig = serde_json::from_str(&config_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = tree_layout(&graph, &config)
        .map_err(|e| CoreError::storage(e.to_string()))?;
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_layout_unified(
    graph_json: String,
    algorithm_json: String,
) -> Result<serde_json::Value, CoreError> {
    let graph: WeightedGraph = serde_json::from_str(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let algorithm: LayoutAlgorithm = serde_json::from_str(&algorithm_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = compute_layout(&graph, &algorithm)
        .map_err(|e| CoreError::storage(e.to_string()))?;
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

// ── CRDT 命令 ──

#[tauri::command]
pub fn cmd_algo_crdt_lww_new(
    value: String,
    node_id: String,
) -> Result<String, CoreError> {
    let reg = LWWRegister::new(value, node_id);
    serde_json::to_string(&reg).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_crdt_lww_set(
    register_json: String,
    value: String,
    timestamp: u64,
) -> Result<String, CoreError> {
    let mut reg: LWWRegister<String> = serde_json::from_str(&register_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    reg.set(value, timestamp);
    serde_json::to_string(&reg).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_crdt_lww_merge(
    register_json: String,
    other_json: String,
) -> Result<String, CoreError> {
    let mut reg: LWWRegister<String> = serde_json::from_str(&register_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let other: LWWRegister<String> = serde_json::from_str(&other_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    reg.merge(&other);
    serde_json::to_string(&reg).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_crdt_orset_new(
    node_id: String,
) -> Result<String, CoreError> {
    let set = ORSet::<String>::new(node_id);
    serde_json::to_string(&set).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_crdt_orset_add(
    set_json: String,
    element: String,
) -> Result<String, CoreError> {
    let mut set: ORSet<String> = serde_json::from_str(&set_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    set.add(element);
    serde_json::to_string(&set).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_crdt_orset_remove(
    set_json: String,
    element: String,
) -> Result<String, CoreError> {
    let mut set: ORSet<String> = serde_json::from_str(&set_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    set.remove(&element);
    serde_json::to_string(&set).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_crdt_orset_merge(
    set_json: String,
    other_json: String,
) -> Result<String, CoreError> {
    let mut set: ORSet<String> = serde_json::from_str(&set_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let other: ORSet<String> = serde_json::from_str(&other_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    set.merge(&other);
    serde_json::to_string(&set).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_crdt_orset_elements(
    set_json: String,
) -> Result<serde_json::Value, CoreError> {
    let set: ORSet<String> = serde_json::from_str(&set_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let elements: Vec<&String> = set.elements();
    serde_json::to_value(&elements).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_crdt_rga_new(
    node_id: String,
) -> Result<String, CoreError> {
    let rga = RGA::new(node_id);
    serde_json::to_string(&rga).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_crdt_rga_insert(
    rga_json: String,
    index: usize,
    content: String,
) -> Result<serde_json::Value, CoreError> {
    let mut rga: RGA = serde_json::from_str(&rga_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let inserted_id = rga.insert(index, content);
    Ok(serde_json::json!({
        "rga": rga,
        "insertedId": inserted_id,
    }))
}

#[tauri::command]
pub fn cmd_algo_crdt_rga_delete(
    rga_json: String,
    id: String,
) -> Result<String, CoreError> {
    let mut rga: RGA = serde_json::from_str(&rga_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    rga.delete(&id);
    serde_json::to_string(&rga).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_crdt_rga_merge(
    rga_json: String,
    other_json: String,
) -> Result<String, CoreError> {
    let mut rga: RGA = serde_json::from_str(&rga_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let other: RGA = serde_json::from_str(&other_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    rga.merge(&other);
    serde_json::to_string(&rga).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_crdt_rga_text(
    rga_json: String,
) -> Result<String, CoreError> {
    let rga: RGA = serde_json::from_str(&rga_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(rga.text())
}

#[tauri::command]
pub fn cmd_algo_crdt_vc_compare(
    clock_a_json: String,
    clock_b_json: String,
) -> Result<serde_json::Value, CoreError> {
    let a: VectorClock = serde_json::from_str(&clock_a_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let b: VectorClock = serde_json::from_str(&clock_b_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(serde_json::json!({
        "happensBefore": a.happens_before(&b),
        "isConcurrent": a.is_concurrent(&b),
    }))
}

// ── 地形命令 ──

#[tauri::command]
pub fn cmd_algo_terrain_noise(
    x: f64,
    y: f64,
    config_json: Option<String>,
) -> Result<f64, CoreError> {
    let config: NoiseConfig = config_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    Ok(value_noise_2d(x, y, &config))
}

#[tauri::command]
pub fn cmd_algo_terrain_heightmap_generate(
    config_json: Option<String>,
    width: usize,
    height: usize,
    offset_x: f64,
    offset_y: f64,
) -> Result<String, CoreError> {
    let config: NoiseConfig = config_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let map = HeightMap::generate(&config, width, height, offset_x, offset_y);
    serde_json::to_string(&map).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_terrain_heightmap_slope(
    heightmap_json: String,
    x: usize,
    y: usize,
) -> Result<serde_json::Value, CoreError> {
    let map: HeightMap = serde_json::from_str(&heightmap_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let (dx, dy) = map.slope_at(x, y);
    let magnitude = map.slope_magnitude_at(x, y);
    Ok(serde_json::json!({
        "dx": dx,
        "dy": dy,
        "magnitude": magnitude,
    }))
}

#[tauri::command]
pub fn cmd_algo_terrain_heightmap_aspect(
    heightmap_json: String,
    x: usize,
    y: usize,
) -> Result<f64, CoreError> {
    let map: HeightMap = serde_json::from_str(&heightmap_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(map.aspect_at(x, y))
}

#[tauri::command]
pub fn cmd_algo_terrain_marching_squares(
    heightmap_json: String,
    levels_json: String,
) -> Result<serde_json::Value, CoreError> {
    let map: HeightMap = serde_json::from_str(&heightmap_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let levels: Vec<f64> = serde_json::from_str(&levels_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let contours = marching_squares(&map, &levels);
    serde_json::to_value(&contours).map_err(|e| CoreError::serialize(e.to_string()))
}

// ── 约束求解 ──

#[tauri::command]
pub fn cmd_algo_constraint_solve(
    system_json: String,
    max_iterations: usize,
    tolerance: f64,
) -> Result<serde_json::Value, CoreError> {
    let mut system: ConstraintSystem = serde_json::from_str(&system_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = system.solve(max_iterations, tolerance);
    Ok(serde_json::json!({
        "result": result,
        "system": system,
    }))
}

// ── DXF ──

#[tauri::command]
pub fn cmd_algo_dxf_parse(content: String) -> Result<serde_json::Value, CoreError> {
    let result = dxf_io::parse_dxf(&content).map_err(|e| CoreError::deserialize(e.to_string()))?;
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_dxf_generate(entities_json: String) -> Result<String, CoreError> {
    let entities: Vec<dxf_io::DxfEntity> = serde_json::from_str(&entities_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    dxf_io::generate_dxf(&entities).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_dxf_extract_constraints(system_json: String) -> Result<serde_json::Value, CoreError> {
    let system: worldsmith_core::algo::draft::constraint::ConstraintSystem = serde_json::from_str(&system_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let constraints = dxf_io::extract_horizontal_vertical_constraints(&system);
    serde_json::to_value(&constraints).map_err(|e| CoreError::serialize(e.to_string()))
}

// ── 多边形布尔运算 ──

#[tauri::command]
pub fn cmd_algo_polygon_boolean(op: String, a_json: String, b_json: String) -> Result<serde_json::Value, CoreError> {
    let boolean_op = match op.as_str() {
        "union" => boolean::BooleanOp::Union,
        "intersection" => boolean::BooleanOp::Intersection,
        "difference" => boolean::BooleanOp::Difference,
        "xor" => boolean::BooleanOp::Xor,
        _ => return Err(CoreError::deserialize("op must be union/intersection/difference/xor".to_string())),
    };
    let a: boolean::Polygon2DResult = serde_json::from_str(&a_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let b: boolean::Polygon2DResult = serde_json::from_str(&b_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = boolean::polygon_boolean_op(&boolean_op, &a.exterior, &a.interiors, &b.exterior, &b.interiors);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_polygon_offset(polygon_json: String, delta: f64) -> Result<String, CoreError> {
    let poly: boolean::Polygon2DResult = serde_json::from_str(&polygon_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = boolean::polygon_offset(&poly.exterior, &poly.interiors, delta);
    serde_json::to_string(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_polygon_simplify(polygon_json: String, epsilon: f64) -> Result<String, CoreError> {
    let poly: boolean::Polygon2DResult = serde_json::from_str(&polygon_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = boolean::polygon_simplify(&poly.exterior, &poly.interiors, epsilon);
    serde_json::to_string(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_line_length(points_json: String) -> Result<f64, CoreError> {
    let points: Vec<worldsmith_core::algo::geometry::line::Point2D> = serde_json::from_str(&points_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    Ok(boolean::line_length(&points))
}

// ── 图分析（PageRank / 社区 / 介数） ──

#[tauri::command]
pub fn cmd_algo_pagerank(graph_json: String, damping: f64, max_iterations: usize, tolerance: f64) -> Result<serde_json::Value, CoreError> {
    let graph = serde_json::from_str::<worldsmith_core::algo::graph::pathfind::WeightedGraph>(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = community::pagerank(&graph, damping, max_iterations, tolerance);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_community_detection(graph_json: String) -> Result<serde_json::Value, CoreError> {
    let graph = serde_json::from_str::<worldsmith_core::algo::graph::pathfind::WeightedGraph>(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = community::louvain_communities(&graph);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_betweenness_centrality(graph_json: String) -> Result<serde_json::Value, CoreError> {
    let graph = serde_json::from_str::<worldsmith_core::algo::graph::pathfind::WeightedGraph>(&graph_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = community::betweenness_centrality(&graph);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

// ── 侵蚀 / 视域 ──

#[tauri::command]
pub fn cmd_algo_hydraulic_erosion(heightmap_json: String, config_json: Option<String>) -> Result<String, CoreError> {
    let mut map = serde_json::from_str::<worldsmith_core::algo::terrain::terrain::HeightMap>(&heightmap_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let config: erosion::ErosionConfig = config_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    erosion::hydraulic_erosion(&mut map, &config);
    serde_json::to_string(&map).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_viewshed(heightmap_json: String, observer_x: usize, observer_y: usize, observer_height: f64, radius: f64) -> Result<serde_json::Value, CoreError> {
    let map = serde_json::from_str::<worldsmith_core::algo::terrain::terrain::HeightMap>(&heightmap_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = erosion::viewshed(&map, observer_x, observer_y, observer_height, radius);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

// ── 多边形工具（平滑 / 共享边 / 线-多边形相交 / 切割 / 增厚） ──

#[tauri::command]
pub fn cmd_algo_chaikin_smooth(vertices_json: String, iterations: usize) -> Result<String, CoreError> {
    let vertices: Vec<Point2D> = serde_json::from_str(&vertices_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = chaikin_smooth(&vertices, iterations);
    serde_json::to_string(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_find_shared_edges(vertices_a_json: String, vertices_b_json: String, threshold: f64) -> Result<serde_json::Value, CoreError> {
    let a: Vec<Point2D> = serde_json::from_str(&vertices_a_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let b: Vec<Point2D> = serde_json::from_str(&vertices_b_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = find_shared_edges(&a, &b, threshold);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_find_line_polygon_intersections(line_json: String, polygon_json: String) -> Result<serde_json::Value, CoreError> {
    let line: Vec<Point2D> = serde_json::from_str(&line_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let polygon: Vec<Point2D> = serde_json::from_str(&polygon_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = find_line_polygon_intersections(&line, &polygon);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_polygon_split(polygon_json: String, cutting_line_json: String) -> Result<serde_json::Value, CoreError> {
    let polygon: Vec<Point2D> = serde_json::from_str(&polygon_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let cutting: Vec<Point2D> = serde_json::from_str(&cutting_line_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = polygon_split(&polygon, &cutting);
    serde_json::to_value(&result).map_err(|e| CoreError::serialize(e.to_string()))
}

#[tauri::command]
pub fn cmd_algo_polygon_augment(polygon_json: String, adding_line_json: String) -> Result<String, CoreError> {
    let polygon: Vec<Point2D> = serde_json::from_str(&polygon_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let adding: Vec<Point2D> = serde_json::from_str(&adding_line_json)
        .map_err(|e| CoreError::deserialize(e.to_string()))?;
    let result = polygon_augment(&polygon, &adding);
    serde_json::to_string(&result).map_err(|e| CoreError::serialize(e.to_string()))
}
