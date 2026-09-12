# WorldSea 工作线总览（跨计划聚合视图）

> status: 执行中
> 创建日期：2026-09-11
> 定位：**线级**视图，不是任务级视图。`ROADMAP.md` 管 28 条产品任务的编号与状态；本文件管「有哪些条工作线在推进、各自的卡口在哪、彼此如何交汇」。计划文档、详情文档为唯一事实源，本文件只做聚合，不产生新结论。
> 维护规则：工作线状态变更（开工 / 收口 / 新增 / 废弃）时更新本文件；单条计划的施工细节记在其 plan 文档内，本文件不回写。
> 信息截止：2026-09-11。聚合来源为 `docs/plans/`、`docs/misc/` 与 `docs/index/README.md` 的实况核对。

---

## 〇、判读结论

项目当前有 **4 条主干 + 11 条施工线 + 28 条产品任务 + 4 条储备线**。但真正的结构性问题只有一个：

**`A1 记忆系统设计` 是唯一卡口。** 它有六条上游支流（语义检索 / 窗口阈值 / MEMORY.md 注入 / reflective 归属 / project_id 记忆隔离 / 记忆库迭代），而自身此前是「方向文档·待启动」——**2026-09-11 已设计定稿并开工（见下方进展块），卡口解除**。这六条线的裁定条件原本都依赖 A1 的结论，故不宜并行推进。

> **2026-09-11 进展**：卡口已启动——前置决策清单 [2026-09-11-A1-记忆系统设计-裁定清单.md](../plans/2026-09-11-A1-记忆系统设计-裁定清单.md) 已出（16 条待逐条拍板 + 己组 2 条新增影响面）。已锁定两条方向：**双层架构**（库为 substrate / MEMORY.md 为 interface）、**前端 KV 记忆废弃收编**。另取得关键实测：长期记忆在生产上**从未被真正使用**（`memories.db` 仅 2 行、`project_id` 全 null），**schema 重塑窗口敞开**。**己组取证**（session 日志系统 / 压缩保留类型）另坐实三件事：轨迹**不能完整回放**（tool_result 入库前截断 + 被裁历史物理删除 + 归档不含工具交互）、`messages` 表是**可变快照**而非事件日志、压缩**零类型感知**（工具配对可被切开 → 真实 400 风险）。**并回写修正了 dsh 硬伤①**（裁剪实为写穿全量替换，被裁消息物理删除而非"刷新后复活"）。

> **2026-09-11 进展（设计定稿）**：裁定清单 16 条 + 己组 2 条**全部裁定并出正式设计文档** [2026-09-11-A1-记忆系统设计.md](../plans/2026-09-11-A1-记忆系统设计.md)。六条主轴定稿：双层架构 / 三套收敛 / 四操作写入 / 计量归一（tiktoken 编译期内嵌）/ 五分档压缩（四层相对归档阈值 + 归档兜顶，归档比率 = 窗口 × 2/5）/ 轨迹不可变 + 原文外置（前后锚点对）。**卡口解除**——A2 语义检索并入 A1 施工批、A3 窗口阈值由丙1 计量归一承接、MEMORY.md 注入形态已定（常驻注入）。**三项落地级决策与 7 条风险点已全部按建议采纳**（含 **R3 追加「前端 session 日志（历史）面板」立项**，见设计文档 §10.3）。**顺序硬约束**：丙2 阶段 B 与 己1① 必须早于锚点回填机制。**已开工**：甲4 扩展库 `memory_ext.db` → **甲1 写入四操作**（trait 扩 5 方法全给默认实现）→ **甲2 矛盾调和**（取代式更新：旧条目保留 + 取代链 + 调和摘要，三档成本策略默认零 LLM）→ **乙3① `MEMORY.md` 常驻注入**（`crates/agent-memory/src/memory_md.rs` 派生渲染 → `~/.WorldSea/rules/MEMORY.md` → 全局组最后一项；写白名单剔除该文件，无自由文本写入口）→ **丙1 量纲归一**（字节 → 上下文 token）→ **丙2 阶段 B 不可变会话日志**（`session_log` 只增不改 + `session_live` 游标 + `session_events` 审计；**裁剪不再丢内容、坐标稳定**）→ **己1① 原文保真**（超长内容截断前先外置成文件 + 内容坐标 + `memory_read_raw` 只读取回）→ **己2① 类型化保留契约**（五级优先级 + A3 四类硬保留 + 工具交换组原子丢弃 + 选择性删除）均已落地。**§6.2 锚点回填机制已施工（2026-09-12）**——顺序硬约束的两条前置（丙2 阶段 B / 己1①）兑现后，机制本身亦已落地：**裁剪从「直接删除」升级为「折叠」**（两段式「占位 → 填回」+ 锚点标记 + 引用登记），「压缩后能还原原文」整条链路闭环。**甲3 淘汰策略亦已施工（2026-09-12）**——三级链（衰减评分 → 软淘汰 → 硬删）+ 外置文件回收站 GC + 巡检调度（6 小时后台任务，**R2 闭合**），`memories.db` 与磁盘外置文件两侧同覆盖，**「会遗忘」一栏补齐、遗忘链闭环**。**「Agent 记忆工具」批亦已施工（2026-09-12）**——五件工具（`memory_recall` / `memory_store` / `memory_update` / `memory_delete` / `memory_pin`）落地，**机制终于有了入口**：模型可显式读写纠治理，`memory_pin` 直接接通 **MEMORY.md 的置顶来源**（乙3 缺口关闭）；coding 按用户裁定收掉 `memory_recall`（Light 档自洽）；**第三条链（写入 → 治理 → 消费）闭环**。

