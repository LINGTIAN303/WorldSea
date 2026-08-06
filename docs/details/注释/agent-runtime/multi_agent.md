# multi_agent.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/multi_agent.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。
> 拆分记录（2026-08-06）：测试模块已迁出至 multi_agent_tests.rs
> 拆分记录（2026-08-06）：multi_agent.rs 按职责拆为 src/multi_agent/ 目录（types/blackboard/strategies/config/error）

## 注释块 1（原文件第 1-35 行）

# Multi-Agent Pattern — 多 Agent 协作模式

实现去中心化的多 Agent 协作：N 个对等 Agent 通过消息传递（mpsc）与
共享黑板（SharedBlackboard）协作完成任务。与 Supervisor（中心化调度）
互补，强调 Agent 间的直接通信与并行协作。

## 架构

```text
用户输入
   ↓
MultiAgentNode.execute
   ├─ 1. 初始化：创建 N 个 AgentLoop + N 个 mpsc 通道 + SharedBlackboard
   ├─ 2. 按 topology 构建 sender 网络（mesh/ring/star/pipeline/custom）
   ├─ 3. 注入 initial_message 启动首个 Agent
   ├─ 4. 循环（最多 max_rounds）：
   │     ├─ 4.1 并发（JoinSet）：每个 Agent 从 receiver 取消息 + 执行
   │     ├─ 4.2 Agent 可读写 Blackboard + 通过 sender 发消息给 peers
   │     ├─ 4.3 等待所有 Agent 完成本轮
   │     ├─ 4.4 检查收敛条件（MaxRounds / GoalReached / AllAgentsIdle）
   │     └─ 4.5 收敛则跳出
   ├─ 5. 从 blackboard.final_result 或 LLM 综合输出
   └─ 6. 返回 NodeResult（Done）
```

## 关键设计

- **混合通信模型**：mpsc 通道处理 Agent 间定向消息，SharedBlackboard 存储全局共享上下文
- **可配置拓扑**：Mesh/Ring/Star/Pipeline/Custom，按场景选择
- **共享 backend**：所有子 Agent 使用同一个 `NodeBackendAccessor`
- **共享 ToolBus**：所有子 Agent 共用父 `ToolBus`
- **独立 system_prompt**：每个 Agent 用自己的 system_prompt 定义角色
- **Lazy 初始化**：子 Agent 实例在首次调用时创建并缓存

## 与 Supervisor 的区别

- Supervisor：中心化 LLM 决策分配任务（一对多）
- Multi-Agent：去中心化对等协作（多对多，Agent 间直接通信）

---

## 模块职责一句话

Multi-Agent 协作模式：N 个对等 Agent 通过 mpsc 消息 + SharedBlackboard 协作，可配置拓扑（Mesh/Ring/Star/Pipeline/Custom）、收敛策略（MaxRounds/GoalReached/AllAgentsIdle/Hybrid）与 LLM 综合/目标检查策略。
