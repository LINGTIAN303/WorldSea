use std::time::{Duration, Instant};

use tracing::{debug, info, warn};

use crate::backend::{BackendError, BackendErrorCode, PromptCallOptions};

use super::{AgentError, AgentLoop};

// ── Loop Engineering 批次4：通用循环控制 ─────────────
// ─── A5（2026-09-17）：按稳定错误码路由（重试 / 降级 / 压缩触发 / 用户提示）──
// ─── A5 后续（2026-09-17）：`Retry-After` 头支持 ──

/// `Retry-After` 等待上限（毫秒）
///
/// 服务端建议等待超此上限时**截断**（安全不变量：不做成配置项）——避免单次请求
/// 长时间无反馈；等待期间 `LoopEngRetrying` 事件对前端可见。
const RETRY_AFTER_CAP_MS: u64 = 60_000;

/// 计算本次重试的实际等待：指数退避与 `Retry-After` **取大**，服务端建议超上限截断
///
/// - 服务端建议（限流窗口）通常大于客户端退避 → 以其为准；
/// - 截断时 `warn!` 留痕（原始建议值可回看）。
pub(super) fn retry_delay(backoff: Duration, retry_after_ms: Option<u64>) -> Duration {
    let Some(ms) = retry_after_ms else {
        return backoff;
    };
    let server = Duration::from_millis(ms);
    if server <= backoff {
        return backoff;
    }
    let capped = Duration::from_millis(ms.min(RETRY_AFTER_CAP_MS));
    if capped < server {
        warn!(
            "服务端 Retry-After {}ms 超上限，截断为 {}ms",
            ms, RETRY_AFTER_CAP_MS
        );
    }
    capped
}

impl AgentLoop {
    /// 调用 LLM，含限流/超时/重试（批次4），详细见 docs/details/注释/agent-runtime/agent.md
    ///
    /// ## A5 错误码路由（本层职责：重试 + 压缩触发；降级在 backend 内、用户提示在 run 收口）
    ///
    /// | 错误码 | 处置 |
    /// |---|---|
    /// | `CONTEXT_WINDOW_EXCEEDED` | **强制压缩一次**（`compact_for_overflow`：压缩 + 视图重同步）后重发；不计入重试预算，最高一次防死循环；压缩无收益则按不可重试失败 |
    /// | 可重试码（`NETWORK` / `TIMEOUT` / `RATE_LIMIT` / `SERVER_ERROR` / `OTHER`） | 指数退避重试（既有语义；`OTHER` 保守可重试，未分类错误不降低既有韧性） |
    /// | 其余码（凭证 / 配额 / 解析 / 中止 / 模型不存在…） | **立即失败**——不浪费退避窗口，交由用户提示 |
    /// | `EMPTY_RESPONSE`（无文本且无工具调用） | 重发一次；仍空则维持既有语义（返回空响应） |
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

        // 2. 调用 + 重试 + 超时（A5：按错误码路由，见方法文档的表）
        let mut attempt: u32 = 0;
        let mut overflow_retried = false;
        let mut empty_retried = false;
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
                        Err(BackendError::Timeout(format!("LLM 调用超时（{:?}）", t)))
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
                Ok(resp) => {
                    // A5：空响应（无文本且无工具调用）→ 重发一次；仍空则维持既有语义返回
                    if resp.text.trim().is_empty()
                        && resp.tool_calls.is_empty()
                        && !empty_retried
                    {
                        empty_retried = true;
                        warn!(
                            "{}（code={}），重发一次",
                            BackendError::EmptyResponse,
                            BackendErrorCode::EmptyResponse.as_str()
                        );
                        continue;
                    }
                    return Ok(resp);
                }
                Err(e) => {
                    let code = e.code();

                    // A5 压缩触发：provider 溢出（计量的地面真值）→ 强制压缩一次 + 重发
                    if code == BackendErrorCode::ContextWindowExceeded && !overflow_retried {
                        overflow_retried = true;
                        match self.compact_for_overflow().await {
                            Ok(outcome)
                                if outcome.mode != "none" && outcome.saved_tokens > 0 =>
                            {
                                warn!(
                                    "provider 判定上下文溢出（code={}）→ 已压缩（{} → {} token，模式 {}）并重发请求",
                                    code.as_str(),
                                    outcome.before_tokens,
                                    outcome.after_tokens,
                                    outcome.mode
                                );
                                continue;
                            }
                            Ok(outcome) => {
                                warn!(
                                    "provider 判定上下文溢出，但压缩无可释放（模式 {}）→ 不重发",
                                    outcome.mode
                                );
                            }
                            Err(err) => {
                                warn!("provider 判定上下文溢出，但压缩失败（{err}）→ 不重发");
                            }
                        }
                    }

                    // A5 路由：不可重试码立即失败（凭证/配额/解析/中止/模型不存在…）
                    if !code.is_retryable() {
                        warn!(
                            "LLM 调用失败（不可重试，code={}）：{}",
                            code.as_str(),
                            e
                        );
                        return Err(AgentError::from(e));
                    }

                    if attempt >= max_retries {
                        warn!(
                            "LLM 调用失败，已达最大重试次数 {}（code={}）：{}",
                            max_retries,
                            code.as_str(),
                            e
                        );
                        // Loop Engineering 批次5：广播重试耗尽事件
                        self.emit_loop_retry_exhausted(max_retries, &e.to_string())
                            .await;
                        return Err(AgentError::from(e));
                    }
                    // A5 后续：退避与 `Retry-After` 取大（服务端建议优先；超 60s 截断）
                    let delay = retry_delay(base_delay * 2u32.pow(attempt), e.retry_after_ms());
                    warn!(
                        "LLM 调用失败（attempt {}/{}，code={}），{:?} 后重试：{}",
                        attempt + 1,
                        max_retries,
                        code.as_str(),
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