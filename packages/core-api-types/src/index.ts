// @worldsea/core-api-types — coreBackend 双端共享契约类型，见 docs/details/注释/packages/core-api-types/index.md

// ── core（Tauri 端独有 Core 前缀类型，web 端同源定义见 apps/web/src/core/worldseaCore.ts） ──

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

// ── storage/plugin（后端健康检查） ──

export interface StorageHealthReport {
  status: string
  entityCount: number
  relationCount: number
  kvCount: number
  moduleCount: number
  integrityOk: boolean
  issues: string[]
}

export interface ManifestValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export interface PluginHealthReport {
  totalPlugins: number
  activePlugins: number
  manifestIssues: Array<{ pluginId: string; errors: string[]; warnings: string[] }>
  permissionWarnings: string[]
  dependencyConflicts: string[]
}

// ── safety（安全改造） ──

export interface SafetyReport {
  allowed: boolean
  intentType: string
  warnings: string[]
  blockedReason: string | null
  preCheckPassed: boolean
  postCheckPassed: boolean | null
}

export interface ConflictEntry {
  intentIndexA: number
  intentIndexB: number
  conflictType: string
  description: string
}

export interface ConflictReport {
  hasConflicts: boolean
  conflicts: ConflictEntry[]
}

export interface ConfirmResult {
  confirmedCount: number
  conflicts: ConflictReport
}

export interface ExecutionResult {
  intentId: string
  success: boolean
  message: string
  sideEffects: string[]
}

export interface ApplyResult {
  changeId: string
  execution: ExecutionResult
}

export interface HealthCheckResult {
  healthy: boolean
  entityCount: number
  relationCount: number
  issues: string[]
}

// ── retrofit（安全改造工作流） ──

export interface RetrofitResult {
  sessionId: string
  phase: string
  changesApplied: number
  changesRolledBack: number
  healthCheck: HealthCheckResult | null
  executionResults: ExecutionResult[]
  message: string
}

export type SessionPhase =
  | 'negotiate'
  | 'staging'
  | 'applying'
  | 'verifying'
  | 'accept'
  | 'repair'
  | 'completed'
  | 'aborted'

export interface CapabilityCatalog {
  allowedViewIds: string[]
  allowedEntityTypes: string[]
  allowedRelationTypes: string[]
  allowedFieldModifications: string[]
  allowedActionTargets: string[]
  allowedCssProperties: string[]
  allowedLayoutTargets: string[]
  maxChangesPerSession: number
  requiresConfirmation: string[]
  forbidden: string[]
}

export interface PatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test'
  path: string
  value?: unknown
  from?: string
}

export interface PatchDiffResult {
  operations: PatchOperation[]
  tokenEstimate: {
    fullSendTokens: number
    patchTokens: number
    savedTokens: number
    savingRatio: number
    operationCount: number
  }
}

// ── schema（实体类型 Schema） ──

export interface FieldTypeSchema {
  key: string
  label: string
  fieldType: string
  required?: boolean
  defaultValue?: unknown
  options?: { value: string; label: string }[]
  placeholder?: string
  refType?: string
  autoLink?: { targetType: string; relationType: string; searchField?: string; createIfMissing?: boolean }
  animation?: { onChange?: { effect: string; durationMs: number; color?: string }; onState?: { condition: string; effect: string; persistent: boolean } }
}

export interface RelationTypeSchema {
  typeKey: string
  label: string
  sourceTypes: string[]
  targetTypes: string[]
  directed: boolean
}

export interface ViewDeclaration {
  viewType: 'list' | 'tree' | 'graph' | 'timeline' | 'grid'
  config?: Record<string, unknown>
  animation?: { durationMs: number; easing: string; staggerMs: number; enterEffect: string; exitEffect: string }
}

export interface ValidationRule {
  id: string
  description: string
  fieldKey: string
  ruleType: string
  params?: Record<string, unknown>
}

export interface EntityTypeSchema {
  typeKey: string
  label: string
  icon: string
  fields: FieldTypeSchema[]
  relations: RelationTypeSchema[]
  validations: ValidationRule[]
  views: ViewDeclaration[]
  iconMap: Record<string, string>
  idPrefix: string
  pluginId?: string
}

// ── algo（几何 / 图算法） ──

export interface Point2D {
  x: number
  y: number
}

export interface GraphEdge {
  target: string
  weight: number
  label?: string
}

export interface WeightedGraph {
  adjacency: Record<string, GraphEdge[]>
}

export interface PathResult {
  path: string[]
  totalCost: number
  found: boolean
}

export interface TopologicalSortResult {
  order: string[]
  hasCycle: boolean
  cycleNodes: string[]
}

export interface ConnectedComponentsResult {
  components: string[][]
  count: number
  largestSize: number
}

export interface StronglyConnectedResult {
  components: string[][]
  count: number
  hasCycles: boolean
}

export interface ForceLayoutConfig {
  repulsion?: number
  attraction?: number
  idealLength?: number
  damping?: number
  maxIterations?: number
  epsilon?: number
  area?: number
  gravity?: number
}

