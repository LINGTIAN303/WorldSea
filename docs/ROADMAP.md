# WorldSmith 任务路线计划

> 创建于 2026-07-02。本文件独立于项目记忆文档（`project_memory.md`）维护，
> 防止记忆文档反复更新导致任务路线丢失。任务状态变更时直接更新本文件。
>
> 维护规则：
> - 每条任务含编号、标题、简述、涉及模块、状态、优先级
> - 状态枚举：📋 待启动 / 🔍 规划中 / 🚧 进行中 / ✅ 已完成 / ⏸️ 暂停
> - 优先级枚举：P0（紧急）/ P1（高）/ P2（中）/ P3（低）/ —（未定）
> - 完成的任务移至文末"已完成任务"章节，保留记录

---

## 一、Agent 系统增强

### 3. Agent 的技能工具更新
- **简述**：更新 Agent 的技能（Skills）工具体系，与 governor-modules.ts 的 toolMeta 模块对接
- **涉及模块**：`worldsmith-agent/src/agent.ts`、`src/agent/`、`@worldsmith/agent-core`、`@worldsmith/governor-core`
- **状态**：🚧 进行中（P1-P3 接线 + P4 补 meta 淘汰 LEGACY_TOOL_META 完成，2026-07-07）
- **优先级**：—
- **备注**：当前 toolMeta 是验证-only，需实现真实技能注册与动态加载。P1-P3 已让 agent-core 的 ToolRegistry/SkillRegistry 从死代码变为运行时可用（commit 88735cd）：P1 tool-meta-registry 接 ToolRegistry；P2 skills/registry 自动注册 SkillRegistry；P3 toolbus resolveLegacyNames 委托 SkillRegistry。P4 补全所有静态工具声明式 meta（Batch 1-7 + skills/meta-tools），淘汰 LEGACY_TOOL_META（清空为空对象，buildMetaCache 不再收集）。待后续：切换 resolveToolNames 到 SkillRegistry、任务24 Skills 商城依赖本任务

### 4. Agent 的长任务能力
- **简述**：支持 Agent 长任务（最长 6 小时），无强制中断机制，优化在应用层
- **涉及模块**：`src/agent/composables/useAgent.ts`、`src/agent/composables/useLongTask.ts`、`src/agent/composables/longTaskStore.ts`、`src/agent/composables/useOrchestrator.ts`、`src/agent/AgentChat.vue`、`src/agent/AgentOverlay.vue`、`worldsmith-agent/src/bridge.ts`、`worldsmith-agent/src/bridge-types.ts`、`src/space/group-chat/`
- **状态**：✅ 已完成
- **优先级**：—
- **备注**：用户画像明确要求"无强制中断机制，支持长任务最长 6 小时"。P1 核心管理器（状态机+心跳5s+checkpoint+协作式取消）+ P2 断点恢复（detectAndOfferResume+横幅UI+setRuntimeMessages）+ P3 进度反馈 UI（输入框上方进度条：心跳脉冲+时长+轮次+当前tool+停止）+ P4 子 Agent 接入（去超时+checkpoint+心跳+多任务Map，复用 longTaskStore）。风险点修复：beforeToolCall id 类型、abort+waitForIdle 不重建。不做子 Agent 恢复（后台任务刷新后重跑即可）

### 19. Agent 与用户的头像信息卡
- **简述**：Agent 和用户的头像悬停/点击展示信息卡（Persona 资料、模型、状态等）
- **涉及模块**：`src/agent/AgentMessageBubble.vue`、`src/space/panels/PersonaMirror.vue`、`src/space/panels/UserProfilePopover.vue`、`src/stores/agentProfileStore.ts`、`src/stores/personaStore.ts`
- **状态**：📋 待启动
- **优先级**：—
- **备注**：群聊模式下已有 UserProfilePopover / PersonaMirror，可复用并下沉到 Agent 主面板

## 二、编辑器与内容创作

