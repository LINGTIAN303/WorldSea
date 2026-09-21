//! # LLM 通信层错误
//!
//! ## A5：结构化分类边界（2026-09-17）
//!
//! genai 错误 → [`LlmError`] 的映射**不再做 message 关键字匹配**：先按错误变体
//! 形态判别（结构化：HTTP 状态 / `webc::Error` 变体 / reqwest 传输错误分类），
//! 仅在 provider 只回文本的场合（4xx 响应体、流内 error 载荷）使用**集中登记**
//! 的语义标记做细分。分类结果经 [`From<LlmError> for BackendError`] 一一归一为
//! [`BackendError`] 变体（其 [`BackendError::code`] 是下游唯一路由判据——重试 /
//! 降级 / 压缩触发 / 用户提示，**下游不解析 message**）。

use crate::backend::BackendError;

/// LLM 通信层错误
///
/// 与 [`BackendError`] 的转换：所有 `LlmError` 都可转换为 `BackendError`，
/// 供 `NodeBackendAccessor` 实现使用（A5 起为**一一映射**，不再有 catch-all 降级）。
#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    #[error("Provider 不存在或未适配: {0}")]
    ProviderNotFound(String),

    #[error("模型不存在: {0}")]
    ModelNotFound(String),

    #[error("API Key 缺失: provider={0}")]
    MissingApiKey(String),

    #[error("API Key 无效或已过期: {0}")]
    InvalidCredential(String),

    #[error("配额或余额不足: {0}")]
    Quota(String),

    #[error("上下文超出模型窗口: {0}")]
    ContextWindowExceeded(String),

    #[error("请求超时: {0}")]
    Timeout(String),

    #[error("服务端错误（HTTP {status}）: {message}")]
    ServerError {
        /// HTTP 状态码
        status: u16,
        /// 错误摘要
        message: String,
        /// 服务端 `Retry-After` 建议等待（毫秒）——A5 后续
        retry_after_ms: Option<u64>,
    },

    #[error("BaseURL 无效: {0}")]
    InvalidBaseUrl(String),

    #[error("网络错误: {0}")]
    Network(String),

    #[error("认证失败: {0}")]
    Auth(String),

    #[error("速率限制")]
    RateLimit {
        /// 服务端 `Retry-After` 建议等待（毫秒）——A5 后续
        retry_after_ms: Option<u64>,
    },

    #[error("响应解析失败: {0}")]
    Parse(String),

    #[error("调用被中止")]
    Aborted,

    #[error("不支持的操作: {0}")]
    Unsupported(String),

    #[error("genai 错误: {0}")]
    Genai(String),

    #[error("其他错误: {0}")]
    Other(String),
}

impl From<LlmError> for BackendError {
    fn from(e: LlmError) -> Self {
        match e {
            LlmError::ProviderNotFound(msg) => BackendError::NoAdapter(msg),
            LlmError::ModelNotFound(msg) => BackendError::ModelNotFound(msg),
            LlmError::MissingApiKey(provider) => {
                BackendError::MissingCredential(format!("provider={provider}"))
            }
            LlmError::InvalidCredential(msg) => BackendError::InvalidCredential(msg),
            LlmError::Quota(msg) => BackendError::Quota(msg),
            LlmError::ContextWindowExceeded(msg) => BackendError::ContextWindowExceeded(msg),
            LlmError::Timeout(msg) => BackendError::Timeout(msg),
            LlmError::ServerError {
                status,
                message,
                retry_after_ms,
            } => BackendError::ServerError {
                status,
                message,
                retry_after_ms,
            },
            LlmError::InvalidBaseUrl(msg) => BackendError::Other(format!("BaseURL 无效: {msg}")),
            LlmError::Network(msg) => BackendError::Network(msg),
            LlmError::Auth(msg) => BackendError::Auth(msg),
            LlmError::RateLimit { retry_after_ms } => BackendError::RateLimit { retry_after_ms },
            LlmError::Parse(msg) => BackendError::Parse(msg),
            LlmError::Aborted => BackendError::Aborted,
            LlmError::Unsupported(msg) => BackendError::Unsupported(msg),
            LlmError::Genai(msg) | LlmError::Other(msg) => BackendError::Other(msg),
        }
    }
}

// ─── genai 结构化分类（A5 分类边界）─────────────────────

#[cfg(feature = "llm-genai")]
mod genai_classify {
    use super::LlmError;

    /// 上下文溢出语义标记（集中登记；仅在分类边界使用）
    ///
    /// provider 只在错误文本里给出溢出语义（无独立 code 时），此处把常见措辞
    /// 归一到 `CONTEXT_WINDOW_EXCEEDED`——下游只认 code，不再各自解析文本。
    pub(super) const CONTEXT_OVERFLOW_MARKERS: &[&str] = &[
        "context_length_exceeded",
        "maximum context length",
        "context length",
        "maximum number of tokens",
        "tokens in your messages",
        "context window",
        "too many tokens",
        "reduce the length",
        "上下文长度",
        "上下文超出",
        "超出最大",
    ];

