/**
 * initializeForms —— 注册全部表现形式（幂等，芽激活时调用一次）
 *
 * 批次 1 只注册标题式；句子式 / 表格式在批次 3 加入；线索式 / 进度式在 09-17 加入
 * （迁移原独立大纲视图的「情节线索 / 进度总览」两个页签）。
 * 注册表是唯一的扩展点：新增表现形式 = 注册一个 FormDefinition，编辑器无需改动。
 */
import TitleForm from './TitleForm.vue'
import CardForm from './CardForm.vue'
import TreeForm from './TreeForm.vue'
import SentenceForm from './SentenceForm.vue'
import TableForm from './TableForm.vue'
import StorylineForm from './StorylineForm.vue'
import ProgressForm from './ProgressForm.vue'
import OutlineRefsForm from './OutlineRefsForm.vue'
import { registerForm } from './registry'
import type { NumberingStyle } from './titleNumbering'

const NUMBERING_OPTIONS: Array<{ value: NumberingStyle; label: string }> = [
  { value: 'none', label: '无编号' },
  { value: 'numeric', label: '数字 1.2.3' },
  { value: 'chinese', label: '中文 一、（一）' },
  { value: 'roman', label: '罗马 I、II' },
]

/** 统计类形式共用的范围选项（口径：`this` = 本节点 + 其子树，**含自身**） */
const SCOPE_OPTIONS = [
  { value: 'all', label: '全部节点' },
  { value: 'this', label: '本节点及子树' },
]

let initialized = false