### 2. 笔记本、正文写作两个插件的编辑器迭代
- **简述**：迭代 `notebook` 和 `manuscript` 插件的编辑器体验
- **涉及模块**：`src/plugins/official/notebook/`、`src/plugins/official/manuscript/`、`src/ui/editor/RichTextEditor.vue`、`@tiptap/*`
- **状态**：📋 待启动
- **优先级**：—
- **备注**：基于 TipTap 3，需明确迭代方向（性能？功能？交互？）

### 11. 预填充功能迭代
- **简述**：迭代 SmartFill（智能预填充）功能
- **涉及模块**：`src/composables/useSmartFillChat.ts`、`src/composables/useSmartFillContextMenu.ts`、`src/ui/smart-fill/`
- **状态**：📋 待启动
- **优先级**：—
- **备注**：已有 SmartFillChat / SmartFillContextMenu / SmartFillChatTrigger 基础，需明确迭代目标

### 13. 创作编排插件的迭代优化
- **简述**：迭代 `workflow` 插件（创作编排）
- **涉及模块**：`src/plugins/official/workflow/`、`src-tauri/src/workflow/`（Rust 端 engine/executor/dispatch_protocol）
- **状态**：📋 待启动
- **优先级**：—
- **备注**：Rust 端已有完整 workflow 引擎（dispatch/dry_run/runs/settings + executor），前端迭代需对接

### 14. 思维导图插件的真实实现
- **简述**：将 `mindmap` 插件从占位实现替换为真实可用的思维导图
- **涉及模块**：`src/plugins/official/mindmap/`（MindmapView.vue / mindmapStore.ts / index.ts）、`@worldsmith/canvas-engine`
- **状态**：📋 待启动
- **优先级**：—
- **备注**：canvas-engine 已提供 core/geometry/graph/tree 基础，可作为底层；当前 MindmapView 可能是简化实现

## 三、插件系统与实体详情

### 7. 18 个实体类插件的实体详情优化
- **简述**：优化 18 个实体类插件的实体详情视图（InfoPanel / 各插件 View）
- **涉及模块**：`src/plugins/official/*/`（apparel/buildings/characters/combat_stats/concepts/conflict/culture/custom/drawing/items/languages/magic/organizations/plants/regions/species/timeline/weapons）、`src/ui/entity/InfoPanel.vue`、`src/ui/entity/EntityTemplateDialog.vue`
- **状态**：📋 待启动
- **优先级**：—
- **备注**：涉及面广，建议分批进行；需先确定统一的设计规范再逐个优化

### 9. 个别插件实体的树列表子实体
- **简述**：为个别插件的实体树列表增加子实体层级支持
- **涉及模块**：`src/ui/WsTree.vue`、`src/ui/WsTreeNode.vue`、`src/plugins/official/regions/RegionList.vue`、`src/plugins/official/regions/TreeNode.vue`、`src/ui/entity/GenericTreeView.vue`
- **状态**：📋 待启动
- **优先级**：—
- **备注**：regions 插件已有 RegionList/TreeNode，可作为参考模式推广到其他插件

### 10. 个别插件的子插件视图
- **简述**：为个别插件增加子插件视图（一个插件内嵌套子插件）
- **涉及模块**：`src/plugins/PluginManager.ts`、`src/plugins/PluginSandbox.ts`、`src/plugins/plugin-manifest.ts`、`@worldsmith/plugin-sdk`
- **状态**：📋 待启动
- **优先级**：—
- **备注**：需先确认哪些插件需要子插件视图，以及子插件的注册/渲染机制

## 四、AutoLink 与关系系统

### 6. AutoLink 的丰富与字段自更新
- **简述**：丰富 AutoLink（实体自动链接）功能，支持字段自更新
- **涉及模块**：`src/composables/useTextSelection.ts`、`src/agent/composables/useAgentPluginBridge.ts`、`@worldsmith/entity-core`（relations）
- **状态**：📋 待启动
- **优先级**：—
- **备注**：当前已有 useTextSelection / useAgentPluginBridge 基础；"字段自更新"指 AutoLink 触发后自动同步相关字段

