# dsh 三域设计基线（内置工具 / Skill / MCP）

> status: 已完成
> 来源：参考快照 `.独立项/【参考项】deepseek-harness/`（本地锁定版，零修改）；四路只读源码探索汇总（工具契约逐字段核对、工具清单对照 `docs/tool-catalog.md` 逐名抽查、Skill/MCP 源码级走查）。
> 用途：为「Skills / MCP / 内置工具对齐 dsh」提供 dsh 侧事实基线。对照与本侧建议见 [02-三域对照与建议清单](02-三域对照与建议清单.md)。
> 口径：本文件只陈述 dsh 事实，不含本侧评价；行号取自探索时源码，供后续复核。

---

## 一、工具域

### 1.1 工具契约（`packages/core/tools/src/index.ts`）

**定义结构 `ToolDefinition`**（`defineTool()` 是唯一推荐入口，L545-617）：

| 字段 | 说明 |
|---|---|
| `name` / `description` / `parameters` | **唯一进入模型的三字段**（`schemaOf()` 白名单投影，L1262-1273，其余字段永不发给模型） |
| `output: { schema, render, presentationMeta? }` | 强制字段。执行体只返回 canonical 无损 JSON `value`；注册中心用 `output.schema` 校验、`render(args, value)` 产出 ContentBlock[] |
| `execute(args, exec)` | 返回 canonical value（不是 content） |
| `timeoutMs?` | 协同超时预算；由独立包 `dsh-tool-call-timeout-policy` 以 `tools/execute` 包装器实施 |
| `isConcurrencySafe?(args)` | 仅 `=== true` 才算并行；未声明/抛错/校验失败一律排他（`executionMode()` L1282-1291） |
| `presentCall?` / `presentResult?` | 纯函数、可重放（回放旧日志不得抛错，L598-609） |
| `finalizeContent?(exec, result)` | 结果落地前最后一次内容改写（含失败路径） |

**结果判别联合 `ToolExecutionResult`**（L555-579）：`isError` + `content: ContentBlock[]` + `value`（仅成功）+ `error{message, info{name, code}}` + `meta` + `additionalContexts` + `concludesTurn`。
错误码：`UNKNOWN_TOOL`（L493-509）、`INVALID_TOOL_OUTPUT`（L512）、`ABORTED` / `ABORTED_BEFORE_DISPATCH`（L466-469）。

**参数 schema 风格**：自研手写 DSL（`schema.ts` 的 `ValueSchemaSpec`，L85-106）——逐属性 `required: true`、object 必须显式 `additionalProperties`、支持 `oneOf/enum/const`；编译期推断 TS 类型（`InferArgs`/`InferValue`），运行期编译为受限 JSON Schema 并强校验（`validateArgs`）。

### 1.2 内置工具全清单

来源：`docs/tool-catalog.md`（由脚本启动真实插件读取 `ctx.tools.schemas()` 生成、CI 校验）+ 源码抽查。共 **23 个 `tool-*` 包 + 5 个非 tool-* 贡献者**，另有两类运行时动态注册。**逐工具全清单（72 条）见 §五 附录（2026-09-18 补录）**。

