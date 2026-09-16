/**
 * initializeForms —— 注册全部表现形式（幂等，芽激活时调用一次）
 *
 * 批次 1 只注册标题式；句子式 / 表格式在批次 3 加入（同一入口追加即可，编辑器无需改动）。
 * 注册表是唯一的扩展点：新增表现形式 = 注册一个 FormDefinition。
 */
import TitleForm from './TitleForm.vue'
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
}

/** 仅测试用：允许重新初始化 */
export function resetFormsInitialization(): void {
  initialized = false
}