第二优先级是 **`W3 Agent 能力面整顿`**：其高严重度项（元工具 schema 前后端双份拷贝、权限判定散落三处）属于**随施工持续劣化的债务**，晚一天修，返工面大一分。

---

## 一、主干：Agent 能力面（3 条）

### W1 · Context 补课线

- **状态**：待启动（方向文档已立，施工入口未定）
- **依据**：[2026-08-31-Agent底层能力与三阶段成熟度.md](../plans/2026-08-31-Agent底层能力与三阶段成熟度.md)
- **判定**：三大阶段中 Prompt 成熟 / Harness 基本成熟 / **Context 半成熟**——基建齐备，核心信息能力未施工
- **三件套**：
  1. **A1 记忆系统设计**（展开）— 中枢，见下。**设计已定稿 + 施工中**：[2026-09-11-A1-记忆系统设计.md](../plans/2026-09-11-A1-记忆系统设计.md)（前置裁定清单：[裁定清单](../plans/2026-09-11-A1-记忆系统设计-裁定清单.md)，16 条 + 己组 2 条全部裁定，已并入）。**已落地**：甲4 扩展库 `memory_ext.db` · 甲1 写入四操作 · **甲2 矛盾调和** · **乙3① `MEMORY.md` 常驻注入（H5 收口）** · 丙1 量纲归一 · **丙2 阶段 B 不可变会话日志** · **己1① 原文保真** · 己2① 类型化保留契约 · 己2② 配对保护（后由己2① 取代） · **§6.2 锚点回填机制（2026-09-12：折叠替代删除 + 引用登记/释放）** · **甲3 淘汰策略（2026-09-12：三级链 + 外置 GC + 巡检调度——遗忘链闭环）** · **Agent 记忆工具（2026-09-12：五件工具落地，`memory_pin` 接通 MEMORY.md 置顶来源；coding 收掉 `memory_recall`）**
  2. **A2 语义检索施工** — 千万字级方案已评定，待 A1 裁定后开工
  3. **A3 窗口阈值校准** — 阈值语义已澄清（= LLM 上下文窗口占用），但取值仍是占位
- **卡点**：A1 未定，A2/A3 无法独立开工

### W2 · Harness 业务产物验证闭环线

- **状态**：主体完成，三个待证点未闭环
- **依据**：[2026-08-31-Agent底层能力与三阶段成熟度.md](../plans/2026-08-31-Agent底层能力与三阶段成熟度.md) §二 B 方向
- **四项内容**：B1 每步产物独立验收 / B2 完成判定与验收解耦 / B3 验收可观测 / B4 稳定性实证
- **三个待证点**：
  1. 业务产物验证闭环（现状：纯结构判定「无工具调用即收口」，无校验、无驳回）
  2. 真机稳定性系统化实证
  3. MCP 真实系统层打通（配置化已完成，**2026-09-01 GUI 真机闭环部分达成**）
- **可抄来源**：[trae-agent-调研与借鉴方案.md](../misc/trae-agent-调研与借鉴方案.md) 的三项（完成判定三重钩子 / 工具输出协议 / Lakeview 工程手法），含 4 条风险点待拍板
- **卡点**：需拍板是否采纳外部借鉴方案

### W3 · Agent 能力面整顿线

- **状态**：报告已出，**未施工**（仅文档，不动代码）
- **依据**：[2026-09-10-Agent能力面整顿审查.md](../plans/2026-09-10-Agent能力面整顿审查.md) + [结论核实清单](../plans/2026-09-10-Agent能力面整顿审查-结论核实.md)
- **范围**：Skills / MCP / 内置工具（含世界观「芽」体系）/ **真·Agent 插件系统**
- **定性**：三套各自为政的小系统 + 一个空缺；代码层靠命名约定维系，无统一 capability provider 抽象
- **核心债务三类**：双份维护会漂移 / 死代码与残留 / 同一概念多处命名（「插件」四义并存）
- **高严重度**：
  - A1 元工具 schema 前后端双份手工拷贝（Rust ↔ TS），漂移即 BUG
  - C1 权限判定散落三处
  - E2「插件」四义 + 第五义（真 Agent 插件）在途
