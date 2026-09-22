//! 提问工具 `ask_user_question`（Q1，2026-09-20）——模型主动向用户提问
//!
//! 详细见 docs/plans/2026-09-18-对话区对齐dsh/03-对照与建议清单.md §三 Q1（设计/验收）
//! 与 §十（集成点地图）；阻塞原语复用 `agent-kernel/src/confirmation.rs`。
//!
//! # 为什么需要这批
//!
//! 此前唯一「等人回答」通道是被动 HITL 确认（策略触发，单向门）——模型在信息缺失
//! （如「选哪个方案」「目标确认」）时只能猜或停下。本工具补上「模型主动提问」：
//! 工具参数 → `InteractionBroker::request_user_input` → 族事件 `InteractionRequested`（user_input 型）→
//! Tauri 转发前端 `agent:interaction:{sid}` → 提问面板 →
//! `cmd_agent_interaction_respond`（kind=user_input）回传 → 答案按稳定 id 回显组装为工具结果回模型。
//!
//! # 协议（对齐 dsh `ask_user_question`，见 02 基线文档）
//!
//! - 批量 `questions[]`：一次调用承载整批问题；每题 **稳定 id 随答案原样回显**
//! - `options = label + description`；`multi_select`（默认 false，单选）
//! - 答案 `{ id, selected[], custom? }`——单选 custom 覆盖 selected、多选 custom 补充、
//!   跳过 = 空项；`selected` 的取值即选项 `label`（推荐项在 label 追加 `(Recommended)`）
//! - **首版不做 intent**（呈现与协议分离留扩展位）；**无固定超时**——随轮取消（D3）
//!
//! # 失败语义（fail loud，零回归）
//!
//! 三错误码经 `tool_failure_payload` 直接构造失败结果（同 CONFIRM_* 先例）：
//! - `ASK_DENIED`：用户拒绝作答（前端取消键）
//! - `ASK_CANCELLED`：等待期间任务被中断（abort / dispose 随轮取消）
//! - `ASK_UNAVAILABLE`：不可用——子代理内执行（无人类应答者，对齐 dsh DELEGATED_CALLER）
//!   或无会话上下文入口
//!
//! 参数不合法（缺 questions / id 重复 / 选项缺 label 等）→ `ToolError::ArgsParse`
//! （模型见 INVALID_TOOL_INPUT 可自行修正重试，不静默降级）。

use std::sync::Arc;

use agent_runtime::confirmation::{AskAnswer, AskOutcome, InteractionBroker};
use agent_runtime::event::EventBroadcaster;
use agent_runtime::tool::{tool_failure_payload, Tool, ToolBus, ToolError};
use agent_runtime::tool_context::ToolContext;
use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::sync::RwLock;

/// 用户拒绝作答（前端「取消」键）
pub const ASK_DENIED: &str = "ASK_DENIED";
/// 等待期间任务被中断（随轮取消：abort / 会话销毁）
pub const ASK_CANCELLED: &str = "ASK_CANCELLED";
/// 提问不可用（子代理内 / 无会话上下文）
pub const ASK_UNAVAILABLE: &str = "ASK_UNAVAILABLE";

/// 工具名（单一常量：注册 / 失败载荷 / 基础工具集（kernel）三处同名）
const TOOL_NAME: &str = "ask_user_question";

/// 提问工具：模型主动向用户提问（批量问题 + 稳定 id 回显）
pub struct AskUserQuestionTool {
    /// 提问阻塞通道（本会话的确认协调器；`ask` 无超时等待前端回传）
    broker: Arc<InteractionBroker>,
    /// 会话事件广播器（`InteractionRequested`〔user_input 型〕由此广播 → Tauri 转发前端族通道）
    broadcaster: Arc<RwLock<EventBroadcaster>>,
}

impl AskUserQuestionTool {
    /// 构造（注入该会话的 broker 与广播器，两处与 AgentLoop 共用同一实例）
    pub fn new(
        broker: Arc<InteractionBroker>,
        broadcaster: Arc<RwLock<EventBroadcaster>>,
    ) -> Self {
        Self { broker, broadcaster }
    }
}

#[async_trait]
impl Tool for AskUserQuestionTool {
    fn name(&self) -> &str {
        TOOL_NAME
    }

