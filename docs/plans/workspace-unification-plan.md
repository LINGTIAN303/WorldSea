---
status: 执行中
---

# 项目空间 × Agent 工作空间统一方案

> 起草：2026-08-28 · 依据：同日文件系统专项调研（代码级扫描，关键文件全部实读）
> 定性：**Harness 架构级收敛，非 UI 打磨**。§四 五问已全部拍板（2026-08-28，按推荐项），方案进入实施阶段；M1 开工受走查批次冲突面约束（见 §六）。
> ROADMAP 登记：任务 29（系统功能类）。

---

## 一、背景与定性：为什么必须统一

WorldSmith 是 Agent 产品、Harness 工程。文件系统对 Harness 不是"存储选型"，而是**运行时一等公民**：工具的读写对象、边界的划定范围、会话的持久层、人与 AI 的共同事实地面。由此导出四条不变量，现状逐条违反：

| # | 不变量 | 现状违反 |
|---|--------|---------|
| ① | Agent 的世界观与产品的世界观一致（Agent 能用统一工具触达产品核心数据） | 产品把实体落成 `entities/*.json`（文件即数据），但 Agent 默认工作区看不到它们——为此特设 FrontendToolBridge（entity_create/search 走前端桥）作为分裂补丁 |
| ② | 沙盒边界是运行时（kernel）属性，不是工具族属性 | `cmd_fs_*` = 全盘 + 敏感目录黑名单；coding 工具链 = workdir 词法白名单 + 无 workdir 放行。两套信任模型并存 |
| ③ | 会话归属有项目语义 | Agent 会话库为全局单库，会话↔项目关联仅靠 `workdir` 字符串分组；`cmd_switch_project` 为空壳（打日志即返回） |
| ④ | 一个项目 = 一个目录 = 一个事实源（人/Agent/工具共享） | 双默认根并存：项目在 `{appDataDir}/projects/{projectId}`，Agent 在 `~/.worldsmith/workspace`，用户在资源管理器看到两个"WorldSmith 痕迹" |

一句话定性：agent-kernel 定位为执行内核，**工作空间基底（workspace substrate）是与 LLM 层、工具层并列的基础设施**；现状是"两块地基各盖半栋楼、中间一根单向桥"。§二 的 7 条分叉本质都是这一个根因的投影。

## 二、现状事实（两套空间实现地图）

### 2.1 项目空间（实体数据落盘体系）

- **管理链**：[ProjectManager.ts](../packages/entity-core/src/core/ProjectManager.ts)（项目元数据在 IndexedDB `WorldSmith-Meta`，含 `dirPath` 字段）→ [FileStorageBackend.ts](../packages/entity-core/src/core/FileStorageBackend.ts)（**本地目录为主存储**，IndexedDB 仅 fallback）
- **默认绑定**：Tauri 桌面端项目无目录时自动绑定 `{appDataDir}/projects/{projectId}`（[useProjectSwitcher.ts](../apps/tauri/src/composables/useProjectSwitcher.ts) 兜底），文件主存储是常态
- **目录结构**：`entities/{类型}/{名称_id8}.json` + `relations/_index.json` + `.worldsmith/`（kv_store、files_meta、files_content）
- **UI 入口**：[AppMenu.vue](../apps/tauri/src/ui/layout/AppMenu.vue)「绑定/切换项目目录」「导出到文件夹 Ctrl+S」；应用内**无**项目文件树视图
- **外部回流**：[useFsWatcher.ts](../packages/entity-core/src/composables/useFsWatcher.ts) → Rust `cmd_fs_watch_start`（notify 监听）→ `fs:change` → 增量重载，带自身写入静默期——与外部资源管理器已双向打通

### 2.2 Agent 工作空间（会话绑定工作目录）

- **会话级 `workdir`** 持久化于 Rust SQLite；默认根**固定 `~/.worldsmith/workspace`**，设计为"不跟随项目"（对齐 OpenClaw 惯例，[workspace.ts](../apps/tauri/src/space/workspace.ts)）
- **目录实体**：`cmd_save_workdir/list_workdirs`（SQLite），作为下拉候选 + 会话树分组
- **消费方四处**：① coding 工具链词法边界（[coding-agent-tools.ts](../packages/agent-runtime/src/tools/coding-agent-tools.ts) `resolveWithinWorkspace`：相对路径 join、越界拒绝、无 workdir 放行）；② shell cwd 缺省；③ 前端工具桥上下文注入（useAgentRust 的 `toolBridgeContext.workspace`）；④ 右栏 [WorkspacePanel.vue](../apps/tauri/src/space/panels/WorkspacePanel.vue)
- **WorkspacePanel**：应用内文件资源管理器雏形（目录树/新建/重命名/删除/上传/只读预览），但**只覆盖 workdir 范围**、只支持文本、走 `cmd_fs_*`

### 2.3 已存在的单向缝合点

[WorkdirSelect.vue](../apps/tauri/src/space/chat/WorkdirSelect.vue) `applyWorkdir`（save=true 时）：Agent 侧「打开文件夹…」主动选目录 → `bindDirToProject` 把它绑定为当前项目存储目录并 toast（[useFileSystemProject.ts](../packages/entity-core/src/composables/useFileSystemProject.ts)）。注释原话：「统一根目录：Agent 工作区 = 项目数据存储」。
**方向性已存在，但单向**：AppMenu 换绑项目目录、切换项目时，Agent 会话 workdir 均不跟随。

### 2.4 分叉清单（7 条）

