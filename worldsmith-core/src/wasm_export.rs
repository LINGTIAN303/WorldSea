use wasm_bindgen::prelude::*;

use crate::doctor::diagnostics::run_diagnostics;
use crate::migrate::engine::migrate_pack;
use crate::models::entity::{Entity, EntityTypeSchema};
use crate::models::pack::WorldSmithPack;
use crate::models::plugin::{validate_manifest, PluginManifest};
use crate::models::relation::{Relation, RelationTypeSchema};
use crate::validate::entity::{validate_entity, ValidationReport};
use crate::validate::pack::validate_pack;
use crate::validate::reference::check_references_report;
use crate::validate::relation::validate_relation;

/// WorldSmith 核心 WASM 绑定，提供验证、迁移和诊断功能的 WebAssembly 接口
#[wasm_bindgen]
pub struct WorldSmithCore;

thread_local! {
  static RETROFIT_ENGINE: std::cell::RefCell<crate::retrofit::RetrofitEngine> =
    std::cell::RefCell::new(crate::retrofit::RetrofitEngine::new());
}

#[wasm_bindgen]
impl WorldSmithCore {
  /// 创建 WorldSmithCore 实例
  #[wasm_bindgen(constructor)]
  pub fn new() -> Self {
    Self
  }

  /// 验证单个实体的合法性
  ///
  /// 参数:
  /// - `entity_json`: 实体的 JSON 字符串
  /// - `schema_json`: 可选的实体类型 Schema JSON 字符串
  ///
  /// 返回: 验证报告的 JsValue，或解析失败的错误
  pub fn validate_entity(
    &self,
    entity_json: &str,
    schema_json: Option<String>,
  ) -> Result<JsValue, JsValue> {
    let entity: Entity = serde_json::from_str(entity_json)
      .map_err(|e| JsValue::from_str(&format!("实体解析失败: {e}")))?;

    let schema =
      schema_json.as_deref().and_then(|s| serde_json::from_str::<EntityTypeSchema>(s).ok());

    let report = validate_entity(&entity, schema.as_ref());
    serde_wasm_bindgen::to_value(&report).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  /// 批量验证多个实体的合法性
  ///
  /// 参数:
  /// - `entities_json`: 实体列表的 JSON 字符串
  /// - `schemas_json`: 可选的实体类型 Schema 列表 JSON 字符串
  ///
  /// 返回: 合并后的验证报告 JsValue，或解析失败的错误
  pub fn validate_entities(
    &self,
    entities_json: &str,
    schemas_json: Option<String>,
  ) -> Result<JsValue, JsValue> {
    let entities: Vec<Entity> = serde_json::from_str(entities_json)
      .map_err(|e| JsValue::from_str(&format!("实体列表解析失败: {e}")))?;

    let schemas: Vec<EntityTypeSchema> =
      schemas_json.as_deref().and_then(|s| serde_json::from_str(s).ok()).unwrap_or_default();

    let schema_map: std::collections::HashMap<String, EntityTypeSchema> =
      schemas.iter().map(|s| (s.type_name.clone(), s.clone())).collect();

    let mut combined = ValidationReport::new();
    for entity in &entities {
      let schema = schema_map.get(&entity.entity_type);
      let report = validate_entity(entity, schema);
      combined.errors.extend(report.errors);
      if !report.valid {
        combined.valid = false;
      }
    }

    serde_wasm_bindgen::to_value(&combined).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  /// 验证包数据的合法性
  ///
  /// 参数:
  /// - `pack_json`: 包数据的 JSON 字符串
  ///
  /// 返回: 验证报告的 JsValue，或解析失败的错误
  pub fn validate_pack(&self, pack_json: &str) -> Result<JsValue, JsValue> {
    let pack: WorldSmithPack = serde_json::from_str(pack_json)
      .map_err(|e| JsValue::from_str(&format!("包解析失败: {e}")))?;

    let report = validate_pack(&pack);
    serde_wasm_bindgen::to_value(&report).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  /// 验证单个关系的合法性
  ///
  /// 参数:
  /// - `relation_json`: 关系的 JSON 字符串
  /// - `schema_json`: 可选的关系类型 Schema JSON 字符串
  ///
  /// 返回: 验证报告的 JsValue，或解析失败的错误
  pub fn validate_relation(
    &self,
    relation_json: &str,
    schema_json: Option<String>,
  ) -> Result<JsValue, JsValue> {
    let relation: Relation = serde_json::from_str(relation_json)
      .map_err(|e| JsValue::from_str(&format!("关系解析失败: {e}")))?;

    let schema =
      schema_json.as_deref().and_then(|s| serde_json::from_str::<RelationTypeSchema>(s).ok());

    let report = validate_relation(&relation, schema.as_ref());
    serde_wasm_bindgen::to_value(&report).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  /// 检查实体和关系之间的引用完整性
  ///
  /// 参数:
  /// - `entities_json`: 实体列表的 JSON 字符串
  /// - `relations_json`: 关系列表的 JSON 字符串
  ///
  /// 返回: 引用完整性验证报告的 JsValue，或解析失败的错误
  pub fn check_references(
    &self,
    entities_json: &str,
    relations_json: &str,
  ) -> Result<JsValue, JsValue> {
    let entities: Vec<Entity> = serde_json::from_str(entities_json)
      .map_err(|e| JsValue::from_str(&format!("实体列表解析失败: {e}")))?;
    let relations: Vec<Relation> = serde_json::from_str(relations_json)
      .map_err(|e| JsValue::from_str(&format!("关系列表解析失败: {e}")))?;

    let report = check_references_report(&entities, &relations);
    serde_wasm_bindgen::to_value(&report).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  /// 将包数据从指定版本迁移到最新版本
  ///
  /// 参数:
  /// - `pack_json`: 包数据的 JSON 字符串
  /// - `from_version`: 当前包的版本号
  ///
  /// 返回: 包含迁移结果和更新后数据的 JsValue，或解析失败的错误
  pub fn migrate(&self, pack_json: &str, from_version: u32) -> Result<JsValue, JsValue> {
    let mut pack_data: serde_json::Value = serde_json::from_str(pack_json)
      .map_err(|e| JsValue::from_str(&format!("包解析失败: {e}")))?;

    let result = migrate_pack(&mut pack_data, from_version);

    let output = serde_json::json!({
        "result": result,
        "data": pack_data,
    });

    serde_wasm_bindgen::to_value(&output).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  /// 对世界数据执行全面诊断
  ///
  /// 参数:
  /// - `entities_json`: 实体列表的 JSON 字符串
  /// - `relations_json`: 关系列表的 JSON 字符串
  /// - `schemas_json`: 可选的实体类型 Schema 列表 JSON 字符串
  ///
  /// 返回: 诊断摘要的 JsValue，或解析失败的错误
  pub fn run_diagnostics(
    &self,
    entities_json: &str,
    relations_json: &str,
    schemas_json: Option<String>,
  ) -> Result<JsValue, JsValue> {
    let entities: Vec<Entity> = serde_json::from_str(entities_json)
      .map_err(|e| JsValue::from_str(&format!("实体列表解析失败: {e}")))?;
    let relations: Vec<Relation> = serde_json::from_str(relations_json)
      .map_err(|e| JsValue::from_str(&format!("关系列表解析失败: {e}")))?;
    let schemas: Vec<EntityTypeSchema> =
      schemas_json.as_deref().and_then(|s| serde_json::from_str(s).ok()).unwrap_or_default();

    let summary = run_diagnostics(&entities, &relations, Some(&schemas));
    serde_wasm_bindgen::to_value(&summary).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn validate_plugin_manifest(&self, manifest_json: &str) -> Result<JsValue, JsValue> {
    let manifest: PluginManifest = serde_json::from_str(manifest_json)
      .map_err(|e| JsValue::from_str(&format!("清单解析失败: {e}")))?;
    let result = validate_manifest(&manifest);
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn check_plugin_health(
    &self,
    manifests_json: &str,
    active_ids_json: &str,
  ) -> Result<JsValue, JsValue> {
    let manifests: Vec<PluginManifest> = serde_json::from_str(manifests_json)
      .map_err(|e| JsValue::from_str(&format!("清单列表解析失败: {e}")))?;
    let active_ids: Vec<String> = serde_json::from_str(active_ids_json)
      .map_err(|e| JsValue::from_str(&format!("活跃ID列表解析失败: {e}")))?;
    let report = crate::doctor::plugin::check_plugin_health(&manifests, &active_ids);
    serde_wasm_bindgen::to_value(&report).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn retrofit_begin_session(
    &self,
    session_id: &str,
    catalog_json: Option<String>,
  ) -> Result<(), JsValue> {
    let catalog = catalog_json
      .as_deref()
      .and_then(|s| serde_json::from_str::<crate::retrofit::catalog::CapabilityCatalog>(s).ok())
      .unwrap_or_else(crate::retrofit::catalog::CapabilityCatalog::permissive);
    RETROFIT_ENGINE.with(|e| {
      e.borrow_mut()
        .begin_session(session_id, catalog)
        .map_err(|err| JsValue::from_str(&err.to_string()))
    })?;
    Ok(())
  }

  pub fn retrofit_submit_intent(&self, intent_json: &str) -> Result<JsValue, JsValue> {
    let intent: crate::retrofit::intent::RetrofitIntent = serde_json::from_str(intent_json)
      .map_err(|e| JsValue::from_str(&format!("意图解析失败: {e}")))?;
    RETROFIT_ENGINE.with(|e| {
      let report =
        e.borrow_mut().submit_intent(intent).map_err(|err| JsValue::from_str(&err.to_string()))?;
      serde_wasm_bindgen::to_value(&report).map_err(|err| JsValue::from_str(&err.to_string()))
    })
  }

  pub fn retrofit_confirm_and_stage(&self) -> Result<JsValue, JsValue> {
    RETROFIT_ENGINE.with(|e| {
      let intents =
        e.borrow_mut().confirm_and_stage().map_err(|err| JsValue::from_str(&err.to_string()))?;
      serde_wasm_bindgen::to_value(&intents).map_err(|err| JsValue::from_str(&err.to_string()))
    })
  }

  pub fn retrofit_apply_next(
    &self,
    before_json: &str,
    after_json: &str,
  ) -> Result<JsValue, JsValue> {
    let before: serde_json::Value = serde_json::from_str(before_json)
      .map_err(|e| JsValue::from_str(&format!("before 解析失败: {e}")))?;
    let after: serde_json::Value = serde_json::from_str(after_json)
      .map_err(|e| JsValue::from_str(&format!("after 解析失败: {e}")))?;
    RETROFIT_ENGINE.with(|e| {
      let result = e
        .borrow_mut()
        .apply_next(before, after)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
      serde_wasm_bindgen::to_value(&result).map_err(|err| JsValue::from_str(&err.to_string()))
    })
  }

  pub fn retrofit_verify_and_accept(
    &self,
    entity_count: usize,
    relation_count: usize,
  ) -> Result<JsValue, JsValue> {
    RETROFIT_ENGINE.with(|e| {
      let result = e
        .borrow_mut()
        .verify_and_accept(entity_count, relation_count)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
      serde_wasm_bindgen::to_value(&result).map_err(|err| JsValue::from_str(&err.to_string()))
    })
  }

  pub fn retrofit_request_repair(&self, message: &str) -> Result<(), JsValue> {
    RETROFIT_ENGINE.with(|e| {
      e.borrow_mut().request_repair(message).map_err(|err| JsValue::from_str(&err.to_string()))
    })
  }

  pub fn retrofit_redirect(&self, message: &str) -> Result<(), JsValue> {
    RETROFIT_ENGINE
      .with(|e| e.borrow_mut().redirect(message).map_err(|err| JsValue::from_str(&err.to_string())))
  }

  pub fn retrofit_rollback_last(&self) -> Result<JsValue, JsValue> {
    RETROFIT_ENGINE.with(|e| {
      let result =
        e.borrow_mut().rollback_last().map_err(|err| JsValue::from_str(&err.to_string()))?;
      serde_wasm_bindgen::to_value(&result).map_err(|err| JsValue::from_str(&err.to_string()))
    })
  }

  pub fn retrofit_abort(&self) -> Result<JsValue, JsValue> {
    RETROFIT_ENGINE.with(|e| {
      let rolled = e.borrow_mut().abort().map_err(|err| JsValue::from_str(&err.to_string()))?;
      serde_wasm_bindgen::to_value(&rolled).map_err(|err| JsValue::from_str(&err.to_string()))
    })
  }

  pub fn retrofit_session_phase(&self) -> Result<JsValue, JsValue> {
    RETROFIT_ENGINE.with(|e| {
      let phase = e.borrow().session().map(|s| s.phase);
      serde_wasm_bindgen::to_value(&phase).map_err(|err| JsValue::from_str(&err.to_string()))
    })
  }

  pub fn retrofit_detect_conflicts(&self) -> Result<JsValue, JsValue> {
    RETROFIT_ENGINE.with(|e| {
      let report = e.borrow().detect_conflicts();
      serde_wasm_bindgen::to_value(&report).map_err(|err| JsValue::from_str(&err.to_string()))
    })
  }

  pub fn retrofit_end_session(&self) -> Result<bool, JsValue> {
    RETROFIT_ENGINE.with(|e| {
      Ok(e.borrow_mut().end_session().is_some())
    })
  }

  // ── 算法：几何 ──

  pub fn algo_segment_intersect(&self, seg1_json: &str, seg2_json: &str) -> Result<bool, JsValue> {
    let s1: crate::algo::geometry::line::Segment2D = serde_json::from_str(seg1_json)
      .map_err(|e| JsValue::from_str(&format!("seg1 解析失败: {e}")))?;
    let s2: crate::algo::geometry::line::Segment2D = serde_json::from_str(seg2_json)
      .map_err(|e| JsValue::from_str(&format!("seg2 解析失败: {e}")))?;
    Ok(s1.intersects(s2))
  }

  pub fn algo_find_all_intersections(&self, segments_json: &str) -> Result<String, JsValue> {
    let segments: Vec<crate::algo::geometry::line::Segment2D> = serde_json::from_str(segments_json)
      .map_err(|e| JsValue::from_str(&format!("segments 解析失败: {e}")))?;
    let results = crate::algo::geometry::line::find_all_intersections(&segments);
    serde_json::to_string(&results).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_point_in_polygon(&self, point_json: &str, vertices_json: &str) -> Result<bool, JsValue> {
    let point: crate::algo::geometry::line::Point2D = serde_json::from_str(point_json)
      .map_err(|e| JsValue::from_str(&format!("point 解析失败: {e}")))?;
    let vertices: Vec<crate::algo::geometry::line::Point2D> = serde_json::from_str(vertices_json)
      .map_err(|e| JsValue::from_str(&format!("vertices 解析失败: {e}")))?;
    Ok(crate::algo::geometry::polygon::point_in_polygon(point, &vertices))
  }

  pub fn algo_polygon_area(&self, vertices_json: &str) -> Result<f64, JsValue> {
    let poly: crate::algo::geometry::polygon::Polygon2D = serde_json::from_str(vertices_json)
      .map_err(|e| JsValue::from_str(&format!("polygon 解析失败: {e}")))?;
    Ok(poly.area())
  }

  pub fn algo_convex_hull(&self, points_json: &str) -> Result<String, JsValue> {
    let points: Vec<crate::algo::geometry::line::Point2D> = serde_json::from_str(points_json)
      .map_err(|e| JsValue::from_str(&format!("points 解析失败: {e}")))?;
    let hull = crate::algo::geometry::polygon::convex_hull(&points);
    serde_json::to_string(&hull).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_aabb_intersects(&self, a_json: &str, b_json: &str) -> Result<bool, JsValue> {
    let a: crate::algo::geometry::bbox::AABB2D = serde_json::from_str(a_json)
      .map_err(|e| JsValue::from_str(&format!("aabb_a 解析失败: {e}")))?;
    let b: crate::algo::geometry::bbox::AABB2D = serde_json::from_str(b_json)
      .map_err(|e| JsValue::from_str(&format!("aabb_b 解析失败: {e}")))?;
    Ok(a.intersects(b))
  }

  pub fn algo_obb_intersects(&self, a_json: &str, b_json: &str) -> Result<bool, JsValue> {
    let a: crate::algo::geometry::bbox::OBB2D = serde_json::from_str(a_json)
      .map_err(|e| JsValue::from_str(&format!("obb_a 解析失败: {e}")))?;
    let b: crate::algo::geometry::bbox::OBB2D = serde_json::from_str(b_json)
      .map_err(|e| JsValue::from_str(&format!("obb_b 解析失败: {e}")))?;
    Ok(a.intersects(b))
  }

  // ── 算法：图 ──

  pub fn algo_dijkstra_path(&self, graph_json: &str, source: &str, target: &str) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let result = crate::algo::graph::pathfind::dijkstra_path(&graph, source, target);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_astar(&self, graph_json: &str, source: &str, target: &str, heuristic_json: &str) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let heuristic_map: std::collections::HashMap<String, f64> = serde_json::from_str(heuristic_json)
      .map_err(|e| JsValue::from_str(&format!("heuristic 解析失败: {e}")))?;
    let result = crate::algo::graph::pathfind::astar(&graph, source, target, |node| {
      heuristic_map.get(node).copied().unwrap_or(f64::INFINITY)
    });
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_topological_sort(&self, graph_json: &str) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let result = crate::algo::graph::topology::topological_sort(&graph);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_connected_components(&self, graph_json: &str) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let result = crate::algo::graph::topology::connected_components(&graph);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_tarjan_scc(&self, graph_json: &str) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let result = crate::algo::graph::topology::tarjan_scc(&graph);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_force_layout(&self, graph_json: &str, config_json: Option<String>) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let config: crate::algo::graph::layout::ForceLayoutConfig = config_json
      .as_deref()
      .and_then(|s| serde_json::from_str(s).ok())
      .unwrap_or_default();
    let result = crate::algo::graph::layout::force_directed_layout(&graph, &config);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_lww_new(&self, value: &str, node_id: &str) -> Result<String, JsValue> {
    let reg = crate::algo::collab::crdt::LWWRegister::new(value.to_string(), node_id.to_string());
    serde_json::to_string(&reg).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_lww_set(&self, register_json: &str, value: &str, timestamp: f64) -> Result<String, JsValue> {
    let mut reg: crate::algo::collab::crdt::LWWRegister<String> = serde_json::from_str(register_json)
      .map_err(|e| JsValue::from_str(&format!("register 解析失败: {e}")))?;
    reg.set(value.to_string(), timestamp as u64);
    serde_json::to_string(&reg).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_lww_merge(&self, register_json: &str, other_json: &str) -> Result<String, JsValue> {
    let mut reg: crate::algo::collab::crdt::LWWRegister<String> = serde_json::from_str(register_json)
      .map_err(|e| JsValue::from_str(&format!("register 解析失败: {e}")))?;
    let other: crate::algo::collab::crdt::LWWRegister<String> = serde_json::from_str(other_json)
      .map_err(|e| JsValue::from_str(&format!("other 解析失败: {e}")))?;
    reg.merge(&other);
    serde_json::to_string(&reg).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_orset_new(&self, node_id: &str) -> Result<String, JsValue> {
    let set = crate::algo::collab::crdt::ORSet::<String>::new(node_id.to_string());
    serde_json::to_string(&set).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_orset_add(&self, set_json: &str, element: &str) -> Result<String, JsValue> {
    let mut set: crate::algo::collab::crdt::ORSet<String> = serde_json::from_str(set_json)
      .map_err(|e| JsValue::from_str(&format!("set 解析失败: {e}")))?;
    set.add(element.to_string());
    serde_json::to_string(&set).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_orset_remove(&self, set_json: &str, element: &str) -> Result<String, JsValue> {
    let mut set: crate::algo::collab::crdt::ORSet<String> = serde_json::from_str(set_json)
      .map_err(|e| JsValue::from_str(&format!("set 解析失败: {e}")))?;
    set.remove(&element.to_string());
    serde_json::to_string(&set).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_orset_merge(&self, set_json: &str, other_json: &str) -> Result<String, JsValue> {
    let mut set: crate::algo::collab::crdt::ORSet<String> = serde_json::from_str(set_json)
      .map_err(|e| JsValue::from_str(&format!("set 解析失败: {e}")))?;
    let other: crate::algo::collab::crdt::ORSet<String> = serde_json::from_str(other_json)
      .map_err(|e| JsValue::from_str(&format!("other 解析失败: {e}")))?;
    set.merge(&other);
    serde_json::to_string(&set).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_orset_elements(&self, set_json: &str) -> Result<String, JsValue> {
    let set: crate::algo::collab::crdt::ORSet<String> = serde_json::from_str(set_json)
      .map_err(|e| JsValue::from_str(&format!("set 解析失败: {e}")))?;
    let elements: Vec<&String> = set.elements();
    serde_json::to_string(&elements).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_rga_new(&self, node_id: &str) -> Result<String, JsValue> {
    let rga = crate::algo::collab::crdt::RGA::new(node_id.to_string());
    serde_json::to_string(&rga).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_rga_insert(&self, rga_json: &str, index: usize, content: &str) -> Result<String, JsValue> {
    let mut rga: crate::algo::collab::crdt::RGA = serde_json::from_str(rga_json)
      .map_err(|e| JsValue::from_str(&format!("rga 解析失败: {e}")))?;
    let inserted_id = rga.insert(index, content.to_string());
    let result = serde_json::json!({
      "rga": rga,
      "insertedId": inserted_id,
    });
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_rga_delete(&self, rga_json: &str, id: &str) -> Result<String, JsValue> {
    let mut rga: crate::algo::collab::crdt::RGA = serde_json::from_str(rga_json)
      .map_err(|e| JsValue::from_str(&format!("rga 解析失败: {e}")))?;
    rga.delete(id);
    serde_json::to_string(&rga).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_rga_merge(&self, rga_json: &str, other_json: &str) -> Result<String, JsValue> {
    let mut rga: crate::algo::collab::crdt::RGA = serde_json::from_str(rga_json)
      .map_err(|e| JsValue::from_str(&format!("rga 解析失败: {e}")))?;
    let other: crate::algo::collab::crdt::RGA = serde_json::from_str(other_json)
      .map_err(|e| JsValue::from_str(&format!("other 解析失败: {e}")))?;
    rga.merge(&other);
    serde_json::to_string(&rga).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_rga_text(&self, rga_json: &str) -> Result<String, JsValue> {
    let rga: crate::algo::collab::crdt::RGA = serde_json::from_str(rga_json)
      .map_err(|e| JsValue::from_str(&format!("rga 解析失败: {e}")))?;
    Ok(rga.text())
  }

  pub fn algo_crdt_vc_compare(&self, clock_a_json: &str, clock_b_json: &str) -> Result<String, JsValue> {
    let a: crate::algo::collab::crdt::VectorClock = serde_json::from_str(clock_a_json)
      .map_err(|e| JsValue::from_str(&format!("clock_a 解析失败: {e}")))?;
    let b: crate::algo::collab::crdt::VectorClock = serde_json::from_str(clock_b_json)
      .map_err(|e| JsValue::from_str(&format!("clock_b 解析失败: {e}")))?;
    let result = serde_json::json!({
      "happensBefore": a.happens_before(&b),
      "isConcurrent": a.is_concurrent(&b),
    });
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_terrain_noise(&self, x: f64, y: f64, config_json: Option<String>) -> Result<f64, JsValue> {
    let config: crate::algo::terrain::terrain::NoiseConfig = config_json
      .as_deref()
      .and_then(|s| serde_json::from_str(s).ok())
      .unwrap_or_default();
    Ok(crate::algo::terrain::terrain::value_noise_2d(x, y, &config))
  }

  pub fn algo_terrain_heightmap_generate(
    &self,
    config_json: Option<String>,
    width: usize,
    height: usize,
    offset_x: f64,
    offset_y: f64,
  ) -> Result<String, JsValue> {
    let config: crate::algo::terrain::terrain::NoiseConfig = config_json
      .as_deref()
      .and_then(|s| serde_json::from_str(s).ok())
      .unwrap_or_default();
    let map = crate::algo::terrain::terrain::HeightMap::generate(&config, width, height, offset_x, offset_y);
    serde_json::to_string(&map).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_terrain_heightmap_slope(&self, heightmap_json: &str, x: usize, y: usize) -> Result<String, JsValue> {
    let map: crate::algo::terrain::terrain::HeightMap = serde_json::from_str(heightmap_json)
      .map_err(|e| JsValue::from_str(&format!("heightmap 解析失败: {e}")))?;
    let (dx, dy) = map.slope_at(x, y);
    let magnitude = map.slope_magnitude_at(x, y);
    let result = serde_json::json!({
      "dx": dx,
      "dy": dy,
      "magnitude": magnitude,
    });
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_terrain_heightmap_aspect(&self, heightmap_json: &str, x: usize, y: usize) -> Result<f64, JsValue> {
    let map: crate::algo::terrain::terrain::HeightMap = serde_json::from_str(heightmap_json)
      .map_err(|e| JsValue::from_str(&format!("heightmap 解析失败: {e}")))?;
    Ok(map.aspect_at(x, y))
  }

  pub fn algo_terrain_marching_squares(&self, heightmap_json: &str, levels_json: &str) -> Result<String, JsValue> {
    let map: crate::algo::terrain::terrain::HeightMap = serde_json::from_str(heightmap_json)
      .map_err(|e| JsValue::from_str(&format!("heightmap 解析失败: {e}")))?;
    let levels: Vec<f64> = serde_json::from_str(levels_json)
      .map_err(|e| JsValue::from_str(&format!("levels 解析失败: {e}")))?;
    let contours = crate::algo::terrain::terrain::marching_squares(&map, &levels);
    serde_json::to_string(&contours).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_constraint_solve(&self, system_json: &str, max_iterations: usize, tolerance: f64) -> Result<String, JsValue> {
    let mut system: crate::algo::draft::constraint::ConstraintSystem = serde_json::from_str(system_json)
      .map_err(|e| JsValue::from_str(&format!("system 解析失败: {e}")))?;
    let result = system.solve(max_iterations, tolerance);
    let output = serde_json::json!({
      "result": result,
      "system": system,
    });
    serde_json::to_string(&output).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_dxf_parse(&self, content: &str) -> Result<String, JsValue> {
    let result = crate::algo::draft::dxf_io::parse_dxf(content)
      .map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_dxf_generate(&self, entities_json: &str) -> Result<String, JsValue> {
    let entities: Vec<crate::algo::draft::dxf_io::DxfEntity> = serde_json::from_str(entities_json)
      .map_err(|e| JsValue::from_str(&format!("entities 解析失败: {e}")))?;
    crate::algo::draft::dxf_io::generate_dxf(&entities)
      .map_err(|e| JsValue::from_str(&e))
  }

  pub fn algo_dxf_extract_constraints(&self, system_json: &str) -> Result<String, JsValue> {
    let system: crate::algo::draft::constraint::ConstraintSystem = serde_json::from_str(system_json)
      .map_err(|e| JsValue::from_str(&format!("system 解析失败: {e}")))?;
    let constraints = crate::algo::draft::dxf_io::extract_horizontal_vertical_constraints(&system);
    serde_json::to_string(&constraints).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_polygon_boolean(&self, op: &str, a_json: &str, b_json: &str) -> Result<String, JsValue> {
    let boolean_op = match op {
      "union" => crate::algo::geometry::boolean::BooleanOp::Union,
      "intersection" => crate::algo::geometry::boolean::BooleanOp::Intersection,
      "difference" => crate::algo::geometry::boolean::BooleanOp::Difference,
      "xor" => crate::algo::geometry::boolean::BooleanOp::Xor,
      _ => return Err(JsValue::from_str("op must be union/intersection/difference/xor")),
    };
    let a: crate::algo::geometry::boolean::Polygon2DResult = serde_json::from_str(a_json)
      .map_err(|e| JsValue::from_str(&format!("polygon A 解析失败: {e}")))?;
    let b: crate::algo::geometry::boolean::Polygon2DResult = serde_json::from_str(b_json)
      .map_err(|e| JsValue::from_str(&format!("polygon B 解析失败: {e}")))?;
    let result = crate::algo::geometry::boolean::polygon_boolean_op(
      &boolean_op, &a.exterior, &a.interiors, &b.exterior, &b.interiors,
    );
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_polygon_offset(&self, polygon_json: &str, delta: f64) -> Result<String, JsValue> {
    let poly: crate::algo::geometry::boolean::Polygon2DResult = serde_json::from_str(polygon_json)
      .map_err(|e| JsValue::from_str(&format!("polygon 解析失败: {e}")))?;
    let result = crate::algo::geometry::boolean::polygon_offset(&poly.exterior, &poly.interiors, delta);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_polygon_simplify(&self, polygon_json: &str, epsilon: f64) -> Result<String, JsValue> {
    let poly: crate::algo::geometry::boolean::Polygon2DResult = serde_json::from_str(polygon_json)
      .map_err(|e| JsValue::from_str(&format!("polygon 解析失败: {e}")))?;
    let result = crate::algo::geometry::boolean::polygon_simplify(&poly.exterior, &poly.interiors, epsilon);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_line_length(&self, points_json: &str) -> Result<f64, JsValue> {
    let points: Vec<crate::algo::geometry::line::Point2D> = serde_json::from_str(points_json)
      .map_err(|e| JsValue::from_str(&format!("points 解析失败: {e}")))?;
    Ok(crate::algo::geometry::boolean::line_length(&points))
  }

  pub fn algo_pagerank(&self, graph_json: &str, damping: f64, max_iterations: usize, tolerance: f64) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let result = crate::algo::graph::community::pagerank(&graph, damping, max_iterations, tolerance);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_community_detection(&self, graph_json: &str) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let result = crate::algo::graph::community::louvain_communities(&graph);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_betweenness_centrality(&self, graph_json: &str) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let result = crate::algo::graph::community::betweenness_centrality(&graph);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_hydraulic_erosion(&self, heightmap_json: &str, config_json: Option<String>) -> Result<String, JsValue> {
    let mut map: crate::algo::terrain::terrain::HeightMap = serde_json::from_str(heightmap_json)
      .map_err(|e| JsValue::from_str(&format!("heightmap 解析失败: {e}")))?;
    let config: crate::algo::terrain::erosion::ErosionConfig = config_json
      .as_deref()
      .and_then(|s| serde_json::from_str(s).ok())
      .unwrap_or_default();
    crate::algo::terrain::erosion::hydraulic_erosion(&mut map, &config);
    serde_json::to_string(&map).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_viewshed(&self, heightmap_json: &str, observer_x: usize, observer_y: usize, observer_height: f64, radius: f64) -> Result<String, JsValue> {
    let map: crate::algo::terrain::terrain::HeightMap = serde_json::from_str(heightmap_json)
      .map_err(|e| JsValue::from_str(&format!("heightmap 解析失败: {e}")))?;
    let result = crate::algo::terrain::erosion::viewshed(&map, observer_x, observer_y, observer_height, radius);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }
}

#[wasm_bindgen]
pub struct RetrofitWasm {
  engine: crate::retrofit::RetrofitEngine,
}

#[wasm_bindgen]
impl RetrofitWasm {
  #[wasm_bindgen(constructor)]
  pub fn new() -> Self {
    Self { engine: crate::retrofit::RetrofitEngine::new() }
  }

  pub fn begin_session(&mut self, session_id: &str, catalog_json: &str) -> Result<(), JsValue> {
    let catalog: crate::retrofit::catalog::CapabilityCatalog =
      serde_json::from_str(catalog_json)
        .map_err(|e| JsValue::from_str(&format!("目录解析失败: {e}")))?;
    self.engine.begin_session(session_id, catalog).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn begin_session_permissive(&mut self, session_id: &str) -> Result<(), JsValue> {
    self
      .engine
      .begin_session(session_id, crate::retrofit::catalog::CapabilityCatalog::permissive())
      .map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn submit_intent(&mut self, intent_json: &str) -> Result<JsValue, JsValue> {
    let intent: crate::retrofit::intent::RetrofitIntent = serde_json::from_str(intent_json)
      .map_err(|e| JsValue::from_str(&format!("意图解析失败: {e}")))?;
    let report =
      self.engine.submit_intent(intent).map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&report).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn confirm_and_stage(&mut self) -> Result<JsValue, JsValue> {
    let intents = self.engine.confirm_and_stage().map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&intents).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn apply_next(&mut self, before_json: &str, after_json: &str) -> Result<JsValue, JsValue> {
    let before: serde_json::Value = serde_json::from_str(before_json)
      .map_err(|e| JsValue::from_str(&format!("before 解析失败: {e}")))?;
    let after: serde_json::Value = serde_json::from_str(after_json)
      .map_err(|e| JsValue::from_str(&format!("after 解析失败: {e}")))?;
    let result =
      self.engine.apply_next(before, after).map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn verify_and_accept(
    &mut self,
    entity_count: usize,
    relation_count: usize,
  ) -> Result<JsValue, JsValue> {
    let result = self
      .engine
      .verify_and_accept(entity_count, relation_count)
      .map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn request_repair(&mut self, message: &str) -> Result<(), JsValue> {
    self.engine.request_repair(message).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn redirect(&mut self, message: &str) -> Result<(), JsValue> {
    self.engine.redirect(message).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn rollback_last(&mut self) -> Result<JsValue, JsValue> {
    let result = self.engine.rollback_last().map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn abort(&mut self) -> Result<JsValue, JsValue> {
    let rolled = self.engine.abort().map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&rolled).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn session_phase(&self) -> Result<JsValue, JsValue> {
    let phase = self.engine.session().map(|s| s.phase);
    serde_wasm_bindgen::to_value(&phase).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn detect_conflicts(&self) -> Result<JsValue, JsValue> {
    let report = self.engine.detect_conflicts();
    serde_wasm_bindgen::to_value(&report).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn end_session(&mut self) -> bool {
    self.engine.end_session().is_some()
  }

  pub fn patch_diff(&self, before_json: &str, after_json: &str) -> Result<JsValue, JsValue> {
    let before: serde_json::Value = serde_json::from_str(before_json)
      .map_err(|e| JsValue::from_str(&format!("before 解析失败: {e}")))?;
    let after: serde_json::Value = serde_json::from_str(after_json)
      .map_err(|e| JsValue::from_str(&format!("after 解析失败: {e}")))?;
    let patch = crate::retrofit::patch::JsonPatchDiff::diff(&before, &after);
    let estimate = crate::retrofit::patch::JsonPatchDiff::estimate_token_saving(&before, &after);
    serde_wasm_bindgen::to_value(&serde_json::json!({
      "operations": patch.operations,
      "tokenEstimate": estimate,
    }))
    .map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn patch_apply(&self, doc_json: &str, patch_json: &str) -> Result<String, JsValue> {
    let doc: serde_json::Value = serde_json::from_str(doc_json)
      .map_err(|e| JsValue::from_str(&format!("doc 解析失败: {e}")))?;
    let patch: crate::retrofit::patch::JsonPatch = serde_json::from_str(patch_json)
      .map_err(|e| JsValue::from_str(&format!("patch 解析失败: {e}")))?;
    let result = patch.apply(&doc).map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  // ── 算法：几何 ──

  pub fn algo_segment_intersect(&self, seg1_json: &str, seg2_json: &str) -> Result<bool, JsValue> {
    let s1: crate::algo::geometry::line::Segment2D = serde_json::from_str(seg1_json)
      .map_err(|e| JsValue::from_str(&format!("seg1 解析失败: {e}")))?;
    let s2: crate::algo::geometry::line::Segment2D = serde_json::from_str(seg2_json)
      .map_err(|e| JsValue::from_str(&format!("seg2 解析失败: {e}")))?;
    Ok(s1.intersects(s2))
  }

  pub fn algo_find_all_intersections(&self, segments_json: &str) -> Result<String, JsValue> {
    let segments: Vec<crate::algo::geometry::line::Segment2D> = serde_json::from_str(segments_json)
      .map_err(|e| JsValue::from_str(&format!("segments 解析失败: {e}")))?;
    let results = crate::algo::geometry::line::find_all_intersections(&segments);
    serde_json::to_string(&results).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_point_in_polygon(&self, point_json: &str, vertices_json: &str) -> Result<bool, JsValue> {
    let point: crate::algo::geometry::line::Point2D = serde_json::from_str(point_json)
      .map_err(|e| JsValue::from_str(&format!("point 解析失败: {e}")))?;
    let vertices: Vec<crate::algo::geometry::line::Point2D> = serde_json::from_str(vertices_json)
      .map_err(|e| JsValue::from_str(&format!("vertices 解析失败: {e}")))?;
    Ok(crate::algo::geometry::polygon::point_in_polygon(point, &vertices))
  }

  pub fn algo_polygon_area(&self, vertices_json: &str) -> Result<f64, JsValue> {
    let poly: crate::algo::geometry::polygon::Polygon2D = serde_json::from_str(vertices_json)
      .map_err(|e| JsValue::from_str(&format!("polygon 解析失败: {e}")))?;
    Ok(poly.area())
  }

  pub fn algo_polygon_centroid(&self, vertices_json: &str) -> Result<JsValue, JsValue> {
    let poly: crate::algo::geometry::polygon::Polygon2D = serde_json::from_str(vertices_json)
      .map_err(|e| JsValue::from_str(&format!("polygon 解析失败: {e}")))?;
    serde_wasm_bindgen::to_value(&poly.centroid()).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_convex_hull(&self, points_json: &str) -> Result<String, JsValue> {
    let points: Vec<crate::algo::geometry::line::Point2D> = serde_json::from_str(points_json)
      .map_err(|e| JsValue::from_str(&format!("points 解析失败: {e}")))?;
    let hull = crate::algo::geometry::polygon::convex_hull(&points);
    serde_json::to_string(&hull).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_aabb_intersects(&self, a_json: &str, b_json: &str) -> Result<bool, JsValue> {
    let a: crate::algo::geometry::bbox::AABB2D = serde_json::from_str(a_json)
      .map_err(|e| JsValue::from_str(&format!("aabb_a 解析失败: {e}")))?;
    let b: crate::algo::geometry::bbox::AABB2D = serde_json::from_str(b_json)
      .map_err(|e| JsValue::from_str(&format!("aabb_b 解析失败: {e}")))?;
    Ok(a.intersects(b))
  }

  pub fn algo_obb_intersects(&self, a_json: &str, b_json: &str) -> Result<bool, JsValue> {
    let a: crate::algo::geometry::bbox::OBB2D = serde_json::from_str(a_json)
      .map_err(|e| JsValue::from_str(&format!("obb_a 解析失败: {e}")))?;
    let b: crate::algo::geometry::bbox::OBB2D = serde_json::from_str(b_json)
      .map_err(|e| JsValue::from_str(&format!("obb_b 解析失败: {e}")))?;
    Ok(a.intersects(b))
  }

  // ── 算法：图 ──

  pub fn algo_dijkstra(&self, graph_json: &str, source: &str) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let result = crate::algo::graph::pathfind::dijkstra(&graph, source);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_dijkstra_path(&self, graph_json: &str, source: &str, target: &str) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let result = crate::algo::graph::pathfind::dijkstra_path(&graph, source, target);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_astar(&self, graph_json: &str, source: &str, target: &str, heuristic_json: &str) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let heuristic_map: std::collections::HashMap<String, f64> = serde_json::from_str(heuristic_json)
      .map_err(|e| JsValue::from_str(&format!("heuristic 解析失败: {e}")))?;
    let result = crate::algo::graph::pathfind::astar(&graph, source, target, |node| {
      heuristic_map.get(node).copied().unwrap_or(f64::INFINITY)
    });
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_k_shortest_paths(&self, graph_json: &str, source: &str, target: &str, k: usize) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let result = crate::algo::graph::pathfind::k_shortest_paths(&graph, source, target, k);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_topological_sort(&self, graph_json: &str) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let result = crate::algo::graph::topology::topological_sort(&graph);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_connected_components(&self, graph_json: &str) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let result = crate::algo::graph::topology::connected_components(&graph);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_tarjan_scc(&self, graph_json: &str) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let result = crate::algo::graph::topology::tarjan_scc(&graph);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_find_dangling(&self, graph_json: &str) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let result = crate::algo::graph::topology::find_dangling_references(&graph);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_force_layout(&self, graph_json: &str, config_json: Option<String>) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let config: crate::algo::graph::layout::ForceLayoutConfig = config_json
      .as_deref()
      .and_then(|s| serde_json::from_str(s).ok())
      .unwrap_or_default();
    let result = crate::algo::graph::layout::force_directed_layout(&graph, &config);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_lww_new(&self, value: &str, node_id: &str) -> Result<String, JsValue> {
    let reg = crate::algo::collab::crdt::LWWRegister::new(value.to_string(), node_id.to_string());
    serde_json::to_string(&reg).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_lww_set(&self, register_json: &str, value: &str, timestamp: f64) -> Result<String, JsValue> {
    let mut reg: crate::algo::collab::crdt::LWWRegister<String> = serde_json::from_str(register_json)
      .map_err(|e| JsValue::from_str(&format!("register 解析失败: {e}")))?;
    reg.set(value.to_string(), timestamp as u64);
    serde_json::to_string(&reg).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_lww_merge(&self, register_json: &str, other_json: &str) -> Result<String, JsValue> {
    let mut reg: crate::algo::collab::crdt::LWWRegister<String> = serde_json::from_str(register_json)
      .map_err(|e| JsValue::from_str(&format!("register 解析失败: {e}")))?;
    let other: crate::algo::collab::crdt::LWWRegister<String> = serde_json::from_str(other_json)
      .map_err(|e| JsValue::from_str(&format!("other 解析失败: {e}")))?;
    reg.merge(&other);
    serde_json::to_string(&reg).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_orset_new(&self, node_id: &str) -> Result<String, JsValue> {
    let set = crate::algo::collab::crdt::ORSet::<String>::new(node_id.to_string());
    serde_json::to_string(&set).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_orset_add(&self, set_json: &str, element: &str) -> Result<String, JsValue> {
    let mut set: crate::algo::collab::crdt::ORSet<String> = serde_json::from_str(set_json)
      .map_err(|e| JsValue::from_str(&format!("set 解析失败: {e}")))?;
    set.add(element.to_string());
    serde_json::to_string(&set).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_orset_remove(&self, set_json: &str, element: &str) -> Result<String, JsValue> {
    let mut set: crate::algo::collab::crdt::ORSet<String> = serde_json::from_str(set_json)
      .map_err(|e| JsValue::from_str(&format!("set 解析失败: {e}")))?;
    set.remove(&element.to_string());
    serde_json::to_string(&set).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_orset_merge(&self, set_json: &str, other_json: &str) -> Result<String, JsValue> {
    let mut set: crate::algo::collab::crdt::ORSet<String> = serde_json::from_str(set_json)
      .map_err(|e| JsValue::from_str(&format!("set 解析失败: {e}")))?;
    let other: crate::algo::collab::crdt::ORSet<String> = serde_json::from_str(other_json)
      .map_err(|e| JsValue::from_str(&format!("other 解析失败: {e}")))?;
    set.merge(&other);
    serde_json::to_string(&set).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_orset_elements(&self, set_json: &str) -> Result<String, JsValue> {
    let set: crate::algo::collab::crdt::ORSet<String> = serde_json::from_str(set_json)
      .map_err(|e| JsValue::from_str(&format!("set 解析失败: {e}")))?;
    let elements: Vec<&String> = set.elements();
    serde_json::to_string(&elements).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_rga_new(&self, node_id: &str) -> Result<String, JsValue> {
    let rga = crate::algo::collab::crdt::RGA::new(node_id.to_string());
    serde_json::to_string(&rga).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_rga_insert(&self, rga_json: &str, index: usize, content: &str) -> Result<String, JsValue> {
    let mut rga: crate::algo::collab::crdt::RGA = serde_json::from_str(rga_json)
      .map_err(|e| JsValue::from_str(&format!("rga 解析失败: {e}")))?;
    let inserted_id = rga.insert(index, content.to_string());
    let result = serde_json::json!({
      "rga": rga,
      "insertedId": inserted_id,
    });
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_rga_delete(&self, rga_json: &str, id: &str) -> Result<String, JsValue> {
    let mut rga: crate::algo::collab::crdt::RGA = serde_json::from_str(rga_json)
      .map_err(|e| JsValue::from_str(&format!("rga 解析失败: {e}")))?;
    rga.delete(id);
    serde_json::to_string(&rga).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_rga_merge(&self, rga_json: &str, other_json: &str) -> Result<String, JsValue> {
    let mut rga: crate::algo::collab::crdt::RGA = serde_json::from_str(rga_json)
      .map_err(|e| JsValue::from_str(&format!("rga 解析失败: {e}")))?;
    let other: crate::algo::collab::crdt::RGA = serde_json::from_str(other_json)
      .map_err(|e| JsValue::from_str(&format!("other 解析失败: {e}")))?;
    rga.merge(&other);
    serde_json::to_string(&rga).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_crdt_rga_text(&self, rga_json: &str) -> Result<String, JsValue> {
    let rga: crate::algo::collab::crdt::RGA = serde_json::from_str(rga_json)
      .map_err(|e| JsValue::from_str(&format!("rga 解析失败: {e}")))?;
    Ok(rga.text())
  }

  pub fn algo_crdt_vc_compare(&self, clock_a_json: &str, clock_b_json: &str) -> Result<String, JsValue> {
    let a: crate::algo::collab::crdt::VectorClock = serde_json::from_str(clock_a_json)
      .map_err(|e| JsValue::from_str(&format!("clock_a 解析失败: {e}")))?;
    let b: crate::algo::collab::crdt::VectorClock = serde_json::from_str(clock_b_json)
      .map_err(|e| JsValue::from_str(&format!("clock_b 解析失败: {e}")))?;
    let result = serde_json::json!({
      "happensBefore": a.happens_before(&b),
      "isConcurrent": a.is_concurrent(&b),
    });
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_terrain_noise(&self, x: f64, y: f64, config_json: Option<String>) -> Result<f64, JsValue> {
    let config: crate::algo::terrain::terrain::NoiseConfig = config_json
      .as_deref()
      .and_then(|s| serde_json::from_str(s).ok())
      .unwrap_or_default();
    Ok(crate::algo::terrain::terrain::value_noise_2d(x, y, &config))
  }

  pub fn algo_terrain_heightmap_generate(
    &self,
    config_json: Option<String>,
    width: usize,
    height: usize,
    offset_x: f64,
    offset_y: f64,
  ) -> Result<String, JsValue> {
    let config: crate::algo::terrain::terrain::NoiseConfig = config_json
      .as_deref()
      .and_then(|s| serde_json::from_str(s).ok())
      .unwrap_or_default();
    let map = crate::algo::terrain::terrain::HeightMap::generate(&config, width, height, offset_x, offset_y);
    serde_json::to_string(&map).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_terrain_heightmap_slope(&self, heightmap_json: &str, x: usize, y: usize) -> Result<String, JsValue> {
    let map: crate::algo::terrain::terrain::HeightMap = serde_json::from_str(heightmap_json)
      .map_err(|e| JsValue::from_str(&format!("heightmap 解析失败: {e}")))?;
    let (dx, dy) = map.slope_at(x, y);
    let magnitude = map.slope_magnitude_at(x, y);
    let result = serde_json::json!({
      "dx": dx,
      "dy": dy,
      "magnitude": magnitude,
    });
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_terrain_heightmap_aspect(&self, heightmap_json: &str, x: usize, y: usize) -> Result<f64, JsValue> {
    let map: crate::algo::terrain::terrain::HeightMap = serde_json::from_str(heightmap_json)
      .map_err(|e| JsValue::from_str(&format!("heightmap 解析失败: {e}")))?;
    Ok(map.aspect_at(x, y))
  }

  pub fn algo_terrain_marching_squares(&self, heightmap_json: &str, levels_json: &str) -> Result<String, JsValue> {
    let map: crate::algo::terrain::terrain::HeightMap = serde_json::from_str(heightmap_json)
      .map_err(|e| JsValue::from_str(&format!("heightmap 解析失败: {e}")))?;
    let levels: Vec<f64> = serde_json::from_str(levels_json)
      .map_err(|e| JsValue::from_str(&format!("levels 解析失败: {e}")))?;
    let contours = crate::algo::terrain::terrain::marching_squares(&map, &levels);
    serde_json::to_string(&contours).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_constraint_solve(&self, system_json: &str, max_iterations: usize, tolerance: f64) -> Result<String, JsValue> {
    let mut system: crate::algo::draft::constraint::ConstraintSystem = serde_json::from_str(system_json)
      .map_err(|e| JsValue::from_str(&format!("system 解析失败: {e}")))?;
    let result = system.solve(max_iterations, tolerance);
    let output = serde_json::json!({
      "result": result,
      "system": system,
    });
    serde_json::to_string(&output).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_dxf_parse(&self, content: &str) -> Result<String, JsValue> {
    let result = crate::algo::draft::dxf_io::parse_dxf(content)
      .map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_dxf_generate(&self, entities_json: &str) -> Result<String, JsValue> {
    let entities: Vec<crate::algo::draft::dxf_io::DxfEntity> = serde_json::from_str(entities_json)
      .map_err(|e| JsValue::from_str(&format!("entities 解析失败: {e}")))?;
    crate::algo::draft::dxf_io::generate_dxf(&entities)
      .map_err(|e| JsValue::from_str(&e))
  }

  pub fn algo_dxf_extract_constraints(&self, system_json: &str) -> Result<String, JsValue> {
    let system: crate::algo::draft::constraint::ConstraintSystem = serde_json::from_str(system_json)
      .map_err(|e| JsValue::from_str(&format!("system 解析失败: {e}")))?;
    let constraints = crate::algo::draft::dxf_io::extract_horizontal_vertical_constraints(&system);
    serde_json::to_string(&constraints).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_polygon_boolean(&self, op: &str, a_json: &str, b_json: &str) -> Result<String, JsValue> {
    let boolean_op = match op {
      "union" => crate::algo::geometry::boolean::BooleanOp::Union,
      "intersection" => crate::algo::geometry::boolean::BooleanOp::Intersection,
      "difference" => crate::algo::geometry::boolean::BooleanOp::Difference,
      "xor" => crate::algo::geometry::boolean::BooleanOp::Xor,
      _ => return Err(JsValue::from_str("op must be union/intersection/difference/xor")),
    };
    let a: crate::algo::geometry::boolean::Polygon2DResult = serde_json::from_str(a_json)
      .map_err(|e| JsValue::from_str(&format!("polygon A 解析失败: {e}")))?;
    let b: crate::algo::geometry::boolean::Polygon2DResult = serde_json::from_str(b_json)
      .map_err(|e| JsValue::from_str(&format!("polygon B 解析失败: {e}")))?;
    let result = crate::algo::geometry::boolean::polygon_boolean_op(
      &boolean_op, &a.exterior, &a.interiors, &b.exterior, &b.interiors,
    );
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_polygon_offset(&self, polygon_json: &str, delta: f64) -> Result<String, JsValue> {
    let poly: crate::algo::geometry::boolean::Polygon2DResult = serde_json::from_str(polygon_json)
      .map_err(|e| JsValue::from_str(&format!("polygon 解析失败: {e}")))?;
    let result = crate::algo::geometry::boolean::polygon_offset(&poly.exterior, &poly.interiors, delta);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_polygon_simplify(&self, polygon_json: &str, epsilon: f64) -> Result<String, JsValue> {
    let poly: crate::algo::geometry::boolean::Polygon2DResult = serde_json::from_str(polygon_json)
      .map_err(|e| JsValue::from_str(&format!("polygon 解析失败: {e}")))?;
    let result = crate::algo::geometry::boolean::polygon_simplify(&poly.exterior, &poly.interiors, epsilon);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_line_length(&self, points_json: &str) -> Result<f64, JsValue> {
    let points: Vec<crate::algo::geometry::line::Point2D> = serde_json::from_str(points_json)
      .map_err(|e| JsValue::from_str(&format!("points 解析失败: {e}")))?;
    Ok(crate::algo::geometry::boolean::line_length(&points))
  }

  pub fn algo_pagerank(&self, graph_json: &str, damping: f64, max_iterations: usize, tolerance: f64) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let result = crate::algo::graph::community::pagerank(&graph, damping, max_iterations, tolerance);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_community_detection(&self, graph_json: &str) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let result = crate::algo::graph::community::louvain_communities(&graph);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_betweenness_centrality(&self, graph_json: &str) -> Result<String, JsValue> {
    let graph: crate::algo::graph::pathfind::WeightedGraph = serde_json::from_str(graph_json)
      .map_err(|e| JsValue::from_str(&format!("graph 解析失败: {e}")))?;
    let result = crate::algo::graph::community::betweenness_centrality(&graph);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_hydraulic_erosion(&self, heightmap_json: &str, config_json: Option<String>) -> Result<String, JsValue> {
    let mut map: crate::algo::terrain::terrain::HeightMap = serde_json::from_str(heightmap_json)
      .map_err(|e| JsValue::from_str(&format!("heightmap 解析失败: {e}")))?;
    let config: crate::algo::terrain::erosion::ErosionConfig = config_json
      .as_deref()
      .and_then(|s| serde_json::from_str(s).ok())
      .unwrap_or_default();
    crate::algo::terrain::erosion::hydraulic_erosion(&mut map, &config);
    serde_json::to_string(&map).map_err(|e| JsValue::from_str(&e.to_string()))
  }

  pub fn algo_viewshed(&self, heightmap_json: &str, observer_x: usize, observer_y: usize, observer_height: f64, radius: f64) -> Result<String, JsValue> {
    let map: crate::algo::terrain::terrain::HeightMap = serde_json::from_str(heightmap_json)
      .map_err(|e| JsValue::from_str(&format!("heightmap 解析失败: {e}")))?;
    let result = crate::algo::terrain::erosion::viewshed(&map, observer_x, observer_y, observer_height, radius);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
  }
}
