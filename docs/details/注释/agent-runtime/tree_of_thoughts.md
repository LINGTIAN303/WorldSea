# tree_of_thoughts.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/tree_of_thoughts.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。
> 拆分记录（2026-08-06）：测试模块已迁出至 tree_of_thoughts_tests.rs
> 拆分记录（2026-08-06）：tree_of_thoughts.rs 按职责拆为 src/tree_of_thoughts/ 目录（node/strategies/config/error）

## 注释块 1（原文件第 1-39 行）

# Tree of Thoughts (ToT) — 思维树编排模式

实现 Tree of Thoughts Pattern：通过树形探索多路径思维，
使用 LLM 评分 + Beam Search 剪枝，寻找最优解或达成目标。

## 架构
```text
用户输入（问题/任务）
   ↓
ToTNode.execute
   ├─ 1. 创建根节点（depth=0，content=输入）
   ├─ 2. 评分根节点 + 目标检查
   ├─ 3. 循环（层扩展）：
   │   ├─ 3a. 检查终止条件（深度/节点数/收敛/中断）
   │   ├─ 3b. 选择当前层 top-K 节点（beam_width）
   │   ├─ 3c. 对每个节点并发生成 branch_factor 个候选（JoinSet）
   │   ├─ 3d. 评分所有候选 + 目标检查
   │   └─ 3e. 选择 top-K 进入下一层
   ├─ 4. 返回最优思维（写入 state.messages）
   └─ 5. 触发 ToTGoalReached 或 ToTTerminated 事件
```

## 关键设计
- **Beam Search**：默认探索策略，每层保留 top-K 节点继续扩展
- **LLM 评分**：默认 0-100 分制，可通过 `ScoringStrategy` trait 扩展
- **LLM 目标检查**：默认通过 LLM 判断是否达成目标，可通过 trait 扩展
- **JoinSet 层内并发**：同层节点扩展并发执行，提升探索效率
- **四终止条件**：max_depth / max_thoughts / LLM 目标达成 / 评分收敛
- **可插拔策略**：三个 trait（Exploration/Scoring/GoalCheck）均支持自定义实现

## 与 Supervisor/Router 的差异
- ToT 不调用子 AgentLoop，所有思维生成/评分/目标检查都通过 LLM 调用完成
- ToT 是树探索模式，维护 `tree: HashMap<id, ThoughtNode>` 内部状态
- ToT 的输出是最优思维内容（写入 `state.messages`），不是路由决策或子 Agent 结果

## 与 TS 版的差异
- Rust 版用 `tokio::task::JoinSet` 实现层内并发，TS 版用 `Promise.all`
- Rust 版用 `Arc<RwLock<HashMap>>` 维护树结构，TS 版用 Map
- 事件系统复用 `OrchestratorEvent`，新增 6 个 ToT 变体

---

## 注释块 2（原文件第 215-224 行）

根据父节点生成下一层候选思维

# 参数
- `parent`：父思维节点
- `context`：原始任务/问题（用户输入）
- `branch_factor`：期望生成的候选数量
- `backend`：LLM 后端访问器

# 返回
候选思维内容列表（长度应接近 `branch_factor`）。

---

## 注释块 3（原文件第 723-743 行）

ToTNode — Tree of Thoughts 节点

在编排图中作为一个节点存在，被 Orchestrator 调度执行时：
1. 接收原始问题（从 `state.input` 或最后一条 user 消息）
2. 创建根节点（depth=0）
3. 循环扩展：评分 → 目标检查 → Beam Search 剪枝 → 生成下一层
4. 终止时返回最优思维（写入 `state.messages`）

# 使用示例
```rust,ignore
use agent_runtime::tree_of_thoughts::{
    ToTNode, ToTConfig,
};

let node = ToTNode::with_default_strategies(
    "tot",
    "思维树",
    backend,
    ToTConfig::default(),
);
```

---

## 注释块 4（原文件第 767-776 行）

创建新的 ToT 节点

# 参数
- `id`：节点 ID（在 Orchestrator 中唯一）
- `name`：节点名称（调试/日志用）
- `exploration_strategy`：探索策略
- `scoring_strategy`：评分策略
- `goal_check_strategy`：目标检查策略
- `backend`：LLM 后端访问器
- `config`：ToT 配置
