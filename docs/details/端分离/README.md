# WorldSmith 三端分离文档库

> 本文档库用于持续保障 WorldSmith 项目的 Web 端、CLI 端、Tauri 端彻底分离工作。
> 创建日期：2026-07-29
> 维护策略：每个迁移阶段完成后同步更新对应文档，并在 `08-migration-phases.md` 中标记进度。

## 文档导航

| 序号 | 文档 | 内容概述 | 适用阶段 |
|------|------|----------|----------|
| 00 | 【`[总览与目标](./00-overview.md)`】 | 项目背景、分离目标、决策摘要、整体路线 | 全程 |
| 01 | 【`[三端现状分析](./01-current-state.md)`】 | 当前架构、耦合点、依赖关系、技术债 | 调研 |
| 02 | 【`[目标架构](./02-target-architecture.md)`】 | 分离后的目标目录结构、责任边界、数据流 | 设计 |
| 03 | 【`[共享代码层规划](./03-shared-code-layer.md)`】 | `packages/agent-runtime` 抽离方案、API 契约 | 设计 |
| 04 | 【`[Web 端分离计划](./04-separation-plan-web.md)`】 | `apps/web` 目录、构建配置、入口清理 | Phase 2 |
| 05 | 【`[CLI 端分离计划](./05-separation-plan-cli.md)`】 | `apps/cli` 目录、serve 模式、工具注册 | Phase 2 |
| 06 | 【`[Tauri 端分离计划](./06-separation-plan-tauri.md)`】 | `apps/tauri` 目录、Rust 后端、前端入口 | Phase 2 |
| 07 | 【`[前端关联入口移除计划](./07-frontend-entry-cleanup.md)`】 | 共用 `src/` 拆分、后端切换逻辑清理 | Phase 3 |
| 08 | 【`[分阶段迁移路线](./08-migration-phases.md)`】 | 6 个 Phase 的执行顺序、里程碑、回滚点 | 执行 |
| 09 | 【`[风险与回滚策略](./09-risk-mitigation.md)`】 | 关键风险点、回滚预案、保障机制 | 执行 |
| 10 | 【`[验证清单](./10-verification-checklist.md)`】 | 每阶段的验收标准、测试要求、回归项 | 验收 |

## 关键决策摘要

1. **分离策略**：物理目录彻底分离 — 创建 `apps/web`、`apps/cli`、`apps/tauri` 三个独立子项目
2. **共享代码层**：将 `worldsmith-agent/src/` 中的端无关逻辑（tools/skills/agent.ts/session/orchestrator）抽离到 `packages/agent-runtime`
3. **后端能力重叠处理**：CLI `serve` 模式替代 `worldsmith-server`（Node.js HTTP/WS 服务）；Tauri 端保留原 Rust 命令；Web 端通过 HTTP/WS 连接 CLI serve
4. **前端入口清理范围**：
   - 移除 `useAgent.ts` 的 TS/Rust 后端路由层（每端单一后端）
   - 移除 `coreBackend.ts` 的 Tauri/WASM 运行时检测分支（端编译期决定）
   - 移除 Web 端中仅 Tauri 使用的 Rust composables（useAgentRust/useGoTRust/useToTRust 等）
   - 移除 Tauri/CLI 端中 worldsmith-server 相关 API 引用

## 当前进度

| Phase | 名称 | 状态 | 完成日期 |
|-------|------|------|----------|
| 0 | 调研与文档库搭建 | ✅ 已完成 | 2026-07-29 |
| 1 | 共享代码层抽离 | ✅ 已完成 | 2026-07-29 |
| 2 | 三端目录骨架建立 | ✅ 已完成 | 2026-07-29 |
| 3 | 前端入口分离与清理 | ✅ 已完成 | 2026-08-04 |
| 4 | 后端能力整合（CLI serve 替代 server） | ✅ 已完成 | 2026-07-29 |
| 5 | 构建配置与 CI 独立 | ✅ 已完成 | 2026-07-29 |
| 6 | 端到端验收与清理 | ✅ 已完成 | 2026-08-04 |

> **当前状态（2026-08-04）**：端分离已完成。根级 `src/`、`src-tauri/`、`worldsmith-server/`、`worldsmith-agent/` 已全部迁移到 `apps/web`、`apps/tauri`、`apps/cli` 与 `packages/agent-runtime`，主应用入口为 `apps/web`。
> **2026-07-31 决策**：暂停业务 UI 大迁移（数十万行级工程），回到主应用开发（根 src/），端分离按 ROADMAP 单独排期。
> **2026-08-04 更新**：端分离迁移已全部落地，PHASE 3–6 完成，根级旧结构已删除，本文档作为历史迁移记录归档。
> 2026-08-02 工作区收敛：`@agent` 统一到 `packages/agent-runtime` 单轨（commit c3856de），`worldsmith-agent` 冻结为端适配器宿主。

> 进度更新规则：每个 Phase 完成后在 `08-migration-phases.md` 对应章节填写完成日期与产物，并在此表格同步。