| 包 | 模型可见工具名 | 职责 / 关键设计点 |
|---|---|---|
| `fs/tool-fs` | `read` `write` `edit` `read_image` | 读写编辑；read 分窗口+行号+流式阈值；读前写策略由 `fs-observation-policy` 事件门实现（无 schema 变更）；`read_image` 无附件能力时不注册 |
| `fs/tool-fs-search` | `glob` `grep` | 打包 ripgrep 经 `ctx.subprocess` 执行；结果封顶后整体存 spill，返回 locator |
| `fs/tool-str-replace-editor` | `str_replace_editor` | view/create/唯一字面替换/行插入，不依赖 shell |
| `fs/tool-present` | `present` | 交付物呈现（Session 归属） |
| `shell/tool-bash`·`tool-pwsh` | `bash` / `pwsh` | shell 执行缝的模型侧消费者；`run_in_background` 注册到 `ctx.jobs`；支持 sandbox 控制 |
| `shell/tool-*-persistent` | `bash` / `pwsh`（同名，按部署二选一） | 持久 PTY 会话，按 owner 隔离 |
| `terminal/tool-terminal` | `terminal_open` `terminal_send` `terminal_read` `terminal_signal` `terminal_close` `terminal_list` | 6 个 opt-in PTY 工具；后台 send 走 `ctx.jobs` |
| `core/tools` | `run_code` | PTC 呈现模式的保留传输工具（`ptc.ts` L23），该模式下唯一可直接调用的名字 |
| `plan/plan-mode` | `exit_plan_mode` | 计划模式退出；未激活时 execute 直接拒绝、schema 常驻（避免目录抖动） |
| `todo/tool-todo` | `todo_write` | 会话自有待办覆盖写入；`allowParallelInProgress` 必填无默认 |
| `interaction/tool-ask-user` | `ask_user_question` | 暂停调用等人回答（user-questions 缝） |
| `subagent/tool-subagent` | `subagent`（别名 `subagent_fork`）+ `list_subagent_models` | 委派子 Agent；模型选择开关、后台模式可配 |
| `subagent/tool-subagent-control` | `send_message` `interrupt_agent`（+`list_agents`） | 可续跑后台子 Agent 的全局控制面 |
| `jobs/tool-jobs` | `job_list` `job_output` `job_kill` | 与 kind 无关的后台作业控制（bash/PTY/subagent 共用） |
| `goal/tool-goal` | `create_goal` `get_goal` `update_goal` | 目标增改/暂停/恢复/完成/阻塞；写操作要求人类根权限 |
| `schedule/schedule` | `schedule_create` `schedule_list` `schedule_delete` | 定时触发未来 root Agent；仅 root Agent scope |
| `lsp/tool-lsp` | `lsp` | 语言服务查询，provider 藏在 `ctx.lsp` 后，schema 稳定；无 provider 返回 `LSP_UNAVAILABLE` |
| `skill/tool-skill` | `skill` | 技能加载（渐进披露，见 §二） |
| `session-query/tool-session-query` | `session_search` `session_trace` `session_event_read` `session_event_search` `session_event_trace` | 只读历史检索；隐藏游标，按调用 Agent 会话鉴权 |
| `web/tool-web` | `web_search` `web_fetch` | provider 藏在 `ctx.web` 后 |
| `workflow/tool-workflow`·`tool-ralph` | `workflow` / `ralph` | 工作流脚本执行 / 固定前台的迭代（每轮一个结构化子 Agent） |
| `mcp/mcp-resources` | `list_mcp_resources` `list_mcp_resource_templates` `read_mcp_resource` | MCP 资源桥（server 名须显式传入，按 caller scope 解析） |
| `experimental/browser-use-stagehand-native` | `stagehand_navigate` `stagehand_act` `stagehand_observe` `stagehand_extract` `stagehand_screenshot` `stagehand_tabs` | 浏览器自动化 |
| `experimental/tool-agent-team` | `spawn_teammate` `list_agents` `send_message` `interrupt_agent` `wait_agent` `team_task_create/get/list/update` | Agent Team（默认禁用） |
| `extensions/tool-cordis` | `cordis_define` `cordis_run` `cordis_stop` `cordis_undefine` `cordis_inspect_list/query/self` | 自指动态包工具集，不在任何 shipped tree；运行期还可再注册新工具 |

**运行时动态注册（不进目录）**：
- MCP client 把每个 server 工具注册为 `mcp__<serverName>__<toolName>`（`mcp-client/src/tools.ts:125,150`，整代切换、失败全量回滚）；
- `computer-use` provider 自报工具集（`computer-use-cua-driver-native/src/index.ts:117`）；
- 子 Agent 结构化输出工具注册进子作用域自身层（`subagent-in-process-driver/src/structured.ts:65,100`）。

### 1.3 注册与暴露机制

