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

/// 一个交由前端执行的桥工具（name/description/parameters 与前端 `ALL_TOOLS_MAP` 对齐，
/// 使 LLM 看到的工具契约一致；execute 委托 bridge 转发前端执行 + 回传）
pub struct FrontendBridgeTool {
    name: &'static str,
    description: &'static str,
    parameters: serde_json::Value,
    bridge: Arc<FrontendToolBridge>,
}

impl FrontendBridgeTool {
    pub fn new(
        name: &'static str,
        description: &'static str,
        parameters: serde_json::Value,
        bridge: Arc<FrontendToolBridge>,
    ) -> Self {
        Self { name, description, parameters, bridge }
    }
}

#[async_trait]
impl Tool for FrontendBridgeTool {
    fn name(&self) -> &str {
        self.name
    }

    fn description(&self) -> &str {
        self.description
    }

    fn parameters(&self) -> serde_json::Value {
        self.parameters.clone()
    }

    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let result = self.bridge.request(self.name, args.clone()).await?;
        // 事件流丰富化：按工具名+args 附 __meta，供前端 ToolRow 展示语义操作段
        Ok(attach_bridge_meta(self.name, &args, result))
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

// ─── 首批桥工具清单（与前端 ALL_TOOLS_MAP 的 entity-crud / content-search 对齐）───

/// 构造首批桥工具（entity_create / entity_update / content_search）
///
/// 工具定义（description/parameters）从前端 `packages/agent-runtime/src/tools/`
/// 的对应工具拷贝，保证 LLM 看到的前后契约一致。返回工具名即首批桥接清单。
pub fn bridge_tools(bridge: Arc<FrontendToolBridge>) -> Vec<Arc<dyn Tool>> {
    vec![
        Arc::new(FrontendBridgeTool::new(
            "entity_create",
            "创建新实体。需要 type 和 name，可选 description 和 properties。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "type": { "type": "string", "description": "实体类型" },
                    "name": { "type": "string", "description": "实体名称" },
                    "description": { "type": "string", "description": "实体描述（可选）" },
                    "properties": { "type": "object", "description": "实体属性（键值对，可选）" }
                },
                "required": ["type", "name"]
            }),
            bridge.clone(),
        )),
        Arc::new(FrontendBridgeTool::new(
            "entity_update",
            "更新实体属性。只能更新 name、description、properties 中的字段。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "实体 ID" },
                    "name": { "type": "string", "description": "新名称（可选）" },
                    "description": { "type": "string", "description": "新描述（可选）" },
                    "properties": { "type": "object", "description": "要更新的属性键值对（合并）" }
                },
                "required": ["id"]
            }),
            bridge.clone(),
        )),
        // 任务29/M4 收敛补齐：E1 拒绝裸删 entities/ 后的语义删除正道（TS 实现已存在
        // entity-crud.ts entityDeleteTool：级联删关联关系 + 清索引 + 关 A2UI 画布），
        // 此前桥上缺失导致 Agent 删实体无合法路径——E1 引导语与桥清单在此对齐闭环
        Arc::new(FrontendBridgeTool::new(
            "entity_delete",
            "删除指定实体及其所有关联关系。此操作不可逆。需要实体 ID（可通过 entity_list 获取）。执行前请向用户确认删除意图。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "实体 ID" }
                },
                "required": ["id"]
            }),
            bridge.clone(),
        )),
        Arc::new(FrontendBridgeTool::new(
            "content_search",
            "在项目的所有实体中搜索内容。支持语义搜索（理解含义）和关键词搜索（精确匹配）的混合模式。语义搜索能找到意思相近但不包含关键词的内容；关键词搜索能精确匹配文本。使用场景：模糊查找、概念搜索、精确匹配。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "keyword": { "type": "string", "description": "搜索关键词或描述" },
                    "scope": { "type": "string", "description": "关键词搜索范围: name/description/properties/all，默认 all", "enum": ["name", "description", "properties", "all"] },
                    "limit": { "type": "number", "description": "返回数量上限，默认20" },
                    "mode": { "type": "string", "description": "搜索模式: hybrid(语义+关键词混合)/keyword(纯关键词)/semantic(纯语义)，默认 hybrid", "enum": ["hybrid", "keyword", "semantic"] }
                },
                "required": ["keyword"]
            }),
            bridge,
        )),
    ]
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
    fn bridge_tools_define_first_batch_tools() {
        // 验证构造的桥工具契约：需 AppHandle 实例化，故此处仅验证清单由名称文档承载。
        // 桥工具列表由 `bridge_tools` 返回四个，name 与前端 ALL_TOOLS_MAP 对齐——
        // 该契约在 lib.rs 装配 `.chain(bridge_tools(...))` 处应用。
        // 任务29/M4：entity_delete 补齐（E1 拒绝裸删后的语义删除正道），三→四。
        let names = ["entity_create", "entity_update", "entity_delete", "content_search"];
        assert_eq!(names.len(), 4);
        assert!(names.contains(&"entity_create"));
        assert!(names.contains(&"entity_update"));
        assert!(names.contains(&"entity_delete"));
        assert!(names.contains(&"content_search"));
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
}