### 8. AutoLink 的关系预览窗（替代确认弹窗）
- **简述**：用关系预览窗替代 AutoLink 的确认弹窗，提升交互流畅度
- **涉及模块**：`src/composables/useTextSelection.ts`、`src/ui/entity/InfoPanel.vue`、`src/ui/WsPopover.vue`、`src/ui/WsConfirmDialog.vue`
- **状态**：📋 待启动
- **优先级**：—
- **备注**：用户偏好"弱提示而非强提示"，关系预览窗符合此偏好；需复用 WsPopover

## 五、图谱与可视化

### 15. 全局图谱的视觉与交互迭代优化
- **简述**：迭代 `graph` 插件（全局图谱）的视觉与交互
- **涉及模块**：`src/plugins/official/graph/GlobalGraph.vue`、`sigma`、`graphology`、`d3-force`、`d3-zoom`
- **状态**：📋 待启动
- **优先级**：—
- **备注**：已用 sigma + graphology + graphology-communities-louvain + graphology-layout-forceatlas2，技术栈完整

### 18. 区域图谱的 map 视图迭代优化
- **简述**：迭代 `regions` 插件的地图视图
- **涉及模块**：`src/plugins/official/regions/`、`src/ui/entity/RegionMap.vue`、`@worldsmith/canvas-engine`
- **状态**：📋 待启动
- **优先级**：—
- **备注**：已有 RegionMap.vue，需明确迭代方向（地理坐标？层级缩放？标注？）

### 27. 交互式世界地图
- **简述**：实现交互式世界地图功能
- **涉及模块**：待定（可能复用 `@worldsmith/canvas-engine`、`src/ui/entity/RegionMap.vue`、`src/plugins/official/regions/`）
- **状态**：📋 待启动
- **优先级**：—
- **备注**：与任务 18（区域图谱 map 视图）有关联，需确认是否同一功能或独立功能

## 六、UI / 视觉 / 字体

### 5. 字体库的优化
- **简述**：优化字体库系统
- **涉及模块**：`@worldsmith/font-kit`、`src/stores/fontLibraryStore.ts`、`src/stores/fontStore.ts`、`src/composables/useFontBootstrap.ts`、`src/composables/useFontPresets.ts`、`src/composables/fontSpanParser.ts`、`src/ui/font/`
- **状态**：📋 待启动
- **优先级**：—
- **备注**：font-kit 已有 FontLoader/FontRegistry/FontRenderer/TauriFontBridge/WsFontPack 完整体系，需明确优化方向

### 12. 嵌入式 AI 功能 UI 的迭代优化
- **简述**：迭代嵌入式 AI 功能的 UI（SmartFill 等嵌入式 AI 入口）
- **涉及模块**：`src/ui/smart-fill/`、`src/composables/useSmartFillChat.ts`、`src/composables/useFloatingPanel.ts`
- **状态**：📋 待启动
- **优先级**：—
- **备注**：与任务 11（预填充迭代）有关联，需确认边界

### 16. 群聊模式的会话窗口交互提升
- **简述**：提升群聊模式（AgentSpace）的会话窗口交互
- **涉及模块**：`src/space/AgentSpace.vue`、`src/space/chat/`、`src/space/group-chat/`、`src/space/panels/`
- **状态**：📋 待启动
- **优先级**：—
- **备注**：群聊引擎已完整（SpeakerSelector/TopicTracker/TerminationDetector/HallucinationGuard/CostTracker/ModelHealthChecker/FallbackChain/ContextManager），交互层待提升

### 17. 图像系统的迭代升级
- **简述**：迭代升级图像系统
- **涉及模块**：待定（可能涉及 `src/agent/blocks/BlockImage.vue`、`src/agent/blocks/A2UIResolvedImage.vue`、`@worldsmith/motion-kit`）
- **状态**：📋 待启动
- **优先级**：—
- **备注**：需明确"图像系统"范围（生成？管理？展示？编辑？）

### 26. 灯罩灯效变化系统
- **简述**：实现灯罩灯效变化系统（视觉氛围系统）
- **涉及模块**：待定（可能涉及 `@worldsmith/theme-kit`、`src/assets/themes.css`、`src/design-tokens/`）
- **状态**：📋 待启动
- **优先级**：—
- **备注**：需明确产品定位（环境氛围灯？主题动态效果？）

