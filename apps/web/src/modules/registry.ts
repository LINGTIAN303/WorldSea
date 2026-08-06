/** modules 注册表：Web 端迁移版核心调度器（激活/依赖解析/扩展注册），详细见 docs/details/注释/web/modules/registry.md */

import { entitySchemaRegistry, relationSchemaRegistry, pluginAPI } from '@worldsmith/entity-core'
import { moduleStore } from './store'
import type {
  ModuleInstance,
  ModuleManifest,
  FieldExtension,
  ViewExtension,
} from './types'
import type { EntityTypeSchema, FieldSchema, RelationTypeSchema } from '@worldsmith/entity-core'

/* ════════════════════════════════════════
   扩展注册表
   ════════════════════════════════════════ */

/** 已注册的字段类型扩展 */
const fieldExtensions = new Map<string, FieldExtension>()

/** 已注册的视图类型扩展 */
const viewExtensions = new Map<string, ViewExtension>()

function registerFieldExtension(ext: FieldExtension) {
  fieldExtensions.set(ext.id, ext)
}

function registerViewExtension(ext: ViewExtension) {
  viewExtensions.set(ext.id, ext)
}

function getFieldExtension(typeId: string): FieldExtension | undefined {
  for (const ext of fieldExtensions.values()) {
    if (ext.typeId === typeId) return ext
  }
  return undefined
}

function getViewExtension(typeId: string): ViewExtension | undefined {
  for (const ext of viewExtensions.values()) {
    if (ext.typeId === typeId) return ext
  }
  return undefined
}

function getAllFieldExtensions(): FieldExtension[] {
  return Array.from(fieldExtensions.values())
}

function getAllViewExtensions(): ViewExtension[] {
  return Array.from(viewExtensions.values())
}

/* ════════════════════════════════════════
   字段/视图类型检查
   ════════════════════════════════════════ */

const BUILTIN_FIELD_TYPES = new Set([
  'text', 'textarea', 'number', 'boolean', 'date', 'datetime', 'time',
  'select', 'multi-select', 'image', 'url', 'email', 'color',
  'rich-text', 'markdown', 'rating', 'slider', 'entity-ref', 'entity-refs',
])

const BUILTIN_VIEW_TYPES = new Set(['list', 'grid', 'table'])

function isKnownFieldType(type: string): boolean {
  return BUILTIN_FIELD_TYPES.has(type) || getFieldExtension(type) !== undefined
}

function isKnownViewType(type: string): boolean {
  return BUILTIN_VIEW_TYPES.has(type) || getViewExtension(type) !== undefined
}

/* ════════════════════════════════════════
   模块激活/停用
   ════════════════════════════════════════ */

/**
 * 将 ModuleField 映射为 EntityTypeSchema 的 FieldSchema
 * 保留尽可能多的类型信息
 */
function toFieldSchema(f: any): FieldSchema {
  const typeMap: Record<string, FieldSchema['fieldType']> = {
    'text': 'text', 'textarea': 'textarea', 'number': 'text',
    'boolean': 'boolean', 'date': 'date',
    'select': 'select',
    'image': 'image', 'url': 'text', 'email': 'text', 'color': 'text',
    'rich-text': 'textarea', 'markdown': 'textarea',
    'rating': 'text', 'slider': 'text',
    'entity-ref': 'text', 'entity-refs': 'text',
    'formula': 'text', 'computed': 'text', 'template': 'textarea', 'location': 'text', 'file': 'text',
  }
  return {
    key: f.key,
    label: f.label,
    fieldType: typeMap[f.type] || 'text',
    required: f.required,
    defaultValue: f.defaultValue,
    options: f.options?.map((o: string) => ({ value: o, label: o })),
  }
}

