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
}

/** 插件贡献的全局覆盖层（弹窗/抽屉类面板，非侧栏视图）：
 *  由 Shell 挂载的 OverlayHost 渲染；打开 = `ws-open-<id>` 全局事件，关闭 = 组件 emit `close`。
 *  组件契约 = `{ show }` props + `@close` emit（与迁移前面板零改动）。 */
export interface PluginOverlay {
  /** 全局唯一 id；打开事件约定 = `ws-open-<id>`（如 `trash` → `ws-open-trash`） */
  id: string
  /** 用户可见名（审计/调试展示） */
  label: string
  component: Component
  pluginId?: string
  /** 菜单入口声明（批6：AppMenu「更多操作」按此自动渲染贡献项；不声明 = 无菜单入口） */
  menu?: PluginOverlayMenu
}

/** 覆盖层的菜单入口声明（AppMenu 消费；点击 = dispatch `ws-open-<id>`）。 */
export interface PluginOverlayMenu {
  /** 菜单显示名 */
  label: string
  /** 图标名（lucideMap） */
  icon: string
  /** 排序（升序；L0 固定项「导出到文件夹」占位 order=1.5） */
  order: number
  /** 快捷键注册 id（菜单标注读注册表当前键位；无快捷键省略） */
  shortcutId?: string
}

/** 覆盖层生命周期变更（真源 `pluginAPI` 派发；OverlayHost 据此镜像增删 + 增删事件监听）。 */
export interface OverlayChange {
  kind: 'registered' | 'unregistered'
  overlay: PluginOverlay
}

export type OverlayChangeListener = (change: OverlayChange) => void

export interface PluginInstance {
  manifest: PluginManifest
  activate(api: Record<string, unknown>): void | Promise<void>
  deactivate?(): void | Promise<void>
}

/** 视图生命周期变更（真源 `pluginAPI` 派发；显示侧镜像据此增删）。 */
export interface ViewChange {
  kind: 'registered' | 'unregistered'
  view: PluginView
}

export type ViewChangeListener = (change: ViewChange) => void

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
