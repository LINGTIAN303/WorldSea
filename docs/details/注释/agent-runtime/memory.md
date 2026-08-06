# memory.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/memory.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 37-47 行）

注入记忆摘要到 system prompt

将检索到的记忆摘要拼接到 system prompt 中，供后续 LLM 调用使用。
实现层负责维护"已注入"状态，避免重复注入。

# 参数
- `results`：检索结果（来自 `recall`）
- `options`：注入选项

# 返回
注入到 system prompt 的文本片段（空字符串=无注入）

---

## 注释块 2（原文件第 82-91 行）

记录一轮对话（供归档前累积）

ReAct 循环每轮对话完成后调用，实现层将轮次累积到归档缓冲，
达到阈值后由 [`Self::archive`] 触发归档。

# 参数
- `user_message`：用户输入
- `assistant_message`：Agent 最终回复

默认实现为空操作（不启用长期记忆的访问器可忽略）。
