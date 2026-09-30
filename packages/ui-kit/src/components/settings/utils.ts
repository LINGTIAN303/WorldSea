// 设置面板共用工具与类型定义
// Phase 8d: 从根 src/ui/settings/utils.ts 下沉到 ui-kit

/**
 * 关键词匹配函数（搜索模式下用于过滤卡片显示）
 * 当 searchQuery 为空时总是返回 true；否则检查 keywords 是否包含 query
 */
export function matchKeywords(searchQuery: string, keywords: string): boolean {
  if (!searchQuery) return true
  const q = searchQuery.toLowerCase()
  return keywords.toLowerCase().includes(q)
}

/** 快捷键项 */
export interface ShortcutItem {
  id: string
  description: string
  keys: string[]
  scope: string
}

/**
 * 快捷键目录（展示元数据）。权威键位以各注册处 register() 声明为准（registry
 * 注册时自动应用用户覆盖），此处 keys 仅作视图未激活时的展示 fallback。
 * 维护约束：新增/改 id 必须与注册处同步，此处不允许出现注册处没有的死条目
 * ——已由 `apps/tauri/src/ui/layout/__tests__/shortcutCatalog.spec.ts` 全目录守卫兜底（双向）。
 */
export const SHORTCUT_CATALOG: ShortcutItem[] = [
  // ── 全局（Shell.vue / AppMenu.vue）──
  { id: 'help.shortcuts', description: '开启快捷键帮助', keys: ['?'], scope: 'global' },
  { id: 'sidebar.toggle', description: '切换侧边栏', keys: ['ctrl', 'b'], scope: 'global' },
  { id: 'search.open', description: '全局搜索', keys: ['ctrl', 'k'], scope: 'global' },
  { id: 'settings.open', description: '打开设置', keys: ['ctrl', ','], scope: 'global' },
  { id: 'menu.import-export', description: '导入/导出', keys: ['ctrl', 'shift', 's'], scope: 'global' },
  { id: 'global.undo', description: '撤销', keys: ['ctrl', 'z'], scope: 'global' },
  { id: 'global.redo', description: '重做', keys: ['ctrl', 'y'], scope: 'global' },
  { id: 'global.redo-alt', description: '重做（备选）', keys: ['ctrl', 'shift', 'z'], scope: 'global' },
  { id: 'global.undoHistory', description: '撤销历史面板', keys: ['ctrl', 'alt', 'z'], scope: 'global' },
  { id: 'project.save', description: '导出到文件夹', keys: ['ctrl', 's'], scope: 'global' },
  { id: 'shell.toggle', description: '进入 Agent 空间', keys: ['ctrl', 'tab'], scope: 'global' },
  { id: 'view.switch.next', description: '切换到下一个视图', keys: ['ctrl', 'down'], scope: 'global' },
  { id: 'view.switch.prev', description: '切换到上一个视图', keys: ['ctrl', 'up'], scope: 'global' },
  // ── 视图（各芽视图挂载期间生效；无视图上下文时 view 层失效）──
  { id: 'character.undo', description: '角色：撤销', keys: ['ctrl', 'z'], scope: 'view' },
  { id: 'character.redo', description: '角色：重做', keys: ['ctrl', 'y'], scope: 'view' },
  { id: 'timeline.undo', description: '时间轴：撤销', keys: ['ctrl', 'z'], scope: 'view' },
  { id: 'timeline.redo', description: '时间轴：重做', keys: ['ctrl', 'y'], scope: 'view' },
  { id: 'region.borderline', description: '区域图谱：边境线模式', keys: ['alt'], scope: 'view' },
  { id: 'region.erase-confirm', description: '区域图谱：确认偏移边境线', keys: ['enter'], scope: 'view' },
  { id: 'region.erase-cancel', description: '区域图谱：取消边境线编辑', keys: ['escape'], scope: 'view' },
  { id: 'drawing.undo', description: '画板：撤销', keys: ['ctrl', 'z'], scope: 'view' },
  { id: 'drawing.redo', description: '画板：重做', keys: ['ctrl', 'shift', 'z'], scope: 'view' },
  { id: 'drawing.zoomIn', description: '画板：放大', keys: ['ctrl', '='], scope: 'view' },
  { id: 'drawing.zoomOut', description: '画板：缩小', keys: ['ctrl', '-'], scope: 'view' },
  { id: 'drawing.fitView', description: '画板：适应视图', keys: ['ctrl', '0'], scope: 'view' },
  // ── 视图·战术板（战斗阶段条件在 handler 内判断）──
  { id: 'tactical.endTurn', description: '战术板：结束回合', keys: ['space'], scope: 'view' },
  { id: 'tactical.move', description: '战术板：移动', keys: ['m'], scope: 'view' },
  { id: 'tactical.attack', description: '战术板：攻击', keys: ['a'], scope: 'view' },
  { id: 'tactical.wait', description: '战术板：等待', keys: ['w'], scope: 'view' },
  { id: 'tactical.cancel', description: '战术板：取消行动', keys: ['escape'], scope: 'view' },
  { id: 'tactical.awareness-influence', description: '战术板：势力态势感知', keys: ['1'], scope: 'view' },
  { id: 'tactical.awareness-threat', description: '战术板：威胁态势感知', keys: ['2'], scope: 'view' },
  { id: 'tactical.awareness-supply', description: '战术板：补给态势感知', keys: ['3'], scope: 'view' },
  // ── 视图·大纲白板（BoardView；**仅编辑器层注册**，列表层不注册——故列表层打开设置时
  //     键位显示为下方 fallback 且提示「所属视图未激活」，进入编辑器后即可改键）──
  { id: 'outline-board.undo', description: '大纲白板：撤销', keys: ['ctrl', 'z'], scope: 'view' },
  { id: 'outline-board.redo', description: '大纲白板：重做', keys: ['ctrl', 'shift', 'z'], scope: 'view' },
  { id: 'outline-board.delete-container', description: '大纲白板：删除选中容器（不删节点）', keys: ['delete'], scope: 'view' },
  { id: 'outline-board.reset-zoom', description: '大纲白板：缩放重置为 100%', keys: ['ctrl', '0'], scope: 'view' },
  // Shift+1 经 normalizeKeys 归一为单键 '!'（非字母可打印字符不叠加 shift 修饰）；
  // 'keys' 与注册处保持一致写 '!'，展示层负责拆成 Shift + 1
  { id: 'outline-board.fit-all', description: '大纲白板：适配全部', keys: ['!'], scope: 'view' },
  { id: 'outline-board.draw-section', description: '大纲白板：画区', keys: ['s'], scope: 'view' },
  { id: 'outline-board.escape', description: '大纲白板：取消选中 / 退出画区', keys: ['escape'], scope: 'view' },
]