async function activateModule(instance: ModuleInstance): Promise<void> {
  const mod = instance.manifest

  // 1. 注册实体类型到全局 Schema
  for (const et of mod.entityTypes) {
    const schema: EntityTypeSchema = {
      typeKey: et.name,
      label: et.label,
      icon: et.icon,
      fields: et.fields.map(toFieldSchema),
      pluginId: mod.id,
    }
    entitySchemaRegistry.register(schema)
  }

  // 2. 注册关系类型
  for (const rt of mod.relationTypes) {
    const schema: RelationTypeSchema = {
      typeKey: rt.name,
      label: rt.label,
      sourceTypes: rt.sourceTypes,
      targetTypes: rt.targetTypes,
      directed: rt.directed,
      properties: rt.properties.map(toFieldSchema),
      pluginId: mod.id,
    }
    relationSchemaRegistry.register(schema)
  }

  // 3. 注册视图
  for (const v of mod.views) {
    pluginAPI.registerView({
      id: v.id,
      label: v.label,
      icon: v.icon,
      component: null as any, // 运行时由 DynamicEntityView 渲染
      _moduleId: mod.id,
      _viewConfig: v,
    })
  }

  // 4. 更新数据库中模块状态
  if (!instance.active) {
    await moduleStore.setActive(instance.id, true)
  }
}

async function deactivateModule(instance: ModuleInstance): Promise<void> {
  const mod = instance.manifest

  // 1. 注销实体类型
  for (const et of mod.entityTypes) {
    entitySchemaRegistry.unregister(et.name)
  }

  // 2. 注销关系类型
  for (const rt of mod.relationTypes) {
    relationSchemaRegistry.unregister(rt.name)
  }

  // 更新模块状态
  await moduleStore.setActive(instance.id, false)
}

/* ════════════════════════════════════════
   依赖解析
   ════════════════════════════════════════ */

interface DepNode {
  id: string
  instance: ModuleInstance
  deps: string[]
}

/* ─── 简易 semver 兼容性检查 ─── */

/**
 * 解析 semver 字符串为 [major, minor, patch]
 * 不严格要求完整格式，允许 "1"、"1.2"、"1.2.3"
 */
function parseSemver(v: string): [number, number, number] | null {
  const m = v.replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!m) return null
  return [Number(m[1]), m[2] !== undefined ? Number(m[2]) : 0, m[3] !== undefined ? Number(m[3]) : 0]
}

/**
 * 检查 installed 版本是否满足 required 版本约束
 * 支持：">=1.0.0"、"^1.2"、">2.0.0 <3.0.0"、"1.x"、"2.3.x" 等常见模式
 * 对于无操作符前缀的版本，默认检查 major 版本匹配
 */
function isVersionCompatible(required: string, installed: string): boolean {
  const installedVer = parseSemver(installed)
  if (!installedVer) return true // 无法解析安装版本时跳过检查

  const requiredTrimmed = required.trim()

  // 多约束（空格分隔），如 ">2.0.0 <3.0.0"
  if (/\s/.test(requiredTrimmed)) {
    return requiredTrimmed.split(/\s+/).every(constraint =>
      isVersionCompatible(constraint, installed),
    )
  }

  // ^1.2.3 — 兼容版本（同 major）
  const caretMatch = requiredTrimmed.match(/^\^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/)
  if (caretMatch) {
    const reqMajor = Number(caretMatch[1])
    const reqMinor = caretMatch[2] !== undefined ? Number(caretMatch[2]) : 0
    const reqPatch = caretMatch[3] !== undefined ? Number(caretMatch[3]) : 0
    if (installedVer[0] !== reqMajor) return false
    if (installedVer[1] < reqMinor) return false
    if (installedVer[1] === reqMinor && installedVer[2] < reqPatch) return false
    return true
  }

  // >=1.0.0 — 大于等于
  const gteMatch = requiredTrimmed.match(/^>=?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/)
  if (gteMatch) {
    const reqVer: [number, number, number] = [
      Number(gteMatch[1]),
      gteMatch[2] !== undefined ? Number(gteMatch[2]) : 0,
      gteMatch[3] !== undefined ? Number(gteMatch[3]) : 0,
    ]
    for (let i = 0; i < 3; i++) {
      if (installedVer[i] > reqVer[i]) return true
      if (installedVer[i] < reqVer[i]) return false
    }
    return true
  }

  // <=2.0.0 — 小于等于
  const lteMatch = requiredTrimmed.match(/^<=?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/)
  if (lteMatch) {
    const reqVer: [number, number, number] = [
      Number(lteMatch[1]),
      lteMatch[2] !== undefined ? Number(lteMatch[2]) : 0,
      lteMatch[3] !== undefined ? Number(lteMatch[3]) : 0,
    ]
    for (let i = 0; i < 3; i++) {
      if (installedVer[i] < reqVer[i]) return true
      if (installedVer[i] > reqVer[i]) return false
    }
    return true
  }

  // x.x 通配，如 "1.x"、"2.3.x"
  const xMatch = requiredTrimmed.match(/^(\d+)(?:\.(?:x|\*))?(?:\.(?:x|\*))?$/i)
  if (xMatch) {
    return installedVer[0] === Number(xMatch[1])
  }

  // 裸版本号 — 默认 major 必须匹配
  const reqVer = parseSemver(requiredTrimmed)
  if (reqVer) {
    if (reqVer[0] === 0) {
      // 0.x 版本，minor 也必须匹配
      return installedVer[0] === 0 && installedVer[1] === reqVer[1]
    }
    return installedVer[0] === reqVer[0]
  }

  // 无法解析约束，跳过检查
  return true
}

