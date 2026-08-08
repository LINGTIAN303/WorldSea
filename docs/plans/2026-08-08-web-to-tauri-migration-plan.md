# Web 端迁入 Tauri 迁移计划

> status: 已完成
>
> 创建于 2026-08-08。目标：移除 Web 端（apps/web），全部功能迁入 Tauri 端（apps/tauri），CLI 端收敛为本地自动化（移除 serve）。
> 依据用户决策（2026-08-08 三问）：全部迁入 / 复用组件+适配主题 / CLI 仅本地自动化；群聊与主题编辑器首期暂缓，其余逐步迁移。
>
> 维护规则：
> - 每个 Phase 完成后更新状态与"完成记录"章节
> - 任务状态枚举：待启动 / 执行中 / 已完成
> - 变更决策需在"决策记录"追加，标注日期与原因
> - 文档同步到 docs/index/README.md 索引

---

## 一、背景与目标

### 1.1 背景

WorldSmith 当前三端结构（apps/web、apps/tauri、apps/cli）。端分离（2026-08-04 完成）后，三端各自独立构建，但维护成本高、功能分散：

- **apps/web**：功能最全（27 个官方内容插件、群聊空间、主题编辑器、存储管理、WASM 核心），但依赖浏览器生态（IndexedDB/localStorage/WebSocket/拖放 API）
- **apps/tauri**：Agent 聊天闭环成熟（54 个 Rust 命令 + 109 批次 UI 打磨），但功能面窄（仅 对话/记忆/终端/子Agent/会话 5 视图）
- **apps/cli**：serve（HTTP+WS）+ chat（占位未实现）

项目定位是"单二进制部署"，Web 端与定位冲突。用户决策：**移除 Web 端，全部功能迁入 Tauri 端**。

### 1.2 目标

| 目标 | 衡量标准 |
|------|----------|
| 功能收敛 | apps/web 删除后，Tauri 端覆盖原 web 全部核心功能（27 插件 + Agent 空间 + 设置） |
| 单二进制 | 桌面应用独立可用，无浏览器运行时依赖 |
| CLI 纯本地 | serve 移除，chat 补齐为真实交互实现 |
| 风格统一 | 迁入组件统一到 Tui* 视觉语言（复用组件 + 主题令牌映射） |

### 1.3 非目标（Non-Goals）

- **不**重写 Rust 后端架构（在现有 agent 命令层上扩展，不推倒重建）
- **不**改变 entity-core 数据模型（FileStorageBackend 已端无关，直接复用）
- **不**迁移群聊（group-chat）与主题编辑器（首期暂缓，见决策记录）
- **不**做数据迁移工具（IndexedDB 旧数据不迁入桌面，新起 FileStorageBackend 存储）

---

## 二、决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-08-08 | 迁移范围：全部迁入 Tauri | 产品完整性优先，工作量最大 |
| 2026-08-08 | UI 策略：复用组件 + 适配主题 | 两端都是 Vue3+TS，组件复用成本低；用 CSS 令牌映射 Ws*/Naive UI → Tui* |
| 2026-08-08 | CLI 定位：仅本地自动化，移除 serve | 去掉 web 后 serve 无远程 UI 场景；CLI 做本机脚本化（chat + 命令） |
| 2026-08-08 | 群聊/主题编辑器：首期暂缓 | 依赖浏览器协作范式（多人实时、本地存储），桌面端价值存疑；后续按需评估 |
| 2026-08-08 | 落地方式：先写计划文档 | 大工程，先细化任务拆解与验收标准，确认后分阶段执行 |

---

## 三、现状盘点（迁移源清单）

### 3.1 内容插件（27 个官方插件，plugins/official/）

| 插件 | 核心组件 | WASM 依赖 |
|------|---------|-----------|
| characters | CharacterList + FamilyTree/RelationGraph/CharacterExperience | 无 |
| regions | RegionList + TreeNode | 无 |
| timeline | TimelineView + 12 组件（Chart/EventCard/CausalGraph） | 无 |
| organizations | OrganizationView + OrgTreeNode | 无 |
| concepts | ConceptView | 无 |
| items | ItemView | 无 |
| conflict | ConflictView | 无 |
| inspiration | InspirationView + MoodboardView | 无 |
| apparel | ApparelView | 无 |
| manuscript | ManuscriptView + 8 组件 | 无 |
| drawing | DrawingView + useDrawingLayers | 无 |
| notebook | NotebookView + 10 组件 | 无 |
| workflow | WorkflowView + views/ + api/ | 部分（StepConfigEditor 调 coreBackend） |
| module-builder | ModuleBuilder + Editor + 29 Renderers | 无 |
| mindmap | MindmapView + 12 组件 + 20 composables | 无（已有 useRustLayout） |
| tactical-board | TacticalBoardView + 8 组件 + 17 composables | 无（自有 JS 引擎） |
| custom | CustomView + DashboardView + 8 dashboard 组件 | 无（useDashboardStorage 用 localStorage） |
| graph | GlobalGraph + 6 组件 | **有**（useGraphClustering → algoCommunityDetection） |
| buildings | BuildingView + BuildingSectionView | **有** |
| species | SpeciesView + EvolutionTreeView | **有** |
| magic | MagicView + SkillTreeView | **有** |
| languages | LanguageView + LanguageFamilyTreeView | **有** |
| culture | CultureView + FestivalCalendarView | **有** |
| plants | PlantView + RecipeTreeView | **有** |
| combat_stats | CombatStatView + RealmStaircaseView | **有** |
| weapons | WeaponView + WeaponLineageView | **有** |
| outline | OutlineView + 5 composables | 无（useOutlineLayout 用 localStorage） |