    fn description(&self) -> &str {
        "向用户提问，以在继续之前获得确认、做出选择或补齐缺失的信息。\
         一次调用发送一个或多个问题，每个问题带稳定 id，答案会按 id 回显\
         （answers: [{id, selected[], custom?}]）。用户可选择选项、自定义回答或跳过；\
         若用户拒绝回答或任务被中断，工具返回错误（isError）；\
         若 10 分钟内未获作答则按「跳过」返回（空答案 + timedOut 标记）。\
         提问会暂停任务等待人工回答——仅在确实需要用户输入时才使用。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "questions": {
                    "type": "array",
                    "minItems": 1,
                    "description": "要询问用户的问题批次（一次调用整批提交；每题 id 唯一，答案按 id 回显）",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {
                                "type": "string",
                                "description": "问题稳定 id（答案按此回显；同批内必须唯一）"
                            },
                            "question": {
                                "type": "string",
                                "description": "问题文本"
                            },
                            "header": {
                                "type": "string",
                                "description": "短标题/分组标签（可选，如「确认」「选择模式」）"
                            },
                            "options": {
                                "type": "array",
                                "description": "选项列表（可选；不提供则为自由回答题）。推荐项放首位并在 label 追加 \"(Recommended)\"",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "label": {
                                            "type": "string",
                                            "description": "选项文本（同时是回传的选中值）"
                                        },
                                        "description": {
                                            "type": "string",
                                            "description": "选项说明（UI 帮助文本，可选）"
                                        }
                                    },
                                    "required": ["label"]
                                }
                            },
                            "multi_select": {
                                "type": "boolean",
                                "description": "是否多选（默认 false = 单选）"
                            }
                        },
                        "required": ["id", "question"]
                    }
                }
            },
            "required": ["questions"]
        })
    }

    /// 无上下文入口：提问必须带会话上下文（需 `is_sub_agent` 判定）——fail loud 不降级
    async fn execute(&self, _args: Value) -> Result<Value, ToolError> {
        Ok(tool_failure_payload(
            TOOL_NAME,
            "提问需要会话上下文（该入口未注入 ToolContext）",
            ASK_UNAVAILABLE,
        ))
    }

    /// 带上下文执行：子代理拒绝 → 参数规范化 → 阻塞等待作答 → 组装结果
    async fn execute_with_ctx(
        &self,
        ctx: &ToolContext,
        args: Value,
    ) -> Result<Value, ToolError> {
        // 仅主会话可问（D3 拍板，同 dsh）：子代理无独立会话实例、无人类应答者
        if ctx.is_sub_agent {
            return Ok(tool_failure_payload(
                TOOL_NAME,
                "子代理不能向用户提问（无人类应答者）——请把需要的决策回报给主 Agent",
                ASK_UNAVAILABLE,
            ));
        }
        let questions = parse_questions(&args)?;
        // 超时（10 分钟）按「跳过」处理：需按题序构造空答案，故先取稳定 id 列表
        let question_ids: Vec<String> = questions
            .iter()
            .filter_map(|q| q.get("id").and_then(|v| v.as_str()).map(String::from))
            .collect();
        let outcome = self
            .broker
            .request_user_input(&self.broadcaster, Value::Array(questions))
            .await;
        Ok(match outcome {
            // 用户已作答：{ "answers": [{id, selected[], custom?}] }（custom 缺省不携带）
            AskOutcome::Answered(answers) => json!({ "answers": answers }),
            AskOutcome::Denied => tool_failure_payload(
                TOOL_NAME,
                "用户拒绝作答（已取消本次提问）",
                ASK_DENIED,
            ),
            AskOutcome::Cancelled => tool_failure_payload(
                TOOL_NAME,
                "等待用户回答期间任务被中断，提问已取消",
                ASK_CANCELLED,
            ),
            // 超时兜底（2026-09-20 用户裁定）：按「跳过」处理——逐题空答案 +
            // `timedOut` 标记如实告知模型（非失败结果，模型可自行决定继续/换路）
            AskOutcome::TimedOut => {
                let answers: Vec<AskAnswer> = question_ids
                    .iter()
                    .map(|id| AskAnswer {
                        id: id.clone(),
                        selected: Vec::new(),
                        custom: None,
                    })
                    .collect();
                json!({ "answers": answers, "timedOut": true })
            }
        })
    }
}