## 七、商城与外部集成

### 21. APIkey 的官方控制台跳转
- **简述**：在 API Key 配置界面提供跳转到各 Provider 官方控制台的入口
- **涉及模块**：`src/stores/settingsStore.ts`、`src/ui/settings/SettingsDialog.vue`、`src/assets/provider-icons/`
- **状态**：📋 待启动
- **优先级**：—
- **备注**：已有 13 个 provider 图标（agnes/deepseek/doubao/google/groq/minimax/mistral/moonshot/openai/qwen/stepfun/xai/zhipu），需维护 provider → 控制台 URL 映射

### 22. 气泡商城
- **简述**：实现气泡商城（购买/获取对话气泡样式）
- **涉及模块**：待定（前端展示 + 后端交易/兑换逻辑）
- **状态**：📋 待启动
- **优先级**：—
- **备注**：需明确商业模式（付费？积分？）和技术架构

### 23. 盲盒设定卡
- **简述**：实现盲盒设定卡功能（随机生成实体设定）
- **涉及模块**：`@worldsmith/entity-core`、`src/plugins/official/`、`src/agent/`
- **状态**：📋 待启动
- **优先级**：—
- **备注**：可结合 Agent 能力随机生成设定；需明确盲盒机制（稀有度？主题？）

### 24. Skills 商城
- **简述**：实现 Skills 商城（Agent 技能的分发/安装）
- **涉及模块**：`@worldsmith/agent-core`、`worldsmith-agent/`、`src/agent/`、`src-tauri/src/lib.rs`、`src-tauri/src/skills_store.rs`、`worldsmith-skills-store/`、`docs/skills-store-spec.md`、待定的商城后端
- **状态**：🚧 进行中（阶段1 动态加载 + 阶段2 安装机制 + 阶段3 商城 UI + 阶段4 多平台互通 完成，2026-07-07）
- **优先级**：—
- **备注**：依赖任务 3（Agent 技能工具更新）的 Skills 体系完善。阶段1（动态加载基础设施）已完成：lib.rs cmd_skills_get_dir；manifest.ts 扫描+解析；registry.ts initSkillRegistry 合并视图；loader.ts fs 加载分支；agent.ts 接入。阶段2（安装机制）已完成：Rust skills_store.rs 实现 cmd_skills_download_manifest/cmd_skills_install（reqwest下载+sha256校验+zip解压+zip slip防护）/cmd_skills_uninstall/cmd_skills_get_installed_versions；Cargo.toml 新增 reqwest(blocking+rustls)+zip+sha2；前端 skills-store.ts 封装 invoke + installSkillAndReload/uninstallSkillAndReload（安装后自动重扫）+ checkUpdates；规范文档 skills-store-spec.md 定义 manifest schema/安装流程/安全模型。阶段3（商城 UI）已完成：index.ts 导出 skills-store API；useSkillsStore composable（全局共享状态+localStorage 持久化多源配置+非Tauri降级）；SkillsStorePanel.vue（技能源配置增删启禁+商城浏览搜索+安装/更新/卸载卡片）；AgentSettingsPanel skills 子面板嵌入+skills-changed emit；SpaceAgentSettingsPanel/AgentChat 监听刷新。阶段4（多平台互通）已完成：platform-adapters.ts 多平台格式双向转换（Claude Code SKILL.md / Cursor .mdc / WorldSmith skill.yaml），detectPlatform 自动识别 + autoImportSkill 导入 + exportToXxx 导出，18 单元测试覆盖（含往返一致性）；skills_store.rs 新增 cmd_skills_import_local 命令（写入 skill.yaml+SKILL.md，支持覆盖更新）；skills-store.ts 封装 importLocalSkill/importLocalSkillAndReload；useSkillsStore importLocal 方法；SkillsStorePanel.vue 本地导入 UI（文件选择+格式识别+警告提示）。方向3（Rust 测试迁移独立 crate）已完成：新建 worldsmith-skills-store crate（无 Tauri 依赖），迁移纯函数 verify_sha256/extract_skill_zip/read_skill_version/extract_field/dest_clean/sha256_hex + 新增 write_skill_files/validate_skill_id，19 单元测试可独立 cargo test 运行（解决 Tauri lib DLL 限制），并暴露修复 3 个隐藏 bug（extract_field 去引号顺序错误、dest_clean 接收完整路径导致 base 组件重复追加、测试用例 Windows 路径分隔符）；src-tauri 改为依赖新 crate，Tauri 命令仅做 AppHandle→Path 转换。方向2（真实技能源上线）已完成：生成标准 zip（正斜杠分隔符，规避 PS Compress-Archive 反斜杠坑）+ 真实 sha256，manifest.json 指向 GitHub raw URL，README 更新生成命令+多平台互通说明。风险点1（端到端实测）：已通过 Rust 19 测试 + 前端 231 测试覆盖，桌面端 UI 端到端验证待用户运行。风险点3（测试失败）：taskTools 未归类导致 TOOL_CATEGORIES 测试失败，归入 plan 分类修复（14/14）。待后续：桌面端 UI 端到端实测 + Task 3 跟进（resolveToolNames 切换用 SkillRegistry）