    /// 配额/余额语义标记
    pub(super) const QUOTA_MARKERS: &[&str] = &[
        "insufficient balance",
        "insufficient_quota",
        "insufficient quota",
        "exceeded your current quota",
        "quota exceeded",
        "arrears",
        "余额不足",
        "欠费",
    ];

    /// 认证语义标记（无独立状态码时的兜底细分）
    pub(super) const AUTH_MARKERS: &[&str] = &[
        "invalid api key",
        "invalid_api_key",
        "incorrect api key",
        "authentication fails",
        "unauthorized",
        "api key 无效",
        "api key 错误",
    ];

    /// 文本语义细分（溢出 / 配额 / 认证 / 限流；命中返回对应错误，未命中 `None`）
    ///
    /// `retry_after_ms`（A5 后续）：仅当细分结果为限流时随错误携带（服务端建议等待）。
    pub(super) fn classify_text(text: &str, retry_after_ms: Option<u64>) -> Option<LlmError> {
        let lower = text.to_ascii_lowercase();
        let has = |markers: &[&str]| markers.iter().any(|m| lower.contains(m));
        if has(CONTEXT_OVERFLOW_MARKERS) {
            return Some(LlmError::ContextWindowExceeded(excerpt(text)));
        }
        if has(QUOTA_MARKERS) {
            return Some(LlmError::Quota(excerpt(text)));
        }
        if has(AUTH_MARKERS) {
            return Some(LlmError::InvalidCredential(excerpt(text)));
        }
        if lower.contains("rate limit") || lower.contains("too many requests") {
            return Some(LlmError::RateLimit { retry_after_ms });
        }
        None
    }

    /// 解析 `Retry-After` 响应头值（秒 → 毫秒；A5 后续）
    ///
    /// 仅支持**整数秒**（LLM provider 通行形态，如 `30`）；HTTP-date 形态不解析
    /// （返回 `None` 并留 debug 痕迹，由上层按指数退避处理）。
    pub(super) fn parse_retry_after(raw: &str) -> Option<u64> {
        let trimmed = raw.trim();
        match trimmed.parse::<u64>() {
            Ok(secs) => Some(secs.saturating_mul(1_000)),
            Err(_) => {
                tracing::debug!(
                    value = trimmed,
                    "Retry-After 非整数秒（HTTP-date?），按退避等待"
                );
                None
            }
        }
    }

    /// HTTP 状态 → `LlmError`（结构化主判据；4xx 文本仅在少数分支参与细分）
    ///
    /// `retry_after_ms`（A5 后续）：429 / 5xx 两类可重试码随错误携带（供重试循环取大）。
    pub(super) fn classify_status(
        status: u16,
        body: &str,
        retry_after_ms: Option<u64>,
    ) -> LlmError {
        match status {
            400 => classify_text(body, retry_after_ms)
                .unwrap_or_else(|| LlmError::Other(format!("请求被拒（HTTP 400）: {}", excerpt(body)))),
            401 => LlmError::InvalidCredential(excerpt(body)),
            402 => LlmError::Quota(excerpt(body)),
            // 403 常见于 key 无权限/被禁用；正文若给配额语义则归配额
            403 => classify_text(body, retry_after_ms)
                .unwrap_or_else(|| LlmError::InvalidCredential(excerpt(body))),
            404 => LlmError::ModelNotFound(excerpt(body)),
            408 => LlmError::Timeout(excerpt(body)),
            // 413 Payload Too Large：请求体超限，按溢出处理（触发压缩路径）
            413 => LlmError::ContextWindowExceeded(excerpt(body)),
            429 => classify_text(body, retry_after_ms)
                .unwrap_or(LlmError::RateLimit { retry_after_ms }),
            500..=599 => LlmError::ServerError {
                status,
                message: excerpt(body),
                retry_after_ms,
            },
            _ => LlmError::Other(format!("HTTP {status}: {}", excerpt(body))),
        }
    }

