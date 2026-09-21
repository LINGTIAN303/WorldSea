//! FrontendToolBridge：Rust AgentLoop → 前端 TS 工具 的双向执行桥
//!
//! 背景：worldbuilding 场景 `WorldbuildingScenario::tool_ids()` 声明了
//! `entity_create/entity_update/content_search` 等工具，但 Rust ToolBus 只原生实现了
//! `entity_list/entity_get`（见 `entity_commands::entity_read_tools`）。其余工具对 LLM
//! 可见（经 WhitelistToolBus 白名单）却执行时报 `ToolError::NotFound`，场景工具能力被裁半。
//! 而这些工具的前端实现（`ALL_TOOLS_MAP`，见 packages/agent-runtime/src/agent.ts）完备，
//! 依赖前端 `IToolContext`（Dexie entity/relation/file store）。
//!
//! 本桥机制（复用 A5 `ConfirmationBroker` 的 oneshot 等待模式）：
//! 1. Rust `FrontendBridgeTool::execute` 生成唯一 `call_id` → 经 `AppHandle` 广播全局事件
//!    `agent:tool_call`（payload: { callId, toolName, args }）→ await oneshot（带超时）
//! 2. 前端全局监听 `agent:tool_call`，用 `ALL_TOOLS_MAP.get(toolName)` 找到工具实现，
//!    以 `IToolContext` 执行，然后 `invoke('cmd_agent_tool_result', { callId, ok, result })` 回传
//! 3. Rust `cmd_agent_tool_result` 按 `call_id` 找到等待方，`resolve` 唤醒返回给 LLM
//!
//! 关键设计：用「全局事件通道 + call_id 唯一匹配」而非 per-session 通道——
//! 桥工具在 `execute` 时无 session 上下文，工具目标是项目级 stores（跨会话共享），
//! 因此无需像 HITL 确认那样按会话弹窗。跨会话并行调用靠唯一 call_id 区分，天然安全。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::sync::Mutex as StdMutex;

use agent_runtime::tool::{Tool, ToolError};
use async_trait::async_trait;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

/// 默认桥调用超时（120s）：前端执行慢（语义搜索/网络）或多窗口未监听的降级保护
const DEFAULT_BRIDGE_TIMEOUT: Duration = Duration::from_secs(120);

/// 前端桥协调器：广播工具调用事件 + 按 call_id 等待前端回传
///
/// 每个桥工具共享同一个 bridge 实例；`request` 广播事件并 `await` oneshot，
/// 前端经 `cmd_agent_tool_result` 调用 `resolve` 唤醒等待方。
pub struct FrontendToolBridge {
    app: AppHandle,
    pending: StdMutex<HashMap<String, oneshot::Sender<Result<serde_json::Value, ToolError>>>>,
    timeout: Duration,
    seq: AtomicU64,
}

impl FrontendToolBridge {
    /// 创建桥协调器（注入 AppHandle 用于广播事件；默认超时 120s）
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            pending: StdMutex::new(HashMap::new()),
            timeout: DEFAULT_BRIDGE_TIMEOUT,
            seq: AtomicU64::new(0),
        }
    }

    /// 发起桥调用：广播全局事件并等待前端回传
    ///
    /// # 返回
    /// 前端执行结果（成功回传的 JSON）；超时返回 `ToolError::Timeout`。
    pub async fn request(
        &self,
        tool_name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let call_id = self.gen_id();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(call_id.clone(), tx);
        // 广播全局事件（前端即使多窗口也只应有一个监听执行器，避免重复执行）
        if let Err(err) = self.app.emit(
            "agent:tool_call",
            serde_json::json!({
                "callId": call_id,
                "toolName": tool_name,
                "args": args,
            }),
        ) {
            tracing::warn!("FrontendToolBridge emit agent:tool_call 失败: {err}");
            self.pending.lock().unwrap().remove(&call_id);
            return Err(ToolError::Execution(format!("前端桥广播失败: {err}")));
        }
        // 等待前端回传，超时清理并返回 Timeout（LLM 可据此重试/告知用户）
        match tokio::time::timeout(self.timeout, rx).await {
            Ok(Ok(Ok(result))) => Ok(result),
            Ok(Ok(Err(tool_err))) => Err(tool_err),
            Ok(Err(_)) | Err(_) => {
                self.pending.lock().unwrap().remove(&call_id);
                Err(ToolError::Timeout)
            }
        }
    }

    /// 解析桥调用结果（前端经 `cmd_agent_tool_result` 回传）
    ///
    /// 返回是否成功找到并唤醒对应等待方（call_id 不存在 = 已超时/已处理）。
    pub fn resolve(
        &self,
        call_id: &str,
        ok: bool,
        result: serde_json::Value,
    ) -> bool {
        if let Some(tx) = self.pending.lock().unwrap().remove(call_id) {
            let outcome = if ok {
                Ok(result)
            } else {
                // 前端执行失败：提取错误信息（result 可为 { error: "..." } 或字符串）
                let msg = if result.is_string() {
                    result.as_str().unwrap_or("前端工具执行失败").to_string()
                } else {
                    result
                        .get("error")
                        .and_then(|e| e.as_str())
                        .unwrap_or("前端工具执行失败")
                        .to_string()
                };
                Err(ToolError::Execution(msg))
            };
            let _ = tx.send(outcome);
            true
        } else {
            false
        }
    }

    /// 生成桥调用唯一 ID（纳秒时间戳 + 原子计数，避免依赖额外 uuid crate）
    fn gen_id(&self) -> String {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let n = self.seq.fetch_add(1, Ordering::Relaxed);
        format!("ftb-{nanos}-{n}")
    }
}

