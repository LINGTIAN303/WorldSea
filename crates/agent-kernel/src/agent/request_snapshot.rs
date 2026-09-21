//! # 请求快照（阶段 3 · A2 补齐④）
//!
//! 设计见 [08-请求头快照设计草案](../../../../docs/plans/2026-09-16-deepseek-harness-方向探究/08-请求头快照设计草案.md)
//! （裁定 D9-D14：新表 + 内容寻址去重 / 结构级重建 / 同步文件 WAL + 异步落库 / 级联删除 / 旁路全收 / 无 UI）。
//!
//! ## 要解决的问题
//!
//! 「模型为什么这样回答」目前只能靠 `info!` 日志猜测：系统提示词只存最新一份、
//! 参数零留痕、消息侧缺「某次请求看到哪一版视图」这条边。本模块在**每次请求派发前**
//! 采集快照（除消息以外的一切 + 视图增量），命令层同步落 WAL 后异步入表——
//! `快照 + 视图增量` 即任一请求的（结构级）纯函数重建。
//!
//! ## 视图增量的判据（为什么不是"只存 header"）
//!
//! 请求看到的视图 = 最近一次写穿的 `session_live` **+ 在途消息**；在途消息在崩溃前
//! 不落在 `session_log` 里（写穿发生在轮次结束），若快照只记「消息条数」这条边就断了。
//! 故本模块记录**消息视图本身**，且只记增量：
//! - 上一条快照视图是当前视图的**前缀** → 仅记新增消息（[`ViewUpdate::Appended`]）
//! - 否则（折叠 / 裁剪 / 回填 / 恢复等改写了中段）→ 记全量视图（[`ViewUpdate::Full`]）
//!
//! 判据是**逐字段等值比对**（`OrchestratorMessage: PartialEq`），不是哈希——
//! 假前缀会静默损坏重建结果，宁可多记一次全量。
//!
//! ## 同步分发即落 WAL
//!
//! 事件经总线**同步分发**：命令层监听器在派发前把快照行同步追加进会话 WAL 文件，
//! 崩溃后由下一次装载补齐入库（见 `agent-commands::request_snapshot`）。

use std::sync::{Arc, Mutex as StdMutex};

use serde::{Deserialize, Serialize};

use super::AgentLoop;
use crate::backend::{PromptCallOptions, ThinkingLevel};
use crate::event::OrchestratorEvent;
use crate::event_bus::{Listener, ListenerOutcome};
use crate::types::OrchestratorMessage;

/// 单个请求的完整快照（"除消息以外的一切" + 视图增量）
///
/// 字段口径与 [PromptCallOptions] / `ProviderConfig` 对齐——重建 = 本快照 +
/// 视图增量还原的消息序列 + （旁路调用）`material_ref` 指向的外置材料。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestSnapshot {
    /// 采集时点（Unix 毫秒；排序与诊断用）
    pub captured_at_ms: u64,
    /// 调用用途：`main`（主链路）/ `compaction`（压缩摘要旁路）/ 其他旁路标签
    pub purpose: String,
    /// Provider id（如 `deepseek`）
    pub provider: String,
    /// 模型 id（热切换后生效值）
    pub model_id: String,
    /// 采样温度
    pub temperature: Option<f32>,
    /// 输出上限
    pub max_tokens: Option<u32>,
    /// Top P
    pub top_p: Option<f32>,
    /// Top K
    pub top_k: Option<u32>,
    /// 思考模式开关
    pub thinking_mode: Option<bool>,
    /// 思考级别
    pub thinking_level: Option<ThinkingLevel>,
    /// 静默调用标记（true = 不广播流式事件）
    pub silent: bool,
    /// 组装后的完整系统提示词（命令层按内容哈希去重存储）
    pub system_prompt: Option<String>,
    /// 工具定义全量 JSON（命令层按内容哈希去重存储；无工具为 None）
    pub tools_json: Option<String>,
    /// 工具名清单（可读性；重建时以 `tools_json` 为准）
    pub tools_names: Vec<String>,
    /// 旁路调用的材料坐标（外置原文 hash）——压缩摘要 = 模板 + 该材料，可据此重建指令
    pub material_ref: Option<String>,
    /// 视图增量（上条快照 → 本请求视图）
    pub view_update: ViewUpdate,
}