    /// 流内 error 载荷（`ChatResponse { body }`）细分：优先取 provider 的结构化
    /// `error.code` / `error.type`，否则退回文本语义标记
    pub(super) fn classify_stream_payload(body: &serde_json::Value) -> Option<LlmError> {
        let code = body
            .pointer("/error/code")
            .and_then(|v| v.as_str())
            .or_else(|| body.pointer("/error/type").and_then(|v| v.as_str()));
        if let Some(code) = code {
            let lower = code.to_ascii_lowercase();
            if lower == "context_length_exceeded" {
                return Some(LlmError::ContextWindowExceeded(excerpt(&body.to_string())));
            }
            if lower == "insufficient_quota" {
                return Some(LlmError::Quota(excerpt(&body.to_string())));
            }
        }
        let text = body
            .pointer("/error/message")
            .and_then(|v| v.as_str())
            .or_else(|| body.pointer("/message").and_then(|v| v.as_str()))
            .or_else(|| body.as_str());
        text.and_then(|t| classify_text(t, None))
    }

    /// 文本截断（错误消息可读性；按 char 边界安全截断）
    pub(super) fn excerpt(text: &str) -> String {
        const MAX: usize = 400;
        let trimmed = text.trim();
        if trimmed.chars().count() <= MAX {
            return trimmed.to_string();
        }
        let head: String = trimmed.chars().take(MAX).collect();
        format!("{head}…")
    }
}

#[cfg(feature = "llm-genai")]
impl From<genai::Error> for LlmError {
    /// genai 错误 → `LlmError`（**结构化**：变体形态 + HTTP 状态；文本仅在
    /// 4xx / 流内载荷的细分分支参与，见 `genai_classify` 的标记登记）
    fn from(e: genai::Error) -> Self {
        use genai_classify as gc;

        match &e {
            // ── 凭证：键未配置/无鉴权数据（结构化变体）──
            genai::Error::RequiresApiKey { model_iden }
            | genai::Error::NoAuthData { model_iden }
            | genai::Error::NoAuthResolver { model_iden } => {
                LlmError::MissingApiKey(model_iden.model_name.to_string())
            }

            // ── Web 调用：结构化拆到 webc::Error ──
            genai::Error::WebModelCall { webc_error, .. }
            | genai::Error::WebAdapterCall { webc_error, .. } => match webc_error {
                genai::webc::Error::ResponseFailedStatus {
                    status,
                    body,
                    headers,
                } => {
                    // A5 后续：限流/服务端错误可附 `Retry-After` 头（整数秒 → 毫秒）
                    let retry_after_ms = headers
                        .get("retry-after")
                        .and_then(|v| v.to_str().ok())
                        .and_then(gc::parse_retry_after);
                    gc::classify_status(status.as_u16(), body, retry_after_ms)
                }
                genai::webc::Error::ResponseFailedNotJson { body, .. }
                | genai::webc::Error::ResponseFailedInvalidJson { body, .. } => {
                    LlmError::Parse(gc::excerpt(body))
                }
                genai::webc::Error::Reqwest(re) => {
                    if re.is_timeout() {
                        LlmError::Timeout(re.to_string())
                    } else {
                        // 连接失败 / 中断 / 其他传输错误 → 网络（可重试 + 可换 key）
                        LlmError::Network(re.to_string())
                    }
                }
                other => LlmError::Network(other.to_string()),
            },

            // ── 直接 HTTP 错误形态（该变体不带响应头 → 无 retry-after）──
            genai::Error::HttpError { status, body, .. } => {
                gc::classify_status(status.as_u16(), body, None)
            }

            // ── 流内 error 事件（DeepSeek 等在流里报错；含结构化 code 时优先）──
            genai::Error::ChatResponse { body, .. } => {
                gc::classify_stream_payload(body).unwrap_or_else(|| LlmError::Genai(e.to_string()))
            }

            // ── 流层中断：多为传输层，归网络 ──
            genai::Error::WebStream { cause, .. } => LlmError::Network(cause.clone()),

            // ─ 解析类 ──
            genai::Error::StreamParse { .. }
            | genai::Error::InvalidJsonResponseElement { .. }
            | genai::Error::ChatReqHasNoMessages { .. }
            | genai::Error::LastChatMessageIsNotUser { .. } => LlmError::Parse(e.to_string()),

            // ─ 适配/模型映射：Provider 未适配 ──
            genai::Error::ModelMapperFailed { .. } | genai::Error::Resolver { .. } => {
                LlmError::ProviderNotFound(e.to_string())
            }
            genai::Error::AdapterNotSupported { .. } | genai::Error::AdapterKindMismatch { .. } => {
                LlmError::Unsupported(e.to_string())
            }

            // ── 其余（含响应生成失败等）：保留原文，归未分类 ──
            _ => LlmError::Genai(e.to_string()),
        }
    }
}