/** 快捷键分组顺序（低→高优先级，与 useShortcuts.SCOPE_ORDER 互补同步；space 已随 E7 退役） */
export const SCOPE_ORDER = ['global', 'view', 'editor', 'modal']

/** 快捷键作用域文案 */
export function scopeLabel(scope: string): string {
  const m: Record<string, string> = { global: '全局', view: '当前视图', editor: '编辑器', modal: '弹窗' }
  return m[scope] || scope
}

/** 字体分层配置 */
export interface FontLayerConfig {
  key: 'chrome' | 'editorUi' | 'content' | 'preview' | 'canvas' | 'agent'
  label: string
  hint: string
}

export const FONT_LAYERS: FontLayerConfig[] = [
  { key: 'chrome', label: '界面字体', hint: 'Shell、侧栏、菜单、对话框、按钮' },
  { key: 'editorUi', label: '编辑器 UI', hint: '编辑器工具栏、章节列表、芽工具栏' },
  { key: 'content', label: '内容字体', hint: '正文编辑区、Notebook Markdown' },
  { key: 'preview', label: '预览字体', hint: '手机预览、DOCX 导出' },
  { key: 'canvas', label: '画布字体', hint: 'FontRenderer 图片渲染' },
  { key: 'agent', label: 'Agent', hint: '对话输出' },
]

/** 字重文案 */
const WEIGHT_LABELS: Record<number, string> = {
  100: '极细', 200: '超细', 300: '细体', 400: '常规',
  500: '中等', 600: '半粗', 700: '粗体', 800: '超粗', 900: '极粗',
}

export function weightLabel(w: number): string {
  return WEIGHT_LABELS[w] ?? `${w}`
}

/** 字体来源文案 */
export function sourceLabel(source: string): string {
  const map: Record<string, string> = { preset: '预设', wsfont: 'wsfont', raw: 'ttf/otf', windfonts: 'WindFonts', system: '系统', zip: 'ZIP' }
  return map[source] || source
}

/** 格式化字节大小 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 陪伴模式场景概率项 */
export interface SceneProbItem {
  id: string
  label: string
  defaultVal: number
}

export const SCENE_PROB_ITEMS: SceneProbItem[] = [
  { id: 'entity_create', label: '实体创建', defaultVal: 80 },
  { id: 'entity_delete', label: '实体删除', defaultVal: 90 },
  { id: 'field_short', label: '短文本编辑', defaultVal: 50 },
  { id: 'field_long', label: '长文本编辑', defaultVal: 40 },
  { id: 'name_input', label: '名称输入', defaultVal: 60 },
  { id: 'relation_create', label: '关系创建', defaultVal: 30 },
  { id: 'relation_delete', label: '关系删除', defaultVal: 40 },
  { id: 'view_switch', label: '视图切换', defaultVal: 20 },
  { id: 'batch_edit', label: '批量编辑', defaultVal: 25 },
]

/** 陪伴模式供应商条目 */
export interface CompanionProviderEntry {
  key: string
  label: string
  type: 'cloud' | 'local' | 'custom'
}