/// 视图增量：上一条快照 → 本请求派发时的消息视图
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ViewUpdate {
    /// 仅追加（上条快照视图是当前视图的前缀）——payload 为新增消息
    Appended {
        /// 新增的消息（按视图顺序）
        messages: Vec<OrchestratorMessage>,
    },
    /// 结构性改写（折叠 / 裁剪 / 回填 / 状态恢复…）——payload 为全量视图
    Full {
        /// 本请求派发时的完整视图
        messages: Vec<OrchestratorMessage>,
    },
}

/// 前序视图是否为当前视图的前缀（**逐字段等值**；是则返回前序长度）
pub(crate) fn prefix_len(prev: &[OrchestratorMessage], current: &[OrchestratorMessage]) -> Option<usize> {
    if prev.len() > current.len() {
        return None;
    }
    if prev.iter().zip(current.iter()).all(|(a, b)| a == b) {
        Some(prev.len())
    } else {
        None
    }
}

/// 当前 Unix 毫秒时间戳
fn now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 构造一条**旁路请求快照**（带 `purpose` 标签的直调请求；D13「旁路全收」扩展）
///
/// 适用于不经 `AgentLoop` 采集点、直调 [`crate::backend::NodeBackendAccessor::prompt`]
/// 的调用（pattern 引擎：路由判型 / Reflection·Refine / ToT / GoT / 编排适配器）。
/// 视图取**该请求实际发送的消息**（backend 内部视图：最近一次 `set_messages` +
/// 其后累积）——与主链路 `state.messages` 视图不同构，故**恒记全量**，自含可重建；
/// 入链后由 [`SnapshotChainAnchor`] 使主链路增量基点失效（下一条本环快照记全量），
/// 保证「重建基底 == 采集器基点」不变式（否则重建会静默错位）。
///
/// 字段口径与 [`AgentLoop::capture_request_snapshot`] 一致；`material_ref` 恒 `None`
/// （旁路材料由请求消息自含）。
pub fn build_bypass_snapshot(
    purpose: &str,
    provider: &str,
    model_id: &str,
    opts: &PromptCallOptions,
    messages: &[OrchestratorMessage],
) -> RequestSnapshot {
    let tools_json = if opts.tools.is_empty() {
        None
    } else {
        serde_json::to_string(&opts.tools).ok()
    };
    RequestSnapshot {
        captured_at_ms: now_unix_ms(),
        purpose: purpose.to_string(),
        provider: provider.to_string(),
        model_id: model_id.to_string(),
        temperature: opts.temperature,
        max_tokens: opts.max_tokens,
        top_p: opts.top_p,
        top_k: opts.top_k,
        thinking_mode: opts.thinking_mode,
        thinking_level: opts.thinking_level,
        silent: opts.silent,
        system_prompt: opts.system_prompt_override.clone(),
        tools_json,
        tools_names: opts.tools.iter().map(|t| t.name.clone()).collect(),
        material_ref: None,
        view_update: ViewUpdate::Full {
            messages: messages.to_vec(),
        },
    }
}

/// 链路锚点 listener（订阅本环 `REQUEST_SNAPSHOT_CAPTURED`）：**旁路行入链 → 本环
/// 增量基点失效**
///
/// 判据：`purpose` 非本环采集标签（`main` / `compaction`）即视为旁路行（由
/// `GenaiBackend` 按 `purpose` 标签发出，经 `BackendEventBridge` 转发到本环）。
/// 命中时把本环 tracker 置 `None` → 下一条本环快照必记全量：重建链只认
/// 「`Full` 重置基底 / `Appended` 拼接增量」，旁路行插入后 DB 基底已变，若本环
/// 仍按旧基点记增量，重建将**静默错位**——宁可多记一次全量。
///
/// 事件驱动的副作用与 DB 行同源：桥接竞争丢弃事件时，行与本重置一并缺席，链仍自洽。
pub struct SnapshotChainAnchor {
    tracker: Arc<StdMutex<Option<Vec<OrchestratorMessage>>>>,
}