// ─── 桥工具定义 ──────────────────────────────────────────

/// 一个交由前端执行的桥工具（契约来自 `bridge_tool_specs.json` 生成物，与前端工具定义
/// 同源，使 LLM 看到的工具契约一致；execute 委托 bridge 转发前端执行 + 回传）
pub struct FrontendBridgeTool {
    name: String,
    description: String,
    parameters: serde_json::Value,
    bridge: Arc<FrontendToolBridge>,
}

impl FrontendBridgeTool {
    pub fn new(
        name: String,
        description: String,
        parameters: serde_json::Value,
        bridge: Arc<FrontendToolBridge>,
    ) -> Self {
        Self { name, description, parameters, bridge }
    }
}

#[async_trait]
impl Tool for FrontendBridgeTool {
    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn parameters(&self) -> serde_json::Value {
        self.parameters.clone()
    }

    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let result = self.bridge.request(&self.name, args.clone()).await?;
        // T1：前端「成功返回的失败」载荷补判别字段（isError + errorCode）
        let result = normalize_frontend_failure(result);
        // 事件流丰富化：按工具名+args 附 __meta，供前端 ToolRow 展示语义操作段
        Ok(attach_bridge_meta(&self.name, &args, result))
    }
}

/// 为桥工具返回结果附 `__meta` 操作元数据（object 合并键；兼容非 object 则包裹）
///
/// 与 agent-commands fs_tools / terminal 的 __meta 约定一致，见前端 toolSemantics.ts。
fn attach_bridge_meta(
    name: &str,
    args: &serde_json::Value,
    result: serde_json::Value,
) -> serde_json::Value {
    let meta = match name {
        "entity_create" => Some(serde_json::json!({
            "op": "create",
            "entityType": args.get("type").and_then(|v| v.as_str()),
            "name": args.get("name").and_then(|v| v.as_str()),
        })),
        "entity_update" => Some(serde_json::json!({
            "op": "edit",
            "entityType": args.get("type").and_then(|v| v.as_str()),
            "id": args.get("id").and_then(|v| v.as_str()),
            "name": args.get("name").and_then(|v| v.as_str()),
        })),
        // delete 的 name 从结果取（args 仅含 id；TS 实现返回 {success,id,name,deletedRelations}）
        "entity_delete" => Some(serde_json::json!({
            "op": "delete",
            "id": args.get("id").and_then(|v| v.as_str()),
            "name": result.get("name").and_then(|v| v.as_str()),
        })),
        "content_search" => Some(serde_json::json!({
            "op": "search",
            "query": args.get("keyword").and_then(|v| v.as_str()),
        })),
        _ => None,
    };
    let Some(meta) = meta else { return result };
    if let Some(obj) = result.as_object() {
        let mut obj = obj.clone();
        obj.insert("__meta".to_string(), meta);
        serde_json::Value::Object(obj)
    } else {
        serde_json::json!({ "value": result, "__meta": meta })
    }
}

