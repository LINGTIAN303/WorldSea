# node.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/node.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 239-248 行）

节点接口 — 所有编排模式的基础构建块

实现示例：
- `ReactNode`：包装 ReAct 循环
- `PlanNode`：生成任务计划
- `ExecuteNode`：逐步执行计划项
- `ReflectionNode`：评审输出
- `RefineNode`：基于评审迭代优化
- `RouterNode`：根据输入路由到不同节点
- `SupervisorNode`：分配任务给子 Agent
