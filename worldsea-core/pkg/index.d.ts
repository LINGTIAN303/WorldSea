/* tslint:disable */
/* eslint-disable */

export class RetrofitWasm {
    free(): void;
    [Symbol.dispose](): void;
    abort(): any;
    algo_aabb_intersects(a_json: string, b_json: string): boolean;
    algo_astar(graph_json: string, source: string, target: string, heuristic_json: string): string;
    algo_betweenness_centrality(graph_json: string): string;
    algo_community_detection(graph_json: string): string;
    algo_connected_components(graph_json: string): string;
    algo_constraint_solve(system_json: string, max_iterations: number, tolerance: number): string;
    algo_convex_hull(points_json: string): string;
    algo_crdt_lww_merge(register_json: string, other_json: string): string;
    algo_crdt_lww_new(value: string, node_id: string): string;
    algo_crdt_lww_set(register_json: string, value: string, timestamp: number): string;
    algo_crdt_orset_add(set_json: string, element: string): string;
    algo_crdt_orset_elements(set_json: string): string;
    algo_crdt_orset_merge(set_json: string, other_json: string): string;
    algo_crdt_orset_new(node_id: string): string;
    algo_crdt_orset_remove(set_json: string, element: string): string;
    algo_crdt_rga_delete(rga_json: string, id: string): string;
    algo_crdt_rga_insert(rga_json: string, index: number, content: string): string;
    algo_crdt_rga_merge(rga_json: string, other_json: string): string;
    algo_crdt_rga_new(node_id: string): string;
    algo_crdt_rga_text(rga_json: string): string;
    algo_crdt_vc_compare(clock_a_json: string, clock_b_json: string): string;
    algo_dijkstra(graph_json: string, source: string): string;
    algo_dijkstra_path(graph_json: string, source: string, target: string): string;
    algo_dxf_extract_constraints(system_json: string): string;
    algo_dxf_generate(entities_json: string): string;
    algo_dxf_parse(content: string): string;
    algo_find_all_intersections(segments_json: string): string;
    algo_find_dangling(graph_json: string): string;
    algo_force_layout(graph_json: string, config_json?: string | null): string;
    algo_hydraulic_erosion(heightmap_json: string, config_json?: string | null): string;
    algo_k_shortest_paths(graph_json: string, source: string, target: string, k: number): string;
    algo_line_length(points_json: string): number;
    algo_obb_intersects(a_json: string, b_json: string): boolean;
    algo_pagerank(graph_json: string, damping: number, max_iterations: number, tolerance: number): string;
    algo_point_in_polygon(point_json: string, vertices_json: string): boolean;
    algo_polygon_area(vertices_json: string): number;
    algo_polygon_boolean(op: string, a_json: string, b_json: string): string;
    algo_polygon_centroid(vertices_json: string): any;
    algo_polygon_offset(polygon_json: string, delta: number): string;
    algo_polygon_simplify(polygon_json: string, epsilon: number): string;
    algo_segment_intersect(seg1_json: string, seg2_json: string): boolean;
    algo_tarjan_scc(graph_json: string): string;
    algo_terrain_heightmap_aspect(heightmap_json: string, x: number, y: number): number;
    algo_terrain_heightmap_generate(config_json: string | null | undefined, width: number, height: number, offset_x: number, offset_y: number): string;
    algo_terrain_heightmap_slope(heightmap_json: string, x: number, y: number): string;
    algo_terrain_marching_squares(heightmap_json: string, levels_json: string): string;
    algo_terrain_noise(x: number, y: number, config_json?: string | null): number;
    algo_topological_sort(graph_json: string): string;
    algo_viewshed(heightmap_json: string, observer_x: number, observer_y: number, observer_height: number, radius: number): string;
    apply_next(before_json: string, after_json: string): any;
    begin_session(session_id: string, catalog_json: string): void;
    begin_session_permissive(session_id: string): void;
    confirm_and_stage(): any;
    detect_conflicts(): any;
    end_session(): boolean;
    constructor();
    patch_apply(doc_json: string, patch_json: string): string;
    patch_diff(before_json: string, after_json: string): any;
    redirect(message: string): void;
    request_repair(message: string): void;
    rollback_last(): any;
    session_phase(): any;
    submit_intent(intent_json: string): any;
    verify_and_accept(entity_count: number, relation_count: number): any;
}

/**
 * WorldSea 核心 WASM 绑定，提供验证、迁移和诊断功能的 WebAssembly 接口
 */