| # | 分叉 | 性质 |
|---|------|------|
| 1 | 默认根不同（`projects/{id}` vs `~/.worldsmith/workspace`），Agent 产物与项目数据分居 | 不变量①④ 违反的主来源 |
| 2 | 绑定单向（Agent 侧带动项目侧，反向不成立）；"当前项目"与"当前会话 workdir"是两个独立状态 | 缝合不完整 |
| 3 | 同一目录两套称呼（项目目录/项目存储 vs 工作区/工作目录/目录实体） | 术语/心智模型 |
| 4 | 边界模型不一致（黑名单 vs 词法白名单） | 不变量② |
| 5 | 数据源分叉：Rust SQLite entity 兜底库 vs 文件主存储；`cmd_switch_project` 空壳 | 不变量③ |
| 6 | 混居约定缺失：统一后 Agent 任意文件与 `entities/`、`.worldsmith/` 同住一根，无写保护（fs_watch 会如实回流 Agent 误删） | 统一后的新风险 |
| 7 | 能力缺口：WorkspacePanel 仅文本上传/预览；删除项目只清理 `projects/{id}`，曾绑定自定义目录的项目残留脱节 | 次生 |

## 三、统一目标形态（v1 框架，待拍板细化）

目标一句话：**一个项目 = 一个目录 = 一个事实源；Agent 与人与工具共享它。**

- **统一根**：项目目录为权威根，Agent 会话默认 workdir = 当前项目目录（方案 A1，见 §四A）
- **边界 kernel 化**：workdir resolver 收敛为 kernel 级契约，全工具族共用；`cmd_fs_*` 的敏感目录黑名单降为底层兜底防护
- **会话-项目锚点**：会话归属从 workdir 字符串升级为项目锚点（方案 D，见 §四D）
- **统一文件浏览器**：WorkspacePanel 升级为覆盖统一根的空间级视图（方案 C，见 §四C）
- **桥收敛**：FrontendToolBridge 的 entity 工具在统一根下逐步与裸 fs 工具收敛（长期方向，非 v1 必须）
- **混居保护**：`entities/`、`.worldsmith/` 对 Agent 裸写加目录规则（方案 E，见 §四E）

## 四、已拍板决策（2026-08-28，全部按推荐项执行）

**A. 统一根策略 → A1**
- ✅ **A1（已拍板）**：项目目录为唯一权威根——新会话默认 workdir = 当前项目目录；`~/.worldsmith/workspace` 降级为未绑定项目时的兜底草稿区。对齐不变量①④，项目空间已是文件主存储
- 否决 A2（维持双根 + 双向联动）：两根长存、心智模型仍两套；~~A3~~（默认工作区为根）：破坏多项目隔离，仅存档

**B. 存量 `~/.worldsmith/workspace` 处置 → B1**
- ✅ **B1（已拍板）**：旧会话 workdir 保留原值，仅新建会话用新默认（惰性迁移，零风险）
- B2（一次性迁移工具并入项目目录）保留为 B1 之后的可选项，不默认实施

**C. 文件浏览器形态 → C1**
- ✅ **C1（已拍板）**：WorkspacePanel 升级为空间级文件浏览器（覆盖统一根，Agent 侧与项目侧共用）
- 否决 C2（仅扩展 Agent 侧）：项目侧继续无应用内视图，与统一目标相悖

**D. 会话-项目锚点 → D1**
- ✅ **D1（已拍板）**：Rust session 表加 `project_id` 字段，归属显式化（数据模型变更已获确认）
- 否决 D2（workdir 路径推导）：目录改名/移动即断链，锚点不稳

**E. 混居写保护 → E1**
- ✅ **E1（已拍板）**：边界 resolver 加目录规则——Agent 裸写 `entities/`、`.worldsmith/` 需走实体语义层（FrontendToolBridge），裸 fs 拒绝
- 否决 E2（约定优先）：接受误删风险不符合 Harness 基线

## 五、里程碑草案（粗粒度，A-E 拍板后细化）

- **M0 基线**：✅ 现状事实冻结于 §二（2026-08-28 完成）；走查批次已提交（0bd2201，27 文件），冲突面解除
- **M1 根统一**：✅ 2026-08-28 落地——`resolveWorkspaceDir` 改为当前项目目录优先（新增 `resolveDefaultWorkspaceDir` 导出兜底）；WorkdirSelect last_workdir 跨启动记忆退役 + 默认项动态文案（项目目录/默认工作区）+ 绑定成功后刷新默认根解析；useAgentRust.newSession 注释同步。B1 惰性语义天然满足（旧会话 workdir 不动，仅新建会话用新默认）。验证：typecheck + vite build 全绿，待真机验证
- **M2 边界收敛**：kernel 级 resolver + 目录写保护（E1）+ `cmd_fs_*` 黑名单兜底化（实施计划待确认后开工）
- **M3 锚点与视图**：session.project_id（D1）+ 统一文件浏览器（C1）+ 术语统一（分叉 #3）
- **M4 收尾**：数据源分叉评估（分叉 #5）、桥收敛路径、端到端实测

## 六、风险与协作边界

- **冲突规避**：走查批次已提交（0bd2201，2026-08-28），M1 冲突解除并落地；后续里程碑开工前仍需复查 `git status` 确认无新并行批次
- **数据迁移**：A1/D1 均涉及默认行为变化，需保证"未绑定项目的旧项目"行为不劣化
- **不自动修复约定**：§四 各项均为用户决策点，未拍板前不动代码
