/** 主应用调控器入口：包装 governor-core 并自动注入 createGovernorAPI（差异见文档），详细见 docs/details/注释/web/governor/governor.md */
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