export class WorldSeaCore {
    free(): void;
    [Symbol.dispose](): void;
    algo_aabb_intersects(a_json: string, b_json: string): boolean;
    algo_astar(graph_json: string, source: string, target: string, heuristic_json: string): string;
    algo_betweenness_centrality(graph_json: string): string;
    algo_community_detection(graph_json: string): string;
    algo_connected_components(graph_json: string): string;
    algo_constraint_solve(system_json: string, max_iterations: number, tolerance: number): string;
    algo_convex_hull(points_json: string): string;
    algo_crdt_lww_merge(register_json: string, other_json: string): string;
    algo_crdt_lww_new(value: string, node_id: string): string;
    algo_crdt_lww_set(register_json: string, value: string, timestamp: number): string;
    algo_crdt_orset_add(set_json: string, element: string): string;
    algo_crdt_orset_elements(set_json: string): string;
    algo_crdt_orset_merge(set_json: string, other_json: string): string;
    algo_crdt_orset_new(node_id: string): string;
    algo_crdt_orset_remove(set_json: string, element: string): string;
    algo_crdt_rga_delete(rga_json: string, id: string): string;
    algo_crdt_rga_insert(rga_json: string, index: number, content: string): string;
    algo_crdt_rga_merge(rga_json: string, other_json: string): string;
    algo_crdt_rga_new(node_id: string): string;
    algo_crdt_rga_text(rga_json: string): string;
    algo_crdt_vc_compare(clock_a_json: string, clock_b_json: string): string;
    algo_dijkstra_path(graph_json: string, source: string, target: string): string;
    algo_dxf_extract_constraints(system_json: string): string;
    algo_dxf_generate(entities_json: string): string;
    algo_dxf_parse(content: string): string;
    algo_find_all_intersections(segments_json: string): string;
    algo_force_layout(graph_json: string, config_json?: string | null): string;
    algo_hydraulic_erosion(heightmap_json: string, config_json?: string | null): string;
    algo_line_length(points_json: string): number;
    algo_obb_intersects(a_json: string, b_json: string): boolean;
    algo_pagerank(graph_json: string, damping: number, max_iterations: number, tolerance: number): string;
    algo_point_in_polygon(point_json: string, vertices_json: string): boolean;
    algo_polygon_area(vertices_json: string): number;
    algo_polygon_boolean(op: string, a_json: string, b_json: string): string;
    algo_polygon_offset(polygon_json: string, delta: number): string;
    algo_polygon_simplify(polygon_json: string, epsilon: number): string;
    algo_segment_intersect(seg1_json: string, seg2_json: string): boolean;
    algo_tarjan_scc(graph_json: string): string;
    algo_terrain_heightmap_aspect(heightmap_json: string, x: number, y: number): number;
    algo_terrain_heightmap_generate(config_json: string | null | undefined, width: number, height: number, offset_x: number, offset_y: number): string;
    algo_terrain_heightmap_slope(heightmap_json: string, x: number, y: number): string;
    algo_terrain_marching_squares(heightmap_json: string, levels_json: string): string;
    algo_terrain_noise(x: number, y: number, config_json?: string | null): number;
    algo_topological_sort(graph_json: string): string;
    algo_viewshed(heightmap_json: string, observer_x: number, observer_y: number, observer_height: number, radius: number): string;
    check_plugin_health(manifests_json: string, active_ids_json: string): any;
    /**
     * 检查实体和关系之间的引用完整性
     *
     * 参数:
     * - `entities_json`: 实体列表的 JSON 字符串
     * - `relations_json`: 关系列表的 JSON 字符串
     *
     * 返回: 引用完整性验证报告的 JsValue，或解析失败的错误
     */
    check_references(entities_json: string, relations_json: string): any;
    /**
     * 将包数据从指定版本迁移到最新版本
     *
     * 参数:
     * - `pack_json`: 包数据的 JSON 字符串
     * - `from_version`: 当前包的版本号
     *
     * 返回: 包含迁移结果和更新后数据的 JsValue，或解析失败的错误
     */
    migrate(pack_json: string, from_version: number): any;
    /**
     * 创建 WorldSeaCore 实例
     */
    constructor();
    retrofit_abort(): any;
    retrofit_apply_next(before_json: string, after_json: string): any;
    retrofit_begin_session(session_id: string, catalog_json?: string | null): void;
    retrofit_confirm_and_stage(): any;
    retrofit_detect_conflicts(): any;
    retrofit_end_session(): boolean;
    retrofit_redirect(message: string): void;
    retrofit_request_repair(message: string): void;
    retrofit_rollback_last(): any;
    retrofit_session_phase(): any;
    retrofit_submit_intent(intent_json: string): any;
    retrofit_verify_and_accept(entity_count: number, relation_count: number): any;
    /**
     * 对世界数据执行全面诊断
     *
     * 参数:
     * - `entities_json`: 实体列表的 JSON 字符串
     * - `relations_json`: 关系列表的 JSON 字符串
     * - `schemas_json`: 可选的实体类型 Schema 列表 JSON 字符串
     *
     * 返回: 诊断摘要的 JsValue，或解析失败的错误
     */
    run_diagnostics(entities_json: string, relations_json: string, schemas_json?: string | null): any;
    /**
     * 批量验证多个实体的合法性
     *
     * 参数:
     * - `entities_json`: 实体列表的 JSON 字符串
     * - `schemas_json`: 可选的实体类型 Schema 列表 JSON 字符串
     *
     * 返回: 合并后的验证报告 JsValue，或解析失败的错误
     */
    validate_entities(entities_json: string, schemas_json?: string | null): any;
    /**
     * 验证单个实体的合法性
     *
     * 参数:
     * - `entity_json`: 实体的 JSON 字符串
     * - `schema_json`: 可选的实体类型 Schema JSON 字符串
     *
     * 返回: 验证报告的 JsValue，或解析失败的错误
     */
    validate_entity(entity_json: string, schema_json?: string | null): any;
    /**
     * 验证包数据的合法性
     *
     * 参数:
     * - `pack_json`: 包数据的 JSON 字符串
     *
     * 返回: 验证报告的 JsValue，或解析失败的错误
     */
    validate_pack(pack_json: string): any;
    validate_plugin_manifest(manifest_json: string): any;
    /**
     * 验证单个关系的合法性
     *
     * 参数:
     * - `relation_json`: 关系的 JSON 字符串
     * - `schema_json`: 可选的关系类型 Schema JSON 字符串
     *
     * 返回: 验证报告的 JsValue，或解析失败的错误
     */
    validate_relation(relation_json: string, schema_json?: string | null): any;
}
