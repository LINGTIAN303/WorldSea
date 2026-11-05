/**
 * vendored cordis 的最小类型面（B，2026-09-25）。
 *
 * 上游类型在 `lib/types/*.d.ts`（未搬运：架构门禁扫 `.ts`），此处按**我们实际用到的子集**声明
 * ——与 Spike 实测的形状一致（`new Context()` / `provide` / `get(name, strict?)` / `plugin(p, cfg)`
 * 返回带 `dispose()` 的 fiber / `effect` / `on`）。扩充用时对照上游 `lib/types/`。
 */
declare module '@deepseek-ai/cordis' {
  /** `ctx.plugin()` 的返回值：`Object.create(fiber)` 的 thenable（`dispose()` 可拆）。 */
  export interface CordisFiberLike {
    dispose(): unknown
  }

  /** root fiber：`dispose()` 拆整棵树（回收 root 级 effect、服务与全部子插件）。 */
  export interface CordisRootFiberLike {
    dispose(): Promise<void>
  }

  export interface CordisPlugin {
    name: string
    /** 依赖的服务名（服务就绪后才会 apply；缺失则挂起） */
    inject?: string[]
    apply(ctx: CordisContext, config?: Record<string, unknown>): void
  }

  export interface CordisContext {
    plugin(plugin: CordisPlugin, config?: Record<string, unknown>): CordisFiberLike
    /** 提供服务并返回拆除函数 */
    provide(name: string, value: unknown): () => void
    /** 取服务（`strict = false` 时拿可选服务，缺失返回 undefined） */
    get(name: string, strict?: boolean): unknown
    effect(execute: () => () => void, label?: string): unknown
    on(name: string, listener: (...args: unknown[]) => void): unknown
    /** root fiber：`dispose()` 拆整棵树（4.1.0 实测：root effect / 服务 / 子插件全部回收）。 */
    fiber: CordisRootFiberLike
    stop?(): void
  }

  export const Context: new () => CordisContext
}
