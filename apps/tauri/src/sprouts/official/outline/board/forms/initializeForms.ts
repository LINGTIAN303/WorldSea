/**
 * initializeForms —— 注册全部表现形式（幂等，芽激活时调用一次）
 *
 * 批次 1 只注册标题式；句子式 / 表格式在批次 3 加入（同一入口追加即可，编辑器无需改动）。
 * 注册表是唯一的扩展点：新增表现形式 = 注册一个 FormDefinition。
 */
import TitleForm from './TitleForm.vue'
import TreeForm from './TreeForm.vue'
import SentenceForm from './SentenceForm.vue'
import TableForm from './TableForm.vue'
import { registerForm } from './registry'
import type { NumberingStyle } from './titleNumbering'

const NUMBERING_OPTIONS: Array<{ value: NumberingStyle; label: string }> = [
  { value: 'none', label: '无编号' },
  { value: 'numeric', label: '数字 1.2.3' },
  { value: 'chinese', label: '中文 一、（一）' },
  { value: 'roman', label: '罗马 I、II' },
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
}

/** 仅测试用：允许重新初始化 */
export function resetFormsInitialization(): void {
  initialized = false
}
