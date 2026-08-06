# orchestrator.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/orchestrator.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 99-109 行）

Orchestrator — 编排器，驱动节点图执行

使用方式：
1. 创建 Orchestrator 实例
2. 添加节点和边
3. 调用 `run(input)` 启动
4. 通过 `subscribe` 监听事件
5. 通过 `abort` 中断

阶段 1.1 实现：简单的线性/条件序列执行器
阶段 2 实现：完整的图执行器（支持并行/回溯）
