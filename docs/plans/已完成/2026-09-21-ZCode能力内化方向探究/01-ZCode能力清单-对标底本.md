# ZCode 能力清单（对标底本）

> status: 已完成
> 快照：`.独立项/【参考项】ZCode/`（本地只读；Apache-2.0；apps/zcode-cli 0.16.9；Node 24.14.0 / pnpm 10.33.2）
> 取证：2026-09-21 只读四路探索；证据路径相对快照根。**口径：只收 Agent 能力面**；工作台产品面与商业面见 §三。
> 上游背景：09-16 已对 dsh 做过同题（[02-提取融合方向](../2026-09-16-deepseek-harness-方向探究/02-提取融合方向.md)）；本清单换参照项为 ZCode——**它更像产品（工作台），dsh 更像框架**，能力面因此更宽（协议/权限/工作流/多端）。

---

## 零、一句话

ZCode = 完整 AI 编程工作台：Agent 运行时（`apps/zcode-cli`，1342 个 TS 文件 / 28.7 万行）+ 三壳（Electron / Web / TUI）+ 宿主协议 V4 + 插件体系。本方向取其「Agent 能做什么、机制怎么立」的部分。

---

## 一、能力族（C1-C10）

### C1 主循环与 turn 机

| 能力 | 要点 | 证据 |
|---|---|---|
| 显式 turn 状态机 | turn 三态机 + turn-state 归约 | `apps/zcode-cli/packages/core/src/agent/turn-machine.ts`、`turn-state.ts` |
| turn 主循环四件 | loop / model / tools / stop 分文件 | `core/src/runtime/methods/turn-{loop,model,tools,stop}.ts` |
| **目标续跑（长程不硬停）** | target-continuation-loop：不用工具次数硬停止；边界由 token/context、取消、权限、超时、截断、retry 上限承担 | `core/src/runtime/methods/target-continuation-loop.ts` |
| 消息历史派生 | message-history 派生而非可变历史 | `core/src/agent/message-history.ts` |
| 子代理 | Agent/Task 工具 + SendMessage/RespondToCoordinator/escalate/submit_result | `core/src/tool/handlers/index.ts`（builtInTools） |
| 计划模式 | EnterPlanMode / ExitPlanMode 工具 | 同上 |

### C2 工具系统

| 能力 | 要点 | 证据 |
|---|---|---|
| **工具元数据契约** | `inputSchema`/`outputSchema`/`strict`/`aliases`/`providerVisible` + `readOnly`/`destructive`/`concurrentSafe`/`requiresUserInteraction`/`timeoutMs`/`maxOutputBytes`/`sideEffectScope(none\|workspace\|git\|network\|system\|session)`/`riskLevel`/`needsApproval`/`stopTurnOnSuccess` | `core/src/tool/types.ts` |
| 注册-执行-调度三层 | registry / executor / scheduler 分离 | `core/src/tool/{registry,executor,scheduler}.ts` |
| 内置工具 40+ | Read/Write/Edit、Bash（含后台任务）、Glob/Grep、WebFetch/WebSearch、Todo×2、Cron×4、OffPeak×2、PlanMode、AskUserQuestion、SendMessage、子代理族、ReadSessionContext、Skill、Node REPL(js)、Workflow 族（Create/Amend/Save/Eval/List/Runs/Resume/Question）、ListModels | `core/src/tool/handlers/index.ts` |
| 大结果不灌上下文 | 大体积工具结果落盘 / artifact，只回摘要与引用 | `apps/zcode-cli/AGENTS.md`（工具与副作用契约节） |

### C3 权限与审批

| 能力 | 要点 | 证据 |
|---|---|---|
| **协作模式五档** | `plan \| build \| edit \| yolo \| auto`（auto 未实现=deny） | `core/src/permission/service.ts`、`contracts/src/interfaces/session.port.ts` |
| **判定顺序契约** | requiresUserInteraction → alwaysAsk（**不可被模式绕过**）→ yolo → auto(deny) → disallowedTools → 项目 deny/ask → plan → 项目 allow → 预批 WebFetch → workflow 草稿 → allowedTools → edit/build | `core/src/permission/service.ts:97` |
| 会话级授权 | 会话内 always allow 规则随实例回收；`permission-full-access` 持久化仓储 | `core/src/tool/executor/permission-{flow,capability,rules}.ts`、storage repositories |
| **三型交互请求** | `pendingInteraction.kind = permission \| userInput \| workspaceHookReview`；载荷含 toolCallId/toolName/summary/options(allowOnce\|allowAlways\|deny\|custom)/fullAccessOption/freeText | `packages/shared/src/zcode-protocol-v4/`（快照投影） |
| 工具级审批声明 | needsApproval / riskLevel 由权限系统读取，**不依赖调用点猜测** | `core/src/tool/types.ts` |

### C4 会话与状态

