<!-- hippocampus-agents begin -->
<!-- hippocampus-agents begin -->
# Hippocampus 记忆协议（项目级硬性规则）

> 本文件由 install_rules 自动写入，被 IDE 自动读取注入 LLM system prompt。
> 完整规则详见 `.trae/rules/hippocampus-archive.md`（或 `.catpaw/rules/`）。

## session_id 约定（必须遵守）

```
{客户端前缀}-{项目名}-{日期}
```

**客户端前缀**：
- CatPaw: `catpaw`
- Trae: `trae`
- Claude Code: `claudecode`
- Cursor: `cursor`

**示例**：
- `catpaw-myapp-20260706`
- `trae-hippocampus-20260706`
- `claudecode-worldsmith-20260706`

> 一个 session_id 对应一个独立的记忆空间。同会话内复用同一 session_id，
> 切换项目或日期时换新 session_id。
>
> **禁止使用 `项目名-session` 这种格式**（如 `worldsmith-session`），
> 会导致 retrieve 找不到记忆。若不确定用哪个 session_id，先调 `prompt` 工具
> 查看可用 session 列表，或询问用户。

## 记忆协议（Agent 必须遵守，无需用户提示主动执行）

### 1. 会话开始：调 prompt 获取历史记忆
每个新会话的第一次回复前，必须先调用 `mcp_hippocampus.prompt(session_id)`。
返回的摘要拼接到 system prompt。若返回空列表，说明该 session 无历史记忆。

### 2. 上下文接近阈值：主动调 archive 归档
触发条件（满足任一）：
- 对话超过 20 轮（用户消息 + LLM 回复算 1 轮）
- 包含大量代码 / 长文档 / 多次工具调用
- 感觉"上下文开始变重"、"前面说过但记不清细节"
- 每 30 轮兜底归档一次

### 3. 用户提到过去事件：先调 semantic_search
当用户消息中出现"之前"、"上次"、"还记得"等指代词时，先用用户原话作为 query
检索相关记忆，把检索结果作为上下文再回复。

### 4. project_memory 反向写入
完成开发阶段/关键决策/风险点时，调 `update_project_memory` 更新 project_memory.md。
拿到 full_content 后用 Write 工具写入 Trae 的 memory 文件夹。

### 5. 上下文被压缩后：执行压缩后行为协议
当系统消息中出现 `This session continues a previous conversation that lost its context.` 时，
立即执行 4 步强制流程（详见 rules/hippocampus-archive.md）：
1. 归档压缩前未持久化的轮次
2. 调 prompt 拉取 hippocampus 一手记忆
3. 交叉校准 Summary 第8章节 Current Work
4. 执行 Next Step 决策协议

## 工具触发规则速查表

| 时机 | 工具 |
|------|------|
| 会话第一次回复前 | `prompt` |
| 上下文接近阈值 | `archive` |
| 用户提到过去事件 | `semantic_search` |
| 需要查特定记忆 | `retrieve` |
| 需要查所有记忆列表 | `summaries` |
| 完成开发阶段/关键决策 | `update_project_memory` |
| 上下文被压缩后 | `archive` + `prompt` |
| 周级去重合并 | `compaction` period="weekly" |
| 月级评分淘汰 | `compaction` period="monthly" |
<!-- hippocampus-agents end -->
<!-- hippocampus-agents end -->