// ─── 测试 ──────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// LlmError → BackendError 一一映射（A5：不再 catch-all 丢语义）
    #[test]
    fn llm_error_maps_to_backend_error_losslessly() {
        use crate::backend::BackendErrorCode as C;

        let cases: Vec<(LlmError, C)> = vec![
            (LlmError::ProviderNotFound("agnes".into()), C::NoAdapter),
            (LlmError::ModelNotFound("m".into()), C::ModelNotFound),
            (LlmError::MissingApiKey("deepseek".into()), C::MissingCredential),
            (LlmError::InvalidCredential("401".into()), C::InvalidCredential),
            (LlmError::Quota("余额".into()), C::Quota),
            (LlmError::ContextWindowExceeded("溢出".into()), C::ContextWindowExceeded),
            (LlmError::Timeout("10s".into()), C::Timeout),
            (
                LlmError::ServerError {
                    status: 503,
                    message: "bad gateway".into(),
                    retry_after_ms: None,
                },
                C::ServerError,
            ),
            (LlmError::Network("reset".into()), C::Network),
            (LlmError::Auth("403".into()), C::Auth),
            (
                LlmError::RateLimit {
                    retry_after_ms: None,
                },
                C::RateLimit,
            ),
            (LlmError::Parse("json".into()), C::Parse),
            (LlmError::Aborted, C::Aborted),
            (LlmError::Unsupported("x".into()), C::Unsupported),
            (LlmError::Genai("boom".into()), C::Other),
            (LlmError::Other("boom".into()), C::Other),
        ];
        for (llm, code) in cases {
            let backend: BackendError = llm.into();
            assert_eq!(backend.code(), code, "映射: {backend:?}");
        }
    }

    /// 文本语义细分：溢出 / 配额 / 认证 / 限流（集中标记表）
    #[cfg(feature = "llm-genai")]
    #[test]
    fn genai_status_classification_is_structured() {
        use crate::backend::BackendErrorCode as C;
        use genai_classify::{classify_status, classify_stream_payload};

        let cases: Vec<(u16, &str, C)> = vec![
            (401, "unauthorized", C::InvalidCredential),
            (402, "Insufficient Balance", C::Quota),
            (403, "no permission", C::InvalidCredential),
            (404, "model not exist", C::ModelNotFound),
            (408, "request timeout", C::Timeout),
            (
                400,
                "This model's maximum context length is 65536 tokens",
                C::ContextWindowExceeded,
            ),
            (400, "invalid parameters", C::Other),
            (413, "payload too large", C::ContextWindowExceeded),
            (429, "rate limit reached", C::RateLimit),
            (429, "insufficient_quota: quota exceeded", C::Quota),
            (503, "server overloaded", C::ServerError),
        ];
        for (status, body, code) in cases {
            let e: BackendError = classify_status(status, body, None).into();
            assert_eq!(e.code(), code, "HTTP {status} / {body}");
        }

        // 流内 error 载荷：结构化 code 优先
        let payload = serde_json::json!({
            "error": { "code": "context_length_exceeded", "message": "too long" }
        });
        let e: BackendError = classify_stream_payload(&payload).unwrap().into();
        assert_eq!(e.code(), C::ContextWindowExceeded);

        let payload = serde_json::json!({ "error": { "message": "余额不足，请充值" } });
        let e: BackendError = classify_stream_payload(&payload).unwrap().into();
        assert_eq!(e.code(), C::Quota);

        // 无法细分的载荷 → None（交由上层归未分类）
        let payload = serde_json::json!({ "error": { "message": "weird" } });
        assert!(classify_stream_payload(&payload).is_none());
    }

    /// A5 后续：`Retry-After` 解析（整数秒 → 毫秒）与随错误上行
    #[cfg(feature = "llm-genai")]
    #[test]
    fn retry_after_header_parses_and_propagates() {
        use genai_classify::{classify_status, parse_retry_after};

        // 解析：整数秒（含空白）；非整数秒（HTTP-date / 非法值）→ None
        assert_eq!(parse_retry_after("30"), Some(30_000));
        assert_eq!(parse_retry_after(" 5 "), Some(5_000));
        assert_eq!(parse_retry_after("0"), Some(0));
        assert_eq!(
            parse_retry_after("Wed, 21 Oct 2026 07:28:00 GMT"),
            None,
            "HTTP-date 形态不解析（按退避处理）"
        );
        assert_eq!(parse_retry_after("abc"), None);

        // 随错误上行：429 / 5xx 携带；其它码不携带
        let e: BackendError = classify_status(429, "rate limit", Some(30_000)).into();
        assert_eq!(e.retry_after_ms(), Some(30_000));

        let e: BackendError = classify_status(503, "overloaded", Some(12_000)).into();
        assert_eq!(e.retry_after_ms(), Some(12_000));

        let e: BackendError = classify_status(429, "rate limit", None).into();
        assert_eq!(e.retry_after_ms(), None);

        let e: BackendError = classify_status(401, "unauthorized", Some(30_000)).into();
        assert_eq!(e.retry_after_ms(), None, "非可重试码不携带 retry-after");
    }
}