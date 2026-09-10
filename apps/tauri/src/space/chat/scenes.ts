/**
 * 场景静态选项（单一事实源）：SessionSidebar（滑块渲染 + list_scenarios 失败兜底）与
 * AgentSpace（Ctrl+1-5 快捷键注册）共用，避免两处硬编码漂移（2026-09-10 同源化）。
 * 动态元数据（display_name/workspace_hint/memory_policy）仍以后端 list_scenarios 为准；
 * 快捷键按内置 5 场景静态注册，自定义场景扩展时不绑键（滑块仍可选）。
 */

export interface SceneOptionBase {
  /** 场景唯一 id（与后端 ScenarioRegistry 一致；2026-09-10 世界场景 worldbuilding→world） */
  id: string
  /** 显示名 */
  label: string
  /** 场景工作区根目录名（后端 workspace_hint；目录名不漂移是有意设计，可作静态事实源） */
  hint: string
  /** 占位标记（历史遗留：5 场景全实体化后恒缺省，保留兼容旧模板分支） */
  placeholder?: boolean
}

export const SCENE_SLIDER_OPTIONS: SceneOptionBase[] = [
  { id: 'world', label: '世界', hint: 'worldbuilding' },
  { id: 'novel', label: '小说', hint: 'novel' },
  { id: 'general', label: '通用', hint: 'general' },
  { id: 'coding', label: '编程', hint: 'coding' },
  { id: 'design', label: '设计', hint: 'design' },
]
