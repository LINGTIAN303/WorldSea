<!-- HIPPOCAMPUS:SECTION:project_memory START -->
# WorldSmith 项目记忆文档

> 本文档由主要执行 Agent 维护，记录项目概况、架构、任务状态与关键决策（发展即取，精简优先）。
> 深度过程记录/批次流水账已压缩：历史均入库 git（可 `git log` 回溯），更细归档在 MemoryCenter。
> 任务路线独立维护于 docs/plans/ROADMAP.md。最后更新：2026-08-19

## 〇、当前主线

- **Tauri 桌面端（唯一 GUI）+ Rust Agent 深化**；本地开发，暂不上线与推送
- Web/CLI 端均已移除（2026-08-08）；**编排 13 种模式 Rust 端全落地**（2026-08-19 补齐 3/4/5，真实 DeepSeek 双链路验证）
- 累计主线：web-to-tauri 全量迁移✅ → Rust Agent 后端深化✅（13 编排闭环）→ OpenWorld 精华融入✅ → 当前 UI/UX 打磨 + Rust 能力收尾

## 一、项目概况

- **定位**：AI 驱动的世界观构建平台（worldbuilding platform）
- **仓库**：https://github.com/LINGTIAN303/WorldSmith.git · MIT · v0.0.0 开发中
- **部署**：单二进制（Tauri 唯一 GUI）；本地开发模式，不上线不推送
- **服务器**：162.211.183.236（宝塔 lgct5oho）——仅供 MemoryCenter 项目使用，worldsmith 不部署

## 二、技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + TS 6 + Vite 8 + Pinia + ui-kit（Tui* + WsIcon，Naive UI 已移除） |
| 桌面 | Tauri 2（Rust 后端） |
| WASM 核心 | Rust（worldsmith-core、tactical-engine） |
| Agent (TS) | ~~pi-ai~~ 已移除；`packages/agent-runtime` 仅保留共享组件/工具/技能，不再承载循环 |
| Agent (Rust) | `crates/agent-runtime`（genai LLM + tokio 编排），Tauri 命令桥接，主后端 |
| 编排模式 | **Rust 13 种全落地**（2026-08-19 补齐 Plan-Execute/Reflection/Self-Refine） |
| 图表/编辑器/DB | ECharts·Sigma·D3·Graphology / TipTap 3 / IndexedDB(Dexie)+SQLite |
| 构建 | pnpm monorepo（packages/ 15 子包 + apps/tauri 唯一 GUI） |

## 三、后端架构（端分离后结构）

1. **worldsmith-core**（Rust→WASM）：约 70 导出 — 存储/校验/图布局/迁移
2. **tactical-engine**（Rust→WASM）：18 导出 — 寻路/战斗 AI
3. **crates/agent-runtime**：AgentLoop/GenaiBackend/ToolBus/13 编排模式（ToT/GoT/Multi-Agent/Supervisor/Router/Plan/Reflection/Self-Refine/LongTask 等），经 Tauri 命令层暴露
4. **apps/tauri/src-tauri**：桌面命令层 — agent_bridge / 文件系统 / long_task / loop_control / secure_store / frontend_tool_bridge 等
5. **worldsmith-skills-store**（Rust）：Skills Store 独立 crate
6. ~~apps/cli~~ 已移除（2026-08-08，chat 由 Rust agent-commands 覆盖）
7. **packages/agent-runtime**（TS）：端无关共享层（工具/技能/会话/Adapter）；主循环已由 Rust 接管

**关键数据流**：存储→FileStorageBackend（Rust fs 命令）；算法/校验→WASM；Agent→Rust 命令。优先使用 Tauri IPC + 事件桥（非轮询）。

## 四、Monorepo 子包（packages/ 共 15）

agent-core / agent-runtime / canvas-engine / core-api-types / entity-core / font-kit / governor-core / memory-archive / motion-kit / perf-kit / plugin-sdk / shared-composables / shared-ui / theme-kit / ui-kit

## 五、当前任务状态

- **ROADMAP**：28 任务方向 / 8 大类（docs/plans/ROADMAP.md）；任务 1✅ 3✅ 4✅（P1-P4+task 方向 A-D）24 进行中，其余待启动
- **Rust Agent 后端**：阶段 1.1-1.5✅ · 2.0 UI 集成✅ · 2.5 会话持久化✅ · Loop Engineering✅ · **编排 13 模式闭环✅（2026-08-19）**；待办见下
- **端分离**：✅ 全部完成（2026-08-04 收敛）；apps/web、apps/cli 已删除，仅存 apps/tauri
- **实际文档**（2026-08-06 四类结构）：docs/index（索引）/ docs/plans（计划）/ docs/details（详情+注释）/ docs/misc（其他）；文档变更须同步索引
- **任务类别**：Agent 增强 / 编辑创作 / 插件实体 / AutoLink 关系 / 图谱可视 / UI 视觉字体 / 商城外部 / 系统功能

## 六、关键决策（结论性清单，过程可 git 回溯）

