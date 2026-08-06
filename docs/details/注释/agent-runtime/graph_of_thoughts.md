# graph_of_thoughts.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/graph_of_thoughts.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。
> 拆分记录（2026-08-06）：测试模块已迁出至 graph_of_thoughts_tests.rs

## 注释块 1（原文件第 1-40 行）

# Graph of Thoughts (GoT) — 思维图编排模式

阶段 2.2 新增。实现 Graph of Thoughts Pattern：在 ToT 树探索基础上，
支持任意连接图（多 parent 聚合），通过 LLM 聚合策略把多个相关思维合并为新思维。

## 与 ToT 的核心差异
- **ToT 是树结构**：每个节点只有一个 parent，分支不合并
- **GoT 是有向图**：支持多 parent + 聚合变换，多个思维可合并为新思维

## 架构
```text
用户输入（问题/任务）
   ↓
GoTNode.execute
   ├─ 1. 创建根节点（depth=0，content=输入）+ 评分 + 目标检查
   ├─ 2. 循环（层扩展 + 跨层聚合）：
   │   ├─ 2a. 检查终止条件（深度/节点数/收敛/中断）
   │   ├─ 2b. 选择当前层 top-K 节点（beam_width）
   │   ├─ 2c. 对每个节点并发生成 branch_factor 个候选（JoinSet）— 复用 ToT 探索
   │   ├─ 2d. 评分所有候选 + 目标检查 — 复用 ToT 评分
   │   ├─ 2e. 【GoT 新增】对本层 top-N 节点做聚合（生成聚合节点）
   │   └─ 2f. 选择 top-K（含聚合节点）进入下一层
   ├─ 3. 返回最优思维（写入 state.messages）
   └─ 4. 触发 ToTGoalReached 或 ToTTerminated 事件（复用 ToT 事件 + ThoughtsAggregated）
```

## 关键设计
- **扩展 ToT 而非独立实现**：复用 `ThoughtNode` / `ExplorationStrategy` /
  `ScoringStrategy` / `GoalCheckStrategy`，仅新增 `AggregationStrategy`
- **ThoughtNode 扩展 `parents` 字段**：图语义下的多父节点列表
- **层内扩展 + 跨层聚合**：每层先做 Beam Search 扩展，再对本层 top-N 做聚合
- **聚合阈值控制**：只有评分≥`aggregation_threshold` 的节点才参与聚合，避免低质聚合
- **复用 ToT 事件**：ThoughtNodeCreated/ThoughtNodeScored/ThoughtBranchExplored/
  ToTGoalReached/ToTTerminated/ToTError 全部复用，仅新增 `ThoughtsAggregated` 事件

## 与 ToTNode 的代码复用
- GoTNode 独立实现 `OrchestratorNode` trait（Rust 无继承）
- 复用 `tree_of_thoughts` 模块的所有策略 trait 和默认实现
- `BeamSearchStrategy` / `LlmScoringStrategy` / `LlmGoalCheckStrategy` 直接复用
- execute 方法独立实现（与 ToTNode 类似但增加聚合阶段）

---

## 注释块 2（原文件第 122-134 行）

聚合策略 — 把多个思维合并为一个新思维

GoT 的核心扩展点。默认实现 `LlmAggregationStrategy` 通过 LLM 调用生成聚合思维。
自定义实现可支持投票、加权平均、取最大值等非 LLM 策略。

## 调用时机
在每层 Beam Search 扩展完成后，对本层评分≥`aggregation_threshold` 的 top-N 节点
触发聚合。聚合结果作为新节点进入下一层候选池。

## 与其他策略的关系
- `ExplorationStrategy`：单 parent → 多 children（树扩展）
- `AggregationStrategy`：多 parent → 1 child（图聚合）
- 两者互补，共同构成 GoT 的图结构

---

## 注释块 3（原文件第 283-305 行）

GoTNode — Graph of Thoughts 节点

扩展 ToTNode 的树探索逻辑，增加跨层聚合能力。
复用 `ExplorationStrategy` / `ScoringStrategy` / `GoalCheckStrategy`，
新增 `AggregationStrategy`。

## 与 ToTNode 的差异
- **多 parent**：聚合节点的 `parents` 字段包含所有源节点 ID
- **聚合阶段**：每层扩展后触发聚合，生成聚合节点进入下一层候选池
- **事件复用**：复用 ToT 事件 + 新增 `ThoughtsAggregated`

## 示例
```ignore
use agent_runtime::graph_of_thoughts::{GoTNode, GoTConfig};
use agent_runtime::backend::NodeBackendAccessor;

let got = GoTNode::with_default_strategies(
    "got_1",
    "思维图",
    backend,
    GoTConfig::default(),
);
```

---

## 注释块 4（原文件第 564-575 行）

【GoT 新增】层聚合 — 对本层 top-N 节点做聚合，生成聚合节点

# 聚合流程
1. 筛选本层评分≥`aggregation_threshold` 的节点
2. 按评分降序取 top-`max_aggregation_size`
3. 调用 `AggregationStrategy::aggregate` 生成聚合思维
4. 构造聚合节点（parents = 所有源节点 ID，parent_id = 第一个源节点）
5. 评分聚合节点 + 目标检查
6. 触发 `ThoughtsAggregated` 事件

# 返回
生成的聚合节点 ID 列表（可能为空，若候选不足）
