//! 定时唤醒三件套（批次 C·S1，2026-09-20）：`set_timer` / `list_timers` / `cancel_timer`
//!
//! 详细见 docs/plans/2026-09-18-对话区对齐dsh/03-对照与建议清单.md §三 S1（设计与验收）。
//!
//! # 三件套
//!
//! | 工具 | 语义 |
//! |---|---|
//! | `set_timer` | `after_seconds`（10..=86400）+ `note?`（提醒事项）+ `watch?`（PTY 会话 id 列表）→ 立即返回 `{timer_id, fire_at}`；**不阻塞** |
//! | `list_timers` | 列本会话未到期定时器（id / 剩余秒数 / 提醒事项 / watch 概要） |
//! | `cancel_timer` | 按 id 取消（到点前可撤销；已触发/已取消返回 `cancelled=false`） |
//!
//! # 口径
//!
//! - **一次性**（不做周期）；护栏：倒计时上下界 + 每会话未到期上限 8
//! - **子代理不可用**：定时器属主会话（子代理共享父总线、无独立 session 实例）→
//!   `TIMER_UNAVAILABLE` fail loud（对齐 ask 的 `ASK_UNAVAILABLE` 口径）
//! - 设定后由装配层 [`TimerRunner`](crate::timers::TimerRunner) 武装（后台任务到点唤醒）；
//!   应用重启后由 `restore_and_arm` 扫描补投（认领幂等，不重复触发）
//! - 工具描述提示「每次唤醒消耗一次 LLM 轮次」——引导模型仅在确实需要等待时使用

use std::sync::Arc;

use agent_runtime::tool::{SideEffectScope, Tool, ToolBus, ToolDescriptor, ToolError, tool_failure_payload};
use agent_runtime::tool_context::ToolContext;
use async_trait::async_trait;
use serde_json::{json, Value};

use crate::session_store::{SessionRepository, SessionTimerRecord, SessionTimerStatus};
use crate::terminal::ShellSessionManager;
use crate::timers::{
    fmt_ms, now_ms, snapshot_cursors, TimerRunner, TIMER_MAX_PENDING_PER_SESSION, TIMER_MAX_SECS,
    TIMER_MIN_SECS,
};

/// 定时器不可用（子代理内 / 无会话上下文）
pub const TIMER_UNAVAILABLE: &str = "TIMER_UNAVAILABLE";

/// 定时工具依赖束（会话级；`runner` 缺省 = 仅写记录不武装——测试/无 store 路径）
#[derive(Clone)]
pub struct TimerDeps {
    store: Arc<dyn SessionRepository>,
    session_id: String,
    manager: ShellSessionManager,
    runner: Option<Arc<TimerRunner>>,
}

impl TimerDeps {
    /// 构造（装配层在会话创建/恢复后注入 store + PTY 会话池）
    pub fn new(
        store: Arc<dyn SessionRepository>,
        session_id: String,
        manager: ShellSessionManager,
    ) -> Self {
        Self {
            store,
            session_id,
            manager,
            runner: None,
        }
    }

    /// 注入运行器（设定后自动武装到点唤醒）
    pub fn with_runner(mut self, runner: Arc<TimerRunner>) -> Self {
        self.runner = Some(runner);
        self
    }
}

/// 注册三件套（幂等——同名注册覆盖）
pub async fn register_timer_tools(bus: &dyn ToolBus, deps: TimerDeps) {
    bus.register(Arc::new(SetTimerTool::new(deps.clone()))).await;
    bus.register(Arc::new(ListTimersTool::new(deps.clone()))).await;
    bus.register(Arc::new(CancelTimerTool::new(deps))).await;
}

// ─── ① set_timer ────────────────────────────────────

/// `set_timer`：设置一次性定时器（到点唤醒本会话）
pub struct SetTimerTool {
    deps: TimerDeps,
}

impl SetTimerTool {
    pub fn new(deps: TimerDeps) -> Self {
        Self { deps }
    }
}