/// T1（2026-09-18）：前端工具「成功返回的失败」载荷归一化。
///
/// 前端工具的失败有两种出口：抛异常（`resolve` 转 `ToolError` → kernel 统一构造失败结果）
/// 与**返回失败载荷**（`{ ok:false, error }` 或 `{ error }`，经桥按成功回传）——
/// 后者若不处理，模型只会看到一个形状像失败的"成功"结果。此处按约定补判别字段
/// （`isError: true` + `errorCode: "EXECUTION_ERROR"`），原字段一律保留（加性）；
/// `ok:true`（显式成功，以其为准）、无 `error`、已带 `isError`、非对象结果均原样放行。
/// 详细见 docs/details/注释/agent-runtime/agent.md（注释块 16 附：T1 判别契约）
fn normalize_frontend_failure(result: serde_json::Value) -> serde_json::Value {
    let Some(obj) = result.as_object() else {
        return result; // 字符串/数组等非对象结果：无 ok/error 约定，原样放行
    };
    let explicit_failure = obj.get("ok").and_then(|v| v.as_bool()) == Some(false);
    let implicit_failure = !obj.contains_key("ok")
        && obj
            .get("error")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);
    if !(explicit_failure || implicit_failure) || obj.contains_key("isError") {
        return result;
    }
    let mut obj = obj.clone();
    obj.insert("isError".to_string(), serde_json::Value::Bool(true));
    obj.insert(
        "errorCode".to_string(),
        serde_json::Value::String("EXECUTION_ERROR".to_string()),
    );
    serde_json::Value::Object(obj)
}

// ─── 桥工具契约（T5：单一事实源在前端，此处消费生成物）──────────
//
// T5（2026-09-17）：桥工具的 name/description/parameters 唯一事实源是前端
// `packages/agent-runtime`（tools/bridge-spec.ts 的 BRIDGE_TOOL_NAMES + 各 ToolDefinition）。
// 本文件不再手工拷贝契约（曾因此实际漂移：schema 文本两侧不一致），改为消费构建期生成物：
//   生成：`node scripts/gen-bridge-spec.mjs`
//   校验：vitest `packages/agent-runtime/src/tools/__tests__/bridge-spec.spec.ts`
//         （对比生成物与 TS 定义，逐字节不一致即失败）

/// 桥工具生成物（include_str! 编译期嵌入：缺文件即编译失败，坏 JSON 即启动失败，不静默降级）
const BRIDGE_TOOL_SPECS_JSON: &str = include_str!("bridge_tool_specs.json");

/// 单个桥工具契约（与前端 `BridgeToolSpec` 同构）
#[derive(serde::Deserialize)]
struct BridgeToolSpec {
    name: String,
    description: String,
    parameters: serde_json::Value,
}

/// 生成物顶层结构（仅取 tools；generatedBy/source 说明字段由 serde 忽略）
#[derive(serde::Deserialize)]
struct BridgeToolSpecs {
    tools: Vec<BridgeToolSpec>,
}

/// 解析后的桥工具清单（进程内解析一次；解析失败即 panic——契约缺失不允许静默降级）
fn bridge_tool_specs() -> &'static [BridgeToolSpec] {
    static SPECS: std::sync::OnceLock<Vec<BridgeToolSpec>> = std::sync::OnceLock::new();
    SPECS.get_or_init(|| {
        serde_json::from_str::<BridgeToolSpecs>(BRIDGE_TOOL_SPECS_JSON)
            .expect("bridge_tool_specs.json 解析失败：请运行 node scripts/gen-bridge-spec.mjs 重新生成")
            .tools
    })
}

/// 构造桥工具：契约（名称/描述/参数 schema）来自生成物，执行委托前端
///
/// 返回工具名即桥接清单（顺序与前端 BRIDGE_TOOL_NAMES 一致）；在 lib.rs 装配
/// `.chain(bridge_tools(...))` 处生效。
pub fn bridge_tools(bridge: Arc<FrontendToolBridge>) -> Vec<Arc<dyn Tool>> {
    bridge_tool_specs()
        .iter()
        .map(|spec| {
            Arc::new(FrontendBridgeTool::new(
                spec.name.clone(),
                spec.description.clone(),
                spec.parameters.clone(),
                bridge.clone(),
            )) as Arc<dyn Tool>
        })
        .collect()
}

