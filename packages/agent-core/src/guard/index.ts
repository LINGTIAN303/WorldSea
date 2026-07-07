/**
 * 统一权限守卫
 *
 * 从工具元数据自动解析权限级别，取代 useAgent.ts / cli-safety-guard.ts
 * 中的硬编码列表。新增工具时只需在 ToolMeta 中声明权限，自动传播到所有消费方。
 *
 * 用法：
 *   const guard = new PermissionGuard(toolRegistry)
 *   const level = guard.resolvePermission('shell_session', { action: 'exec', command: 'rm -rf /' })
 *   // → 'dangerous'
 */

import type { PermissionLevel, ToolMeta } from '../types'

export interface PermissionGuardConfig {
  /** 是否开启安全确认模式（MODERATE 级别需确认） */
  confirmModerate: boolean

  /** 是否开启危险确认模式（DANGEROUS 级别强制确认） */
  confirmDangerous: boolean

  /** 自定义危险命令正则（用于 execute_command / shell_session exec） */
  dangerousCommandPatterns?: RegExp[]

  /** 自定义权限覆盖（工具名→权限级别），优先级最高 */
  permissionOverrides?: Record<string, PermissionLevel>
}

export interface PermissionCheckResult {
  /** 最终权限级别 */
  level: PermissionLevel

  /** 是否需要用户确认 */
  needsConfirm: boolean

  /** 确认原因（用于弹窗展示） */
  reason?: string

  /** 工具的中文显示名 */
  displayName?: string
}

/** 默认危险命令正则 */
const DEFAULT_DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+-rf/i,
  /del\s+\/[sfq]/i,
  /format\s+[a-z]:/i,
  /shutdown/i,
  /reboot/i,
  /mkfs/i,
  /dd\s+if=/i,
  />\s*\/dev\//i,
  /chmod\s+-R\s+777/i,
  /taskkill/i,
  /reg\s+delete/i,
  /net\s+user/i,
  /pip\s+uninstall/i,
  /npm\s+uninstall\s+-g/i,
]

export class PermissionGuard {
  private config: PermissionGuardConfig
  private getToolMeta: (toolName: string) => ToolMeta | undefined

  constructor(
    getToolMeta: (toolName: string) => ToolMeta | undefined,
    config?: Partial<PermissionGuardConfig>,
  ) {
    this.getToolMeta = getToolMeta
    this.config = {
      confirmModerate: config?.confirmModerate ?? true,
      confirmDangerous: config?.confirmDangerous ?? true,
      dangerousCommandPatterns: config?.dangerousCommandPatterns ?? DEFAULT_DANGEROUS_PATTERNS,
      permissionOverrides: config?.permissionOverrides,
    }
  }

  /**
   * 解析工具调用的最终权限级别
   *
   * 解析优先级：
   * 1. permissionOverrides（最高优先）
   * 2. 子命令级别权限覆盖（subCommandPermissions）
   * 3. 危险命令模式检测（dangerousPatterns + 全局 dangerousCommandPatterns）
   * 4. 工具声明的默认权限（meta.permission）
   * 5. 兜底为 moderate
   */
  resolvePermission(
    toolName: string,
    args?: Record<string, unknown>,
  ): PermissionCheckResult {
    const meta = this.getToolMeta(toolName)

    // 1. 自定义覆盖
    if (this.config.permissionOverrides?.[toolName]) {
      return this.buildResult(this.config.permissionOverrides[toolName], meta)
    }

    // 2. 子命令级别覆盖
    if (meta?.subCommandPermissions && args) {
      const subCmd = String(args.action || args.subcommand || '')
      if (subCmd && meta.subCommandPermissions[subCmd]) {
        return this.buildResult(meta.subCommandPermissions[subCmd], meta)
      }
    }

    // 3. 危险命令模式检测
    const command = String(args?.command || '')
    if (command) {
      const allPatterns = [
        ...(meta?.dangerousPatterns || []),
        ...(this.config.dangerousCommandPatterns || []),
      ]
      const isDangerous = allPatterns.some(p => p.test(command))
      if (isDangerous) {
        return this.buildResult('dangerous', meta, `命令包含危险操作模式`)
      }
    }

    // 4. 默认权限
    const level = meta?.permission ?? 'moderate'
    return this.buildResult(level, meta)
  }

  /**
   * 检查工具调用是否需要用户确认
   */
  check(
    toolName: string,
    args?: Record<string, unknown>,
  ): PermissionCheckResult {
    const result = this.resolvePermission(toolName, args)

    if (result.level === 'safe') {
      return { ...result, needsConfirm: false }
    }

    if (result.level === 'moderate') {
      return { ...result, needsConfirm: this.config.confirmModerate }
    }

    if (result.level === 'dangerous') {
      return { ...result, needsConfirm: this.config.confirmDangerous }
    }

    return result
  }

  /**
   * 批量获取指定权限级别的所有工具名
   *
   * 替代 useAgent.ts 中的 SAFE_TOOLS / MODERATE_TOOLS / DANGEROUS_TOOLS 硬编码列表。
   */
  getToolsByPermission(_level: PermissionLevel): string[] {
    // 此方法需要 ToolRegistry 配合，这里仅声明接口
    // 实际实现由 ToolRegistry.getToolsByPermission 提供
    return []
  }

  /**
   * 获取所有始终可用的工具名
   *
   * 替代 registry.ts 中的 ALWAYS_AVAILABLE_TOOLS 硬编码列表。
   */
  getAlwaysAvailableTools(): string[] {
    // 此方法需要 ToolRegistry 配合
    return []
  }

  private buildResult(
    level: PermissionLevel,
    meta?: ToolMeta,
    reason?: string,
  ): PermissionCheckResult {
    return {
      level,
      needsConfirm: false, // 由 check() 方法覆盖
      reason,
      displayName: meta?.displayName,
    }
  }
}

/**
 * 创建 beforeToolCall 守卫函数
 *
 * 供 CoreBackend / createWorldSmithAgent 使用，
 * 统一前端和 CLI 的权限确认逻辑。
 */
export function createBeforeToolCallGuard(
  guard: PermissionGuard,
  uiStore: { confirm: (title: string, message: string) => Promise<boolean> },
) {
  return async (info: {
    toolCall: { name: string; args: Record<string, unknown> }
  }): Promise<{ block: boolean; reason?: string } | void> => {
    const result = guard.check(info.toolCall.name, info.toolCall.args)

    if (!result.needsConfirm) return undefined

    const displayName = result.displayName || info.toolCall.name
    const levelLabel = result.level === 'dangerous' ? '⚠️ 危险操作' : '操作确认'
    const reasonText = result.reason
      ? `\n原因：${result.reason}`
      : ''

    const argSummary = Object.entries(info.toolCall.args)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(', ')

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