#[async_trait]
impl Tool for SetTimerTool {
    fn name(&self) -> &str {
        "set_timer"
    }

    fn description(&self) -> &str {
        "设置一次性定时器：到点自动唤醒本会话继续干活（不阻塞当前任务，可继续做别的）。\
         可挂提醒事项 note；可给 watch（PTY 会话 id 列表）——倒计时期间这些会话的后台输出\
         会在到点随唤醒一并送达。after_seconds 范围 10..86400 秒。\
         每次唤醒消耗一次 LLM 轮次，仅在确实需要等待（后台任务、轮询外部状态、延后提醒）时使用。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "after_seconds": {
                    "type": "integer",
                    "description": "倒计时秒数（10..86400）"
                },
                "note": {
                    "type": "string",
                    "description": "提醒事项（可选；到点唤醒载荷会带上，用于提醒你为何等待）"
                },
                "watch": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "要捕获输出的 PTY 会话 id 列表（可选；shell_session_* 创建的会话，用 shell_session_list 查询）"
                }
            },
            "required": ["after_seconds"]
        })
    }
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::writes(self.name(), "session", self.description(), SideEffectScope::Session)
            .with_input_schema(self.parameters())
    }

    async fn execute(&self, _args: Value) -> Result<Value, ToolError> {
        Ok(tool_failure_payload(
            "set_timer",
            "定时器需要会话上下文（该入口未注入 ToolContext）",
            TIMER_UNAVAILABLE,
        ))
    }

    async fn execute_with_ctx(
        &self,
        ctx: &ToolContext,
        args: Value,
    ) -> Result<Value, ToolError> {
        // 子代理不可用（定时器属主会话；子代理共享父总线、无独立 session 实例）
        if ctx.is_sub_agent {
            return Ok(tool_failure_payload(
                "set_timer",
                "子代理不能设置定时器（定时器属主会话）——如需等待，请把等待需求回报给主 Agent",
                TIMER_UNAVAILABLE,
            ));
        }
        // 倒计时：必填 + 上下界
        let secs = args
            .get("after_seconds")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| {
                ToolError::ArgsParse(format!(
                    "缺少参数 after_seconds（整数秒，{TIMER_MIN_SECS}..={TIMER_MAX_SECS}）"
                ))
            })?;
        if secs < TIMER_MIN_SECS || secs > TIMER_MAX_SECS {
            return Err(ToolError::ArgsParse(format!(
                "after_seconds 超出范围：{secs}（允许 {TIMER_MIN_SECS}..={TIMER_MAX_SECS} 秒）"
            )));
        }
        let note = args
            .get("note")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from);
        let watch = parse_watch_list(&args);
        // watch 校验：会话必须存在（否则到点只能标注「已销毁」，不如设定时 fail loud 让模型改）
        for id in &watch {
            if !self.deps.manager.has_session(id).await {
                let existing = self.deps.manager.session_ids().await;
                return Err(ToolError::ArgsParse(format!(
                    "watch 会话不存在：{id}（现有 PTY 会话：{}）",
                    if existing.is_empty() {
                        "无".to_string()
                    } else {
                        existing.join(", ")
                    }
                )));
            }
        }
        // 上限保护（防堆积）
        let pending = self
            .deps
            .store
            .list_pending_timers(&self.deps.session_id)
            .await
            .map_err(|e| ToolError::Execution(format!("读取定时器失败: {e}")))?;
        if pending.len() >= TIMER_MAX_PENDING_PER_SESSION {
            return Err(ToolError::ArgsParse(format!(
                "本会话未到期定时器已达上限 {}（可先用 list_timers 查看 / cancel_timer 取消）",
                TIMER_MAX_PENDING_PER_SESSION
            )));
        }
        // 写入记录（游标 = 设定时刻各 watch 会话的输出末尾）
        let created_at = now_ms();
        let fire_at = created_at + (secs as i64) * 1000;
        let id = format!("timer-{}", uuid::Uuid::new_v4());
        let record = SessionTimerRecord {
            id: id.clone(),
            session_id: self.deps.session_id.clone(),
            fire_at,
            note,
            cursors: snapshot_cursors(&self.deps.manager, &watch).await,
            watch: watch.clone(),
            status: SessionTimerStatus::Pending,
            created_at,
            fired_at: None,
        };
        self.deps
            .store
            .insert_timer(&record)
            .await
            .map_err(|e| ToolError::Execution(format!("写入定时器失败: {e}")))?;
        // 武装（到点唤醒）；runner 缺省时仅写记录（测试路径）
        if let Some(runner) = &self.deps.runner {
            runner.clone().arm(record, false);
        }
        Ok(json!({
            "timer_id": id,
            "after_seconds": secs,
            "fire_at": fire_at,
            "fire_at_local": fmt_ms(fire_at),
            "watch": watch,
            "hint": "定时器已设置：到点自动唤醒本会话；期间可继续当前任务（无需轮询等待）。",
        }))
    }
}

