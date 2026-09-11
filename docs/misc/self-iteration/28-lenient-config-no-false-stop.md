# 迭代 28：宽松配置默认不误停 — 单元级回归保护

> 状态：执行中
> 决策点：84
> 关联待办：桌面端实测宽松配置默认不误停止

## 背景

迭代 24 将 `LoopController` 接入 `AgentLoop` 后，内建自动控制默认启用宽松配置
（`LoopControlConfig::default()`：100 turns / 200 tool_calls / 100k tokens / 6h）。
当时遗留待办"桌面端实测宽松配置默认不误停止"——需要在真实桌面环境用真实 LLM 验证
正常对话任务不会被速率限制误停。

## 决策点 84：用单元级回归测试替代（部分替代）桌面实测

**选择**：在 `agent-runtime` 新增自动化单测 `default_lenient_config_does_not_stop_normal_loop`，
用真实默认 `LoopControlConfig` 运行一个"3 轮工具调用 + 1 轮最终文本"的正常流，断言：

1. `run()` 返回 `Ok("任务完成")`（正常收敛，未被停止）；
2. 记录的 `turns` 远低于默认上限（< 10，默认 100）；
3. 未广播任何 `LoopEngRateLimitExceeded` 事件。

**理由**：
- 该待办的核心是"宽松配置不应误停正常任务"，本质是**速率限制阈值足够宽松**的属性。
  这是一个可单元化、可重复验证的确定性属性，用单测覆盖比手工桌面实测更可靠、可回归。
- 桌面实测（真实 LLM + 交互）在此自动化迭代环境下难以稳定复现，且属于一次性验证；
  单元回归测试能长期守护该属性不受后续改动破坏。
- 走的是生产默认路径（不显式 `with_loop_control`），与真实桌面行为一致。

**边界说明**：本测试验证的是"正常收敛流不被宽松配置误停"。桌面端真实 LLM 的
端到端行为（含真实 tool 调用、软超时/看门狗长时提醒）仍建议在有真实模型时做一次
人工冒烟验证，但速率限制层的能力已由本测试兜底。

## 验证

- `cargo test --lib default_lenient_config_does_not_stop_normal_loop` → ok
- `cargo test --lib`（agent-runtime）→ 168 passed（原 167 + 新增 1），无回归

## 影响面

- 仅 `crates/agent-runtime/src/agent.rs` 测试模块增补，零生产代码改动。
- 更新 project_memory 待办：将"桌面端实测"拆分为"单元级已覆盖 + 桌面冒烟待人工"。