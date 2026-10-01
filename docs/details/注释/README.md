# 详细注释文档索引

> 承载代码内注释分层后的「详细」层（why/how）：设计决策、整体思路、模块职责、事件协议、踩坑约束。
> 代码文件内仅保留一行简要注释 + 本目录相对路径；此处按模块与代码文件一一对应。
> 配套规则见【[2026-08-06-comment-hierarchy-plan.md](../../plans/已完成/2026-08-06-comment-hierarchy-plan.md)】。
> 代码变更影响注释含义时，必须同步更新本目录对应文档。
>
> **2026-09-27 E8 冻结面收口**：旧 Agent 面（crates/agent-\* 九目录、src-tauri agent 命令族、
> packages/{agent-runtime, agent-core, governor-core}、shared-ui/agent、shared-composables/agent、
> ui-kit 工具面板等）已物理删除，对应注释文档同步删除（git 历史可找回）；
> 模型注册表与 smart-fetch 五份随模块打捞至 `packages/ui-kit/model-registry/`。

## 模块清单

### tauri（apps/tauri）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/core/coreBackend.ts | [coreBackend.md](tauri/coreBackend.md) | coreBackend Phase 3 端分离：移除 WASM、纯 invoke 路径、签名兼容；2026-08-06 收敛为 api/ 领域拆分聚合（re-export） |
| src/main.ts | [main.md](tauri/main.md) | Tauri 端入口：端分离策略、Phase 3/4 演进说明 |
| vite.config.ts | [vite-config.md](tauri/vite-config.md) | Tauri 端 Vite 配置：IPC 直连设计原则、WASM 算法降级、端口与构建触发 |
| src/memory-archive/adapters/TauriFsOperations.ts | [TauriFsOperations.md](tauri/TauriFsOperations.md) | FsOperations 的 Tauri 实现：cmd_fs_* 命令映射 |
| src/ui/layout/sidebar/viewOrder.ts | — | 侧栏可见视图**唯一顺序口径**（`isViewVisible` 过滤 + `sidebarOrder` 排序）：渲染（SidebarV2）与 `Ctrl+↑/↓` 切换（Shell）共用，修「切得太多/乱跳」（2026-10-01；短注释未立文档） |
| src/world/plugins/regions/RegionList.vue | [实体视图分页.md](packages/plugin-sdk/实体视图分页.md) | 区域视图：默认卡片 + 卡片模式分页（页状态由 GEV 经槽属性下放）；插槽自绘卡片/树样式自带、批量态路由、视图切换按钮显式 color（2026-10-01） |
| src/styles/theme.css | — | 全局基座：`*{box-sizing}` + **`button{color:inherit}` 复位**（UA 的 `color:buttontext` 不继承 → 未写 color 的按钮在暗色下黑字；25 处存量同型一次免疫，2026-10-01） |
| 拆分记录（2026-08-06） | — | coreBackend.ts 按领域拆为 src/core/api/（schema / retrofit / entity / algo / health / runtime + index 聚合），coreBackend.ts 保留 `export * from './api'`，类型统一来自 @worldsea/core-api-types，公共导出签名不变，原 import 处无需改动；各新文件无 ≥ 10 行连续注释块，未生成新文档 |

> ~~src-tauri/src/commands.rs~~（commands.md）、search-config / net-egress / web-fetch / useTerminalRust /
> TerminalView / SessionList / agent-ux-guidelines / http-bridge-scope / usePlanRust 等注释文档已随
> E6–E8 旧 Agent 面清退删除；`src-tauri/src/win_job.rs`（LSP Job Object 打捞件）头注自足，未另立文档。