// ─── 测试 ────────────────────────────────────────────────
//
// 说明：`FrontendToolBridge::new` 依赖 `AppHandle`，而 AppHandle 只能在真实 Tauri
// 运行时构造（无法在 `cargo test` 单元测试中创建）。因此本模块单元测试只覆盖
// **不依赖 AppHandle** 的纯逻辑：首批桥工具清单契约。桥的端到端收发
// （emit 全局事件 + cmd_agent_tool_result 回传）在集成环境（Tauri 命令链路）验证。

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_tools_spec_matches_bridge_contract() {
        // 桥接清单契约（T5 后取自生成物，AppHandle 无关）：顺序稳定、契约字段完备。
        // 清单由前端 BRIDGE_TOOL_NAMES 决定（单源），此处作为 Rust 侧快照守卫——
        // 前端增删/改名桥工具时本断言会失败，提醒同步审查 LLM 契约与白名单。
        // 演进记录：任务29/M4 三→四（entity_delete）；H3 Skills 点火四→七；
        // A2UI 接线（2026-09-17）七→十一；S3 补桥（2026-09-18）十一→二十六
        // （kb_* 9 / project_* 2 / consistency_check / entity_get_context + 智能填充 2）；
        // E2（2026-09-18）二十六→二十八（vision_analyze / list_vision_images）。
        let specs = bridge_tool_specs();
        let names: Vec<&str> = specs.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "entity_create",
                "entity_update",
                "entity_delete",
                "content_search",
                "load_skill",
                "load_skill_reference",
                "load_skill_asset",
                "ui_create_surface",
                "ui_update_components",
                "ui_update_data",
                "ui_delete_surface",
                "kb_write",
                "kb_read",
                "kb_list",
                "kb_search",
                "kb_delete",
                "kb_extract",
                "kb_reflect",
                "kb_link",
                "kb_init",
                "project_export",
                "project_import",
                "consistency_check",
                "entity_get_context",
                "entity_suggest_field",
                "entity_smart_fill",
                "vision_analyze",
                "list_vision_images",
            ]
        );
        for spec in specs {
            assert!(!spec.description.trim().is_empty(), "{} 缺少 description", spec.name);
            assert_eq!(
                spec.parameters["type"], "object",
                "{} 的 parameters 必须是 object schema", spec.name
            );
            assert!(
                spec.parameters["properties"].is_object(),
                "{} 的 parameters.properties 缺失", spec.name
            );
            assert!(
                spec.parameters["required"].is_array(),
                "{} 的 parameters.required 缺失", spec.name
            );
        }
    }

    #[test]
    fn attach_bridge_meta_merges_without_breaking_result() {
        // 事件流丰富化：entity_create 附 __meta（op/entityType/name），原字段 id/type/name 保留
        let res = attach_bridge_meta(
            "entity_create",
            &serde_json::json!({ "type": "角色", "name": "林晚" }),
            serde_json::json!({ "id": "e1", "type": "角色", "name": "林晚" }),
        );
        assert_eq!(res["id"], "e1");
        assert_eq!(res["type"], "角色");
        assert_eq!(res["__meta"]["op"], "create");
        assert_eq!(res["__meta"]["entityType"], "角色");
        assert_eq!(res["__meta"]["name"], "林晚");

        // content_search 附 search/query；entity_get 不匹配（_ => None），结果原样返回
        let sr = attach_bridge_meta(
            "content_search",
            &serde_json::json!({ "keyword": "雾都" }),
            serde_json::json!({ "count": 1 }),
        );
        assert_eq!(sr["__meta"]["op"], "search");
        assert_eq!(sr["__meta"]["query"], "雾都");
        assert_eq!(sr["count"], 1);

        let plain = attach_bridge_meta(
            "entity_get",
            &serde_json::json!({ "id": "x" }),
            serde_json::json!({ "ok": true }),
        );
        assert_eq!(plain["ok"], true);
        assert!(plain.get("__meta").is_none());
    }

    #[test]
    fn normalize_frontend_failure_marks_convention_payloads() {
        // T1：ok:false → 补 isError + errorCode，原字段全保留（加性）
        let marked = normalize_frontend_failure(serde_json::json!({
            "ok": false,
            "error": "实体不存在",
            "path": "/a.md",
        }));
        assert_eq!(marked["isError"], true);
        assert_eq!(marked["errorCode"], "EXECUTION_ERROR");
        assert_eq!(marked["ok"], false);
        assert_eq!(marked["error"], "实体不存在");
        assert_eq!(marked["path"], "/a.md");

        // 裸 { error }（无 ok）→ 同样补标记
        let bare = normalize_frontend_failure(serde_json::json!({ "error": "未检测到可用 Shell" }));
        assert_eq!(bare["isError"], true);
        assert_eq!(bare["errorCode"], "EXECUTION_ERROR");

        // 显式 ok:true 以其为准（即使带 error 字段也不标记）
        assert!(
            normalize_frontend_failure(serde_json::json!({ "ok": true, "error": "x" }))
                .get("isError")
                .is_none()
        );
        // 无 error 字段 / 已带 isError / 非对象结果 → 原样放行
        assert!(
            normalize_frontend_failure(serde_json::json!({ "count": 1 }))
                .get("isError")
                .is_none()
        );
        let already = normalize_frontend_failure(serde_json::json!({
            "ok": false,
            "isError": true,
            "errorCode": "X",
        }));
        assert_eq!(already["errorCode"], "X");
        assert_eq!(
            normalize_frontend_failure(serde_json::json!("plain")),
            serde_json::json!("plain")
        );
    }
}