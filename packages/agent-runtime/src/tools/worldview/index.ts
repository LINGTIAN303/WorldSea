/**
 * 世界观芽工具（worldview）——内置能力形态（非 Skill / MCP / 芽插件）
 *
 * 三级渐进披露：
 *   不传 sprout          → 芽名清单（随芽注册动态）
 *   仅传 sprout          → 该芽使用方法（概述 + 动作目录自动生成）
 *   sprout + action      → 执行动作（params 传参）
 *
 * 芽名动态：登记表以芽 id 为稳定键，name/description 由 apps 侧 bootstrap
 * 在芽激活时登记（见 registry.ts）——改芽名 / 增删芽自动跟随。
 *
 * 计划与拍板记录：docs/plans/2026-09-21-世界观芽工具整合.md
 */
import type { ToolDefinition } from '../../bridge-types'
import { listWorldviewSprouts, resolveWorldviewSprout } from './registry'
import { renderSproutGuide, renderSproutList } from './render'
import { runSproutAction } from './actions'

export const worldviewTool: ToolDefinition = {
  name: 'worldview',
  description:
    '世界观芽工具。不传 sprout：返回全部芽名清单；传 sprout：返回该芽的使用方法（含动作目录与参数说明）；传 sprout 与 action：执行该芽的动作（params 传参）。',
  parameters: {
    sprout: {
      type: 'string',
      description: '芽名（如「大纲」）或芽 id（如 outline）。不传则列出全部芽名',
    },
    action: {
      type: 'string',
      description: '动作名。与 sprout 一并传入时执行该动作；单独传 sprout 时返回该芽使用方法',
    },
    params: {
      type: 'object',
      description: '动作参数（按使用方法中该动作的参数说明传入）',
    },
  },
  meta: {
    permission: 'moderate',
    category: 'plugin',
    alwaysAvailable: true,
    displayName: '世界观芽',
  },
  execute: async (args, ctx) => {
    const sproutInput = args.sprout === undefined || args.sprout === null ? '' : String(args.sprout).trim()
    if (!sproutInput) {
      return renderSproutList(listWorldviewSprouts())
    }

    const sprout = resolveWorldviewSprout(sproutInput)
    if (!sprout) {
      const available = listWorldviewSprouts().map(s => s.name).join('、')
      return JSON.stringify({
        ok: false,
        error: `芽「${sproutInput}」不存在`,
        available: available || '（暂无已登记的芽）',
      })
    }

    const actionInput = args.action === undefined || args.action === null ? '' : String(args.action).trim()
    if (!actionInput) {
      return renderSproutGuide(sprout)
    }

    const params =
      args.params && typeof args.params === 'object' && !Array.isArray(args.params)
        ? (args.params as Record<string, unknown>)
        : {}
    return runSproutAction(sprout.id, actionInput, params, ctx)
  },
}

export { registerWorldviewSprout, listWorldviewSprouts, resolveWorldviewSprout, clearWorldviewSprouts } from './registry'
export type { WorldviewSprout } from './registry'
export { SPROUT_ACTIONS, runSproutAction, runEntityTypeAction } from './actions'
export type { SproutAction, SproutActionParam } from './actions'
export { SPROUT_GUIDES } from './guides'
export { renderSproutList, renderSproutGuide } from './render'