### packages/ui-kit（packages/ui-kit）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/model-registry/model-registry.ts | [providers-model-registry.md](packages/ui-kit/model-registry/providers-model-registry.md) | 模型注册表：静态元数据（打捞自 agent-runtime，2026-09-27 E8） |
| src/model-registry/provider-registry.ts | [providers-provider-registry.md](packages/ui-kit/model-registry/providers-provider-registry.md) | 供应商统一注册表：单一数据源 + 声明式 + 可扩展 |
| src/model-registry/model-fetcher.ts | [providers-model-fetcher.md](packages/ui-kit/model-registry/providers-model-fetcher.md) | 动态模型拉取服务（/v1/models + 24h 缓存） |
| src/model-registry/key-store.ts | [providers-key-store.md](packages/ui-kit/model-registry/providers-key-store.md) | API Key 加密存储：Keyring 优先 + AES-GCM 降级 |
| src/model-registry/smart-fetch.ts | [utils-smart-fetch.md](packages/ui-kit/model-registry/utils-smart-fetch.md) | 统一网络请求：Tauri plugin:http 绕过 CORS / Web fetch |
| src/components/entity/map/useAdjoin.ts | [useAdjoin.md](packages/ui-kit/components/entity/map/useAdjoin.md) | 接壤模式 composable（borders 关系 + 合并逻辑） |
| src/components/entity/map/useBorderErase.ts | [useBorderErase.md](packages/ui-kit/components/entity/map/useBorderErase.md) | 抹除/移动边境线 composable（偏移/重划模式） |
| src/components/entity/map/useDrawing.ts | [useDrawing.md](packages/ui-kit/components/entity/map/useDrawing.md) | 绘制模式 composable（手绘 + Alt 边境线） |
| src/components/entity/GenericTreeView.vue | [批量选择态.md](packages/plugin-sdk/批量选择态.md) | 树行批量态路由：`showCheckbox` 退役（复选框不再使用），新增 `batchMode`（行点击→选中切换）；势力树经 `OrgTreeNode` 接线（2026-10-01） |
| src/components/TuiButton.vue | [TuiButton.md](tauri/components/TuiButton.md) | 全仓唯一按钮组件（2026-10-01 自 apps 下沉 + `active` 属性）；收编跨文件重复的 `.btn*` 族（映射见档），基座 `button{color:inherit}` 复位 UA 黑字坑 |
| src/components/settings/panels/SproutsPanel.vue | — | 芽管理面板（26 个世界观芽开关 + 分类筛选 + 拖拽排序；2026-09-10 由 PluginsPanel 更名；原 27 个，`official.module-builder` 已于 2026-09-25 随「自定义模块」整体剪除） |
| src/components/settings/settings-panels.css | [settings-panels-convention.md](packages/ui-kit/settings-panels-convention.md) | 设置面板统一约定（三契约/基座样式/scoped 陷阱/卡片清单） |
| src/index.ts | [index.md](packages/ui-kit/index.md) | ui-kit FACADE 包说明（聚合/委托导出） |

> ~~BuiltinToolsPanel.vue~~（builtin-tools-panel.md）、~~AgentPluginsPanel.vue~~（agent-plugins-panel.md）
> 已于 2026-09-27 E8 随旧 Agent 工具面退场（零挂载孤儿）。

### packages/shared-ui（packages/shared-ui）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/markdown/codeHighlight.ts | [codeHighlight.md](packages/shared-ui/markdown/codeHighlight.md) | Prism 语法高亮 + **内容键 memo**（C7：消除「内容未变却重复高亮」两条热路径；参考实现供门禁判别力自证） |
| src/markdown/markdownStream.ts | [markdownStream.md](packages/shared-ui/markdown/markdownStream.md) | 流式 Markdown 内核（C2）：分块判定线（最后一个内容 token）+ 保守回退（def/html）+ 增量渲染器（token 缓存，增量 ≡ 全量契约） |