impl SnapshotChainAnchor {
    pub fn new(tracker: Arc<StdMutex<Option<Vec<OrchestratorMessage>>>>) -> Self {
        Self { tracker }
    }
}

impl Listener for SnapshotChainAnchor {
    fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
        if let OrchestratorEvent::RequestSnapshotCaptured { snapshot } = event {
            if !matches!(snapshot.purpose.as_str(), "main" | "compaction") {
                if let Ok(mut tracker) = self.tracker.lock() {
                    *tracker = None;
                }
            }
        }
        ListenerOutcome::Continue
    }
}

impl AgentLoop {
    /// 采集并广播一次请求快照（阶段 3 · ④）——**请求派发之前**调用
    ///
    /// - 事件经总线同步分发：命令层监听器在派发前同步落 WAL（崩溃可补齐）
    /// - 视图增量与上一条快照比对：前缀相同 → `Appended`；否则 → `Full`
    /// - 锁中毒 / 序列化失败等仅告警降级——快照是诊断增强，不阻断主链路
    pub(super) async fn capture_request_snapshot(
        &self,
        purpose: &str,
        options: &PromptCallOptions,
        material_ref: Option<String>,
    ) {
        let view = self.state.lock().await.messages.clone();
        let view_update = {
            let Ok(mut tracker) = self.request_snapshot_tracker.lock() else {
                return;
            };
            let update = match tracker.as_ref() {
                Some(prev) => match prefix_len(prev, &view) {
                    Some(n) => ViewUpdate::Appended {
                        messages: view[n..].to_vec(),
                    },
                    None => ViewUpdate::Full {
                        messages: view.clone(),
                    },
                },
                None => ViewUpdate::Full {
                    messages: view.clone(),
                },
            };
            *tracker = Some(view);
            update
        };

        let (provider, model_id) = match self.backend.current_provider_config().await {
            Some(config) => (
                config.provider_id().to_string(),
                config.model_id().to_string(),
            ),
            None => (String::new(), self.backend.current_model().await),
        };
        let tools_json = if options.tools.is_empty() {
            None
        } else {
            serde_json::to_string(&options.tools).ok()
        };
        let snapshot = RequestSnapshot {
            captured_at_ms: now_unix_ms(),
            purpose: purpose.to_string(),
            provider,
            model_id,
            temperature: options.temperature,
            max_tokens: options.max_tokens,
            top_p: options.top_p,
            top_k: options.top_k,
            thinking_mode: options.thinking_mode,
            thinking_level: options.thinking_level,
            silent: options.silent,
            system_prompt: options.system_prompt_override.clone(),
            tools_json,
            tools_names: options.tools.iter().map(|t| t.name.clone()).collect(),
            material_ref,
            view_update,
        };
        self.broadcast(OrchestratorEvent::RequestSnapshotCaptured { snapshot })
            .await;
    }
}

