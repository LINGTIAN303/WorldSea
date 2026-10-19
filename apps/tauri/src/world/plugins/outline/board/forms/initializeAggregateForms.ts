/**
 * initializeAggregateForms —— 注册**聚合视图型**表现形式（五视图）
 *
 * 2026-10-19（信息密度增强批）：从 `initializeForms.ts` 拆出。
 * 拆分原因：五视图接入密度配置后，原文件将突破 400 行硬上限（arch:check）；
 * 按「内容型 / 聚合型」切分是既有语义的自然分界，注册表契约不变。
 *
 * 五视图的统一判断框架（2026-10-19）：都是聚合视图，区别只在**聚合轴**——
 * 表格式 = 子节点 × 多字段 / 树式 = 子节点 × 层级 / 线索式 = 全库 × storylines /
 * 进度式 = 子节点 × status / 关联实体 = 本节点 × 关系。
 */
import TreeForm from './TreeForm.vue'
import TableForm from './TableForm.vue'
import StorylineForm from './StorylineForm.vue'
import ProgressForm from './ProgressForm.vue'
import OutlineRefsForm from './OutlineRefsForm.vue'
import { registerForm } from './registry'
import {
  COUNT_LIMIT_OPTIONS,
  LINE_LIMIT_OPTIONS,
  NUMBERING_OPTIONS,
  SCOPE_OPTIONS,
} from './formOptions'

/** 注册五视图（幂等由 registerForm 保证） */
export function registerAggregateForms(): void {
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
      // 2026-10-19（信息密度）：初始展开层数；此前硬编码为 2
      expandDepth: '2',
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
      {
        key: 'expandDepth',
        label: '初始展开层数',
        type: 'select',
        options: [
          { value: '0', label: '全部折叠' },
          { value: '1', label: '1 层' },
          { value: '2', label: '2 层' },
          { value: '3', label: '3 层' },
          { value: 'all', label: '全部展开' },
        ],
        default: '2',
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
      sortBy: 'order',
    },
    configSchema: [
      {
        key: 'columns',
        label: '显示列',
        type: 'multi-select',
        minSelected: 1,
        // 顺序即列序（固定，不由勾选先后决定）
        options: [
          { value: 'title', label: '标题' },
          { value: 'order', label: '序号' },
          { value: 'status', label: '状态' },
          { value: 'wordCount', label: '字数' },
          { value: 'nodeType', label: '节点类型' },
          { value: 'storylines', label: '所属线索' },
        ],
        default: ['title', 'status', 'wordCount'],
      },
      { key: 'includeSelf', label: '包含本节点作首行', type: 'boolean', default: false },
      {
        key: 'density',
        label: '行密度',
        type: 'select',
        options: [{ value: 'compact', label: '紧凑' }, { value: 'standard', label: '标准' }],
        default: 'compact',
      },
      { key: 'maxHeight', label: '最大高度', type: 'number', default: 240 },
      {
        key: 'sortBy',
        label: '排序',
        type: 'select',
        default: 'order',
        options: [
          { value: 'order', label: '按序号' },
          { value: 'status', label: '按状态（未写→完成）' },
          { value: 'wordCount', label: '按字数（多→少）' },
        ],
      },
    ],
    component: TableForm,
  })

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
      // 2026-10-19（信息密度）：行数 / 每条线索的节点标签数 / 排序
      maxLines: 'all',
      maxTags: 'all',
      sortBy: 'name',
    },
    configSchema: [
      { key: 'scope', label: '范围', type: 'select', options: SCOPE_OPTIONS, default: 'all' },
      { key: 'showCount', label: '显示节点数', type: 'boolean', default: true },
      { key: 'showWordCount', label: '显示字数', type: 'boolean', default: true },
      { key: 'showNodes', label: '显示节点标签', type: 'boolean', default: true },
      {
        key: 'maxLines',
        label: '最多显示线索数',
        type: 'select',
        options: LINE_LIMIT_OPTIONS,
        default: 'all',
      },
      {
        key: 'maxTags',
        label: '每条线索最多节点',
        type: 'select',
        options: COUNT_LIMIT_OPTIONS,
        default: 'all',
      },
      {
        key: 'sortBy',
        label: '排序',
        type: 'select',
        options: [
          { value: 'name', label: '按名称（拼音）' },
          { value: 'count', label: '按节点数（多→少）' },
          { value: 'wordCount', label: '按字数（多→少）' },
        ],
        default: 'name',
      },
      { key: 'maxHeight', label: '最大高度', type: 'number', default: 200 },
    ],
    component: StorylineForm,
  })

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
      // 2026-10-19（信息密度）：线索分布最多显示几行
      maxStorylines: 'all',
    },
    configSchema: [
      { key: 'scope', label: '范围', type: 'select', options: SCOPE_OPTIONS, default: 'all' },
      { key: 'showBar', label: '显示完成度进度条', type: 'boolean', default: true },
      { key: 'showStatus', label: '显示状态分布', type: 'boolean', default: true },
      { key: 'showStoryline', label: '显示线索分布', type: 'boolean', default: true },
      {
        key: 'maxStorylines',
        label: '最多显示线索数',
        type: 'select',
        options: COUNT_LIMIT_OPTIONS,
        default: 'all',
      },
      { key: 'maxHeight', label: '最大高度', type: 'number', default: 220 },
    ],
    component: ProgressForm,
  })

  registerForm({
    form: 'refs',
    label: '关联实体',
    icon: 'link',
    kind: 'derived',
    description: '本节点关联的角色 / 地点 / 事件等实体（点击跳转）',
    defaultHeight: 90,
    defaultConfig: {
      maxPerGroup: 4,
      // 2026-10-19（信息密度）：最多显示几组
      maxGroups: 'all',
      emptyText: '暂无关联实体',
    },
    configSchema: [
      { key: 'maxPerGroup', label: '每组最多显示', type: 'number', default: 4 },
      {
        key: 'maxGroups',
        label: '最多显示分组数',
        type: 'select',
        options: COUNT_LIMIT_OPTIONS,
        default: 'all',
      },
      { key: 'emptyText', label: '空态文案', type: 'text', default: '暂无关联实体' },
    ],
    component: OutlineRefsForm,
  })
}
