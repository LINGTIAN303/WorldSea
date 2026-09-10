/**
 * 本文件从 apps/web/src/core/ 迁入（Phase A 迁移计划：算法/校验复用 WASM）
 * 端分离：WASM 加载与 Worker 池（Tauri 端复用同一 WASM 核心）
 */

import type {
  SafetyReport,
  ConfirmResult,
  ApplyResult,
  RetrofitResult,
  SessionPhase,
  ConflictReport,
  PatchDiffResult,
  Point2D,
  Segment2D,
  WeightedGraph,
  ForceLayoutConfig,
} from './coreBackend'

export interface CoreValidationError {
  path: string
  message: string
  severity: 'error' | 'warning'
}

export interface CoreValidationReport {
  valid: boolean
  errors: CoreValidationError[]
}

export interface CoreDanglingRelation {
  relationId: string
  relationType: string
  missing: string
}

export interface CoreReferenceCheckResult {
  orphanEntities: string[]
  danglingRelations: CoreDanglingRelation[]
  orphanRelations: string[]
  duplicateEntityIds: string[]
  duplicateRelationIds: string[]
}

export interface CoreMigrationResult {
  fromVersion: number
  toVersion: number
  steps: string[]
  success: boolean
  error: string | null
}

export interface CoreTypeCount {
  type: string
  count: number
}

export interface CoreDiagnosticSummary {
  totalEntities: number
  totalRelations: number
  entityTypeDistribution: CoreTypeCount[]
  relationTypeDistribution: CoreTypeCount[]
  referenceCheck: CoreReferenceCheckResult
  validationErrors: number
  validationWarnings: number
}

