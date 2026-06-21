/**
 * governor/registry.ts — 模块注册表
 *
 * 内部模块注册表，负责：
 *   - 模块的注册与查询
 *   - 环境过滤（hosts/phase/requires 匹配）
 *   - 依赖解析（拓扑排序 + semver 版本兼容性检查）
 *
 * 复用并迁移自 src/modules/registry.ts 的 semver 与拓扑排序逻辑，
 * 增加能力过滤层。
 */
import type {
  Environment,
  ModuleDescriptor,
  ModuleDependency,
  ModulePriority,
} from './types'

/* ════════════════════════════════════════
   semver 兼容性检查（迁移自 modules/registry.ts）
   ════════════════════════════════════════ */

/**
 * 解析 semver 字符串为 [major, minor, patch]
 * 不严格要求完整格式，允许 "1"、"1.2"、"1.2.3"
 */
function parseSemver(v: string): [number, number, number] | null {
  const m = v.replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!m) return null
  return [
    Number(m[1]),
    m[2] !== undefined ? Number(m[2]) : 0,
    m[3] !== undefined ? Number(m[3]) : 0,
  ]
}

/**
 * 检查 installed 版本是否满足 required 版本约束
 * 支持：">=1.0.0"、"^1.2"、">2.0.0 <3.0.0"、"1.x"、"2.3.x" 等常见模式
 * 对于无操作符前缀的版本，默认检查 major 版本匹配
 */
export function isVersionCompatible(required: string, installed: string): boolean {
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

/* ════════════════════════════════════════
   环境匹配检查
   ════════════════════════════════════════ */

/**
 * 检查模块是否匹配当前环境。
 *
 * 三层检查：
 * 1. hosts：模块限定的宿主列表（不填=全平台）
 * 2. phase：模块限定的生命周期阶段（不填=全阶段）
 * 3. requires：模块要求的能力标签（不填=无要求）
 *
 * @returns { matched: boolean, reason: string } matched=false 时 reason 说明原因
 */
export function checkEnvironmentMatch(
  descriptor: ModuleDescriptor,
  env: Environment,
): { matched: boolean; reason: string } {
  // 1. 宿主检查
  if (descriptor.hosts && descriptor.hosts.length > 0) {
    if (!descriptor.hosts.includes(env.host)) {
      return {
        matched: false,
        reason: `宿主不匹配：模块限定 ${descriptor.hosts.join('/')}，当前为 ${env.host}`,
      }
    }
  }

  // 2. 生命周期阶段检查
  if (descriptor.phase && descriptor.phase.length > 0) {
    if (!descriptor.phase.includes(env.phase)) {
      return {
        matched: false,
        reason: `阶段不匹配：模块限定 ${descriptor.phase.join('/')}，当前为 ${env.phase}`,
      }
    }
  }

  // 3. 能力检查
  if (descriptor.requires && descriptor.requires.length > 0) {
    const missing = descriptor.requires.filter(cap => !env.capabilities.has(cap))
    if (missing.length > 0) {
      return {
        matched: false,
        reason: `能力不足：缺少 ${missing.join(', ')}`,
      }
    }
  }

  return { matched: true, reason: '' }
}

/* ════════════════════════════════════════
   依赖解析（拓扑排序 + 版本检查）
   ════════════════════════════════════════ */

/** 版本不兼容的依赖信息 */
export interface VersionMismatch {
  moduleId: string
  depId: string
  required: string
  installed: string
}

/** 依赖解析结果 */
export interface DependencyResolveResult {
  /** 按依赖顺序排列的模块 id 列表（被依赖的在前） */
  sorted: string[]
  /** 缺失的依赖（格式：moduleId => depId） */
  missing: string[]
  /** 循环依赖的模块 id */
  circular: string[]
  /** 版本不兼容的依赖 */
  versionMismatches: VersionMismatch[]
}

interface DepNode {
  id: string
  descriptor: ModuleDescriptor
  deps: string[] // 非可选依赖的 moduleId 列表
}

/**
 * 拓扑排序 + 依赖检查 + 版本兼容性检查。
 *
 * 返回按依赖顺序排列的模块 id 列表（被依赖的在前）。
 * 仅对存在于 modules 中的模块进行排序；缺失的依赖记录到 missing。
 *
 * @param modules 待排序的模块描述符列表
 * @returns 排序结果与问题列表
 */
export function resolveDependencies(
  modules: ModuleDescriptor[],
): DependencyResolveResult {
  const moduleMap = new Map<string, ModuleDescriptor>()
  for (const desc of modules) {
    moduleMap.set(desc.id, desc)
  }

  // 构建依赖图
  const nodes = new Map<string, DepNode>()
  for (const desc of modules) {
    const deps = (desc.dependencies || [])
      .filter(d => !d.optional)
      .map(d => d.moduleId)
    nodes.set(desc.id, { id: desc.id, descriptor: desc, deps })
  }

  // 版本兼容性检查
  const versionMismatches: VersionMismatch[] = []
  for (const [id, node] of nodes) {
    for (const dep of node.descriptor.dependencies || []) {
      if (!dep.version) continue
      const depDesc = moduleMap.get(dep.moduleId)
      if (!depDesc) continue // 缺失的依赖由 missing 处理
      if (!isVersionCompatible(dep.version, depDesc.version)) {
        versionMismatches.push({
          moduleId: id,
          depId: dep.moduleId,
          required: dep.version,
          installed: depDesc.version,
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

  // 检测缺失依赖
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

  const circular = modules.map(m => m.id).filter(id => nodes.has(id) && !sorted.includes(id))

  return { sorted, missing, circular, versionMismatches }
}

/* ════════════════════════════════════════
   模块注册表
   ════════════════════════════════════════ */

/**
 * 模块注册表。管理所有已注册的模块描述符。
 *
 * 不负责激活/停用，仅提供注册与查询能力。
 * 激活逻辑由 governor.ts 调用 resolveDependencies 后按顺序执行。
 */
export class ModuleRegistry {
  private modules = new Map<string, ModuleDescriptor>()

  /** 注册单个模块。重复 id 会覆盖（用于热重载场景） */
  register(descriptor: ModuleDescriptor): void {
    this.modules.set(descriptor.id, descriptor)
  }

  /** 批量注册 */
  registerAll(descriptors: ModuleDescriptor[]): void {
    for (const desc of descriptors) {
      this.register(desc)
    }
  }

  /** 获取模块描述符 */
  get(id: string): ModuleDescriptor | undefined {
    return this.modules.get(id)
  }

  /** 获取所有已注册模块 */
  getAll(): ModuleDescriptor[] {
    return Array.from(this.modules.values())
  }

  /** 按优先级分组 */
  getByPriority(priority: ModulePriority): ModuleDescriptor[] {
    return this.getAll().filter(m => m.priority === priority)
  }

  /** 是否已注册 */
  has(id: string): boolean {
    return this.modules.has(id)
  }

  /** 注销模块 */
  unregister(id: string): boolean {
    return this.modules.delete(id)
  }

  /** 清空所有注册 */
  clear(): void {
    this.modules.clear()
  }
}
