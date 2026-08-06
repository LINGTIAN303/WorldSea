# alias.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/alias.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-16 行）

# 别名系统 — 旧工具名到新工具名的映射

对应 TS 版三张静态映射表：
- `worldsmith-agent/src/tools/coding-agent-tools.ts` 的 `LEGACY_TO_CODING_MAP`
- `worldsmith-agent/src/tools/algo-tools.ts` 的 `LEGACY_ALGO_MAP`
- `worldsmith-agent/src/tools/plugin-backend-tools.ts` 的 `LEGACY_PLUGIN_MAP`

## 用途
WorldSmith 历史版本中工具名多次迭代（如 `fs_read` → `read_file`），
旧 Agent 配置/技能元数据中仍引用旧名。别名系统在调用前透明映射，
保证向后兼容。

## 设计
- 三张表用 `const` 静态切片定义，启动时构建为 `HashMap`，零运行时开销
- `resolve_alias(name)` 依次查 CODING → ALGO → PLUGIN，最多深度 3 防循环
- 与 `ToolBus::call_tool` 解耦：AgentLoop 在调用前先解析别名

---

## 注释块 2（原文件第 119-132 行）

解析工具名别名

# 参数
- `name`：可能是旧名的工具名

# 返回
解析后的最终工具名（若无别名映射，返回原名）

# 示例
```
use agent_runtime::alias::resolve_alias;
assert_eq!(resolve_alias("fs_read"), "read_file");
assert_eq!(resolve_alias("read_file"), "read_file"); // 无别名，原样返回
```
