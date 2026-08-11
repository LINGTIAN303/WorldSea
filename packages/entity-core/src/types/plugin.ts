import type { Component } from 'vue'

export interface PluginPermission {
  name: string
  description?: string
}

export interface PluginCapabilityDeclaration {
  action: string
  description: string
  params?: string[]
}

export interface PluginDependency {
  pluginId: string
  minVersion?: string
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  author?: string
  permissions?: PluginPermission[]
  dependencies?: PluginDependency[]
  entityTypes?: string[]
  relationTypes?: string[]
  views?: string[]
  agentSkills?: string[]
  agentCapabilities?: PluginCapabilityDeclaration[]
}

/** 视图工具条模式：
 * - 'bar'（默认）：随流 44px 占位条，普通视图
 * - 'none'：完全折叠（display:none）。Teleport 目标 #view-toolbar-* 仍常驻 DOM，防壳切换崩溃，仅用于不依赖工具条的视图
 * - 'overlay'：悬浮胶囊，不占高度，hover 顶部浮现；用于全屏画布视图（思维导图/图谱/画板/工作流）——既拿回满高又不丢工具条控件
 */
export type ViewToolbarMode = 'bar' | 'none' | 'overlay'

export interface PluginView {
  id: string
  label: string
  icon: string
  component: Component
  pluginId?: string
  /** 视图工具条模式，默认 'bar' */
  toolbar?: ViewToolbarMode
  _moduleId?: string
  _viewConfig?: import('./module').ModuleViewConfig
}

export interface PluginInstance {
  manifest: PluginManifest
  activate(api: Record<string, unknown>): void | Promise<void>
  deactivate?(): void | Promise<void>
}

export const KNOWN_PERMISSIONS = [
  'storage:read',
  'storage:write',
  'entities:read',
  'entities:write',
  'relations:read',
  'relations:write',
  'schema:register',
  'hooks:register',
  'views:register',
  'network:fetch',
  'clipboard:access',
  'notifications:send',
] as const

export type PluginPermissionName = typeof KNOWN_PERMISSIONS[number]
