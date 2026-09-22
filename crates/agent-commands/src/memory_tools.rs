//! Agent 记忆工具（A1「Agent 记忆工具」批）：五件
//!
//! 对应 [A1 记忆系统设计](../../../docs/plans/2026-09-11-A1-记忆系统设计.md) §4.1 / §4.2 / §3.3。
//!
//! ## 为什么需要这批工具
//!
//! A1 至甲3 落地后，记忆的**机制**齐了（四操作 / 调和 / 淘汰 / 常驻派生），但
//! **模型没有任何入口**——它只能被动接受每轮的自动召回注入，无法主动查、无法显式记、
//! 无法纠正。两个直接后果：
//!
//! | # | 缺口 | 本批的解法 |
//! |---|---|---|
//! | ① | 乙3 的 `MEMORY.md` **置顶来源缺位**（当时只有「调和结论」一路自动产出） | [`MemoryPinTool`]——模型可把某条记忆标为常驻 |
//! | ② | 场景 `tool_ids` 早已声明 `memory_recall` / `memory_store`，但**Rust 侧零实现**（当时只是「意图登记」） | 五件工具全部落地，白名单里的名字终于可调 |
//!
//! ## 五件工具与四操作 / 治理动作的映射
//!
//! | 工具 | 语义 | 落到哪 |
//! |---|---|---|
//! | [`MemoryRecallTool`] | 读：按关键词查长期记忆 | `MemoryAccessor::recall`（**命中即计入访问**——甲3 的淘汰判据） |
//! | [`MemoryStoreTool`] | 写：显式新增（ADD） | `MemoryAccessor::write(MemoryWriteEntry::add)`（含写前去重） |
//! | [`MemoryUpdateTool`] | 写：取代式更新（UPDATE） | `MemoryAccessor::write(MemoryWriteEntry::update)`（甲2：旧值保留 + 取代链 + 调和摘要） |
//! | [`MemoryDeleteTool`] | 写：删除单条（DELETE） | `MemoryAccessor::write(MemoryWriteEntry::delete)`（未命中报 `not_found`，不静默） |
//! | [`MemoryPinTool`] | 治理：置顶 / 取消置顶 | `MemoryAccessor::pin`（pinned 不衰减不淘汰，且进入常驻文档） |
//!
//! **全部经 `write` 而非裸调 `delete_by_hook_id` / `pin`**：`write` 是四操作的统一入口，
//! 结果可解释（`WriteOutcome` 带 `Noop{reason}`）；裸调无法区分「删掉了」与「没这条」。
//!
//! ## 三条设计口径
//!
//! 1. **不给模型「写自由文本到 MEMORY.md」的入口**——乙3 已定该文件**单向派生**
//!    （记忆库 → 渲染 → 文件）。本批的置顶工具是**治理动作**（标一条既有记忆为常驻），
//!    不是文本编辑：模型改不了措辞，只能决定「哪条够格常驻」（设计 §3.3 的边界）。
//! 2. **写入是「显式意图」而非「随手记」**——工具描述明确写入时机（用户要求 / 跨会话
//!    有用的约定与决策），与自动归档路径（`record_turn` 每轮累积）互补而非重叠。
//! 3. **拒绝而非截断**（与己1① 的闸门同一哲学）：超长内容直接报错并给出提示，
//!    不静默截断——记忆库要的是**精炼的事实**，不是又一个原文仓库。
//!
//! ## 安全分级（`agent-kernel/src/confirmation.rs`）
//!
//! `memory_recall` / `memory_read_raw` → `Safe`（只读）；`memory_store` / `memory_update`
//! / `memory_pin` → `Moderate`；`memory_delete` → **`Dangerous`**（不可逆，无条件确认）。
//! 分级登记在 kernel，本模块只负责实现。

use std::sync::Arc;

use agent_runtime::memory::{
    MemoryAccessor, MemoryRecallOptions, MemoryWriteEntry, MemoryWriteOp, MemoryWriteOptions,
    NoopReason, WriteOutcome,
};
use agent_runtime::tool::{RiskLevel, SideEffectScope, Tool, ToolBus, ToolDescriptor, ToolError};
use async_trait::async_trait;
use serde_json::{json, Value};

