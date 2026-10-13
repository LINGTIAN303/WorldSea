# 详细注释文档索引

> 承载代码内注释分层后的「详细」层（why/how）：设计决策、整体思路、模块职责、事件协议、踩坑约束。
> 代码文件内仅保留一行简要注释 + 本目录相对路径；此处按模块与代码文件一一对应。
> 配套规则见【[2026-08-06-comment-hierarchy-plan.md](../../plans/已完成/2026-08-06-comment-hierarchy-plan.md)】。
> 代码变更影响注释含义时，必须同步更新本目录对应文档。
>
> **2026-09-27 E8 冻结面收口**：旧 Agent 面（crates/agent-\* 九目录、src-tauri agent 命令族、
> packages/{agent-runtime, agent-core, governor-core}、shared-ui/agent、shared-composables/agent、
> ui-kit 工具面板等）已物理删除，对应注释文档同步删除（git 历史可找回）；
> 模型注册表与 smart-fetch 五份随模块打捞至 `packages/ui-kit/model-registry/`
> **（该打捞件已于 2026-10-02 随唯一消费者「陪伴模式」整体退役而清退，五份注释文档随删）**。

## 模块清单

### worldsea-core（worldsea-core）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/lib.rs | [lib.md](worldsea-core/lib.md) | 库概览：模块总览（含 algo/schema/workflow）、feature 矩阵、快速上手示例（ValidationReport 警告统计口径，2026-10-13 注释整改迁入） |