- 包插件 → `ctx.tools.register(definition)`（L1043-1068，返回精确 disposer）→ 进入**分层作用域注册表** `ScopedLayers`（L813）。
- `view(scope)`（L1158-1199）一次遍历得出可见集：继承层（global + 祖先链，近者遮蔽远者）→ `restrict()` 过滤器（L1077，**仅作用于继承面、不作用于自身层**——保证被委派子 Agent 保留自己应答所需的工具）→ 叠加本层注册 → 按 mode 插入保留 `run_code`。
- `schemas(scope)`（L1240）投影给模型；prompt 装配由 `systemPrompt.tools()` 回调驱动。
- `toolOrder`（`core/system-prompt/src/index.ts:191-268`）：必须含且仅含一个 `'<unlisted-tools>'` 占位，未列名工具按字典序插入该位置；列了未注册名则装配失败。
- 呈现模式 `native | ptc | both`（L653-676）：ptc 只发 `run_code` + 生成 SDK 段；直接调用其它名字在策略流水线之前即判 `UNKNOWN_TOOL`。`core/agent-tool-presentation` 即按 preset/agent 选择该模式的插件（`ctx.tools.presentAs(mode)`，一 scope 一声明）。

### 1.4 关键机制清单

1. **输出契约双投影**：`value`(canonical JSON) → `render`(模型 content) / `presentationMeta`(UI 专用，仅顶层调用计算)。证据 `index.ts:1801-1832`。
2. **五段流水线**：`tools/pre-execute`(allow/deny/cancel/ask) → 单调 `guard()`（只能拒绝、不能翻案，L713、L1496）→ `tools/execute`(around，只可换 signal) → 工具体 → `tools/post-execute`(accept 改 content/value 或 block 变错误) → `finalizeContent`。证据 L1470-1516、L1751-1790、L1640-1663。
3. **审批降级（fail-closed）**：`ask` 经 `ctx.get('approval')`；无审批服务/无 agent/被取消 → 一律 deny 且带不同 reason（L1698-1738）；审批 policy 仅 ask/never，无 allow-always。
4. **失败关闭的并发**：只有显式 `true` 并行，排他调用构成顺序屏障（L1282-1291）。
5. **超时与 spill 都是外挂 policy**（不是工具字段）：`tool-call-timeout-policy`、`spill-policy`（超 `maxInlineBytes` 的纯文本结果 → 头尾预览 + locator）。
6. **取消贯通**：caller 与 wrapper signal 融合（`fuseToolSignals()` L1898-1925），已启动的工具体不被抛弃，最终以 `ABORTED` 覆盖成功结果。
7. **工具可注入后续上下文/结束回合**：`deferContext()` / `concludeTurn()`（L401-418、L1824）。
8. **模板化 UI 呈现契约**：`presentation.ts` 导出 `ToolCallView`/`ToolResultView` 判联（card/terminal/diff/search/read/web），供 Host presenter 与 Client renderer 独立收窄。
9. **沙箱/守卫关系**：`guard()` 是注册中心内的最终否决点；文件效果策略在 `sandbox-policy` 包（bash/fs/terminal 共用同一 mode+workspace）；`repeat-tool-reminder` 只是建议型循环卫生提醒，从不阻断。

---

## 二、Skill 域（`packages/skill/` 四个子包）

### 2.1 数据模型

文件形态（`skill-filesystem/src/index.ts:723-751`）：仅识别 `<root>/<name>/SKILL.md`（目录包）与 `<root>/<name>.md`（扁平），**深度 1**，嵌套 `**/SKILL.md` 明确不发现。

frontmatter 字段（解析见 `skill-filesystem/src/index.ts:797-840`）：

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | kebab-case，正则 `^[a-z0-9]+(?:-[a-z0-9]+)*$`（`skill/src/index.ts:21`） |
| `description` | 是 | 目录展示用；空则整条丢弃 |
| `whenToUse` | 否 | 额外路由提示（不渲染进目录） |
| `disable-model-invocation` | 否 | 屏蔽模型目录与 `skill` 工具 |
| `user-invocable` | 否 | 屏蔽人类 `/name` 命令 |
| `metadata` | 否 | 任意对象 |