export function initializeForms(): void {
  if (initialized) return
  initialized = true

  registerForm({
    form: 'title',
    label: '标题式',
    // 图标名必须是 ui-kit lucideMap 里存在的 id（'list' 未注册 → 渲染为空）
    icon: 'list-ordered',
    kind: 'inline',
    description: '一行标题，可按层级缩进与编号',
    defaultHeight: 34,
    defaultConfig: {
      showDepth: true,
      numbering: 'numeric',
      showStatus: true,
      fontScale: 1,
      align: 'left',
      showBranch: false,
    },
    configSchema: [
      { key: 'showDepth', label: '显示层级缩进', type: 'boolean', default: true },
      {
        key: 'numbering',
        label: '编号样式',
        type: 'select',
        options: NUMBERING_OPTIONS.map(o => ({ value: o.value, label: o.label })),
        default: 'numeric',
      },
      { key: 'showStatus', label: '显示状态点', type: 'boolean', default: true },
      { key: 'fontScale', label: '字号倍数', type: 'number', default: 1 },
      {
        key: 'align',
        label: '对齐',
        type: 'select',
        options: [{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }],
        default: 'left',
      },
      { key: 'showBranch', label: '显示子节点数', type: 'boolean', default: false },
    ],
    component: TitleForm,
  })

  // 树式：承载原「大纲树视图」的浏览形态
  // （负责人 09-16 裁定：旧视图不删能力、改成为白板里的一个容器内容 —— 方案 C）
  registerForm({
    form: 'card',
    label: '卡片式',
    // 图标名必须是 ui-kit lucideMap 里存在的 id
    icon: 'notepad',
    kind: 'inline',
    description: '一张卡：标题 + 摘要 + 状态 + 标签（双击就地编辑）',
    defaultHeight: 92,
    defaultConfig: {
      showStatus: true,
      showTags: true,
      showWordCount: false,
      summaryLines: 2,
    },
    configSchema: [
      { key: 'showStatus', label: '显示状态点', type: 'boolean', default: true },
      { key: 'showTags', label: '显示标签', type: 'boolean', default: true },
      { key: 'showWordCount', label: '显示字数', type: 'boolean', default: false },
      { key: 'summaryLines', label: '摘要最多行数', type: 'number', default: 2 },
    ],
    component: CardForm,
  })

  registerForm({
    form: 'tree',
    label: '树式',
    icon: 'family-tree',
    kind: 'inline',
    description: '按层级展开的树，可折叠、可就地改名',
    defaultHeight: 160,
    defaultConfig: {
      scope: 'all',
      showStatus: true,
      numbering: 'none',
      indent: 14,
      maxHeight: 240,
    },
    configSchema: [
      {
        key: 'scope',
        label: '范围',
        type: 'select',
        options: [
          { value: 'all', label: '全部节点' },
          { value: 'this', label: '本节点子树' },
        ],
        default: 'all',
      },
      { key: 'showStatus', label: '显示状态点', type: 'boolean', default: true },
      {
        key: 'numbering',
        label: '编号样式',
        type: 'select',
        options: NUMBERING_OPTIONS.map(o => ({ value: o.value, label: o.label })),
        default: 'none',
      },
      { key: 'indent', label: '每层缩进', type: 'number', default: 14 },
      { key: 'maxHeight', label: '最大高度', type: 'number', default: 240 },
    ],
    component: TreeForm,
  })

  // 句子式：一句话概括（映射 description，就地型）
  // 规格：docs/plans/2026-09-16-大纲白板-表现形式规格.md §二
  registerForm({
    form: 'sentence',
    label: '句子式',
    icon: 'pen-line',
    kind: 'inline',
    description: '一句话摘要，可双击就地编辑',
    defaultHeight: 42,
    defaultConfig: {
      maxLines: 3,
      fontScale: 0.9,
      align: 'left',
      emphasis: 'muted',
      charLimit: 120,
      showQuoteMark: false,
    },
    configSchema: [
      { key: 'maxLines', label: '最多行数', type: 'number', default: 3 },
      { key: 'fontScale', label: '字号倍数', type: 'number', default: 0.9 },
      {
        key: 'align',
        label: '对齐',
        type: 'select',
        options: [{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }],
        default: 'left',
      },
      {
        key: 'emphasis',
        label: '强调',
        type: 'select',
        options: [
          { value: 'normal', label: '正常' },
          { value: 'italic', label: '斜体' },
          { value: 'muted', label: '弱化' },
        ],
        default: 'muted',
      },
      { key: 'charLimit', label: '字数软上限', type: 'number', default: 120 },
      { key: 'showQuoteMark', label: '加引号装饰', type: 'boolean', default: false },
    ],
    component: SentenceForm,
  })

  // 表格式：子节点一览（**派生型只读**）
  // 规格：§三 —— 必须复用 ui-kit 的 DataTable，不另造表格；表内不提供编辑
  // 注：`columns` 暂不进 configSchema —— configSchema 的字段类型尚不支持多选，
  // 首版按规格 §3.5-2「固定 3 列起步」处理，列选择后置。
  registerForm({
    form: 'table',
    label: '表格式',
    icon: 'task-plan',
    kind: 'derived',
    description: '子节点一览表（只读，随子节点增删自动更新）',
    defaultHeight: 120,
    defaultConfig: {
      columns: ['title', 'status', 'wordCount'],
      includeSelf: false,
      density: 'compact',
      maxHeight: 240,
    },
    configSchema: [
      { key: 'includeSelf', label: '包含本节点作首行', type: 'boolean', default: false },
      {
        key: 'density',
        label: '行密度',
        type: 'select',
        options: [{ value: 'compact', label: '紧凑' }, { value: 'standard', label: '标准' }],
        default: 'compact',
      },
      { key: 'maxHeight', label: '最大高度', type: 'number', default: 240 },
    ],
    component: TableForm,
  })

  // 线索式：按「所属线索」横向聚合（派生型只读）
  // 迁移自旧视图「情节线索」页签；数据源是节点的 properties.storylines，本形式不写数据
  registerForm({
    form: 'storyline',
    label: '线索式',
    icon: 'workflow',
    kind: 'derived',
    description: '按「所属线索」聚合：每条线索的节点与字数',
    defaultHeight: 120,
    defaultConfig: {
      scope: 'all',
      showCount: true,
      showWordCount: true,
      showNodes: true,
      maxHeight: 200,
    },
    configSchema: [
      { key: 'scope', label: '范围', type: 'select', options: SCOPE_OPTIONS, default: 'all' },
      { key: 'showCount', label: '显示节点数', type: 'boolean', default: true },
      { key: 'showWordCount', label: '显示字数', type: 'boolean', default: true },
      { key: 'showNodes', label: '显示节点标签', type: 'boolean', default: true },
      { key: 'maxHeight', label: '最大高度', type: 'number', default: 200 },
    ],
    component: StorylineForm,
  })

  // 进度式：节点数 / 字数 / 完成度 + 状态分布 + 线索分布（派生型只读）
  // 迁移自旧视图「进度总览」页签；scope='this' 时挂在「卷」容器上即每卷一张进度卡
  registerForm({
    form: 'progress',
    label: '进度式',
    icon: 'chart',
    kind: 'derived',
    description: '节点数 / 字数 / 完成度与分布（只读统计）',
    defaultHeight: 130,
    defaultConfig: {
      scope: 'all',
      showBar: true,
      showStatus: true,
      showStoryline: true,
      maxHeight: 220,
    },
    configSchema: [
      { key: 'scope', label: '范围', type: 'select', options: SCOPE_OPTIONS, default: 'all' },
      { key: 'showBar', label: '显示完成度进度条', type: 'boolean', default: true },
      { key: 'showStatus', label: '显示状态分布', type: 'boolean', default: true },
      { key: 'showStoryline', label: '显示线索分布', type: 'boolean', default: true },
      { key: 'maxHeight', label: '最大高度', type: 'number', default: 220 },
    ],
    component: ProgressForm,
  })

  // 关联实体徽章（派生型只读）—— 重建旧树视图的「关联实体徽章组」
  // 数据源**不是节点字段而是关系表**（`outline_mentions` / `outline_located_in` / `outline_covers`）。
  // **建立关联的入口有两个**：用户侧 = 节点详情「关联实体」区（`NodeRefsSection`，2026-10-08 起）；
  // Agent 侧 = 关系写入工具。属性面板无对应输入框——关系不是字段。
  registerForm({
    form: 'refs',
    label: '关联实体',
    icon: 'link',
    kind: 'derived',
    description: '本节点关联的角色 / 地点 / 事件等实体（点击跳转）',
    defaultHeight: 90,
    defaultConfig: {
      maxPerGroup: 4,
      // 2026-10-18：原文案「（可由 Agent 建立关联）」已过期——用户侧早就能加，读侧另做旧值自动升级
      emptyText: '暂无关联实体',
    },
    configSchema: [
      { key: 'maxPerGroup', label: '每组最多显示', type: 'number', default: 4 },
      { key: 'emptyText', label: '空态文案', type: 'text', default: '暂无关联实体' },
    ],
    component: OutlineRefsForm,
  })
}

/** 仅测试用：允许重新初始化 */
export function resetFormsInitialization(): void {
  initialized = false
}
