use tracing::{debug, info, warn};

use crate::event::{AgentEvent, OrchestratorEvent};
use crate::tool::ToolError;
use crate::types::{MessageRole, OrchestratorMessage, ToolCall};

use super::{AgentError, AgentLoop};

impl AgentLoop {
    /// 执行单个工具调用，含超时/重试（批次4），详细见 docs/details/注释/agent-runtime/agent.md
    async fn execute_tool_with_retry(
        &self,
        name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let config = self.config_snapshot();
        let max_retries = config.tool_max_retries;
        let base_delay = config.tool_retry_base_delay;
        let timeout = config.tool_timeout;

        let mut attempt: u32 = 0;
        loop {
            // 取消检查（每次重试前）
            if self.long_task_manager.is_cancel_requested() {
                info!("execute_tool_with_retry: 检测到取消请求，停止重试");
                return Err(ToolError::Aborted);
            }

            // 执行调用（含超时）
            let call_result = if let Some(t) = timeout {
                match tokio::time::timeout(t, self.tool_bus.call_tool(name, args.clone())).await {
                    Ok(r) => r,
                    Err(_elapsed) => {
                        warn!("工具 {} 执行超时（{:?}，attempt {}）", name, t, attempt + 1);
                        Err(ToolError::Timeout)
                    }
                }
            } else {
                self.tool_bus.call_tool(name, args.clone()).await
            };

            match call_result {
                Ok(v) => return Ok(v),
                Err(e) => {
                    if attempt >= max_retries {
                        // Loop Engineering 批次5：广播重试耗尽事件
                        self.emit_loop_retry_exhausted(max_retries, &e.to_string())
                            .await;
                        return Err(e);
                    }
                    let delay = base_delay * 2u32.pow(attempt);
                    warn!(
                        "工具 {} 执行失败（attempt {}/{}），{:?} 后重试：{}",
                        name,
                        attempt + 1,
                        max_retries,
                        delay,
                        e
                    );
                    // Loop Engineering 批次5：广播正在重试事件（attempt 从 1 计）
                    self.emit_loop_retrying(
                        attempt + 1,
                        max_retries,
                        delay.as_millis() as u64,
                        &e.to_string(),
                    )
                    .await;
                    tokio::time::sleep(delay).await;
                    attempt += 1;
                }
            }
        }
    }

    /// 执行工具调用（串行/并行），详细见 docs/details/注释/agent-runtime/agent.md
    pub(super) async fn execute_tool_calls(
        &self,
        tool_calls: Vec<ToolCall>,
    ) -> Result<Vec<OrchestratorMessage>, AgentError> {
        let config_snapshot = self.config_snapshot();
        if config_snapshot.parallel_tool_calls && tool_calls.len() > 1 {
            self.execute_tool_calls_parallel(tool_calls).await
        } else {
            self.execute_tool_calls_serial(tool_calls).await
        }
    }

    /// 串行执行工具调用
    ///
    /// # Loop Engineering 批次4 集成
    /// 通过 [`execute_tool_with_retry`] 包裹每个工具调用：
    /// - 超时：`tool_timeout` 限制单次工具执行时长
    /// - 重试：`tool_max_retries` 控制失败重试次数（默认 0=不重试）
    /// - 取消：每次重试前检查 `cancel_flag`
    async fn execute_tool_calls_serial(
        &self,
        tool_calls: Vec<ToolCall>,
    ) -> Result<Vec<OrchestratorMessage>, AgentError> {
        let mut results = Vec::with_capacity(tool_calls.len());

        for tc in tool_calls {
            // 广播 ToolCallStart
            self.broadcast(OrchestratorEvent::Agent(AgentEvent::ToolCallStart {
                tool_call_id: tc.id.clone(),
                name: tc.name.clone(),
                args: tc.args.clone(),
            }))
            .await;

            debug!("执行工具: {} (call_id={})", tc.name, tc.id);

            // Loop Engineering 批次5：记录工具调用计数（供速率限制 tool_calls 维度）
            if self.loop_control_enabled() {
                self.loop_controller.rate_limiter.inc_tool_calls();
            }

            // 调用工具（含重试/超时，批次4）
            let tool_result = self.execute_tool_with_retry(&tc.name, tc.args.clone()).await;

            let result_value = match tool_result {
                Ok(v) => v,
                Err(e) => {
                    warn!("工具 {} 执行失败: {}", tc.name, e);
                    serde_json::json!({
                        "error": e.to_string(),
                        "tool": tc.name,
                    })
                }
            };

            // 广播 ToolCallEnd
            self.broadcast(OrchestratorEvent::Agent(AgentEvent::ToolCallEnd {
                tool_call_id: tc.id.clone(),
                result: result_value.clone(),
            }))
            .await;

            // 构造 toolResult 消息
            let tool_result_msg = OrchestratorMessage {
                role: MessageRole::ToolResult,
                content: serde_json::to_string(&result_value).unwrap_or_else(|_| {
                    format!("{{\"error\":\"结果序列化失败\",\"tool\":\"{}\"}}", tc.name)
                }),
                tool_calls: Vec::new(),
                tool_call_id: Some(tc.id.clone()),
                meta: None,
            };

            results.push(tool_result_msg);
        }

        Ok(results)
    }

