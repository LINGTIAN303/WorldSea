# WorldSmith 文档索引

> 摘要层：先读本索引判断相关性，跳过已完成长文档，按需点开正文。
> 目录结构：`plans/`（计划，带 status 字段可流转）/ `details/`（项目详情）/ `index/`（本索引）/ `misc/`（其他）。
> 文档变更必须同步本索引，避免读到过期摘要。

## 计划类（plans/）

| 状态 | 文档 | 摘要（结论） | 链接 |
|------|------|-------------|------|
| 执行中 | WorldSmith 任务路线计划 | 全项目任务路线总表（按模块分组），每条含编号/状态/优先级，完成任务移至文末"已完成任务"章节 | [ROADMAP.md](../plans/ROADMAP.md) |
| 已完成 | Web 端迁入 Tauri 迁移计划 | 移除 apps/web，27 插件 + 空间 + 设置全部迁入 Tauri（复用组件+主题令牌映射），CLI 移除 serve 仅本地自动化；群聊/主题编辑器首期暂缓。7 Phase 全部完成：后端命令补全→数据层→插件迁移→空间聊天→主题→CLI（Rust 接管）→删除 web+清理 | [2026-08-08-web-to-tauri-migration-plan.md](../plans/2026-08-08-web-to-tauri-migration-plan.md) |
| 执行中 | 注释分层整改计划 | 落实注释分层约束（代码内一行简要 + 相对路径，why/how 进 docs/details/注释/）。全库 495 长注释块已抽取 374+ 块，剩余均为排除项（crates/vendor 外部代码、packages/memory-archive 待清理）；已同步 docs/details/注释/README.md 索引 | [2026-08-06-comment-hierarchy-plan.md](../plans/2026-08-06-comment-hierarchy-plan.md) |
| 已完成 | Agent 端到端闭环计划（Phase 5） | 让 Agent 从 Rust 框架就绪到 Tauri 桌面端真正可用。5.1–5.5 全部完成（命令层 / Tauri 前端链路 / UI 抽共享层 / 端到端实测+高级能力 / TS→Rust 收敛）；web-to-tauri 迁移后由 Tauri 桌面端承载（`crates/cli` 已于 2026-08-08 移除，能力由 agent-commands 覆盖） | [agent-e2e-closure-plan.md](../plans/agent-e2e-closure-plan.md) |
| 已完成 | Agent 编排框架路线图 | Rust 原生实现 13 种 Agent 模式，阶段 1（Agent loop）+ 阶段 2（编排框架）+ 阶段 3（pi-ai）均完成（2026-08-25 复核）。**架构权威已移交** [orchestration-matrix.md](../details/架构/orchestration-matrix.md)：13 模式重归位「底座能力 5 + 扩展模式 8」，本计划为历史规划视角 | [agent-orchestration-roadmap.md](../plans/agent-orchestration-roadmap.md) |
| 已完成 | 编排层架构重构：两方方案裁定与归档 | 两路 Agent 各自分析产出的方案经第三方裁定：01（甲方矩阵表）事实贡献已吸收入 matrix；02（Harness 底座攻击方向）五项核心主张全部否决（ReAct 抽离违反底座内聚等），合理内核（织入点协议化）降级执行；03 裁定纪要含后续施工链（阶段 A/B + 里程碑 2/3/5 + §7 待决 6/7） | [01-编排模式矩阵表.md](../plans/agent编排层架构重构/01-编排模式矩阵表.md) · [02-Harness底座架构设计.md](../plans/agent编排层架构重构/02-Harness底座架构设计.md) · [03-两方方案裁定纪要.md](../plans/agent编排层架构重构/03-两方方案裁定纪要.md) |
| 执行中 | 编排模式投放与框架链路：问题清单 | 13 模式如何投放到前端（触发模型/投影形态/迹线布局/干预/可解释）、后端如何生产管线事实（轨迹事件/编排上下文/降级/判型/隔离）、模式组合协议（条件支路/junction/探索定位）、里程碑划分——**研究全部收敛（2026-08-27，83/83 条：64 定案 + 17 倾向 + 2 完成）**：五把钥匙（C20 产品性格/D21 链性质/B22 运行单元/D23 交接物/A1 触发模型）+ 13 项拍板；E18/E19 已定案；**施工蓝图已产出 → [04-方案.md](../plans/编排模式投放设计/04-方案.md)** | [01-问题清单.md](../plans/编排模式投放设计/01-问题清单.md) |
| 执行中 | 编排模式投放：整合方案 v1 蓝图 | 全部研究结论的施工化：核心契约三张表（OrchestrationRun 实体含子 run 树/HandoverArtifact 九类交接物/模式注册表繁殖成本 8→2 处）+ 轨迹事件族四事件 + 预设映射表（四管线=链族预设）+ 门清单（v1 中止+插话）+ 前端形态规格（编排段时态规则/右栏详图驱动组件零重写）+ 里程碑 M1-M5 细化（每级含验收）+ 五条基准验证 + v2 延期项 12 条显式清单 + 风险 4 项 | [04-方案.md](../plans/编排模式投放设计/04-方案.md) |
| 执行中 | 编排模式投放：现状事实清单（阶段 0 勘察） | 87 条研究题的代码事实地基：模式触点对照（修正"Router 无事件"前提）/ 事件系统全景（10 前端通道、无 run_id、骨架事件已有雏形）/ 运行机制（串行 DAG、pause 空壳存根）/ 次数阈值表 / 持久化边界 / 前端资产（TracePanel 迹线雏形、11 子 tab 手动切换）/ 繁殖成本 8 处 / 钥匙问题直接输入 | [02-现状事实.md](../plans/编排模式投放设计/02-现状事实.md) |
| 执行中 | 编排模式投放：外部参照卡（阶段 1 调研） | 7 家竞品过程可视化形态卡（Claude/ChatGPT/Cursor/Windsurf/Devin/Manus/Gemini）+ 12 条反模式 + 8 条设计原则——"统一迹线 + 按需详图"方向被三头部产品殊途同归印证；可抄规格：折叠摘要 10 行 3 秒 / 密度三档 / "已学到 + 下一步"叙事；最大空白 = 多智能体过程呈现 | [03-外部参照.md](../plans/编排模式投放设计/03-外部参照.md) |
| 执行中 | perf-kit 实施方案 | 系统性解决 22 个性能问题（响应式过度/串行 I/O/缺渲染节流）。`@worldsmith/perf-kit` 包已建，Phase 1-3 全落地 + Phase 4 部分落地（虚拟滚动/脏矩形/DB 下推），其余待排期 | [perf-kit-plan.md](../plans/perf-kit-plan.md) |
| 执行中 | 大文件拆分计划 | 测试分离（agent-runtime 7 + agent-commands 4，`#[path]` 方式）+ 数据型拆分（SKILL_REGISTRY 按类别拆入 skills/data/）+ EntityTypeSchema 三份定义统一（core-api-types 契约权威）；14 包 typecheck 全绿，已提交 80d35e1 | [2026-08-06-large-file-split-plan.md](../plans/2026-08-06-large-file-split-plan.md) |
| 执行中 | MemoryCenter 召回集成计划 | 召回 MemoryCenter 作为 WorldSmith Agent 记忆后端：MemoryAccessor trait 注入点已定义，阶段 3 已完成闭环验证 | [memorycenter-agent-memory-plan.md](../plans/memorycenter-agent-memory-plan.md) |
| 执行中 | 项目空间 × Agent 工作空间统一方案 | Harness 级文件系统收敛（ROADMAP 任务 29）：四条不变量 + 两套空间实现地图 + 7 分叉清单；五问已拍板（A1 项目目录权威根 / B1 惰性迁移 / C1 空间级浏览器 / D1 session.project_id / E1 混居写保护）；M0 ✅ M1 ✅（resolveWorkspaceDir 项目目录优先 + last_workdir 退役，typecheck/build 全绿待真机验证）；下一步 M2 边界收敛 | [workspace-unification-plan.md](../plans/workspace-unification-plan.md) |
| 已完成 | Rust Agent 后端补全执行计划（P0 + P1） | Rust 后端在基础对话+会话持久化+多会话管理层面完整替代 TS 后端。P0 持久化 + P1 功能完整已完成，待端到端实测 | [rust-backend-completion-plan.md](../plans/rust-backend-completion-plan.md) |
| 已完成 | Skills Store 技能源仓库规范 | 定义技能源仓库格式、manifest schema、安装流程与安全模型，现行标准。阶段 1-4 + 方向 2/3 已完成，待桌面端 UI 端到端实测 | [skills-store-spec.md](../plans/skills-store-spec.md) |
| 已完成 | Phase 4 实施计划：周期管理（ArchiveScheduler） | 记忆库自动化运维（周期归档/调度）。ArchiveScheduler 已实现于 `packages/memory-archive/src/scheduler/ArchiveScheduler.ts` | [2026-06-19-phase4-scheduler-plan.md](../plans/2026-06-19-phase4-scheduler-plan.md) |

