# 16 个 instructions.md 类技能评估（S4 挂账项）

> status: **已执行（15/16 完成，creation-orchestrator 挂账）**（2026-09-18 同日执行；裁定 E1 摘注册+删目录 / E2 vision 补桥后退役 / E3 挂账 / E4 只迁四类一行级）
> 评估对象：SKILL_REGISTRY 中的 16 个 **instructions.md 类**技能（无 frontmatter，正文=某类工具族的「使用说明」）
> 判据三问：① 其声明的能力**是否已由可达工具面承载**？② 该能力**是否值得承载**（对主会话 Agent 有独立价值）？③ 退役需**同步哪些引用点**？

---

## 一、评估对象与共同背景

- **形态**：`packages/agent-runtime/src/skills/<id>/instructions.md`（16 个），注册于 `data/{analysis,development,other}.ts`，`promptFile` = `<id>/instructions.md`。
- **本质**：它们是「工具族的使用手册」——正文大量引用 `pkg_*` / `sys_*` / `git_*` / `file_*` / `fs_*` / `web_*_cli` / `vision_*` / `pipeline_*` 等工具名，而这些工具族**大多不在桥 26 项、也无 Rust 原生实现**（见 04 清单 §二·组 B）。
- **共同引用面**（退役必同步）：`orchestrator/types.ts` `AGENT_TYPE_CONFIG.skillIds`（11 个 id）· 群聊 `AgentCapabilityDrawer.vue` 排除集（16 个 id）· `content-map.ts` · `data/*.ts`。其中 `skillIds` 经 `worldsea:dispatch-sub-agent` CustomEvent 流入子 Agent 调度链（功能性，非纯展示）。

---

## 二、逐项评估

| id | 对应工具族 | 承载现状 | 能力性质判定 | 建议 |
|---|---|---|---|---|
| terminal-operator | execute_command / shell_session / dialog_* / native_fetch / open_url | △（bash/powershell/shell_session 原生已承载核心） | 与原生重复；其余为桌面 UI 动作 | **B 清理** |
| fs-operator | file_* / fs_* | △（read/write/edit/search/list 已原生） | 与原生重复 | **B 清理** |
| git-operator | git_status/log/diff/commit/branch | △（无专用工具，bash 可代偿） | 可由 shell 完成；价值在「流程约定」 | **B 清理**（约定择要迁规则） |
| pkg-manager | pkg_install/run/info | ✗ | 可由 shell 代偿；专用封装收益低、安全面更大 | **B 清理** |
| sys-inspector | sys_info/processes/disk | ✗ | 可由 shell 代偿 | **B 清理** |
| web-cli-operator | web_search_cli/fetch_cli/qa/dns/ping | ✗ | 原生 `web_search` + shell 已覆盖主场景 | **B 清理** |
| terminal-launcher | detect_terminal_mode/start_server/launch_terminal* | ✗ | **产品动作**（打开终端窗口/起服务），不是 LLM 能力面 | **B 清理**（能力在 UI 侧已有） |
| agent-orchestrator | list_sub_agent_types/dispatch_sub_agent/get_sub_agent_status/cancel_sub_agent | △（原生 `delegate_to_sub_agent`/`list_sub_agents` 等价） | 与原生近似重复；残留为 TS 编排栈的历史入口 | **B 清理** |
| code-reviewer | read/search/execute + file_read | △ | 提示词流程型（工具已原生） | **B 清理**（若要保留方法 → 迁 docs/） |
| security-scanner | 同上 + web_search_cli | △ | 提示词流程型 | **B 清理** |
| test-automator | 同上 + pkg_run/install | △ | 提示词流程型 | **B 清理** |
| doc-generator | read/write/search + fs_*/git_log | △ | 提示词流程型 | **B 清理** |
| find-skills | web_search_cli/fetch_cli + read/write | △ | 提示词流程型（社区技能发现） | **B 清理** |
| skill-creator | read/write + entity_* | △ | **能力已由 S2「创建技能」向导承载** | **B 清理** |
| **vision-analyzer** | vision_analyze / list_vision_images | **✗（专用工具无承载）** | **图像理解是通用 Agent 能力**（模型支持 vision 时价值高、无等价原生替代） | **A 补桥**（+可见性） |
| creation-orchestrator | pipeline_* 9 件 + get_sub_agent_status | ✗ | **与编排线绑定**（workflow 芽 5 处引用）；属编排面而非独立技能 | **D 单独议** |