    /// 并行执行工具调用（基于 `tokio::task::JoinSet`）
    ///
    /// 事件广播顺序：
    /// - `ToolCallStart` × N（按原顺序，spawn 前）
    /// - 工具并发执行（每个 task 不广播，避免事件交错）
    /// - `ToolCallEnd` × N（按原索引顺序，结果收集完成后）
    async fn execute_tool_calls_parallel(
        &self,
        tool_calls: Vec<ToolCall>,
    ) -> Result<Vec<OrchestratorMessage>, AgentError> {
        // 1. 按顺序广播所有 ToolCallStart
        for tc in &tool_calls {
            self.broadcast(OrchestratorEvent::Agent(AgentEvent::ToolCallStart {
                tool_call_id: tc.id.clone(),
                name: tc.name.clone(),
                args: tc.args.clone(),
            }))
            .await;
        }

        // 2. 用 JoinSet 并发执行（含并行模式重试/超时限制说明），详细见 docs/details/注释/agent-runtime/agent.md
        let mut join_set: tokio::task::JoinSet<
            (usize, String, String, serde_json::Value),
        > = tokio::task::JoinSet::new();

        for (idx, tc) in tool_calls.into_iter().enumerate() {
            let tool_bus = self.tool_bus.clone();
            let call_id = tc.id.clone();
            let tool_name = tc.name.clone();
            let args = tc.args.clone();

            // Loop Engineering 批次5：记录工具调用计数（供速率限制 tool_calls 维度）
            if self.loop_control_enabled() {
                self.loop_controller.rate_limiter.inc_tool_calls();
            }

            join_set.spawn(async move {
                debug!("并行执行工具: {} (call_id={})", tool_name, call_id);
                let result_value = match tool_bus.call_tool(&tool_name, args).await {
                    Ok(v) => v,
                    Err(e) => {
                        warn!("工具 {} 并行执行失败: {}", tool_name, e);
                        serde_json::json!({
                            "error": e.to_string(),
                            "tool": tool_name,
                        })
                    }
                };
                (idx, call_id, tool_name, result_value)
            });
        }

        // 3. 收集所有结果
        let mut indexed_results: Vec<(usize, String, String, serde_json::Value)> =
            Vec::with_capacity(join_set.len());

        while let Some(joined) = join_set.join_next().await {
            match joined {
                Ok(item) => indexed_results.push(item),
                Err(join_err) => {
                    // JoinError 意味着 task panic，用占位结果填补
                    warn!("工具并行执行 task panic: {}", join_err);
                    indexed_results.push((
                        0, // 占位索引，排序后会被覆盖或放到最前
                        String::new(),
                        String::new(),
                        serde_json::json!({
                            "error": format!("task panic: {join_err}"),
                        }),
                    ));
                }
            }
        }

        // 4. 按原索引排序，保证 toolResult 顺序与 tool_calls 一致
        indexed_results.sort_by_key(|(idx, _, _, _)| *idx);

        // 5. 按顺序广播 ToolCallEnd 并构造 toolResult 消息
        let mut results = Vec::with_capacity(indexed_results.len());
        for (_, call_id, tool_name, result_value) in indexed_results {
            self.broadcast(OrchestratorEvent::Agent(AgentEvent::ToolCallEnd {
                tool_call_id: call_id.clone(),
                result: result_value.clone(),
            }))
            .await;

            let tool_result_msg = OrchestratorMessage {
                role: MessageRole::ToolResult,
                content: serde_json::to_string(&result_value).unwrap_or_else(|_| {
                    format!("{{\"error\":\"结果序列化失败\",\"tool\":\"{}\"}}", tool_name)
                }),
                tool_calls: Vec::new(),
                tool_call_id: Some(call_id),
                meta: None,
            };

            results.push(tool_result_msg);
        }

        Ok(results)
    }
}