## 项目详情（details/）

| 状态 | 文档 | 摘要（结论） | 链接 |
|------|------|-------------|------|
| 现行 | WorldSmith 架构总览 | 当前实际代码状态（2026-08-08 复核）：Tauri 唯一 GUI + 共享 packages + Rust crates（CLI 已于 2026-08-08 移除），docs 目录说明，供新接手者定位代码 | [ARCHITECTURE.md](../details/ARCHITECTURE.md) |
| 执行中 | 编排模式层级架构矩阵 | 13 模式现状+目标双栏契约；底座=Agent 执行内核（内聚内核），归属：底座能力 5 + 扩展模式 8；`kernel/ + patterns/` 代码模块化施工图纸与**唯一架构权威**（2026-08-25 裁定合并 + 阶段 A/B + 里程碑 2/5 全部完成：crate 拆为 agent-kernel + agent-patterns + agent-runtime 壳，RouterDecider 消除反向依赖，hooks.rs 提供 RunPhase 位点扩展通道，全量测试通过） | [orchestration-matrix.md](../details/架构/orchestration-matrix.md) |
| 已完成 | 三端分离文档库 | Web/CLI/Tauri 三端彻底分离（物理目录+共享代码层+后端能力重叠处理），共 13 个文件含 6 Phase 迁移路线、风险回滚、验证清单。**最终结局（2026-08-08）**：web/cli 均已删除，收敛为 Tauri 唯一 GUI + 共享 crates，作为历史归档 | [端分离/README.md](../details/端分离/README.md) |
| 已完成 | 记忆归档框架设计 | memory-archive 框架核心设计（归档/检索/调度分层） | [2026-06-17-memory-archive-framework-design.md](../details/memory-archive/2026-06-17-memory-archive-framework-design.md) |
| 现行 | 详细注释索引 | 注释分层后的详细层（why/how）文档，按模块与代码文件一一对应（agent-runtime/agent-commands/tauri/packages），代码内注释附相对路径直达 | [注释/README.md](../details/注释/README.md) |
| 已完成 | 记忆归档待定问题清单 | P1-P18 待定问题全部处理完毕 | [2026-06-17-memory-archive-pending-issues.md](../details/memory-archive/2026-06-17-memory-archive-pending-issues.md) |