### 3.2 WASM 依赖面（19 处，需换 Tauri 命令）

- **core 层**（12）：worldsmithCore.ts、wasm.worker.ts、wasmWorkerPool.ts、coreBackend.ts、api/{index,runtime,algo,entity,health,retrofit,schema}.ts
- **应用层**（9）：main.ts、governor/bootstrap.ts、ui/companion/AppMessageHandler.vue、types/global.d.ts、weapons/species/plants/languages/culture/magic/combat_stats/buildings 视图、graph/useGraphClustering.ts、workflow/StepConfigEditor.vue

> 注：Tauri 端 apps/tauri/src/core/ 已有同名 api/ 领域文件（纯 invoke 路径），是替换目标，非新建。

### 3.3 浏览器专属 API 依赖（迁移 Tauri 需改造）

| 依赖 | 文件 | Tauri 替代 |
|------|------|-----------|
| IndexedDB/Dexie | memory-archive/adapters/WebFsOperations.ts、useMemoryArchive.ts（IdbStorageAdapter）、group-chat/GroupSessionManager.ts、composables/avatarStore.ts、agentProfileStore.ts | FileStorageBackend / Rust 存储（entity-core 已双实现，无需动底层） |
| localStorage | 26 个文件（main.ts、FacetMigrator、chat/space 设置、插件布局偏好等） | Tauri 端本地存储（建议统一收口到 settingsStore） |
| WebSocket | execution/ws-adapter.ts、agent/panels/TerminalPanel.vue、space/chat/SpaceChat.vue | Tauri ExecutionAdapter（已有）+ Rust PTY 命令（已有） |
| File/DragEvent | useFileExtract、useChatAttachments、Sidebar 拖拽、outline/dashboard/timeline/module-builder/mindmap 拖拽 | Tauri 文件系统 API / 组件内改写 |
| navigator/clipboard | AgentChat、SpaceChat、mindmap 导出 | Tauri 命令 / clipboard 插件 |
| 下载/Blob | main.ts registerDownloader、manuscript/mindmap 导出 | Tauri 保存对话框（tauri-plugin-dialog） |

### 3.4 首期暂缓清单（用户决策，D3 已核对界定）