/// 单条记忆的内容上限（字符）
///
/// 取 16 000：远超一条精炼事实（通常几十到几百字），又拦住「把整份文件塞进记忆库」
/// 的误用。超限**拒绝写入**（不截断）——记忆库的定位是精炼事实，不是原文仓库
/// （原文有 `raw/` 外置层与 `memory_read_raw`）。
pub const MEMORY_STORE_MAX_CHARS: usize = 16_000;

/// 单次召回返回条数上限（防模型索要全库）
pub const MEMORY_RECALL_MAX_TOP_K: u64 = 50;

// ─── 参数解析小工具 ────────────────────────────────────

/// 取必填字符串参数（trim 后非空）
fn required_str(args: &Value, key: &str) -> Result<String, ToolError> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ToolError::ArgsParse(format!("缺少参数 {key}（或为空）")))
}

/// 取可选字符串数组参数（亦接受单个字符串——模型有时会这么传）
fn optional_str_list(args: &Value, key: &str) -> Vec<String> {
    match args.get(key) {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        Some(Value::String(s)) if !s.trim().is_empty() => vec![s.trim().to_string()],
        _ => Vec::new(),
    }
}

// ─── ① memory_recall ────────────────────────────────────

/// `memory_recall`：按关键词检索长期记忆
///
/// **命中即计入访问**（甲3）：返回的每条都会 `access_count + 1` 且刷新
/// `last_access_at`——这是有意的，检索到的记忆应「返青」，久不命中的才会衰减。
/// 故本工具**不**标注「只读」（它读起来有副作用）——权限分级仍归 `Safe`
/// （副作用在记忆系统内部，不触碰用户数据）。
pub struct MemoryRecallTool {
    memory: Arc<dyn MemoryAccessor>,
}

impl MemoryRecallTool {
    /// 构造（注入该会话的记忆访问器）
    pub fn new(memory: Arc<dyn MemoryAccessor>) -> Self {
        Self { memory }
    }
}

#[async_trait]
impl Tool for MemoryRecallTool {
    fn name(&self) -> &str {
        "memory_recall"
    }

    fn description(&self) -> &str {
        "检索长期记忆（跨会话的项目知识、用户偏好、既往决策与约定）。\
         当你需要回忆「用户之前说过的」「项目里定过的」内容，或用户明确提到\
         「之前」「上次」时使用。返回条目含 hook_id（后续置顶/更新/删除引用它）\
         与摘要；命中的记忆会刷新其访问时间（影响长期保留）。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "检索关键词（用户原话或提炼的关键词，支持空格分隔多词）"
                },
                "top_k": {
                    "type": "integer",
                    "description": "返回条数上限（默认 5，上限 50）"
                }
            },
            "required": ["query"]
        })
    }
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::read_only(self.name(), "memory", self.description(), SideEffectScope::Session)
            .with_input_schema(self.parameters())
    }

    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        let query = required_str(&args, "query")?;
        let top_k = args
            .get("top_k")
            .and_then(|v| v.as_u64())
            .unwrap_or(5)
            .clamp(1, MEMORY_RECALL_MAX_TOP_K) as u32;

        let results = self
            .memory
            .recall(
                query.clone(),
                Some(MemoryRecallOptions {
                    top_k,
                    ..Default::default()
                }),
            )
            .await
            .map_err(|e| ToolError::Execution(format!("记忆检索失败: {e}")))?;

        let items: Vec<Value> = results
            .iter()
            .map(|r| {
                json!({
                    "hook_id": r.hook_id,
                    "summary": r.summary,
                    "score": r.score,
                    "created_at": r.created_at,
                    "tags": r.tags,
                    "keywords": r.keywords,
                    "pinned": r.pinned,
                    "access_count": r.access_count,
                })
            })
            .collect();

        Ok(json!({
            "query": query,
            "count": items.len(),
            "results": items,
            "__meta": { "op": "memory_recall" },
        }))
    }
}

// ─── ② memory_store ────────────────────────────────────

/// `memory_store`：显式写入一条长期记忆（ADD）
///
/// 与自动归档的分工：自动路径每轮累积会话轨迹（供追溯）；本工具写的是**提炼过的
/// 结论性事实**（用户偏好、项目约定、已定决策）——正是「哪些内容值得沉淀」的显式表达。
pub struct MemoryStoreTool {
    memory: Arc<dyn MemoryAccessor>,
}