/// 解析并规范化问题批次：模型侧 snake_case → 事件侧 camelCase（对齐 dsh seam 口径）
///
/// 规范化产物（每题）：`{ id, question, header?, options?[{label, description?}], multiSelect }`
/// ——可选字段仅在有值时携带（对齐 dsh「非 undefined 才带上」）。
/// 任何不合法输入 → `ToolError::ArgsParse`（fail loud，模型可修正后重试）。
fn parse_questions(args: &Value) -> Result<Vec<Value>, ToolError> {
    let Some(items) = args.get("questions").and_then(|v| v.as_array()) else {
        return Err(ToolError::ArgsParse(
            "缺少参数 questions（应为非空数组）".to_string(),
        ));
    };
    if items.is_empty() {
        return Err(ToolError::ArgsParse(
            "questions 为空——至少需要一个问题".to_string(),
        ));
    }
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(items.len());
    for (i, item) in items.iter().enumerate() {
        let obj = item.as_object().ok_or_else(|| {
            ToolError::ArgsParse(format!("questions[{i}] 应为对象（含 id / question）"))
        })?;
        // id：必填、非空、同批唯一（答案路由键）
        let id = obj
            .get("id")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| ToolError::ArgsParse(format!("questions[{i}] 缺少 id（或为空）")))?
            .to_string();
        if !seen.insert(id.clone()) {
            return Err(ToolError::ArgsParse(format!(
                "questions[{i}] 的 id 重复：{id}（同批内 id 必须唯一）"
            )));
        }
        // question：必填非空
        let question = obj
            .get("question")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                ToolError::ArgsParse(format!("questions[{i}] 缺少 question（或为空）"))
            })?
            .to_string();
        let mut norm = serde_json::Map::new();
        norm.insert("id".to_string(), json!(id));
        norm.insert("question".to_string(), json!(question));
        // header：可选
        if let Some(header) = obj
            .get("header")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            norm.insert("header".to_string(), json!(header));
        }
        // options：可选；提供时每项必须有非空 label
        if let Some(options) = obj.get("options") {
            let arr = options.as_array().ok_or_else(|| {
                ToolError::ArgsParse(format!("questions[{i}].options 应为数组"))
            })?;
            let mut opts = Vec::with_capacity(arr.len());
            for (j, opt) in arr.iter().enumerate() {
                let o = opt.as_object().ok_or_else(|| {
                    ToolError::ArgsParse(format!(
                        "questions[{i}].options[{j}] 应为对象（含 label）"
                    ))
                })?;
                let label = o
                    .get("label")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| {
                        ToolError::ArgsParse(format!(
                            "questions[{i}].options[{j}] 缺少 label（或为空）"
                        ))
                    })?;
                let mut no = serde_json::Map::new();
                no.insert("label".to_string(), json!(label));
                if let Some(desc) = o
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    no.insert("description".to_string(), json!(desc));
                }
                opts.push(Value::Object(no));
            }
            norm.insert("options".to_string(), Value::Array(opts));
        }
        // multi_select：模型侧 snake_case（对齐 dsh schema）；camelCase 亦兼容（模型偶发写法）
        let multi = obj
            .get("multi_select")
            .or_else(|| obj.get("multiSelect"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        norm.insert("multiSelect".to_string(), json!(multi));
        out.push(Value::Object(norm));
    }
    Ok(out)
}

/// 注册提问工具（幂等——同名注册覆盖）
///
/// **注册无条件、可见性靠场景**（同 memory_tools / fs / terminal 同一机制）：
/// `ask_user_question` 已列入 kernel `SYSTEM_BASE_TOOLS`，任何场景下都可见；
/// 子代理内执行由 `ToolContext.is_sub_agent` 判定 fail loud（ASK_UNAVAILABLE）。
pub async fn register_ask_tools(
    bus: &dyn ToolBus,
    broker: Arc<InteractionBroker>,
    broadcaster: Arc<RwLock<EventBroadcaster>>,
) {
    bus.register(Arc::new(AskUserQuestionTool::new(broker, broadcaster)))
        .await;
}