- **整顿三档**：纯清理 → 单一事实源 → 拍板项（P1-P6，P1 基本可裁）
- **挂起**：双执行栈收敛（用户 2026-09-10 拍板暂不处理）
- **改名派生遗留（挂账，不单独施工）**：F1 英文标识符 `pluginId` 200 处 / `relatedPlugins` 34 处 · F2 持久化键 `worldsea_plugin_toggles` · F3 芽 manifest 与 `PluginManifest` 范式共用
- **真·Agent 插件系统**：**完全未开始**，P7-P10 决策点待立项

---

## 二、施工线（11 条）

| 线 | 状态 | 剩余动作 | 依据 |
|---|---|---|---|
| 编排双轨收口 | 6 模块大头完成（09-09） | A 轨 tot/got 顶层旧模块休眠待删；`max_dispatches` 默认值待定；群聊会议承载面后置 | [2026-09-09-编排双轨收口审查与6模块迁移.md](../plans/2026-09-09-编排双轨收口审查与6模块迁移.md) |
| 场景底座 | 两轮修复完成（09-10），已收口 | memory_policy / reflective 转 A1 裁定 | [场景底座.md](../details/架构/场景底座.md) |
| workspace 统一 | 收尾中 | 走查⑤⑥已真机通过；**`project_id` 消费缺位**（按项目过滤 / 记忆隔离）→ 并入 A1 | [workspace-unification-plan.md](../plans/workspace-unification-plan.md) |
| 权限分级与沙箱 | P0+P1 完成（09-04） | 待真机走查；Unix pgroup 未做；P2 Agent 自主判断为远期 | [2026-09-03-权限分级与沙箱耦合设计.md](../plans/2026-09-03-权限分级与沙箱耦合设计.md) |
| Skills 商城（任务 24） | 命令层已重建（08-30） | 待桌面实例真机验证安装 / 卸载 / 导入全链路 | [skills-store-spec.md](../plans/skills-store-spec.md) · [ROADMAP.md](../plans/ROADMAP.md) |
| 规则体系 + MCP 配置化 | H5 七项已施工 | **剩 MEMORY.md 注入** → 等 A1；H6-③ MCP 配置化已完成 | [2026-08-30-规则文件体系与MCP配置化设计.md](../plans/2026-08-30-规则文件体系与MCP配置化设计.md) |
| 智能提示与语言服务 | D / A / B1 全部闭环（09-09） | B2 降级为远期可选 | [2026-09-07-智能提示与语言服务立项.md](../plans/2026-09-07-智能提示与语言服务立项.md) |
| 系统触达面（PTY / 工作区 / 沙箱） | 方向 1、2 完成 | **方向 3 沙箱待立项**；PTY 三项低优收尾（Win10 side-load / vim·htop 渲染 / Job object 回收） | [2026-09-01-系统触达面补齐调研.md](../plans/2026-09-01-系统触达面补齐调研.md) |
| perf-kit | Phase 1-3 已被真实消费 | **虚拟滚动断线**（`useVirtualList` 无消费方，`KanbanView.vue` 为占位） | [perf-kit-plan.md](../plans/perf-kit-plan.md) |
| R6 动作段持久化 | 四部分完成 + 真机验证 | T12 部分通过（`seq` 递增待更多动作段会话补证） | [2026-08-30-R6动作段持久化计划.md](../plans/2026-08-30-R6动作段持久化计划.md) · [待测试清单.md](../misc/待测试清单.md) |
| 渲染与界面基建 | 已完成 | 编辑器内核二期五批（09-06/07）、三模式移除（09-01 T15 通过）、快捷键系统（09-06）、视口容器 S4/S5（09-05） | [ROADMAP.md](../plans/ROADMAP.md) 已完成章节 |

> 附：**编排模式投放设计**（[01-问题清单](../plans/编排模式投放设计/01-问题清单.md) 83/83 收敛 → [04-方案](../plans/编排模式投放设计/04-方案.md) v1 蓝图 → 双轨收拢试点 S1-S4 全落地）是本区块的方法论底座，风险与走查分别记入 [05-风险台账](../plans/编排模式投放设计/05-风险台账.md) 与 [06-M5走查清单](../plans/编排模式投放设计/06-M5走查清单.md)。

---

## 三、产品线（ROADMAP 28 条）