export interface WorldSeaCoreAPI {
  validateEntity(entityJson: string, schemaJson?: string): CoreValidationReport
  validateEntities(entitiesJson: string, schemasJson?: string): CoreValidationReport
  validatePack(packJson: string): CoreValidationReport
  checkReferences(entitiesJson: string, relationsJson: string): CoreReferenceCheckResult
  migrate(packJson: string, fromVersion: number): { result: CoreMigrationResult; data: unknown }
  runDiagnostics(
    entitiesJson: string,
    relationsJson: string,
    schemasJson?: string,
  ): CoreDiagnosticSummary
  retrofitBeginSession(sessionId: string, catalogJson?: string): void
  retrofitSubmitIntent(intentJson: string): SafetyReport | null
  retrofitConfirmAndStage(): ConfirmResult | null
  retrofitApplyNext(beforeJson: string, afterJson: string): ApplyResult | null
  retrofitVerifyAndAccept(entityCount: number, relationCount: number): RetrofitResult | null
  retrofitRequestRepair(message: string): void
  retrofitRedirect(message: string): void
  retrofitRollbackLast(): string | null
  retrofitAbort(): string[]
  retrofitSessionPhase(): SessionPhase | null
  retrofitDetectConflicts(): ConflictReport | null
  retrofitEndSession(): boolean
  patchDiff(beforeJson: string, afterJson: string): PatchDiffResult | null
  patchApply(docJson: string, patchJson: string): string | null
  // 算法：几何
  algoSegmentIntersect(seg1: Segment2D, seg2: Segment2D): boolean
  algoFindAllIntersections(segments: Segment2D[]): string
  algoPointInPolygon(point: Point2D, vertices: Point2D[]): boolean
  algoPolygonArea(vertices: Point2D[]): number
  algoConvexHull(points: Point2D[]): string
  algoAabbIntersects(a: { min: Point2D; max: Point2D }, b: { min: Point2D; max: Point2D }): boolean
  algoObbIntersects(a: { center: Point2D; halfExtents: [number, number]; rotation: number }, b: { center: Point2D; halfExtents: [number, number]; rotation: number }): boolean
  // 算法：图
  algoDijkstraPath(graph: WeightedGraph, source: string, target: string): string
  algoAstar(graph: WeightedGraph, source: string, target: string, heuristic: Record<string, number>): string
  algoTopologicalSort(graph: WeightedGraph): string
  algoConnectedComponents(graph: WeightedGraph): string
  algoTarjanScc(graph: WeightedGraph): string
  algoForceLayout(graph: WeightedGraph, config?: ForceLayoutConfig): string
  algoCrdtLwwNew(value: string, nodeId: string): string
  algoCrdtLwwSet(registerJson: string, value: string, timestamp: number): string
  algoCrdtLwwMerge(registerJson: string, otherJson: string): string
  algoCrdtOrsetNew(nodeId: string): string
  algoCrdtOrsetAdd(setJson: string, element: string): string
  algoCrdtOrsetRemove(setJson: string, element: string): string
  algoCrdtOrsetMerge(setJson: string, otherJson: string): string
  algoCrdtOrsetElements(setJson: string): string
  algoCrdtRgaNew(nodeId: string): string
  algoCrdtRgaInsert(rgaJson: string, index: number, content: string): string
  algoCrdtRgaDelete(rgaJson: string, id: string): string
  algoCrdtRgaMerge(rgaJson: string, otherJson: string): string
  algoCrdtRgaText(rgaJson: string): string
  algoCrdtVcCompare(clockAJson: string, clockBJson: string): string
  algoTerrainNoise(x: number, y: number, configJson?: string): number
  algoTerrainHeightmapGenerate(configJson: string | undefined, width: number, height: number, offsetX: number, offsetY: number): string
  algoTerrainHeightmapSlope(heightmapJson: string, x: number, y: number): string
  algoTerrainHeightmapAspect(heightmapJson: string, x: number, y: number): number
  algoTerrainMarchingSquares(heightmapJson: string, levels: number[]): string
  algoConstraintSolve(systemJson: string, maxIterations: number, tolerance: number): string
  algoDxfParse(content: string): string
  algoDxfGenerate(entitiesJson: string): string
  algoDxfExtractConstraints(systemJson: string): string
  algoPolygonBoolean(op: string, aJson: string, bJson: string): string
  algoPolygonOffset(polygonJson: string, delta: number): string
  algoPolygonSimplify(polygonJson: string, epsilon: number): string
  algoLineLength(pointsJson: string): number
  algoPageRank(graphJson: string, damping: number, maxIterations: number, tolerance: number): string
  algoCommunityDetection(graphJson: string): string
  algoBetweennessCentrality(graphJson: string): string
  algoHydraulicErosion(heightmapJson: string, configJson: string | undefined): string
  algoViewshed(heightmapJson: string, observerX: number, observerY: number, observerHeight: number, radius: number): string
  algoChaikinSmooth(verticesJson: string, iterations: number): string
  algoFindSharedEdges(verticesAJson: string, verticesBJson: string, threshold: number): string
  algoFindLinePolygonIntersections(lineJson: string, polygonJson: string): string
  algoPolygonSplit(polygonJson: string, cuttingLineJson: string): string
  algoPolygonAugment(polygonJson: string, addingLineJson: string): string
}

import { ref } from 'vue'

let coreModule: { WorldSeaCore: new (...args: any[]) => Record<string, any> } | null = null
let coreLoadAttempted = false
let coreInstance: WorldSeaCoreAPI | null = null

/**
 * camelCase → snake_case 转换
 * Rust wasm-bindgen 默认导出 snake_case 方法名（如 validate_entity），
 * 前端接口约定 camelCase（如 validateEntity），用 Proxy 自动转发。
 */
function camelToSnake(name: string): string {
  // 已含下划线或特殊方法，直接返回
  if (name.includes('_') || name === 'constructor' || name === 'free') return name
  // camelCase → snake_case：大写字母前加下划线并转小写
  return name.replace(/[A-Z]/g, m => '_' + m.toLowerCase())
}

/**
 * 包装 WASM 实例：camelCase 调用自动转发到 snake_case 实际方法
 */
function wrapWasmInstance<T extends object>(raw: T): T {
  return new Proxy(raw, {
    get(target, prop, receiver) {
      // Symbol 属性（如 Symbol.dispose）直接透传，不转换
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver)
      const snakeName = camelToSnake(prop)
      const val = Reflect.get(target, snakeName, target)
      // 方法需绑定 this 到原始实例，避免丢失内部状态
      return typeof val === 'function' ? val.bind(target) : val
    },
  })
}

