/**
 * initializeForms —— 注册全部表现形式（幂等，芽激活时调用一次）
 *
 * 批次 1 只注册标题式；句子式 / 表格式在批次 3 加入（同一入口追加即可，编辑器无需改动）。
 * 注册表是唯一的扩展点：新增表现形式 = 注册一个 FormDefinition。
 */
import TitleForm from './TitleForm.vue'
import TreeForm from './TreeForm.vue'
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
    icon: 'list',
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
}

/** 仅测试用：允许重新初始化 */
export function resetFormsInitialization(): void {
  initialized = false
}
