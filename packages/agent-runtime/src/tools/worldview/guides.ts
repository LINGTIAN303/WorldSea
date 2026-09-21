/**
 * 世界观芽「使用方法」概述数据（id 键控）
 *
 * 中性撰写规范（见 docs/plans/2026-09-21-世界观芽工具整合.md §三）：
 * 只陈述事实——能力、参数、数据模型约束、边界；
 * 不出现推荐 / 优先 / 建议 / 应该等引导词，不含输出渠道偏好与方法论断言。
 *
 * 素材来源（批 2，2026-09-21）：18 条自芽专属 SKILL.md 中性化迁移
 * （含与实体/关系注册表、动作表实况的逐项核对——如 building 的 `contains`
 * 在注册表中是「建筑→道具」、apparel 已无独立实体类型）；9 条无专属说明的芽新补。
 * 由 `worldview.spec.ts` 的中性禁词守卫持续看护。
 *
 * 零漂移轮（2026-09-21）：字段清单不再手写——由 `render.ts` 按芽 id 从运行时
 * `entitySchemaRegistry` 生成「实体字段（运行时）」段；此处只保留定位 / 语义 /
 * 关系 / 约束（守卫：guides 不含「——字段：」）。
 * 例外：module-builder 的 custom_module 无运行时实体类型注册，字段说明保留手写。
 */

export interface SproutGuide {
  /** 概述文本（Markdown）：定位 / 实体 / 关系 / 约束 */
  overview: string
}