| 能力 | 要点 | 证据 |
|---|---|---|
| 本地会话库 | `~/.zcode/cli/db/db.sqlite`（node:sqlite DatabaseSync）+ 版本化 migrations | `apps/zcode-cli/packages/adapters/src/storage/session-store/` |
| 仓储面 | sessions / messages / entries / inputs / todos / usage / input-history / local-settings / permission-full-access / dwf-journal / script-workflow-* | 同上 `repositories/` |
| **分叉 / 回滚 / 检查点** | RewindScope = `conversation \| workspace \| both`；策略 `active_chain \| file_only \| fork_required \| unavailable`；session-fork 1487 行 + workspace-fork + workspace-checkpoints + file-rewind | `core/src/runtime/methods/{session-fork,workspace-fork,workspace-checkpoints,rewind*,file-rewind,resume}.ts`、`contracts/src/rewind/index.ts` |
| 输入准入 | busy/running 输入由 `CommandInbox` **串行 admission**（六态） | `AGENTS.md`（进程、协议与远程控制节） |
| **traceId 全链** | traceId 位于 sessionId 之上；sessionId/turnId/messageId/toolCallId/spanId/parentSpanId 为结构化子标识；无法关联者视为不可观测 | `apps/zcode-cli/AGENTS.md`（会话、配置与可观测性节） |

### C5 长程与自动化

| 能力 | 要点 | 证据 |
|---|---|---|
| 目标续跑 | 见 C1（target-continuation-loop） | — |
| 定时任务 | Cron 四工具（Create/List/Update/Delete）+ OffPeak 二工具 | `core/src/tool/handlers/index.ts` |
| 后台任务 | Bash 后台任务 + TaskOutput/TaskStop | 同上 |
| 工作流 | CreateWorkflow/AmendWorkflow/SaveWorkflow/EvalWorkflowSnippet + ListWorkflowRuns/GetWorkflowRun/ResumeWorkflowRun/ResolveWorkflowQuestion | 同上 |
| 工作流沙箱 | dynamic-workflow（纯库：类型检查/图分析）+ runtime（子进程 + `vm.createContext` + NDJSON） | `apps/zcode-cli/packages/{dynamic-workflow,dynamic-workflow-runtime}/` |

### C6 提示与上下文

| 能力 | 要点 | 证据 |
|---|---|---|
| 指令链注入 | AGENTS.md / `.agents Protocol` 兼容；指令链有字节预算与「先省宽泛、最后截断具体」规则 | `bootstrap`、`AGENTS.md` |
| 技能渐进加载 | SKILL.md + frontmatter(name/description/when_to_use/license/metadata)，经 Skill 工具按需加载 | `adapters/src/skills/{index,roots,scan}.ts` |
| 自动压缩 | token/context 上限触发 compact（长程任务的资源边界承担者） | `apps/zcode-cli/AGENTS.md`（工作规范节） |
| 上下文可观测 | 模型请求 / context 组成 / token·cost / tool call / I/O / 权限判断 / 重试 / 队列积压均有调试入口 | 同上（可观测性节） |

### C7 扩展体系

| 能力 | 要点 | 证据 |
|---|---|---|
| 插件清单 | `plugin.json` 字段：skills / commands / agents / hooks / mcpServers / lspServers / settings / outputStyles / userConfig / dependencies；兼容 `.claude-plugin` / `.codex-plugin` / `.cursor-plugin` 目录 | `contracts/src/plugins/index.ts:141-161` |
| **限制（关键）** | **不能注册进程内工具实现、无 UI 槽位**；领域工具唯一通道 = MCP | 同上 + 四路探索结论 |
| hooks | SessionStart / UserPromptSubmit / PreToolUse / PermissionRequest / PostToolUse / PostToolUseFailure / Stop；**工作区 hook 信任**按「声明摘要」审查，声明变化即失效 | `NOTICE.md` §一、`adapters/src/plugins/hook-sources.ts` |
| MCP | stdio / http / sse；工具暴露为 `mcp__<server>__<tool>`；支持 OAuth | `README.md`、`core` 工具注册链 |
| 子代理 / 命令 | markdown agents + commands（插件或用户目录） | `contracts/src/plugins/index.ts` |
| 插件商店 | official marketplace（内置 + CDN sha256 zip）+ 个人来源（git/GitHub/URL/目录/inline） | `CONTEXT.md`（领域词汇） |

### C8 模型接入

| 能力 | 要点 | 证据 |
|---|---|---|
| 三协议分派 | `config.api.type` → `anthropic-messages` / `openai-responses` / `openai-chat-completions` → `@ai-sdk/*` | `adapters/src/model/model-execution.ts:340-375` |
| Provider 注册表 | 注册/解析/配置 + Node 侧配置文件与内置 provider 同步 | `packages/provider/`、`packages/provider-node/` |
| 内置模板 11+ | zai/bigmodel（Anthropic 兼容）、anthropic、openai、deepseek、kimi、minimax、qwen、xai、openrouter、opencode-zen/go | `config/provider/zcode-builtin.json` |
| 推理档位 DSL | model-option-map（tokenizer/parser/compiler） | `packages/model-option-map/src/` |

### C9 宿主协议与呈现（V4）

