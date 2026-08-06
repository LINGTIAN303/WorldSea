use std::time::Instant;

use tracing::{debug, info, warn};

use crate::backend::{BackendError, PromptCallOptions};

use super::{AgentError, AgentLoop};

// ─── Loop Engineering 批次4：通用循环控制 ─────────────

impl AgentLoop {
    /// 调用 LLM，含限流/超时/重试（批次4），详细见 docs/details/注释/agent-runtime/agent.md
    pub(super) async fn call_llm_with_retry(
        &self,
        prompt_input: String,
        options: Option<PromptCallOptions>,
    ) -> Result<crate::backend::PromptResponse, AgentError> {
        let config = self.config_snapshot();
        let max_retries = config.llm_max_retries;
        let base_delay = config.llm_retry_base_delay;
        let timeout = config.llm_timeout;
        let min_interval = config.min_interval_between_calls;

        // 1. 限流：等待最小间隔
        if let Some(min_interval) = min_interval {
            let wait_time = {
                // 同步读取 + 计算需等待的时间，不跨 await 持锁
                let last = self.last_llm_call_time.lock().ok();
                last.and_then(|g| {
                    g.as_ref().and_then(|last_time| {
                        let elapsed = Instant::now().duration_since(*last_time);
                        if elapsed < min_interval {
                            Some(min_interval - elapsed)
                        } else {
                            None
                        }
                    })
                })
            };
            if let Some(wait) = wait_time {
                debug!("LLM 限流：等待 {:?}", wait);
                tokio::time::sleep(wait).await;
            }
        }

        // 2. 调用 + 重试 + 超时
        let mut attempt: u32 = 0;
        loop {
            // 取消检查（每次重试前）
            if self.long_task_manager.is_cancel_requested() {
                info!("call_llm_with_retry: 检测到取消请求，停止重试");
                return Err(AgentError::Aborted);
            }

            // 执行调用（含超时）
            // 注意：timeout 仅包裹 backend.prompt 的未来，不影响后续逻辑
            let call_result = if let Some(t) = timeout {
                match tokio::time::timeout(
                    t,
                    self.backend.prompt(prompt_input.clone(), options.clone()),
                )
                .await
                {
                    Ok(r) => r,
                    Err(_elapsed) => {
                        warn!("LLM 调用超时（{:?}，attempt {}）", t, attempt + 1);
                        Err(BackendError::Other(format!(
                            "LLM 调用超时（{:?}）",
                            t
                        )))
                    }
                }
            } else {
                self.backend
                    .prompt(prompt_input.clone(), options.clone())
                    .await
            };

            // 记录调用时间（无论成功失败都记录，用于限流；同步写入不跨 await）
            if let Ok(mut last) = self.last_llm_call_time.lock() {
                *last = Some(Instant::now());
            }

            match call_result {
                Ok(resp) => return Ok(resp),
                Err(e) => {
                    if attempt >= max_retries {
                        warn!(
                            "LLM 调用失败，已达最大重试次数 {}：{}",
                            max_retries, e
                        );
                        // Loop Engineering 批次5：广播重试耗尽事件
                        self.emit_loop_retry_exhausted(max_retries, &e.to_string())
                            .await;
                        return Err(AgentError::from(e));
                    }
                    let delay = base_delay * 2u32.pow(attempt);
                    warn!(
                        "LLM 调用失败（attempt {}/{}），{:?} 后重试：{}",
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
}