- **已完成** 3 条：任务 1（Agent 实体卡片小窗）· 任务 3（技能工具更新）· 任务 4（长任务能力）
- **进行中** 2 条：任务 24（Skills 商城，待真机）· 任务 29（项目空间 × Agent 工作空间统一，收尾中）
- **待启动** 23 条，8 大类：Agent 增强 / 编辑创作 / 插件实体 / AutoLink 关系 / 图谱可视 / UI 视觉字体 / 商城外部 / 系统功能
- **重要观察**：23 条待启动任务中绝大多数备注为**「需明确迭代方向」**——它们是方向待定的坑位，不是待施工的工单。真正可立即施工的条目有限
- **依赖链**：任务 3 → 24（已满足）· 任务 8 → 6 · 任务 18 → 27 · 任务 11 → 12
- **依据**：[ROADMAP.md](../plans/ROADMAP.md)

---

## 四、储备线（调研完成，待拍板或待施工）

| 线 | 状态 | 关键结论 | 依据 |
|---|---|---|---|
| trae-agent 借鉴 | 调研完成 | 三项可抄（完成判定三重钩子 / 工具输出协议 / Lakeview 工程手法）；4 条风险点待拍板 | [trae-agent-调研与借鉴方案.md](../misc/trae-agent-调研与借鉴方案.md) |
| deepseek-harness Compaction | 方案完成，待施工 | 核心：压缩 = 在不可变事件日志上追加 replace 记录，而非删历史。查出 4 项硬伤：裁剪只动内存不持久化 / 无 tool_call 配对保护 / 全库零 token 计量 / 阈值是占位 | [deepseek-harness-调研与借鉴方案.md](../misc/deepseek-harness-调研与借鉴方案.md) |
| 千万字级检索 | 已评定，**暂缓** | 推荐主路线 = 混合检索（FTS5 + sqlite-vec + RRF）与 agentic search 共存；GPT 系 GraphRAG 不建。§七四项拍板挂起，等 A1 统一裁定 | [2026-08-30-千万字级检索方案评定.md](../plans/2026-08-30-千万字级检索方案评定.md) |
| VibeCoding 编排模式 | 活文档 | 编排施工线的阶段进度 / 落点决策 / 接续点记录 | [VibeCoding编排模式落地执行.md](../plans/VibeCoding编排模式落地执行.md) |

---

## 五、交汇关系

```
A1 记忆系统设计（卡口）
  ← 编排双轨收口      reflective / memory_policy 归属
  ← workspace 统一    project_id 消费缺位（按项目过滤 / 记忆隔离）
  ← 规则体系 H5       MEMORY.md 注入形态
  ← W1 A2 语义检索    施工方案与 A1 同源裁定
  ← W1 A3 窗口阈值    阈值取值与 token 计量
  ← ROADMAP 任务 28   记忆库迭代方向
  ─→ 千万字级检索     §七四项拍板解锁
  ─→ Compaction 施工  裁剪语义与恢复策略
  ─→ MEMORY.md 注入   H5 体系最后一环
```

---

## 六、文档治理（2026-09-11 全部处置完毕）

### 索引补录 12 份

`docs/index/README.md` 已补录 12 份未收录文档（plans 执行中 2 / 归档区 3 / details 5 / misc 2），其中最重要的是 **`docs/misc/待测试清单.md`（跨线验收总账）**——它此前未被索引收录，等于全局验收状态在索引层不可见。同时更新了「自迭代决策记录」的过时摘要（23 主题 → 29 分片 / 决策点 1-86）。

### 目录归位 3 项（已完成）

| # | 项 | 处置 |
|---|---|---|
| 1 | `plans/任务/` → `plans/已完成/` | 3 份任务级文档 `git mv` 归位（目录深度相同，内部 `../../../` 链接不受影响） |
| 2 | `执行中/` → `misc/` | `self-iteration-decisions.md` + `self-iteration/` 29 分片整体迁移，内部 `self-iteration/NN-*.md` 链接不变 |
| 3 | `docs/test.md` 删除 | 内容仅 `Hello`，无任何引用，已删 |

**连带修复**：`plans/2026-09-07-智能提示与语言服务立项.md` 两处指向已合并删除清单的断链；`plans/已完成/agent-orchestration-roadmap.md` 的 `docs/执行中/...` 引用更新。

### 状态勘误 3 处（已处置）

| # | 文档 | 处置 |
|---|---|---|
| 1 | `plans/已完成/2026-09-05-视口容器结构简化-S4S5.md` | 源文档 status 已由「待启动（设计稿）」改为「已完成」（代码取证：`ws-turn-root` @ `AgentStreamList.vue:23`、`writeScroll` @ `useMessageWindowing.ts:115`） |
| 2 | `plans/perf-kit-plan.md` | 源文档已追加「2026-09-11 迁移后实况校正」注记（Phase 4.6 虚拟滚动未随迁 + `createIdleRaf` / `createUpdateBatcher` 同为零消费方） |
| 3 | `plans/ROADMAP.md` 任务 29 | 判定保持「进行中」——ROADMAP 状态枚举无「收尾中」粒度 |