### tauri（apps/tauri）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src-tauri/src/lib.rs | [lib.md](tauri/lib.md) | 壳进程入口长注存档：WebView2 Runtime 152 间歇性崩溃记录（现象/排除项/对策），代码内留 5 行摘要 |
| src-tauri/src/fs_commands.rs | [fs-commands.md](tauri/fs-commands.md) | 文件系统命令层定位（应用层直通、兜底防线）与目录口径裁定：产品域宽口径 vs dsh 严沙箱并存是显式设计（2026-10-13 注释整改迁入） |
| src-tauri/src/office_commands.rs | [office-commands.md](tauri/office-commands.md) | 本机 LibreOffice 转换设计缘由：前端渲染还原度差、缓存键（路径+mtime+size 哈希）与 DefaultHasher 稳定性注记（2026-10-13 注释整改迁入） |
| src-tauri/src/workspace_dist.rs | [workspace-dist.md](tauri/workspace-dist.md) | 工作台静态伺服口径：产物不嵌二进制、与 dsh 桥无关、同源、GET/HEAD 闸门 + 越界复核、缓存与 index 注入（2026-10-13 注释整改迁入） |
| src-tauri/src/acl_fix.rs | [acl-fix.md](tauri/acl-fix.md) | 可回滚工作区权限修复（rc.2 形态）：主路径/兜底双路线口径与实测取证（2026-10-13 注释整改迁入） |
| src-tauri/src/dsh_bridge.rs | [dsh-bridge.md](tauri/dsh-bridge.md) | worldsea 协议层代理宿主完整口径：UI origin/传输面分离与自定义协议落形（2026-10-13 注释整改迁入） |
| src-tauri/src/dsh_bootstrap.rs + scripts/build-dsh-runtime.ps1 | [dsh-bootstrap.md](tauri/dsh-bootstrap.md) | Agent 运行时随安装器分发：node 载体配方、闭包清单四路推导、legacy deploy 三坑、首启幂等装配、追版动作（2026-10-13） |
| src-tauri/src/channel_order.rs | [channel-order.md](tauri/channel-order.md) | Channel 投递全序修复：Tauri Channel 双路径乱序的取证链与根治方案（2026-10-13 注释整改迁入） |
| src-tauri/src/proc_quiet.rs | [proc-quiet.md](proc-quiet.md) | GUI 模式隐藏子进程控制台窗口：CREATE_NO_WINDOW 方案与 6 处接入点（2026-10-13 注释整改迁入） |
| src/core/coreBackend.ts | [coreBackend.md](tauri/coreBackend.md) | coreBackend Phase 3 端分离：移除 WASM、纯 invoke 路径、签名兼容；2026-08-06 收敛为 api/ 领域拆分聚合（re-export） |
| src/main.ts | [main.md](tauri/main.md) | Tauri 端入口：端分离策略、Phase 3/4 演进说明 |
| vite.config.ts | [vite-config.md](tauri/vite-config.md) | Tauri 端 Vite 配置：IPC 直连设计原则、WASM 算法降级、端口与构建触发 |
| src/memory-archive/adapters/TauriFsOperations.ts | [TauriFsOperations.md](tauri/TauriFsOperations.md) | FsOperations 的 Tauri 实现：cmd_fs_* 命令映射 |
| src/ui/layout/sidebar/viewOrder.ts | — | 侧栏可见视图**唯一顺序口径**（`isViewVisible` 过滤 + `sidebarOrder` 排序）：渲染（SidebarV2）与 `Ctrl+↑/↓` 切换（Shell）共用，修「切得太多/乱跳」（2026-10-01；短注释未立文档）；`resolveDefaultViewId`＝首屏默认挑选单点（boot 冷启动：恢复上次视图 `worldsea_last_view`，否则侧栏首项——修「首屏总是服饰/装备」，2026-10-09） |
| src/world/plugins/regions/RegionList.vue | [实体视图分页.md](packages/plugin-sdk/实体视图分页.md) | 区域视图：默认卡片 + 卡片模式分页（页状态由 GEV 经槽属性下放）；插槽自绘卡片/树样式自带、批量态路由、视图切换按钮显式 color（2026-10-01） |
| src/world/plugins/timeline/TimelineView.vue | [实体视图分页.md](packages/plugin-sdk/实体视图分页.md) | 时序表分页：`pageable`=竖向+时序表（横向画布/大纲树不分页）；`timeline.page-prev/next` 字面量 id 须进快捷键目录；卸载注销全部视图键（2026-10-01） |
| src/world/plugins/timeline/components/TimelineChart.vue | [实体视图分页.md](packages/plugin-sdk/实体视图分页.md) | `verticalEvents` 决定喂分页子集（时序表）还是全量（树）；`pagedEvents` prop 可选，缺省即不分页（2026-10-01） |
| src/world/plugins/timeline/composables/eraGroups.ts | — | 纪元分组纯函数（空组剔除 / 未知纪元归尾）；抽出以让「喂全量还是喂当前页」由调用方决定（2026-10-01；短注释未立文档） |
| src/world/plugins/outline/board/BoardView.vue | [实体视图分页.md](packages/plugin-sdk/实体视图分页.md) | 大纲侧核查结论：**三处自有列表都不分页**（白板网格量级个位数 / 节点是树 / 章节是拖拽调色板）；挂账改做虚拟化（2026-10-01） |
| src/styles/theme.css | — | 全局基座：`*{box-sizing}` + **`button{color:inherit}` 复位**（UA 的 `color:buttontext` 不继承 → 未写 color 的按钮在暗色下黑字；25 处存量同型一次免疫，2026-10-01） |
| 拆分记录（2026-08-06） | — | coreBackend.ts 按领域拆为 src/core/api/（schema / retrofit / entity / algo / health / runtime + index 聚合），coreBackend.ts 保留 `export * from './api'`，类型统一来自 @worldsea/core-api-types，公共导出签名不变，原 import 处无需改动；各新文件无 ≥ 10 行连续注释块，未生成新文档 |

> ~~src-tauri/src/commands.rs~~（commands.md）、search-config / net-egress / web-fetch / useTerminalRust /
> TerminalView / SessionList / agent-ux-guidelines / http-bridge-scope / usePlanRust 等注释文档已随
> E6–E8 旧 Agent 面清退删除；`src-tauri/src/win_job.rs`（LSP Job Object 打捞件）头注自足，未另立文档。

