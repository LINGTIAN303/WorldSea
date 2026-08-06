# WorldSmith 文档索引

> 摘要层：先读本索引判断相关性，跳过已完成长文档，按需点开正文。
> 目录结构：`plans/`（计划，带 status 字段可流转）/ `details/`（项目详情）/ `index/`（本索引）/ `misc/`（其他）。
> 文档变更必须同步本索引，避免读到过期摘要。

## 计划类（plans/）

| 状态 | 文档 | 摘要（结论） | 链接 |
|------|------|-------------|------|
| 执行中 | WorldSmith 任务路线计划 | 全项目任务路线总表（按模块分组），每条含编号/状态/优先级，完成任务移至文末"已完成任务"章节 | [ROADMAP.md](../plans/ROADMAP.md) |
| 执行中 | 注释分层整改计划 | 落实注释分层约束（代码内一行简要 + 相对路径，why/how 进 docs/details/注释/）。全库 495 长注释块已抽取 374+ 块，剩余均为排除项（crates/vendor 外部代码、packages/memory-archive 待清理）；已同步 docs/details/注释/README.md 索引 | [2026-08-06-comment-hierarchy-plan.md](../plans/2026-08-06-comment-hierarchy-plan.md) |
| 执行中 | Agent 端到端闭环计划（Phase 5） | 让 Agent 从 Rust 框架就绪到 Tauri 桌面端真正可用。5.1 命令层 + 5.2 Tauri 前端链路 + 5.3 Agent UI 迁移已完成，5.4 端到端实测待启动；目标移除 TS 版 pi-ai 依赖 | [agent-e2e-closure-plan.md](../plans/agent-e2e-closure-plan.md) |
| 执行中 | Agent 编排框架路线图 | Rust 原生实现 13 种 Agent 模式。阶段 1（Agent loop）+ 阶段 2（编排框架）已完成（cargo test 127/127）；阶段 3（自研 pi-ai）可选待定 | [agent-orchestration-roadmap.md](../plans/agent-orchestration-roadmap.md) |
| 执行中 | perf-kit 实施方案 | 系统性解决 22 个性能问题（响应式过度/串行 I/O/缺渲染节流）。`@worldsmith/perf-kit` 包已建，Phase 1-3 全落地 + Phase 4 部分落地（虚拟滚动/脏矩形/DB 下推），其余待排期 | [perf-kit-plan.md](../plans/perf-kit-plan.md) |
| 执行中 | 大文件拆分计划 | 测试分离（agent-runtime 7 + agent-commands 4，`#[path]` 方式）+ 数据型拆分（SKILL_REGISTRY 按类别拆入 skills/data/）+ EntityTypeSchema 三份定义统一（core-api-types 契约权威）；14 包 typecheck 全绿，已提交 80d35e1 | [2026-08-06-large-file-split-plan.md](../plans/2026-08-06-large-file-split-plan.md) |
| 执行中 | MemoryCenter 召回集成计划 | 召回 MemoryCenter 作为 WorldSmith Agent 记忆后端：MemoryAccessor trait 注入点已定义，阶段 3 已完成闭环验证 | [memorycenter-agent-memory-plan.md](../plans/memorycenter-agent-memory-plan.md) |
| 已完成 | Rust Agent 后端补全执行计划（P0 + P1） | Rust 后端在基础对话+会话持久化+多会话管理层面完整替代 TS 后端。P0 持久化 + P1 功能完整已完成，待端到端实测 | [rust-backend-completion-plan.md](../plans/rust-backend-completion-plan.md) |
| 已完成 | Skills Store 技能源仓库规范 | 定义技能源仓库格式、manifest schema、安装流程与安全模型，现行标准。阶段 1-4 + 方向 2/3 已完成，待桌面端 UI 端到端实测 | [skills-store-spec.md](../plans/skills-store-spec.md) |
| 已完成 | Phase 4 实施计划：周期管理（ArchiveScheduler） | 记忆库自动化运维（周期归档/调度）。ArchiveScheduler 已实现于 `packages/memory-archive/src/scheduler/ArchiveScheduler.ts` | [2026-06-19-phase4-scheduler-plan.md](../plans/2026-06-19-phase4-scheduler-plan.md) |

## 项目详情（details/）

| 状态 | 文档 | 摘要（结论） | 链接 |
|------|------|-------------|------|
| 现行 | WorldSmith 架构总览 | 当前实际代码状态（2026-08-06 复核）：三端结构（web/cli/tauri）、共享 packages、Rust crates、docs 目录说明，供新接手者定位代码 | [ARCHITECTURE.md](../details/ARCHITECTURE.md) |
| 已完成 | 三端分离文档库 | Web/CLI/Tauri 三端彻底分离（物理目录+共享代码层+后端能力重叠处理），共 13 个文件含 6 Phase 迁移路线、风险回滚、验证清单 | [端分离/README.md](../details/端分离/README.md) |
| 已完成 | 记忆归档框架设计 | memory-archive 框架核心设计（归档/检索/调度分层） | [2026-06-17-memory-archive-framework-design.md](../details/memory-archive/2026-06-17-memory-archive-framework-design.md) |
| 现行 | 详细注释索引 | 注释分层后的详细层（why/how）文档，按模块与代码文件一一对应（agent-runtime/agent-commands/tauri/web/cli/packages），代码内注释附相对路径直达 | [注释/README.md](../details/注释/README.md) |
| 已完成 | 记忆归档待定问题清单 | P1-P18 待定问题全部处理完毕 | [2026-06-17-memory-archive-pending-issues.md](../details/memory-archive/2026-06-17-memory-archive-pending-issues.md) |

## 其他（misc/）

| 状态 | 文档 | 摘要（结论） | 链接 |
|------|------|-------------|------|
| 执行中 | 自迭代决策记录 | 用户放开自迭代权限后"拍板"决策的备查记录（如子 Agent 编排接入主循环的方案选择与理由），持续追加中 | [self-iteration-decisions.md](../misc/self-iteration-decisions.md) |
| — | 技能源测试数据 | Skills Store 商城联调用的示例技能源（example-creator，含 SKILL.md/skill.yaml/manifest） | [skills-store-test-source/](../misc/skills-store-test-source/) |
