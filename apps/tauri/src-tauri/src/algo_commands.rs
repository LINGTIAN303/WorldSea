//! [HTTP-BRIDGE] 图布局 / 图分析算法命令（cmd_algo_*）
//!
//! 薄封装 worldsmith-core::algo::graph 的 Rust 算法，供前端 mindmap 布局/图分析
//! 在桌面（Tauri IPC）与浏览器（HTTP 桥 RPC）双端调用真实后端。此前这些命令从未在
//! Rust 端注册，前端一直靠 JS 降级；本文件补齐真实实现。
//! 移除：删除本文件，还原 lib.rs / rpc.rs 标记处。

use serde_json::{json, Value};
use worldsmith_core::algo::graph::community::{louvain_communities, pagerank};
use worldsmith_core::algo::graph::layout::{
    force_directed_layout, grid_layout, mindmap_tree_layout, radial_layout, tree_layout,
    ForceLayoutConfig, GridLayoutConfig, MindmapTreeConfig, RadialLayoutConfig, TreeLayoutConfig,
};
use worldsmith_core::algo::graph::pathfind::{dijkstra_path, WeightedGraph};
use worldsmith_core::algo::graph::topology::connected_components;

/// 解析前端传入的 graphJson（WeightedGraph 序列化）
fn parse_graph(graph_json: &str) -> Result<WeightedGraph, String> {
    serde_json::from_str(graph_json).map_err(|e| format!("graphJson 解析失败: {e}"))
}

/// 解析前端传入的 configJson（Option，缺失用默认配置）
fn parse_config<T>(config_json: Option<String>) -> Result<T, String>
where
    T: serde::de::DeserializeOwned + Default,
{
    match config_json {
        Some(s) => serde_json::from_str(&s).map_err(|e| format!("configJson 解析失败: {e}")),
        None => Ok(T::default()),
    }
}

/// 力导向布局：返回 ForceLayoutResult（nodes / iterations / converged / totalEnergy）
#[tauri::command]
pub fn cmd_algo_force_layout(
    graph_json: String,
    config_json: Option<String>,
) -> Result<Value, String> {
    let graph = parse_graph(&graph_json)?;
    let config: ForceLayoutConfig = parse_config(config_json)?;
    let r = force_directed_layout(&graph, &config);
    serde_json::to_value(r).map_err(|e| e.to_string())
}

/// 径向布局：返回 Vec<LayoutNode>
#[tauri::command]
pub fn cmd_algo_radial_layout(
    graph_json: String,
    config_json: Option<String>,
) -> Result<Value, String> {
    let graph = parse_graph(&graph_json)?;
    let config: RadialLayoutConfig = parse_config(config_json)?;
    let nodes = radial_layout(&graph, &config);
    serde_json::to_value(nodes).map_err(|e| e.to_string())
}

/// 树布局（Buchheim）：返回 Vec<LayoutNode>；根节点不在图中时报错
#[tauri::command]
pub fn cmd_algo_tree_layout(
    graph_json: String,
    config_json: Option<String>,
) -> Result<Value, String> {
    let graph = parse_graph(&graph_json)?;
    let config: TreeLayoutConfig = parse_config(config_json)?;
    let nodes = tree_layout(&graph, &config).map_err(|e| e.to_string())?;
    serde_json::to_value(nodes).map_err(|e| e.to_string())
}

/// 网格布局：返回 Vec<LayoutNode>
#[tauri::command]
pub fn cmd_algo_grid_layout(
    graph_json: String,
    config_json: Option<String>,
) -> Result<Value, String> {
    let graph = parse_graph(&graph_json)?;
    let config: GridLayoutConfig = parse_config(config_json)?;
    let nodes = grid_layout(&graph, &config);
    serde_json::to_value(nodes).map_err(|e| e.to_string())
}

/// 统一布局入口：algorithmJson 形如 `{"MindmapTree": {...}}`，返回 `{ nodes: [...] }`
#[tauri::command]
pub fn cmd_algo_layout_unified(
    graph_json: String,
    algorithm_json: String,
) -> Result<Value, String> {
    let graph = parse_graph(&graph_json)?;
    let algo: Value =
        serde_json::from_str(&algorithm_json).map_err(|e| format!("algorithmJson 解析失败: {e}"))?;
    // 当前仅支持 MindmapTree variant（其余布局走独立命令）
    let cfg = algo
        .get("MindmapTree")
        .ok_or_else(|| "algorithmJson 缺少 MindmapTree 配置".to_string())?;
    let config: MindmapTreeConfig =
        serde_json::from_value(cfg.clone()).map_err(|e| format!("MindmapTree 配置解析失败: {e}"))?;
    let nodes = mindmap_tree_layout(&graph, &config);
    serde_json::to_value(json!({ "nodes": nodes })).map_err(|e| e.to_string())
}

/// Dijkstra 最短路径：返回 PathResult（path / totalCost / found）
#[tauri::command]
pub fn cmd_algo_dijkstra_path(
    graph_json: String,
    source: String,
    target: String,
) -> Result<Value, String> {
    let graph = parse_graph(&graph_json)?;
    let r = dijkstra_path(&graph, &source, &target);
    serde_json::to_value(r).map_err(|e| e.to_string())
}

/// 连通分量：返回 ConnectedComponentsResult（components / count / largestSize）
#[tauri::command]
pub fn cmd_algo_connected_components(graph_json: String) -> Result<Value, String> {
    let graph = parse_graph(&graph_json)?;
    let r = connected_components(&graph);
    serde_json::to_value(r).map_err(|e| e.to_string())
}

/// PageRank：返回 PageRankResult（scores / iterations / converged）
#[tauri::command]
pub fn cmd_algo_pagerank(
    graph_json: String,
    damping: Option<f64>,
    max_iterations: Option<usize>,
    tolerance: Option<f64>,
) -> Result<Value, String> {
    let graph = parse_graph(&graph_json)?;
    let r = pagerank(
        &graph,
        damping.unwrap_or(0.85),
        max_iterations.unwrap_or(100),
        tolerance.unwrap_or(1e-6),
    );
    serde_json::to_value(r).map_err(|e| e.to_string())
}

/// 社区检测（Louvain）：返回 CommunityDetectionResult（communities / modularity）
#[tauri::command]
pub fn cmd_algo_community_detection(graph_json: String) -> Result<Value, String> {
    let graph = parse_graph(&graph_json)?;
    let r = louvain_communities(&graph);
    serde_json::to_value(r).map_err(|e| e.to_string())
}