## 其他（misc/）

| 状态 | 文档 | 摘要（结论） | 链接 |
|------|------|-------------|------|
| 已完成 | Agent 空间单聊走查问题清单 | 2026-08-28 走查 17+N9 项发现，经第一/中/低三批修复 + 风险点两处后，**全清单截图终验通过**（23 项验证全绿，见清单第九节）：高 6/中 9/低 8 全部闭环。残余留观 R1/T5/O2 残余 | [Agent空间单聊走查问题清单.md](../misc/Agent空间单聊走查问题清单.md) |
| 执行中 | 自迭代决策记录 | 用户放开自迭代权限后"拍板"决策的备查记录（如子 Agent 编排接入主循环的方案选择与理由），按主题分片存于 self-iteration/，持续追加中 | [self-iteration-decisions.md](../执行中/self-iteration-decisions.md) |
| 已完成 | 编排模式补齐交付清单 | Plan-and-Execute / Reflection / Self-Refine 三模式补齐交付史（Rust + 前端计划面板 + 真实 DeepSeek 端到端实测）；含实测中发现的循环检测误报/静默失败/事件桥接三修复 | [orchestration-patterns-delivery.md](../misc/orchestration-patterns-delivery.md) |
| — | 技能源测试数据 | Skills Store 商城联调用的示例技能源（example-creator，含 SKILL.md/skill.yaml/manifest） | [skills-store-test-source/](../misc/skills-store-test-source/) |