/** 版本不兼容的依赖信息 */
interface VersionMismatch {
  moduleId: string
  depId: string
  required: string
  installed: string
}

/**
 * 拓扑排序 + 依赖检查 + 版本兼容性检查
 * 返回按依赖顺序排列的模块 id 列表（被依赖的在前）
 */
async function resolveDependencies(moduleIds: string[]): Promise<{
  sorted: string[]
  missing: string[]
  circular: string[]
  versionMismatches: VersionMismatch[]
}> {
  const allInstances = await moduleStore.getAll()
  const instanceMap = new Map<string, ModuleInstance>()
  for (const inst of allInstances) {
    instanceMap.set(inst.id, inst)
  }

  // 构建依赖图
  const nodes = new Map<string, DepNode>()
  for (const id of moduleIds) {
    const inst = instanceMap.get(id)
    if (!inst) continue
    const deps = inst.manifest.dependencies
      .filter(d => !d.optional)
      .map(d => d.moduleId)
    nodes.set(id, { id, instance: inst, deps })
  }

  // 版本兼容性检查
  const versionMismatches: VersionMismatch[] = []
  for (const [id, node] of nodes) {
    for (const dep of node.instance.manifest.dependencies) {
      if (!dep.version) continue
      const depInst = instanceMap.get(dep.moduleId)
      if (!depInst) continue // 缺失的依赖由 missing 处理
      const installedVersion = depInst.manifest.version
      if (!isVersionCompatible(dep.version, installedVersion)) {
        versionMismatches.push({
          moduleId: id,
          depId: dep.moduleId,
          required: dep.version,
          installed: installedVersion,
        })
      }
    }
  }

  // 拓扑排序（Kahn 算法）
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const [id, node] of nodes) {
    if (!inDegree.has(id)) inDegree.set(id, 0)
    for (const dep of node.deps) {
      if (nodes.has(dep)) {
        if (!adj.has(dep)) adj.set(dep, [])
        adj.get(dep)!.push(id)
        inDegree.set(id, (inDegree.get(id) || 0) + 1)
      }
    }
  }

  // 检测缺失和循环依赖
  const missing: string[] = []
  for (const [id, node] of nodes) {
    for (const dep of node.deps) {
      if (!nodes.has(dep)) {
        missing.push(`${id} => ${dep}`)
      }
    }
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const sorted: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    sorted.push(id)
    const neighbors = adj.get(id) || []
    for (const n of neighbors) {
      const newDeg = (inDegree.get(n) || 1) - 1
      inDegree.set(n, newDeg)
      if (newDeg === 0) queue.push(n)
    }
  }

  const circular = moduleIds.filter(id => nodes.has(id) && !sorted.includes(id))

  return { sorted, missing, circular, versionMismatches }
}

/**
 * 确保所有依赖都被激活，并检查版本兼容性
 */