> src/agent/**（blocks/bubbles/message-list/stream/a2ui）已于 2026-09-27 E8 整体退场；
> E7 迁出的 markdown 内核（markdownStream/codeHighlight）与 useMarkdownRender（bubbles 时代表）
> 中，useMarkdownRender 已随 bubbles 退场，其接线语义并入产品侧使用点。

### packages/shared-composables（packages/shared-composables）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/entity/useEntityMiniPanel.ts | [useEntityMiniPanel.md](packages/shared-composables/entity/useEntityMiniPanel.md) | 实体卡片小窗状态管理（模块级单例） |
| src/companion/llm.ts（2026-09-27 E8 打捞） | — | 陪伴模式 LLM 调用辅助（resolveEndpoint/buildLLMBody/extractTitle，自 agent/useTitleGen.ts 打捞；短注释未立文档） |

> src/agent/**（useAgent / long-task / useTitleGen 等）已于 2026-09-27 E8 整体退场。

### packages/entity-core（packages/entity-core）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/composables/useFileSystemProject.ts | [useFileSystemProject.md](packages/entity-core/composables/useFileSystemProject.md) | 项目目录绑定与导出（对接 FileStorageBackend 体系） |
| src/composables/useFsWatcher.ts | [useFsWatcher.md](packages/entity-core/composables/useFsWatcher.md) | 文件系统变更监听（模块级单例 + 引用计数） |
| src/composables/useImageResolver.ts | [useImageResolver.md](packages/entity-core/composables/useImageResolver.md) | 图片解析重试管理（事件优先 + 退避兜底） |
| src/core/FileStorageBackend.ts | [FileStorageBackend.md](packages/entity-core/core/FileStorageBackend.md) | 本地文件系统存储后端（JSON 落盘 + 降级 fallback） |
| src/core/ProjectFS.ts | [ProjectFS.md](packages/entity-core/core/ProjectFS.md) | 项目文件系统导出/导入（目录结构规范） |
| src/core/ProjectMigration.ts | [ProjectMigration.md](packages/entity-core/core/ProjectMigration.md) | 一次性数据迁移（全局库 → 项目库，增量拷贝/分批） |
| src/core/ProjectSwitcherApi.ts | [ProjectSwitcherApi.md](packages/entity-core/core/ProjectSwitcherApi.md) | 项目切换服务接口（依赖注入解耦） |
| src/core/RelationshipRegistry.ts | [RelationshipRegistry.md](packages/entity-core/core/RelationshipRegistry.md) | 全局关系注册中心（集中声明 + source/target 索引） |
| src/core/TraitRuntime.ts | [TraitRuntime.md](packages/entity-core/core/TraitRuntime.md) | Trait/EntitySchema 运行时（compileEntitySchema 编译逻辑） |
| src/core/events.ts | [events.md](packages/entity-core/core/events.md) | 事件总线 + 生命周期事件（跨模块通信基础设施） |
| src/core/formula-auto.ts | [formula-auto.md](packages/entity-core/core/formula-auto.md) | Formula 自动重算（监听 field:change） |
| src/core/formula.ts | [formula.md](packages/entity-core/core/formula.md) | 轻量公式引擎（四则/比较/逻辑/聚合，无 eval 沙箱） |
| src/core/io/ExportController.ts | [ExportController.md](packages/entity-core/core/io/ExportController.md) | 统一导出调度器（Serializer 遍历组装 WorldSeaPack） |
| src/core/io/ImportController.ts | [ImportController.md](packages/entity-core/core/io/ImportController.md) | 统一导入调度器（拓扑排序恢复，overwrite/merge） |
| src/core/io/PackageBuilder.ts | [PackageBuilder.md](packages/entity-core/core/io/PackageBuilder.md) | .ws 包构建器（ZIP 归档 + 媒体内嵌） |
| src/relations/index.ts | [index.md](packages/entity-core/relations/index.md) | 全局关系定义 v1.0（20 插件提取/去重/合并） |
| src/traits/index.ts | [index.md](packages/entity-core/traits/index.md) | 原子 Trait 定义 v1.1（13 个原子 Trait） |
| src/types/trait.ts | [trait.md](packages/entity-core/types/trait.md) | Trait 类型系统 v1.0（字段最小语义集 + 设计决策） |

> ~~src/composables/useSessionCleanup.ts~~（Agent 会话清理）已于 2026-09-27 E8 随旧会话库退场；
> ~~src/agent-descriptor.ts~~（entityCoreDescriptor）随 Agent 工具目录退场。

### packages/perf-kit（packages/perf-kit）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/reactive/batchedUpdates.ts | [batchedUpdates.md](packages/perf-kit/reactive/batchedUpdates.md) | 批量更新合并器（解决 PERF-03 更新风暴） |
| src/render/idleRaf.ts | [idleRaf.md](packages/perf-kit/render/idleRaf.md) | 空闲 RAF 管理器（解决 PERF-22 常驻 CPU） |
| src/render/virtualList.ts | [virtualList.md](packages/perf-kit/render/virtualList.md) | 通用虚拟滚动 hook（前缀和 + 二分定位） |

### packages/plugin-sdk（packages/plugin-sdk）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/components/EntityFormModal.vue（2026-08-06 script 拆分） | [entity-form-modal.md](packages/plugin-sdk/entity-form-modal.md) | 实体表单弹窗：模板 + 编排，五类逻辑拆为 4 个 composable（行为不变） |
| src/components/entity/useFieldPresets.ts | [entity-form-modal.md](packages/plugin-sdk/entity-form-modal.md) | 字段合并（SYSTEM_KEYS + fieldRegistry）、预设管理、拖拽排序、字段增删 |
| src/components/entity/useDynamicForm.ts | [entity-form-modal.md](packages/plugin-sdk/entity-form-modal.md) | formData 状态与初始化、输入事件（name/text 事件总线）〔ghost 防抖已于 E6 随 Smart Fill 退场〕 |
| src/components/entity/useEntityRefSearch.ts | [entity-form-modal.md](packages/plugin-sdk/entity-form-modal.md) | entityRef 类型字段的搜索下拉状态与交互 |
| src/components/entity/useEntityFormSave.ts | [entity-form-modal.md](packages/plugin-sdk/entity-form-modal.md) | save 校验/收集（properties/tags/entityRef/autoLink/封面）、实体引用关系同步 |
| src/components/GenericEntityView.vue | [实体视图滚动链.md](packages/plugin-sdk/实体视图滚动链.md) | 实体卡片网格滚动链：定高容器下 auto 隐式行 / 列向 flex 子项的自动最小尺寸因卡片 overflow:hidden 归零 → 压扁且不出滚动条；`grid-auto-rows:min-content` + `has-custom-list>*{flex-shrink:0}` 修复（2026-10-01） |
| src/composables/useBatchDelete.ts | [批量选择态.md](packages/plugin-sdk/批量选择态.md) | 批量态状态机（进出清空选中 / 清空≠退出 / 删除后留态）；常驻复选框退役，改显式批量态 + 点击路由（2026-10-01） |
| src/components/EntityPager.vue | [实体视图分页.md](packages/plugin-sdk/实体视图分页.md) | 分页控件（左右箭头 + 当前页/总页数）；抽独立组件保持 GEV 精简、可复用（2026-10-01） |
| src/components/GenericEntityView.vue（分页） | [实体视图分页.md](packages/plugin-sdk/实体视图分页.md) | 每页 100 条 + `Ctrl+←/→` + 撤「>200 项」警告条；**插槽消费方（区域/势力）不分页**——分页子集会让树丢页外节点（2026-10-01） |

> ~~src/agent-descriptor.ts~~（pluginSdkDescriptor）已于 2026-09-27 E8 随 Agent 工具目录退场。

### 已随旧 Agent 面退场的模块（2026-09-27 E8，git 历史可找回）

| 模块 | 说明 |
|---|---|
| crates/agent-{kernel, patterns, runtime, commands, memory, index, engine} + crates/vendor | Rust Agent 内核/编排/命令/记忆底座（四项裁定：记忆底座 / 产品能力四件 / 会话契约 / 芽语义表全部物理删除） |
| crates/worldsea-skills-store | Skills 商城纯逻辑（候选 7 裁删） |
| packages/agent-runtime | TS Agent 运行时（worldview 芽语义表 / tools / skills / group-chat / providers 等；模型注册表五件打捞至 ui-kit） |
| packages/agent-core · packages/governor-core | 编排核心与调控器（§4.2 判「不值得留」） |
| shared-ui/src/agent · shared-composables/src/agent | Agent UI 组件层与 composables（流式渲染器 / A2UI 候选裁删） |
| src-tauri agent 命令族 | commands.rs / mcp_\* / search\* / web_fetch\* / net_egress / skills_store / plan_commands / tool_catalog_commands / frontend_tool_bridge / http_bridge/ |
| 各包 agent-descriptor.ts × 7 | 旧工具目录描述符（plugin-sdk / canvas-engine / entity-core / ui-kit / font-kit / motion-kit / agent-core） |

> packages/canvas-engine、packages/font-kit、packages/motion-kit 的 src/ 下无 ≥ 10 行长注释块，未生成文档。
> plugin-sdk 拆分：4 个 composable 均为短注释（<10 行连续块），详细说明统一登记于 entity-form-modal.md。
> 索引随整改批次持续推进，未整改模块完成后再补充登记。