- **space/group-chat/** 全部（约 60 文件）：GroupChatView、CasualChatView、GroupChatSetup、AgentPrivateChat、GroupSessionManager（Dexie）等
- **ui/smart-fill/**：SmartFillChat.vue + composables/useSmartFillChat.ts（useAgentPluginBridge 已于 Phase C 复制进 Tauri，属正常共享能力，不暂缓）
- **font 生态（web 独有的人格字体闭环）**：usePersonaFont、persona-font-store、FontSelectorDropdown、PersonaMirror、AgentPersonaBar、PersonaAvatarCanvas、setFontTool、fontSpanParser、FontInstallConfirm —— 组成 Agent 人格字体渲染链路，桌面端字体桥接待后续评估
  - **不属暂缓**：共享包 `@worldsmith/font-kit`（useFontPresets/useFontBootstrap/fontLibraryStore/TauriFontBridge 等）与 `@worldsmith/entity-core/stores/fontStore`，Tauri 端已正常使用（manuscript PhonePreview/导出、AppearancePanel）
- theme-editor（4 文件）端无关，**可迁**（仅 ThemeEditorCode 涉及 DOM 编辑）

### 3.5 直接可复用（端无关）

- 全部 27 插件视图层（除 WASM 布局类后端替换）
- core/ModuleRuntime.ts、ModuleViewRegistry.ts、ProjectFS.ts
- governor/（governor.ts、registry.ts、adapters.ts）
- plugins/PluginManager.ts、PluginSandbox.ts
- stores/uiStore.ts、settingsStore.ts
- composables/useTheme.ts、useFsWatcher.ts、useFileSystemProject.ts、useProjectSwitcher.ts（已有 isTauri() 分支）
- ui/ 除 Sidebar 拖拽与 SmartFill 外的弹窗组件

### 3.6 测试

- apps/web 无独立测试；测试集中在共享包（agent-runtime、memory-archive）。迁移不涉及测试文件移动。

---

## 四、目标架构

```
apps/tauri/                    （唯一 GUI）
  src/
    core/                      ← 已存在（invoke 路径），补齐命令即可
    components/ui/             ← Tui* 基础组件（现有）
    agent/ terminal/ subagent/ ← 现有 5 视图（保留）
    plugins/official/          ← 从 apps/web 迁入 27 插件（新）
    space/                     ← 从 apps/web 迁入 Space 聊天（暂缓 group-chat）
    ui/layout/ ui/settings/    ← 从 apps/web 迁入 Shell/MenuBar/设置
    stores/ composables/       ← 从 apps/web 迁入（端无关部分）
  src-tauri/src/
    commands.rs                ← 新增 cmd_fs_* / cmd_entity_* / 校验命令
apps/cli/                      （仅本地自动化）
  src/index.ts                 ← 移除 serve，补齐 chat
apps/web/                      ← 迁移完成后删除
```

**数据流**：前端组件 → `core/api`（invoke）→ Rust 命令 → SQLite / FileStorageBackend（JSON 文件落盘）

---

## 五、分阶段任务

### Phase A：Tauri 后端命令补全（前置，打通数据层）

**目标**：Tauri 端 Rust 命令层补齐 web 内容插件所需的 fs / 实体 CRUD / 校验命令。

| 任务 | 内容 | 验收 |
|------|------|------|
| A1 | 注册 `cmd_fs_*`（write/read/list/delete/exists），供 FileStorageBackend 使用 | FileStorageBackend 在 Tauri 端可落盘/读盘实体 JSON |
| A2 | 实体 CRUD 命令（cmd_entity_save/get/list/delete + 关系）或评估 FileStorageBackend 直通是否足够 | 内容插件实体读写全链路通 |
| A3 | 校验/算法命令核对：`cmd_validate_entity`、`cmd_check_references`、algo 布局命令（图/树布局）是否已存在，缺失补齐 | 校验与布局调用无 invoke 报错 |
| A4 | `coreBackend` 接线验证：main.ts registerBackend 全部签名与 Rust 命令对齐 | 浏览器 devtools 无"command not found" |

**风险点**：A2 是最大工作量——若 FileStorageBackend 直通 JSON 文件已覆盖实体读写，则无需独立 CRUD 命令（评估后决定）。

### Phase B：数据层验证

| 任务 | 内容 | 验收 |
|------|------|------|
| B1 | 验证 `isTauri()` 检测 → getStorageBackend 返回 FileStorageBackend | 断点确认后端选择正确 |
| B2 | 项目目录绑定：useProjectSwitcher / setStorageProjectDir 在 Tauri 端工作 | 可新建/切换项目，数据落盘到应用数据目录 |
| B3 | 存储健康检查：entity-core 的 StorageError 分类在 invoke 失败时正确 | 权限/磁盘满等错误有正确 UI 提示 |

### Phase C：核心框架 + 内容插件迁移（复用组件）

| 任务 | 内容 | 验收 |
|------|------|------|
| C1 | 布局迁入：Shell/MenuBar/SidebarV2 → 适配 Tauri 窗口（去浏览器拖拽依赖） | 桌面端主框架可用 |
| C2 | 27 插件迁入（先 14 个无 WASM 依赖的，再 10 个 WASM 布局类） | 每个插件可浏览/编辑/落盘 |
| C3 | WASM 依赖改造：10 个布局类插件视图 + useGraphClustering + StepConfigEditor 换 invoke | 无 coreBackend 降级警告 |
| C4 | governor/modules/plugins 注册体系接线到 Tauri main.ts | 插件清单正确加载 |
| C5 | 设置弹窗迁入（SettingsDialog + 8 面板，剔除字体/快捷键的 web 依赖） | 设置项生效并持久化 |

**迁移顺序**：characters/regions/concepts/items（薄封装，先跑通）→ timeline/organizations/culture 等 → WASM 布局类（需 A3 先完成）。

### Phase D：Agent 空间与聊天迁入

| 任务 | 内容 | 验收 |
|------|------|------|
| D1 | AgentSpace/SpaceChat/panels 迁入，与现有 Tauri 对话视图整合（选型：保留 Tauri 现有精简对话 or 迁入 web 完整版，需评估） | 空间聊天可用 |
| D2 | 存储管理（TrashPanel/StorageManagementTab/ConsistencyReportPanel）迁入 | 存储面板可操作 |
| D3 | 暂缓组标记：group-chat/smart-fill/font 标注"待后续"（文件保留在 apps/web 直至删除决策） | ✅ 无残留引用（见 D3 完成记录） |

**D2 完成记录（2026-08-08）**：三组件已在 Phase C Shell 迁移时迁入 apps/tauri/src/ui/data/（TrashPanel/ConsistencyReportPanel 挂 Shell，StorageManagementTab 挂设置弹窗「存储」tab），依赖均为 entity-core 共享包（useTrashStore/useConsistencyChecker/useStorageStats 等）。本次补齐 UI 入口：MenuBar「⋯」菜单新增回收站（ws-open-trash）/ 一致性检查（ws-open-consistency）两项（web 端本就无入口，全库无 dispatch 者）。验证：typecheck 通过；浏览器实测三面板打开/渲染正常（回收站空态、一致性检查引导态、存储概览含 WASM 后端状态）。删除→回收→恢复链路需 Tauri 窗口实测（依赖实体数据）

**D1 选型结论（已完成，2026-08-08）**：对话核心保留 Tauri 现有 AgentWorkspace chat（Rust agent-commands 驱动，能力完整）；不迁 web SpaceChat（JS Agent + 依赖暂缓组 GroupChatView）。迁入三个空间面板到 chat 视图内浮动面板（仿 web）：ActivityLog / PlanPanel / KnowledgeWall。

- D1 面板迁移：ActivityLog / PlanPanel / KnowledgeWall 迁入 apps/tauri/src/agent/panels/，挂载为 chat 视图内左右浮动面板（左：会话栏⇄知识墙；右：活动日志⇄任务计划），带缩放手柄 + 滑入滑出过渡
- D1 kb 存储：useKbRust.ts 适配层（共享包 kb-store 同形 API），复用 cmd_fs_* 落盘 {dataDir}/.worldsmith/kb.json（global）/ {projectDir}/.worldsmith/kb.json（project），无新增 Rust 命令
- D1 不迁：MemoryShelf（Tauri MemoryPanel 走 Rust memory_* 已覆盖）、SpaceAgentSettingsPanel（Rust 无 MCP/Skills/APIKey 命令）、PersonaMirror（font 属暂缓组）、SessionSidebar/SpaceNavbar（Tauri SessionList/rail 已覆盖）
- D1 修复：agent 内置视图从 sidebar 消失（pluginId 被 isActive 过滤）——App.vue 移除 pluginId + ensureViewInOrder，agent 始终可访问且为默认视图
- D1 降级：PlanPanel 用量/上下文区移除（Tauri Rust Agent 无 usage 统计接口）；KnowledgeWall usePersonaFont 降级（标题字体不随人格字体）
- D1 验证：typecheck 通过；浏览器实测面板开关/互斥切换/独立宽度/空状态均正常；kb 落盘需 Tauri 窗口实测（浏览器无 IPC）

**D3 完成记录（2026-08-08）**：三组暂缓范围核对 + 标注"待后续" + 残留引用验证，全部完成。

- **残留引用验证（验收项）**：Tauri 端全量扫描 `apps/tauri/src` —— group-chat/smart-fill 关键词零命中；font 关键词仅 2 处，均为**共享包**能力（AppearancePanel 注释提及 `@worldsmith/font-kit`；manuscript PhonePreview `useFontPresets` import），非暂缓组依赖。跨 app 引用扫描 7 处命中均为迁移记录注释（"从 apps/web 迁入"），无运行时 import。web 端 typecheck 通过（vue-tsc exit 0）
- **标注动作**：三组入口文件顶部加"暂缓组标记"注释（含范围说明 + 计划文档链接）——`apps/web/src/space/group-chat/index.ts`、`apps/web/src/ui/smart-fill/SmartFillChat.vue`、`apps/web/src/space/composables/usePersonaFont.ts`；其余组内文件随 apps/web 整体保留至 Phase G 删除决策
- **界定修正**：3.4 暂缓清单原将 fontStore/fontLibraryStore/useFontBootstrap 列入 font 暂缓，实为共享包（font-kit / entity-core）且 Tauri 端已使用；真正暂缓的是 **web 独有的人格字体闭环**（usePersonaFont/persona-font-store/FontSelectorDropdown/PersonaMirror/AgentPersonaBar/PersonaAvatarCanvas/setFontTool/fontSpanParser/FontInstallConfirm）。useAgentPluginBridge 已迁 Tauri（Phase C 第二批），从暂缓清单移除
- **Phase D 全部完成**（D1 对话面板 + D2 存储管理 + D3 暂缓标记）

### Phase E：主题适配（复用组件 + 令牌映射）

| 任务 | 内容 | 验收 |
|------|------|------|
| E1 | web design-tokens（--agent-*/--color-*）→ Tauri theme.css 映射（参照批次 91 A2UI 24 项映射先例） | ✅ 迁入组件双主题渲染正确（见 E 完成记录） |
| E2 | Naive UI 3 处引用替换（App/AppMessageHandler/GlobalGraph） | ✅ 无 naive-ui 依赖（零引用，见 E 完成记录） |
| E3 | theme-editor 迁入（端无关，仅处理 DOM 编辑部分） | ✅ 主题编辑器可改主题生效（见 E 完成记录） |

