# WorldSmith 文档索引

> 摘要层：先读本索引判断相关性，跳过已完成长文档，按需点开正文。
> 目录结构：`plans/`（计划，带 status 字段可流转）/ `plans/已完成/`（归档区，2026-08-30 实况核对后建立）/ `details/`（项目详情）/ `index/`（本索引）/ `misc/`（其他）。
> 文档变更必须同步本索引，避免读到过期摘要。
> 2026-08-30 全库实况核对：归档 17 份已完成计划 + 1 目录；skills-store-spec 判定部分断线（见其断线声明）；编排域存在两套 M1-M5 双轨并行（收口待拍板）。

## 计划类（plans/）— 执行中

| 状态 | 文档 | 摘要（结论） | 链接 |
|------|------|-------------|------|
| 执行中 | WorldSmith 任务路线计划 | 全项目任务路线总表（按模块分组）。⚠ 任务 24 Skills 商城已改判「部分断线」（2026-08-30 核对：Rust 命令层被删，仅 UI 与格式规范成立） | [ROADMAP.md](../plans/ROADMAP.md) |
| 执行中 | 编排链路工程交接文档 | 编排施工线交接（2026-08-29～30）：orchestrator 统一骨架 M1-M5 全落地（13 模式齐 + 四层记忆 + KernelBackendLlm + 前端行段 v2），agent-patterns 161/161、前端 267/267；待续 R6-2/3/4、旧 kernel 7 模块双轨收口（待拍板）；R15 温度 BUG 已修（2026-08-30） | [2026-08-30-编排链路交接文档.md](../plans/2026-08-30-编排链路交接文档.md) |
| 执行中 | R6 动作段持久化计划 | 六类动作段仅存前端内存、回源即失的立项：持久化载体 → 回源翻译 + 实时消费 → 路由 JSON 口径统一。第一部分（转发）已完成，生效需重启桌面实例 | [2026-08-30-R6动作段持久化计划.md](../plans/2026-08-30-R6动作段持久化计划.md) |
| 执行中 | VibeCoding 编排模式落地执行 | 编排施工线活文档：阶段进度 / 落点决策 / 偏差记录 / 接续点 / 验收记录（设计定稿见 [链路设计](../plans/VibeCoding编排模式链路设计.md)） | [VibeCoding编排模式落地执行.md](../plans/VibeCoding编排模式落地执行.md) |
| 执行中 | Harness 工程差距调研（持续记录） | **阶段收口（2026-08-30）**：H1 三硬伤（阈值待定）/H2 MCP 重建（Rust rmcp 全链路+三通道注入：冷注入快照/热注入活跃会话/[MCP 环境] 感知注记，真机实证 33 工具在总线）/H3 Skills 点火/H5 规则工程（设计点待定）/H7 事件字段全部施工完成，P0 流式区已走查；P3 H6 按产品定位待议。§三 含 P1/P2 五轮真机冒烟记录（含 Vite8 glob 失配、MCP 激活双根因、桥工具 schema 严格模式等实证教训）；遗留项散布各表格行标注 | [2026-08-30-Harness工程差距调研.md](../plans/2026-08-30-Harness工程差距调研.md) |
| 执行中 | 编排模式投放与框架链路：问题清单 | 13 模式前端投放/后端管线事实/模式组合协议研究，83/83 条收敛（64 定案 + 17 倾向）+ 五把钥匙；**施工蓝图已产出 → 04-方案** | [01-问题清单.md](../plans/编排模式投放设计/01-问题清单.md) |
| 执行中 | 编排模式投放：整合方案 v1 蓝图 | 核心契约三张表（OrchestrationRun/HandoverArtifact 九类/pattern_registry）+ 轨迹事件族 + 前端形态规格 + M1-M5。⚠ 双轨注记待补（2026-08-30 核对）：蓝图已施工于 kernel+agent-commands 轨道（M5 真机走查全过，残余 M3-RK1），而 VibeCoding 统一骨架（agent-patterns）**不含投放概念**——投放层 currently 挂旧 kernel，收口待拍板 | [04-方案.md](../plans/编排模式投放设计/04-方案.md) |
| 执行中 | 编排模式投放：现状事实清单（阶段 0 勘察） | 87 条研究题的代码事实地基：事件系统全景（10 前端通道、无 run_id）/ 串行 DAG / 持久化边界 / TracePanel 迹线雏形 / 繁殖成本 8 处 | [02-现状事实.md](../plans/编排模式投放设计/02-现状事实.md) |
| 执行中 | 编排模式投放：外部参照卡（阶段 1 调研） | 7 家竞品过程可视化形态卡 + 12 反模式 + 8 设计原则——"统一迹线 + 按需详图"被三头部产品殊途同归印证；最大空白 = 多智能体过程呈现 | [03-外部参照.md](../plans/编排模式投放设计/03-外部参照.md) |
| 执行中 | 项目空间 × Agent 工作空间统一方案 | Harness 级文件系统收敛：M0-M4 全部落地（项目目录默认根 + kernel 级写边界 E1 + session.project_id 锚点 + WorkspacePanel 空间级 + 数据源收敛 + shell 盲区防护）；**4/6 已真机验证，剩 2 项 UI 走查**（⑤无会话项目目录面板、⑥重启 project_id 持久） | [workspace-unification-plan.md](../plans/workspace-unification-plan.md) |
| 执行中 | perf-kit 实施方案 | Phase 1-3 全落地且被真实消费（8 store + 渲染节流 + createBatchIpc）；Phase 4：脏矩形/DB 下推有效，**虚拟滚动断线**（useVirtualList 无消费方，KanbanView.vue 为 5 行占位——web 删除时成果未随迁） | [perf-kit-plan.md](../plans/perf-kit-plan.md) |
| ⚠ 部分断线 | Skills Store 技能源仓库规范 | **格式规范仍为现行标准**（manifest schema / skill.yaml+SKILL.md 双格式 / 安全模型 / platform-adapters）；但 Rust 命令层已删（cmd_skills_* 六命令零注册 + worldsmith-skills-store crate 成孤儿）→ 安装/卸载/导入/扫描必然失败。头部有断线声明；重建蓝本，挂靠 Harness 调研 P1「Skills 点火」 | [skills-store-spec.md](../plans/skills-store-spec.md) |