### packages/ui-kit（packages/ui-kit）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/components/entity/map/useAdjoin.ts | [useAdjoin.md](packages/ui-kit/components/entity/map/useAdjoin.md) | 接壤模式 composable（borders 关系 + 合并逻辑） |
| src/components/entity/map/useBorderErase.ts | [useBorderErase.md](packages/ui-kit/components/entity/map/useBorderErase.md) | 抹除/移动边境线 composable（偏移/重划模式） |
| src/components/entity/map/useDrawing.ts | [useDrawing.md](packages/ui-kit/components/entity/map/useDrawing.md) | 绘制模式 composable（手绘 + Alt 边境线） |
| src/components/entity/GenericTreeView.vue | [批量选择态.md](packages/plugin-sdk/批量选择态.md) | 树行批量态路由：`showCheckbox` 退役（复选框不再使用），新增 `batchMode`（行点击→选中切换）；势力树经 `OrgTreeNode` 接线（2026-10-01） |
| src/components/TuiButton.vue | [TuiButton.md](tauri/components/TuiButton.md) | 全仓唯一按钮组件（2026-10-01 自 apps 下沉 + `active` 属性）；收编跨文件重复的 `.btn*` 族（映射见档），基座 `button{color:inherit}` 复位 UA 黑字坑 |
| src/components/settings/panels/SproutsPanel.vue | — | 芽管理面板（26 个世界观芽开关 + 分类筛选 + 拖拽排序；2026-09-10 由 PluginsPanel 更名；原 27 个，`official.module-builder` 已于 2026-09-25 随「自定义模块」整体剪除） |
| src/components/settings/settings-panels.css | [settings-panels-convention.md](packages/ui-kit/settings-panels-convention.md) | 设置面板统一约定（三契约/基座样式/scoped 陷阱/卡片清单） |
| src/index.ts | [index.md](packages/ui-kit/index.md) | ui-kit FACADE 包说明（聚合/委托导出） |
| src/composables/useAsk.ts | [useAsk.md](packages/ui-kit/useAsk.md) | 提问面板批量问题协议（对齐 dsh ask_user_question：单选/多选/自定义/跳过/取消）（2026-10-13 注释整改迁入） |

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