async function ensureDependencies(instance: ModuleInstance): Promise<void> {
  const allInstances = await moduleStore.getAll()
  for (const dep of instance.manifest.dependencies) {
    if (dep.optional) continue
    const depInst = allInstances.find(i => i.id === dep.moduleId)
    if (!depInst) {
      console.warn(`[ModuleRegistry] 缺少依赖: ${dep.moduleId}`)
      continue
    }
    // 版本兼容性检查
    if (dep.version && depInst.manifest.version) {
      if (!isVersionCompatible(dep.version, depInst.manifest.version)) {
        console.warn(
          `[ModuleRegistry] 依赖版本不兼容: ${instance.id} 需要 ${dep.moduleId}@${dep.version}，` +
          `但安装的是 ${dep.moduleId}@${depInst.manifest.version}`,
        )
      }
    }
    if (!depInst.active) {
      await activateModule(depInst)
    }
  }
}

/* ════════════════════════════════════════
   启动初始化
   ════════════════════════════════════════ */

/**
 * 应用启动时调用：从数据库加载所有 active 模块并按依赖顺序激活
 */
async function initialize(): Promise<void> {
  // P3-W4 续：恢复看板视图扩展注册（KanbanView.vue 已迁入 apps/web/src/modules/runtime/）
  const kanbanViewExt: ViewExtension = {
    id: 'kanban-view',
    name: '看板视图',
    typeId: 'kanban',
    component: null as any, // 动态加载避免循环引用
    configComponent: null,
  }
  registerViewExtension(kanbanViewExt)

  // 延迟加载 kanban 组件
  import('./runtime/KanbanView.vue').then(mod => {
    kanbanViewExt.component = mod.default
  })

  // 注册 formula 自动重算
  import('@worldsmith/entity-core').then(mod => {
    mod.registerFormulaAutoRecalc()
  })

  const active = await moduleStore.getActive()
  const ids = active.map(m => m.id)
  const { sorted, missing, circular, versionMismatches } = await resolveDependencies(ids)

  if (missing.length > 0) {
    console.warn('[ModuleRegistry] 依赖缺失:', missing)
  }
  if (circular.length > 0) {
    console.warn('[ModuleRegistry] 循环依赖:', circular)
  }
  if (versionMismatches.length > 0) {
    for (const vm of versionMismatches) {
      console.warn(
        `[ModuleRegistry] 版本不兼容: ${vm.moduleId} 需要 ${vm.depId}@${vm.required}，` +
        `但安装的是 ${vm.depId}@${vm.installed}`,
      )
    }
  }

  // 按拓扑顺序激活（注册 schema 和视图到内存）
  for (const id of sorted) {
    const inst = active.find(m => m.id === id)
    if (inst) {
      await activateModule(inst)
    }
  }

  // 激活在排序中但不在 sorted 中的（独立无依赖的模块）
  for (const inst of active) {
    if (!sorted.includes(inst.id)) {
      await activateModule(inst)
    }
  }
}

/* ════════════════════════════════════════
   .wsm 包导入/导出
   ════════════════════════════════════════ */

/**
 * 将模块导出为 .wsm 数据对象
 */
function exportModuleWsm(manifest: ModuleManifest): Record<string, unknown> {
  return {
    formatVersion: 1,
    type: 'worldsmith-module',
    manifest,
  }
}

/**
 * 从 .wsm 数据导入模块
 */
async function importModuleWsm(data: Record<string, unknown>): Promise<string> {
  const manifest = data.manifest as ModuleManifest
  const instance: ModuleInstance = {
    id: manifest.id,
    manifest,
    installedAt: new Date().toISOString(),
    source: 'local',
    active: false,
  }
  await moduleStore.install(instance)
  return manifest.id
}

export const moduleRegistry = {
  // 扩展注册
  registerFieldExtension,
  registerViewExtension,
  getFieldExtension,
  getViewExtension,
  getAllFieldExtensions,
  getAllViewExtensions,
  isKnownFieldType,
  isKnownViewType,

  // 激活/停用
  activateModule,
  deactivateModule,

  // 依赖
  resolveDependencies,
  ensureDependencies,

  // 生命周期
  initialize,

  // 包格式
  exportModuleWsm,
  importModuleWsm,
}
