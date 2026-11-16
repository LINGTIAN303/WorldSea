/**
 * initializeForms —— 注册**内容型**表现形式（幂等，芽激活时调用一次）
 *
 * 2026-10-19（信息密度增强批）：按「内容型 / 聚合视图型」拆为两个文件。
 * 本文件保留标题/卡片/问题/段落/脚本/句子六种；五视图见 `initializeAggregateForms.ts`。
 * 拆分原因：五视图接入密度配置后，单文件将突破 400 行硬上限（arch:check）。
 * 注册表仍是唯一扩展点：新增表现形式 = 注册一个 FormDefinition。
 */
import TitleForm from './TitleForm.vue'
import CardForm from './CardForm.vue'
import QuestionForm from './QuestionForm.vue'
import ParagraphForm from './ParagraphForm.vue'
import ScriptForm from './ScriptForm.vue'
import SentenceForm from './SentenceForm.vue'
import { registerForm, getAllForms, type FormDefinition } from './registry'
import { registerAggregateForms } from './initializeAggregateForms'
import { NUMBERING_OPTIONS } from './formOptions'

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
    form: 'question',
    label: '问题式',
    icon: 'lightbulb',
    kind: 'inline',
    description: '一个节点 = 一个要回答的问题（双击就地编辑）',
    defaultHeight: 48,
    defaultConfig: {
      showStatus: true,
      showAnswer: true,
      showAnswerMark: false,
    },
    configSchema: [
      { key: 'showStatus', label: '显示状态点', type: 'boolean', default: true },
      { key: 'showAnswer', label: '显示回答区', type: 'boolean', default: true },
      { key: 'showAnswerMark', label: '显示「答」字标', type: 'boolean', default: false },
    ],
    component: QuestionForm,
  })

  registerForm({
    form: 'paragraph',
    label: '段落式',
    icon: 'align-left',
    kind: 'inline',
    description: '一段正文（多行，双击就地编辑；Q1′ 后复活）',
    defaultHeight: 96,
    defaultConfig: {
      maxLines: 6,
      fontScale: 1,
      align: 'left',
    },
    configSchema: [
      { key: 'maxLines', label: '最多显示行数', type: 'number', default: 6 },
      { key: 'fontScale', label: '字号倍数', type: 'number', default: 1 },
      {
        key: 'align',
        label: '对齐',
        type: 'select',
        default: 'left',
        options: [{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }],
      },
    ],
    component: ParagraphForm,
  })

  registerForm({
    form: 'script',
    label: '脚本式',
    icon: 'scroll',
    kind: 'inline',
    description: '一场戏：场景 + 台词 + 动作（三段各自就地编辑）',
    defaultHeight: 120,
    defaultConfig: {
      showDialogue: true,
      showAction: true,
    },
    configSchema: [
      { key: 'showDialogue', label: '显示台词段', type: 'boolean', default: true },
      { key: 'showAction', label: '显示动作段', type: 'boolean', default: true },
    ],
    component: ScriptForm,
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

  // 聚合视图型（表格式 / 树式 / 线索式 / 进度式 / 关联实体）
  registerAggregateForms()
}

/**
 * 把已注册的全部表现形式**提升到平台贡献位**（`api.registerForm`）。
 *
 * 为什么要这一步：上面的 `registerForm` 写进的是平台注册表，但**不带 pluginId**，
 * 因此不会随插件卸载回卷。真正作为「插件贡献」登记应当走 `api.registerForm`——
 * 它会回填 pluginId，使 `unloadPlugin` 能精确撤掉本插件的形式。
 *
 * 由 `outline` 的 `apply` 调用（幂等：先确保内置形式已注册，再逐条提升）。
 * 拆成独立函数而不是塞进 `apply`，是为了让「注册表内容」与「贡献位登记」两件事分开测。
 */
export function publishFormsToPluginApi(api: { registerForm: (def: FormDefinition) => void }): void {
  initializeForms()
  for (const def of getAllForms()) api.registerForm(def)
}

/** 仅测试用：允许重新初始化 */
export function resetFormsInitialization(): void {
  initialized = false
}
