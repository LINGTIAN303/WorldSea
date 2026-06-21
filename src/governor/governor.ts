/**
 * governor/governor.ts — 主应用调控器入口（包装 @worldsmith/governor-core）
 *
 * 核心逻辑已下沉到 @worldsmith/governor-core 包。
 * 此文件为主应用提供特化版本：自动注入 createGovernorAPI 作为 apiFactory。
 *
 * 与 governor-core 的差异：
 * - governor-core 的 createGovernor 接收 apiFactory 选项（默认返回空 API）
 * - 主应用的 createGovernor 自动使用 createGovernorAPI（依赖 Vue/Pinia/pluginAPI）
 *
 * 这样 App.vue 的 initGovernor({ verbose }) 调用无需修改，
 * 同时 Agent 包可直接使用 governor-core 的 createGovernor（无 UI 依赖）。
 */
import type {
  Governor,
  GovernorOptions,
} from '@worldsmith/governor-core/types'
import {
  createGovernor as createGovernorCore,
  initGovernor as initGovernorCore,
  getGovernor as getGovernorCore,
  _resetGovernor as _resetGovernorCore,
} from '@worldsmith/governor-core/governor'
import { createGovernorAPI } from './api'

/**
 * 创建调控器实例（主应用版本）。
 *
 * 自动注入 createGovernorAPI 作为 apiFactory，
 * 调用方可通过 options.apiFactory 覆盖。
 */
export function createGovernor(options: GovernorOptions = {}): Governor {
  return createGovernorCore({
    ...options,
    apiFactory: options.apiFactory ?? createGovernorAPI,
  })
}

/**
 * 初始化全局调控器实例（主应用版本）。
 *
 * 自动注入 createGovernorAPI 作为 apiFactory。
 * 应在应用启动时（main.ts/App.vue setup）调用一次。
 */
export function initGovernor(options: GovernorOptions = {}): Governor {
  return initGovernorCore({
    ...options,
    apiFactory: options.apiFactory ?? createGovernorAPI,
  })
}

/**
 * 获取全局调控器实例。
 * 必须先调用 initGovernor()。
 */
export function getGovernor(): Governor {
  return getGovernorCore()
}

/**
 * 重置全局调控器（仅用于测试）。
 * @internal
 */
export function _resetGovernor(): void {
  _resetGovernorCore()
}