### 全库链接治理（已完成）

199 条待修条目全部处置：**改指 150 处**（补前缀 75 / 唯一命中重定位 41 / crate 重组映射 23 / 旧绝对路径转相对 11）、**降级 58 处**（目标确已删除，转为不可点击的纯路径）。结果：**断链 223 → 0，绝对路径引用 10 → 0**（301 文件 / 684 条相对链接）。工具见 `scripts/check-doc-links.mjs`，处置明细见索引「全库链接校验」节。

---

## 变更记录

- **2026-09-11 创建**：核对 `docs/plans/`、`docs/misc/`、`docs/index/README.md` 实况后聚合出 4 主干 + 11 施工线 + 28 产品任务 + 4 储备线；识别 A1 为唯一卡口；登记文档治理待决项- **2026-09-11 索引补录**：`docs/index/README.md` 补录 12 份未收录文档 + 新增两节
- **2026-09-11 治理收口**：目录归位 3 项 + 状态勘误 3 处 + 连带断链修复全部完成；新增 `scripts/check-doc-links.mjs` 校验工具
- **2026-09-11 链接治理**：全库 199 条断链/绝对路径条目全部处置（改指 150 / 降级 58），**断链与绝对路径引用双双归零**
- **2026-09-11 A1 启动**：唯一卡口启动——产出 [A1 记忆系统设计 · 裁定清单](../plans/2026-09-11-A1-记忆系统设计-裁定清单.md)（16 条待拍板 + 己组 2 条新增影响面）；锁定双层架构与前端 KV 废弃两条方向；实测确认长期记忆生产上从未真正使用（`memories.db` 仅 2 行）
- **2026-09-11 A1 追加（己组）**：新增 session 日志系统 / 上下文压缩保留类型两项影响评估（代码取证）；修正丙1 量纲为上下文 token；回写 dsh 硬伤①结论（裁剪写穿全量替换、被裁消息物理删除）
- **2026-09-11 A1 设计定稿**：产出 [A1 记忆系统设计](../plans/2026-09-11-A1-记忆系统设计.md)——裁定清单 16 条 + 己组 2 条全部并入；细化三项落地级待定（外置文件粒度 / GC 生命周期 / 落点与安全边界）；登记 4 处文档修正项、7 条风险点、参数总表与 file:line 取证索引。**A1 由「待启动（方向文档）」推进为「设计定稿·待施工」**，W1 三件套中 A2/A3 的裁定条件已解除（A2 并入 A1 施工批、A3 由丙1 计量归一承接）
- **2026-09-11 A1 决策收敛**：三项落地级决策与 R1–R7 风险点**全部按建议采纳**；**R3 追加「前端 session 日志（历史）面板」→ §10.3 后续单独立项**（A1 侧只交付不可变 session 日志 + 稳定锚点坐标）；另登记 reflective 实现同批立项
- **2026-09-11 A1 开工（第 0 批）**：甲4 扩展库 `memory_ext.db` 落地（`crates/agent-memory/src/ext.rs`：5 表 + 四字段读写 / 真标签 / 调和链 / `raw_ref` 引用 + GC 判据谓词；`Cargo.toml` 加 `rusqlite 0.32` bundled）。新增 8 测试，**crate 内 15 passed / 0 failed / 0 warning**。施工期定下两处实现细化（`ref_count` 改派生、连接池降为单连接）与一处关键分解（**GC 扫描对象 = 外置目录实际文件，判定用谓词 `is_gc_eligible` 而非枚举；硬删顺序为先删文件再清引用行**）。**A1 状态：执行中**
- **2026-09-11 A1 第 1/2 批（甲1 + 丙1）**：甲1 写入四操作（`MemoryAccessor` 扩 5 方法全给默认实现；`Add` 写前去重 + 立即归档 / `Delete` 单条删 / `Update` 后置不静默覆盖）；**丙1 量纲归一**——删除 `HISTORY_BUDGET_BYTES`（字节），新增 `context_budget.rs` 与 `model_profile.rs`，vendor `memory-center-models`（含编译期内嵌词表的 tiktoken），装配层按模型注入预算策略与真实分词器；归档阈值由写死 `2000` 改为「窗口 × 比率」；**补上系统提示词漏算**；结构开销 `+32 字节` → `+8 token`。**测试**：agent-kernel 175 / agent-memory 29 / models 116 / agent-commands 133
- **2026-09-11 A1 第 2 批续（己2①）**：类型化保留契约落地——新增 `crates/agent-kernel/src/retention.rs`（五级优先级 `SystemAnchor > LatestUserInput > Pinned > RecentTurn > Droppable`、A3 四类硬保留 `Intent/Decision/Todo/MemoryRef`、工具交换组、保留计划、独立悬空校验器）；新增 `AgentLoop::trim_context_dropping(&[bool])` 把删除从**前缀裁剪**升级为**选择性删除**。**三处缺口闭合**：① System 锚点恒在首位 ② 配对破坏变「按构造不可能」（取代己2② 补丁）③ 最新 user 输入硬保护。**施工期测试抓出两处真实缺陷**：分组首版按下标相邻（交错声明形态会拆散配对）→ 改按 id 匹配 + 最近前置；属性测试不变量过强（输入自带孤儿结果会误报）→ 改为「裁剪后悬空 ⊆ 裁剪前悬空」。**测试**：agent-kernel **188 passed**（+13）
- **2026-09-11 A1 第 1 批收尾（甲2）**：矛盾调和落地——新增 `crates/agent-memory/src/reconcile.rs`（三档摘要策略 + 可插拔 `ReconcileSummarizer` + 规则摘要器）；`MemoryWriteOp::Update` 从「后置返回 Noop」变为**取代式更新**（八步：定位 → 检测 → 修订记入旧文件 → 新条目入库 → 记链 → 产摘要 → 摘要入独立记忆 → 返回 `Superseded`）；`supersede_chain` 增 `summary` 列并带 **v1→v2 迁移**。**硬规则「矛盾不覆盖」全程成立**（旧条目始终保留），**R1（LLM 成本）闭合**（默认档零成本、LLM 档缺失/失败自动降级）。**三处实测边界**：① `SelfContradict` 是构造性误报须剔除 ② 首次取代因 vendor 只读 `updates` 而检不出冲突（判 `revision`）③ **去重有长度敏感性**（标题恒带 `...`，短内容 <约 36 字即使完全相同也不达 0.92 阈值）。**测试**：agent-memory **48 passed**（+19）
- **2026-09-11 A1 己1①（原文保真 · 顺序硬约束收官）**：超长内容在**截断之前**先外置成文件——新增 `crates/agent-kernel/src/raw_context.rs`（契约层：`RawRef`/`RawContextSink`/`noop_sink`/标注解析器，**零新依赖**）+ `clamp_tool_result_with`（截断前调 sink，成功则标注附坐标）+ 新增 `crates/agent-memory/src/raw_store.rs`（真文件 + **内容寻址** `raw/{sha256前16}.txt` + 双闸门 + 同步 API）+ 新增 `memory_read_raw` **只读**工具（按坐标取回、支持分段）。**两处安全设计**：只接受坐标不接受路径（否则成为读 app_data 任意文件的后门）、入 `SYSTEM_BASE_TOOLS`（跨场景通用）。**★ 闸门不做「先截断再外置」**（会制造伪保真）。**锚点回填机制的两条前置至此全部满足**。**测试**：agent-kernel **195**（+7）+ agent-memory **78**（+11）+ agent-commands **148**（+5）+ `src-tauri` 干净
- **2026-09-11 A1 丙2 阶段 B（不可变会话日志）**：`crates/agent-commands/src/session_store.rs` 从「可变快照」改为「**不可变追加日志 + 活跃视图**」双层——`session_log`（只增不改，稳定坐标 `log_offset`）+ `session_live`（游标，可重写）+ `session_events`（审计）。**关键区分：日志不可变，视图可变**（「裁剪」= 解除引用而非删内容）。**对齐算法用首尾夹逼**（只比前缀会在头部裁剪时把保留的尾部误判为新增 → 日志翻倍膨胀 + 坐标漂移）。**行为面变化**：裁剪不再丢内容 / `clear_history` 保日志 / 就地修订留旧版本 / 无变化为 noop / 删会话三表级联 / `purge_empty_sessions` 改按活跃视图判定。**旧库迁移**一次性且幂等；新增 API `load_session_log` / `read_log_entry`（**锚点解析**）/ `session_log_stats`。**测试**：agent-commands **143 passed**（133 → 143，重构零回归 + 10 新用例，0 warning）
- **2026-09-11 A1 乙3①（H5 收口）**：`MEMORY.md` 常驻注入落地——新增 `crates/agent-memory/src/memory_md.rs`（精选选取 + 确定性渲染，1500 字符 / 20 条 / 单条 160 字）；trait 增 `render_memory_md`（默认 `None`，零破坏）；新增 `memory_md_render` 命令（含 RPC 桥）；前端 `syncMemoryMd()` 派生落盘 + 注入为**全局组最后一项**（措辞区分「常驻认知」vs「需遵循的规则」）+ **写白名单剔除 MEMORY.md**；`RulesPanel` 卡片 `disabled` → `readonly + readonlyFile`。**要点**：① 无自由文本写入口（乙2 例外地位的落点）② 两处刻意不产出（无精选条目不产空文件 / 扩展库缺失不用全量硬凑）③ 字节稳定输出作为「仅变化时写盘」的前提 ④ **修正一处冲突**：MEMORY.md 本在 Agent 的 fs 写白名单内（与「不能随意写入」冲突），已剔除。**已知缺口**：Agent 侧尚无「置顶/打标签」工具，当前自动来源实际只有调和结论一路。**测试**：agent-memory **66 passed**（+18）+ 前端 vitest **324 passed** + `vue-tsc` 零错误
- **2026-09-12 A1 §6.2 锚点回填（压缩→还原链路闭环）**：**裁剪从「直接删除」升级为「折叠」**——新增 `crates/agent-kernel/src/anchor.rs`（`FoldState`/`FoldMeta`/锚点标记渲染与解析/`condense` 规则浓缩器/`render_archive_content` 材料渲染/`FoldOutcome`）；`AgentLoop::fold_context`（第一段：占位）+ `backfill_folds`（第二段：填回），`enforce_context_budget` 接分支——**有外置器走折叠、无外置器回退既有删除路径**；`retention.rs` 增 `selected_groups`（DropPlan → 组序列）；`agent-commands` 增 `register_fold_refs`（`persist_messages` 扫折叠形 → `raw_ref` 登记 context_anchor 侧，只增不删）。**四条硬约束**：① 外置成功才折叠（失败组保留原样——宁可超线勿丢）② 组 = 原子折叠单位（组内合并为一条折叠形、清空 tool 字段 → 配对整体消化不产生悬空）③ 不二次折叠 ④ 无外置器回退旧删除。**数据模型**：折叠状态内嵌 `meta["fold"]`（单一事实源随消息走，不落独立表）；锚点 = 内容坐标（无需编号）。**「压缩后能还原原文」整条链路（不可变日志 → 原文外置 → 折叠 + 回填 + 按坐标取回）至此闭环。** **测试**：agent-kernel **209 passed**（+14）+ agent-commands **150 passed**（+2）
- **2026-09-12 A1 甲3 淘汰策略（遗忘链闭环）**：三级链全部落地——新增 `crates/agent-memory/src/decay.rs`（`EvictionPolicy` 四参数 + `score()` 纯函数：半衰期 × 访问加权 × 最近访问）；`ext.rs` **schema v3**（`memory_ext` 增 `last_access_at`/`decay_score`/`deprecated_at` + `raw_trash` 表 + `apply_decay`/`purge_due_entries`/`trash_*`/`release_refs_by_owner`）；新增 `crates/agent-memory/src/evict.rs`（`run_gc_pass` 一轮巡检：衰减 → 硬删到期 → 外置文件 GC）；`agent-commands` 增 **巡检调度**（`ensure_memory_gc_task`：惰性 + 幂等 + 默认 6 小时 + 首轮延迟）+ `run_memory_gc` 手动入口。**访问数据接线**：`recall` 命中即计数（淘汰判据，非统计）。**释放半环**：会话删除 → 释放其锚点引用 → 巡检转回收站。**四处行为定稿**：① 软淘汰**可逆**（召回返青 → 清标记）② 同轮先衰减后挑候选 ③ **回收站时点自首次失去引用起算** ④ **硬删顺序：文件 → 引用行 → 回收站记录**（任一步失败即停）。**与 memory-archive 有意偏离**：去掉 `importance_weight`（vendor `importance` 当前无写入路径）。**R2（调度缺口）闭合**；`memories.db` 与磁盘外置文件**两侧同覆盖**。**测试**：agent-memory **95 passed**（+17）+ agent-commands **151 passed**（+1）
- **2026-09-12 A1「Agent 记忆工具」批（机制终于有了入口）**：五件工具落地——新增 `crates/agent-commands/src/memory_tools.rs`：`memory_recall`（读，命中即计入访问）/ `memory_store`（ADD，含写前去重与 16000 字符**拒绝而非截断**）/ `memory_update`（UPDATE，落甲2 取代式路径）/ `memory_delete`（DELETE，未命中报 `not_found` 不静默）/ **`memory_pin`（治理，乙3 缺口关闭）**。**四条口径**：① 全部经 `write` 统一入口（结果可解释）② **不给模型「写自由文本到 MEMORY.md」的入口**（pin 是治理动作不是文本编辑）③ 拒绝而非截断 ④ **注册无条件、可见性靠场景**（白名单机制）。**场景同步**：四场景补 `memory_update`/`memory_delete`/`memory_pin`；**coding 收掉 `memory_recall`**（用户裁定「可以收掉召回」，Light 档自洽——回归测试锁定）。**顺带修正一处误报**：`recall` 的 `pinned`/`access_count`/真标签此前是 vendor 拿不到的值（恒 `false`/恒 0/错源）→ 新增 `ExtStore::touch_with_meta` 一次取齐。**仍未覆盖**：注入预算/召回条数的档位化（丁1 剩余部分）。**测试**：agent-kernel **211 passed**（+2）+ agent-memory **96 passed**（+1）+ agent-commands **166 passed**（+15）
- **2026-09-12 A1 R3（前端会话日志面板 · §10.3 立项项①落地）**：**「只差前端」实查后补两处读面缺口** + 面板落地——后端：`SessionRepository` 增 `load_session_events`（事件流分页读；此前 `session_events` **只写不读**）与 `load_live_offsets`（活跃坐标集合，「活跃 / 已移出视图」判定依据）；`AgentCommandService` 增 5 透传 + `commands.rs` 5 个 `#[tauri::command]` + `lib.rs` 注册 + `http_bridge/rpc.rs` 同步注册；`raw_tools.rs` 抽 `read_raw_paged`（**工具与命令唯一实现**，安全边界一致）供 `memory_read_raw` 命令复用。前端：`ExecTab` 增 `'sessionlog'`（space-store / useSessionViewState / ExecPanel 三处接线）+ 新增 `apps/tauri/src/agent/panels/SessionLogPanel.vue`——统计条（日志/活跃/已移出/检查点）+ **轨迹**（日志条目分页：稳定坐标 `#offset` + 角色 + 时间 + 已移出 / 检查点 / 原文 徽标 + 折叠摘要 + 内容展开）+ **检查点**（事件留痕 +added/−dropped/=kept）+ **原文取回弹窗**（32K 分段 + 复制 + ESC）；刷新 = 挂载 / 切会话 / 运行结束（`isStreaming` false 沿延迟 500ms）/ 手动，不轮询。**边界**：只读呈现不承担编辑；未做对话流内行段。**测试**：agent-commands **168 passed**（+2）+ `src-tauri` `cargo check` 干净 + `vue-tsc` 零错误 + vitest **324 passed**（回归）；**待真机走查**
- **2026-09-12 A2-1 戊1 语义检索（记忆侧闭环 · 千万字级检索线启动）**：**「未接线既有能力」第三次收编**——vendor 内置混合检索栈（上游 v2.5 批次 7：`Bm25Searcher`(jieba) / `SqliteVectorIndex`(BLOB+内存缓存) / `HybridRetriever`(RRF k=60 + 三层降级)）此前全仓零接线。① 新增 vendor crate `memory-center-llm`（上游源码原样：`HttpEmbedder` = OpenAI 兼容 /v1/embeddings）；② 新增 `agent-memory/src/semantic.rs`（`SemanticConfig` / `SemanticStack` / **进程级注册表**（同向量库共享一栈、配置指纹重建）/ **`GatedEmbedder` 熔断**（3 连败 → 60s 免网络降级）/ `ensure_vector_dim`（换模型清旧向量）/ 索引文本 = 摘要口径 + ext 真标签）；③ **三处接入 A1 留的 seam**：`recall` → 混合检索（**会话内过滤** + `embedding` 标注；未配置/失败 = 既有路径零变化）、`find_duplicate` → 语义余弦（0.92；失败回退 Jaccard）、写入/删除/甲3 GC 硬删 → 索引同步（`GcReport::evicted_hooks` 回传 + 装配层移除）；④ 懒播种（关键词一次性 + 向量补缺）+ trait 新默认方法 `rebuild_semantic_index`（手动重建）；⑤ 配置面：`{app_data}/worldsea/semantic.json` + **SecureStore 存 Key** + 共享配置句柄（保存即全会话生效）+ 4 个 Tauri 命令（读/存/状态/重建，HTTP 桥同步）+ 前端「配置 → 记忆」子页**语义检索卡片**。**路线微调**：vendor 栈替代原评定的自建 FTS5 + sqlite-vec（能力等价、零新依赖、上游生产验证；规模落在其甜点区）。**已知边界**：`_default` 分片固定（待丁3）；文件侧 `workspace_search` 与中文评测集留待 **A2-2**。**测试**：agent-memory **110 passed**（+14）+ agent-commands **168** + agent-kernel **211** + `src-tauri` 干净 + `vue-tsc` 零错误 + vitest **324**；**待真机走查**（硅基流动 bge-m3 → 召回/去重生效）
