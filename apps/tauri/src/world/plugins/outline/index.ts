import type { WorldPluginApi } from '../../api'
// 原 OutlineView（独立树视图）已于 2026-09-16 下线：其浏览形态由白板内的「树式」表现形式承载，
// 层级重排由右栏树承载（负责人裁定：旧视图不删能力、改为成为白板里的一个容器内容）
import BoardView from './board/BoardView.vue'

export const manifest = {
  id: 'official.outline',
  name: '大纲',
  version: '2.0.0',
  description: '大纲管理与章节规划',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerEntityV2({
    type: 'outline_node',
    label: '大纲节点',
    icon: 'outline',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'visual' },
      // 2026-09-18（Q6-B）：**不再复用 `narrative` trait**。
      // 该 trait 声明 `content` / `wordCount` / `sortOrder` 三个字段，但它被
      // manuscript（章节正文）与 notebook（笔记正文）共用 —— 那两个芽确实需要 `content`；
      // 而大纲节点（Q1 已裁定为**纯结构层**）对 `content` 与 `sortOrder`
      // **既无写入口也无消费方**（逐处取证见施工分解 §十九）。
      // 继续共享它等于让 schema 一直声明两个用不上的字段，故改为只取真正在用的
      // `wordCount`（进度式 / 线索式统计消费），移入 ownFields。
      { traitId: 'deteriorable', fieldOverrides: {
        condition: { label: '状态', options: ['未写', '草稿', '完成'].map(s => ({ value: s, label: s })) },
      } },
    ],
    ownFields: [
      { key: 'parentId', label: '父节点ID', fieldType: 'text' },
      { key: 'storylines', label: '所属线索', fieldType: 'text' },
      { key: 'manuscriptId', label: '关联章节ID', fieldType: 'text' },
      // 原由 narrative trait 提供；语义是**规划期人工预估**（≠ manuscript 的机器统计字数）
      { key: 'wordCount', label: '字数（预估）', fieldType: 'number' },
      // 2026-09-18（Q6-①）：此前是「自由写入」字段 —— Agent 侧 `create_node`/`batch_create`
      // 会写它、`get_structure` 会返回它、SKILL.md 也记载它，但**从未注册**，
      // 且 UI 里完全不可见（属性面板补了编辑入口，见 NodeDetailView——2026-10-08 详情分层后随载体呈现）。
      // 取值保留英文四值（Agent 工具与 SKILL.md 已按此口径），中文只作显示标签。
      {
        key: 'nodeType',
        label: '节点类型',
        fieldType: 'select',
        options: [
          { value: 'act', label: '幕' },
          { value: 'sequence', label: '序列' },
          { value: 'scene', label: '场景' },
          { value: 'beat', label: '节拍' },
        ],
      },
      // 2026-10-19：问题式表现形式的承载字段——「这一节要回答什么问题？」
      // 理论取值清单里的「问题式」此前未实现；该字段只有问题式写入，其它形式不读。
      { key: 'question', label: '问题', fieldType: 'text' },
    ],
  })

  // ── 白板（2026-09-16 批次 1）─────────────────────────────
  // 白板实体：容器/组件/视口都落在 properties（照 drawing 画板芽先例）；
  // 节点内容仍由 outline_node 派生，白板只记「哪个节点、什么表现形式、放在哪」。
  // 规格：docs/plans/2026-09-15-大纲芽重构-理论基线与现状.md §8.10.2
  api.registerEntityV2({
    type: 'outline_board',
    label: '大纲白板',
    icon: 'outline',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'visual' },
    ],
    // identifiable 已提供 name/description，故此处只列白板专有字段
    ownFields: [
      { key: 'viewport', label: '视口', fieldType: 'text' },
      { key: 'layout', label: '布局体', fieldType: 'text' },
      { key: 'thumbnail', label: '缩略图', fieldType: 'text' },
      { key: 'snap', label: '吸附模式', fieldType: 'text' },
      { key: 'gridEnabled', label: '网格', fieldType: 'boolean' },
    ],
  })

  // ── 唯一「大纲」视图（2026-09-16 入口整合）────────────────
  // 视图 id 复用 'outline'：侧栏顺序持久化的是**视图 id 列表**（uiStore.sidebarOrder →
  // localStorage），复用 id 可无缝接管原入口的位置与实体 type→view 映射，不留未知 id 残渣。
  api.registerView({
    id: 'outline',
    label: '大纲',
    icon: 'outline',
    component: BoardView,
  })
}

export default { manifest, apply }
