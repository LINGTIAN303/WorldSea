/** 输出块工具集：13 个交互式输出工具渲染 UI 组件，详细见 docs/details/注释/packages/agent-runtime/tools-output-tools.md */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'
import type { TableBlock, ChoiceBlock, CodeBlockData, EntityCardBlock, AlertBlock, StatBlock, ListBlock, ProgressBlock, ComparisonBlock, TimelineBlock, ImageBlock, AccordionBlock, ManuscriptBlock } from '../bridge-types'

/** 全局 Block ID 计数器，确保每个 block 的 ID 全局唯一 */
let blockCounter = 0

/** 生成下一个 Block ID，格式: {prefix}-{timestamp36}-{counter} */
function nextId(prefix: string): string {
  blockCounter++
  return `${prefix}-${Date.now().toString(36)}-${blockCounter}`
}

/**
 * output_table — 展示表格数据
 * columns 和 rows 参数接受 JSON 字符串或已解析数组
 */
export const outputTable: ToolDefinition = {
  name: 'output_table',
  description: '向用户展示结构化表格数据，渲染为可折叠的交互组件。当你需要展示数据对比、列表、属性等信息时，必须调用此工具而非使用 Markdown 表格。',
  parameters: {
    title: { type: 'string', description: '表格标题', required: false },
    columns: { type: 'string', description: '列定义的 JSON 数组字符串。每项包含 key(字段名)、label(显示名)、align(对齐方式，可选 left/center/right)。示例: [{"key":"name","label":"名称"},{"key":"value","label":"数值","align":"right"}]', required: true },
    rows: { type: 'string', description: '行数据的 JSON 数组字符串。每项是一个对象，key 与 columns 的 key 对应。示例: [{"name":"攻击力","value":85},{"name":"防御力","value":60}]', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'output',
    alwaysAvailable: true,
    displayName: '输出表格',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    let columns: TableBlock['columns']
    let rows: TableBlock['rows']

    try {
      columns = typeof args.columns === 'string' ? JSON.parse(args.columns) : args.columns as TableBlock['columns']
    } catch { return '错误：columns 参数必须是有效的 JSON 数组' }
    try {
      rows = typeof args.rows === 'string' ? JSON.parse(args.rows) : args.rows as TableBlock['rows']
    } catch { return '错误：rows 参数必须是有效的 JSON 数组' }

    if (!Array.isArray(columns) || columns.length === 0) return '错误：columns 必须是非空数组'
    if (!Array.isArray(rows)) return '错误：rows 必须是数组'

    const blockId = nextId('tbl')
    const block: TableBlock = {
      type: 'table', id: blockId,
      title: args.title ? String(args.title) : undefined,
      columns, rows,
      collapsible: true,
    }
    ctx.appendBlock?.(block)
    return `已创建表格组件"${block.title || '数据'}"(${block.rows.length}行×${block.columns.length}列)，组件会自动显示在消息中。无需在文本中重复表格内容。`
  },
}

/**
 * output_choice — 让用户做选择
 * 用户点击选项后自动回传选择结果给 Agent
 */
export const outputChoice: ToolDefinition = {
  name: 'output_choice',
  description: '向用户展示选项，用户点击后自动回传选择结果给 Agent。当你需要让用户做选择时，必须调用此工具而非用编号列表让用户手动输入。',
  parameters: {
    title: { type: 'string', description: '选择提示标题', required: false },
    mode: { type: 'string', description: 'single(单选) 或 multi(多选)', required: false, enum: ['single', 'multi'] },
    options: { type: 'string', description: '选项的 JSON 数组字符串。每项包含 value(选项值)、label(显示文本)、description(描述，可选)。示例: [{"value":"attack","label":"攻击","description":"对目标造成伤害"},{"value":"defend","label":"防御","description":"减少受到的伤害"}]', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'output',
    alwaysAvailable: true,
    displayName: '输出选择',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    let options: ChoiceBlock['options']
    try {
      options = typeof args.options === 'string' ? JSON.parse(args.options) : args.options as ChoiceBlock['options']
    } catch { return '错误：options 参数必须是有效的 JSON 数组' }

    if (!Array.isArray(options) || options.length === 0) return '错误：options 必须是非空数组'

    const blockId = nextId('ch')
    const block: ChoiceBlock = {
      type: 'choice', id: blockId,
      title: args.title ? String(args.title) : undefined,
      mode: (args.mode === 'multi' ? 'multi' : 'single') as ChoiceBlock['mode'],
      options, collapsible: false,
    }
    ctx.appendBlock?.(block)
    return `已创建选择组件"${block.title || '请选择'}"(${block.options.length}个选项)，用户点击后自动回传选择结果。`
  },
}

/** output_code — 展示语法高亮代码块 */
export const outputCode: ToolDefinition = {
  name: 'output_code',
  description: '向用户展示代码，带语法高亮和可选运行按钮。替代 Markdown 代码块，提供更好的展示效果。',
  parameters: {
    language: { type: 'string', description: '编程语言，如 typescript、python、json', required: true },
    code: { type: 'string', description: '代码内容', required: true },
    runnable: { type: 'boolean', description: '是否显示运行按钮（默认 false）', required: false },
  },
  meta: {
    permission: 'safe',
    category: 'output',
    alwaysAvailable: true,
    displayName: '输出代码',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const blockId = nextId('code')
    const block: CodeBlockData = {
      type: 'code', id: blockId,
      language: String(args.language),
      code: String(args.code),
      runnable: args.runnable === true,
      collapsible: true,
    }
    ctx.appendBlock?.(block)
    return `已创建代码组件(${block.language}, ${block.code.split('\n').length}行)，组件会自动显示在消息中。`
  },
}

/** output_entity_card — 展示实体信息卡片，需要先通过 entity_get 获取实体数据 */
export const outputEntityCard: ToolDefinition = {
  name: 'output_entity_card',
  description: '向用户展示实体信息卡片。如果实体不存在则返回错误。替代文本描述实体的方式。',
  parameters: {
    entityId: { type: 'string', description: '实体 ID', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'output',
    alwaysAvailable: true,
    displayName: '输出实体卡片',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const entityId = String(args.entityId)
    const entity = await ctx.stores.entity.getById(entityId)
    if (!entity) return JSON.stringify({ ok: false, error: `实体 ${entityId} 不存在` })
    const blockId = nextId('ec')
    const block: EntityCardBlock = {
      type: 'entity-card', id: blockId,
      entityId: entity.id, entityType: entity.type, name: entity.name,
      description: entity.description, tags: entity.tags,
      properties: entity.properties, collapsible: true,
    }
    ctx.appendBlock?.(block)
    return `已创建实体卡片组件"${block.name}"(${block.entityType})，组件会自动显示在消息中。`
  },
}

/** output_alert — 展示 info/success/warning/error 级别的提示 */
export const outputAlert: ToolDefinition = {
  name: 'output_alert',
  description: '向用户展示提示信息（info/success/warning/error）。当你需要提示、警告或确认反馈时，必须调用此工具而非在文本中写⚠️等符号。',
  parameters: {
    level: { type: 'string', description: '提示级别: info(信息)、success(成功)、warning(警告)、error(错误)', required: true, enum: ['info', 'success', 'warning', 'error'] },
    title: { type: 'string', description: '提示标题', required: false },
    message: { type: 'string', description: '提示内容', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'output',
    alwaysAvailable: true,
    displayName: '输出提示',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const levels = ['info', 'success', 'warning', 'error']
    const level = levels.includes(args.level as string) ? args.level as AlertBlock['level'] : 'info'
    const blockId = nextId('alert')
    const block: AlertBlock = {
      type: 'alert', id: blockId, level,
      title: args.title ? String(args.title) : undefined,
      message: String(args.message), collapsible: false,
    }
    ctx.appendBlock?.(block)
    return `已创建${level}提示组件，组件会自动显示在消息中。`
  },
}

/** output_stat — 展示统计指标卡片组 */
export const outputStat: ToolDefinition = {
  name: 'output_stat',
  description: '向用户展示统计指标卡片组。当你需要展示数字概览（如"共23个角色、8个地区"）时，必须调用此工具而非用文本罗列。',
  parameters: {
    title: { type: 'string', description: '统计标题', required: false },
    items: { type: 'string', description: '统计项的 JSON 数组字符串。每项包含 label(标签)、value(数值)、icon(图标，可选)、trend(趋势 up/down/flat，可选)。示例: [{"label":"角色","value":23,"icon":"👤","trend":"up"},{"label":"地区","value":8}]', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'output',
    alwaysAvailable: true,
    displayName: '输出统计',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    let items: StatBlock['items']
    try {
      items = typeof args.items === 'string' ? JSON.parse(args.items) : args.items as StatBlock['items']
    } catch { return '错误：items 参数必须是有效的 JSON 数组' }
    if (!Array.isArray(items) || items.length === 0) return '错误：items 必须是非空数组'
    const blockId = nextId('stat')
    const block: StatBlock = {
      type: 'stat', id: blockId,
      title: args.title ? String(args.title) : undefined,
      items, collapsible: true,
    }
    ctx.appendBlock?.(block)
    return `已创建统计组件"${block.title || '概览'}"(${block.items.length}项)，组件会自动显示在消息中。`
  },
}

/** output_list — 展示带图标的项目列表 */
export const outputList: ToolDefinition = {
  name: 'output_list',
  description: '向用户展示带图标的项目列表。当你需要展示角色列表、物品清单等轻量列表时，调用此工具。',
  parameters: {
    title: { type: 'string', description: '列表标题', required: false },
    items: { type: 'string', description: '列表项的 JSON 数组字符串。每项包含 icon(图标，可选)、label(标题)、description(描述，可选)、value(附加值，可选)。示例: [{"icon":"👤","label":"战士","description":"近战输出","value":"Lv.5"}]', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'output',
    alwaysAvailable: true,
    displayName: '输出列表',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    let items: ListBlock['items']
    try {
      items = typeof args.items === 'string' ? JSON.parse(args.items) : args.items as ListBlock['items']
    } catch { return '错误：items 参数必须是有效的 JSON 数组' }
    if (!Array.isArray(items) || items.length === 0) return '错误：items 必须是非空数组'
    const blockId = nextId('list')
    const block: ListBlock = {
      type: 'list', id: blockId,
      title: args.title ? String(args.title) : undefined,
      items, collapsible: true,
    }
    ctx.appendBlock?.(block)
    return `已创建列表组件"${block.title || '列表'}"(${block.items.length}项)，组件会自动显示在消息中。`
  },
}

/** output_progress — 展示进度条，用于长操作反馈 */
export const outputProgress: ToolDefinition = {
  name: 'output_progress',
  description: '向用户展示进度条。当执行长操作（一致性检查、导出、批量操作）时，调用此工具展示进度。',
  parameters: {
    label: { type: 'string', description: '进度标签', required: true },
    progress: { type: 'number', description: '进度百分比 0-100', required: true },
    status: { type: 'string', description: '状态: running(进行中)、completed(已完成)、failed(失败)', required: true, enum: ['running', 'completed', 'failed'] },
  },
  meta: {
    permission: 'safe',
    category: 'output',
    alwaysAvailable: true,
    displayName: '输出进度',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const progress = Math.max(0, Math.min(100, Number(args.progress) || 0))
    const statuses = ['running', 'completed', 'failed']
    const status = statuses.includes(args.status as string) ? args.status as ProgressBlock['status'] : 'running'
    const blockId = nextId('prog')
    const block: ProgressBlock = {
      type: 'progress', id: blockId,
      label: String(args.label), progress, status,
      collapsible: false,
    }
    ctx.appendBlock?.(block)
    return `已创建进度组件"${block.label}"(${block.progress}%, ${block.status})，组件会自动显示在消息中。`
  },
}

/** output_comparison — 展示两个实体的双栏对比视图 */
export const outputComparison: ToolDefinition = {
  name: 'output_comparison',
  description: '向用户展示两个实体的对比视图。当你需要对比角色、地区等实体时，调用此工具。',
  parameters: {
    title: { type: 'string', description: '对比标题', required: false },
    left: { type: 'string', description: '左侧实体的 JSON 对象。包含 label(名称) 和 items(属性键值对)。示例: {"label":"战士","items":{"攻击力":"85","防御力":"60"}}', required: true },
    right: { type: 'string', description: '右侧实体的 JSON 对象。格式同 left。示例: {"label":"法师","items":{"攻击力":"40","防御力":"30"}}', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'output',
    alwaysAvailable: true,
    displayName: '输出对比',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    let left: ComparisonBlock['left']
    let right: ComparisonBlock['right']
    try { left = typeof args.left === 'string' ? JSON.parse(args.left) : args.left as ComparisonBlock['left'] } catch { return '错误：left 参数必须是有效的 JSON 对象' }
    try { right = typeof args.right === 'string' ? JSON.parse(args.right) : args.right as ComparisonBlock['right'] } catch { return '错误：right 参数必须是有效的 JSON 对象' }
    if (!left?.label || !left?.items || !right?.label || !right?.items) return '错误：left 和 right 都必须包含 label 和 items 字段'
    const blockId = nextId('cmp')
    const block: ComparisonBlock = {
      type: 'comparison', id: blockId,
      title: args.title ? String(args.title) : undefined,
      left, right, collapsible: true,
    }
    ctx.appendBlock?.(block)
    return `已创建对比组件"${block.title || '对比'}"(${block.left.label} vs ${block.right.label})，组件会自动显示在消息中。`
  },
}

/** output_timeline — 展示时间线事件序列 */
export const outputTimeline: ToolDefinition = {
  name: 'output_timeline',
  description: '向用户展示时间线。当你需要展示事件序列、历史时间线时，调用此工具。',
  parameters: {
    title: { type: 'string', description: '时间线标题', required: false },
    events: { type: 'string', description: '事件的 JSON 数组字符串。每项包含 time(时间点)、label(事件名)、description(描述，可选)。示例: [{"time":"1000年","label":"建国","description":"阿尔王国建立"},{"time":"1050年","label":"战争","description":"与邻国爆发冲突"}]', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'output',
    alwaysAvailable: true,
    displayName: '输出时间线',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    let events: TimelineBlock['events']
    try { events = typeof args.events === 'string' ? JSON.parse(args.events) : args.events as TimelineBlock['events'] } catch { return '错误：events 参数必须是有效的 JSON 数组' }
    if (!Array.isArray(events) || events.length === 0) return '错误：events 必须是非空数组'
    const blockId = nextId('tl')
    const block: TimelineBlock = {
      type: 'timeline', id: blockId,
      title: args.title ? String(args.title) : undefined,
      events, collapsible: true,
    }
    ctx.appendBlock?.(block)
    return `已创建时间线组件"${block.title || '时间线'}"(${block.events.length}个事件)，组件会自动显示在消息中。`
  },
}

/** output_image — 展示图片（URL 或 base64） */
export const outputImage: ToolDefinition = {
  name: 'output_image',
  description: '向用户展示图片。当你需要展示图片时，调用此工具。',
  parameters: {
    src: { type: 'string', description: '图片 URL 或 base64 数据', required: true },
    alt: { type: 'string', description: '图片替代文本', required: false },
    caption: { type: 'string', description: '图片说明', required: false },
  },
  meta: {
    permission: 'safe',
    category: 'output',
    alwaysAvailable: true,
    displayName: '输出图片',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    if (!args.src || !String(args.src).trim()) return '错误：src 参数不能为空'
    const blockId = nextId('img')
    const block: ImageBlock = {
      type: 'image', id: blockId,
      src: String(args.src),
      alt: args.alt ? String(args.alt) : undefined,
      caption: args.caption ? String(args.caption) : undefined,
      collapsible: true,
    }
    ctx.appendBlock?.(block)
    return `已创建图片组件，组件会自动显示在消息中。`
  },
}

/** output_accordion — 展示可折叠内容区 */
export const outputAccordion: ToolDefinition = {
  name: 'output_accordion',
  description: '向用户展示可折叠的内容区。当你需要展示多个可独立展开/收起的内容段时，调用此工具。',
  parameters: {
    title: { type: 'string', description: '折叠区标题', required: false },
    sections: { type: 'string', description: '内容段的 JSON 数组字符串。每项包含 title(段标题) 和 content(段内容)。示例: [{"title":"背景","content":"这是一个古老的王国..."},{"title":"现状","content":"王国正处于内战..."}]', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'output',
    alwaysAvailable: true,
    displayName: '输出折叠面板',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    let sections: AccordionBlock['sections']
    try {
      sections = typeof args.sections === 'string' ? JSON.parse(args.sections) : args.sections as AccordionBlock['sections']
    } catch { return '错误：sections 参数必须是有效的 JSON 数组' }
    if (!Array.isArray(sections) || sections.length === 0) return '错误：sections 必须是非空数组'
    const blockId = nextId('acc')
    const block: AccordionBlock = {
      type: 'accordion', id: blockId,
      title: args.title ? String(args.title) : undefined,
      sections, collapsible: true,
    }
    ctx.appendBlock?.(block)
    return `已创建折叠区组件"${block.title || '详情'}"(${block.sections.length}段)，组件会自动显示在消息中。`
  },
}

/** output_manuscript — 文境面板（诗歌、铭文、书信等文学性内容） */
export const outputManuscript: ToolDefinition = {
  name: 'output_manuscript',
  description: '向用户展示文境面板——用于呈现诗歌、词赋、铭文、书信、歌词等文学性内容。支持竖式古排版、逐字入场动画和悬浮文字阴影。当输出的内容是"作品"（而非信息性文本）时，调用此工具。',
  parameters: {
    title: { type: 'string', description: '文境标题', required: false },
    content: { type: 'string', description: '文学文本内容', required: true },
    layout: { type: 'string', description: '排版模式: horizontal(横式) | vertical(竖式古排版)，默认 horizontal', required: false },
    animation: { type: 'string', description: '逐字入场动画: ink-drop(墨滴) | brush-stroke(笔触) | fade-in(渐显) | float-up(浮升)，默认 ink-drop', required: false },
    shadow: { type: 'string', description: '文字阴影: sunlight(阳光悬浮) | soft(柔和) | none(无)，默认 sunlight', required: false },
    decoration: { type: 'string', description: '装饰: seal(印章) | flourish(花饰) | border(边框) | none(无)，默认 none', required: false },
    fontSize: { type: 'string', description: '字号: sm | md | lg | xl，默认 md', required: false },
    fontFamily: { type: 'string', description: '字体名称（如 "Noto Serif SC"、"Georgia"），默认使用当前主题字体', required: false },
    textColor: { type: 'string', description: '文字颜色，CSS 颜色值。覆盖主题默认色。例: "#ffd700"(金色), "rgb(255,215,0)", "gold"。不填则使用主题默认。', required: false },
    background: { type: 'string', description: '容器背景，CSS background 值。覆盖主题默认背景。支持纯色和渐变。例: "#1a0a0a"(暗红), "linear-gradient(145deg, #1a0a0a, #2d0a0a)"。不填则使用主题默认。', required: false },
    backgroundImage: { type: 'string', description: '容器背景图片。支持以下格式：1) 网络 URL（https://example.com/bg.jpg）；2) 本地绝对路径（D:\\images\\parchment.jpg 或 /home/user/bg.png）；3) 本地相对路径（./assets/bg.jpg，相对于项目目录）；4) Data URI（data:image/png;base64,...）。支持静态图片（png/jpg/webp/svg/bmp/avif）和动图（gif）。图片以 cover 模式铺满容器。设置后覆盖 background 渐变。', required: false },
    backgroundOverlay: { type: 'string', description: '背景图片上的遮罩层颜色，CSS 颜色值。当背景图片导致文字不可读时务必设置。强烈建议：使用背景图片时，若文字颜色与图片色调相近（如浅色文字+浅色图片、深色文字+深色图片），应设置此参数添加半透明遮罩。例: "rgba(0,0,0,0.4)"(深色遮罩), "rgba(255,255,255,0.3)"(浅色遮罩), "rgba(0,0,0,0.5)"(强遮罩)。不填则无遮罩。', required: false },
    shadowColor: { type: 'string', description: '阴影颜色，CSS 颜色值。覆盖阴影预设的颜色，不影响偏移和模糊。例: "rgba(255,200,0,0.3)"(金色光晕), "#ff0000"(红色阴影)。不填则使用预设默认色。', required: false },
    shadowOffset: { type: 'string', description: '阴影偏移，格式 "Xpx Ypx"。覆盖预设偏移方向。例: "2px 3px"(右下), "-1px -1px"(左上), "0px 4px"(正下方)。不填则使用预设默认偏移。', required: false },
    shadowBlur: { type: 'number', description: '阴影模糊半径(px)。覆盖预设模糊值。值越大阴影越柔和。例: 4(锐利), 12(柔和), 24(弥散)。不填则使用预设默认值。', required: false },
    fontWeight: { type: 'string', description: '字重。例: "300"(细体), "400"(常规), "700"(粗体), "900"(黑体)。不填则使用默认。', required: false },
    fontStyle: { type: 'string', description: '字体样式: normal(正常) | italic(斜体)。默认 normal。', required: false, enum: ['normal', 'italic'] },
    letterSpacing: { type: 'string', description: '字间距，CSS letter-spacing 值。例: "0.2em"(宽松), "0.05em"(紧凑), "4px"(固定间距)。不填则使用默认。', required: false },
    lineHeight: { type: 'string', description: '行高，CSS line-height 值。例: "1.8"(紧凑), "2.5"(宽松), "3"(极宽)。不填则使用默认。', required: false },
    width: { type: 'number', description: '容器初始宽度(px)。不填则自适应内容。例: 480, 600。', required: false },
    height: { type: 'number', description: '容器初始高度(px)。不填则自适应内容。例: 320, 400。', required: false },
  },
  meta: {
    permission: 'safe',
    category: 'output',
    displayName: '输出文境',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    if (!args.content || typeof args.content !== 'string') {
      return '错误：content 参数不能为空'
    }
    const layout = args.layout === 'vertical' ? 'vertical' : 'horizontal'
    const validAnims = ['ink-drop', 'brush-stroke', 'fade-in', 'float-up'] as const
    const animation = validAnims.includes(args.animation as typeof validAnims[number]) ? args.animation as typeof validAnims[number] : 'ink-drop'
    const validShadows = ['sunlight', 'soft', 'none'] as const
    const shadow = validShadows.includes(args.shadow as typeof validShadows[number]) ? args.shadow as typeof validShadows[number] : 'sunlight'
    const validDecos = ['seal', 'flourish', 'border', 'none'] as const
    const decoration = args.decoration && validDecos.includes(args.decoration as typeof validDecos[number]) ? args.decoration as typeof validDecos[number] : 'none'
    const validSizes = ['sm', 'md', 'lg', 'xl'] as const
    const fontSize = args.fontSize && validSizes.includes(args.fontSize as typeof validSizes[number]) ? args.fontSize as typeof validSizes[number] : 'md'

    const blockId = nextId('msc')
    const block: ManuscriptBlock = {
      type: 'manuscript', id: blockId,
      title: args.title ? String(args.title) : undefined,
      content: String(args.content),
      layout, animation, shadow, decoration, fontSize,
      fontFamily: args.fontFamily ? String(args.fontFamily) : undefined,
      collapsible: true,
      textColor: args.textColor ? String(args.textColor) : undefined,
      background: args.background ? String(args.background) : undefined,
      backgroundImage: args.backgroundImage ? String(args.backgroundImage) : undefined,
      backgroundOverlay: args.backgroundOverlay ? String(args.backgroundOverlay) : undefined,
      shadowColor: args.shadowColor ? String(args.shadowColor) : undefined,
      shadowOffset: args.shadowOffset ? String(args.shadowOffset) : undefined,
      shadowBlur: typeof args.shadowBlur === 'number' ? args.shadowBlur : undefined,
      fontWeight: args.fontWeight ? String(args.fontWeight) : undefined,
      fontStyle: args.fontStyle === 'italic' ? 'italic' : undefined,
      letterSpacing: args.letterSpacing ? String(args.letterSpacing) : undefined,
      lineHeight: args.lineHeight ? String(args.lineHeight) : undefined,
      width: typeof args.width === 'number' ? args.width : undefined,
      height: typeof args.height === 'number' ? args.height : undefined,
    }
    ctx.appendBlock?.(block)
    return `已创建文境"${block.title || '文稿'}"（${layout === 'vertical' ? '竖式' : '横式'}排版，${animation}动画），组件会自动显示在消息中。`
  },
}

/** 所有 13 个输出工具的集合 */
export const outputTools: ToolDefinition[] = [
  outputTable, outputChoice, outputCode,
  outputEntityCard, outputAlert, outputStat,
  outputList, outputProgress, outputComparison,
  outputTimeline, outputImage, outputAccordion,
  outputManuscript,
]