// ─── 测试 ───────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::MessageRole;

    fn msg(role: MessageRole, content: &str) -> OrchestratorMessage {
        OrchestratorMessage {
            role,
            content: content.to_string(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        }
    }

    /// 前缀判据：同前缀 → Some(长度)；内容不等 / 前序更长 → None（宁可全量）
    #[test]
    fn prefix_requires_exact_field_equality() {
        let a = vec![msg(MessageRole::User, "你好"), msg(MessageRole::Assistant, "好的")];
        let longer = {
            let mut v = a.clone();
            v.push(msg(MessageRole::User, "继续"));
            v
        };
        assert_eq!(prefix_len(&a, &longer), Some(2));

        // 内容不同（同长度）→ 非前缀
        let changed = vec![msg(MessageRole::User, "你好"), msg(MessageRole::Assistant, "改了")];
        assert_eq!(prefix_len(&a, &changed), None);

        // 前序更长 → 非前缀（视图被裁剪）
        assert_eq!(prefix_len(&longer, &a), None);

        // 空视图是任何视图的前缀
        assert_eq!(prefix_len(&[], &a), Some(0));
    }

    /// 结构化字段参与比对（meta 差异也算改写 → 全量）
    #[test]
    fn prefix_detects_meta_only_changes() {
        let mut with_meta = msg(MessageRole::Assistant, "好的");
        let plain = with_meta.clone();
        with_meta
            .meta
            .get_or_insert_with(Default::default)
            .insert("thinking".into(), serde_json::json!("推理"));
        assert_eq!(prefix_len(&[plain], &[with_meta]), None, "meta 差异应判为非前缀");
    }

    /// 旁路快照：header 随 options 实际值、视图恒全量且等于实际请求消息
    #[test]
    fn bypass_snapshot_records_header_and_actual_request_view() {
        let tool = crate::tool::ToolDefinition {
            name: "route_target_decision".into(),
            description: "决策工具".into(),
            parameters: serde_json::json!({ "type": "object" }),
        };
        let opts = PromptCallOptions {
            system_prompt_override: Some("路由系统提示".into()),
            tools: vec![tool],
            temperature: Some(0.2),
            silent: true,
            purpose: Some("router".into()),
            ..Default::default()
        };
        let sent = vec![
            msg(MessageRole::System, "路由系统提示"),
            msg(MessageRole::User, "帮我写代码"),
            msg(MessageRole::User, "用户输入：帮我写代码\n可用路由分支：…"),
        ];
        let snap = build_bypass_snapshot("router", "deepseek", "deepseek-v4-flash", &opts, &sent);

        assert_eq!(snap.purpose, "router");
        assert_eq!(snap.provider, "deepseek");
        assert_eq!(snap.model_id, "deepseek-v4-flash");
        assert_eq!(snap.system_prompt.as_deref(), Some("路由系统提示"));
        assert_eq!(snap.temperature, Some(0.2));
        assert!(snap.silent);
        assert_eq!(snap.tools_names, vec!["route_target_decision".to_string()]);
        assert!(snap.tools_json.is_some(), "有工具时应带全量 schema");
        assert!(snap.material_ref.is_none());
        match &snap.view_update {
            ViewUpdate::Full { messages } => {
                assert_eq!(messages, &sent, "旁路视图应为实际发送的消息（含 pattern 提示）");
            }
            other => panic!("旁路快照应恒为全量: {other:?}"),
        }
    }

    /// 链路锚点：旁路行入链 → 本环基点置空；本环行（main/compaction）不触碰
    #[test]
    fn chain_anchor_resets_base_only_for_bypass_rows() {
        let tracker = Arc::new(StdMutex::new(Some(vec![msg(MessageRole::User, "你好")])));
        let anchor = SnapshotChainAnchor::new(Arc::clone(&tracker));

        let bypass = build_bypass_snapshot(
            "router",
            "deepseek",
            "m",
            &PromptCallOptions::default(),
            &[msg(MessageRole::User, "路由")],
        );
        anchor.call(&OrchestratorEvent::RequestSnapshotCaptured {
            snapshot: bypass,
        });
        assert!(
            tracker.lock().unwrap().is_none(),
            "旁路行入链后基点应置空（下一条本环快照记全量）"
        );

        // 本环行不触碰基点
        let mut main = build_bypass_snapshot(
            "main",
            "deepseek",
            "m",
            &PromptCallOptions::default(),
            &[msg(MessageRole::User, "你好")],
        );
        *tracker.lock().unwrap() = Some(vec![msg(MessageRole::User, "你好")]);
        anchor.call(&OrchestratorEvent::RequestSnapshotCaptured { snapshot: main.clone() });
        assert!(
            tracker.lock().unwrap().is_some(),
            "main 行属本环采集，不应重置基点"
        );

        main.purpose = "compaction".into();
        *tracker.lock().unwrap() = Some(vec![msg(MessageRole::User, "你好")]);
        anchor.call(&OrchestratorEvent::RequestSnapshotCaptured { snapshot: main });
        assert!(
            tracker.lock().unwrap().is_some(),
            "compaction 行属本环采集，不应重置基点"
        );
    }
}