// ─── ② list_timers ────────────────────────────────────

/// `list_timers`：列出本会话未到期定时器
pub struct ListTimersTool {
    deps: TimerDeps,
}

impl ListTimersTool {
    pub fn new(deps: TimerDeps) -> Self {
        Self { deps }
    }
}

#[async_trait]
impl Tool for ListTimersTool {
    fn name(&self) -> &str {
        "list_timers"
    }

    fn description(&self) -> &str {
        "列出本会话未到期的定时器（timer_id / 剩余秒数 / 提醒事项 / watch 会话概要）。"
    }

    fn parameters(&self) -> Value {
        json!({ "type": "object", "properties": {} })
    }
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::read_only(self.name(), "session", self.description(), SideEffectScope::Session)
            .with_input_schema(self.parameters())
    }

    async fn execute(&self, _args: Value) -> Result<Value, ToolError> {
        Ok(tool_failure_payload(
            "list_timers",
            "定时器需要会话上下文（该入口未注入 ToolContext）",
            TIMER_UNAVAILABLE,
        ))
    }

    async fn execute_with_ctx(
        &self,
        ctx: &ToolContext,
        _args: Value,
    ) -> Result<Value, ToolError> {
        if ctx.is_sub_agent {
            return Ok(tool_failure_payload(
                "list_timers",
                "子代理不能查看定时器（定时器属主会话）",
                TIMER_UNAVAILABLE,
            ));
        }
        let pending = self
            .deps
            .store
            .list_pending_timers(&self.deps.session_id)
            .await
            .map_err(|e| ToolError::Execution(format!("读取定时器失败: {e}")))?;
        let now = now_ms();
        let timers: Vec<Value> = pending
            .iter()
            .map(|r| {
                json!({
                    "timer_id": r.id,
                    "remaining_seconds": ((r.fire_at - now).max(0)) / 1000,
                    "fire_at": r.fire_at,
                    "fire_at_local": fmt_ms(r.fire_at),
                    "note": r.note,
                    "watch": r.watch,
                })
            })
            .collect();
        Ok(json!({
            "count": timers.len(),
            "timers": timers,
            "hint": if timers.is_empty() { "本会话无未到期定时器。" } else { "到点会自动唤醒本会话，无需轮询等待。" },
        }))
    }
}

// ─── ③ cancel_timer ────────────────────────────────────

/// `cancel_timer`：取消未到期定时器
pub struct CancelTimerTool {
    deps: TimerDeps,
}

impl CancelTimerTool {
    pub fn new(deps: TimerDeps) -> Self {
        Self { deps }
    }
}

#[async_trait]
impl Tool for CancelTimerTool {
    fn name(&self) -> &str {
        "cancel_timer"
    }