| 能力 | 要点 | 证据 |
|---|---|---|
| 握手与双客户端语义 | hello/clientHello；`clientMode = desktop-continuous`（实时流）vs `web-remote-replayable`（快照+补洞） | `packages/shared/src/zcode-protocol-v4/` |
| 投影模型 | topic 订阅 + rows/delta/snapshot；物理帧分片（base64+crc32）；`v4/command` 信封 + ACK | 同上（46 文件 / 8927 行；另有 legacy 3717 行） |
| 传输 | stdio 严格 LF JSON 行（stdout 仅帧；日志走 stderr） | `packages/services/src/zcode-agent/zcodeStdioTransport.ts` |
| 三壳只是适配层 | Desktop（Electron）/ Web（React 19+Zustand）/ TUI（OpenTUI）——交互流程不得写死在单一前端 | `apps/zcode-cli/AGENTS.md` |

### C10 工程机器

| 能力 | 要点 | 证据 |
|---|---|---|
| **架构策略文件** | `architecture-policy.yaml`：modules（roots/layers/layerOrder/publicEntrypoints/owner/requires）+ 全局上限（maxFileLines 400 / maxContractLines 300 / maxPublicMethods 12 / forbidCycles / forbidDeepImports） | `architecture-policy.yaml` |
| 架构检查 | `pnpm architecture:check --changed`；`pnpm architecture:context <module-id>`（**模块阅读包**） | `scripts/architecture/architecture-check.mjs`、`AGENTS.md` |
| 基线新鲜度 | 开工前 `node scripts/check-workspace-freshness.mjs` | `AGENTS.md` |
| 死代码/依赖检查 | knip（未使用依赖与导出）；`dep:refs --list-exports <file>` | `knip.json`、`AGENTS.md` |
| 治理流程 | `.agents/skills/architecture-governance/SKILL.md`：先查边界 → 先写 spec → 明确单一 owner / 单一路径 → 改完再跑检查 | 同路径 |
| spec-first 与提交纪律 | 行为变更先写/更新 spec；独立小提交；中文注释写 bug 原因；如实报告验证结果 | 根 `AGENTS.md`、`apps/zcode-cli/AGENTS.md` |

---

## 二、值得单独标记的设计原则（跨族，多条可直接作为新内核的评审词汇）

1. **外部 I/O 边界收敛**：网络/文件/子进程/环境变量/终端/缓存/DB 全部收敛到 adapter；业务模块禁止直调 `fetch/fs/child_process/process.env`。
2. **错误是一等设计对象**：默认向上冒泡；只在可恢复/可转换/入口边界捕获；不吞错、不 `process.exit`、不按 message 判断流程（按稳定 code）。
3. **注册即效应**：一切注册可逆、可 dispose，有明确 owner。
4. **单一写入路径**：避免重复状态与多条写入路径；明确唯一所有者、事件顺序、幂等边界；不用超时掩盖同步问题。
5. **跨边界必校验 schema**：数据跨进程/存储/网络/插件/工具/LLM 边界时用可运行时校验的 schema，不只用 TS 类型。
6. **键盘优先、跨平台默认**：所有功能默认同时面向 Win/mac/Linux；路径/换行/终端能力检测有非交互退路。
7. **长程优先**：核心 loop 面向可持续运行的复杂任务，不以工具次数硬停止。

---

## 三、明确不纳入（负面清单）

| 类别 | 内容 | 理由 |
|---|---|---|
| 商业与账号面 | 登录/授权/套餐/订单/支付/额度/官方 Coding Plan 网关转发/主动反馈上传 | 与产品无关；且含外发行为（NOTICE §二） |
| 分发与更新面 | 插件商店 CDN、安装脚本、桌面自动更新、SEA 打包、release-it | 属工作台壳的发行机制 |
| 三壳与远控 | Electron Desktop、React Web、TUI、手机远控 relay、SSH/WSL 远端执行 | 本项目为 Tauri 桌面单壳；协议面按 C9 借鉴即可 |
| 遥测 | telemetry 包（含 electron sourceTitle 标签） | 与「不外传」自律冲突 |
| 占位与工具件 | `zcode-cua`（Computer Use 占位，调用即不可用）、`formal-proof`（行为状态空间枚举器）、`harness/remote`（SSH 测试容器） | 非能力面 |
| **其测试缺口** | 全仓仅 4 个 `*.test.ts`、无测试运行器配置 | 负面清单项：**只搬门禁哲学，不搬其缺口** |

---

## 四、未深挖（挂账，若纳入需补一轮取证）

| # | 项 | 说明 |
|---|---|---|
| U1 | 记忆机制 | 「独立 CLI 默认启用记忆」（分析已存会话、持久化记忆、后续任务复用）——实现细节未取证 |
| U2 | CommandInbox 六态 | 仅知「串行 admission」结论，六态定义未取 |
| U3 | Cron/OffPeak 的运行语义 | 调度器在哪些宿主可用、错过是否补跑（NOTICE 已提示不保证） |
| U4 | 会话「总结 / 标题 / 历史提取」辅助模型调用 | NOTICE §二提到，机制未取 |