/** WASM 可用性响应式状态，UI 层可绑定 */
export const wasmAvailable = ref<boolean | null>(null) // null = 尚未检测

/** WASM 加载失败原因，用于 UI 提示 */
export const wasmLoadError = ref<string | null>(null)

/** 依赖 WASM 的功能列表，用于 UI 展示禁用提示 */
export const WASM_DEPENDENT_FEATURES: readonly string[] = [
  '地形生成',
  '约束求解',
  'DXF 导入/导出',
  '战术棋盘',
  '区域地图',
  '力导向布局',
  '图算法 (最短路径/社群检测/PageRank)',
  'CRDT 协同',
  '水力侵蚀模拟',
  '视域分析',
] as const

/** 已通知用户标记 — 避免重复弹出 toast */
let wasmFailureNotified = false

async function tryLoadCore(): Promise<WorldSeaCoreAPI | null> {
  if (coreInstance) return coreInstance
  if (coreLoadAttempted) return null
  coreLoadAttempted = true
  try {
    coreModule = await import('@worldsea/core')
    if (!coreModule?.WorldSeaCore) {
      const msg = 'WASM 模块缺少 WorldSeaCore 导出，可能构建不完整'
      console.warn('[WorldSeaCore]', msg)
      wasmAvailable.value = false
      wasmLoadError.value = msg
      notifyWasmFailure(msg)
      return null
    }
    // WASM 实例 + Proxy 包装：camelCase 调用自动转发到 snake_case 方法
    const rawInstance = new coreModule.WorldSeaCore()
    coreInstance = wrapWasmInstance(rawInstance) as unknown as WorldSeaCoreAPI
    if (typeof coreInstance.validateEntity !== 'function') {
      const msg = 'WASM 核心库版本不匹配，缺少 validateEntity 方法'
      console.warn('[WorldSeaCore]', msg)
      coreInstance = null
      wasmAvailable.value = false
      wasmLoadError.value = msg
      notifyWasmFailure(msg)
      return null
    }
    console.log('[WorldSeaCore] WASM 核心库加载成功')
    wasmAvailable.value = true
    wasmLoadError.value = null
    const { setWasmAvailable } = await import('./coreBackend')
    setWasmAvailable(true)
    return coreInstance
  } catch (e: any) {
    const msg = e?.message || String(e)
    console.warn('[WorldSeaCore] WASM 核心库不可用:', e)
    wasmAvailable.value = false
    wasmLoadError.value = msg
    notifyWasmFailure(msg)
    return null
  }
}

/** 通知用户 WASM 加载失败 — 延迟弹窗以等待 UI 就绪 */
function notifyWasmFailure(reason: string): void {
  if (wasmFailureNotified) return
  wasmFailureNotified = true

  // 延迟通知，确保 UI 框架已初始化
  setTimeout(() => {
    try {
      // 经 window 回调通知（由 Shell 注册），UI 库未就绪时仅控制台通知
      if (typeof window !== 'undefined' && window.__worldsea_notify_wasm_failure__) {
        ;window.__worldsea_notify_wasm_failure__(reason)
      }
    } catch {
      // UI 库未就绪，仅控制台通知
    }
    console.warn(
      `[WorldSeaCore] WASM 核心库加载失败: ${reason}\n` +
      `以下功能将不可用: ${WASM_DEPENDENT_FEATURES.join('、')}\n`,
    )
  }, 1000)
}

export async function getCore(): Promise<WorldSeaCoreAPI | null> {
  return tryLoadCore()
}

export function isCoreAvailable(): boolean {
  return coreInstance !== null
}

/**
 * 查询 WASM 可用性 — 触发一次检测（如尚未检测）
 * 返回 true 表示 WASM 可用，false 表示不可用，null 表示尚未完成检测
 */
export async function checkWasmAvailability(): Promise<boolean | null> {
  if (wasmAvailable.value !== null) return wasmAvailable.value
  await tryLoadCore()
  return wasmAvailable.value
}
