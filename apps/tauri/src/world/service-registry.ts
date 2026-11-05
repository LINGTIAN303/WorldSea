/**
 * 世界树服务的**读取入口**（阶段 2-C，2026-11-06）。
 *
 * 为什么需要这个模块：能力桥（`@/shell/capabilities`）要给 12 条能力供数，
 * 而数在树的服务里；但 `tree.ts → api.ts → capabilities.ts`，若 capabilities 再反向
 * import `tree.ts` 就成环（架构门禁 `ts-cycle` 会报）。
 *
 * 解法：树启动时把服务表**寄存**到本模块，能力桥从这里取——依赖方向单向：
 *
 *   tree.ts ──register──▶ services 表 ──get──▶ capabilities.ts
 *      └──▶ api.ts ──▶ capabilities.ts（不回头引 tree）
 *
 * 寄存是**弱引用式快照**：`clear()` 后 `get()` 返回 undefined，能力桥据此决定回退到
 * 直连 storage 的旧路径（阶段 2-C 的降级策略）。
 */

/** 服务实例类型别名（避免本模块反向依赖 services.ts 的具体类型，保持零依赖）。 */
type ServiceTable = Readonly<Record<string, unknown>>

let table: ServiceTable | null = null

/** 树启动时登记服务表（由 `tree.ts` 在 provide 之后调用）。 */
export function registerWorldServiceTable(services: ServiceTable): void {
  table = services
}

/** 树拆除时清空（能力桥此后回退到直连路径）。 */
export function clearWorldServiceTable(): void {
  table = null
}

/**
 * 取一个树服务。
 * @param name 服务名（如 `world.entities`）。
 * @returns 服务实例；树未启动或服务不存在时返回 undefined。
 */
export function getWorldService<T = unknown>(name: string): T | undefined {
  if (!table) return undefined
  return table[name] as T | undefined
}

/** 服务表是否就绪（能力桥据此选择走服务还是直连 storage）。 */
export function hasWorldServices(): boolean {
  return table !== null
}
