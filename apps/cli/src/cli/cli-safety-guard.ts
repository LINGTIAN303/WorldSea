/**
 * CLI 安全守卫
 *
 * 基于 @worldsmith/agent-core 的 PermissionGuard，
 * 从工具元数据自动解析权限级别，取代硬编码正则列表。
 */

import { PermissionGuard } from '@worldsmith/agent-core'
import type { IUIStore } from '@worldsmith/agent-runtime'
import { getToolMeta } from '@worldsmith/agent-runtime'

export function createCLISafetyGuard(uiStore: IUIStore, interactive = true) {
  const guard = new PermissionGuard(getToolMeta, {
    confirmModerate: true,
    confirmDangerous: true,
  })

  return async (info: { toolCall: { name: string; args: Record<string, unknown> } }): Promise<{ block: boolean; reason?: string } | void> => {
    const { name, args } = info.toolCall
    const result = guard.check(name, args)

    if (!result.needsConfirm) return undefined

    const displayName = result.displayName || name
    const argSummary = Object.entries(args)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(', ')

    const levelLabel = result.level === 'dangerous' ? '⚠️ 危险操作' : '操作确认'
    const reasonText = result.reason ? `\n原因：${result.reason}` : ''

    // 非交互模式（serve HTTP 服务器）：无法通过 stdin 确认，自动通过并记录警告
    // 安全责任转移给前端（前端可在调用前做 UI 确认）
    if (!interactive) {
      console.warn(`[Guard] 非交互模式自动通过: ${displayName} (${argSummary || '无参数'})`)
      return undefined
    }

    const approved = await uiStore.confirm(
      levelLabel,
      `工具 "${displayName}" 将执行${result.level === 'dangerous' ? '不可逆' : '修改'}操作 (${argSummary || '无参数'})${reasonText}，是否继续？`,
    )

    if (!approved) {
      return { block: true, reason: `用户拒绝了 "${displayName}" 操作` }
    }

    return undefined
  }
}