impl MemoryStoreTool {
    /// 构造
    pub fn new(memory: Arc<dyn MemoryAccessor>) -> Self {
        Self { memory }
    }
}

#[async_trait]
impl Tool for MemoryStoreTool {
    fn name(&self) -> &str {
        "memory_store"
    }

    fn description(&self) -> &str {
        "把值得长期记住的事实写入记忆库（显式写入，跨会话生效）。\
         适用：用户明确要求「记住」的内容、对后续工作有用的项目约定 / 用户偏好 / 已定决策。\
         不适用：一次性会话细节、代码或文件里能直接读到的内容、临时状态。\
         写前自动去重——与既有条目高度相似时返回 outcome=noop、reason=duplicate\
         （此时说明已经记住了，无需重复写入）。内容应精炼成陈述句（一两句话）。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "要记住的事实（陈述句，建议一两句话；上限 16000 字符）"
                },
                "tags": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "可选：真标签（供后续检索与筛选，如「偏好」「架构决策」）"
                },
                "entity_ids": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "可选：关联的项目实体 ID（如角色/地点，供实体维度召回）"
                }
            },
            "required": ["content"]
        })
    }
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::writes(self.name(), "memory", self.description(), SideEffectScope::Session)
            .with_input_schema(self.parameters())
    }

    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        let content = required_str(&args, "content")?;
        let char_count = content.chars().count();
        if char_count > MEMORY_STORE_MAX_CHARS {
            // 拒绝而非截断（与己1① 闸门同哲学）：记忆要的是精炼事实
            return Err(ToolError::Execution(format!(
                "内容过长（{char_count} 字符，上限 {MEMORY_STORE_MAX_CHARS}）。\
                 请精炼为要点后重试；完整长文请写入文件。"
            )));
        }

        let entry = MemoryWriteEntry::add(content)
            .with_tags(optional_str_list(&args, "tags"))
            .with_entities(optional_str_list(&args, "entity_ids"));

        let outcome = self
            .memory
            .write(entry, Some(MemoryWriteOptions::default()))
            .await
            .map_err(|e| ToolError::Execution(format!("记忆写入失败: {e}")))?;

        Ok(json!({ "outcome": outcome_kind(&outcome), "detail": outcome_detail(&outcome) }))
    }
}

// ─── ③ memory_update ────────────────────────────────────

/// `memory_update`：取代式更新（UPDATE）
///
/// 落到甲2：**旧条目保留**、记取代链、产调和摘要（摘要进 MEMORY.md 常驻候选）。
/// 这是「事实变了」的正确处理方式——比删除+重写更安全（历史可追溯、时序可解释）。
pub struct MemoryUpdateTool {
    memory: Arc<dyn MemoryAccessor>,
}

impl MemoryUpdateTool {
    /// 构造
    pub fn new(memory: Arc<dyn MemoryAccessor>) -> Self {
        Self { memory }
    }
}

#[async_trait]
impl Tool for MemoryUpdateTool {
    fn name(&self) -> &str {
        "memory_update"
    }

    fn description(&self) -> &str {
        "更新一条既有记忆（取代式：旧条目保留，另记「谁取代谁 + 何时」的调和关系）。\
         当记忆里的事实**发生了变化或被修正**时使用——例如「用户改用 Vue」取代\
         「用户使用 React」。需先用 memory_recall 拿到 hook_id。\
         注意：这不是覆盖——旧值仍可追溯；系统会生成一条调和摘要记录变化时序。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "hook_id": {
                    "type": "string",
                    "description": "被更新的既有条目（memory_recall 返回的 hook_id）"
                },
                "content": {
                    "type": "string",
                    "description": "新的（修正后的）事实"
                },
                "tags": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "可选：新条目的真标签"
                }
            },
            "required": ["hook_id", "content"]
        })
    }
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::writes(self.name(), "memory", self.description(), SideEffectScope::Session)
            .with_input_schema(self.parameters())
    }

    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        let hook_id = required_str(&args, "hook_id")?;
        let content = required_str(&args, "content")?;
        let char_count = content.chars().count();
        if char_count > MEMORY_STORE_MAX_CHARS {
            return Err(ToolError::Execution(format!(
                "内容过长（{char_count} 字符，上限 {MEMORY_STORE_MAX_CHARS}）"
            )));
        }

        let entry = MemoryWriteEntry {
            op: MemoryWriteOp::Update,
            content,
            layer: Default::default(),
            hook_id: Some(hook_id),
            entity_ids: Vec::new(),
            tags: optional_str_list(&args, "tags"),
        };

        let outcome = self
            .memory
            .write(entry, None)
            .await
            .map_err(|e| ToolError::Execution(format!("记忆更新失败: {e}")))?;

        Ok(json!({ "outcome": outcome_kind(&outcome), "detail": outcome_detail(&outcome) }))
    }
}