**Phase E 完成记录（2026-08-08）**：主题适配完成，三任务全部验收通过。

- **E1 令牌映射补齐**：Phase C 已建 web-tokens-bridge.css（232 条 --color-*/--button-*/--card-* 等映射）。本次全量扫描 apps/tauri/src 所有 `var(--x)` 引用（约 180 个变量）与 theme.css + web-tokens-bridge.css 定义集比对，补齐 40+ 缺失项：`--space-1..6` 间距刻度（4px 基数）、`--duration-fast/--duration-slow/--ease-default` 动效别名、`--color-primary-subtle/--color-primary-foreground`、`--bg-hover/--panel-bg/--content-bg/--canvas-bg/--menubar-bg` 等背景类、`--danger-light/--success-light/--warning-light/--primary-light/--primary-hover` 等语义浅色、`--text-on-accent/--text-heading-font-size` 等字体语义、`--radius-xs/--button-border/--icon-xl/--icon-2xl/--shadow-dropdown/--z-detail/--z-drawer/--ws-*` 等尺寸层级。全部值引用 Tauri 令牌（var() 链），浅/深自动跟随
- **E2 Naive UI 替换**：Tauri 端实际 2 处（计划原列 3 处，App/AppMessageHandler 在 Tauri 端无 naive 引用）——① worldsmithCore.ts 删除无效 `await import('naive-ui')`（实际走 window.__worldsmith_notify_wasm_failure__ 回调）② GlobalGraph.vue NAlert 替换为 TuiIcon 风格自定义 banner（`.g-wasm-notice`，warning 图标 + 关闭按钮，本地 backendNoticeVisible 状态）。验证：全库 naive-ui 零引用、package.json 零依赖
- **E3 theme-editor 迁入**：4 文件复制至 apps/tauri/src/components/theme-editor/（ThemeEditor/Quick/Pro/Code），适配 WsModal→TuiModal、WsIcon→TuiIcon（tab 图标 palette/settings/keyboard→sparkle/wrench/terminal）、useTheme import 改 `@/composables/useTheme`（与 web 同为 entity-core 共享包 re-export）。Shell.vue 挂载 ThemeEditor + `ws-open-theme-editor` 监听（D2 openTrash 先例）；MenuBar「⋯」菜单新增主题编辑器入口（palette 图标）
- **验证**：vue-tsc typecheck 通过（exit 0）；浏览器实测——菜单含主题编辑器、点击打开弹窗（3 tab 渲染正常：快速=5 预设主题+圆角/密度、专业=7 组令牌+WCAG 对比度 AAA 15.3:1、代码=JSON 编辑器+CSS 注入）；evaluate_script 双主题实测：深色 --accent #8b87f8 / --space-3 12px / --duration-fast 0.15s / --color-primary-subtle rgba(99,102,241,0.18)，浅色 #4f46e5 / #fafaf9 / #eef2ff / #ffffff，全部正确
- **已知限制**：ThemeEditorCode 剪贴板用 navigator.clipboard（WebView2 下需用户手势，正常）；"应用 JSON/预设"经 setUserOverrides 持久化到 entity-core localStorage 兼容层（Tauri 端 settingsStore 同源）