旧键（`disableModelInvocation` 等 camel 变体）出现即报错；布尔接受 true/false/yes/no/on/off/1/0，非法值整条丢弃。

接口（`skill/src/index.ts`）：`SkillSummary`（:57-74）、`SkillCandidate` = Summary + `rank` + `locator` + `metadata`（:77-84）、`SkillDefinition` = Summary + `content` + `metadata`（:87-92）。

### 2.2 发现 / 加载 / 注入链路

- **根目录与优先级**（`skill-filesystem/src/index.ts:245-265`）：project-dsh(`.dsh/skills`)=100 → project-agents(`.agents/skills`)=200 → custom=300 → user-dsh(`~/.dsh/skills`)=400 → user-agents(`~/.agents/skills`)=500 → bundled=600；项目根 = 最近的 `.git` 祖先（:945-955）。
- **合并**：registry 为 host + per-scope 分层，读取时 global + scope 链，**最近层同名直接覆盖**；同层内按 `rank → providerOrder → localOrder` 排序去重（`skill/src/index.ts:567-582, 807-811`）。
- **缓存**：key = `{cwd, scopeChain, revision}`（:643-645），默认 128 条 LRU；provider `list()` 失败只跳过并标记为不可缓存（:604-607）。
- **热重载**（`skill-filesystem/src/index.ts:288-601`）：chokidar `depth:1` 监听已存在根；不存在的根用 `fs.watchFile` 从最近存在祖先逐段探测（:456-470）；首方 `write`/`edit` 通过 `fs/observed` 同步失效；事件合并为每个 microtask 批一次（:583-592）。
- **catalog 与 body 生命周期分离**：`list()` 只读 frontmatter，每次 `get()` 重读文件——正文改动无需版本号或缓存失效。
- **注入提示词**：**不是** system prompt section，而是 `agent/pre-step` 注入的 user-role `<system-reminder>` 消息（`tool-skill/src/index.ts:254-277`），内含 `<available_skills>` 的 `- \`name\`: description` 列表；description 归一化并截断到 `catalogDescriptionMaxLength`（默认 500）。目录身份用 entries 的 sha256 digest 判定，变更时整体追加替换消息、清空时追加空目录。

### 2.3 触发机制：工具 + 提示词两者都有

1. **工具调用（渐进披露）**：注册 `skill` 工具（`tool-skill/src/index.ts:81-161`），参数仅 `{ name }`；加载后返回 `<skill_content>`。目录只给 name+description，调用后才载入正文。
2. **提示词手势**：用户 `/name`，仅扫描 `source.kind === 'user'` 的消息，注入 user-role instructions（:177-204，`SKILL_GESTURE` :409-430）；这是 `disable-model-invocation` 技能的唯一入口。
3. **目录本身**即第三条注入路径。

### 2.4 关键机制清单

- **能力缝合三角色**：Definition(`ctx.skills`) / Provider(`skill-filesystem`, `skill-badge`) / Consumer(`tool-skill`)，互不越界（`packages/skill/README.md:25-30`）。
- **skill 按 agent scope 分层**：preset 常驻挂载决定该 agent 可见的 skill 集合（`docs/subsystems/skills.md:13`）。
- **digest 身份基于 entries 而非渲染文本**，避免 framing 触发重发（`tool-skill/README.md:73`）。
- **无 Skill↔Subagent 绑定字段**：关系仅是子代理加入父的 preset composition，从而继承同一 scope 的 skill layer。
- `skill-badge`：内置 `dsh-badge` 技能（"powered by dsh" 徽章），默认 disabled，随包提供 Markdown 片段与 PNG。

---

## 三、MCP 域（`packages/mcp/` 两个子包）

### 3.1 配置模型

- 每个 server 一个 `mcp-client` 实例，配置写在 cordis.yml/patch（`mcp-client/README.md:34-53`）。
- `Config` union：`transport: 'stdio' | 'streamable-http'`；字段含 `serverName`（`[A-Za-z0-9_-]{1,32}`）、command/args/env/cwd、url/headers、`toolCallTimeoutMs`(60000)、`maxInstructionBytes`(32768)、`failOnStartupError`(false)、`reconnect`。
- `serverName` 按 registration scope 保留（WeakMap），重复即在该实例加载时报错。
- stdio 传输走 `scrubbedParentEnv()`（`transport.ts:31-46`）：剔除含 KEY/PASSWORD/SECRET/TOKEN 与 `DSH_*` 的环境变量。

