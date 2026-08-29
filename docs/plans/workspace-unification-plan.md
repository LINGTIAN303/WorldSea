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
- **M2 边界收敛**：✅ 2026-08-28 落地——共享边界契约 [workspace-boundary.ts](../../packages/agent-runtime/src/tools/workspace-boundary.ts)（workdir 词法边界自 coding-agent-tools 迁出 + E1 判定/写守卫新增，消费方共享）；coding 工具 write_file/edit_file 换用写守卫；**fs-tools 五个写类工具（fs_write/mkdir/copy/move/delete）由零守卫全量接入 E1**（fs_move 源目标双守卫、fs_copy 守目标）；fs_commands.rs 头注释补「兜底防线」定位。已知限制：shell/execute_command 内容级写入无法词法拦截（接受风险，记录于边界模块注释）。验证：新增单测 19 项全绿（vitest 全量 223 绿）+ typecheck EXIT=0，待真机验证
- **M3 锚点与视图**：✅ 2026-08-28 落地——**D1 锚点**：Rust sessions 表 ALTER 幂等补 `project_id` 列（弱引用前端项目 UUID，旧会话 NULL 惰性），SessionRecord/SessionInfo 字段 + save/load 双向 + Tauri 命令与 HTTP 桥同步透传，前端 newSession 注入当前项目 id（getCurrentProjectIdSafe 静默兜底）；**C1 空间级浏览器**：WorkspacePanel 根解析升级为「会话 workdir 优先，无会话回落统一根（当前项目目录）」，不再要求先建会话；**术语统一**：面板标题「工作区」→「项目目录」，空态文案同步。project_id 的消费（按项目过滤/记忆隔离）留 M4 与记忆集成联做。验证：agent-commands 101 测试全绿 + typecheck/build EXIT=0，待真机验证
- **M4 收尾**：✅ 2026-08-29 落地（风险点并入本里程碑一并推进）——
  - **数据源分叉收敛**（分叉 #5 主危害消除）：实体真身在文件主存储，而 Agent 的 entity_list/get 与场景实体摘要此前读 EntityDb SQLite 兜底库（两侧无同步 → 空/过时数据）。新增文件版 `FsScenarioEntityProvider` + `fs_entity_tools`（扫 `{workdir}/entities/`，摘要格式与 C2 引用校验语义对齐 SQLite 版），经 `with_session_entity_adapter` 工厂注入——有 workdir 的会话同名覆盖注册（ToolBus 覆盖语义），无 workdir 回退 SQLite 兜底。**EntityDb 收敛定位 = 前端 TauriStorageBackend fallback 专用**，不再是 Agent 实体读来源
  - **shell 写入盲区词法防护**（风险①消化）：`shellCommandTouchesProtectedPath`（写操作词 × 受保护目录字样同现即拒，宁误拦不错放）接入 execute_command 与 shell_session exec 双入口；**非完备声明**：变量间接/别名可绕过，定位 = 拦常见误操作 + 引导语义层，不能替代用户监督
  - **FrontendToolBridge 收敛定案（2026-08-29 实施）**：**保留**——E1 后写类经桥走实体语义层是唯一正道。摸底澄清：桥上从无读类工具（entity_list/get 由 Rust 原生覆盖，SQLite 版 → M4 fs 版）；真正的缺口是 **entity_delete 桥工具缺失**（E1 引导语提到但 Agent 无合法删除路径）——已补齐（桥第 4 工具 + `__meta op:delete` + 前端 toolSemantics 效果标签「已删 ×」），E1 引导语与桥清单完全闭环。content_search 保留（语义搜索 Rust 无对应实现）
  - 验证：tauri 30 测试（单线程）/ commands 101 / vitest 26（含 +7 shell 防护）/ typecheck / build 全绿
  - **端到端走查清单（M1-M4 验收，待真机一次性执行）**：
    1. 绑定项目 → 新会话：输入栏 pill 显示项目目录基名，会话 workdir = 项目目录（M1/A1）
    2. 无会话打开右栏「项目目录」面板：显示当前项目目录文件树（M3/C1）
    3. Agent 请求 `fs_delete entities/xxx.json` → 拒绝并提示 entity_delete（M2/E1）
    4. Agent `entity_list` → 返回文件主存储的实体真身（M4 收敛）
    5. Agent shell `rm entities/x.json` → 词法防护拒绝（M4）
    6. 重启应用 → project_id 持久回传，旧会话 workdir 不变（M3/D1+B1）

## 六、风险与协作边界

- **冲突规避**：走查批次已提交（0bd2201，2026-08-28），M1 冲突解除并落地；后续里程碑开工前仍需复查 `git status` 确认无新并行批次
- **数据迁移**：A1/D1 均涉及默认行为变化，需保证"未绑定项目的旧项目"行为不劣化（D1 迁移用 ALTER TABLE 幂等补列，旧会话 project_id=NULL 惰性，符合 B1）
- **不自动修复约定**：§四 各项均为用户决策点，未拍板前不动代码
- **已知风险（2026-08-29 真机验证后处置状态）**：
  - ~~E1 防护层错位~~（真机验证发现，a8fc9b0 已修）：原 M2/M4 防护加在 TS 层（workspace-boundary），但 Rust 主循环注册的是 **Rust 原生 FS/terminal 工具组**——TS 防护不在真实链路（并行会话的 rm 成功删除暴露）。已下沉 Rust：fs_tools 写类 E1 守卫 + terminal 双入口 shell 词法防护，**真机 3/3 通过**（entity_list 读文件真身 191 个/旧桥 0；write_file 与 rm entities 均在路径校验阶段被拒并引导语义工具）
  - ~~secure_store 类型不匹配 panic~~（真机发现存量 bug，a8fc9b0 已修）：manage 的是 Arc<Self> 而命令取裸类型→每次调用 panic，前端静默降级 localStorage 掩盖至今；已统一 Arc 化
  - shell 词法防护**非完备声明**不变：变量间接/别名可绕过，定位=拦常见误操作（真机验证确认防护在路径解析阶段拦截、未尝试执行）
  - 端到端走查清单 6 项：**真机已验证 4 项**（①绑定项目会话 pill=项目目录 ②fs_delete/write_file 拒绝 ③entity_list 文件真身+实时一致 ④shell rm 拒绝），剩 ⑤无会话项目目录面板、⑥重启 project_id 持久 两项 UI 走查（RPC 层 project_id 回传已验证）
  - 既有测试隔离 flaky（tauri SQLite 临时库固定文件名并行锁竞争，单线程全绿）未修，建议后续加唯一后缀