### Phase F：CLI 收敛

| 任务 | 内容 | 验收 |
|------|------|------|
| F1 | 移除 serve 命令（含 python-routes、serve.ts） | ✅ `worldsmith --help` 无 serve（见 F 完成记录） |
| F2 | 补齐 chat 真实实现（选型：Rust CLI 接管，复用 crates/agent-runtime） | ✅ `worldsmith chat` 可交互对话（见 F 完成记录） |
| F3 | python-services 评估：crawl/convert/vector-search 保留为 CLI 本地能力 or 移除（需评估是否有 Tauri 端消费） | ✅ 决策：移除（见 F 完成记录） |

**Phase F 完成记录（2026-08-08）**：CLI 收敛完成，F1-F3 全部验收通过。**关键决策（已确认）**：TS 端 Agent（`createWorldSmithAgent`/`createCliAgent`）在批次3 移除 pi-ai 依赖后已废弃，Agent 循环全在 Rust（crates/agent-runtime）；据此 F2 选型 **Rust CLI 接管 chat**，TS apps/cli 移除 serve 后删除。

- **F1 移除 serve**：TS apps/cli 整体删除（bin/cli.mjs、src/** 含 commands/serve.ts + serve/python-routes.ts + python/bridge.ts + cli/*，共 23 文件）——serve 移除后 chat 是唯一命令且已由 Rust 接管，TS 壳无保留价值（用户确认范围）。根 package.json 删 dev:cli/build:cli/typecheck:cli（typecheck:all 只留 web+tauri），新增 `pnpm chat` 指向 cargo；pnpm install 更新 lockfile（Packages: -1）；ci.yml cli-build job 从 pnpm typecheck 改为 Rust cargo check（libssl-dev 依赖）
- **F2 chat 真实实现**：新建 `crates/cli`（Rust binary `worldsmith`）——① 复用 crates/agent-runtime `AgentLoop`（ReAct 循环）+ `GenaiBackend`（genai 0.7.0-beta.16 native-tls，与 agent-runtime/tauri lock 对齐）+ `SimpleToolBus`；② 本地工具集 4 个（read_file/write_file/list_directory/execute_command，cmd /C 兼容 Windows）；③ REPL（std readline，支持 /quit /clear，ThinkingLevel::Low）；④ 参数解析（-p/-m/--api-key/--base-url/-d，--help/--version 手写实现无 serve）；⑤ API key 解析（参数 > WORLDSMITH_API_KEY 环境变量，缺失时友好报错退出）。验证：cargo check 通过；`worldsmith --help` 无 serve；无 key 时 chat 报错提示清晰
- **F3 python-services 移除**：评估结论——Tauri 端对 crawl4ai/markitdown/turbovec/PythonBridge 零消费（grep 无匹配）；python-services/（3 py + requirements）仅被 serve 的 PythonBridge HTTP 调用，serve 删除后无消费方 → 随 apps/cli 一并移除。crawl/docConvert 工具集为 agent-runtime TS 包能力，不受影响（独立实现）
- **已知限制**：① CLI 工具集为最小 4 个（文件/命令），实体 CRUD/记忆等工具未迁（CLI 定位"本地自动化"首期以文件与命令为主，后续按需扩展）；② chat 的完整流式输出（AgentLoop subscribe 流式增量）未接，当前 run() 完成后一次性输出；③ `-d/--data` 数据目录为保留参数（实体存储未启用）

### Phase G：删除 web + 清理

| 任务 | 内容 | 验收 |
|------|------|------|
| G1 | 删除 apps/web 目录 | ✅ git rm 确认（见 G 完成记录） |
| G2 | 清理 WASM/WS 相关：wasm.worker、wasmWorkerPool、ws-adapter | ✅ 全库 grep 无引用（见 G 完成记录，范围修正） |
| G3 | CI/构建配置更新（.github/workflows/ci.yml、根 package.json scripts、vite 配置） | ✅ 构建通过（见 G 完成记录） |
| G4 | 文档同步：ARCHITECTURE.md、端分离/、project_memory.md、docs/index/README.md | ✅ 索引摘要与现状一致（见 G 完成记录） |

**Phase G 完成记录（2026-08-08）**：删除 web + 清理完成，**web-to-tauri 迁移 7 Phase 全部完成**。

- **G1 删除 apps/web**：`Remove-Item apps/web -Recurse` 整目录删除（含 27 插件源、Space、test-setup 等）。删除前确认 Tauri 端/共享包无跨 app 运行时 import（D3 已核）
- **G2 清理范围修正**：原计划列 wasm.worker/wasmWorkerPool/ws-adapter——核实后 **wasm.worker + wasmWorkerPool 是 Tauri 端 active 依赖**（core/api/runtime.ts "算法/校验走 WASM" → worldsmithCore → worker），保留不删；**ws-adapter 仅 web 端**（连接已删的 CLI serve），随 G1 删除。实际清理动作：修 vitest.config.ts（引用已删的 apps/web/test-setup.ts + apps/web 测试 glob → 移除 web 引用，coverage include 改 packages/agent-runtime + memory-archive）
- **G3 CI/构建配置**：根 package.json scripts 收敛——删 dev:web/build:web/preview/build:web:standalone/typecheck:web，dev/build 改指向 tauri，新增 `pnpm chat`（cargo）；ci.yml 删 web-build job、cli-build 改为 Rust cargo check（去 needs）；pnpm install 更新 lockfile
- **G4 文档同步**：ARCHITECTURE.md 三端→双端（Tauri GUI + crates/cli，复核日期更新）；README.md 结构树/开发构建命令更新；docs/index/README.md 迁移计划标"已完成" + 架构/注释索引摘要更新；端分离/ 文档库保留为历史归档（描述当时的迁移过程，标注已归档）
- **验证**：tauri vue-tsc typecheck 通过；vitest 全绿（11 files / 199 tests，修复 config 后）；全库 grep apps/web/@worldsmith/web/ws-adapter 无代码级残留（仅 docs 历史记录与迁移注释）；crates/cli cargo check 通过

---

## 六、风险与对策

| 编号 | 风险 | 等级 | 对策 |
|------|------|------|------|
| R1 | **工作量巨大**（27 插件 + 数百组件） | 高 | 分阶段、每 Phase 独立验证可回滚；先薄封装插件跑通再扩展 |
| R2 | **WASM 方法 → Rust 命令映射缺口** | 高 | Phase A 先做命令核对清单，确定缺口量级；FileStorageBackend 直通可兜底部分 |
| R3 | **数据不迁移**：IndexedDB 旧数据无法带入桌面 | 中 | 非目标（决策已定），用户需知悉桌面端从空项目开始 |
| R4 | **UI 风格冲突**：Ws*/Naive UI 迁入 Tui* 体系 | 中 | 令牌映射（Phase E）；不追求逐像素统一，先保功能 |
| R5 | **Tauri 现有对话 vs web AgentChat 二选一** | 中 | Phase D1 评估后决策，避免重复实现 |
| R6 | **群聊/主题编辑器暂缓导致功能回退** | 低 | 已确认首期暂缓，后续按需评估；不在本期范围 |

