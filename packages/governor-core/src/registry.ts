/**
 * @worldsmith/governor-core — 模块注册表
 *
 * 模块注册与查询、环境过滤、依赖解析（拓扑排序 + semver 版本兼容性检查）。
 * 纯逻辑，无副作用，不依赖 Vue/Pinia。
 */
import type {
  Environment,
  ModuleDescriptor,
  ModuleDependency,
  ModulePriority,
} from './types'

/* ════════════════════════════════════════
   semver 兼容性检查
   ════════════════════════════════════════ */

function parseSemver(v: string): [number, number, number] | null {
  const m = v.replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!m) return null
  return [
    Number(m[1]),
    m[2] !== undefined ? Number(m[2]) : 0,
    m[3] !== undefined ? Number(m[3]) : 0,
  ]
}

export function isVersionCompatible(required: string, installed: string): boolean {
  const installedVer = parseSemver(installed)
  if (!installedVer) return true

  const requiredTrimmed = required.trim()

  if (/\s/.test(requiredTrimmed)) {
    return requiredTrimmed.split(/\s+/).every(constraint =>
      isVersionCompatible(constraint, installed),
    )
  }

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

  const xMatch = requiredTrimmed.match(/^(\d+)(?:\.(?:x|\*))?(?:\.(?:x|\*))?$/i)
  if (xMatch) {
    return installedVer[0] === Number(xMatch[1])
  }

  const reqVer = parseSemver(requiredTrimmed)
  if (reqVer) {
    if (reqVer[0] === 0) {
      return installedVer[0] === 0 && installedVer[1] === reqVer[1]
    }
    return installedVer[0] === reqVer[0]
  }

  return true
}

/* ════════════════════════════════════════
   环境匹配检查
   ════════════════════════════════════════ */

export function checkEnvironmentMatch(
  descriptor: ModuleDescriptor,
  env: Environment,
): { matched: boolean; reason: string } {
  if (descriptor.hosts && descriptor.hosts.length > 0) {
    if (!descriptor.hosts.includes(env.host)) {
      return {
        matched: false,
        reason: `宿主不匹配：模块限定 ${descriptor.hosts.join('/')}，当前为 ${env.host}`,
      }
    }
  }

  if (descriptor.phase && descriptor.phase.length > 0) {
    if (!descriptor.phase.includes(env.phase)) {
      return {
        matched: false,
        reason: `阶段不匹配：模块限定 ${descriptor.phase.join('/')}，当前为 ${env.phase}`,
      }
    }
  }

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

export interface VersionMismatch {
  moduleId: string
  depId: string
  required: string
  installed: string
}

export interface DependencyResolveResult {
  sorted: string[]
  missing: string[]
  circular: string[]
  versionMismatches: VersionMismatch[]
}

interface DepNode {
  id: string
  descriptor: ModuleDescriptor
  deps: string[]
}

export function resolveDependencies(
  modules: ModuleDescriptor[],
): DependencyResolveResult {
  const moduleMap = new Map<string, ModuleDescriptor>()
  for (const desc of modules) {
    moduleMap.set(desc.id, desc)
  }

  const nodes = new Map<string, DepNode>()
  for (const desc of modules) {
    const deps = (desc.dependencies || [])
      .filter((d: ModuleDependency) => !d.optional)
      .map(d => d.moduleId)
    nodes.set(desc.id, { id: desc.id, descriptor: desc, deps })
  }

  const versionMismatches: VersionMismatch[] = []
  for (const [id, node] of nodes) {
    for (const dep of node.descriptor.dependencies || []) {
      if (!dep.version) continue
      const depDesc = moduleMap.get(dep.moduleId)
      if (!depDesc) continue
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

export class ModuleRegistry {
  private modules = new Map<string, ModuleDescriptor>()

  register(descriptor: ModuleDescriptor): void {
    this.modules.set(descriptor.id, descriptor)
  }

  registerAll(descriptors: ModuleDescriptor[]): void {
    for (const desc of descriptors) {
      this.register(desc)
    }
  }

  get(id: string): ModuleDescriptor | undefined {
    return this.modules.get(id)
  }

  getAll(): ModuleDescriptor[] {
    return Array.from(this.modules.values())
  }

  getByPriority(priority: ModulePriority): ModuleDescriptor[] {
    return this.getAll().filter(m => m.priority === priority)
  }

  has(id: string): boolean {
    return this.modules.has(id)
  }

  unregister(id: string): boolean {
    return this.modules.delete(id)
  }

  clear(): void {
    this.modules.clear()
  }
}