---

## 三、三种处置路线对比

| 路线 | 内容 | 成本 | 收益 | 风险 |
|---|---|---|---|---|
| **A 补桥第二批** | 把对应工具族补进桥（T5 后只需 TS 侧加名单 + 重新生成）+ 可见性 | 中-大（~60 项工具） | 工具族可达 | 大量工具对主会话价值存疑；桥清单膨胀；审批/安全面扩大 |
| **B 降级为规则/文档** | 摘注册 + 删 instructions.md；把确有价值的**流程约定**择要并入规则文件或 docs/ | 小 | 注册表收敛；与「独立 Skills=0」对齐 | 若某约定被依赖需先辨认（已逐项核对：正文多为工具说明，无系统依赖） |
| **C 保留现状** | 不动 | 0 | — | 注册表长期残留 16 个「说明不可达工具」的技能；索引进提示词但无实际能力 |

---

## 四、分档建议（合计 16 项）

| 档 | 项数 | 清单 | 动作 |
|---|---|---|---|
| **A 补桥** | 1 | vision-analyzer | 补 `vision_analyze` / `list_vision_images` 入桥 + 可见性（内容/创作场景优先），随后退役技能 |
| **B 清理** | 14 | terminal-operator、fs-operator、git-operator、pkg-manager、sys-inspector、web-cli-operator、terminal-launcher、agent-orchestrator、code-reviewer、security-scanner、test-automator、doc-generator、find-skills、skill-creator | 摘注册 + 删目录；**git/审查/测试/文档四类的流程约定择要迁 `WORLDSEA.md` 或 docs/**（一行级） |
| **D 单独议** | 1 | creation-orchestrator | 与编排线（pipeline 面 + workflow 芽）一并讨论，本轮不动 |

**若 B 档执行，退役后的「独立技能」仅剩**：coding、web-scout、output-orchestrator、module-builder、persona-possess、retrofit-architect、data-analyst、graph-explorer 等（芽外技能）。「独立 Skills = 0」的剩余工作 = 本表 A/B/D 三档 + 前述挂账（coding 的 `builtin_skills` 引用同步）。

---

## 五、退役触点清单（任一档执行时同步）

1. `packages/agent-runtime/src/skills/data/*.ts` 注册条目摘除
2. `packages/agent-runtime/src/skills/content-map.ts` 对应 `<id>/instructions.md` 映射
3. `packages/agent-runtime/src/skills/<id>/` 目录删除
4. **`packages/agent-runtime/src/orchestrator/types.ts`** `AGENT_TYPE_CONFIG.skillIds` 同步（`terminal-worker`/`review-worker`/`research-worker`/`test-worker`/`doc-worker`/`git-worker` 六个 worker 类型；否则子 Agent 得到空技能集）
5. 群聊 `apps/tauri/src/space/group-chat/components/AgentCapabilityDrawer.vue` 排除集同步
6. 流程约定迁移（若采纳）：`apps/tauri/src/agent/rules/WORLDSEA.md` 或 `docs/`

---

## 六、决策点

| # | 决策点 | 选项 |
|---|---|---|
| E1 | 14 项 B 档动作 | ① **摘注册 + 删目录（推荐）** ② 摘注册、instructions.md 留档（不删）③ 保留现状 |
| E2 | vision-analyzer | ① **补桥 + 可见性后退役（推荐）** ② 一并清理（放弃图像工具面）③ 挂账 |
| E3 | creation-orchestrator | ① **挂账单独议（推荐）** ② 本轮一并清理（需先核 workflow 芽的 5 处引用是否功能性） |
| E4 | 流程约定迁移 | ① **只迁 git/审查/测试/文档四类的一行级约定进 WORLDSEA.md（推荐）** ② 全部迁 docs/ 长文档 ③ 不迁 |