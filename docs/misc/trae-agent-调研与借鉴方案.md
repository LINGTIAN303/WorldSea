# Trae Agent（bytedance）调研与借鉴方案

> 调研日期：2026-08-30
> 调研对象：https://github.com/bytedance/trae-agent（main 分支，289 commits，12.1k star，MIT）
> 调研目的：为 WorldSea 的**步骤摘要 / 轨迹记录 / 工具协议 / 任务收口**四个议题找外部参照
> 关联文档：[Harness 工程差距调研](../plans/2026-08-30-Harness工程差距调研.md)（H1 三硬伤、H7 事件字段）

---

## 零、一句话结论

**Trae Agent 是一个「单 Agent + 线性 step 循环」的 Python CLI 型 SWE Agent，核心代码很轻（主循环 13KB），研究友好是卖点而非产品化。**

它在**循环控制**上明显弱于 WorldSea（WorldSea 有 `LoopController` 四件套 + 协作式取消 + 会话持久化），
但在三个点上值得抄：**完成判定三重钩子**、**工具输出协议**、**Lakeview 步骤摘要的工程手法**。

---

## 一、全景

### 1.1 定位与规模

- 技术栈：Python + `uv` 管理，CLI 入口 `trae-cli`，无 GUI、无服务端会话
- 论文：[arXiv 2507.23370](https://arxiv.org/abs/2507.23370)（Trae Agent: An LLM-based Agent for Software Engineering with Test-time Scaling）
- 定位声明：*"research-friendly design"* —— 用于研究 Agent 架构、做消融实验，不是做产品
- 规模：核心 `trae_agent/agent/base_agent.py` 仅 13.6KB，整个 `agent/` 目录 5 个文件

### 1.2 目录结构

```
trae_agent/
├── agent/
│   ├── agent.py            # 3.5KB  工厂/入口
│   ├── base_agent.py       # 13.6KB ★ 抽象主循环
│   ├── trae_agent.py       # 10.2KB ★ SWE 特化子类
│   ├── agent_basics.py     # 2.5KB  ★ 数据模型
│   └── docker_manager.py   # 10.8KB 容器生命周期
├── tools/
│   ├── base.py             # Tool / ToolCall / ToolResult / ToolExecutor
│   ├── bash_tool.py  edit_tool.py  json_edit_tool.py
│   ├── sequential_thinking_tool.py  task_done_tool.py
│   ├── ckg_tool.py + ckg/  # 代码知识图谱（Code Knowledge Graph）
│   ├── mcp_tool.py  docker_tool_executor.py
│   └── run.py              # shell 执行 + 输出截断
├── utils/
│   ├── llm_clients/        # openai/anthropic/doubao/azure/ollama/google/openrouter
│   ├── lake_view.py        # ★ Lakeview 步骤摘要
│   ├── trajectory_recorder.py
│   ├── config.py  mcp_client.py  legacy_config.py
│   └── cli/                # Rich 控制台渲染
├── prompt/                 # 系统提示词
evaluation/  server/  docs/
```

### 1.3 核心执行循环

`trae_agent/agent/base_agent.py` — `execute_task()`：

```python
while step_number <= self._max_steps:
    step = AgentStep(step_number=step_number, state=AgentStepState.THINKING)
    try:
        messages = await self._run_llm_step(step, messages, execution)
        await self._finalize_step(step, messages, execution)   # 落轨迹 + 刷 CLI
        if execution.agent_state == AgentState.COMPLETED:
            break
        step_number += 1
    except Exception as error:
        execution.agent_state = AgentState.ERROR
        step.error = str(error)
        await self._finalize_step(step, messages, execution)
        break
```

`_run_llm_step()` 的分支是整个 Agent 的决策核心：

```python
if self.llm_indicates_task_completed(llm_response):      # ① 模型是否声明完成
    if self._is_task_completed(llm_response):            # ② 外部客观校验
        execution.agent_state = AgentState.COMPLETED
        execution.final_result = llm_response.content
        execution.success = True
        return messages
    else:
        execution.agent_state = AgentState.RUNNING
        return [LLMMessage(role="user", content=self.task_incomplete_message())]  # ③ 驳回
else:
    return await self._tool_call_handler(llm_response.tool_calls, step)
```

### 1.4 数据模型（`agent/agent_basics.py`）

| 类型 | 字段 |
|---|---|
| `AgentStep` | `step_number / state / thought / tool_calls / tool_results / llm_response / reflection / error / extra / llm_usage` |
| `AgentExecution` | `task / steps / final_result / success / total_tokens / execution_time / agent_state` |
| `AgentStepState` | `thinking → calling_tool → reflecting → completed \| error` |
| `AgentState` | `idle / running / completed / error` |

**注意：扁平 step 列表，无轮次概念。** 一次 step = 一次 LLM 调用 + 其引发的工具调用。
对比 WorldSea 的 `Turn → segments` 三层（见 [turnModel.ts](../../packages/shared-composables/src/agent/turnModel.ts)），粒度粗一档。

LLM 层模型（`utils/llm_clients/llm_basics.py`）：

```python
@dataclass
class LLMMessage:
    role: str
    content: str | None = None
    tool_call: ToolCall | None = None      # 单工具调用
    tool_result: ToolResult | None = None  # 单工具结果

@dataclass
class LLMResponse:
    content: str
    usage: LLMUsage | None = None
    model: str | None = None
    finish_reason: str | None = None
    tool_calls: list[ToolCall] | None = None
```

> 对比 WorldSea `OrchestratorMessage`（`crates/agent-kernel/src/types.rs:74-88`）：
> `role / content / tool_calls: Vec<ToolCall> / tool_call_id: Option<String> / meta: Option<HashMap>`。
> WorldSea 用**数组 + call_id 配对**，trae 用**单槽位**。数组模型支持并行工具调用，trae 的单槽位是其短板。

---

## 二、深挖 A：Lakeview（步骤摘要）

### 2.1 它解决什么问题

长任务跑 200 步，CLI 上刷了满屏工具调用，人看不懂"现在在干嘛"。Lakeview 每步额外调 LLM，产出一句**人话摘要**。

### 2.2 实现机制（`utils/lake_view.py`）

每步**两次独立 LLM 调用**（`reuse_history=False`，无状态单次调用，`temperature=0.1`）：

| 调用 | 提示词 | 输入 | 输出 |
|---|---|---|---|
| `extract_task_in_step` | `EXTRACTOR_PROMPT` | 前一步 + 本步（不含全轨迹） | `<task>≤10 词</task><details>≤30 词</details>` |
| `extract_tag_in_step` | `TAGGER_PROMPT` | 全轨迹 `<step id=N>` + `<current_step>` | `<tags>A,B</tags>` |

**双粒度输出设计**（关键）：
- `<task>`：泛化，**刻意剥离 bug 细节**，≤10 词 → 给人快速扫读
- `<details>`：补具体细节，≤30 词 → 给人定位

8 类标签：`WRITE_TEST / VERIFY_TEST / EXAMINE_CODE / WRITE_FIX / VERIFY_FIX / REPORT / THINK / OUTLIER`，各带一个 emoji。

### 2.3 四个值得抄的工程手法

1. **assistant 预填（prefill）引导格式**
   ```python
   LLMMessage(role="assistant", content="Sure. Here is the task the agent is performing: <task>The agent")
   ```
   把开头替模型写好，模型只需续写，格式命中率大幅提升。

2. **硬重试 + 格式校验，失败降级为空**
   ```python
   retry = 0
   while retry < 10 and ("</task>" not in content or "<details>" not in content ...):
       retry += 1
       llm_response = self.lakeview_llm_client.chat(...)
   if "</task>" not in content ...:
       return "", ""      # 降级，绝不抛异常打断主流程
   ```
   摘要失败**永不阻塞主循环**——这是辅助功能的正确姿态。

3. **长度闸门**
   ```python
   if len(steps_fmt) > 300_000:
       return []   # 轨迹太长，直接放弃打标
   ```

4. **摘要输入只喂「前一步 + 本步」，不喂全轨迹**
   摘要调用成本控制住了；打标调用才用全轨迹（因为分类需要上下文）。

### 2.4 成本

**每步 2 次额外 LLM 调用**。默认 `enable_lakeview: true`。
对 SWE-bench 那种"一个任务 200 步、离线跑批"能接受；
**对 WorldSea 的交互式长会话（默认 `max_iterations=25`，可到 `max_turns=100`）不可接受**——延迟与成本翻倍。

### 2.5 对位 WorldSea

| 维度 | Trae Lakeview | WorldSea 现状 |
|---|---|---|
| 动作摘要 | LLM 生成自然语言 `task` + `details` | `ActionSegment.label` = 工具名（`turnModel.ts:62`），**无自然语言摘要** |
| 分类 | LLM 打 8 类标签 | `ActionRowKind`（`search/terminal/file/command/tool/other`）——**由工具名在归约时静态推导**（`turnModel.ts:64`） |
| 渲染 | CLI 一行文本 | 动作行段默认折叠，点击展开 args + result |

**结论：WorldSea 的 `rowKind` 静态推导比 LLM 打标更快更省，是对的。缺口在「自然语言任务摘要」——用户折叠状态下看到的是 `edit_file`，而不是「正在修复登录校验的空指针」。**

**建议（需拍板，见 §6）**：只抄 §2.3 的**工程手法**（prefill / 硬重试降级 / 长度闸门），
不抄"每步都调 LLM"。落地形态：仅长任务 / 编排模式启用，且必须用独立小模型。

---

## 三、深挖 B：TrajectoryRecorder

### 3.1 双轨记录（`utils/trajectory_recorder.py`）

```python
self.trajectory_data = {
    "task": "", "start_time": "", "end_time": "",
    "provider": "", "model": "", "max_steps": 0,
    "llm_interactions": [],   # 轨道一：每次 LLM 调用的完整出入参
    "agent_steps": [],        # 轨道二：每个 step 的状态/工具/结果
    "success": False, "final_result": None, "execution_time": 0.0,
}
```

- **轨道一 `record_llm_interaction`**：timestamp + 完整 input_messages + response（content/finish_reason/usage **含 cache_creation / cache_read / reasoning token**）+ tools_available
- **轨道二 `record_agent_step`**：step_number + state + llm_messages + llm_response + tool_calls + tool_results + reflection + error
- 挂载方式：`set_trajectory_recorder()` **同时挂到 agent 和 llm_client**，保证 LLM 原始交互不丢
- `update_lakeview(step_number, summary)`：事后回填摘要到对应 step

### 3.2 落盘策略：写穿式

**每次 `record_*` 都调 `save_trajectory()` 全量重写 JSON 文件**（`json.dump(indent=2)`）。

- 优点：进程崩溃不丢数据
- 缺点：O(n²) 写盘，200 步任务要重写 200 次全量文件

### 3.3 对位 WorldSea

| 维度 | Trae | WorldSea |
|---|---|---|
| 载体 | 事后 JSON 文件（`trajectories/trajectory_YYYYMMDD_HHMMSS.json`） | SQLite `messages` 表 `(session_id, seq, msg_json)` |
| 可恢复性 | **不可恢复**，仅事后分析 | **可回源重建**（这是 WorldSea 的强项） |
| 记录粒度 | LLM 出入参 + step 状态双轨 | `OrchestratorMessage` + `meta`（`thinking` 等扩展位） |
| 用途 | 调试 / 研究 / 消融实验 | 会话持久化 + 刷新后重建 |

**结论：这块 WorldSea 明显更强，无借鉴点。**
唯一可提的：Trae 的 usage 统计细分到 `cache_creation / cache_read / reasoning` 三类 token，
WorldSea 目前只累 `input_tokens / output_tokens`（`crates/agent-kernel/src/agent/mod.rs:866-870`）。
若要上成本面板，可补这三类。

---

## 四、深挖 C：工具协议

### 4.1 Tool 抽象（`tools/base.py`）

```python
class Tool(ABC):
    @abstractmethod def get_name(self) -> str
    @abstractmethod def get_description(self) -> str
    @abstractmethod def get_parameters(self) -> list[ToolParameter]
    @abstractmethod async def execute(self, arguments) -> ToolExecResult
    async def close(self): ...        # 资源释放
```

参数用**自定义 `ToolParameter` 结构体**（name/type/description/enum/items/required），
再由 `get_input_schema()` 编译成 JSON Schema——**不是直接写 JSON Schema**。

### 4.2 ⚠ 关键：`get_input_schema` 按 Provider 适配

这是最值得抄的一处。OpenAI 的 **strict mode** 要求：所有参数必须进 `required`、顶层与嵌套 object 都要 `additionalProperties: false`。

```python
if self.model_provider == "openai":
    required.append(param.name)                    # 全部进 required
    if not param.required:
        param_schema["type"] = [current_type, "null"]   # 可选参数改 nullable
elif param.required:
    required.append(param.name)
...
if self.model_provider == "openai" and param.type == "object":
    param_schema["additionalProperties"] = False
...
if self.model_provider == "openai":
    schema["additionalProperties"] = False
```

**`model_provider` 在工具构造时注入**（`tools_registry`name``），每个工具自己感知目标 Provider。

> **对位 WorldSea**：`Tool::parameters()` 直接返回 `serde_json::Value`（`crates/agent-kernel/src/tool.rs:39`），
> 在 `agent-kernel` 全库检索 `additionalProperties` / `strict` **零命中** → **未做 Provider 适配**。
> 注：[Harness 调研](../plans/2026-08-30-Harness工程差距调研.md) §实证教训记有"桥工具 schema 严格模式"问题，
> 说明此坑已踩过，但**修复未落到 `agent-kernel` 的 schema 生成层**。→ 列为待确认项（§6 R4）

### 4.3 ToolExecutor：名称归一化容错

```python
def _normalize_name(self, name: str) -> str:
    return name.lower().replace("_", "")
```

注册与查找都走归一化，容忍 LLM 输出 `str_replace_based_edit_tool` / `StrReplaceBasedEditTool` 等变体。
未命中时返回的错误消息**带可用工具清单**：

```python
error=f"Tool '{name}' not found. Available tools: {[t.name for t in self._tools]}"
```

> **对位**：WorldSea 有更强的 `resolve_alias`（`tool.rs:167`，如 `fs_read → read_file`），
> 但 `ToolError::NotFound(name)` 是否带可用清单需核对。

### 4.4 ⚠ 关键：工具输出协议三板斧

Trae 的工具**返回给 LLM 的是自然语言文本**，不是 JSON。三板斧：

**① `cat -n` 带行号**（`edit_tool.py:_make_output`）
```python
f"{i + init_line:6}\t{line}"   # 行号右对齐 6 位 + Tab
```
→ LLM 引用代码位置时有坐标，报错能说"第 42 行"。

**② 改动后回显 snippet 上下文**（`SNIPPET_LINES = 4`）
```python
start_line = max(0, replacement_line - SNIPPET_LINES)
end_line   = replacement_line + SNIPPET_LINES + new_str.count("\n")
snippet = "\n".join(new_file_content.split("\n")[start_line : end_line + 1])
```
→ 编辑成功不只回 "ok"，而是回改动处 ±4 行，让 LLM 自查。

**③ 错误信息即引导**（`validate_path` / `str_replace`）
```python
raise ToolError(f"The path {path} is not an absolute path... Maybe you meant {suggested_path}?")
raise ToolError(f"No replacement was performed. Multiple occurrences of old_str in lines {lines}. "
                f"Please ensure it is unique")
```
→ 不只说"失败"，还说"怎么改"。

> **对位 WorldSea（`crates/agent-commands/src/fs_tools.rs`）**：
> - `read_file` 返回 `json!({content, path})` —— **无行号**（`fs_tools.rs:240-243`）
> - `edit_file` 成功返回 `json!({ok, path, replacements})` —— **无 snippet 回显**（`fs_tools.rs:568-571`）
> - `edit_file` 用 `content.replace(old_string, new_string)` **替换全部匹配**，
>   而 Trae 在匹配数 > 1 时**直接拒绝并列出行号**（`fs_tools.rs:561-562`）
> - WorldSea 输出走 `with_meta(json, __meta)` —— `__meta` 供前端渲染用，content 部分序列化给 LLM
>
> **→ 三处实质差异，见 §6 借鉴项 B1/B2/B3。**

### 4.5 SequentialThinking：把"思考"显式工具化

`sequential_thinking_tool.py` 把思维链做成一个**可被 LLM 主动调用的工具**：

```python
@dataclass
class ThoughtData:
    thought: str
    thought_number: int
    total_thoughts: int
    next_thought_needed: bool
    is_revision: bool | None = None
    revises_thought: int | None = None
    branch_from_thought: int | None = None
    branch_id: str | None = None
    needs_more_thoughts: bool | None = None
```

- 工具**自持状态**：`self.thought_history` + `self.branches: dict[str, list[ThoughtData]]`
- 支持**修订**与**分支**（`is_revision` / `branch_from_thought` / `branch_id`），不只是线性链
- `total_thoughts` 可动态上调：`if thought_number > total_thoughts: total_thoughts = thought_number`
- 返回极简状态 JSON（下一步只看到 `thought_number / total_thoughts / next_thought_needed / branches / thought_history_length`），**不回灌全部历史**，省 token

> **对位 WorldSea**：思考走 `OrchestratorMessage.meta.thinking`（`agent/mod.rs:883-888`），
> 由模型原生 reasoning 产出，前端渲染为 `ThinkSegment`。
> **两条路线的取舍**：
> - Trae 路线（显式工具）：模型无关、结构化、可分支 —— 但**消耗轮次**，且模型不调用就没有思考
> - WorldSea 路线（meta 承载）：零额外轮次、原生 —— 但**依赖模型支持 reasoning**，无分支结构
>
> **结论：WorldSea 的路线更适合交互式产品，不建议改。** 可借鉴的只有一点：
> `ThoughtData` 的**分支/修订语义**（`revises_thought` / `branch_from_thought`）可考虑加进 `ThinkSegment`，
> 为将来的 Tree-of-Thought 呈现留位（WorldSea 已有 `agent-patterns` 的 tot 模式）。

### 4.6 工具生态对位总表

| 能力 | Trae Agent | WorldSea |
|---|---|---|
| 工具抽象 | `Tool` ABC（4 抽象方法 + close） | `Tool` trait（`name/description/parameters/execute/execute_with_ctx`） |
| Schema 生成 | 结构体 → 编译，**按 Provider 适配** ⚠ | 直接返回 `serde_json::Value`，**未适配** ⚠ |
| 总线 | `ToolExecutor`（map + 名称归一化） | `ToolBus` trait（`SimpleToolBus` / `WhitelistToolBus`） |
| 别名 | `_normalize_name`（大小写/下划线容错） | `resolve_alias`（语义别名，更强） |
| 子 Agent 隔离 | ❌ 无 | ✅ `WhitelistToolBus` |
| MCP | 启动时 discover，append 进 `_tools` | `register_mcp_tools` / `unregister_mcp_server`（按 server 批量管理，更强） |
| 执行模式 | `parallel_tool_call` / `sequential_tool_call` 二选一 | 按 `parallel_tool_calls` + HITL 确认分派（`agent/tools.rs:269-314`） |
| 超时/重试 | ❌ 无 | ✅ `tokio::time::timeout` + 指数退避（`agent/tools.rs:164-266`） |
| 结果裁剪 | `maybe_truncate` | `clamp_tool_result`，`TOOL_RESULT_STR_LIMIT = 12_000`（`agent/tools.rs`；2026-09-11 起为**保头 3/5 + 保尾 2/5**） |
| 前置钩子 | ❌ 无 | ✅ `on_pre_use`（可改 args / Deny） |
| 错误类型 | 通用 `ToolError` | `NotFound/ArgsParse/Execution/Timeout/Aborted/Other` |
| 资源释放 | `Tool.close()`，`_close_tools` 在 finally 调用 | 需核对 |

**→ 工具执行层 WorldSea 全面领先**（超时/重试/钩子/裁剪/白名单/MCP 批量管理都是 Trae 没有的）。
**Trae 领先的只有两点：Provider 适配的 schema 生成、给 LLM 的输出文本协议。**

---

## 五、核心借鉴：完成判定三重钩子

### 5.1 Trae 原设计

| 钩子 | 职责 | Trae 默认实现 | TraeAgent 覆写 |
|---|---|---|---|
| `llm_indicates_task_completed(resp)` | 模型是否**声明**完成 | 关键词匹配 `["task completed", "done", ...]` | `tool_calls` 里有 `task_done` |
| `_is_task_completed(resp)` | **外部客观校验** | `return True` | `must_patch == "true"` 时查 `git diff` 非空 |
| `task_incomplete_message()` | 校验失败的**驳回话术** | `"The task is incomplete. Please try again."` | `"ERROR! Your Patch is empty. Please provide a patch that fixes the problem."` |

**设计精髓**：把「模型自报」和「客观验证」分离。模型说做完了不算，得有个外部判据。
且驳回不是静默继续，而是**注入一条结构化的、说明具体哪里不合格的 user 消息**。

### 5.2 WorldSea 现状（代码事实）

`crates/agent-kernel/src/agent/mod.rs:876-912`：

```rust
// 过滤空名工具调用（LLM 幻觉，实测复现）
let tool_calls: Vec<ToolCall> = response.tool_calls.clone().into_iter()
    .filter(|tc| !tc.name.trim().is_empty()).collect();

if tool_calls.is_empty() {
    // 无有效工具调用：推入 assistant 消息，返回最终文本
    let final_text = response.text.clone();
    { /* push assistant message */ }
    return Ok(final_text);   // ← 直接收口
}
```

**判定 = 纯结构判定「无工具调用即完成」，没有任何客观校验，也没有驳回通道。**

已具备的相关基建：
- `crates/agent-kernel/src/agent/hooks.rs`：`AgentLoopHook` + `RunPhase` 织入点
- `crates/agent-kernel/src/loop_control.rs`：`RateLimiter`（`max_turns=100` / `max_tool_calls=200` / `max_tokens=100k` / `max_duration=6h`）
- `AgentLoopConfig.max_iterations` 默认 **25**（`agent/config.rs:13,110`）

### 5.3 落地方案（三选一，待拍板）

#### 方案 A：最小侵入（推荐先做）

在 `run_react_loop` 的 `tool_calls.is_empty()` 分支**内部**插入校验，不通过则**不 return**，
而是把驳回消息 push 进 `state.messages` 并 `continue`。

```rust
if tool_calls.is_empty() {
    let final_text = response.text.clone();

    // ─── 新增：完成校验（CompletionVerifier）───
    if let Some(verifier) = &self.completion_verifier {
        match verifier.verify(&final_text, &state_snapshot).await {
            Completion::Accept => { /* 走原逻辑 return Ok(final_text) */ }
            Completion::Reject { reason } => {
                state.messages.push(OrchestratorMessage {
                    role: MessageRole::User,
                    content: reason,          // 结构化驳回话术
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                });
                rejections += 1;
                if rejections >= MAX_REJECTIONS { return Ok(final_text); }  // 熔断
                continue;                     // 不消耗 max_iterations
            }
        }
    }
    return Ok(final_text);
}
```

配套新增（约 120 行）：
- `crates/agent-kernel/src/agent/completion.rs`：`CompletionVerifier` trait + `NoopVerifier` 默认实现
- `AgentLoopConfig` 加 `completion_verifier: Option<Arc<dyn CompletionVerifier>>` + `max_rejections: u32`（默认 3）

#### 方案 B：钩子化

复用 `hooks.rs` 的 `RunPhase`，新增 `RunPhase::BeforeFinalize` 位点，
校验逻辑放外部钩子。**改动更小，但拿不到「阻止收口」的控制权**（钩子是通知而非拦截），
需要给 `HookContext` 加一个 `veto()` 方法 → 反而更复杂，不推荐。

#### 方案 C：Verify-then-Commit 全流程

把校验提到工具执行后（每次动作完成都校验），而非只在收口时。**成本过高，不建议。**

### 5.4 风险点（需拍板，不自动实施）

| # | 风险 | 说明 | 建议 |
|---|---|---|---|
| **R1** | 驳回消耗轮次 | 驳回后 `continue` 会再次走 `state.current_iteration += 1`，吃掉 `max_iterations=25` 的预算，可能把正常对话卡死 | **驳回必须独立计数**（`rejections`），且不递增 `current_iteration`；配 `max_rejections` 熔断 |
| **R2** | 交互式场景误判 | WorldSea 不是 SWE 专用，用户闲聊/问问题时收口是正确行为，加校验会强行驳回 | **默认 `NoopVerifier`**，仅在长任务 / 编排模式 / 用户显式要求时启用 |
| **R3** | 校验判据从哪来 | Trae 的 `git diff` 判据依赖"SWE 修 bug"这一特定场景，WorldSea 是通用 Agent，没有普适判据 | 判据**必须由场景/编排模式提供**（如 Plan-and-Execute 校验计划项全勾选、Reflection 校验反思轮已过），框架只提供接口不提供默认判据 |
| **R4** | Provider schema 适配缺失 | 全库检索 `additionalProperties` / `strict` 零命中 | 需核对 [Harness 调研](../plans/2026-08-30-Harness工程差距调研.md) 所记"桥工具 schema 严格模式"问题的修复落点，确认是否真断线 |

---

## 六、借鉴项汇总（按性价比排序）

| # | 借鉴项 | 来源 | 性价比 | 改动量 | 需确认 |
|---|---|---|---|---|---|
| **A1** | **完成判定三重钩子**（方案 A） | §5 | ★★★★★ | ~120 行 Rust + 1 个新文件 | ✅ 架构新增，需拍板 |
| **B1** | **`cat -n` 行号输出** | `edit_tool.py:_make_output` | ★★★★☆ | `fs_tools.rs` read_file 一处 | 纯输出格式，可自主 |
| **B2** | **`edit_file` 多处匹配拒绝**（对齐 Trae） | `edit_tool.py:str_replace` | ★★★★☆ | `fs_tools.rs:561-562` | ⚠ **改变行为**：从"替换全部"变为"拒绝"，需确认 |
| **B3** | **改动后 snippet 回显**（±4 行） | `edit_tool.py` SNIPPET_LINES | ★★★☆☆ | `fs_tools.rs` edit_file 一处 | 纯输出增强，可自主 |
| **B4** | **错误信息即引导**（"Maybe you meant..."） | `edit_tool.py:validate_path` | ★★★☆☆ | 散落在各工具错误分支 | 文案改动，可自主 |
| **C1** | **Lakeview 工程手法**（prefill / 硬重试降级 / 长度闸门） | §2.3 | ★★★☆☆ | 取决于落点 | ✅ 涉及新增 LLM 调用，需拍板 |
| **C2** | **usage 细分三类 token**（cache_creation / cache_read / reasoning） | `trajectory_recorder.py` | ★★☆☆☆ | `agent/mod.rs:866-870` | 需先确认用量面板需求 |
| **D1** | **`ThinkSegment` 预留分支/修订语义** | `ThoughtData` | ★★☆☆☆ | `turnModel.ts` 加可选字段 | 纯字段预留，可自主 |

**不借鉴项及理由：**

| 项 | 理由 |
|---|---|
| 轨迹记录写穿式落盘 | WorldSea 的 SQLite 持久化 + 回源重建明显更强（§3.3） |
| SequentialThinking 显式工具化 | 消耗轮次、依赖模型主动调用；WorldSea 的 `meta.thinking` 路线更适合交互式产品（§4.5） |
| 每步 LLM 摘要 | 成本翻倍，交互式长会话不可接受（§2.4） |
| Docker 双执行器 | WorldSea 无容器化需求 |
| CKG（代码知识图谱） | WorldSea 有 `agent-memory` + MemoryCenter，路线不同 |
| `reflect_on_result` 反思注入 | **Trae 自己在 TraeAgent 里 override 成 `None` 关掉了** —— 说明对 SWE 任务收益不足；且 WorldSea 已有 `agent-patterns` 的 Reflection 模式，更完整 |

---

## 七、待办

- [ ] 拍板 A1（完成判定三重钩子）是否立项 → 若是，进 [Harness 工程差距调研](../plans/2026-08-30-Harness工程差距调研.md) 作为新议题
- [ ] 核对 R4：Provider schema 适配是否真断线
- [ ] 确认 B2 行为变更可接受（"替换全部" → "多处拒绝"）
