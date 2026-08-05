## 迭代主题 5：Rust 长任务终态闭环单测补全（fail_task / retry_task / clear_retry_marker）

> 本轮不新增功能，而是闭环 Rust 编排路线图「待办」里的 **failTask 终态闭环**（2026-08-02 标记"待收敛后干净环境重测"）。`LongTaskManager` **状态机**（running → completed/failed/cancelled）的 `fail_task`/`retry_task`/`clear_retry_marker` 三个方法此前**无任何单测覆盖**（已有 start/complete/cancel/checkpoint/resume/heartbeat 测试，唯独缺失败终态与可重试失败分支）。补测试把该待办闭环，无需用户手动跑桌面端。

### 决策点 27：补齐终态闭环单测，零生产代码改动

**选择**：仅在 `crates/agent-runtime/src/long_task.rs` 的 `mod tests` 新增 7 个测试，不改动任何生产逻辑：
1. `test_fail_task_terminal_transition`：Running → Failed（设 `ended_at`），终态清空活跃任务、重置 cancel flag、心跳回 Alive。
2. `test_fail_task_no_active_returns_none`：无活跃任务时返回 None。
3. `test_retry_task_keeps_running_and_marks_phase`：可重试失败**不设 `ended_at`**、状态保持 Running、错误记入 `current_phase`（`retry:` 前缀）、标记 checkpoint dirty、活跃任务未被清除。
4. `test_retry_task_truncates_long_error`：错误截断到 100 字符（防 `current_phase` 膨胀）。
5. `test_retry_task_no_active_returns_none`：无活跃任务返回 None。
6. `test_clear_retry_marker`：清除 `retry:` 前缀 phase，状态仍为 Running。
7. `test_clear_retry_marker_ignores_non_retry_phase`：非 `retry:` 前缀的 phase（如 `executing`）不被误清。

**理由**：
- fail_task 与 retry_task 是**语义相反**的两条终态路径（永久失败 vs 可重试失败），是 Loop Engineering 状态机正确性的关键分支，缺测试意味着回归风险无屏障。
- 用测试把 roadmap 待办「failTask 终态闭环」从"待重测"落实为"有自动化验证"，降低对用户手动重测的依赖。
- 纯测试改动零回归风险，符合协作规则"不自动修复未要求的问题"——生产逻辑本就正确，只是缺验证。

**代价**：无。