## 计划类（plans/已完成/）— 归档区

> 2026-08-30 四路实况核对后归档：每份头部含核对注记（含路径锚点过期标注——2026-08-25 crate 重组致 `crates/agent-runtime/src/...` 系统性过期，实体在 agent-kernel/agent-patterns）。

| 状态 | 文档 | 一句话结论 | 链接 |
|------|------|-----------|------|
| 已完成 | Web 端迁入 Tauri 迁移计划 | 7 Phase 全部完成，apps/web 已删除，Tauri 唯一 GUI | [2026-08-08-web-to-tauri-migration-plan.md](../plans/已完成/2026-08-08-web-to-tauri-migration-plan.md) |
| 已完成 | Agent 端到端闭环计划（Phase 5） | 5.1-5.5 全部完成；pi-ai 全 packages 零残留；小尾巴 shared-ui typecheck 配置 | [agent-e2e-closure-plan.md](../plans/已完成/agent-e2e-closure-plan.md) |
| 已完成 | Agent 编排框架路线图 | 阶段 1+2 完成；阶段 3（pi-ai 移除）实际已完成；唯一未确认尾巴 failTask 终态；历史规划视角，权威已移交 matrix | [agent-orchestration-roadmap.md](../plans/已完成/agent-orchestration-roadmap.md) |
| 已完成 | 编排层架构重构：两方方案裁定与归档 | 01 矩阵表事实已吸收进 matrix；02 Harness 底座方案五项主张全部否决归档；03 裁定纪要（施工链已执行） | [agent编排层架构重构/](../plans/已完成/agent编排层架构重构/) |
| 已完成 | Rust Agent 后端补全执行计划 | 声明路径全灭，能力被 session_store.rs 写穿式替代实现且更彻底；仅作历史记录 | [rust-backend-completion-plan.md](../plans/已完成/rust-backend-completion-plan.md) |
| 已完成 | MemoryCenter 召回集成计划 | 阶段 0-5 全落地（Accessor/注入/5 命令闭环）；前端形态已被 MemoryShelf 替换 | [memorycenter-agent-memory-plan.md](../plans/已完成/memorycenter-agent-memory-plan.md) |
| 已完成 | 注释分层整改计划 | 495 长注释块抽取 374+，注释库 183 md；代码零残留 | [2026-08-06-comment-hierarchy-plan.md](../plans/已完成/2026-08-06-comment-hierarchy-plan.md) |
| 已完成 | 大文件拆分计划 | 测试分离 + skills/data/ 拆分 + EntityTypeSchema 统一三项全在盘（80d35e1） | [2026-08-06-large-file-split-plan.md](../plans/已完成/2026-08-06-large-file-split-plan.md) |
| 已完成 | Phase 4 周期管理（ArchiveScheduler） | 记忆库周期归档调度已实现 | [2026-06-19-phase4-scheduler-plan.md](../plans/已完成/2026-06-19-phase4-scheduler-plan.md) |
| 已完成 | 群聊持久化计划 | UI 元数据=Dexie + Rust 参与者映射=SQLite 双轨属实（SessionKind/group_chat_sessions 级联） | [2026-08-09-group-chat-persistence-plan.md](../plans/已完成/2026-08-09-group-chat-persistence-plan.md) |
| 已完成 | 群聊 Rust 桥接计划 | 三工厂齐全 + 三处消费点接入；createWorldSmithAgent stub 零引用 | [2026-08-09-group-chat-rust-bridge-plan.md](../plans/已完成/2026-08-09-group-chat-rust-bridge-plan.md) |
| 已完成 | Agent 设置集成计划（一版） | A-E+CONTRACT 交付；一版弹窗形态已被迭代二主从分栏取代；终端入口后续又恢复 | [2026-08-23-agent-settings-integration-plan.md](../plans/已完成/2026-08-23-agent-settings-integration-plan.md) |
| 已完成 | Agent 设置迭代二（模型面板重构） | model/ 主从分栏六组件 + 图标 vendor + 模型分类 + savedModels 全在盘 | [2026-08-23-agent-settings-iteration2-plan.md](../plans/已完成/2026-08-23-agent-settings-iteration2-plan.md) |
| 已完成 | 模型选择器右栏改造 | 42vh 弹层 + 右栏宫格多面板 + 思考档位三处修正全落地 | [2026-08-29-model-selector-rightbar-plan.md](../plans/已完成/2026-08-29-model-selector-rightbar-plan.md) |
| 已完成 | 行段渲染层重构（流式区 v2） | T1-T13 交付全在盘，浏览器冒烟通过；遗留 R15/R4 未修、R2/R13 未复测、R5/R6/R11 后续增量（R6 已独立立项） | [2026-08-29-stream-render-layer-plan.md](../plans/已完成/2026-08-29-stream-render-layer-plan.md) |
| 已完成 | Agent 空间重设计 | 三区布局/ExecPanel 在盘；T1/T4 形态已被 08-12 单面板合并与 08-29 宫格改造取代（SpaceNavbar.vue 已删） | [agent-space-redesign-plan.md](../plans/已完成/agent-space-redesign-plan.md) |
| 已完成（冻结） | OpenWorld 可取点融入规划 | 主体 15 项实证落地（落点已迁 agent-kernel/agent-commands）；剩余待评估项随 OpenWorld 转本地动机弱化，冻结不再推进；OpenWorld 目录实际未删 | [openworld-integration-plan.md](../plans/已完成/openworld-integration-plan.md) |