// ─── 测试 ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use agent_engine::contracts::interaction::{InteractionKind, InteractionOutcome};
    use agent_runtime::event::OrchestratorEvent;
    use agent_runtime::event_bus::{Listener, ListenerOutcome};

    /// 捕获广播事件的监听器（断言族事件 `InteractionRequested` 规范化载荷）
    #[derive(Default)]
    struct CaptureListener {
        events: std::sync::Mutex<Vec<OrchestratorEvent>>,
    }

    impl Listener for CaptureListener {
        fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
            self.events.lock().unwrap().push(event.clone());
            ListenerOutcome::Continue
        }
    }

    /// 夹具：broker + broadcaster（挂捕获监听）+ 工具
    async fn fixture() -> (
        Arc<InteractionBroker>,
        Arc<CaptureListener>,
        AskUserQuestionTool,
    ) {
        let broker = Arc::new(InteractionBroker::new());
        let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
        let capture = Arc::new(CaptureListener::default());
        broadcaster.write().await.subscribe(capture.clone());
        let tool = AskUserQuestionTool::new(broker.clone(), broadcaster);
        (broker, capture, tool)
    }

    /// 轮询取第一个待回答交互 id（族事件 `InteractionRequested`〔user_input 型〕已广播才返回——
    /// 广播先于等待、晚于入表，事件可见即 pending 已就绪；避免跨 crate 触碰 broker 私有字段）
    async fn first_pending_ask(_broker: &InteractionBroker, capture: &CaptureListener) -> String {
        for _ in 0..100 {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            let ask_id = capture.events.lock().unwrap().iter().find_map(|e| match e {
                OrchestratorEvent::InteractionRequested { interaction_id, request }
                    if request.kind() == InteractionKind::UserInput =>
                {
                    Some(interaction_id.clone())
                }
                _ => None,
            });
            if let Some(id) = ask_id {
                return id;
            }
        }
        panic!("ask 未在预期时间内广播 InteractionRequested");
    }

    #[tokio::test]
    async fn ask_returns_answers_with_stable_ids() {
        let (broker, capture, tool) = fixture().await;
        let args = json!({
            "questions": [
                {
                    "id": "mode",
                    "header": "选择模式",
                    "question": "用哪种模式继续？",
                    "options": [
                        { "label": "快速 (Recommended)", "description": "少确认" },
                        { "label": "严谨" }
                    ]
                },
                { "id": "note", "question": "还有什么要补充的？" }
            ]
        });
        let handle = tokio::spawn(async move {
            tool.execute_with_ctx(&ToolContext::default(), args).await
        });
        let ask_id = first_pending_ask(&broker, &capture).await;
        // 广播载荷：camelCase 规范化（multiSelect 显式、header/options 带 label+description）
        let events = capture.events.lock().unwrap().clone();
        let questions = events
            .iter()
            .find_map(|e| match e {
                OrchestratorEvent::InteractionRequested { request, .. } => match request {
                    agent_engine::contracts::interaction::InteractionRequest::UserInput { questions } => {
                        Some(questions.clone())
                    }
                    _ => None,
                },
                _ => None,
            })
            .expect("应广播 InteractionRequested（user_input 型）");
        assert_eq!(questions[0]["id"], "mode");
        assert_eq!(questions[0]["multiSelect"], false);
        assert_eq!(questions[0]["options"][0]["label"], "快速 (Recommended)");
        assert_eq!(questions[0]["options"][0]["description"], "少确认");
        assert!(questions[0]["options"][1].get("description").is_none(), "无 description 不携带");
        assert!(questions[1].get("options").is_none(), "无 options 不携带");
        // 用户作答（单选 + 跳过）→ 工具结果按稳定 id 回显
        let answers = vec![
            AskAnswer { id: "mode".into(), selected: vec!["严谨".into()], custom: None },
            AskAnswer { id: "note".into(), selected: vec![], custom: Some("没有".into()) },
        ];
        assert!(broker
            .resolve(&ask_id, InteractionOutcome::UserInput(AskOutcome::Answered(answers)))
            .await);
        let result = handle.await.unwrap().expect("已作答应成功返回");
        assert_eq!(result["answers"][0]["id"], "mode");
        assert_eq!(result["answers"][0]["selected"][0], "严谨");
        assert_eq!(result["answers"][1]["custom"], "没有");
        assert!(result.get("isError").is_none(), "作答结果不应携带 isError");
    }

    #[tokio::test]
    async fn ask_denied_and_cancelled_return_failure_payloads() {
        // 用户拒绝 → ASK_DENIED
        let (broker, capture, tool) = fixture().await;
        let handle = tokio::spawn(async move {
            tool.execute_with_ctx(
                &ToolContext::default(),
                json!({ "questions": [{ "id": "q", "question": "继续？" }] }),
            )
            .await
        });
        let ask_id = first_pending_ask(&broker, &capture).await;
        assert!(broker
            .resolve(&ask_id, InteractionOutcome::UserInput(AskOutcome::Denied))
            .await);
        let result = handle.await.unwrap().unwrap();
        assert_eq!(result["isError"], true);
        assert_eq!(result["errorCode"], ASK_DENIED);
        assert_eq!(result["tool"], TOOL_NAME);

        // 随轮取消（abort/dispose 路径）→ ASK_CANCELLED
        let (broker, capture, tool) = fixture().await;
        let handle = tokio::spawn(async move {
            tool.execute_with_ctx(
                &ToolContext::default(),
                json!({ "questions": [{ "id": "q", "question": "继续？" }] }),
            )
            .await
        });
        let _ = first_pending_ask(&broker, &capture).await;
        let cancelled = broker.cancel_all().await;
        assert_eq!(cancelled.len(), 1);
        let result = handle.await.unwrap().unwrap();
        assert_eq!(result["isError"], true);
        assert_eq!(result["errorCode"], ASK_CANCELLED);
    }

    #[tokio::test]
    async fn ask_timeout_returns_skip_answers_with_marker() {
        // 10 分钟兜底（此处缩短）：超时按「跳过」处理——逐题空答案 + timedOut 标记（非失败）
        let broker = Arc::new(InteractionBroker::with_ask_timeout(
            std::time::Duration::from_millis(30),
        ));
        let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
        let tool = AskUserQuestionTool::new(broker, broadcaster);
        let result = tool
            .execute_with_ctx(
                &ToolContext::default(),
                json!({ "questions": [
                    { "id": "a", "question": "继续？" },
                    { "id": "b", "question": "还有补充吗？" }
                ]}),
            )
            .await
            .expect("超时应返回跳过结果（非 Err）");
        assert!(result.get("isError").is_none(), "超时按跳过处理，不应标记失败");
        assert_eq!(result["timedOut"], true);
        assert_eq!(result["answers"][0], json!({ "id": "a", "selected": [] }));
        assert_eq!(result["answers"][1], json!({ "id": "b", "selected": [] }));
    }

    #[tokio::test]
    async fn ask_rejected_in_sub_agent_context() {
        // 仅主会话可问：子代理 ctx → ASK_UNAVAILABLE，且不产生 pending（不阻塞）
        let (broker, capture, tool) = fixture().await;
        let ctx = ToolContext {
            is_sub_agent: true,
            ..Default::default()
        };
        let result = tool
            .execute_with_ctx(
                &ctx,
                json!({ "questions": [{ "id": "q", "question": "继续？" }] }),
            )
            .await
            .expect("子代理拒绝应返回失败结果（非 Err）");
        assert_eq!(result["isError"], true);
        assert_eq!(result["errorCode"], ASK_UNAVAILABLE);
        assert!(capture.events.lock().unwrap().is_empty(), "不应广播事件");
        // 未进入 pending：无可取消项（公开 API 校验，避免触碰私有字段）
        assert!(broker.cancel_all().await.is_empty(), "不应进入 pending");
    }

    #[tokio::test]
    async fn ask_validation_fails_loud() {
        let (_broker, _capture, tool) = fixture().await;
        let ctx = ToolContext::default();
        // 缺 questions
        let err = tool.execute_with_ctx(&ctx, json!({})).await.unwrap_err();
        assert!(err.to_string().contains("questions"), "缺参应报 questions: {err}");
        // 空数组
        let err = tool
            .execute_with_ctx(&ctx, json!({ "questions": [] }))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("至少"), "空数组应报错: {err}");
        // id 重复
        let err = tool
            .execute_with_ctx(
                &ctx,
                json!({ "questions": [
                    { "id": "x", "question": "a" },
                    { "id": "x", "question": "b" }
                ]}),
            )
            .await
            .unwrap_err();
        assert!(err.to_string().contains("重复"), "重复 id 应报错: {err}");
        // 选项缺 label
        let err = tool
            .execute_with_ctx(
                &ctx,
                json!({ "questions": [
                    { "id": "x", "question": "a", "options": [{ "description": "无 label" }] }
                ]}),
            )
            .await
            .unwrap_err();
        assert!(err.to_string().contains("label"), "缺 label 应报错: {err}");
    }

    #[tokio::test]
    async fn register_ask_tools_visible_on_bus() {
        let bus = agent_runtime::tool::SimpleToolBus::new();
        let broker = Arc::new(InteractionBroker::new());
        let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
        register_ask_tools(&bus, broker, broadcaster).await;
        let def = bus.get_by_name(TOOL_NAME).await.expect("应注册成功");
        assert_eq!(def.name, TOOL_NAME);
        assert!(def.parameters["properties"]["questions"].is_object());
    }
}