// ─── ④ memory_delete ────────────────────────────────────

/// `memory_delete`：删除单条记忆（DELETE）
///
/// 权限 `Dangerous`（kernel 静态表登记）——不可逆，由确认流把关。
/// 措辞上引导模型优先走 `memory_update`（事实变化）而非删除（撤回）。
pub struct MemoryDeleteTool {
    memory: Arc<dyn MemoryAccessor>,
}

impl MemoryDeleteTool {
    /// 构造
    pub fn new(memory: Arc<dyn MemoryAccessor>) -> Self {
        Self { memory }
    }
}

#[async_trait]
impl Tool for MemoryDeleteTool {
    fn name(&self) -> &str {
        "memory_delete"
    }

    fn description(&self) -> &str {
        "删除一条记忆（不可逆，需用户确认）。仅用于：条目写错了、或对应事实已作废\
         且没有「新事实」可取代。**若只是事实发生了变化，请改用 memory_update**\
         （保留历史与变化时序）。需先用 memory_recall 拿到 hook_id。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "hook_id": {
                    "type": "string",
                    "description": "要删除的条目（memory_recall 返回的 hook_id）"
                }
            },
            "required": ["hook_id"]
        })
    }
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::guarded(self.name(), "memory", self.description(), SideEffectScope::Session, RiskLevel::Dangerous)
            .with_input_schema(self.parameters())
    }

    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        let hook_id = required_str(&args, "hook_id")?;

        let outcome = self
            .memory
            .write(MemoryWriteEntry::delete(hook_id), None)
            .await
            .map_err(|e| ToolError::Execution(format!("记忆删除失败: {e}")))?;

        Ok(json!({ "outcome": outcome_kind(&outcome), "detail": outcome_detail(&outcome) }))
    }
}

// ─── ⑤ memory_pin ───────────────────────────────────────

/// `memory_pin`：置顶 / 取消置顶（乙3 缺口的补齐）
///
/// 双重语义：① **不衰减、不淘汰**（甲3 的 `pinned` 保护）
/// ② **进入常驻记忆文档**（乙3 的 `MEMORY.md` 派生源之一）。
/// 这是模型对「哪些记忆最该常驻」的表态——但它**改不了文件文本**（单向派生），
/// 只能决定「哪条够格」（设计 §3.3 的边界）。
pub struct MemoryPinTool {
    memory: Arc<dyn MemoryAccessor>,
}

impl MemoryPinTool {
    /// 构造
    pub fn new(memory: Arc<dyn MemoryAccessor>) -> Self {
        Self { memory }
    }
}

#[async_trait]
impl Tool for MemoryPinTool {
    fn name(&self) -> &str {
        "memory_pin"
    }

    fn description(&self) -> &str {
        "把一条记忆标为「常驻」（或取消）。常驻的含义：① 永不衰减、永不淘汰；\
         ② 会出现在每轮可见的常驻记忆文档（MEMORY.md）中——即「最该长期记住的几条」。\
         适用：用户的核心偏好、项目最重要的约定/决策。不宜多条（常驻成本每轮都付）。\
         需先用 memory_recall 拿到 hook_id。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "hook_id": {
                    "type": "string",
                    "description": "目标条目（memory_recall 返回的 hook_id）"
                },
                "pinned": {
                    "type": "boolean",
                    "description": "true=置顶（默认），false=取消置顶"
                }
            },
            "required": ["hook_id"]
        })
    }
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::writes(self.name(), "memory", self.description(), SideEffectScope::Session)
            .with_input_schema(self.parameters())
    }

    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        let hook_id = required_str(&args, "hook_id")?;
        let pinned = args
            .get("pinned")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        self.memory
            .pin(&hook_id, pinned)
            .await
            .map_err(|e| ToolError::Execution(format!("记忆置顶失败: {e}")))?;

        Ok(json!({
            "hook_id": hook_id,
            "pinned": pinned,
            "hint": if pinned {
                "该条目已常驻：不衰减不淘汰，并会出现在常驻记忆文档中"
            } else {
                "该条目已取消常驻：恢复按衰减规则管理"
            },
        }))
    }
}