    fn description(&self) -> &str {
        "取消本会话一个未到期的定时器（按 timer_id；到点前可撤销）。\
         已触发或已取消的定时器返回 cancelled=false。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "timer_id": { "type": "string", "description": "定时器 id（set_timer 返回 / list_timers 查询）" }
            },
            "required": ["timer_id"]
        })
    }
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::writes(self.name(), "session", self.description(), SideEffectScope::Session)
            .with_input_schema(self.parameters())
    }

    async fn execute(&self, _args: Value) -> Result<Value, ToolError> {
        Ok(tool_failure_payload(
            "cancel_timer",
            "定时器需要会话上下文（该入口未注入 ToolContext）",
            TIMER_UNAVAILABLE,
        ))
    }

    async fn execute_with_ctx(
        &self,
        ctx: &ToolContext,
        args: Value,
    ) -> Result<Value, ToolError> {
        if ctx.is_sub_agent {
            return Ok(tool_failure_payload(
                "cancel_timer",
                "子代理不能取消定时器（定时器属主会话）",
                TIMER_UNAVAILABLE,
            ));
        }
        let id = args
            .get("timer_id")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| ToolError::ArgsParse("缺少参数 timer_id（或为空）".to_string()))?
            .to_string();
        let ok = self
            .deps
            .store
            .cancel_timer(&self.deps.session_id, &id)
            .await
            .map_err(|e| ToolError::Execution(format!("取消定时器失败: {e}")))?;
        Ok(json!({
            "cancelled": ok,
            "timer_id": id,
            "hint": if ok { "定时器已取消。" } else { "未命中未到期定时器（可能已到点触发或已被取消）。" },
        }))
    }
}

/// 解析 watch 列表（数组或单字符串；去重保序）
fn parse_watch_list(args: &Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |s: &str| {
        let t = s.trim();
        if !t.is_empty() && !out.iter().any(|x| x == t) {
            out.push(t.to_string());
        }
    };
    match args.get("watch") {
        Some(Value::Array(items)) => {
            for item in items {
                if let Some(s) = item.as_str() {
                    push(s);
                }
            }
        }
        Some(Value::String(s)) => push(s),
        _ => {}
    }
    out
}