### 3.2 连接与生命周期（`connection.ts`）

- `connectGeneration` 建立 client 并同步工具（:257-343）；断开经 `onclose` 触发重连（:279-285）。
- **指数退避** 500ms→30s、`maxAttempts` 10，超限即注销全部工具并停连（:41-46、:211-245）；连接稳定超过 maxDelayMs 则重置预算（:222）。
- 所有 sync 串行化避免双重 dispose（:168-177）；关闭旧 generation 有 5s 超时（:54、:200-209）。

### 3.3 工具注入与命名（`tools.ts`）

- 命名 `mcp__<serverName>__<rawName>`（:81-87）：非法字符换 `_`；超 64 字符则截断并附 12 位 SHA-256；**raw name 只用于线上 `tools/call`，public name 不回解析**。
- 冲突：同 server 内重名 tool 报错（:126-130）；注册冲突**整代回滚**，绝不产生半套工具（:145-160）。
- schema：`inputSchema` 直接作 `parameters`（:234）；`outputSchema` 需通过 `assertSupportedJsonSchema`，否则降级 JsonValue（:185-193）。
- 动态变更：SDK 侧 `listChanged.tools.onChanged → refreshTools` 触发重新同步（:263-269、:296-304）。

### 3.4 其他能力与边界

- **MCP resources 支持**：`mcp-resources` 提供 3 工具（列表/模板/读取）；server 名须显式传入、按 caller scope 解析；可见 server 名进 system prompt section。
- **server instructions**：按 server 进 `mcp:<server>` prompt section（`server-context.ts:32-39`）。
- **不支持**：MCP prompt 模板（`mcp-client/README.md:209`）、资源订阅/更新通知（`mcp-resources/README.md:124`）。
- **审批关系**：MCP 工具与原生工具注册在同一 `ctx.tools`、走同一流水线；审批由 `tools/pre-execute` 判 `ask` 再经 `ctx.get('approval')` 解决。MCP bridge **自身不发 ask**，故默认不被审批拦截；要门禁需在 guard 里按工具名（`mcp__...`）显式 ask。

---

## 四、不确定点（供后续复核）

- `computer-use-*` 的模型可见工具名（provider 运行时自报，目录不覆盖）；MCP `publicToolName()` 的截断/清洗细节仅确认了前缀规则。
- 工具目录按默认/指定 config boot（如 `todo_write.allowParallelInProgress`、`tool-subagent.toolName` 默认名），实际部署可能改名或换 schema 分支。
- 工具 schema 细节：**2026-09-18 已补录为逐工具全清单**（见 §五 附录，逐名 72 条）；`ptc.ts` / `json-schema.ts` / SDK 生成只看了接口未展开实现。
- Skill 正文无大小上限（provider 可返回超大正文）；MCP 配置是否存在 composition 文件以外的运行时写入路径未穷尽。

---

## 五、附录：逐工具全清单（2026-09-18 补录）

> 来源：`docs/tool-catalog.md`（生成器 `scripts/gen-tool-catalog.ts` **真实启动每个工具插件**读取 `ctx.tools.schemas()` 产出——运行时 spread enum / 拼接描述 / 配置化名无法静态推知；完整性守卫 `assertManifestComplete` :668-678、CI `--check` :810-838）+ 各包 README 抽查（opt-in / 条件注册说明）。
> 口径：正文 §1.2 为包级清单，本附录为逐工具级（附录逐名合计 **72 条**，同名多载体分别计数——`bash`/`pwsh` 各两个包、`list_agents`/`send_message`/`interrupt_agent` 两个来源）；**去重后唯一工具名 67 个**——与正文 §四 原「67 个工具」口径一致（彼为唯一名计数，本条为逐条计数）。