### 25. MCP 商城
- **简述**：实现 MCP 商城（MCP server 的分发/安装）
- **涉及模块**：`src/agent/composables/useMcpConnections.ts`、待定的商城后端
- **状态**：📋 待启动
- **优先级**：—
- **备注**：已有 MCP 集成（Firecrawl 默认 server），需扩展为可安装/管理的商城

## 八、系统功能

### 20. 分组分类系统
- **简述**：实现实体/项目的分组分类系统
- **涉及模块**：`@worldsmith/entity-core`、`src/modules/`、`src/stores/`
- **状态**：📋 待启动
- **优先级**：—
- **备注**：需明确分组对象（实体？项目？插件？）和分类维度

### 28. 记忆库的迭代优化
- **简述**：迭代优化记忆库（Memory Archive）系统
- **涉及模块**：`@worldsmith/memory-archive`、`src/memory-archive/`、`src/agent/ArchivePanel.vue`、`src/agent/ArchiveConfigPanel.vue`、`src/agent/ChunkViewer.vue`
- **状态**：📋 待启动
- **优先级**：—
- **备注**：记忆库三层架构已完整（框架包 + 宿主集成层 + UI 层），199 测试通过。迭代方向待定（用户视角体验？性能？检索质量？）

---

## 任务依赖关系

```
任务 3（Agent 技能工具更新） ──→ 任务 24（Skills 商城）
任务 8（AutoLink 关系预览窗） ──→ 任务 6（AutoLink 字段自更新）  [可选顺序]
任务 18（区域图谱 map 视图） ──┐
                              ├─→ 任务 27（交互式世界地图）  [可能合并或递进]
任务 11（预填充迭代）         ──→ 任务 12（嵌入式 AI UI 迭代）  [边界需确认]
```

其余任务相对独立，可并行推进。

---

## 已完成任务

### 1. Agent 窗口中的实体卡片小窗口
- **简述**：在 Agent 对话窗口内嵌入实体卡片小窗，用户可在不离开对话的情况下查看/编辑实体详情
- **涉及模块**：`src/agent/AgentChat.vue`、`src/agent/EntityMiniPanel.vue`、`src/agent/composables/useEntityMiniPanel.ts`、`src/agent/blocks/BlockEntityCard.vue`
- **状态**：✅ 已完成
- **完成日期**：2026-07-06
- **备注**：经验证已完整实现。EntityMiniPanel（加载/不存在/详情三态，描述+属性可编辑，关联+标签只读，openInMainPanel 跳主面板）；两个触发入口：① BlockEntityCard"详情"按钮（emit open-detail → AgentChat onBlockAction → miniPanel.open）② 消息 mention 点击（AgentMessageBubble onMentionClick 事件委托 .ws-entity-mention → miniPanel.open）；FloatingPanel 浮窗定位不挤占消息列表

---

## 变更记录

- **2026-07-02**：创建文档，录入 28 条任务方向，按 8 大类别分组，标注涉及模块与备注
- **2026-07-06**：任务 1（实体卡片小窗）经验证已完整实现，状态更新为已完成
