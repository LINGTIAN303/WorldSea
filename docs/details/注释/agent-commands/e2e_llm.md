# e2e_llm.rs 详细注释文档（agent-commands）

> 来源：`crates/agent-commands/tests/e2e_llm.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-20 行）

# 端到端实测 — 真实 LLM 后端（Phase 5.4 子任务 2）

覆盖主链路：`new_session` → `send_message` → 流式回复。

## 运行方式
需要真实 API Key，通过环境变量注入（**禁止硬编码**）：

```bash
$env:DEEPSEEK_API_KEY = "sk-xxx"   # PowerShell
cargo test --test e2e_llm -- --ignored --nocapture
```

## 设计约束
- 测试 `#[ignore]`：不参与常规 CI，避免无网络/无 Key 时误报。
- API Key 仅从环境变量 `DEEPSEEK_API_KEY` 读取；未设置时测试直接跳过（打印提示）。
- 验证点在主链路上：会话创建成功、Provider 配置回显正确、消息能拿到非空回复。

## Provider 选择
采用 DeepSeek（国内可直连）。可替换为其他已注册 provider：改 `deepseek_config`
中的 `provider` / `model_id` 与下方断言，并设置对应环境变量即可。

## 注释块 2（原文件第 742-751 行）

Router 编排模式 e2e：确定性关键词路由 + 事件发射

Router 是纯决策节点（不执行子 Agent，只输出 next_node_id 让 Orchestrator 调度），
因此本测试用 `KeywordRoutingStrategy` 确定性路由（框架层确定性，不依赖 LLM 决策），
验证：
1. 输入含"代码/函数"关键词 → 路由到 coder（next_node_id）
2. 输入含"文档/翻译"关键词 → 路由到 writer（next_node_id）
3. 无关键词命中且配置 fallback → 走 fallback
4. 决策事件（RouterDecisionMade）正确发射
5. summary 包含路由分支名称

## 注释块 3（原文件第 1067-1077 行）

Tree of Thoughts (ToT) 编排模式 e2e：Beam Search 思维树探索 + 真实 LLM

验证 ToTNode 完整链路：
1. 创建根节点（depth=0，content=原始问题）
2. Beam Search 循环：评分 → 目标检查 → 剪枝 → 分支扩展
3. 终止后找到评分最高的最优思维节点
4. 写入最优思维到 state.messages，meta 记录 best_score / best_depth / total_nodes
5. 返回 Continue + summary（探索完成概要）

分层策略说明：ToT 核心就是 LLM 生成/评分/剪枝，因此全部用真实 LLM
验证链路正确性，无需额外确定性桩。