// ─── 测试 ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_store::{SessionRecord, SessionKind, SqliteSessionRepository};
    use agent_runtime::tool::{SimpleToolBus, ToolDefinition};

    async fn deps() -> (TimerDeps, Arc<SqliteSessionRepository>) {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        store
            .save_session(&SessionRecord {
                id: "s1".into(),
                system_prompt: "sys".into(),
                prompt_sections: None,
                created_at: 100,
                message_count: 0,
                updated_at: 100,
                title: "测试会话".into(),
                pinned: false,
                kind: SessionKind::Chat,
                workdir: None,
                workspace_id: None,
                project_id: None,
                scene_id: None,
            })
            .await
            .unwrap();
        (
            TimerDeps::new(store.clone(), "s1".into(), ShellSessionManager::new()),
            store,
        )
    }

    fn ctx() -> ToolContext {
        ToolContext::default()
    }

    #[tokio::test]
    async fn set_timer_writes_pending_record_and_reports_ids() {
        let (d, store) = deps().await;
        let tool = SetTimerTool::new(d);
        let out = tool
            .execute_with_ctx(
                &ctx(),
                json!({ "after_seconds": 30, "note": "看构建结果" }),
            )
            .await
            .expect("设定应成功");
        assert!(out["timer_id"].as_str().unwrap().starts_with("timer-"));
        assert_eq!(out["after_seconds"], 30);
        let pending = store.list_pending_timers("s1").await.unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].note.as_deref(), Some("看构建结果"));
        assert_eq!(pending[0].fire_at - pending[0].created_at, 30_000);
    }

    #[tokio::test]
    async fn set_timer_validates_bounds_cap_and_watch() {
        let (d, store) = deps().await;
        let tool = SetTimerTool::new(d);
        // 缺参 / 下界 / 上界
        assert!(tool.execute_with_ctx(&ctx(), json!({})).await.is_err());
        assert!(tool
            .execute_with_ctx(&ctx(), json!({ "after_seconds": 5 }))
            .await
            .is_err());
        assert!(tool
            .execute_with_ctx(&ctx(), json!({ "after_seconds": 90_000 }))
            .await
            .is_err());
        // watch 会话不存在 → fail loud（给出可用清单为空）
        let err = tool
            .execute_with_ctx(
                &ctx(),
                json!({ "after_seconds": 30, "watch": ["session-nope"] }),
            )
            .await
            .unwrap_err();
        assert!(err.to_string().contains("watch 会话不存在"), "{err}");
        // 上限：先塞满 8 条
        for i in 0..TIMER_MAX_PENDING_PER_SESSION {
            store
                .insert_timer(&SessionTimerRecord {
                    id: format!("t{i}"),
                    session_id: "s1".into(),
                    fire_at: now_ms() + 60_000,
                    note: None,
                    watch: vec![],
                    cursors: Default::default(),
                    status: SessionTimerStatus::Pending,
                    created_at: now_ms(),
                    fired_at: None,
                })
                .await
                .unwrap();
        }
        let err = tool
            .execute_with_ctx(&ctx(), json!({ "after_seconds": 30 }))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("上限"), "{err}");
    }

    #[tokio::test]
    async fn list_and_cancel_roundtrip() {
        let (d, store) = deps().await;
        SetTimerTool::new(d.clone())
            .execute_with_ctx(&ctx(), json!({ "after_seconds": 60, "note": "n" }))
            .await
            .unwrap();
        let out = ListTimersTool::new(d.clone())
            .execute_with_ctx(&ctx(), json!({}))
            .await
            .unwrap();
        assert_eq!(out["count"], 1);
        assert_eq!(out["timers"][0]["note"], "n");
        let id = out["timers"][0]["timer_id"].as_str().unwrap().to_string();
        // 取消 → 命中；再取消 → 未命中
        let out = CancelTimerTool::new(d.clone())
            .execute_with_ctx(&ctx(), json!({ "timer_id": id }))
            .await
            .unwrap();
        assert_eq!(out["cancelled"], true);
        let out = CancelTimerTool::new(d)
            .execute_with_ctx(&ctx(), json!({ "timer_id": id }))
            .await
            .unwrap();
        assert_eq!(out["cancelled"], false);
        assert!(store.list_pending_timers("s1").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn timer_tools_rejected_in_sub_agent_context() {
        let (d, _store) = deps().await;
        let sub = ToolContext {
            is_sub_agent: true,
            ..Default::default()
        };
        for out in [
            SetTimerTool::new(d.clone())
                .execute_with_ctx(&sub, json!({ "after_seconds": 30 }))
                .await
                .unwrap(),
            ListTimersTool::new(d.clone())
                .execute_with_ctx(&sub, json!({}))
                .await
                .unwrap(),
            CancelTimerTool::new(d)
                .execute_with_ctx(&sub, json!({ "timer_id": "t" }))
                .await
                .unwrap(),
        ] {
            assert_eq!(out["isError"], true);
            assert_eq!(out["errorCode"], TIMER_UNAVAILABLE);
        }
    }

    #[tokio::test]
    async fn register_timer_tools_exposes_three_definitions() {
        let (d, _store) = deps().await;
        let bus = SimpleToolBus::new();
        register_timer_tools(&bus, d).await;
        let names: Vec<String> = bus
            .list_all()
            .await
            .into_iter()
            .map(|d: ToolDefinition| d.name)
            .collect();
        for want in ["set_timer", "list_timers", "cancel_timer"] {
            assert!(names.contains(&want.to_string()), "缺少 {want}: {names:?}");
        }
        assert!(bus.get_by_name("set_timer").await.unwrap().parameters["properties"]
            ["after_seconds"]
            .is_object());
    }
}