## 项目详情（details/）

| 状态 | 文档 | 摘要（结论） | 链接 |
|------|------|-------------|------|
| 现行 | WorldSmith 架构总览 | 当前实际代码状态（2026-08-08 复核）：Tauri 唯一 GUI + 共享 packages + Rust crates（CLI 已于 2026-08-08 移除），docs 目录说明，供新接手者定位代码 | [ARCHITECTURE.md](../details/ARCHITECTURE.md) |
| 执行中 | 编排模式层级架构矩阵 | 13 模式现状+目标双栏契约；`kernel/ + patterns/` 代码模块化施工图纸与**唯一架构权威**（2026-08-25 裁定合并 + 阶段 A/B + 里程碑 2/5 全部完成：crate 拆为 agent-kernel + agent-patterns + agent-runtime 壳，RouterDecider 消除反向依赖，hooks.rs 提供 RunPhase 位点扩展通道，全量测试通过） | [orchestration-matrix.md](../details/架构/orchestration-matrix.md) |
| 已完成 | 三端分离文档库 | Web/CLI/Tauri 三端彻底分离，13 文件；最终结局：web/cli 均已删除，收敛为 Tauri 唯一 GUI + 共享 crates（历史归档） | [端分离/README.md](../details/端分离/README.md) |
| 已完成 | 记忆归档框架设计 | memory-archive 框架核心设计（归档/检索/调度分层） | [2026-06-17-memory-archive-framework-design.md](../details/memory-archive/2026-06-17-memory-archive-framework-design.md) |
| 现行 | 详细注释索引 | 注释分层后的详细层（why/how）文档，按模块与代码文件一一对应；代码变更影响注释含义时同步更新 | [注释/README.md](../details/注释/README.md) |
| 已完成 | 记忆归档待定问题清单 | P1-P18 待定问题全部处理完毕 | [2026-06-17-memory-archive-pending-issues.md](../details/memory-archive/2026-06-17-memory-archive-pending-issues.md) |

## 其他（misc/）

| 状态 | 文档 | 摘要（结论） | 链接 |
|------|------|-------------|------|
| 已完成 | Agent 空间单聊走查问题清单 | 2026-08-28 走查 17+N9 项，三批修复后全清单截图终验通过（23 项验证全绿）；残余留观 R1/T5/O2 | [Agent空间单聊走查问题清单.md](../misc/Agent空间单聊走查问题清单.md) |
| 执行中 | 自迭代决策记录 | 自迭代"拍板"决策备查记录（23 个迭代主题），持续追加 | [self-iteration-decisions.md](../执行中/self-iteration-decisions.md) |
| 已完成 | 编排模式补齐交付清单 | Plan-and-Execute / Reflection / Self-Refine 补齐交付史（Rust + 前端计划面板 + DeepSeek 端到端实测）；含循环检测误报/静默失败/事件桥接三修复 | [orchestration-patterns-delivery.md](../misc/orchestration-patterns-delivery.md) |
| — | 技能源测试数据 | Skills Store 商城联调用的示例技能源（example-creator）；⚠ 当前无消费方（cmd_skills_* 断线），待 Skills 点火后复用 | [skills-store-test-source/](../misc/skills-store-test-source/) |