### 5.1 主表

| 域 | 工具名 | 所属包 | 一句话职责 | 关键参数 / 契约 |
|---|---|---|---|---|
| 文件 | `read` | tool-fs | 读 UTF-8 文本并加行号 | `file_path`；`offset`(默认1)/`limit`(默认2000) |
| 文件 | `write` | tool-fs | 创建或整文件覆盖 | `file_path`+`content` |
| 文件 | `edit` | tool-fs | 字面量替换编辑 | `old_string` 须唯一，除非 `replace_all: true` |
| 文件 | `read_image` | tool-fs | 读图片并回传图像本身 | **仅当 `ctx.attachments` 存在才注册**；路由模型须声明图像输入 |
| 文件 | `str_replace_editor` | tool-str-replace-editor | view/create/str_replace/insert 四合一编辑器 | `command`+`path` 必填；`old_str` 须唯一 |
| 文件 | `present` | tool-present | 声明交付物文件 | `files[].path` 须已存在；须在最终回复前调用 |
| 搜索 | `glob` | tool-fs-search | 按 glob 找文件（不回目录） | `pattern`；>100 时采样并转存完整列表 |
| 搜索 | `grep` | tool-fs-search | ripgrep 搜内容 | `pattern`；`include` 仅单 glob，前 250 条内联 |
| 命令/终端 | `bash` | tool-bash | 一次性 `bash -c` | `command`+`description`；`run_in_background` 可被 `enableRunInBackground=false` 整体移除；sandbox |
| 命令/终端 | `pwsh` | tool-pwsh | 一次性 `pwsh -Command` | 同上，**无 sandbox 控制** |
| 命令/终端 | `bash` | tool-bash-persistent | 持久 bash（PTY，状态跨调用） | 仅 `command`；由部署提供 PTY 后端 |
| 命令/终端 | `pwsh` | tool-pwsh-persistent | 持久 pwsh（Windows 对应） | 仅 `command` |
| 命令/终端 | `terminal_open` | tool-terminal | 打开持久终端会话 | **opt-in** |
| 命令/终端 | `terminal_list` | tool-terminal | 列终端会话 | opt-in |
| 命令/终端 | `terminal_read` | tool-terminal | 读终端输出 | opt-in |
| 命令/终端 | `terminal_send` | tool-terminal | 向终端发送输入 | opt-in；支持 `run_in_background`；SIGKILL 被拒 |
| 命令/终端 | `terminal_close` | tool-terminal | 关闭终端会话 | opt-in |
| 命令/终端 | `terminal_signal` | tool-terminal | 向终端发信号 | opt-in |
| 待办 | `todo_write` | tool-todo | 全量替换任务清单 | **`allowParallelInProgress` 必填无默认**（目录取 `true`） |
| 计划 | `exit_plan_mode` | plan-mode | 提交计划待批准并退出 plan 模式 | `plan` 必填；非 plan 模式调用被拒 |
| 交互 | `ask_user_question` | tool-ask-user | 向用户提问/给选项 | `questions[].id`+`question` 必填；**阻塞至人工回答**（全链路见 [02-dsh提问工具设计基线](../2026-09-18-对话区对齐dsh/02-dsh提问工具设计基线.md)） |
| 子代理 | `subagent` | tool-subagent | 委派自包含任务给子代理 | `prompt` 须自包含；`run_in_background`；**工具名是 load-time `toolName` 配置**（默认 `subagent`，别名 `subagent_fork`） |
| 子代理 | `list_subagent_models` | tool-subagent | 发现子代理可用 LLM 路由 | `provider`/`model` 逐级下钻 |
| 子代理 | `send_message` | tool-subagent-control | 向可续跑子代理发消息 | 仅 depth-1；**全局仅注册一次** |
| 子代理 | `interrupt_agent` | tool-subagent-control | 打断子代理当前轮 | 同上 |
| 子代理 | `list_agents` | tool-subagent-control | 列可续跑子代理 | `scope: children\|descendants` |
| 子代理 | `spawn_teammate` | experimental-tool-agent-team | 建队友 | **实验性，dsh-base 默认禁用**；仅 Team Lead/teammate 作用域 |
| 子代理 | `team_task_create` | experimental-tool-agent-team | 建共享任务 | 同上 |
| 子代理 | `team_task_get` | experimental-tool-agent-team | 读共享任务 | 同上 |
| 子代理 | `team_task_list` | experimental-tool-agent-team | 列共享任务 | 同上 |
| 子代理 | `team_task_update` | experimental-tool-agent-team | 更新共享任务 | 同上 |
| 子代理 | `wait_agent` | experimental-tool-agent-team | 等待队友 | 同上 |
| 子代理 | `list_agents` | experimental-tool-agent-team | 列队友 | 同上 |
| 子代理 | `send_message` | experimental-tool-agent-team | 给队友发消息 | 同上 |
| 子代理 | `interrupt_agent` | experimental-tool-agent-team | 打断队友 | 同上 |
| 后台作业 | `job_list` | tool-jobs | 列后台作业 | 与 kind 无关（bash/PTY/subagent 共用） |
| 后台作业 | `job_output` | tool-jobs | 读作业输出 | 支持 `wait`/`timeout_ms` |
| 后台作业 | `job_kill` | tool-jobs | 杀作业 | 同上共用 |
| 目标 | `create_goal` | tool-goal | 创建跨轮持久目标 | — |
| 目标 | `get_goal` | tool-goal | 读目标 | — |
| 目标 | `update_goal` | tool-goal | 更新目标（暂停/恢复/完成/阻塞） | edit/pause/resume 需**人类根权限**；blocked 默认需 3 轮 |
| 定时 | `schedule_create` | schedule | 创建会话内提醒 | **opt-in**；`after_seconds`/`at`/`every_seconds`(≥300) 三选一；会话本地投递 |
| 定时 | `schedule_list` | schedule | 列提醒 | opt-in |
| 定时 | `schedule_delete` | schedule | 删提醒 | opt-in |
| 技能 | `skill` | tool-skill | 加载技能完整说明 | `name` 必填（渐进披露） |
| 会话检索 | `session_search` | tool-session-query | 搜历史会话 | **只读、opt-in**；结果按调用会话授权 |
| 会话检索 | `session_trace` | tool-session-query | 读会话谱系 | 同上 |
| 会话检索 | `session_event_read` | tool-session-query | 读单会话事件 | 同上 |
| 会话检索 | `session_event_search` | tool-session-query | 搜单会话事件 | 同上 |
| 会话检索 | `session_event_trace` | tool-session-query | 追踪单会话事件 | 同上 |
| 网络 | `web_search` | tool-web | 网络搜索 | `queries` 1–4 必填 |
| 网络 | `web_fetch` | tool-web | 抓取 URL 转文本 | `url` 必填 |
| 工作流 | `workflow` | tool-workflow | JS 脚本大规模编排子代理 | `script`+`meta` 必填；钩子 `agent/pipeline/parallel/phase/log`；前台执行 |
| 工作流 | `ralph` | tool-ralph | 固定前台 Ralph 循环，每轮新子代理 | `objective` 必填；仅人类显式要求 |
| MCP 资源 | `list_mcp_resources` | mcp-resources | 列 MCP 服务器资源 | `server` 必填 |
| MCP 资源 | `list_mcp_resource_templates` | mcp-resources | 列资源模板 | `server` 必填 |
| MCP 资源 | `read_mcp_resource` | mcp-resources | 读资源 | `server` + `uri` |
| 实验/扩展 | `lsp` | tool-lsp | 语言服务器代码导航 | `operation`+`file_path`+`line`+`character`；无 provider 返回 `LSP_UNAVAILABLE` |
| 实验/扩展 | `cordis_define` | tool-cordis | 动态定义 Cordis 包 | **opt-in，无任何 shipped bundle 挂载**；缺 host-runner 永不激活 |
| 实验/扩展 | `cordis_run` | tool-cordis | 运行动态包 | 同上 |
| 实验/扩展 | `cordis_stop` | tool-cordis | 停止动态包 | 同上 |
| 实验/扩展 | `cordis_undefine` | tool-cordis | 注销动态包 | 同上 |
| 实验/扩展 | `cordis_inspect_list` | tool-cordis | 列动态包 | 同上 |
| 实验/扩展 | `cordis_inspect_query` | tool-cordis | 查动态包 | 同上 |
| 实验/扩展 | `cordis_inspect_self` | tool-cordis | 自检 | 同上 |
| 实验/扩展 | `stagehand_navigate` | browser-use-stagehand-native | 浏览器导航 | **公开实验包，opt-in** |
| 实验/扩展 | `stagehand_act` | browser-use-stagehand-native | 浏览器操作 | 同上 |
| 实验/扩展 | `stagehand_observe` | browser-use-stagehand-native | 浏览器观察 | 同上 |
| 实验/扩展 | `stagehand_extract` | browser-use-stagehand-native | 浏览器提取 | 同上 |
| 实验/扩展 | `stagehand_screenshot` | browser-use-stagehand-native | 浏览器截图 | 同上 |
| 实验/扩展 | `stagehand_tabs` | browser-use-stagehand-native | 标签页管理 | 同上 |
| 编排 | `run_code` | core/tools（`@deepseek-ai/dsh-tools`） | 执行 TS 程序批量调用工具 | `code`+`description` 必填；`sandbox_permissions` 可提权；**仅 `mode: ptc\|both`**（保留传输，默认 native 模式不出现） |