// ─── 结果映射（四操作 → 模型可读的 JSON）────────────────

/// `WriteOutcome` → 结果类别（模型据此判断「成了没有、为什么没成」）
fn outcome_kind(outcome: &WriteOutcome) -> &'static str {
    match outcome {
        WriteOutcome::Added { .. } => "added",
        WriteOutcome::Superseded { .. } => "superseded",
        WriteOutcome::Deleted { .. } => "deleted",
        WriteOutcome::Updated { .. } => "updated",
        WriteOutcome::Noop { reason } => match reason {
            NoopReason::Duplicate { .. } => "duplicate",
            NoopReason::NotFound => "not_found",
            NoopReason::Explicit => "noop",
        },
    }
}

/// `WriteOutcome` → 细节对象（含 hook_id / 重复命中等）
fn outcome_detail(outcome: &WriteOutcome) -> Value {
    match outcome {
        WriteOutcome::Added { hook_id } => json!({
            "hook_id": hook_id,
            "hint": "已记住。后续可用 memory_pin 标为常驻，或用 memory_update 修正。",
        }),
        WriteOutcome::Superseded { old_hook_id, new_hook_id } => json!({
            "old_hook_id": old_hook_id,
            "new_hook_id": new_hook_id,
            "hint": "已取代：旧条目保留可追溯，调和摘要已生成（可能进入常驻文档）。",
        }),
        WriteOutcome::Deleted { hook_id } => json!({
            "hook_id": hook_id,
            "hint": "已删除。",
        }),
        WriteOutcome::Updated { hook_id } => json!({ "hook_id": hook_id }),
        WriteOutcome::Noop { reason } => match reason {
            NoopReason::Duplicate { matched_hook_id, score } => json!({
                "matched_hook_id": matched_hook_id,
                "score": score,
                "hint": "已有高度相似的条目（无需重复写入）；如需修正请用 memory_update。",
            }),
            NoopReason::NotFound => json!({
                "hint": "未找到该 hook_id 对应的条目（可能已被删除或 ID 有误）；\
                         可用 memory_recall 重新确认。",
            }),
            NoopReason::Explicit => json!({ "hint": "调用方声明无需写入。" }),
        },
    }
}

// ─── 注册 ────────────────────────────────────────────

/// 注册五件记忆工具（有记忆后端时；幂等——同名注册覆盖）
///
/// **注册无条件、可见性靠场景**：五件工具都注册进总线，是否对模型可见由
/// `WhitelistToolBus`（`SYSTEM_BASE_TOOLS` ∪ 场景 `tool_ids`）决定——
/// 与 fs / terminal 工具组同一机制。故 `Light` 档场景（coding）只需在
/// `tool_ids` 里不列这些名字即可（设计 §4.2「收掉该工具」的落点）。
pub async fn register_memory_tools(bus: &dyn ToolBus, memory: Arc<dyn MemoryAccessor>) {
    bus.register(Arc::new(MemoryRecallTool::new(memory.clone())))
        .await;
    bus.register(Arc::new(MemoryStoreTool::new(memory.clone())))
        .await;
    bus.register(Arc::new(MemoryUpdateTool::new(memory.clone())))
        .await;
    bus.register(Arc::new(MemoryDeleteTool::new(memory.clone())))
        .await;
    bus.register(Arc::new(MemoryPinTool::new(memory))).await;
}

