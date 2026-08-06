# router.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/router.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。
> 拆分记录（2026-08-06）：测试模块已迁出至 router_tests.rs

## 注释块 1（原文件第 1-62 行）

# Router Pattern — 路由编排模式

实现 Router Pattern：纯决策节点，根据输入特征/意图分类，
将请求路由到合适的专业 Agent/工具链分支。

## 架构

```text
用户输入
   ↓
RouterNode.execute
   ├─ 1. 读取输入（state.input 或最后一条 user 消息）
   ├─ 2. 中断检查
   ├─ 3. RoutingStrategy.route(input, targets, backend) → RouteResult
   ├─ 4. 目标校验（target_id 存在性）
   ├─ 5. 事件发射（RouterDecisionMade / RouterNoMatch / RouterError）
   └─ 6. 返回 NodeResult（Continue + next_node_id）
```

## 关键设计

- **纯决策节点**：不执行子 Agent，只输出 `next_node_id` 让 Orchestrator 调度下一节点
- **与 Supervisor 的差异**：Supervisor 内部创建并执行子 AgentLoop；
  Router 只决定"下一步去哪"，不关心下个节点如何执行
- **共享 backend**：路由策略（如 LLM 决策）通过 `NodeBackendAccessor` 调用 LLM
- **可插拔策略**：默认 `LlmRoutingStrategy`（LLM 意图分类），
  可注入 `KeywordRoutingStrategy`（关键词匹配）或自定义实现
- **Fallback 机制**：无匹配时若配置 `fallback_target_id`，走 fallback 并触发
  `RouterDecisionMade { is_fallback: true }`；否则触发 `RouterNoMatch`

## 嵌套路由（路由树）

RouterNode 本身是**扁平路由**：单次决策从一个 `targets` 列表中选择一个目标。
嵌套路由（路由树）通过**编排图（Orchestrator Graph）**天然实现，无需在 RouterNode
内部特殊支持：

1. Router A 的某个 `RouteTarget.id` 指向编排图中的另一个 Router B 节点
2. Router A.execute 返回 `next_node_id = "router_b"`
3. Orchestrator 按图查找 `router_b` 节点并调度执行
4. Router B.execute 继续决策，路由到最终专业 Agent 节点

```text
      ┌────────────┐
输入 → │ Router A   │ → "router_b"
      └────────────┘
             ↓ (Orchestrator 按图调度)
      ┌────────────┐
      │ Router B   │ → "coder" / "writer" / ...
      └────────────┘
             ↓
      ┌────────────┐
      │ 专业 Agent  │
      └────────────┘
```

### 设计权衡：为何不引入递归 `sub_routes` 字段

- **职责单一**：RouterNode 只负责单层决策，嵌套关系由编排图管理
- **避免与 Orchestrator 重叠**：编排图本身就是 DAG，已支持任意嵌套
- **可观测性更好**：每层 Router 独立发射事件，便于追踪路由链路
- **可复用**：同一 Router 节点可被多个上层 Router 引用

## 与 TS 版的差异

- Rust 版 RouterNode 不持有子 Agent 实例（纯决策）
- 事件系统复用 `OrchestratorEvent`，新增 3 个 Router 变体
- LLM 策略的 JSON 解析容错处理（```json 包裹）

---

## 注释块 2（原文件第 124-133 行）

根据输入和候选路由目标，决定路由到哪个目标

# 参数

- `input`：用户输入文本
- `targets`：候选路由目标列表
- `backend`：LLM 后端访问器（用于 LLM 决策策略）

# 返回

`RouteResult` 包含选中的 `target_id` 与可选的决策理由。
若无匹配，返回 `RoutingError::NoMatch`（由 RouterNode 决定走 fallback 还是报错）。

---

## 注释块 3（原文件第 325-335 行）

关键词匹配的路由策略

检查输入是否包含各目标的 `keywords`（大小写不敏感），
命中即返回该目标。多目标命中时返回第一个匹配项。

适用于规则明确、无需 LLM 决策的简单路由场景。

# 注意

- 不调用 LLM，纯本地匹配
- 未配置 keywords 的目标会被跳过
- 全部目标都未命中时返回 `RoutingError::NoMatch`

---

## 注释块 4（原文件第 407-442 行）

RouterNode — 路由节点

在编排图中作为一个节点存在，被 Orchestrator 调度执行时：
1. 接收当前输入（从 `state.input` 或上一节点输出）
2. 通过 `RoutingStrategy` 选择路由目标
3. 校验目标存在性（target_id 在 targets 列表中）
4. 发射 `RouterDecisionMade` 事件
5. 返回 `NodeResult::continue_to(target_id)`（让 Orchestrator 调度下一节点）

# 使用示例

```rust,ignore
use agent_runtime::router::{RouterNode, RouteTarget, RouterConfig};

let targets = vec![
    RouteTarget {
        id: "coder".into(),
        name: "代码专家".into(),
        description: "处理代码编写、调试、重构任务".into(),
        keywords: Some(vec!["代码".into(), "函数".into()]),
    },
    RouteTarget {
        id: "writer".into(),
        name: "文档专家".into(),
        description: "处理文档撰写、翻译、润色任务".into(),
        keywords: Some(vec!["文档".into(), "翻译".into()]),
    },
];

let node = RouterNode::with_default_strategy(
    "router",
    "路由节点",
    targets,
    backend,
    RouterConfig::default(),
);
```

---

## 模块职责一句话

Router 路由模式：纯决策节点，通过 RoutingStrategy（LLM 意图分类 / 关键词匹配）选择路由目标并返回 next_node_id，支持 fallback 与嵌套路由（由编排图实现）。
