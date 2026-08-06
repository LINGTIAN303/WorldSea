# loop_control.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/loop_control.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-27 行）

# Loop Engineering — 循环控制组件

阶段 2.6 实现，对应 TS 版 `loopControlStore.ts` + `useLoopControl.ts`。

## 职责
1. **速率限制（RateLimiter）**：限制 turns / tool_calls / tokens / duration
2. **重试策略（RetryPolicy）**：LLM / tool 失败时自动重试（指数退避）
3. **软超时（SoftTimeout）**：超时提醒但不强制终止（符合"无强制中断"原则）
4. **看门狗（Watchdog）**：监控任务活跃度，触发恢复机制

## 设计原则
- **协作式 > 强制式**：所有控制均为软限制，通过 `should_stop()` / `should_retry()`
  返回建议，由 AgentLoop 决定是否停止
- **可配置**：所有阈值通过 `LoopControlConfig` 注入，运行时不可修改
- **无状态**：RateLimiter / RetryPolicy 本身无锁，状态由 AgentLoop 持有
- **可观测**：所有控制决策通过 `LoopEngEvent` 事件通知前端

## 与 `long_task.rs` 的关系
- `LongTaskManager` 负责**任务生命周期**（启动/完成/取消/checkpoint）
- `LoopControl` 负责**循环内部控制**（速率/重试/超时/看门狗）
- 两者协作：AgentLoop 持有 `Arc<LongTaskManager>` + `Arc<LoopController>`

## 与 TS 版的差异
- 状态从 `ref(undefined)` 改为 Rust 结构体字段
- 重试定时器从 `setTimeout` 改为 `tokio::time::sleep`
- 事件从 `emit` 改为 `OrchestratorEvent::LoopEng*`
- 速率限制从 `Map<task_id, Counter>` 改为 `AtomicU32`（每 AgentLoop 独立）

---

## 注释块 2（原文件第 38-48 行）

Loop Engineering 总配置

聚合速率限制、重试策略、软超时、看门狗四项配置。
通过 `AgentLoopConfig::loop_control` 注入到 AgentLoop。

# 默认值
默认配置较为宽松，避免影响正常任务：
- 速率限制：100 turns / 200 tool_calls / 100k tokens / 6h
- 重试：3 次，指数退避 1s/2s/4s
- 软超时：30min 提醒，不强制终止
- 看门狗：5min 无活动触发恢复

---

## 注释块 3（原文件第 190-202 行）

速率限制器（线程安全，无锁）

跟踪 turns / tool_calls / tokens / duration 四个维度，
任意超限即 `should_stop() = true`。

# 使用方式
```ignore
let limiter = RateLimiter::new(config);
limiter.inc_turns();
if limiter.should_stop() {
    // AgentLoop 优雅停止
}
```

---

## 注释块 4（原文件第 345-361 行）

重试策略执行器

根据 `RetryConfig` 判断是否应该重试，并计算退避时长。

# 使用方式
```ignore
let policy = RetryPolicy::new(config);
match policy.should_retry(&error, attempt) {
    Some(backoff) => {
        tokio::time::sleep(backoff).await;
        // 重试
    }
    None => {
        // 不重试，返回错误
    }
}
```