> src/agent/**（useAgent / long-task / useTitleGen 等）已于 2026-09-27 E8 整体退场。
> src/companion/**（含 2026-09-27 E8 打捞的 llm.ts）已于 2026-10-02 随陪伴模式整体退役。

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
| src/core/IngestNormalizers.ts | [IngestNormalizers.md](packages/entity-core/core/IngestNormalizers.md) | 实体装载边界归一器：多写入方格式不受控，进 store 前按类型归一一次，幂等约束（2026-10-13 注释整改迁入） |
| src/stores/entityStore.ts | [entityStore.md](packages/entity-core/stores/entityStore.md) | loadByType 历史缺陷记录全文（2026-10-13 注释整改迁入） |
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
| src/components/entity/useEntityRefSearch.ts（**已随 1a 退役**，件已删） | [entity-form-modal.md](packages/plugin-sdk/entity-form-modal.md) | entityRef 类型字段的搜索下拉状态与交互（现由 `detail/EntityRefControl.vue` 承担） |
| src/components/entity/useEntityFormSave.ts | [entity-form-modal.md](packages/plugin-sdk/entity-form-modal.md) | save 校验/收集（properties/tags/entityRef/autoLink/封面）、实体引用关系同步 |
| src/components/GenericEntityView.vue | [实体视图滚动链.md](packages/plugin-sdk/实体视图滚动链.md) | 实体卡片网格滚动链：定高容器下 auto 隐式行 / 列向 flex 子项的自动最小尺寸因卡片 overflow:hidden 归零 → 压扁且不出滚动条；`grid-auto-rows:min-content` + `has-custom-list>*{flex-shrink:0}` 修复（2026-10-01） |
| src/composables/useBatchDelete.ts | [批量选择态.md](packages/plugin-sdk/批量选择态.md) | 批量态状态机（进出清空选中 / 清空≠退出 / 删除后留态）；常驻复选框退役，改显式批量态 + 点击路由（2026-10-01） |
| src/composables/useEntityPaging.ts | [实体视图分页.md](packages/plugin-sdk/实体视图分页.md) | 分页口径唯一实现：源列表全量 / `pagedList` 只切渲染段 / 末页收敛内置 / `resetPage` 由调用方接线；6 例守卫（反证：摘收敛 watch → 收敛例报红）（2026-10-01） |
| src/composables/consistencyRules.ts + useConsistencyChecker.ts | [一致性检查.md](packages/plugin-sdk/一致性检查.md) | 一致性检查纯函数规则集（自 entity-core 迁入——需 normalizeFieldType 单一来源）：10 类检查 + 真空值判定修「0/false 必填误报」+ customFields 并检；composable 只解包 stores 喂纯函数，11 例单测不依赖 pinia（2026-10-02） |
| src/components/EntityPager.vue | [实体视图分页.md](packages/plugin-sdk/实体视图分页.md) | 分页控件（左右箭头 + 当前页/总页数）；抽独立组件保持 GEV 精简、可复用（2026-10-01） |
| src/components/GenericEntityView.vue（分页） | [实体视图分页.md](packages/plugin-sdk/实体视图分页.md) | 每页 100 条 + `Ctrl+←/→` + 撤「>200 项」警告条；分页逻辑已下沉 `useEntityPaging`；**插槽消费方（区域/势力）默认不分页**——分页子集会让树丢页外节点（2026-10-01） |
| src/detail/（fieldType / fieldControlMap / fieldValue / fieldAccessor / draftKeys / detailLayout / useDetailLayout / FieldControl / EntityRefControl / EntityDetailForm） | [实体详情表单.md](packages/plugin-sdk/实体详情表单.md) | 详情地基：`normalizeFieldType` 单点吸收三套 fieldType 命名漂移（未知类型显式 `unknown`，不得静默转 text）；控件映射是**数据**不是分支；顶层字段真值定位（修「每实体白挂 2-3 条恒为 — 的幽灵行」）；三级合并取整表替换 + 缺失补齐 + 幽灵 key 剔除；布局落 `worldsea_detail_layouts`，自定义字段改**类型级 `fieldRegistry`**（不再塞 `properties.__customFieldDefs`）（2026-10-02 批次 1a） |
| src/composables/useEntityEdit.ts | [实体详情表单.md](packages/plugin-sdk/实体详情表单.md) | 编辑态单轨：`editForm` 草稿 + `saveEdit` 一次提交为唯一写路径；`splitDraft` 保 properties 合并语义；顺带修「模板预填新建走 `update('')` 静默不落地」（守卫 `components/__tests__/genericEntityViewSaveMode.spec.ts`，反证已咬）（2026-10-02） |
| src/detail/fieldScope.ts · src/components/EntityCard.vue | [实体详情表单.md](packages/plugin-sdk/实体详情表单.md) | 自定义字段**两级作用域**（走查改判）：默认 `entity` 落该实体 `properties.__fieldDefs`（导出保真、随实体删）、可选 `type` 落 `fieldRegistry`；合并＝类型级在前 + 同 key 以类型级为准 + 查重跨两层；默认作用域是设置项（落 `detailLayoutStore` 避免撑爆已冻结的 settingsStore）+ 添加时当场可改 + 字段行「共享/仅本实体」互转（值不动）。同轮卡片外移 `EntityCard`（翻转态自持），GEV 854→735 行（减压而非动基线）（2026-10-02） |
| src/components/UniversalRelationPanel.vue · EntityRelationSelector.vue · AutoLinkSuggestions.vue | [实体详情关系区.md](packages/plugin-sdk/实体详情关系区.md) | 关系区**事实清单**（用户裁定本轮不动结构）：三套 UI 并存 + URP 内嵌 ERS 两次 + 四芽绕行单挂 ERS；三条写口语义分叉（`createBidirectional` 双向 vs `storage.putRelation` 单向且绕 store vs `deleteWithConfirm` 只覆盖 URP 视图内的边）；留给裁定的三问（2026-10-02） |
| src/components/EntityFormModal.vue · entity/use{DynamicForm,EntityFormSave,FieldPresets}.ts · BatchEditModal.vue · timeline/components/EventDetailFields.vue | [实体详情表单.md](packages/plugin-sdk/实体详情表单.md) §九§十 | 四套字段控件归一为 `FieldControl` 一套（`DetailField.vue` 与 `useEntityRefSearch.ts` 已删）；`formData` 泛化 unknown（不再 `String()` 抹平数组）；**entityRef 落库统一存 id**（守卫 6 例 + 反证双向报红）；`useFieldPresets` 的第二处「不认识就当天」白名单拆除；`richtext` 升独立类型保富文本；批量编辑单条改行内控件（2026-10-02 批次 1a 余下段） |
| src/detail/（contentForms / formValues / useFieldSource / DetailFieldRow / forms/）· EntityDetailForm.vue · apps/tauri/src/ui/settings/panels/{DetailSettingsPanel,DetailGroupsCard}.vue | [实体详情内容形态.md](packages/plugin-sdk/实体详情内容形态.md) | **L2 内容形态**五式（分组式唯一 inline，表格/段落/摘要/时间轴为 derived）：注册表沿用大纲白板范式但**只留 configSchema 一份默认值**、形态件在仓内注册不开放芽自注册；`fieldFamily` 单点归类（`date` 类型**或**约定时间 key）；派生型编辑态回落分组式（保住 1a 的写路径单轨），高亮仍留用户所选；`DetailFieldRow` 共用 ⇒ 形态之间只差编排不差控件；只读三口径（entityRef 解名/失败说实话、image 报「已配图」、空值不进摘要但如实报数）；`contentConfig` 与 `contentForm` 同键同优先序落盘；段落式复用主窗口 markdown 内核（marked+DOMPurify，
走 `@worldsea/shared-ui/markdown/stream` 子路径避开 Prism），芽声明默认经 GEV/SchemaRenderer 的
芽声明默认经 GEV/SchemaRenderer 的
`detailLayout` prop 进入三级合并（首批样例 characters→段落式、items→摘要式）；**1b-2 续批**＝命名预设与详情覆写**分轴**（`loadPreset` 去掉 `resetToBuiltin` 破坏、只重排不增删字段）+ 设置五卡（含分组草稿卡）+「布局管理」弹窗退场（CRUD 收进设置，弹窗 preset-bar 只留切换）；**只读面分工**＝段落式真渲染，其余四式走 `stripMarkdownSyntax` 去语法留内容（收敛点 `toDisplayText`，编辑态仍显示源文）；**1b-2 设置 Tab**＝`apps/tauri/src/ui/settings/panels/DetailSettingsPanel.vue` 三卡（形态/顺序与可见性/配置），读写一律走 `useDetailLayout` 只留一条合并路径，实现留 app 侧避免 plugin-sdk↔ui-kit 成环；**批次 2 第一刀（2026-10-04）**＝L1 载体注册表 `carriers.ts` + `ColumnDetailView`（栏式整页），两容器共用 `useDetailChrome`/`carrier-chrome.css`（`.dp-shell` 前缀），载体覆写分键 `worldsea_detail_carriers`，缺省抽屉＝未声明零变化；**走查后补刀（同日 `fc950bc`）**＝`panel-id` 必须带载体名（共用一把键时"宽度各记各的"是假的）+ `useResizable` 拖宽按帧落地、上界起拖时锁定，另如实登记一条被反证否决的"优化"（Vue 编译器 cacheHandler 本已稳定模板内联箭头身份）与抽屉遮罩点击死码（后按裁定做成**全局可配置一档**，缺省穿透）；**档 B 九枚芽默认栏式已落地**并配静态守卫 `apps/tauri/src/world/plugins/__tests__/sproutCarrierDeclaration.spec.ts`；**批次 2 四式已齐**（§十二）＝居中弹层 / 沉浸页 / 浮层小窗 + `DetailShell`/`DetailBackdrop` 两个共用件先抽再加、`CarrierMode` 三值、载体不再对外单独导出 |

> ~~src/agent-descriptor.ts~~（pluginSdkDescriptor）已于 2026-09-27 E8 随 Agent 工具目录退场。

### packages/core-api-types（packages/core-api-types）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/index.ts | [index.md](packages/core-api-types/index.md) | coreBackend 双端共享契约类型包：定位、Core* 前缀类型归属与双端同步约定（2026-10-13 注释整改迁入） |

### packages/theme-kit（packages/theme-kit）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/index.ts | [index.md](packages/theme-kit/index.md) | 包退役说明：主题收束为「底色 × 强调色」两轴后的职责去向与取证（2026-10-13 注释整改迁入） |

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