export interface LayoutNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
}

export interface ForceLayoutResult {
  nodes: LayoutNode[]
  iterations: number
  converged: boolean
  totalEnergy: number
}

export interface PageRankResult {
  scores: Record<string, number>
  iterations: number
  converged: boolean
}

export interface BetweennessResult {
  betweenness: Record<string, number>
}

export interface Polygon2DResult {
  exterior: Point2D[]
  interiors: Point2D[][]
}

export interface SharedEdge {
  edgeIdxA: number
  edgeIdxB: number
  distance: number
}

export interface LinePolygonIntersection {
  point: Point2D
  lineIdx: number
  edgeIdx: number
}

// ── spatial（空间索引） ──

export interface Segment2D {
  start: Point2D
  end: Point2D
}

export interface SpatialItem {
  id: string
  min: [number, number]
  max: [number, number]
  category: string
}

export interface PointItem {
  id: string
  coord: [number, number]
  category: string
}

// ── crdt（协同编辑数据结构） ──

export interface LWWRegister {
  value: string
  timestamp: number
  nodeId: string
}

export interface ORSet {
  added: Record<string, number>
  removed: string[]
  nodeId: string
  counter: number
}

export interface RGAInsertResult {
  rga: RGA
  insertedId: string
}

export interface RGA {
  nodes: Record<string, RGANode>
  nodeId: string
  counter: number
}

export interface RGANode {
  id: string
  leftId: string | null
  rightId: string | null
  content: string
  deleted: boolean
  timestamp: number
  nodeId: string
}

export interface VectorClock {
  counter: number
  nodeId: string
}

export interface VectorClockCompareResult {
  happensBefore: boolean
  isConcurrent: boolean
}

// ── constraint（几何约束求解） ──

export interface ConstraintPoint {
  id: string
  position: Point2D
  free: boolean
}

export interface ConstraintLine {
  id: string
  startId: string
  endId: string
}

export interface Constraint {
  id: string
  constraintType: ConstraintTypeValue
  priority: number
}

export type ConstraintTypeValue =
  | { fixedPoint: { pointId: string; position: Point2D } }
  | { horizontal: { lineId: string } }
  | { vertical: { lineId: string } }
  | { parallel: { lineIdA: string; lineIdB: string } }
  | { perpendicular: { lineIdA: string; lineIdB: string } }
  | { equalLength: { lineIdA: string; lineIdB: string } }
  | { distance: { pointIdA: string; pointIdB: string; distance: number } }
  | { angle: { lineIdA: string; lineIdB: string; angleDeg: number } }
  | { coincident: { pointIdA: string; pointIdB: string } }

export interface ConstraintSystem {
  points: ConstraintPoint[]
  lines: ConstraintLine[]
  constraints: Constraint[]
}

export interface SolveResult {
  solved: boolean
  iterations: number
  residual: number
  violations: string[]
}

export interface ConstraintSolveOutput {
  result: SolveResult
  system: ConstraintSystem
}

// ── dxf（CAD 文件解析/生成） ──

export interface DxfEntity {
  entityType: string
  layer: string
  data: DxfEntityData
}

export type DxfEntityData =
  | { line: { start: Point2D; end: Point2D } }
  | { circle: { center: Point2D; radius: number } }
  | { arc: { center: Point2D; radius: number; startAngleDeg: number; endAngleDeg: number } }
  | { lwPolyline: { vertices: Point2D[]; closed: boolean } }
  | { ellipse: { center: Point2D; majorAxisX: number; majorAxisY: number; ratio: number; startParam: number; endParam: number } }
  | { spline: { controlPoints: Point2D[]; degree: number } }
  | { text: { location: Point2D; value: string; height: number } }
  | { unknown: Record<string, never> }

export interface DxfImportResult {
  entities: DxfEntity[]
  constraintSystem: ConstraintSystem
  layerNames: string[]
  warnings: string[]
}

// ── terrain（地形生成） ──

export interface NoiseConfig {
  seed: number
  scale: number
  octaves: number
  persistence: number
  lacunarity: number
}

export interface HeightMap {
  width: number
  height: number
  data: number[]
}

export interface SlopeResult {
  dx: number
  dy: number
  magnitude: number
}

export interface ContourPoint {
  x: number
  y: number
}

export interface ContourLine {
  level: number
  points: ContourPoint[]
}

export interface ErosionConfig {
  iterations?: number
  inertia?: number
  capacityFactor?: number
  minSlope?: number
  erosionRate?: number
  depositionRate?: number
  evaporationRate?: number
  gravity?: number
  startWater?: number
  startSpeed?: number
  maxDropletLifetime?: number
}

export interface ViewshedResult {
  visible: boolean[]
  width: number
  height: number
}

// ── community（社区发现） ──

export interface Community {
  id: number
  members: string[]
}

export interface CommunityDetectionResult {
  communities: Community[]
  modularity: number
}
