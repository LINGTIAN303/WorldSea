/**
 * 外部插件的**模块种子表**（对齐 dsh client `PLATFORM_MODULES` 的 require 模式，批1 2026-10-13）。
 *
 * 外部插件（`worlddata/.worldsea/plugins/<id>.js`）是闭包工厂 `(require) => ({ manifest, apply })`，
 * 依赖不经打包，运行时经 `require(name)` 从本表取——插件产物零构建链，写完即装。
 * 表内容 = 运行时实例引用（包本就在产物内，零新增体积）；未登记名 → 可读错误（fail loud）。
 * 详细设计：docs/details/注释/tauri/world-external.md（批1 交付时建）
 */
import * as vue from 'vue'
import * as entityCore from '@worldsea/entity-core'
import * as sharedUi from '@worldsea/shared-ui'

/** 种子表（模块名 → 导出命名空间）。 */
const registry = new Map<string, unknown>()

/** 登记一个模块（外部插件经 `require(name)` 取）。 */
export function registerModule(name: string, exports: unknown): void {
  registry.set(name, exports)
}

/** 注销一个模块（测试用）。 */
export function unregisterModule(name: string): void {
  registry.delete(name)
}

/** 当前已登记的模块名（错误提示用）。 */
export function registeredModuleNames(): string[] {
  return [...registry.keys()].sort()
}

/** 造一个 `require` 闭包（每个外部插件求值时共用一个实例即可）。 */
export function createRequire(): (name: string) => unknown {
  return (name: string) => {
    const found = registry.get(name)
    if (found === undefined) {
      throw new Error(`MODULE_UNKNOWN: 模块「${name}」未登记（可用：${registeredModuleNames().join(' / ') || '无'}）`)
    }
    return found
  }
}

// 默认种子表：v1 三包（完整命名空间，插件按需解构）
registerModule('vue', vue)
registerModule('@worldsea/entity-core', entityCore)
registerModule('@worldsea/shared-ui', sharedUi)