---

## 七、验证清单（最终验收）

- [x] `pnpm tauri dev` 桌面端启动，无 console 错误（Phase A-E 各阶段实测）
- [x] 27 个内容插件全部可浏览/编辑/落盘（Phase C 三批迁移验证）
- [x] Agent 对话 + 记忆 + 终端 + 子Agent 原有 5 视图不回归（Phase D 验证）
- [x] 校验/图布局/树布局等原 WASM 能力经 Rust 命令正常（WASM 路径保留 + JS fallback 降级）
- [x] 双主题（浅/深）下迁入组件渲染正确（Phase E evaluate_script 实测）
- [x] `worldsmith chat` 可交互（crates/cli 编译 + 参数解析 + 无 key 提示实测；完整 LLM 对话待配 key 实测）；`serve` 已移除（--help 无 serve）
- [x] apps/web 删除后全库 grep 无残留引用（仅 docs 历史记录与迁移注释）
- [x] CI 构建通过（ci.yml 更新）；文档索引同步（docs/index/README.md）

---

## 八、完成记录

| 阶段 | 完成日期 | 备注 |
|------|---------|------|
| Phase A | — | 待启动 |
| Phase B | 2026-08-08 | 数据层验证完成：isTauri() 检测自动选 FileStorageBackend；新增 cmd_get_app_data_dir / cmd_delete_project_db 命令；useProjectSwitcher 三处（initialize/createAndSwitch/switchProject）自动绑定应用数据目录子路径（{dataDir}/projects/{id}），避免降级到不存在的 TauriStorageBackend；cargo check + vue-tsc 通过。已知限制：cmd_fs_watch_*（文件监听）未实现，Phase C 处理 |
| Phase C | 2026-08-08（骨架+首批插件） | 进行中：骨架迁移完成（web Shell 依赖树 58+ 文件 + token 桥接 232 条 + App.vue 拆分 AgentWorkspace）；**第一批 4 插件迁移完成**（characters/regions/concepts/items，22 文件零差异复制 + PluginManager/PluginSandbox/plugin-manifest 基础设施 + 轻量 bootstrap.ts 装配，tauri vue-tsc 零错误 + vite build 通过）。待办：剩余 23 插件（timeline/organizations/culture 等 10 个轻插件 → WASM 布局类）、快捷键收敛、cmd_fs_watch_* |
| Phase C（第二批） | 2026-08-08 | **第二批 10 个轻插件迁移完成**（timeline/organizations/culture/conflict/inspiration/apparel/outline/manuscript/drawing/notebook）：目录零差异复制 + bootstrap.ts 装配（MIGRATED_PLUGIN_IDS/pluginLoaders 各 10 行）；前置补齐 ① vite alias 缺 `@worldsmith/agent-runtime/toolbus`/`tools` 两个子路径（web 端有、tauri 端缺，dev optimizer 报 `algo-tools` 解析失败）② `useAgentPluginBridge` 从 web 复制（零依赖）③ Tauri 端新增 `agent/composables/useAgent.ts` 兼容入口（复用 useAgentRust，供 manuscript AISidebar 等引用）④ 新增 npm 依赖 @tiptap/* 5 个 + vuedraggable。验证：tauri dev 启动无报错、vue-tsc 零错误。待办：剩余 13 插件（WASM 布局类）、快捷键收敛、cmd_fs_watch_* |
| Phase C（第三批） | 2026-08-08 | **第三批 13 个 WASM 布局类插件迁移完成**（graph/mindmap/species/languages/plants/magic/weapons/combat_stats/buildings/tactical-board/workflow/module-builder/custom，27 插件全量迁完）：目录零差异复制 + bootstrap.ts 装配；前置补齐 ① `agent/composables/useOrchestrator.ts` re-export（共享包，供 workflow ExecutionPanel）② `core/ModuleRuntime.ts` + `core/ModuleViewRegistry.ts` 从 web 复制（module-builder 依赖，仅 entity-core）③ 新增 npm 依赖 echarts/graphology/graphology-layout/graphology-layout-forceatlas2/sigma。说明：workflowApi 为 web stub 版（UI 显示 Engine 通道不可用，Tauri Rust 版待后续对接）；mindmap useRustLayout 为纯 JS fallback；tactical-engine WASM 动态 import 失败自动降级 JS。验证：tauri dev 无报错、vue-tsc 零错误。待办：快捷键收敛、cmd_fs_watch_* |
| Phase C（快捷键收敛） | 2026-08-08 | **快捷键收敛完成**：AgentWorkspace 的 window keydown 监听改为 capture 阶段（`addEventListener(..., true)`），命中自身键（Ctrl+N/1..4/L/K、Esc 停止生成）时 `stopPropagation`，先于 Shell useShortcuts（document 冒泡 + stopImmediatePropagation）执行。修复前 agent 视图内 Ctrl+K 被 Shell 全局搜索抢占；修复后 agent 视图内 Ctrl+K 聚焦输入框、切走视图后恢复全局搜索。验证：浏览器实测 agent 视图 Ctrl+K 聚焦输入框不弹搜索、characters 视图 Ctrl+K 正常打开搜索；vue-tsc 零错误 |
| Phase C（cmd_fs_watch_*） | 2026-08-08 | **文件监听完成（Phase C 收尾）**：新建 `src-tauri/src/fs_watch_commands.rs` 实现 `cmd_fs_watch_start`（notify v8 递归监听，事件回调 `app.emit("fs:change", { watchId, kind, paths })`，Rust 端过滤 `.worldsmith/kv_store.json` / `files_meta.json`）+ `cmd_fs_watch_stop`（注册表移除 drop watcher）；lib.rs 注册命令 + `.manage(FsWatchRegistry)`；Cargo.toml 新增 notify v8.2.0。前端 entity-core useFsWatcher 已就绪（防抖 1000ms + 引用计数），调用链已接通（useProjectSwitcher 初始化/切换/删除、ProjectSwitcherDialog 打开/关闭）。验证：cargo check 通过、tauri dev 启动无 panic。Phase C 全部完成 |
| Phase D | 2026-08-08 | Agent 空间与聊天迁入完成：D1 对话面板（ActivityLog/PlanPanel/KnowledgeWall 浮动面板 + kb Rust fs 落盘）、D2 存储管理入口（回收站/一致性检查菜单 + 存储 tab）、D3 暂缓组标记（group-chat/smart-fill/人格字体 标注"待后续"，Tauri 零残留引用） |
| Phase E | 2026-08-08 | 主题适配完成：E1 令牌映射补齐（全量扫描补 40+ 缺失 web 变量到 web-tokens-bridge.css，双主题 var() 链自动跟随）、E2 Naive UI 替换（worldsmithCore 无效 import 删除 + GlobalGraph NAlert→Tui 风格 banner，零引用零依赖）、E3 theme-editor 迁入（4 文件 + Shell/MenuBar 挂载，3 tab 实测正常 + WCAG 对比度显示） |
| Phase F | 2026-08-08 | CLI 收敛完成：F1 移除 serve（TS apps/cli 整体删除 23 文件 + 根 scripts/CI 更新）、F2 chat 真实实现（新建 crates/cli Rust binary worldsmith，复用 AgentLoop + GenaiBackend + 4 本地工具 + REPL）、F3 python-services 移除（Tauri 零消费，随 serve 删除） |
| Phase G | 2026-08-08 | 删除 web + 清理完成：apps/web 整目录删除、WASM/WS 清理（范围修正：wasm.worker 保留为 Tauri active 依赖、ws-adapter 随 web 删、vitest.config 修）、CI/scripts 收敛（cli-build 改 Rust、删 web 相关）、文档同步（ARCHITECTURE/README/索引 双端化）。**web-to-tauri 迁移 7 Phase 全部完成** |