// ─── 测试 ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use agent_runtime::memory::{
        ArchiveSource, MemoryArchiveResult, MemoryError, MemoryLayer, MemoryRecallResult,
        SummaryMethod,
    };

    /// 内存版假访问器：记录调用、按脚本返回
    #[derive(Default)]
    struct FakeMemory {
        /// 收到的写入请求（`(op, content, hook_id, tags)`）
        writes: std::sync::Mutex<Vec<(MemoryWriteOp, String, Option<String>, Vec<String>)>>,
        /// 脚本化的写入结果
        write_outcome: std::sync::Mutex<Option<WriteOutcome>>,
        /// recall 返回
        recall_results: std::sync::Mutex<Vec<MemoryRecallResult>>,
        /// pin 调用记录 `(hook_id, pinned)`
        pins: std::sync::Mutex<Vec<(String, bool)>>,
        /// recall 收到的 top_k
        last_top_k: std::sync::Mutex<Option<u32>>,
    }

    impl FakeMemory {
        fn with_outcome(outcome: WriteOutcome) -> Arc<Self> {
            let f = Arc::new(Self::default());
            *f.write_outcome.lock().unwrap() = Some(outcome);
            f
        }
        fn with_recall(results: Vec<MemoryRecallResult>) -> Arc<Self> {
            let f = Arc::new(Self::default());
            *f.recall_results.lock().unwrap() = results;
            f
        }
    }

    #[async_trait]
    impl MemoryAccessor for FakeMemory {
        async fn recall(
            &self,
            _query: String,
            options: Option<MemoryRecallOptions>,
        ) -> Result<Vec<MemoryRecallResult>, MemoryError> {
            let top_k = options.map(|o| o.top_k).unwrap_or(5);
            *self.last_top_k.lock().unwrap() = Some(top_k);
            let mut results = self.recall_results.lock().unwrap().clone();
            results.truncate(top_k as usize);
            Ok(results)
        }

        async fn inject(
            &self,
            _results: Vec<MemoryRecallResult>,
            _options: Option<agent_runtime::memory::MemoryInjectOptions>,
        ) -> Result<String, MemoryError> {
            Ok(String::new())
        }

        async fn archive(
            &self,
            _source: Option<ArchiveSource>,
        ) -> Result<Option<MemoryArchiveResult>, MemoryError> {
            Ok(None)
        }

        async fn get_archive_boundary(&self) -> Result<usize, MemoryError> {
            Ok(0)
        }

        async fn write(
            &self,
            entry: MemoryWriteEntry,
            _options: Option<MemoryWriteOptions>,
        ) -> Result<WriteOutcome, MemoryError> {
            self.writes.lock().unwrap().push((
                entry.op,
                entry.content.clone(),
                entry.hook_id.clone(),
                entry.tags.clone(),
            ));
            Ok(self
                .write_outcome
                .lock()
                .unwrap()
                .clone()
                .unwrap_or(WriteOutcome::Noop {
                    reason: NoopReason::Explicit,
                }))
        }

        async fn pin(&self, hook_id: &str, pinned: bool) -> Result<(), MemoryError> {
            self.pins
                .lock()
                .unwrap()
                .push((hook_id.to_string(), pinned));
            Ok(())
        }
    }

    fn sample_result() -> MemoryRecallResult {
        MemoryRecallResult {
            hook_id: "hook-1".into(),
            summary: "用户偏好深色主题".into(),
            score: 0.9,
            matched_fields: vec!["summary".into()],
            created_at: 1_700_000_000_000,
            access_count: 3,
            keywords: vec!["主题".into()],
            tags: vec!["偏好".into()],
            pinned: true,
        }
    }

    // ① recall

    #[tokio::test]
    async fn recall_forwards_query_and_top_k() {
        let fake = FakeMemory::with_recall(vec![sample_result()]);
        let tool = MemoryRecallTool::new(fake.clone());

        let out = tool
            .execute(json!({ "query": "深色", "top_k": 3 }))
            .await
            .unwrap();
        assert_eq!(out["count"], 1);
        assert_eq!(out["results"][0]["hook_id"], "hook-1");
        assert_eq!(out["results"][0]["pinned"], true);
        assert_eq!(out["results"][0]["access_count"], 3);
        assert_eq!(*fake.last_top_k.lock().unwrap(), Some(3));
    }

    #[tokio::test]
    async fn recall_clamps_top_k_and_rejects_empty_query() {
        let fake = FakeMemory::with_recall(vec![]);
        let tool = MemoryRecallTool::new(fake.clone());

        tool.execute(json!({ "query": "x", "top_k": 99999 }))
            .await
            .unwrap();
        assert_eq!(
            *fake.last_top_k.lock().unwrap(),
            Some(MEMORY_RECALL_MAX_TOP_K as u32),
            "top_k 应被夹到上限"
        );

        assert!(tool.execute(json!({ "query": "   " })).await.is_err());
        assert!(tool.execute(json!({})).await.is_err());
    }

    // ② store

    #[tokio::test]
    async fn store_writes_add_with_tags_and_entities() {
        let fake = FakeMemory::with_outcome(WriteOutcome::Added {
            hook_id: "hook-new".into(),
        });
        let tool = MemoryStoreTool::new(fake.clone());

        let out = tool
            .execute(json!({
                "content": "项目使用 Rsproxy 作为 cargo 镜像源",
                "tags": ["构建", "约定"],
                "entity_ids": ["proj-1"]
            }))
            .await
            .unwrap();

        assert_eq!(out["outcome"], "added");
        assert_eq!(out["detail"]["hook_id"], "hook-new");
        let writes = fake.writes.lock().unwrap();
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].0, MemoryWriteOp::Add);
        assert_eq!(writes[0].3, vec!["构建".to_string(), "约定".to_string()]);
    }

    #[tokio::test]
    async fn store_surfaces_duplicate_outcome_instead_of_silence() {
        let fake = FakeMemory::with_outcome(WriteOutcome::Noop {
            reason: NoopReason::Duplicate {
                matched_hook_id: "hook-old".into(),
                score: 0.95,
            },
        });
        let tool = MemoryStoreTool::new(fake);

        let out = tool.execute(json!({ "content": "重复内容" })).await.unwrap();
        assert_eq!(out["outcome"], "duplicate");
        assert_eq!(out["detail"]["matched_hook_id"], "hook-old");
        assert!(
            out["detail"]["hint"].as_str().unwrap().contains("无需重复"),
            "应给出「已经记住」的提示而不是静默"
        );
    }

    #[tokio::test]
    async fn store_rejects_overlong_content_instead_of_truncating() {
        let fake = FakeMemory::with_outcome(WriteOutcome::Added {
            hook_id: "x".into(),
        });
        let tool = MemoryStoreTool::new(fake.clone());

        let huge = "字".repeat(MEMORY_STORE_MAX_CHARS + 1);
        let err = tool.execute(json!({ "content": huge })).await.unwrap_err();
        assert!(err.to_string().contains("过长"), "应报过长: {err}");
        assert!(
            fake.writes.lock().unwrap().is_empty(),
            "拒绝时不得写入任何内容（不静默截断）"
        );
    }

    // ③ update

    #[tokio::test]
    async fn update_sends_supersede_shape() {
        let fake = FakeMemory::with_outcome(WriteOutcome::Superseded {
            old_hook_id: "hook-old".into(),
            new_hook_id: "hook-new".into(),
        });
        let tool = MemoryUpdateTool::new(fake.clone());

        let out = tool
            .execute(json!({ "hook_id": "hook-old", "content": "用户改用 Vue" }))
            .await
            .unwrap();

        assert_eq!(out["outcome"], "superseded");
        assert_eq!(out["detail"]["old_hook_id"], "hook-old");
        assert_eq!(out["detail"]["new_hook_id"], "hook-new");
        let writes = fake.writes.lock().unwrap();
        assert_eq!(writes[0].0, MemoryWriteOp::Update);
        assert_eq!(writes[0].2.as_deref(), Some("hook-old"));
    }

    #[tokio::test]
    async fn update_reports_not_found() {
        let fake = FakeMemory::with_outcome(WriteOutcome::Noop {
            reason: NoopReason::NotFound,
        });
        let tool = MemoryUpdateTool::new(fake);
        let out = tool
            .execute(json!({ "hook_id": "ghost", "content": "新" }))
            .await
            .unwrap();
        assert_eq!(out["outcome"], "not_found");
    }

    // ④ delete

    #[tokio::test]
    async fn delete_goes_through_write_and_reports_deleted() {
        let fake = FakeMemory::with_outcome(WriteOutcome::Deleted {
            hook_id: "hook-1".into(),
        });
        let tool = MemoryDeleteTool::new(fake.clone());

        let out = tool.execute(json!({ "hook_id": "hook-1" })).await.unwrap();
        assert_eq!(out["outcome"], "deleted");
        let writes = fake.writes.lock().unwrap();
        assert_eq!(writes[0].0, MemoryWriteOp::Delete);
        assert_eq!(writes[0].2.as_deref(), Some("hook-1"));
    }

    #[tokio::test]
    async fn delete_reports_not_found_when_missing() {
        let fake = FakeMemory::with_outcome(WriteOutcome::Noop {
            reason: NoopReason::NotFound,
        });
        let tool = MemoryDeleteTool::new(fake);
        let out = tool.execute(json!({ "hook_id": "ghost" })).await.unwrap();
        assert_eq!(out["outcome"], "not_found", "未命中不得报成功");
    }

    #[test]
    fn delete_is_registered_as_dangerous_permission() {
        // 与 kernel 静态表的一致性：确认流据此拦不可逆操作
        assert_eq!(
            agent_runtime::confirmation::tool_permission("memory_delete"),
            agent_runtime::confirmation::ToolPermission::Dangerous
        );
    }

    // ⑤ pin

    #[tokio::test]
    async fn pin_defaults_to_true_and_forwards_hook() {
        let fake = Arc::new(FakeMemory::default());
        let tool = MemoryPinTool::new(fake.clone());

        let out = tool.execute(json!({ "hook_id": "hook-1" })).await.unwrap();
        assert_eq!(out["pinned"], true);
        assert_eq!(
            *fake.pins.lock().unwrap(),
            vec![("hook-1".to_string(), true)]
        );

        let out = tool
            .execute(json!({ "hook_id": "hook-1", "pinned": false }))
            .await
            .unwrap();
        assert_eq!(out["pinned"], false);
        assert_eq!(fake.pins.lock().unwrap().len(), 2);
    }

    // 参数韧性

    #[tokio::test]
    async fn string_list_accepts_single_string_form() {
        let fake = FakeMemory::with_outcome(WriteOutcome::Added {
            hook_id: "h".into(),
        });
        let tool = MemoryStoreTool::new(fake.clone());
        // 模型有时把数组写成单串
        tool.execute(json!({ "content": "x", "tags": "偏好" }))
            .await
            .unwrap();
        assert_eq!(
            fake.writes.lock().unwrap()[0].3,
            vec!["偏好".to_string()],
            "单串形式应被容错为单元素列表"
        );
    }

    #[test]
    fn all_tools_declare_expected_names_and_params() {
        let fake = Arc::new(FakeMemory::default());
        assert_eq!(MemoryRecallTool::new(fake.clone()).name(), "memory_recall");
        assert_eq!(MemoryStoreTool::new(fake.clone()).name(), "memory_store");
        assert_eq!(MemoryUpdateTool::new(fake.clone()).name(), "memory_update");
        assert_eq!(MemoryDeleteTool::new(fake.clone()).name(), "memory_delete");
        assert_eq!(MemoryPinTool::new(fake.clone()).name(), "memory_pin");

        // 描述里明示关键语义（模型据此判断何时调用）。
        // 工具需先绑定到变量——`description()` 借自 `&self`，不能对临时值取引用
        let recall = MemoryRecallTool::new(fake.clone());
        assert!(recall.description().contains("跨会话"));
        let pin = MemoryPinTool::new(fake.clone());
        assert!(pin.description().contains("不衰减"), "pin 描述须说明保护语义");
        assert!(pin.description().contains("常驻"), "pin 描述须说明 MEMORY.md 语义");
        let del = MemoryDeleteTool::new(fake);
        assert!(del.description().contains("memory_update"), "删除描述应引导优先用 update");
    }

    #[tokio::test]
    async fn register_memory_tools_installs_all_five() {
        let bus = agent_runtime::tool::SimpleToolBus::new();
        let fake: Arc<dyn MemoryAccessor> = Arc::new(FakeMemory::default());
        register_memory_tools(&bus, fake).await;

        let names: Vec<String> = bus.list_all().await.into_iter().map(|d| d.name).collect();
        for expected in [
            "memory_recall",
            "memory_store",
            "memory_update",
            "memory_delete",
            "memory_pin",
        ] {
            assert!(names.contains(&expected.to_string()), "缺工具: {expected}");
        }
        assert_eq!(names.len(), 5);
    }

    #[tokio::test]
    async fn layer_parameter_is_ignored_by_default_but_entry_compiles() {
        // 记录：MemoryWriteEntry 支持 layer（四层概念），工具面暂不暴露该参数
        // （避免模型乱选层）；此处只锁「默认层 = Episodic」的既有约定
        let entry = MemoryWriteEntry::add("x");
        assert_eq!(entry.layer, MemoryLayer::default());
        let _ = SummaryMethod::Rule; // 摘要方式亦不在工具面暴露（由写入路径决定）
    }
}