### 5.2 统计

- **工具总数 72 条**（拆到单个名字计；去重后唯一工具名 **67 个**——同名多载体 5 组：`bash`/`pwsh` 各两个包、`list_agents`/`send_message`/`interrupt_agent` 各两个来源）；目录章节 28 个 = **23 个 `tool-*` 包 + 5 个非 tool-* 载体**（`mcp-resources` / `browser-use-stagehand-native` / `core/tools` / `plan-mode` / `schedule`）。
- **默认禁用 / opt-in 6 个包、共 36 条**：tool-cordis(7) · tool-terminal(6) · tool-session-query(5) · schedule(3) · stagehand(6) · agent-team(9)；其中带 `experimental` 前缀的 2 个包共 15 条。
- **条件性注册 1 条**：`run_code` 仅 `mode: ptc|both`。
- **参数级 opt-in**：`read_image`（需 attachments 能力）· `run_in_background`（可被配置整体移除）· `allowParallelInProgress`（必填无默认）。

### 5.3 目录未体现的三类动态注册

1. **MCP 工具**：客户端运行时发现服务器工具，以 `mcp__<serverName>__<rawName>` 动态注册并携带上游原始 JSON-Schema，重同步整体替换（`packages/mcp/mcp-client/README.md:75,164`）。
2. **computer-use 自报工具**：computer-use 服务本身不经手工具，由已注册 provider 各自提供；同一时刻仅一个 provider 生效（`packages/computer-use/computer-use/README.md:12`；`docs/subsystems/computer-use.zh.md:16,20,28`）。
3. **subagent 结构化输出**：仅当所选子代理 provider 声明 `outputSchema` 能力时，委派工具 schema 才出现结构化 `outputSchema`（受强制 JSON-Schema 子集约束）（`docs/subsystems/subagent.zh.md:31,78-82,307-312`；`packages/subagent/tool-subagent/README.md:49-63,214`）。

### 5.4 关键证据索引

- `docs/tool-catalog.md:12-45`（包→工具名映射总表）、`:46-2612`（逐工具 schema）。
- `scripts/gen-tool-catalog.ts:201-641`（启动清单 `TOOL_PACKAGES`）、`:668-678`（完整性守卫）、`:709-741`（逐包 boot 采 schema）、`:810-838`（CI `--check`）。
- opt-in / 禁用说明：`docs/tool-catalog.md:19,26,32,34,38,42`；`packages/experimental/browser-use-stagehand-native/README.md:12`；`packages/extensions/tool-cordis/README.md:28`；`packages/todo/tool-todo/README.md:36`。