- **Tauri 唯一 GUI**（2026-08-08）：移除 apps/web，全部迁入 Tauri；CLI 收敛本地自动化，后 Rust CLI 亦移除（chat 由 agent-commands 覆盖）
- **端分离**：apps/{web,cli,tauri} 三端骨架 → 收敛为 Tauri 唯一；共享层抽到 packages/*（端无关逻辑下沉）
- **Agent 主循环 Rust 化**：pi-ai 移除；`crates/agent-runtime` + genai 承接，前/后端 B 开关切换过渡后 Rust 为主
- **编排 13 模式闭环**（2026-08-19）：补齐 Plan/Reflection/Self-Refine 节点 + 计划面板 UI + 事件桥（agent:event:plan_*/reflection）
- **A2UI 走 TS 工具桥**（Rust 端事件通道预留不开发）；**子 Agent 走独立 Rust 会话**（方案 A）；**主聊天循环自实现重试/限流**（不接入 LoopEng 双轨，避免过度工程）
- **FrontendToolBridge**（决策 021）：Rust→前端 TS 双向执行桥（A5 ConfirmationBroker 同构，oneshot+call_id），首批桥接 entity_create/update/content_search
- **安全存储**：API Key 落应用数据目录 SQLite（secure_store，非 localStorage）
- **部署限制**：AGENTS.md 被 git 跟踪 → 凭证不写入；敏感信息在 .opencode/ .catpaw/（gitignore）

## 七、迁移与历史（压缩摘要）

- **全项目体检**（2026-07-13）：5 维评分（架构 C+ / 性能 C / Bug B+ / 代码质量 C- / 覆盖 D+），42 问题聚 14 主题（P0 僵尸后端/lib.rs 巨型/循环依赖等），从 P0 BUG 开始修
- **Rust Agent 端到端**（2026-08-03）：消息渲染 4 层根因修复（readonly 代理/payload snake_case/双广播/原地修改不触发 computed）；前端深度模式/终端/子 Agent 补齐
- **长任务全链路实测**（2026-08-03）：心跳/checkpoint/取消/失败/恢复 5 项 PASS；修复 startTask fire-and-forget 竞态（终态被 running 覆盖）
- **Tauri UI 审计**（批次 87-109 及后续，visual-review-2026-08-07.md）：设计令牌零硬编码色、hover/焦点/aria/键盘可达性统一、时间三套收敛、桌面系统集成（托盘/单实例/全局快捷键/开机自启/标题栏）；第七轮审计闭环
- **OpenWorld 精华融入**（2026-08-16，6 笔提交）：A3 路由 / A4 计划 / A5 确认 / B1 场景 / B3 搜索 / C1 产物 / C2 引用校验

## 八、待办 / 风险

- **failTask 终态闭环重测**（Rust 长任务，待收敛后干净环境重测）
- **Refine 多轮迭代真实低分场景实测**（当前评审 95 一次收敛，迭代分支待专用用例）
- 深度模式 / A2UI 前端展示 / 终端 / 子 Agent 前端补齐（Rust 后端能力已就绪，部分待真实桌面端到端）
- Tauri 窗口端到端实测：托盘菜单/全局快捷键/开机自启/系统通知（Agent 长任务完成联动尚未接入）
- 暂缓组（group-chat / smart-fill / 人格字体）按需评估迁入或删除
- 数据源分叉：entity_list/get（Rust SQLite 兜底库）vs 桥工具（前端 Dexie 项目库）——混用可能读到不同实体视图，后续评估统一
- A2UI 无 thinking 段（Rust 无 thinking 事件流）、plan 进度依赖 PlanCreated 广播（已补）——无数据源不造死代码

## 九、hippocampus 记忆配置

- **session_id 约定**：catpaw-worldsmith-{日期}；project_id：worldsmith
- 历史 session：a3f7b2c1-4d5e-4f6a-8b9c-0d1e2f3a4b5c（2026-07-05 调研）
- 规则文件：.catpaw/rules/hippocampus-archive.md、AGENTS.md、.catpaw/rules/architecture-quickref.md

## 十、历史记忆索引

| hook_id | 摘要 | 日期 |
|---|---|---|
| 305b700e / 847beb6f / 5b30a117 | 后端架构与前端覆盖度调研 | 2026-07-05 |
| 53aa6dc4 | retrieve session_id 一致性测试 | 2026-07-05 |
| 2d07a5ff | archive 保留 tool_calls/thinking 实验 | 2026-07-05 |
| c1081d29 | Hippocampus MCP v2.30.1 更新影响 | 2026-07-05 |
| acbb2474 | WorldSmith Task 模式迭代 B 实现 | 2026-07-07 |

## 十一、关键决策记录

（详见上文第六节决策清单；历史完整决策已随各阶段入库，需要时 git log 回溯）

<!-- HIPPOCAMPUS:SECTION:project_memory END -->

<!-- MemoryCenter:SECTION:task_state START -->
## 当前任务
Tauri 桌面端打磨 + Rust Agent 深化：编排 13 模式已闭环（2026-08-19）；后续为 UI/UX 继续 + 待办收尾。

## 近期完成里程碑
- [x] 编排 3/4/5 节点 + 计划面板 UI + 真实双链路轻量（2026-08-19，2229ef8 / e2bafce / 93eac1f）
- [x] 3/4/5 详细注释文档 + roadmap/project_memory 13 模式状态同步（2026-08-19，93eac1f）
- [x] OpenWorld 精华融入 6 笔提交（2026-08-16）+ FrontendToolBridge 决策 021（2026-08-19）
- [x] Tauri UI 审计批次 87-109 及后续闭环（visual-review-2026-08-07.md 报告）
- [x] 全局规则三份入库（协作/交付/会话韧性）

## 下一步
- 见「当前任务状态·待办」（failTask 终态 / Refine 低分实测 / 深度模式·A2UI·终端·子Agent 前端 / 系统集成窗口实测）
<!-- MemoryCenter:SECTION:task_state END -->