export const SPROUT_GUIDES: Record<string, SproutGuide> = {
  // ────────────────────────────────────────────
  // 大纲与叙事
  // ────────────────────────────────────────────
  'official.outline': {
    overview: [
      '大纲节点与叙事结构的维护；白板视图提供容器的平铺编排（位置 / 区 / 缩放为呈现层数据）。',
      '',
      '实体：outline_node（大纲节点）、outline_board（白板布局）。摘要写实体 description（传 summary 等价）；层级以 parentId + order 为读取事实源（parentId 空串 = 根节点），parent_child 关系随写入同步维护。',
      '',
      '关联实体（三条语义化关系）：outline_mentions（提及——角色 / 道具 / 概念 / 组织 / 物种 / 语言 / 技能 / 建筑 / 文化 / 植物 / 战力 / 素材）、outline_located_in（发生于——区域 / 建筑）、outline_covers（承载——事件 / 冲突）。',
      '',
      '约束：delete_node 连同子树一起删除；parentId 无效时静默落到根节点（不报错）；move_node 需同时给出 newParentId 与 position（0 基索引，缺省追加到末尾）；update_node 为增量修改（未提及的字段保持不动）。',
    ].join('\n'),
  },

  // ────────────────────────────────────────────
  // 写作与笔记
  // ────────────────────────────────────────────
  'official.notebook': {
    overview: [
      'Markdown 笔记的创建、组织与引用。',
      '',
      '实体：notebook（笔记）。',
      '',
      '关系：note_link（笔记链接，渲染为可点击引用）。',
      '',
      '补充：代码单元格执行（JavaScript / Python，取决于运行环境）；导出 markdown / html / pdf。',
    ].join('\n'),
  },
  'official.manuscript': {
    overview: [
      '章节正文的写作与管理。',
      '',
      '实体：manuscript（章节）、book（书籍）；章节经 bookId 归属书籍（不传 = 未归书章节），删书不删章（bookId 置空）。',
      '',
      '能力：章节创建 / 更新 / 列表 / 内容读取；实体引用插入（insert_mention，渲染为链接标注）；章节排序与拆分；导出（html / pdf / markdown / docx，可选章节范围）。',
    ].join('\n'),
  },

  // ────────────────────────────────────────────
  // 世界观实体类芽
  // ────────────────────────────────────────────
  'official.characters': {
    overview: [
      '角色档案的管理。',
      '',
      '实体：character（角色）。',
      '',
      '关系（人物域）：knows（认识，对称）/ parent_of（父母，指向子女）/ mentor_of（导师，指向学生）/ ally_of（盟友）/ rival_of（对手）/ spouse_of（配偶）/ sibling_of（兄弟姐妹）/ belongs_to（属于——物种 / 组织）/ resides_in（居住于——区域）/ participated_in（参与——事件）/ associated_with（关联——概念）/ born_in（诞生于——事件）/ died_in（消亡于——事件）。',
      '',
      '约束：非对称关系方向不可反转（parent_of 从父指向子、mentor_of 从师指向徒）；对称关系写一侧即成立。',
    ].join('\n'),
  },
  'official.culture': {
    overview: [
      '文化条目的维护。',
      '',
      '实体：culture（文化）。',
      '',
      '关系：practiced_in（流行地——区域）/ practiced_by（所属——物种）/ promoted_by（推行组织）/ origin_event（起源事件——事件）。',
    ].join('\n'),
  },
  'official.languages': {
    overview: [
      '虚构语言与文字系统的维护。',
      '',
      '实体：language（语言）。',
      '',
      '关系：spoken_by（使用者——物种 / 角色）/ spoken_in（通行区域——区域）/ language_branch（语系分支，从子语言指向父语言）/ related_language（关联语言：同源 / 借词 / 混合 / 变体 / 祖先语言）/ script_used_in（文字用于——概念）。',
      '',
      '约束：language_branch 方向为子→父；related_language 用于非层级关联（不替代语系分支）。',
    ].join('\n'),
  },
  'official.conflict': {
    overview: [
      '冲突与战争史的维护。',
      '',
      '实体：conflict（冲突）。',
      '',
      '关系：participant_force（参战势力——组织）/ participant_commander（指挥官——角色）/ battlefield（战场——区域）/ related_event（关联事件——事件）/ legendary_item（传奇兵器——道具）/ sub_conflict（子战役，从父冲突指向子冲突）。',
      '',
      '约束：startDate 不晚于 endDate；子战役的时间范围在父冲突范围内。',
    ].join('\n'),
  },
  'official.buildings': {
    overview: [
      '建筑与场所的维护。',
      '',
      '实体：building（建筑）。',
      '',
      '关系：located_in（位于——区域）/ belongs_to_org（所属——组织）/ owned_by（拥有者——角色 / 组织）/ managed_by（管理者——角色）/ resident（居住者——角色）/ connected_to（连接——建筑↔建筑，对称）/ stored_at（存放——道具）/ event_location（事件发生地——事件）。',
      '',
      '约束：connected_to 为对称关系（写一侧即双向）。',
    ].join('\n'),
  },
  'official.items': {
    overview: [
      '道具与物品的维护。',
      '',
      '实体：item（道具）。',
      '',
      '关系：possessed_by（持有者——角色，含获得 / 失去时间）/ kept_at（存放地——建筑 / 区域）/ used_in（用于——事件 / 技能）/ created_by（制作者）/ related_item（关联道具：同一套 / 相克 / 相生 / 仿制品 / 原材料 / 升级形态 / 同源）/ enchanted_with（附魔——技能）/ combat_bonus（战力加成——战力条目）。',
    ].join('\n'),
  },
  'official.concepts': {
    overview: [
      '世界观概念与设定的维护。',
      '',
      '实体：concept（概念）。',
      '',
      '关系：references（引用）/ contradicts（矛盾，可携带矛盾说明）/ broader_than（上位概念，从下位指向上位）/ inspired_by（灵感来源）。',
      '',
      '约束：broader_than 方向为下位→上位。',
    ].join('\n'),
  },
  'official.combat_stats': {
    overview: [
      '战力体系与层级数值的维护。',
      '',
      '实体：combat_stat（战力条目）。',
      '',
      '关系：current_realm（当前境界，从战力条目指向角色）/ required_skill（所需技能——技能）/ training_ground（修炼圣地——区域）/ breakthrough_item（突破道具——道具）/ racial_cap（种族上限——物种）。',
    ].join('\n'),
  },
  'official.magic': {
    overview: [
      '技能节点与树结构的维护。',
      '',
      '实体：magic（技能）。parentId 为 root 表示根技能。',
      '',
      '关系（魔法域）：based_on（基于——技能）/ upgrades_to（进阶为——技能）/ counters（克制——技能）/ requires_item（需要媒介——道具）/ mastered_by（掌握者——角色）/ racial_ability（种族天赋——物种）。',
      '',
      '约束：delete_skill_node 连同子节点一起删除；validate_tree 的检查维度为深度分布 / 花费梯度 / 收益曲线；check_dependencies 检查前置依赖是否满足。',
    ].join('\n'),
  },
  'official.inspiration': {
    overview: [
      '创作灵感与参考素材的收集管理。',
      '',
      '实体：inspiration（素材）。',
      '',
      '关系：inspires（灵感来源，从素材指向被启发的实体——角色 / 区域 / 事件 / 道具 / 概念 / 组织）。',
      '',
      '补充：外部参考内容可经 web_search / web_fetch 获取；概念图生成可经 image_generate 执行。',
    ].join('\n'),
  },

  // ────────────────────────────────────────────
  // 时间 / 图谱 / 导图
  // ────────────────────────────────────────────
  'official.timeline': {
    overview: [
      '叙事时间线：事件编年与可视化。',
      '',
      '实体：event（事件）。date 支持精确日期、模糊日期与相对日期；dateEnd 用于持续事件。',
      '',
      '关系（时间域）：causes（导致）/ parallel_to（并行）/ happened_in（发生在——区域）/ occurred_at（发生地——建筑）/ involves（涉及——角色 / 组织）。',
      '',
      '视图：水平甘特图 / 垂直树形；泳道分组（character / location / era / tag / none）；缩放级（era / decade / year / month / day）；折叠展开。detect_conflicts 按阈值天数（默认 30）扫描日期相近的事件。',
      '',
      '约束：事件日期在所属年代范围内；era 之间不重叠。',
    ].join('\n'),
  },
  'official.graph': {
    overview: [
      '实体与关系的全局图谱视图与探索。',
      '',
      '图谱是实体（节点）与关系（边）的投影——节点来自各芽实体，边来自关系表；该芽无专属实体类型，数据经通用实体 / 关系工具读写。',
      '',
      '能力：节点 / 边查询（按类型 / 关键词 / 源目标过滤）；路径查找（find_path）；聚类分析（louvain / label_propagation / k_means）；子图搜索（中心节点 + 深度）；节点高亮；按类型过滤显示；快照导出（png / svg / json）。',
    ].join('\n'),
  },
  'official.mindmap': {
    overview: [
      '思维导图：节点树与结构分析。',
      '',
      '节点：label（标签）、parentId（父节点，根为 root）、style（样式配置）；batch_create 从结构化数据（structure: { label, children? }）一次建整棵树。',
      '',
      '能力：节点创建 / 更新 / 删除（删除级联子节点）；get_structure 读整树；auto_layout 自动布局（tree / radial / fishbone）；export_image 导出（png / svg）；search_node 搜索；find_isolated / find_cycles / highlight_path 结构分析；suggest_move_to_group / ai_organize 整理辅助。',
    ].join('\n'),
  },

  // ────────────────────────────────────────────
  // 面板与模块
  // ────────────────────────────────────────────
  'official.tactical-board': {
    overview: [
      '战场单位的部署、移动与回合模拟。',
      '',
      '数据：单位与部署记录——坐标 position { x, y }、编队 formation、地形 terrainData。',
      '',
      '能力：deploy_unit 部署 / move_unit 移动 / undo_move 撤销；get_battle_state 与 get_unit_stats 查询；simulate_turn 回合模拟（参数为行动列表 [{ unitId, action, target?, ... }]）；set_terrain 地形设置；export_battle_log 导出（json / markdown / html）。',
    ].join('\n'),
  },
  'official.module-builder': {
    overview: [
      '自定义模块（视图）的构建与管理。',
      '',
      '实体：custom_module（模块）——字段：name、description、layout（布局类型：dashboard / editor / manager / analyzer）。',
      '',
      '组件注册表（可用组件类型）：',
      '- 详情与编辑：detail-panel / edit-form / property-panel / field-group',
      '- 操作与工具：toolbar / action-button / batch-actions / context-menu / quick-actions',
      '- 搜索与筛选：search-box / filter-bar / sort-control',
      '- 数据展示：entity-list / entity-grid / entity-table / kanban-board / entity-card',
      '- 可视化：chart-bar / chart-pie / chart-line / relation-graph',
      '- 布局容器：tab-container / accordion-container / split-panel',
    ].join('\n'),
  },

  // ────────────────────────────────────────────
  // 无专属说明的芽（批 2 新补）
  // ────────────────────────────────────────────
  'official.regions': {
    overview: [
      '地理区域（region）实体的浏览与管理视图。',
      '',
      '区域经通用实体工具读写（entity_list / entity_get / entity_create / entity_update）；区域间及与其它实体的关系（borders 接壤 / has_subregion 包含子区域 / located_in 位于 / route 路线 / controls 被组织控制等）经 relation_create 维护；视图提供区域与图谱浏览。',
    ].join('\n'),
  },
  'official.organizations': {
    overview: [
      '组织（organization）实体的管理。',
      '',
      '经通用实体工具读写；组织相关关系：member_of（成员——角色 / 物种）/ sub_organization（下属势力）/ allied_with（盟友）/ at_war_with（交战）/ hostile_to（敌对）/ trade_with（贸易）/ controls（控制——区域）/ involved_in（参与——事件）等，经 relation_create 维护。',
    ].join('\n'),
  },
  'official.species': {
    overview: [
      '物种（species）实体的管理。',
      '',
      '经通用实体工具读写；物种相关关系：related_species（关联物种：祖先 / 进化 / 杂交 / 共生 / 天敌）/ individual（代表人物——角色）/ originates_from（起源地——区域）/ speaks（语言——概念）/ racial_ability（种族天赋——技能）等，经 relation_create 维护。',
    ].join('\n'),
  },
  'official.plants': {
    overview: [
      '植物（plant）实体的管理。',
      '',
      '经通用实体工具读写；植物相关关系：materials_from（制成物——道具）/ used_by（使用者——物种 / 角色）/ magic_material（施法材料——技能）/ originates_from（起源地——区域），经 relation_create 维护。',
    ].join('\n'),
  },
  'official.weapons': {
    overview: [
      '武器集合视图。',
      '',
      '武器是道具（item）中带武器特征的实体——该芽无独立实体类型；写入经道具相关能力（worldview(sprout=\'道具\', action=\'create\') 等）；视图提供武器专属的浏览与筛选。',
    ].join('\n'),
  },
  'official.apparel': {
    overview: [
      '服饰 / 装备集合视图。',
      '',
      '服饰是道具（item）中带服饰特征的实体——该芽无独立实体类型；写入经道具相关能力（worldview(sprout=\'道具\', action=\'create\') 等）；视图提供服饰专属的浏览与筛选。',
    ].join('\n'),
  },
  'official.drawing': {
    overview: [
      '自由画板（drawing）实体的管理。',
      '',
      '画布数据（画布内容 / 图层 / 缩放 / 平移）存于实体 properties；视图为画布形态。该芽无专属动作——实体读写经通用实体工具。',
    ].join('\n'),
  },
  'official.workflow': {
    overview: [
      '创作编排：创作 Pipeline（pipeline 实体）与流程模板的视图。',
      '',
      '编排动作（pipeline_* 工具面）不在本工具的动作面内；本芽提供实体与流程模板的浏览。',
    ].join('\n'),
  },
  'official.custom': {
    overview: [
      '自定义视窗：界面内多窗口自由拼装视图面板的入口。',
      '',
      '该芽无独立实体类型与专属动作；实体数据经通用实体工具读写。',
    ].join('\n'),
  },
}
